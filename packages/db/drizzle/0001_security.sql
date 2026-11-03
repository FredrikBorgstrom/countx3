-- Tenant isolation, immutability of booked vouchers and the append-only audit log.
-- These are enforced by Postgres itself, so no code path (human UI, agent, bug) can bypass them.
-- The API connects as countx3_app, which is subject to row-level security.

CREATE FUNCTION app_company_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.company_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

-- Row-level security -------------------------------------------------------------------------

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY companies_access ON companies
	USING (id = app_company_id() OR EXISTS (
		SELECT 1 FROM company_members m WHERE m.company_id = companies.id AND m.user_id = app_user_id()))
	WITH CHECK (id = app_company_id());
--> statement-breakpoint
ALTER TABLE company_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE company_members FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_members_access ON company_members
	USING (company_id = app_company_id() OR user_id = app_user_id())
	WITH CHECK (company_id = app_company_id());
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
	FOREACH t IN ARRAY ARRAY['fiscal_years', 'accounts', 'opening_balances', 'voucher_series', 'voucher_counters', 'vouchers', 'voucher_lines'] LOOP
		EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
		EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
		EXECUTE format('CREATE POLICY %I ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t || '_tenant', t);
	END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_events_read ON audit_events FOR SELECT USING (company_id = app_company_id());
--> statement-breakpoint
CREATE POLICY audit_events_write ON audit_events FOR INSERT
	WITH CHECK (company_id IS NULL OR company_id = app_company_id());
--> statement-breakpoint

-- Booked vouchers are immutable (BFL 5:5; corrections are new vouchers) -----------------------

ALTER TABLE vouchers ADD CONSTRAINT vouchers_booked_complete CHECK (
	status = 'draft' OR (number IS NOT NULL AND booking_seq IS NOT NULL AND booked_at IS NOT NULL
		AND booked_by IS NOT NULL AND prev_hash IS NOT NULL AND hash IS NOT NULL));
--> statement-breakpoint
CREATE FUNCTION vouchers_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	balance bigint;
	line_count int;
BEGIN
	IF OLD.status = 'booked' THEN
		RAISE EXCEPTION 'voucher % is booked and cannot be changed or deleted; book a correction instead', OLD.id
			USING ERRCODE = 'P0001', HINT = 'VOUCHER_IMMUTABLE';
	END IF;
	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	IF NEW.status = 'booked' THEN
		SELECT coalesce(sum(amount), 0), count(*) INTO balance, line_count FROM voucher_lines WHERE voucher_id = NEW.id;
		IF balance <> 0 OR line_count < 2 THEN
			RAISE EXCEPTION 'voucher % does not balance (% öre, % lines)', NEW.id, balance, line_count
				USING ERRCODE = 'P0001', HINT = 'VOUCHER_UNBALANCED';
		END IF;
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER vouchers_guard BEFORE UPDATE OR DELETE ON vouchers FOR EACH ROW EXECUTE FUNCTION vouchers_guard();
--> statement-breakpoint
CREATE FUNCTION vouchers_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW.status <> 'draft' THEN
		RAISE EXCEPTION 'vouchers must be inserted as drafts and booked afterwards'
			USING ERRCODE = 'P0001', HINT = 'VOUCHER_INSERT_AS_DRAFT';
	END IF;
	RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER vouchers_insert_guard BEFORE INSERT ON vouchers FOR EACH ROW EXECUTE FUNCTION vouchers_insert_guard();
--> statement-breakpoint
CREATE FUNCTION voucher_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	parent_status text;
	parent_company uuid;
BEGIN
	SELECT status, company_id INTO parent_status, parent_company FROM vouchers
		WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.voucher_id ELSE NEW.voucher_id END;
	IF parent_status IS NULL THEN
		-- Deleting a draft cascades to its lines after the voucher row is gone.
		IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
		RAISE EXCEPTION 'voucher not found' USING ERRCODE = 'P0001', HINT = 'NOT_FOUND';
	END IF;
	IF parent_status = 'booked' THEN
		RAISE EXCEPTION 'lines of a booked voucher cannot be changed' USING ERRCODE = 'P0001', HINT = 'VOUCHER_IMMUTABLE';
	END IF;
	IF TG_OP <> 'DELETE' AND NEW.company_id <> parent_company THEN
		RAISE EXCEPTION 'line company does not match voucher company' USING ERRCODE = 'P0001', HINT = 'TENANT_MISMATCH';
	END IF;
	RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
CREATE TRIGGER voucher_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON voucher_lines FOR EACH ROW EXECUTE FUNCTION voucher_lines_guard();
--> statement-breakpoint

-- Behandlingshistorik is append-only ---------------------------------------------------------

CREATE FUNCTION audit_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'audit events are append-only' USING ERRCODE = 'P0001', HINT = 'AUDIT_APPEND_ONLY';
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
--> statement-breakpoint

-- Runtime role -------------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO countx3_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO countx3_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO countx3_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON audit_events FROM countx3_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO countx3_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO countx3_app;
