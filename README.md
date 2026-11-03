# countx3

Accounting for small businesses — Swedish rules first — that people **and AI coding agents** (Claude Code,
Codex) can run equally well. One TypeScript codebase serves the web, iOS, Android, macOS and Windows apps,
and every capability is one operation that is automatically available over REST, MCP and the CLI.

See [docs/PLAN.md](docs/PLAN.md) for the product plan and milestones. Status: **M0 (foundation) and
M1 (ledger) are built**; documents, invoicing, bank, VAT returns, year-end, Peppol and payroll follow.

## Layout

| Path                        | What                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `packages/core`             | Pure domain: money as bigint öre, vouchers, validation, hash chain, reports. No I/O.                                           |
| `packages/jurisdictions/se` | Sweden: BAS starter charts, VAT codes (date-effective), ID-number/OCR checks, BFL rules, K2 layouts.                           |
| `packages/contracts`        | The operation registry (Zod). REST, OpenAPI, MCP tools, CLI and SDK are generated from it.                                     |
| `packages/db`               | Drizzle schema + migrations. Row-level security, immutable booked vouchers and append-only audit log are enforced in Postgres. |
| `packages/formats`          | SIE 4 reader/writer (PC8). Later: camt.053, pain.001, Peppol, iXBRL.                                                           |
| `packages/sdk`              | Typed client used by the web app and CLI.                                                                                      |
| `packages/agent-kit`        | Claude Code plugin + skill, AGENTS.md for Codex.                                                                               |
| `apps/api`                  | Hono on Bun: `POST /v1/ops/{name}`, `/v1/openapi.json`, `/mcp` (Streamable HTTP).                                              |
| `apps/cli`                  | `countx3` CLI; `countx3 mcp` is a stdio MCP server.                                                                            |
| `apps/web`                  | SvelteKit SPA (Svelte 5, Paraglide sv/en) — the only UI.                                                                       |
| `apps/mobile`               | Capacitor iOS/Android shells around the web build.                                                                             |
| `apps/desktop`              | Tauri 2 macOS/Windows shell around the web build.                                                                              |

## Run it locally

You need [Bun](https://bun.sh) ≥ 1.4 (`curl -fsSL https://bun.sh/install | bash`). On macOS, setup installs and
starts Postgres 18 with Homebrew if it is missing; elsewhere install Postgres 18 yourself first.

```bash
bun run setup   # dependencies, Postgres roles + databases + migrations, demo company (safe to re-run)
bun run dev     # API on http://localhost:8787 and web app on http://localhost:5173
```

Open http://localhost:5173 and log in as `demo@countx3.test` (the local-only password is in
[scripts/seed_dev.ts](scripts/seed_dev.ts)), or create your own account.

The native apps use the same build and talk to the local API, so keep `bun run dev` running:

| Command           | Needs                                                              | What it does                                                    |
| ----------------- | ------------------------------------------------------------------ | --------------------------------------------------------------- |
| `bun run desktop` | [Rust](https://rustup.rs) (`curl https://sh.rustup.rs -sSf \| sh`) | Builds and opens the macOS/Windows app (Tauri) in dev mode      |
| `bun run ios`     | Xcode + an iOS simulator                                           | Builds the web app, syncs Capacitor and runs it on a simulator  |
| `bun run android` | Android Studio (SDK + an emulator)                                 | Same for Android; forwards the emulator's port 8787 to your Mac |

## Checks

```bash
bun test            # domain, Swedish rules, SIE, database guards, API (REST + MCP), CLI (incl. stdio MCP)
bun run typecheck   # tsc for packages/apps + svelte-check for the web app
bun run lint
```

## Contributing

Issues and pull requests are welcome. Run `bun test`, `bun run typecheck` and `bun run lint` before opening a
PR; CI runs the same checks. [CLAUDE.md](CLAUDE.md) describes the architecture rules (they apply to humans
too).

## Agents

Create a token in the app under **Agents** (or `countx3 tokens create` while signed in), then:

```bash
claude mcp add --transport http countx3 http://localhost:8787/mcp --header "Authorization: Bearer cx3_…"
```

Codex and other stdio clients use `countx3 mcp` — see `packages/agent-kit`.

## License

[AGPL-3.0](LICENSE). You may run, modify and host countx3, but if you offer a modified version to users over a
network you must publish your changes under the same license.
