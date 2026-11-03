# countx3 agent kit

Everything an AI coding agent needs to work in countx3.

- `.claude-plugin/` + `.mcp.json` + `skills/` — a Claude Code plugin: the `countx3` MCP server (via the CLI)
  and the `countx3-bookkeeping` skill.
- `AGENTS.md` — the same guidance for Codex and other agents that read AGENTS.md.

## Claude Code

Remote (no CLI needed):

```bash
claude mcp add --transport http countx3 https://<server>/mcp --header "Authorization: Bearer cx3_…"
```

Local, via the CLI (the plugin's `.mcp.json` does this): set `COUNTX3_URL`, `COUNTX3_TOKEN` and
`COUNTX3_COMPANY` in the environment and run `claude` — the `countx3` tools appear as `mcp__countx3__*`.

## Codex

See `AGENTS.md`.

Tokens are created by a person in the app (**Agents**) or with `countx3 tokens create` while signed in;
agents can never create tokens themselves.
