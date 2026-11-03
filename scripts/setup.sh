#!/usr/bin/env bash
# One-time local setup: `bun run setup`. Installs dependencies, makes sure Postgres 18 is running
# (installing it with Homebrew on macOS if needed), creates the local databases, and seeds demo data.
# Safe to run again.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v psql >/dev/null && command -v brew >/dev/null; then
	PG_BIN="$(brew --prefix postgresql@18 2>/dev/null)/bin"
	[ -x "$PG_BIN/psql" ] || brew install postgresql@18
	export PATH="$(brew --prefix postgresql@18)/bin:$PATH"
fi
if ! command -v psql >/dev/null; then
	echo "Postgres 18 is required. Install it (https://www.postgresql.org/download/) and run this again." >&2
	exit 1
fi
if ! pg_isready -q -h localhost; then
	if command -v brew >/dev/null; then
		brew services start postgresql@18
		for _ in $(seq 1 20); do pg_isready -q -h localhost && break; sleep 0.5; done
	fi
	pg_isready -q -h localhost || { echo "Postgres is installed but not running on localhost:5432." >&2; exit 1; }
fi

bun install
bash scripts/setup_local_db.sh
bun run --cwd apps/web i18n
bun scripts/seed_dev.ts

echo
echo "Setup done. Start the app with: bun run dev   (then open http://localhost:5173)"
