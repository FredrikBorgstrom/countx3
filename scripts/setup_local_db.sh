#!/usr/bin/env bash
# Creates the local roles and databases (dev + test) and runs migrations.
# Requires a local Postgres 18 where the current OS user is a superuser (Homebrew default).
set -euo pipefail

ADMIN_URL="${ADMIN_DATABASE_URL:-postgres://localhost/postgres}"

psql "$ADMIN_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
	IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'countx3_owner') THEN
		CREATE ROLE countx3_owner LOGIN PASSWORD 'countx3_owner';
	END IF;
	IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'countx3_app') THEN
		CREATE ROLE countx3_app LOGIN PASSWORD 'countx3_app' NOSUPERUSER NOBYPASSRLS;
	END IF;
END $$;
SQL

for db in countx3_dev countx3_test; do
	if ! psql "$ADMIN_URL" -tAc "SELECT 1 FROM pg_database WHERE datname = '$db'" | grep -q 1; then
		psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE $db OWNER countx3_owner"
	fi
	DATABASE_OWNER_URL="postgres://countx3_owner:countx3_owner@localhost/$db" bun --cwd "$(dirname "$0")/../packages/db" src/migrate.ts
done
echo "Local databases ready."
