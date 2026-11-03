import type { LocalDate } from './dates.ts';
import type { Minor } from './money.ts';

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export const isBalanceAccount = (type: AccountType) =>
	type === 'asset' || type === 'liability' || type === 'equity';

export interface Account {
	number: string;
	name: string;
	type: AccountType;
	active: boolean;
	/** Default tax code suggested when the account is used, e.g. "MP1". */
	defaultTaxCode?: string | undefined;
}

export interface FiscalYear {
	id: string;
	start: LocalDate;
	end: LocalDate;
	closed: boolean;
}

/** Who did something. Agents are first-class actors so the audit trail shows exactly which agent acted. */
export interface Actor {
	type: 'user' | 'agent' | 'system';
	id: string;
	name: string;
	/** For agents: the client, e.g. "claude-code" or "codex". */
	client?: string | undefined;
}

export interface VoucherLine {
	account: string;
	/** Signed amount in accounting currency: positive = debit, negative = credit. */
	amount: Minor;
	description?: string | undefined;
	taxCode?: string | undefined;
	costCenter?: string | undefined;
	project?: string | undefined;
	quantity?: number | undefined;
	/** Original amount and currency when the transaction was in a foreign currency. */
	foreignAmount?: Minor | undefined;
	foreignCurrency?: string | undefined;
}

export interface VoucherInput {
	series: string;
	/** Transaction date (affärshändelsens datum). */
	date: LocalDate;
	/** What the transaction concerns (BFL 5:7). */
	description: string;
	lines: VoucherLine[];
	/** Set when this voucher corrects an earlier booked voucher (BFL 5:5). */
	correctsVoucherId?: string | undefined;
}

export interface BookedVoucher extends VoucherInput {
	id: string;
	companyId: string;
	number: number;
	/** Monotonic per company; defines the order of the hash chain. */
	bookingSeq: number;
	bookedAt: string;
	bookedBy: Actor;
	prevHash: string;
	hash: string;
}

/** A single posting, flattened from a voucher, as used by reports. */
export interface Entry {
	date: LocalDate;
	account: string;
	amount: Minor;
	voucherId: string;
	voucherRef: string;
	description: string;
}

export const voucherRef = (series: string, number: number) => `${series}${number}`;

export function entriesOf(
	voucher: Pick<BookedVoucher, 'id' | 'series' | 'number' | 'date' | 'description' | 'lines'>,
): Entry[] {
	return voucher.lines.map((line) => ({
		date: voucher.date,
		account: line.account,
		amount: line.amount,
		voucherId: voucher.id,
		voucherRef: voucherRef(voucher.series, voucher.number),
		description: line.description ?? voucher.description,
	}));
}

/** Builds the correction voucher that fully reverses a booked voucher. */
export function reversalOf(voucher: BookedVoucher, date: LocalDate, reason: string): VoucherInput {
	return {
		series: voucher.series,
		date,
		description: `Rättelse av ${voucherRef(voucher.series, voucher.number)}: ${reason}`,
		correctsVoucherId: voucher.id,
		lines: voucher.lines.map((line) => ({
			...line,
			amount: -line.amount,
			foreignAmount: line.foreignAmount === undefined ? undefined : -line.foreignAmount,
		})),
	};
}
