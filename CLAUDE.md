# Working on countx3

- Use **bun** / `bunx` (never npm/npx). Tests: `bun test`; types: `bun run typecheck`; lint: `bun run lint`.
- Tests and manual runs use the local databases (`countx3_dev`, `countx3_test`) and the local API only.
  Never point tests, the seed script or the apps at production.

## Architecture rules

- **Every capability is an operation** in `packages/contracts/src/operations/*`. Add the definition there
  and its handler in `apps/api/src/handlers/*`; REST, OpenAPI, MCP, CLI and the SDK pick it up automatically.
  The `Handlers` type makes a missing handler a compile error, and the API/CLI tests check every surface.
- Descriptions on operations are written for agents: say when to use it, what it changes, what comes next.
- Errors are `DomainError(code, message, { hint, issues })` with stable codes; never throw bare strings.
- Money is `bigint` minor units inside the system and decimal strings ("1250.00") on the wire. Never floats.
- Country specifics live in a `JurisdictionPack` (`packages/jurisdictions/*`); `packages/core` never names a country.
- Booked vouchers are immutable and the audit log is append-only — enforced by triggers and RLS in
  `packages/db/drizzle/0001_security.sql`. Do not work around them; corrections are new vouchers.
- Schema changes: edit `packages/db/src/schema.ts`, run `bun run db:generate`, then `bun run db:setup:local`.
  Security (RLS, triggers, grants) goes in hand-written SQL migrations (`drizzle-kit generate --custom`).
- All user-facing text in the web app is translatable: add keys to `apps/web/messages/{sv,en}.json`.
- The web app is a static SPA; anything platform-specific must degrade gracefully in a plain browser.
