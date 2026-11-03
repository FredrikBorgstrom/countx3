/** Server instructions sent to MCP clients; also the core of the agent skill. */
export const AGENT_INSTRUCTIONS = `countx3 is a double-entry bookkeeping system (Swedish rules first).
- Start with me_get to see your scopes and companies; every company tool needs companyId.
- Amounts are decimal strings in the company currency ("1250.00"). On voucher lines positive = debit, negative = credit, and lines must sum to zero.
- vouchers_create saves a draft by default. Booked vouchers are permanent (Bokföringslagen): never try to edit them, use vouchers_correct.
- Every mutation accepts dryRun: true to validate and preview without saving, and idempotencyKey to make retries safe.
- Errors have a stable code, a hint and per-field issues; fix the input and retry.
- Look up accounts with accounts_list and VAT codes with taxCodes_list rather than guessing.`;
