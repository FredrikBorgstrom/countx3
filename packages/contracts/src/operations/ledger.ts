import { z } from 'zod';
import { defineOperation } from '../registry.ts';
import {
	AccountNumber,
	ActorSchema,
	Amount,
	FiscalYear,
	Id,
	LocalDate,
	Voucher,
	VoucherLineInput,
} from '../schemas.ts';

const VoucherBody = {
	series: z.string().min(1).max(10).default('A').describe('Voucher series; see series.list.'),
	date: LocalDate.describe('Transaction date (affärshändelsens datum).'),
	description: z
		.string()
		.min(1)
		.max(500)
		.describe('What the transaction concerns, e.g. "Kontorsmaterial Clas Ohlson".'),
	lines: z
		.array(VoucherLineInput)
		.min(2)
		.describe('Debit lines positive, credit lines negative; must sum to zero.'),
};

export const vouchersCreate = defineOperation({
	name: 'vouchers.create',
	summary: 'Create a voucher',
	description:
		'Creates a voucher (verifikation). By default it is saved as an editable draft; pass `book: true` to book it immediately ' +
		'(needs ledger:book). Booked vouchers are permanent and can only be reversed with vouchers.correct. Use `dryRun` to validate first.',
	scope: 'ledger:write',
	kind: 'mutation',
	companyScoped: true,
	input: z.object({ ...VoucherBody, book: z.boolean().default(false) }),
	output: Voucher,
	examples: [
		{
			title: 'Office supplies paid by card, 25 % VAT',
			input: {
				date: '2026-03-10',
				description: 'Kontorsmaterial Clas Ohlson',
				lines: [
					{ account: '6110', amount: '800.00', taxCode: 'IP1' },
					{ account: '2641', amount: '200.00' },
					{ account: '1930', amount: '-1000.00' },
				],
			},
		},
	],
});

export const vouchersUpdate = defineOperation({
	name: 'vouchers.update',
	summary: 'Update a draft voucher',
	description: 'Changes a draft. Booked vouchers cannot be changed; use vouchers.correct.',
	scope: 'ledger:write',
	kind: 'mutation',
	companyScoped: true,
	input: z.object({
		voucherId: Id,
		series: VoucherBody.series.optional(),
		date: VoucherBody.date.optional(),
		description: VoucherBody.description.optional(),
		lines: VoucherBody.lines.optional(),
	}),
	output: Voucher,
});

export const vouchersDelete = defineOperation({
	name: 'vouchers.delete',
	summary: 'Delete a draft voucher',
	description: 'Deletes a draft. Booked vouchers can never be deleted.',
	scope: 'ledger:write',
	kind: 'mutation',
	companyScoped: true,
	input: z.object({ voucherId: Id }),
	output: z.object({ deleted: z.literal(true) }),
});

export const vouchersBook = defineOperation({
	name: 'vouchers.book',
	summary: 'Book a draft voucher',
	description:
		'Validates and books a draft: assigns the next number in its series and adds it to the tamper-evident hash chain.',
	scope: 'ledger:book',
	kind: 'mutation',
	companyScoped: true,
	input: z.object({ voucherId: Id }),
	output: Voucher,
});

export const vouchersCorrect = defineOperation({
	name: 'vouchers.correct',
	summary: 'Correct a booked voucher',
	description:
		'Books a correction (rättelseverifikation) that reverses a booked voucher, and optionally a replacement voucher with the right lines. ' +
		'This is the only way to change booked bookkeeping.',
	scope: 'ledger:book',
	kind: 'mutation',
	companyScoped: true,
	input: z.object({
		voucherId: Id,
		reason: z.string().min(1).max(300),
		date: LocalDate.optional().describe(
			'Date of the correction; defaults to the original date when that period is open.',
		),
		replacementLines: VoucherBody.lines.optional(),
	}),
	output: z.object({ reversal: Voucher, replacement: Voucher.nullable() }),
});

export const vouchersGet = defineOperation({
	name: 'vouchers.get',
	summary: 'Get a voucher',
	description:
		'One voucher with its lines, by id or by reference such as "A12" (in the fiscal year containing `date`, default latest).',
	scope: 'ledger:read',
	kind: 'query',
	companyScoped: true,
	input: z.object({ voucherId: Id.optional(), ref: z.string().optional(), date: LocalDate.optional() }),
	output: Voucher,
});

export const vouchersList = defineOperation({
	name: 'vouchers.list',
	summary: 'List vouchers',
	description:
		'Vouchers with lines (verifikationslista), newest first. Filter by date range, status, series, account or text.',
	scope: 'ledger:read',
	kind: 'query',
	companyScoped: true,
	input: z.object({
		from: LocalDate.optional(),
		to: LocalDate.optional(),
		status: z.enum(['draft', 'booked']).optional(),
		series: z.string().optional(),
		account: AccountNumber.optional(),
		search: z.string().optional(),
		limit: z.number().int().min(1).max(500).default(50),
		cursor: z.string().optional().describe('nextCursor from the previous page.'),
	}),
	output: z.object({ items: z.array(Voucher), nextCursor: z.string().nullable() }),
});

const Range = { from: LocalDate, to: LocalDate };
const ReportRow = z.object({
	key: z.string(),
	label: z.string(),
	amount: Amount,
	isTotal: z.boolean(),
	accounts: z.array(z.object({ account: z.string(), name: z.string(), amount: Amount })),
});

export const reportsTrialBalance = defineOperation({
	name: 'reports.trialBalance',
	summary: 'Trial balance',
	description:
		'Saldobalans for a date range within one fiscal year: opening balance, debit, credit and closing per account.',
	scope: 'ledger:read',
	kind: 'query',
	companyScoped: true,
	input: z.object(Range),
	output: z.object({
		fiscalYear: FiscalYear,
		rows: z.array(
			z.object({
				account: z.string(),
				name: z.string(),
				opening: Amount,
				debit: Amount,
				credit: Amount,
				closing: Amount,
			}),
		),
	}),
});

export const reportsIncomeStatement = defineOperation({
	name: 'reports.incomeStatement',
	summary: 'Income statement',
	description: 'Resultaträkning for a date range within one fiscal year, with per-account detail.',
	scope: 'ledger:read',
	kind: 'query',
	companyScoped: true,
	input: z.object(Range),
	output: z.object({ title: z.string(), from: LocalDate, to: LocalDate, rows: z.array(ReportRow) }),
});

export const reportsBalanceSheet = defineOperation({
	name: 'reports.balanceSheet',
	summary: 'Balance sheet',
	description: 'Balansräkning at a date.',
	scope: 'ledger:read',
	kind: 'query',
	companyScoped: true,
	input: z.object({ date: LocalDate }),
	output: z.object({ title: z.string(), date: LocalDate, rows: z.array(ReportRow) }),
});

export const reportsGeneralLedger = defineOperation({
	name: 'reports.generalLedger',
	summary: 'General ledger',
	description:
		'Huvudbok: every entry per account with running balance. Limit to some accounts with `accounts`.',
	scope: 'ledger:read',
	kind: 'query',
	companyScoped: true,
	input: z.object({ ...Range, accounts: z.array(AccountNumber).optional() }),
	output: z.object({
		accounts: z.array(
			z.object({
				account: z.string(),
				name: z.string(),
				opening: Amount,
				closing: Amount,
				lines: z.array(
					z.object({
						date: LocalDate,
						voucherId: Id,
						voucherRef: z.string(),
						description: z.string(),
						amount: Amount,
						balance: Amount,
					}),
				),
			}),
		),
	}),
});

export const ledgerVerify = defineOperation({
	name: 'ledger.verify',
	summary: 'Verify the hash chain',
	description: 'Recomputes the hash chain over all booked vouchers to prove nothing has been altered.',
	scope: 'ledger:read',
	kind: 'query',
	companyScoped: true,
	input: z.object({}),
	output: z.object({
		intact: z.boolean(),
		bookedVouchers: z.number().int(),
		head: z.string(),
		break: z.object({ bookingSeq: z.number().int(), voucherId: Id, reason: z.string() }).nullable(),
	}),
});

export const auditList = defineOperation({
	name: 'audit.list',
	summary: 'Audit log',
	description: 'Behandlingshistorik: who (human or agent) did what and when, newest first.',
	scope: 'company:read',
	kind: 'query',
	companyScoped: true,
	input: z.object({
		limit: z.number().int().min(1).max(500).default(100),
		before: z.number().int().optional().describe('Return events with id below this (pagination).'),
	}),
	output: z.object({
		items: z.array(
			z.object({
				id: z.number().int(),
				at: z.string(),
				actor: ActorSchema.extend({ onBehalfOf: z.string().optional() }),
				operation: z.string(),
				targetType: z.string().nullable(),
				targetId: z.string().nullable(),
				data: z.unknown(),
			}),
		),
	}),
});

export const sieExport = defineOperation({
	name: 'sie.export',
	summary: 'Export SIE 4',
	description:
		'Exports a fiscal year as an SIE 4 file (the Swedish standard for moving bookkeeping between systems and to auditors).',
	scope: 'ledger:read',
	kind: 'query',
	companyScoped: true,
	input: z.object({ fiscalYearId: Id.optional().describe('Defaults to the latest fiscal year.') }),
	output: z.object({
		fileName: z.string(),
		contentBase64: z.string().describe('The exact file bytes (PC8 / CP437 encoded).'),
		text: z.string().describe('The same content decoded, for reading.'),
	}),
});

export const sieImport = defineOperation({
	name: 'sie.import',
	summary: 'Import SIE 4',
	description:
		'Imports accounts, opening balances and vouchers from an SIE 4 file into a fiscal year that has no booked vouchers yet ' +
		'(e.g. when moving from Fortnox, Spiris or Bokio). Imported vouchers are booked.',
	scope: 'ledger:book',
	kind: 'mutation',
	companyScoped: true,
	input: z.object({ contentBase64: z.string().describe('The SIE file bytes, base64 encoded.') }),
	output: z.object({
		fiscalYear: FiscalYear,
		accountsCreated: z.number().int(),
		openingBalances: z.number().int(),
		vouchersBooked: z.number().int(),
		warnings: z.array(z.string()),
	}),
});
