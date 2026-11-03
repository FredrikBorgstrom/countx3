import type { LocalDate } from './dates.ts';
import { type Account, type Entry, isBalanceAccount } from './ledger.ts';
import type { Minor } from './money.ts';

export interface BalanceRow {
	account: string;
	name: string;
	opening: Minor;
	debit: Minor;
	credit: Minor;
	closing: Minor;
}

export interface LedgerData {
	accounts: readonly Account[];
	/** Ingående balanser for the fiscal year (balance accounts only). */
	openingBalances: ReadonlyMap<string, Minor>;
	/** All entries of the fiscal year. */
	entries: readonly Entry[];
}

/** Saldobalans / trial balance for [from, to] within one fiscal year. Rows with no activity are omitted. */
export function trialBalance(data: LedgerData, from: LocalDate, to: LocalDate): BalanceRow[] {
	const rows = new Map<string, BalanceRow>();
	const accountByNumber = new Map(data.accounts.map((a) => [a.number, a]));
	const row = (number: string) => {
		let r = rows.get(number);
		if (!r) {
			r = {
				account: number,
				name: accountByNumber.get(number)?.name ?? '',
				opening: 0n,
				debit: 0n,
				credit: 0n,
				closing: 0n,
			};
			rows.set(number, r);
		}
		return r;
	};

	for (const [number, amount] of data.openingBalances) {
		const account = accountByNumber.get(number);
		if (account && !isBalanceAccount(account.type)) continue;
		row(number).opening += amount;
	}
	for (const e of data.entries) {
		if (e.date > to) continue;
		const r = row(e.account);
		if (e.date < from) r.opening += e.amount;
		else if (e.amount > 0n) r.debit += e.amount;
		else r.credit -= e.amount;
	}
	const result = [...rows.values()];
	for (const r of result) r.closing = r.opening + r.debit - r.credit;
	return result
		.filter((r) => r.opening !== 0n || r.debit !== 0n || r.credit !== 0n)
		.sort((a, b) => (a.account < b.account ? -1 : 1));
}

export interface LedgerLine extends Entry {
	balance: Minor;
}

export interface AccountLedger {
	account: string;
	name: string;
	opening: Minor;
	lines: LedgerLine[];
	closing: Minor;
}

/** Huvudbok: every entry per account with running balance. */
export function generalLedger(data: LedgerData, from: LocalDate, to: LocalDate): AccountLedger[] {
	const balances = new Map(trialBalance(data, from, to).map((r) => [r.account, r]));
	const byAccount = new Map<string, Entry[]>();
	for (const e of data.entries) {
		if (e.date < from || e.date > to) continue;
		const list = byAccount.get(e.account) ?? [];
		list.push(e);
		byAccount.set(e.account, list);
	}
	return [...balances.values()].map((b) => {
		let balance = b.opening;
		const lines = (byAccount.get(b.account) ?? [])
			.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0))
			.map((e) => {
				balance += e.amount;
				return { ...e, balance };
			});
		return { account: b.account, name: b.name, opening: b.opening, lines, closing: b.closing };
	});
}

export interface AccountRange {
	from: string;
	to: string;
}

export type LayoutRow =
	| { key: string; label: string; ranges: readonly AccountRange[]; negate?: boolean }
	| { key: string; label: string; total: readonly string[] };

export interface ReportLayout {
	id: string;
	title: string;
	/** Multiply by -1 for presentation (credit-normal reports show income and liabilities as positive). */
	negate: boolean;
	rows: readonly LayoutRow[];
}

export interface ReportRow {
	key: string;
	label: string;
	amount: Minor;
	isTotal: boolean;
	accounts: { account: string; name: string; amount: Minor }[];
}

const inRange = (account: string, r: AccountRange) => account >= r.from && account <= r.to;

/** Applies a layout (balance sheet, income statement) to per-account amounts. */
export function applyLayout(
	layout: ReportLayout,
	amounts: readonly BalanceRow[],
	pick: (r: BalanceRow) => Minor,
): ReportRow[] {
	const computed = new Map<string, Minor>();
	return layout.rows.map((row) => {
		if ('total' in row) {
			const amount = row.total.reduce((acc, key) => acc + (computed.get(key) ?? 0n), 0n);
			computed.set(row.key, amount);
			return { key: row.key, label: row.label, amount, isTotal: true, accounts: [] };
		}
		const sign = (row.negate ?? layout.negate) ? -1n : 1n;
		const accounts = amounts
			.filter((a) => row.ranges.some((r) => inRange(a.account, r)))
			.map((a) => ({ account: a.account, name: a.name, amount: pick(a) * sign }))
			.filter((a) => a.amount !== 0n);
		const amount = accounts.reduce((acc, a) => acc + a.amount, 0n);
		computed.set(row.key, amount);
		return { key: row.key, label: row.label, amount, isTotal: false, accounts };
	});
}
