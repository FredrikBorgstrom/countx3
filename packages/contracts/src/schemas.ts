import { z } from 'zod';
import { roles, scopes } from './registry.ts';

export const Amount = z
	.string()
	.regex(/^-?\d+(\.\d{1,2})?$/, 'Use a decimal string with at most two decimals, e.g. "1250.00"')
	.describe('Decimal amount as a string, e.g. "1250.00".');

export const SignedAmount = Amount.describe(
	'Decimal string in accounting currency. Positive = debit, negative = credit.',
);

export const LocalDate = z.iso.date().describe('Calendar date, YYYY-MM-DD.');

export const Id = z.uuid();

export const ActorSchema = z.object({
	type: z.enum(['user', 'agent', 'system']),
	id: z.string(),
	name: z.string(),
	client: z.string().optional(),
});

export const ScopeSchema = z.enum(scopes);
export const RoleSchema = z.enum(roles);
export const LegalFormSchema = z
	.enum(['AB', 'EF'])
	.describe('AB = aktiebolag, EF = enskild firma (sole trader).');
export const AccountTypeSchema = z.enum(['asset', 'liability', 'equity', 'income', 'expense']);

export const AccountNumber = z.string().regex(/^\d{3,10}$/, 'Account numbers are digits, e.g. "1930"');

export const VoucherLineInput = z.object({
	account: AccountNumber,
	amount: SignedAmount,
	description: z.string().max(200).optional(),
	taxCode: z.string().max(20).optional().describe('Tax code, e.g. "IP1"; see taxCodes.list.'),
	costCenter: z.string().max(40).optional(),
	project: z.string().max(40).optional(),
	quantity: z.number().optional(),
	foreignAmount: Amount.optional().describe(
		'Original amount when the transaction was in a foreign currency.',
	),
	foreignCurrency: z.string().length(3).optional(),
});

export const VoucherLine = VoucherLineInput.extend({ lineNo: z.number().int() });

export const Voucher = z.object({
	id: Id,
	status: z.enum(['draft', 'booked']),
	series: z.string(),
	number: z.number().int().nullable(),
	/** e.g. "A12"; null for drafts. */
	ref: z.string().nullable(),
	fiscalYearId: Id,
	date: LocalDate,
	description: z.string(),
	correctsVoucherId: Id.nullable(),
	source: z.string(),
	createdAt: z.string(),
	createdBy: ActorSchema,
	bookedAt: z.string().nullable(),
	bookedBy: ActorSchema.nullable(),
	hash: z.string().nullable(),
	lines: z.array(VoucherLine),
});

export const FiscalYear = z.object({ id: Id, start: LocalDate, end: LocalDate, closed: z.boolean() });

export const Company = z.object({
	id: Id,
	name: z.string(),
	country: z.string(),
	legalForm: LegalFormSchema,
	organizationNumber: z.string(),
	currency: z.string(),
	smallCompany: z.boolean(),
	lockedThrough: LocalDate.nullable(),
	role: RoleSchema,
	fiscalYears: z.array(FiscalYear),
});

export const Account = z.object({
	number: AccountNumber,
	name: z.string(),
	type: AccountTypeSchema,
	active: z.boolean(),
	defaultTaxCode: z.string().nullable(),
});

export const Issue = z.object({
	code: z.string(),
	message: z.string(),
	hint: z.string().optional(),
	path: z.string().optional(),
});

export const ErrorBody = z.object({
	code: z.string().describe('Stable machine-readable error code.'),
	message: z.string(),
	hint: z.string().optional().describe('What to do to fix it.'),
	issues: z.array(Issue).optional(),
});
