import { z } from 'zod';
import { defineOperation } from '../registry.ts';
import {
	Account,
	AccountNumber,
	AccountTypeSchema,
	Amount,
	Company,
	FiscalYear,
	Id,
	LegalFormSchema,
	LocalDate,
	RoleSchema,
	ScopeSchema,
} from '../schemas.ts';

export const meGet = defineOperation({
	name: 'me.get',
	summary: 'Who am I',
	description:
		'Returns the calling user or agent token, its effective scopes and the companies it can access. Call this first.',
	scope: 'authenticated',
	kind: 'query',
	companyScoped: false,
	input: z.object({}),
	output: z.object({
		principal: z.object({
			type: z.enum(['user', 'token']),
			userId: Id,
			name: z.string(),
			email: z.string(),
			tokenName: z.string().optional(),
			client: z.string().optional(),
		}),
		scopes: z.array(ScopeSchema),
		companies: z.array(z.object({ id: Id, name: z.string(), legalForm: LegalFormSchema, role: RoleSchema })),
	}),
});

const TokenInfo = z.object({
	id: Id,
	name: z.string(),
	client: z.string().nullable(),
	prefix: z.string(),
	scopes: z.array(ScopeSchema),
	companyId: Id.nullable(),
	createdAt: z.string(),
	lastUsedAt: z.string().nullable(),
	expiresAt: z.string().nullable(),
	revokedAt: z.string().nullable(),
});

export const tokensCreate = defineOperation({
	name: 'tokens.create',
	summary: 'Create an agent token',
	description:
		'Creates a scoped API token for an agent (Claude Code, Codex) or script. The secret is returned once. Only humans can create tokens.',
	scope: 'tokens:manage',
	kind: 'mutation',
	companyScoped: false,
	humanOnly: true,
	input: z.object({
		name: z.string().min(1).max(80),
		client: z.string().max(40).optional().describe('e.g. "claude-code" or "codex"'),
		scopes: z.array(ScopeSchema).min(1),
		companyId: Id.optional().describe('Restrict the token to one company.'),
		expiresInDays: z.number().int().min(1).max(3650).optional(),
	}),
	output: TokenInfo.extend({
		token: z.string().describe('The secret. Store it now; it cannot be shown again.'),
	}),
});

export const tokensList = defineOperation({
	name: 'tokens.list',
	summary: 'List my tokens',
	description: 'Lists the API tokens of the calling user, without secrets.',
	scope: 'tokens:manage',
	kind: 'query',
	companyScoped: false,
	input: z.object({}),
	output: z.object({ items: z.array(TokenInfo) }),
});

export const tokensRevoke = defineOperation({
	name: 'tokens.revoke',
	summary: 'Revoke a token',
	description: 'Revokes one of the calling user’s tokens immediately.',
	scope: 'tokens:manage',
	kind: 'mutation',
	companyScoped: false,
	input: z.object({ tokenId: Id }),
	output: z.object({ revoked: z.literal(true) }),
});

export const companiesCreate = defineOperation({
	name: 'companies.create',
	summary: 'Create a company',
	description:
		'Creates a company with its first fiscal year, a starter chart of accounts and the default voucher series. The caller becomes owner.',
	scope: 'company:admin',
	kind: 'mutation',
	companyScoped: false,
	input: z.object({
		name: z.string().min(1).max(200),
		legalForm: LegalFormSchema,
		organizationNumber: z
			.string()
			.describe('Organisationsnummer (AB) or personnummer (EF), e.g. "556677-8899".'),
		country: z.enum(['SE']).default('SE'),
		fiscalYear: z.object({ start: LocalDate, end: LocalDate }),
		smallCompany: z.boolean().default(true).describe('Net turnover normally at most 3 MSEK.'),
		chartTemplate: z.string().optional().describe('Defaults to the template for the legal form.'),
	}),
	output: Company,
	examples: [
		{
			title: 'Aktiebolag with calendar fiscal year',
			input: {
				name: 'Exempel AB',
				legalForm: 'AB',
				organizationNumber: '556036-0793',
				fiscalYear: { start: '2026-01-01', end: '2026-12-31' },
			},
		},
	],
});

export const companiesList = defineOperation({
	name: 'companies.list',
	summary: 'List companies',
	description: 'Lists the companies the caller can access, with the caller’s role in each.',
	scope: 'authenticated',
	kind: 'query',
	companyScoped: false,
	input: z.object({}),
	output: z.object({ items: z.array(Company.omit({ fiscalYears: true })) }),
});

export const companiesGet = defineOperation({
	name: 'companies.get',
	summary: 'Get a company',
	description: 'Company settings, lock date and fiscal years.',
	scope: 'company:read',
	kind: 'query',
	companyScoped: true,
	input: z.object({}),
	output: Company,
});

export const companiesUpdate = defineOperation({
	name: 'companies.update',
	summary: 'Update company settings',
	description: 'Changes the company name or size classification.',
	scope: 'company:admin',
	kind: 'mutation',
	companyScoped: true,
	input: z.object({ name: z.string().min(1).max(200).optional(), smallCompany: z.boolean().optional() }),
	output: Company,
});

export const periodsLock = defineOperation({
	name: 'periods.lock',
	summary: 'Lock periods',
	description:
		'Locks all dates up to and including `through`, so nothing more can be booked there (e.g. after filing VAT). A lock can only move forward.',
	scope: 'company:admin',
	kind: 'mutation',
	companyScoped: true,
	input: z.object({ through: LocalDate }),
	output: z.object({ lockedThrough: LocalDate }),
});

export const fiscalYearsList = defineOperation({
	name: 'fiscalYears.list',
	summary: 'List fiscal years',
	description: 'All fiscal years (räkenskapsår) of the company, newest first.',
	scope: 'company:read',
	kind: 'query',
	companyScoped: true,
	input: z.object({}),
	output: z.object({ items: z.array(FiscalYear) }),
});

export const fiscalYearsCreate = defineOperation({
	name: 'fiscalYears.create',
	summary: 'Create the next fiscal year',
	description:
		'Adds a fiscal year directly after the latest one. Validated against the local rules (12 months, month boundaries).',
	scope: 'company:admin',
	kind: 'mutation',
	companyScoped: true,
	input: z.object({ start: LocalDate, end: LocalDate }),
	output: FiscalYear,
});

export const accountsList = defineOperation({
	name: 'accounts.list',
	summary: 'List accounts',
	description: 'The chart of accounts (kontoplan). Use `search` to match number or name.',
	scope: 'ledger:read',
	kind: 'query',
	companyScoped: true,
	input: z.object({ search: z.string().optional(), includeInactive: z.boolean().default(false) }),
	output: z.object({ items: z.array(Account) }),
});

export const accountsCreate = defineOperation({
	name: 'accounts.create',
	summary: 'Create an account',
	description:
		'Adds an account to the chart. The type is derived from the number when omitted (BAS classes in Sweden).',
	scope: 'ledger:write',
	kind: 'mutation',
	companyScoped: true,
	input: z.object({
		number: AccountNumber,
		name: z.string().min(1).max(200),
		type: AccountTypeSchema.optional(),
		defaultTaxCode: z.string().optional(),
	}),
	output: Account,
});

export const accountsUpdate = defineOperation({
	name: 'accounts.update',
	summary: 'Update an account',
	description:
		'Renames, (de)activates or sets the default tax code of an account. Account numbers never change.',
	scope: 'ledger:write',
	kind: 'mutation',
	companyScoped: true,
	input: z.object({
		number: AccountNumber,
		name: z.string().min(1).max(200).optional(),
		active: z.boolean().optional(),
		defaultTaxCode: z.string().nullable().optional(),
	}),
	output: Account,
});

export const taxCodesList = defineOperation({
	name: 'taxCodes.list',
	summary: 'List tax codes',
	description: 'VAT codes of the company’s country with the rate in effect on `date` (default today).',
	scope: 'ledger:read',
	kind: 'query',
	companyScoped: true,
	input: z.object({ date: LocalDate.optional() }),
	output: z.object({
		date: LocalDate,
		items: z.array(
			z.object({
				code: z.string(),
				label: z.string(),
				kind: z.string(),
				ratePercent: z.string().nullable().describe('e.g. "25.00"; null when not in effect on the date.'),
				vatAccount: z.string().nullable(),
				inputVatAccount: z.string().nullable(),
			}),
		),
	}),
});

export const seriesList = defineOperation({
	name: 'series.list',
	summary: 'List voucher series',
	description: 'Voucher series (verifikationsserier), e.g. A = manual bookkeeping, D = supplier invoices.',
	scope: 'ledger:read',
	kind: 'query',
	companyScoped: true,
	input: z.object({}),
	output: z.object({ items: z.array(z.object({ code: z.string(), name: z.string() })) }),
});

export const openingBalancesGet = defineOperation({
	name: 'openingBalances.get',
	summary: 'Get opening balances',
	description: 'Ingående balanser of a fiscal year.',
	scope: 'ledger:read',
	kind: 'query',
	companyScoped: true,
	input: z.object({ fiscalYearId: Id }),
	output: z.object({ items: z.array(z.object({ account: AccountNumber, amount: Amount })) }),
});

export const openingBalancesSet = defineOperation({
	name: 'openingBalances.set',
	summary: 'Set opening balances',
	description:
		'Replaces the opening balances (ingående balanser) of a fiscal year. Only balance-sheet accounts; amounts must sum to zero.',
	scope: 'ledger:book',
	kind: 'mutation',
	companyScoped: true,
	input: z.object({
		fiscalYearId: Id,
		items: z.array(z.object({ account: AccountNumber, amount: Amount })),
	}),
	output: z.object({ items: z.array(z.object({ account: AccountNumber, amount: Amount })) }),
});
