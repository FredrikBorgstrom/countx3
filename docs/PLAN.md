# countx3 — agent-native accounting SaaS (Sweden first)

## Context

A public, multi-tenant accounting SaaS for Swedish small businesses (AB + enskild firma), later other western countries. It must cover the full bookkeeping cycle (bills/receipts, invoicing, bank, VAT, payroll, year-end/annual report) and run with equal capability on web, iOS, Android, macOS and Windows. The differentiator: Claude Code and Codex can drive it as fully as a human. Competitors already ship MCP servers (Spiris beta, Xero, QuickBooks; Fortnox only via third parties), so "has an MCP" is not enough — countx3 must be _agent-native_: full parity, safe plan/apply changesets, sandboxes, explainable reports.

Decided: TypeScript everywhere · Svelte 5 + SvelteKit · Hono + Zod on Bun · v1 modules include AI receipt reading, open-banking feed, Peppol, payroll + AGI.

## Stack

- **UI (one codebase):** SvelteKit (adapter-static SPA), Svelte 5 runes, TanStack Query/Table/Virtual, Bits UI primitives, Paraglide i18n (sv + en from day one, no hardcoded strings).
- **Mobile:** Capacitor wrapping the web build — document scanner/camera, share-sheet import of PDFs, push (approve agent changesets), biometrics, secure token storage, offline upload queue for receipts.
- **Desktop:** Tauri 2 wrapping the same build — file drag-drop, notifications, deep links.
- **API:** Hono on Bun, `@hono/zod-openapi`; Postgres 18 with Drizzle (SQL-first for reports, RLS policies in schema); pg-boss job queue (no Redis needed); S3-compatible EU object storage with object-lock for archived documents.
- **Auth:** Better Auth — passkeys/email + BankID via a broker (Criipto/Signicat), OAuth 2.1 provider for MCP clients, device-code flow for the CLI, scoped personal/agent tokens.
- **AI built-in:** Claude API (`claude-haiku-5-5` for extraction, `claude-sonnet-5-5` fallback on low confidence).
- **Hosting:** EU/Sweden (GDPR), separate staging. Never test against production.

## Repository layout (Bun workspaces)

```
apps/api          Hono: REST, /mcp (Streamable HTTP), OAuth, webhooks
apps/worker       pg-boss jobs: AI extraction, bank sync, filings, email, PDF
apps/web          SvelteKit SPA — the only UI
apps/mobile       Capacitor shell + native plugins
apps/desktop      Tauri 2 shell
apps/cli          `countx3` CLI (bun build --compile), also `countx3 mcp` (stdio)
packages/core     pure domain: Money (bigint öre), ledger, vouchers, validation, VAT engine, reports — no I/O
packages/contracts operation registry (see below)
packages/db       Drizzle schema, migrations, RLS
packages/formats  SIE 4, camt.053/054, pain.001, Peppol BIS 3 UBL, iXBRL writer, PDF
packages/jurisdictions/se  BAS 2026 template, tax codes, momsdeklaration mapping, K2, INK2, NE, AGI, OCR-nr/bankgiro validation, deadlines
packages/sdk      typed client generated from the registry (used by web + CLI)
packages/agent-kit Claude Code plugin (skills), AGENTS.md for Codex, MCP prompts/resources
```

## Core design

- **Ledger:** companies (tenants, RLS on `company_id`), fiscal years, periods, accounts, voucher series, vouchers + lines. Money as bigint minor units + currency; FX from Riksbanken.
- **BFL compliance:** drafts are editable; _booked_ vouchers are append-only — corrections are new correction vouchers referencing the original (BFL 5:5, BFNAR 2013:2 2.17). Drafts must be locked by the booking deadline (50 days after month/quarter end). Every voucher carries the 5:6–7 fields. Hash chain over booked vouchers for tamper evidence. Full event log = behandlingshistorik (who/what/when, human or agent). Archive 7 years after FY end; paper originals may be discarded after digitisation (SFS 2024:342). Ship a systemdokumentation.
- **Jurisdiction packs:** core never mentions Sweden. A `JurisdictionPack` interface supplies chart templates, date-effective tax codes and rates (e.g. food 6 % 2026-04-01 → 2027-12-31), VAT report mapping, annual-report/iXBRL taxonomy, tax returns, e-invoice profile, payroll rules, booking deadlines, archive rules. Next countries plug in here (Norway SAF-T/EHF and Germany GoBD/XRechnung shape the interface).

## Agent-native interface (the differentiator)

1. **One operation registry** (`packages/contracts`): each operation = name (`vouchers.create`), Zod input/output, scope (`ledger:write`), mutating flag, description, examples. REST/OpenAPI, MCP tools, CLI commands and the SDK are all generated from it; a parity test fails CI if any surface is missing an operation. The UI uses the same API, so anything a human can do an agent can do — except human-only steps (BankID signing, approving above-limit changesets, final submission at Skatteverket).
2. **Changesets (plan/apply):** agents propose a batch (vouchers, invoices, matches); `plan` returns validation + ledger/VAT impact diff; `apply` books it. Policies per token decide auto-apply (e.g. receipts < 5 000 SEK on allowed accounts) vs. push-notification approval in the app. Undo = auto-generated reversal changeset.
3. **Safety primitives:** `dryRun` on every mutation, idempotency keys, scoped tokens per agent, agent identity in the audit log, period locks, stable error codes with remediation hints.
4. **Sandboxes:** `countx3 sandbox create --from <company>` clones a company for experiments; a seeded demo company for evals.
5. **Read power:** `ledger.query` = read-only SQL over curated views (read-only role, RLS, timeout); `explain` ops (e.g. which transactions make up VAT box 05).
6. **Domain context:** MCP resources for chart of accounts, tax codes, company settings, a Swedish "how to book X" guide; skills shipped as a Claude Code plugin + AGENTS.md for Codex.
7. **Events:** webhooks and `countx3 watch` (SSE) so agents react to new documents, bank transactions, approvals.
8. **Access paths:** remote MCP with OAuth (Claude Code, Codex, claude.ai), local CLI with `--json`, `countx3 mcp` stdio, REST.

## Feature modules

- **Documents inbox:** upload (web, mobile scan, share sheet, per-company email-in address, CLI/MCP) → AI extraction → suggested voucher with account + VAT code, learns per supplier.
- **Customer invoicing:** customers, articles, invoices/credit notes, OCR reference (Luhn), PDF, email, reminders/interest, payment matching; Peppol send.
- **Supplier invoices:** bills, attest/approval, pain.001 payment files (Bankgirot LB is phased out by end of 2026 — ISO 20022 only).
- **Bank:** camt.053/CSV import + open-banking aggregator (Tink or Enable Banking); rule + AI reconciliation.
- **VAT:** momsdeklaration from the ledger, draft upload via Skatteverket _API Momsdeklaration_ (user signs at Skatteverket); periodisk sammanställning as SKV 278 file.
- **Year-end:** bokslut wizard (accruals, asset register/depreciation, periodiseringsfond, tax), K2 årsredovisning → iXBRL → Bolagsverket filing; INK2 via Skatteverket API; enskild firma: förenklat årsbokslut + NE-bilaga (file). K3 later.
- **Payroll:** employees, monthly/hourly pay, tax tables, arbetsgivaravgifter incl. reductions, vacation basics, payslips, payroll vouchers, AGI via Skatteverket API. No collective agreements in v1.
- **Reports:** balans, resultat, huvudbok, verifikationslista, reskontra, dashboard. SIE 4 import/export (onboarding from Fortnox/Spiris/Bokio).
- **SaaS:** onboarding, roles (owner, accountant/byrå, auditor read-only), multi-company, Stripe billing.

## Milestones

- **M0 Foundation:** git init, workspaces, CI, auth, tenancy/RLS, operation registry → REST + MCP + CLI + SDK, SvelteKit shell building inside Capacitor (iOS/Android) and Tauri (macOS/Windows).
- **M1 Ledger:** BAS chart, fiscal years, vouchers, immutability + hash chain, audit log, reports, SIE 4 import/export.
- **M2 Agent layer + documents:** changesets/approvals, sandboxes, query/explain, agent-kit; documents inbox + AI extraction.
- **M3** customer + supplier invoicing · **M4** bank feed + reconciliation + payments · **M5** VAT + Skatteverket API · **M6** year-end AB/EF + Bolagsverket/INK2 · **M7** Peppol · **M8** payroll + AGI · **M9** launch (billing, store releases, systemdokumentation, security review/pen test).

After approval, execution starts with M0, then M1.

## Non-code prerequisites (long lead time)

Skatteverket agreements (Momsdeklaration, Inkomstdeklaration 2–4, AGI APIs) · Bolagsverket iXBRL filing vendor access · BAS licence question to info@bas.se (machine-readable JSON costs SEK 4 000) · SIE-Gruppen membership for certification · Peppol access-point provider contract · open-banking aggregator + legal opinion on PSD2 AISP licensing · BankID broker · GDPR DPA template.

## Verification

- `packages/core`: property tests (debits = credits, booked immutability, hash-chain verification, date-effective VAT rates); golden scenario fixtures for every momsdeklaration box.
- Formats: SIE round-trip + sietest.sie.se; iXBRL against Bolagsverket test environment; moms/INK2/AGI against Skatteverket test environments; Peppol validation artefacts.
- Parity test: every registry operation reachable via REST, MCP and CLI.
- Agent eval suite: headless `claude -p` and `codex exec` against a sandbox company with the MCP server (e.g. "book these 20 receipts", "prepare Q3 VAT") — assert resulting ledger.
- Playwright e2e on web; smoke runs in iOS simulator, Android emulator and Tauri builds — all against local/staging backends only.
