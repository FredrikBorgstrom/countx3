import {
	type BookedVoucher,
	DomainError,
	type Entry,
	fiscalYearFor,
	formatAmount,
	type LedgerContext,
	type LedgerData,
	type LocalDate,
	notFound,
	parseAmount,
	type VoucherInput,
	type VoucherLine,
	voucherRef,
} from '@countx3/core';
import {
	accounts,
	companies,
	fiscalYears,
	openingBalances,
	type Tx,
	voucherLines,
	voucherSeries,
	vouchers,
} from '@countx3/db';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

export type VoucherRow = typeof vouchers.$inferSelect;
export type LineRow = typeof voucherLines.$inferSelect;
export type CompanyRow = typeof companies.$inferSelect;
type FiscalYearRow = typeof fiscalYears.$inferSelect;

const orUndefined = <T>(value: T | null) => (value === null ? undefined : value);

export const fiscalYearDto = (fy: FiscalYearRow) => ({
	id: fy.id,
	start: fy.start,
	end: fy.end,
	closed: fy.closed,
});

export async function getCompany(tx: Tx, companyId: string, lock = false): Promise<CompanyRow> {
	const query = tx.select().from(companies).where(eq(companies.id, companyId));
	const [company] = lock ? await query.for('update') : await query;
	if (!company) throw notFound('Company', companyId);
	return company;
}

export const listFiscalYears = (tx: Tx, companyId: string) =>
	tx.select().from(fiscalYears).where(eq(fiscalYears.companyId, companyId)).orderBy(desc(fiscalYears.start));

export async function loadLedgerContext(tx: Tx, company: CompanyRow): Promise<LedgerContext> {
	const [accountRows, years, series] = await Promise.all([
		tx.select().from(accounts).where(eq(accounts.companyId, company.id)),
		listFiscalYears(tx, company.id),
		tx.select().from(voucherSeries).where(eq(voucherSeries.companyId, company.id)),
	]);
	return {
		accounts: new Map(
			accountRows.map((a) => [a.number, { ...a, defaultTaxCode: orUndefined(a.defaultTaxCode) }]),
		),
		fiscalYears: years.map(fiscalYearDto),
		lockedThrough: orUndefined(company.lockedThrough),
		knownSeries: new Set(series.map((s) => s.code)),
	};
}

// --- Conversions between wire format, domain and rows ---------------------------------------------

export interface WireLine {
	account: string;
	amount: string;
	description?: string | undefined;
	taxCode?: string | undefined;
	costCenter?: string | undefined;
	project?: string | undefined;
	quantity?: number | undefined;
	foreignAmount?: string | undefined;
	foreignCurrency?: string | undefined;
}

export const lineFromWire = (l: WireLine): VoucherLine => ({
	...l,
	amount: parseAmount(l.amount),
	foreignAmount: l.foreignAmount === undefined ? undefined : parseAmount(l.foreignAmount),
});

export const lineFromRow = (l: LineRow): VoucherLine => ({
	account: l.account,
	amount: l.amount,
	description: orUndefined(l.description),
	taxCode: orUndefined(l.taxCode),
	costCenter: orUndefined(l.costCenter),
	project: orUndefined(l.project),
	quantity: l.quantity === null ? undefined : Number(l.quantity),
	foreignAmount: orUndefined(l.foreignAmount),
	foreignCurrency: orUndefined(l.foreignCurrency),
});

export const inputFromRow = (v: VoucherRow, lines: LineRow[]): VoucherInput => ({
	series: v.series,
	date: v.date,
	description: v.description,
	correctsVoucherId: orUndefined(v.correctsVoucherId),
	lines: lines.map(lineFromRow),
});

export function bookedFromRow(v: VoucherRow, lines: LineRow[]): BookedVoucher {
	if (v.status !== 'booked') throw new Error(`voucher ${v.id} is not booked`);
	return {
		...inputFromRow(v, lines),
		id: v.id,
		companyId: v.companyId,
		number: v.number!,
		bookingSeq: v.bookingSeq!,
		bookedAt: v.bookedAt!.toISOString(),
		bookedBy: v.bookedBy!,
		prevHash: v.prevHash!,
		hash: v.hash!,
	};
}

export function voucherDto(v: VoucherRow, lines: LineRow[]) {
	return {
		id: v.id,
		status: v.status,
		series: v.series,
		number: v.number,
		ref: v.number === null ? null : voucherRef(v.series, v.number),
		fiscalYearId: v.fiscalYearId,
		date: v.date,
		description: v.description,
		correctsVoucherId: v.correctsVoucherId,
		source: v.source,
		createdAt: v.createdAt.toISOString(),
		createdBy: v.createdBy,
		bookedAt: v.bookedAt?.toISOString() ?? null,
		bookedBy: v.bookedBy,
		hash: v.hash,
		lines: lines.map((l) => {
			const line = lineFromRow(l);
			return {
				...line,
				lineNo: l.lineNo,
				amount: formatAmount(line.amount),
				foreignAmount: line.foreignAmount === undefined ? undefined : formatAmount(line.foreignAmount),
			};
		}),
	};
}

export const linesToRows = (companyId: string, voucherId: string, lines: VoucherLine[]) =>
	lines.map((l, i) => ({
		companyId,
		voucherId,
		lineNo: i + 1,
		account: l.account,
		amount: l.amount,
		description: l.description,
		taxCode: l.taxCode,
		costCenter: l.costCenter,
		project: l.project,
		quantity: l.quantity === undefined ? undefined : String(l.quantity),
		foreignAmount: l.foreignAmount,
		foreignCurrency: l.foreignCurrency,
	}));

// --- Loading ------------------------------------------------------------------------------------

export async function linesFor(tx: Tx, voucherIds: string[]): Promise<Map<string, LineRow[]>> {
	const byVoucher = new Map<string, LineRow[]>(voucherIds.map((id) => [id, []]));
	if (voucherIds.length === 0) return byVoucher;
	const rows = await tx
		.select()
		.from(voucherLines)
		.where(inArray(voucherLines.voucherId, voucherIds))
		.orderBy(asc(voucherLines.lineNo));
	for (const row of rows) byVoucher.get(row.voucherId)!.push(row);
	return byVoucher;
}

export async function loadVoucher(tx: Tx, companyId: string, voucherId: string) {
	const [voucher] = await tx
		.select()
		.from(vouchers)
		.where(and(eq(vouchers.companyId, companyId), eq(vouchers.id, voucherId)));
	if (!voucher) throw notFound('Voucher', voucherId);
	const lines = (await linesFor(tx, [voucher.id])).get(voucher.id)!;
	return { voucher, lines };
}

export async function fiscalYearContaining(tx: Tx, companyId: string, date: LocalDate) {
	const years = (await listFiscalYears(tx, companyId)).map(fiscalYearDto);
	const fy = fiscalYearFor(years, date);
	if (!fy) {
		throw new DomainError('DATE_OUTSIDE_FISCAL_YEAR', `${date} is not inside any fiscal year.`, {
			hint: 'See fiscalYears.list, or create the fiscal year with fiscalYears.create.',
		});
	}
	return fy;
}

/** Everything a report needs for [from, to], which must lie within one fiscal year. */
export async function loadLedgerData(tx: Tx, companyId: string, from: LocalDate, to: LocalDate) {
	if (from > to) throw new DomainError('RANGE_INVALID', '`from` must not be after `to`.', { status: 400 });
	const fy = await fiscalYearContaining(tx, companyId, from);
	if (to > fy.end) {
		throw new DomainError(
			'RANGE_SPANS_FISCAL_YEARS',
			`The range must end within the fiscal year ${fy.start}–${fy.end}.`,
			{
				status: 400,
			},
		);
	}
	const [accountRows, ib, entryRows] = await Promise.all([
		tx.select().from(accounts).where(eq(accounts.companyId, companyId)),
		tx.select().from(openingBalances).where(eq(openingBalances.fiscalYearId, fy.id)),
		tx
			.select({
				voucherId: vouchers.id,
				series: vouchers.series,
				number: vouchers.number,
				date: vouchers.date,
				voucherDescription: vouchers.description,
				account: voucherLines.account,
				amount: voucherLines.amount,
				lineDescription: voucherLines.description,
			})
			.from(voucherLines)
			.innerJoin(vouchers, eq(vouchers.id, voucherLines.voucherId))
			.where(and(eq(vouchers.fiscalYearId, fy.id), eq(vouchers.status, 'booked')))
			.orderBy(asc(vouchers.date), asc(vouchers.series), asc(vouchers.number), asc(voucherLines.lineNo)),
	]);
	const entries: Entry[] = entryRows.map((e) => ({
		date: e.date,
		account: e.account,
		amount: e.amount,
		voucherId: e.voucherId,
		voucherRef: voucherRef(e.series, e.number!),
		description: e.lineDescription ?? e.voucherDescription,
	}));
	const data: LedgerData = {
		accounts: accountRows.map((a) => ({ ...a, defaultTaxCode: orUndefined(a.defaultTaxCode) })),
		openingBalances: new Map(ib.map((b) => [b.account, b.amount])),
		entries,
	};
	return { fiscalYear: fy, data };
}
