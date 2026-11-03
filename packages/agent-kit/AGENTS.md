# countx3 for Codex (and other agents that read AGENTS.md)

Copy this file into the project where your agent works, or reference it from your own AGENTS.md.

## Connect

Install the `countx3` CLI, then add it as a stdio MCP server in `~/.codex/config.toml`:

```toml
[mcp_servers.countx3]
command = "countx3"
args = ["mcp"]
env = { COUNTX3_URL = "https://<your countx3 server>", COUNTX3_TOKEN = "cx3_…", COUNTX3_COMPANY = "<company id>" }
```

Create the token in the countx3 app under **Agents** (choose "Bookkeeping assistant" to let the agent
create drafts only, or "Bookkeeper" to let it book). Without MCP, the same operations work as shell
commands: `countx3 vouchers create --input voucher.json`, `countx3 reports trial-balance --from … --to …`.

## How to do bookkeeping here

Follow `skills/countx3-bookkeeping/SKILL.md` in this kit. In short:

- Call `me_get` first; look up accounts (`accounts_list`) and VAT codes (`taxCodes_list`) instead of guessing.
- Amounts are decimal strings; positive = debit, negative = credit; lines sum to zero.
- Validate with `dryRun: true`, then create. Use an `idempotencyKey` per source document.
- Booked vouchers are permanent: correct them with `vouchers_correct`, never by editing.
- If you are unsure how to book something, leave a draft and tell the user why.
