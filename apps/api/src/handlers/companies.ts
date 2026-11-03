import { scopes as allScopes, roleScopes, type Scope } from '@countx3/contracts';
import {
	DomainError,
	formatAmount,
	GENESIS_HASH,
	isBalanceAccount,
	parseAmount,
	rateOn,
	ratePeriodOn,
	sha256Hex,
	sum,
	today,
} from '@countx3/core';
import {
	accounts,
	apiTokens,
	companies,
	companyMembers,
	fiscalYears,
	openingBalances,
	setCompanyContext,
	voucherSeries,
	vouchers,
} from '@countx3/db';
import { and, asc, desc, eq, ilike, isNull, or } from 'drizzle-orm';
import { companyContext, type Handlers, jurisdictions } from '../context.ts';
import { newTokenSecret } from '../principal.ts';
import { type CompanyRow, fiscalYearDto, getCompany, listFiscalYears } from '../store.ts';

const companySummary = (c: CompanyRow, role: (typeof companyMembers.$inferSelect)['role']) => ({
	id: c.id,
	name: c.name,
	country: c.country,
	legalForm: c.legalForm as 'AB' | 'EF',
	organizationNumber: c.organizationNumber,
	currency: c.currency,
	smallCompany: c.smallCompany,
	lockedThrough: c.lockedThrough,
	role,
});

const tokenDto = (t: typeof apiTokens.$inferSelect) => ({
	id: t.id,
	name: t.name,
	client: t.client,
	prefix: t.prefix,
	scopes: t.scopes as Scope[],
	companyId: t.companyId,
	createdAt: t.createdAt.toISOString(),
	lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
	expiresAt: t.expiresAt?.toISOString() ?? null,
	revokedAt: t.revokedAt?.toISOString() ?? null,
});

const validationError = (issues: { code: string; message: string; path?: string }[]) =>
	new DomainError('VALIDATION_FAILED', issues.map((i) => i.message).join(' '), { issues });

async function companyWithYears(ctx: Parameters<Handlers['companies.get']>[0]) {
	const c = companyContext(ctx);
	const company = await getCompany(c.tx, c.companyId);
	return {
		...companySummary(company, c.role),
		fiscalYears: (await listFiscalYears(c.tx, c.companyId)).map(fiscalYearDto),
	};
}

export const companyHandlers = {
	async 'me.get'(ctx) {
		const p = ctx.principal;
		const memberships = await ctx.tx
			.select({
				id: companies.id,
				name: companies.name,
				legalForm: companies.legalForm,
				role: companyMembers.role,
			})
			.from(companyMembers)
			.innerJoin(companies, eq(companies.id, companyMembers.companyId))
			.where(eq(companyMembers.userId, p.userId))
			.orderBy(asc(companies.name));
		return {
			principal: {
				type: p.kind,
				userId: p.userId,
				name: p.name,
				email: p.email,
				tokenName: p.kind === 'token' ? p.tokenName : undefined,
				client: p.kind === 'token' ? (p.client ?? undefined) : undefined,
			},
			scopes: p.kind === 'token' ? p.scopes : [...allScopes],
			companies: memberships
				.filter((m) => p.kind === 'user' || !p.companyId || m.id === p.companyId)
				.map((m) => ({ ...m, legalForm: m.legalForm as 'AB' | 'EF' })),
		};
	},

	async 'tokens.create'(ctx, input) {
		if (input.companyId) {
			const [member] = await ctx.tx
				.select({ role: companyMembers.role })
				.from(companyMembers)
				.where(
					and(eq(companyMembers.companyId, input.companyId), eq(companyMembers.userId, ctx.principal.userId)),
				);
			if (!member)
				throw new DomainError('COMPANY_NOT_FOUND', 'Company not found or not accessible.', { status: 404 });
			const beyondRole = input.scopes.filter((s) => !roleScopes[member.role].includes(s));
			if (beyondRole.length > 0) {
				throw new DomainError('SCOPE_BEYOND_ROLE', `Your role cannot grant: ${beyondRole.join(', ')}.`, {
					status: 403,
				});
			}
		}
		const secret = newTokenSecret();
		const [token] = await ctx.tx
			.insert(apiTokens)
			.values({
				userId: ctx.principal.userId,
				companyId: input.companyId,
				name: input.name,
				client: input.client,
				prefix: secret.slice(0, 12),
				secretHash: await sha256Hex(secret),
				scopes: [...new Set(input.scopes)],
				expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : undefined,
			})
			.returning();
		ctx.auditTarget = { type: 'token', id: token!.id };
		return { ...tokenDto(token!), token: secret };
	},

	async 'tokens.list'(ctx) {
		const rows = await ctx.tx
			.select()
			.from(apiTokens)
			.where(eq(apiTokens.userId, ctx.principal.userId))
			.orderBy(desc(apiTokens.createdAt));
		return { items: rows.map(tokenDto) };
	},

	async 'tokens.revoke'(ctx, input) {
		const revoked = await ctx.tx
			.update(apiTokens)
			.set({ revokedAt: new Date() })
			.where(
				and(
					eq(apiTokens.id, input.tokenId),
					eq(apiTokens.userId, ctx.principal.userId),
					isNull(apiTokens.revokedAt),
				),
			)
			.returning({ id: apiTokens.id });
		if (revoked.length === 0)
			throw new DomainError('NOT_FOUND', 'No active token with that id.', { status: 404 });
		ctx.auditTarget = { type: 'token', id: input.tokenId };
		return { revoked: true as const };
	},

	async 'companies.create'(ctx, input) {
		const pack = jurisdictions[input.country]!;
		const issues = [
			pack.validateOrganizationNumber(input.organizationNumber, input.legalForm),
			...pack.validateFiscalYear(input.fiscalYear, { legalForm: input.legalForm }),
		].filter((i) => i !== null);
		if (issues.length > 0) throw validationError(issues);
		const template = input.chartTemplate
			? pack.chartTemplates.find((t) => t.id === input.chartTemplate)
			: pack.defaultChartTemplate(input.legalForm);
		if (!template) {
			throw new DomainError('CHART_TEMPLATE_UNKNOWN', `Unknown chart template "${input.chartTemplate}".`, {
				hint: `Available: ${pack.chartTemplates.map((t) => t.id).join(', ')}.`,
			});
		}

		const id = Bun.randomUUIDv7();
		await setCompanyContext(ctx.tx, id);
		const [company] = await ctx.tx
			.insert(companies)
			.values({
				id,
				name: input.name,
				country: input.country,
				legalForm: input.legalForm,
				organizationNumber: input.organizationNumber,
				currency: pack.currency,
				smallCompany: input.smallCompany,
				lastHash: GENESIS_HASH,
			})
			.returning();
		await ctx.tx
			.insert(companyMembers)
			.values({ companyId: id, userId: ctx.principal.userId, role: 'owner' });
		const [fy] = await ctx.tx
			.insert(fiscalYears)
			.values({ companyId: id, ...input.fiscalYear })
			.returning();
		await ctx.tx.insert(accounts).values(template.accounts.map((a) => ({ ...a, companyId: id })));
		await ctx.tx
			.insert(voucherSeries)
			.values(pack.defaultVoucherSeries.map((s) => ({ ...s, companyId: id })));

		ctx.companyId = id;
		ctx.auditTarget = { type: 'company', id };
		return { ...companySummary(company!, 'owner'), fiscalYears: [fiscalYearDto(fy!)] };
	},

	async 'companies.list'(ctx) {
		const rows = await ctx.tx
			.select({ company: companies, role: companyMembers.role })
			.from(companyMembers)
			.innerJoin(companies, eq(companies.id, companyMembers.companyId))
			.where(eq(companyMembers.userId, ctx.principal.userId))
			.orderBy(asc(companies.name));
		const p = ctx.principal;
		return {
			items: rows
				.filter((r) => p.kind === 'user' || !p.companyId || r.company.id === p.companyId)
				.map((r) => companySummary(r.company, r.role)),
		};
	},

	'companies.get': (ctx) => companyWithYears(ctx),

	async 'companies.update'(ctx, input) {
		const c = companyContext(ctx);
		if (input.name !== undefined || input.smallCompany !== undefined) {
			await c.tx.update(companies).set(input).where(eq(companies.id, c.companyId));
		}
		ctx.auditTarget = { type: 'company', id: c.companyId };
		return companyWithYears(ctx);
	},

	async 'periods.lock'(ctx, input) {
		const c = companyContext(ctx);
		const company = await getCompany(c.tx, c.companyId, true);
		if (company.lockedThrough && input.through < company.lockedThrough) {
			throw new DomainError(
				'LOCK_CANNOT_MOVE_BACK',
				`Periods are already locked through ${company.lockedThrough}.`,
				{
					hint: 'Locks only move forward. Unlocking requires the owner in the app.',
				},
			);
		}
		const [earliestDraft] = await c.tx
			.select({ date: vouchers.date })
			.from(vouchers)
			.where(and(eq(vouchers.companyId, c.companyId), eq(vouchers.status, 'draft')))
			.orderBy(asc(vouchers.date))
			.limit(1);
		if (earliestDraft && earliestDraft.date <= input.through) {
			throw new DomainError(
				'DRAFTS_IN_PERIOD',
				`There are draft vouchers dated on or before ${input.through}.`,
				{
					hint: 'Book or delete them first (vouchers.list with status "draft").',
				},
			);
		}
		await c.tx.update(companies).set({ lockedThrough: input.through }).where(eq(companies.id, c.companyId));
		ctx.auditTarget = { type: 'company', id: c.companyId };
		return { lockedThrough: input.through };
	},

	async 'fiscalYears.list'(ctx) {
		const c = companyContext(ctx);
		return { items: (await listFiscalYears(c.tx, c.companyId)).map(fiscalYearDto) };
	},

	async 'fiscalYears.create'(ctx, input) {
		const c = companyContext(ctx);
		const company = await getCompany(c.tx, c.companyId);
		const [latest] = await listFiscalYears(c.tx, c.companyId);
		const issues = c.pack.validateFiscalYear(input, {
			legalForm: company.legalForm,
			previousEnd: latest?.end,
		});
		if (issues.length > 0) throw validationError(issues);
		const [fy] = await c.tx
			.insert(fiscalYears)
			.values({ companyId: c.companyId, ...input })
			.returning();
		ctx.auditTarget = { type: 'fiscalYear', id: fy!.id };
		return fiscalYearDto(fy!);
	},

	async 'accounts.list'(ctx, input) {
		const c = companyContext(ctx);
		const conditions = [eq(accounts.companyId, c.companyId)];
		if (!input.includeInactive) conditions.push(eq(accounts.active, true));
		if (input.search)
			conditions.push(
				or(ilike(accounts.number, `${input.search}%`), ilike(accounts.name, `%${input.search}%`))!,
			);
		const rows = await c.tx
			.select()
			.from(accounts)
			.where(and(...conditions))
			.orderBy(asc(accounts.number));
		return { items: rows.map(({ companyId: _, ...a }) => a) };
	},

	async 'accounts.create'(ctx, input) {
		const c = companyContext(ctx);
		const type = input.type ?? c.pack.classifyAccount(input.number);
		if (!type) {
			throw new DomainError('ACCOUNT_TYPE_REQUIRED', `Cannot derive the type of account ${input.number}.`, {
				hint: 'Pass `type` explicitly.',
			});
		}
		if (input.defaultTaxCode && !c.pack.taxCodes.some((t) => t.code === input.defaultTaxCode)) {
			throw new DomainError('TAX_CODE_UNKNOWN', `Unknown tax code ${input.defaultTaxCode}.`, {
				hint: 'See taxCodes.list.',
			});
		}
		const [row] = await c.tx
			.insert(accounts)
			.values({
				companyId: c.companyId,
				number: input.number,
				name: input.name,
				type,
				defaultTaxCode: input.defaultTaxCode,
			})
			.returning();
		ctx.auditTarget = { type: 'account', id: input.number };
		const { companyId: _, ...account } = row!;
		return account;
	},

	async 'accounts.update'(ctx, input) {
		const c = companyContext(ctx);
		const { number, ...changes } = input;
		if (changes.defaultTaxCode && !c.pack.taxCodes.some((t) => t.code === changes.defaultTaxCode)) {
			throw new DomainError('TAX_CODE_UNKNOWN', `Unknown tax code ${changes.defaultTaxCode}.`, {
				hint: 'See taxCodes.list.',
			});
		}
		const query = c.tx
			.update(accounts)
			.set(changes)
			.where(and(eq(accounts.companyId, c.companyId), eq(accounts.number, number)));
		const [row] = Object.keys(changes).length
			? await query.returning()
			: await c.tx
					.select()
					.from(accounts)
					.where(and(eq(accounts.companyId, c.companyId), eq(accounts.number, number)));
		if (!row) throw new DomainError('NOT_FOUND', `Account ${number} does not exist.`, { status: 404 });
		ctx.auditTarget = { type: 'account', id: number };
		const { companyId: _, ...account } = row;
		return account;
	},

	async 'taxCodes.list'(ctx, input) {
		const c = companyContext(ctx);
		const date = input.date ?? today();
		return {
			date,
			items: c.pack.taxCodes.map((t) => {
				let ratePercent: string | null = null;
				let vatAccount = t.vatAccount ?? null;
				try {
					ratePercent = formatAmount(BigInt(rateOn(t, date)));
					vatAccount = ratePeriodOn(t, date).vatAccount ?? vatAccount;
				} catch {
					// Not in effect on this date.
				}
				return {
					code: t.code,
					label: t.label,
					kind: t.kind,
					ratePercent,
					vatAccount,
					inputVatAccount: t.inputVatAccount ?? null,
				};
			}),
		};
	},

	async 'series.list'(ctx) {
		const c = companyContext(ctx);
		const rows = await c.tx
			.select()
			.from(voucherSeries)
			.where(eq(voucherSeries.companyId, c.companyId))
			.orderBy(asc(voucherSeries.code));
		return { items: rows.map(({ code, name }) => ({ code, name })) };
	},

	async 'openingBalances.get'(ctx, input) {
		const c = companyContext(ctx);
		const rows = await c.tx
			.select()
			.from(openingBalances)
			.where(
				and(eq(openingBalances.companyId, c.companyId), eq(openingBalances.fiscalYearId, input.fiscalYearId)),
			)
			.orderBy(asc(openingBalances.account));
		return { items: rows.map((r) => ({ account: r.account, amount: formatAmount(r.amount) })) };
	},

	async 'openingBalances.set'(ctx, input) {
		const c = companyContext(ctx);
		const [fy] = await c.tx
			.select()
			.from(fiscalYears)
			.where(and(eq(fiscalYears.companyId, c.companyId), eq(fiscalYears.id, input.fiscalYearId)));
		if (!fy) throw new DomainError('NOT_FOUND', 'Fiscal year not found.', { status: 404 });
		if (fy.closed) throw new DomainError('FISCAL_YEAR_CLOSED', 'The fiscal year is closed.');
		const company = await getCompany(c.tx, c.companyId);
		if (company.lockedThrough && company.lockedThrough >= fy.start) {
			throw new DomainError('PERIOD_LOCKED', 'The start of this fiscal year is locked.');
		}
		const chart = new Map(
			(await c.tx.select().from(accounts).where(eq(accounts.companyId, c.companyId))).map((a) => [
				a.number,
				a,
			]),
		);
		const items = input.items
			.map((i) => ({ account: i.account, amount: parseAmount(i.amount) }))
			.filter((i) => i.amount !== 0n);
		const issues = items.flatMap((i, index) => {
			const account = chart.get(i.account);
			if (!account)
				return [
					{
						code: 'ACCOUNT_UNKNOWN',
						path: `items.${index}.account`,
						message: `Account ${i.account} does not exist.`,
					},
				];
			if (!isBalanceAccount(account.type)) {
				return [
					{
						code: 'NOT_BALANCE_ACCOUNT',
						path: `items.${index}.account`,
						message: `Account ${i.account} is not a balance sheet account.`,
					},
				];
			}
			return [];
		});
		const total = sum(items.map((i) => i.amount));
		if (total !== 0n)
			issues.push({
				code: 'OPENING_BALANCES_UNBALANCED',
				path: 'items',
				message: `Opening balances differ by ${formatAmount(total)}.`,
			});
		if (issues.length > 0) throw validationError(issues);

		await c.tx.delete(openingBalances).where(eq(openingBalances.fiscalYearId, fy.id));
		if (items.length > 0) {
			await c.tx
				.insert(openingBalances)
				.values(items.map((i) => ({ ...i, companyId: c.companyId, fiscalYearId: fy.id })));
		}
		ctx.auditTarget = { type: 'fiscalYear', id: fy.id };
		return { items: items.map((i) => ({ account: i.account, amount: formatAmount(i.amount) })) };
	},
} satisfies Partial<Handlers>;
