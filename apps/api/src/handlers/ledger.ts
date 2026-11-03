import {
	applyLayout,
	assertValidVoucher,
	type BalanceRow,
	DomainError,
	formatAmount,
	generalLedger,
	reversalOf,
	trialBalance,
	verifyChain,
} from '@countx3/core';
import { auditEvents, voucherLines, vouchers } from '@countx3/db';
import { and, asc, desc, eq, exists, gte, ilike, lt, lte, type SQL } from 'drizzle-orm';
import { bookDraft, insertDraft } from '../booking.ts';
import { companyContext, type Handlers } from '../context.ts';
import {
	bookedFromRow,
	fiscalYearContaining,
	getCompany,
	inputFromRow,
	lineFromWire,
	linesFor,
	linesToRows,
	listFiscalYears,
	loadLedgerContext,
	loadLedgerData,
	loadVoucher,
	voucherDto,
} from '../store.ts';
import { sieHandlers } from './sie.ts';

const balanceDto = (r: BalanceRow) => ({
	account: r.account,
	name: r.name,
	opening: formatAmount(r.opening),
	debit: formatAmount(r.debit),
	credit: formatAmount(r.credit),
	closing: formatAmount(r.closing),
});

const reportRowsDto = (rows: ReturnType<typeof applyLayout>) =>
	rows.map((r) => ({
		...r,
		amount: formatAmount(r.amount),
		accounts: r.accounts.map((a) => ({ ...a, amount: formatAmount(a.amount) })),
	}));

async function voucherResult(ctx: ReturnType<typeof companyContext>, voucherId: string) {
	const { voucher, lines } = await loadVoucher(ctx.tx, ctx.companyId, voucherId);
	return voucherDto(voucher, lines);
}

function requireDraft(voucher: { status: string; series: string; number: number | null }) {
	if (voucher.status !== 'draft') {
		throw new DomainError(
			'VOUCHER_IMMUTABLE',
			`Voucher ${voucher.series}${voucher.number} is booked and cannot be changed.`,
			{
				status: 409,
				hint: 'Use vouchers.correct to book a correction.',
			},
		);
	}
}

export const ledgerHandlers = {
	async 'vouchers.create'(ctx, input) {
		const c = companyContext(ctx);
		if (input.book && !c.scopes.has('ledger:book')) {
			throw new DomainError('MISSING_SCOPE', 'Booking requires the scope "ledger:book".', {
				status: 403,
				hint: 'Create it as a draft (book: false) and let a person book it.',
			});
		}
		const id = await insertDraft(
			c,
			{ ...input, lines: input.lines.map(lineFromWire) },
			ctx.actor.type === 'agent' ? 'agent' : 'manual',
		);
		if (input.book) await bookDraft(c, id);
		ctx.auditTarget = { type: 'voucher', id };
		return voucherResult(c, id);
	},

	async 'vouchers.update'(ctx, input) {
		const c = companyContext(ctx);
		const { voucher, lines } = await loadVoucher(c.tx, c.companyId, input.voucherId);
		requireDraft(voucher);
		const next = inputFromRow(voucher, lines);
		if (input.series !== undefined) next.series = input.series;
		if (input.date !== undefined) next.date = input.date;
		if (input.description !== undefined) next.description = input.description;
		if (input.lines !== undefined) next.lines = input.lines.map(lineFromWire);
		assertValidVoucher(next, await loadLedgerContext(c.tx, await getCompany(c.tx, c.companyId)));
		const fy = await fiscalYearContaining(c.tx, c.companyId, next.date);
		await c.tx
			.update(vouchers)
			.set({ series: next.series, date: next.date, description: next.description, fiscalYearId: fy.id })
			.where(eq(vouchers.id, voucher.id));
		if (input.lines !== undefined) {
			await c.tx.delete(voucherLines).where(eq(voucherLines.voucherId, voucher.id));
			await c.tx.insert(voucherLines).values(linesToRows(c.companyId, voucher.id, next.lines));
		}
		ctx.auditTarget = { type: 'voucher', id: voucher.id };
		return voucherResult(c, voucher.id);
	},

	async 'vouchers.delete'(ctx, input) {
		const c = companyContext(ctx);
		const { voucher } = await loadVoucher(c.tx, c.companyId, input.voucherId);
		requireDraft(voucher);
		await c.tx.delete(vouchers).where(eq(vouchers.id, voucher.id));
		ctx.auditTarget = { type: 'voucher', id: voucher.id };
		return { deleted: true as const };
	},

	async 'vouchers.book'(ctx, input) {
		const c = companyContext(ctx);
		await bookDraft(c, input.voucherId);
		ctx.auditTarget = { type: 'voucher', id: input.voucherId };
		return voucherResult(c, input.voucherId);
	},

	async 'vouchers.correct'(ctx, input) {
		const c = companyContext(ctx);
		const { voucher, lines } = await loadVoucher(c.tx, c.companyId, input.voucherId);
		if (voucher.status !== 'booked') {
			throw new DomainError(
				'VOUCHER_NOT_BOOKED',
				'Only booked vouchers need corrections; edit or delete the draft instead.',
				{
					hint: 'Use vouchers.update or vouchers.delete.',
				},
			);
		}
		const original = bookedFromRow(voucher, lines);
		const date = input.date ?? voucher.date;
		const reversalId = await insertDraft(c, reversalOf(original, date, input.reason), 'correction');
		await bookDraft(c, reversalId);
		let replacementId: string | null = null;
		if (input.replacementLines) {
			replacementId = await insertDraft(
				c,
				{
					series: voucher.series,
					date,
					description: `${voucher.description} (ersätter ${voucher.series}${voucher.number})`,
					correctsVoucherId: voucher.id,
					lines: input.replacementLines.map(lineFromWire),
				},
				'correction',
			);
			await bookDraft(c, replacementId);
		}
		ctx.auditTarget = { type: 'voucher', id: voucher.id };
		return {
			reversal: await voucherResult(c, reversalId),
			replacement: replacementId ? await voucherResult(c, replacementId) : null,
		};
	},

	async 'vouchers.get'(ctx, input) {
		const c = companyContext(ctx);
		if (input.voucherId) return voucherResult(c, input.voucherId);
		const match = input.ref?.toUpperCase().match(/^([A-Z]+)(\d+)$/);
		if (!match) {
			throw new DomainError('INVALID_INPUT', 'Pass voucherId, or ref like "A12".', { status: 400 });
		}
		const years = await listFiscalYears(c.tx, c.companyId);
		const fy = input.date ? await fiscalYearContaining(c.tx, c.companyId, input.date) : years[0];
		if (!fy) throw new DomainError('NOT_FOUND', 'The company has no fiscal year.', { status: 404 });
		const [row] = await c.tx
			.select({ id: vouchers.id })
			.from(vouchers)
			.where(
				and(
					eq(vouchers.fiscalYearId, fy.id),
					eq(vouchers.series, match[1]!),
					eq(vouchers.number, Number(match[2])),
				),
			);
		if (!row)
			throw new DomainError(
				'NOT_FOUND',
				`Voucher ${input.ref} not found in fiscal year ${fy.start}–${fy.end}.`,
				{ status: 404 },
			);
		return voucherResult(c, row.id);
	},

	async 'vouchers.list'(ctx, input) {
		const c = companyContext(ctx);
		const conditions: SQL[] = [eq(vouchers.companyId, c.companyId)];
		if (input.from) conditions.push(gte(vouchers.date, input.from));
		if (input.to) conditions.push(lte(vouchers.date, input.to));
		if (input.status) conditions.push(eq(vouchers.status, input.status));
		if (input.series) conditions.push(eq(vouchers.series, input.series));
		if (input.search) conditions.push(ilike(vouchers.description, `%${input.search}%`));
		if (input.account) {
			conditions.push(
				exists(
					c.tx
						.select({ one: voucherLines.id })
						.from(voucherLines)
						.where(and(eq(voucherLines.voucherId, vouchers.id), eq(voucherLines.account, input.account))),
				),
			);
		}
		const offset = input.cursor ? Number(Buffer.from(input.cursor, 'base64url').toString()) : 0;
		const rows = await c.tx
			.select()
			.from(vouchers)
			.where(and(...conditions))
			.orderBy(desc(vouchers.date), asc(vouchers.series), desc(vouchers.number), desc(vouchers.createdAt))
			.limit(input.limit + 1)
			.offset(offset);
		const page = rows.slice(0, input.limit);
		const lines = await linesFor(
			c.tx,
			page.map((v) => v.id),
		);
		return {
			items: page.map((v) => voucherDto(v, lines.get(v.id)!)),
			nextCursor:
				rows.length > input.limit ? Buffer.from(String(offset + input.limit)).toString('base64url') : null,
		};
	},

	async 'reports.trialBalance'(ctx, input) {
		const c = companyContext(ctx);
		const { fiscalYear, data } = await loadLedgerData(c.tx, c.companyId, input.from, input.to);
		return { fiscalYear, rows: trialBalance(data, input.from, input.to).map(balanceDto) };
	},

	async 'reports.incomeStatement'(ctx, input) {
		const c = companyContext(ctx);
		const { data } = await loadLedgerData(c.tx, c.companyId, input.from, input.to);
		const layout = c.pack.reportLayouts.incomeStatement;
		const rows = trialBalance(data, input.from, input.to);
		return {
			title: layout.title,
			from: input.from,
			to: input.to,
			rows: reportRowsDto(applyLayout(layout, rows, (r) => r.debit - r.credit)),
		};
	},

	async 'reports.balanceSheet'(ctx, input) {
		const c = companyContext(ctx);
		const fy = await fiscalYearContaining(c.tx, c.companyId, input.date);
		const { data } = await loadLedgerData(c.tx, c.companyId, fy.start, input.date);
		const layout = c.pack.reportLayouts.balanceSheet;
		const rows = trialBalance(data, fy.start, input.date);
		return {
			title: layout.title,
			date: input.date,
			rows: reportRowsDto(applyLayout(layout, rows, (r) => r.closing)),
		};
	},

	async 'reports.generalLedger'(ctx, input) {
		const c = companyContext(ctx);
		const { data } = await loadLedgerData(c.tx, c.companyId, input.from, input.to);
		const wanted = input.accounts ? new Set(input.accounts) : null;
		return {
			accounts: generalLedger(data, input.from, input.to)
				.filter((a) => !wanted || wanted.has(a.account))
				.map((a) => ({
					account: a.account,
					name: a.name,
					opening: formatAmount(a.opening),
					closing: formatAmount(a.closing),
					lines: a.lines.map((l) => ({
						date: l.date,
						voucherId: l.voucherId,
						voucherRef: l.voucherRef,
						description: l.description,
						amount: formatAmount(l.amount),
						balance: formatAmount(l.balance),
					})),
				})),
		};
	},

	async 'ledger.verify'(ctx) {
		const c = companyContext(ctx);
		const company = await getCompany(c.tx, c.companyId);
		const rows = await c.tx
			.select()
			.from(vouchers)
			.where(and(eq(vouchers.companyId, c.companyId), eq(vouchers.status, 'booked')))
			.orderBy(asc(vouchers.bookingSeq));
		const lines = await linesFor(
			c.tx,
			rows.map((v) => v.id),
		);
		const booked = rows.map((v) => bookedFromRow(v, lines.get(v.id)!));
		const chainBreak = await verifyChain(booked);
		const headMatches =
			(booked.at(-1)?.hash ?? company.lastHash) === company.lastHash &&
			booked.length === company.lastBookingSeq;
		return {
			intact: chainBreak === null && headMatches,
			bookedVouchers: booked.length,
			head: company.lastHash,
			break:
				chainBreak ??
				(headMatches
					? null
					: { bookingSeq: company.lastBookingSeq, voucherId: company.id, reason: 'HEAD_MISMATCH' }),
		};
	},

	async 'audit.list'(ctx, input) {
		const c = companyContext(ctx);
		const conditions = [eq(auditEvents.companyId, c.companyId)];
		if (input.before) conditions.push(lt(auditEvents.id, input.before));
		const rows = await c.tx
			.select()
			.from(auditEvents)
			.where(and(...conditions))
			.orderBy(desc(auditEvents.id))
			.limit(input.limit);
		return { items: rows.map((r) => ({ ...r, at: r.at.toISOString(), data: r.data })) };
	},

	...sieHandlers,
} satisfies Partial<Handlers>;
