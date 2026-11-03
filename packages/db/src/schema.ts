import type { Actor } from '@countx3/core';
import { sql } from 'drizzle-orm';
import {
	bigint,
	bigserial,
	boolean,
	date,
	integer,
	jsonb,
	numeric,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const companyId = () => uuid('company_id').notNull();
const minor = (name: string) => bigint(name, { mode: 'bigint' });

// --- Users and access -----------------------------------------------------------------------

export const users = pgTable('users', {
	id: id(),
	email: text('email').notNull().unique(),
	name: text('name').notNull(),
	/** Argon2id hash (Bun.password). Passkeys and BankID are added later. */
	passwordHash: text('password_hash'),
	createdAt: createdAt(),
});

export const sessions = pgTable('sessions', {
	id: id(),
	userId: uuid('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	/** SHA-256 of the session secret; the secret itself is only ever held by the client. */
	secretHash: text('secret_hash').notNull().unique(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	createdAt: createdAt(),
});

/** Scoped tokens for agents (Claude Code, Codex) and scripts. They act on behalf of the creating user. */
export const apiTokens = pgTable('api_tokens', {
	id: id(),
	userId: uuid('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	/** Optional restriction to a single company. */
	companyId: uuid('company_id'),
	name: text('name').notNull(),
	/** Agent client, e.g. "claude-code" or "codex"; null for plain scripts. */
	client: text('client'),
	prefix: text('prefix').notNull(),
	secretHash: text('secret_hash').notNull().unique(),
	scopes: text('scopes').array().notNull(),
	createdAt: createdAt(),
	lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
	expiresAt: timestamp('expires_at', { withTimezone: true }),
	revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

// --- Companies --------------------------------------------------------------------------------

export const companies = pgTable('companies', {
	id: id(),
	name: text('name').notNull(),
	country: text('country').notNull(),
	legalForm: text('legal_form').notNull(),
	organizationNumber: text('organization_number').notNull(),
	currency: text('currency').notNull(),
	/** Net turnover normally ≤ 3 MSEK: affects booking deadlines. */
	smallCompany: boolean('small_company').notNull().default(true),
	/** Nothing can be booked on or before this date. */
	lockedThrough: date('locked_through'),
	/** Head of the voucher hash chain. Updated under row lock when booking. */
	lastBookingSeq: integer('last_booking_seq').notNull().default(0),
	lastHash: text('last_hash').notNull(),
	createdAt: createdAt(),
});

export const companyMembers = pgTable(
	'company_members',
	{
		companyId: companyId().references(() => companies.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		role: text('role', { enum: ['owner', 'accountant', 'member', 'auditor'] }).notNull(),
		createdAt: createdAt(),
	},
	(t) => [primaryKey({ columns: [t.companyId, t.userId] })],
);

export const fiscalYears = pgTable(
	'fiscal_years',
	{
		id: id(),
		companyId: companyId().references(() => companies.id),
		start: date('start_date').notNull(),
		end: date('end_date').notNull(),
		closed: boolean('closed').notNull().default(false),
		createdAt: createdAt(),
	},
	(t) => [uniqueIndex('fiscal_years_company_start').on(t.companyId, t.start)],
);

export const accounts = pgTable(
	'accounts',
	{
		companyId: companyId().references(() => companies.id),
		number: text('number').notNull(),
		name: text('name').notNull(),
		type: text('type', { enum: ['asset', 'liability', 'equity', 'income', 'expense'] }).notNull(),
		active: boolean('active').notNull().default(true),
		defaultTaxCode: text('default_tax_code'),
	},
	(t) => [primaryKey({ columns: [t.companyId, t.number] })],
);

export const openingBalances = pgTable(
	'opening_balances',
	{
		companyId: companyId().references(() => companies.id),
		fiscalYearId: uuid('fiscal_year_id')
			.notNull()
			.references(() => fiscalYears.id),
		account: text('account').notNull(),
		amount: minor('amount').notNull(),
	},
	(t) => [primaryKey({ columns: [t.fiscalYearId, t.account] })],
);

export const voucherSeries = pgTable(
	'voucher_series',
	{
		companyId: companyId().references(() => companies.id),
		code: text('code').notNull(),
		name: text('name').notNull(),
	},
	(t) => [primaryKey({ columns: [t.companyId, t.code] })],
);

export const voucherCounters = pgTable(
	'voucher_counters',
	{
		companyId: companyId().references(() => companies.id),
		fiscalYearId: uuid('fiscal_year_id')
			.notNull()
			.references(() => fiscalYears.id),
		series: text('series').notNull(),
		lastNumber: integer('last_number').notNull().default(0),
	},
	(t) => [primaryKey({ columns: [t.fiscalYearId, t.series] })],
);

// --- Vouchers (verifikationer) ------------------------------------------------------------------

export const vouchers = pgTable(
	'vouchers',
	{
		id: id(),
		companyId: companyId().references(() => companies.id),
		fiscalYearId: uuid('fiscal_year_id')
			.notNull()
			.references(() => fiscalYears.id),
		status: text('status', { enum: ['draft', 'booked'] }).notNull(),
		series: text('series').notNull(),
		/** Assigned when booked, gap-free per series and fiscal year. */
		number: integer('number'),
		date: date('date').notNull(),
		description: text('description').notNull(),
		correctsVoucherId: uuid('corrects_voucher_id'),
		source: text('source').notNull().default('manual'),
		createdAt: createdAt(),
		createdBy: jsonb('created_by').$type<Actor>().notNull(),
		bookingSeq: integer('booking_seq'),
		bookedAt: timestamp('booked_at', { withTimezone: true }),
		bookedBy: jsonb('booked_by').$type<Actor>(),
		prevHash: text('prev_hash'),
		hash: text('hash'),
	},
	(t) => [
		uniqueIndex('vouchers_number').on(t.fiscalYearId, t.series, t.number),
		uniqueIndex('vouchers_booking_seq').on(t.companyId, t.bookingSeq),
	],
);

export const voucherLines = pgTable('voucher_lines', {
	id: id(),
	companyId: companyId(),
	voucherId: uuid('voucher_id')
		.notNull()
		.references(() => vouchers.id, { onDelete: 'cascade' }),
	lineNo: integer('line_no').notNull(),
	account: text('account').notNull(),
	amount: minor('amount').notNull(),
	description: text('description'),
	taxCode: text('tax_code'),
	costCenter: text('cost_center'),
	project: text('project'),
	quantity: numeric('quantity'),
	foreignAmount: minor('foreign_amount'),
	foreignCurrency: text('foreign_currency'),
});

// --- Behandlingshistorik and agent plumbing -----------------------------------------------------

/** Append-only: a trigger rejects UPDATE and DELETE. */
export const auditEvents = pgTable('audit_events', {
	id: bigserial('id', { mode: 'number' }).primaryKey(),
	companyId: uuid('company_id'),
	at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
	actor: jsonb('actor').$type<Actor & { onBehalfOf?: string }>().notNull(),
	operation: text('operation').notNull(),
	targetType: text('target_type'),
	targetId: text('target_id'),
	data: jsonb('data'),
});

export const idempotencyKeys = pgTable(
	'idempotency_keys',
	{
		principal: text('principal').notNull(),
		key: text('key').notNull(),
		operation: text('operation').notNull(),
		requestHash: text('request_hash').notNull(),
		response: jsonb('response').notNull(),
		createdAt: createdAt(),
	},
	(t) => [primaryKey({ columns: [t.principal, t.key] })],
);
