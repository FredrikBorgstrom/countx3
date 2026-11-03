import type { BookedVoucher } from './ledger.ts';

/** Hash of the (virtual) voucher before the first one in a company's chain. */
export const GENESIS_HASH = '0'.repeat(64);

/** JSON with sorted keys, bigint as decimal string and undefined fields omitted. */
export function canonicalJson(value: unknown): string {
	if (typeof value === 'bigint') return JSON.stringify(value.toString());
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type HashableVoucher = Omit<BookedVoucher, 'hash'>;

/** Everything that legally defines a booked voucher goes into its hash, plus the previous hash. */
export function voucherHash(v: HashableVoucher): Promise<string> {
	return sha256Hex(
		canonicalJson({
			companyId: v.companyId,
			bookingSeq: v.bookingSeq,
			series: v.series,
			number: v.number,
			date: v.date,
			description: v.description,
			correctsVoucherId: v.correctsVoucherId,
			bookedAt: v.bookedAt,
			bookedBy: { type: v.bookedBy.type, id: v.bookedBy.id },
			lines: v.lines,
			prevHash: v.prevHash,
		}),
	);
}

export interface ChainBreak {
	bookingSeq: number;
	voucherId: string;
	reason: 'HASH_MISMATCH' | 'PREV_HASH_MISMATCH' | 'SEQUENCE_GAP';
}

/** Verifies a company's vouchers ordered by bookingSeq. Returns the first break, or null when intact. */
export async function verifyChain(vouchers: readonly BookedVoucher[]): Promise<ChainBreak | null> {
	let prevHash = GENESIS_HASH;
	let expectedSeq = 1;
	for (const v of vouchers) {
		if (v.bookingSeq !== expectedSeq)
			return { bookingSeq: v.bookingSeq, voucherId: v.id, reason: 'SEQUENCE_GAP' };
		if (v.prevHash !== prevHash)
			return { bookingSeq: v.bookingSeq, voucherId: v.id, reason: 'PREV_HASH_MISMATCH' };
		if ((await voucherHash(v)) !== v.hash)
			return { bookingSeq: v.bookingSeq, voucherId: v.id, reason: 'HASH_MISMATCH' };
		prevHash = v.hash;
		expectedSeq++;
	}
	return null;
}
