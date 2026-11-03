import { assertValidVoucher, DomainError, type VoucherInput, voucherHash } from '@countx3/core';
import { companies, voucherCounters, voucherLines, vouchers } from '@countx3/db';
import { eq, sql } from 'drizzle-orm';
import type { CompanyContext } from './context.ts';
import {
	fiscalYearContaining,
	getCompany,
	inputFromRow,
	linesToRows,
	loadLedgerContext,
	loadVoucher,
} from './store.ts';

/** Validates and stores a voucher as a draft. */
export async function insertDraft(ctx: CompanyContext, input: VoucherInput, source = 'manual') {
	const company = await getCompany(ctx.tx, ctx.companyId);
	assertValidVoucher(input, await loadLedgerContext(ctx.tx, company));
	const fy = await fiscalYearContaining(ctx.tx, ctx.companyId, input.date);
	const [voucher] = await ctx.tx
		.insert(vouchers)
		.values({
			companyId: ctx.companyId,
			fiscalYearId: fy.id,
			status: 'draft',
			series: input.series,
			date: input.date,
			description: input.description,
			correctsVoucherId: input.correctsVoucherId,
			source,
			createdBy: ctx.actor,
		})
		.returning({ id: vouchers.id });
	await ctx.tx.insert(voucherLines).values(linesToRows(ctx.companyId, voucher!.id, input.lines));
	return voucher!.id;
}

/**
 * Books a draft: gives it the next number in its series and appends it to the company's hash chain.
 * The company row is locked so bookings are strictly ordered.
 */
export async function bookDraft(ctx: CompanyContext, voucherId: string) {
	const company = await getCompany(ctx.tx, ctx.companyId, true);
	const { voucher, lines } = await loadVoucher(ctx.tx, ctx.companyId, voucherId);
	if (voucher.status !== 'draft') {
		throw new DomainError('ALREADY_BOOKED', `Voucher ${voucher.series}${voucher.number} is already booked.`, {
			status: 409,
		});
	}
	const input = inputFromRow(voucher, lines);
	assertValidVoucher(input, await loadLedgerContext(ctx.tx, company));

	const [counter] = await ctx.tx
		.insert(voucherCounters)
		.values({
			companyId: ctx.companyId,
			fiscalYearId: voucher.fiscalYearId,
			series: voucher.series,
			lastNumber: 1,
		})
		.onConflictDoUpdate({
			target: [voucherCounters.fiscalYearId, voucherCounters.series],
			set: { lastNumber: sql`${voucherCounters.lastNumber} + 1` },
		})
		.returning({ number: voucherCounters.lastNumber });

	const bookedAt = new Date();
	const booked = {
		...input,
		id: voucher.id,
		companyId: ctx.companyId,
		number: counter!.number,
		bookingSeq: company.lastBookingSeq + 1,
		bookedAt: bookedAt.toISOString(),
		bookedBy: ctx.actor,
		prevHash: company.lastHash,
	};
	const hash = await voucherHash(booked);
	await ctx.tx
		.update(vouchers)
		.set({
			status: 'booked',
			number: booked.number,
			bookingSeq: booked.bookingSeq,
			bookedAt,
			bookedBy: ctx.actor,
			prevHash: booked.prevHash,
			hash,
		})
		.where(eq(vouchers.id, voucher.id));
	await ctx.tx
		.update(companies)
		.set({ lastBookingSeq: booked.bookingSeq, lastHash: hash })
		.where(eq(companies.id, ctx.companyId));
}
