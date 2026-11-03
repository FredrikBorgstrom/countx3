---

name: countx3-bookkeeping
description: Do Swedish bookkeeping in countx3 — book receipts and invoices, correct vouchers, check reports and VAT, import or export SIE. Use whenever the user asks to book, record, categorise, reconcile or report on a company's accounts in countx3.
---

# Bookkeeping in countx3

countx3 is double-entry bookkeeping (Swedish rules: Bokföringslagen, BAS accounts, Swedish VAT).
You reach it through the `countx3` MCP tools, or the `countx3` CLI with the same operations
(`countx3 ops` lists them, `countx3 <group> <action> --help` explains one).

## Start of every session

1. `me_get` — your scopes and companies. If you lack `ledger:book`, you can only create drafts; say so.
2. Pick the company (`companyId`). The CLI and stdio MCP use `COUNTX3_COMPANY` as default.
3. `accounts_list` and `taxCodes_list` before choosing accounts or VAT codes. Never guess an account number.

## Rules that are never broken

- Amounts are decimal strings ("1250.00"). Line amounts: positive = debit, negative = credit. Lines sum to zero.
- Every voucher needs the transaction date (not today's date) and a description of what it concerns.
- Booked vouchers are permanent. Never try to update or delete them; use `vouchers_correct`
  (it books a reversal and, optionally, the corrected voucher).
- Validate first: call the mutation with `dryRun: true`, read the issues, fix, then call it for real.
- Use an `idempotencyKey` derived from the source document (e.g. the receipt file hash or invoice number),
  so a retry never books twice.
- When unsure about the right account or VAT treatment, create a draft and explain the doubt to the user
  instead of booking.

## Common Swedish patterns (company pays from 1930)

| Transaction                                             | Lines                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Purchase with 25 % VAT, paid by card                    | expense account (e.g. 6110, 5410, 6540) +net · 2641 +VAT · 1930 −gross       |
| Purchase with 12 % VAT (hotel, food for representation) | expense +net · 2641 +VAT · 1930 −gross                                       |
| Purchase without VAT (bank fee 6570, insurance 6310)    | expense +amount · 1930 −amount                                               |
| Sale with 25 % VAT, paid directly                       | 1930 +gross · 3001 −net · 2611 −VAT                                          |
| Customer invoice sent                                   | 1510 +gross · 3001 −net · 2611 −VAT; when paid: 1930 +gross · 1510 −gross    |
| Supplier invoice received                               | expense +net · 2641 +VAT · 2440 −gross; when paid: 2440 +gross · 1930 −gross |
| EU service purchase (reverse charge)                    | 4535 +net · 2645 +25 % · 2614 −25 % · 1930 −net                              |

VAT included in a gross amount at 25 % is gross × 0.2; at 12 % gross × 12/112; at 6 % gross × 6/106.
Round to öre. Food is 6 % from 2026-04-01 to 2027-12-31 (tax code MPL); restaurant services stay 12 %.

## Useful checks

- `reports_trialBalance`, `reports_incomeStatement`, `reports_balanceSheet` after a batch of bookings.
- `vouchers_list` with `status: "draft"` to see what still needs a human to book.
- `ledger_verify` proves the hash chain of booked vouchers is intact.
- Errors carry a stable `code`, a `hint` and per-field `issues`; act on them rather than retrying blindly.
