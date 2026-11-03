import { getLocale } from '#lib/paraglide/runtime.js';

/** Formats an API amount string ("-1234.50") for display without going through floating point. */
export function amount(value: string | null | undefined): string {
	if (value === null || value === undefined || value === '') return '';
	const negative = value.startsWith('-');
	const [whole = '0', frac = '00'] = value.replace('-', '').split('.');
	const sv = getLocale() === 'sv';
	const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, sv ? ' ' : ',');
	return `${negative ? '−' : ''}${grouped}${sv ? ',' : '.'}${frac.padEnd(2, '0')}`;
}

/** Accepts "1 234,50", "1234.5" or "-80" and returns the API format "1234.50", or null if invalid. */
export function parseAmountInput(text: string): string | null {
	const compact = text.replace(/[\s ]/g, '').replace('−', '-').replace(',', '.');
	if (!/^-?\d+(\.\d{1,2})?$/.test(compact)) return null;
	const [whole, frac = ''] = compact.split('.');
	return `${whole}.${frac.padEnd(2, '0')}`;
}

export const isNegative = (value: string) => value.startsWith('-');

const toMinor = (value: string) => {
	const [whole = '0', frac = ''] = value.replace('-', '').split('.');
	const minor = BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
	return value.startsWith('-') ? -minor : minor;
};

const fromMinor = (minor: bigint) => {
	const abs = minor < 0n ? -minor : minor;
	return `${minor < 0n ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
};

/** Exact sum of API amount strings. */
export const sumAmounts = (values: string[]) =>
	fromMinor(values.reduce((total, v) => total + toMinor(v), 0n));

/** Total of a voucher = sum of its debit lines. */
export const voucherTotal = (lines: { amount: string }[]) =>
	sumAmounts(lines.map((l) => l.amount).filter((a) => !isNegative(a)));

export const today = () => new Date().toISOString().slice(0, 10);
