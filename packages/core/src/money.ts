import { DomainError } from './errors.ts';

/**
 * Amounts are integers in minor units (öre, cent) stored as bigint, never floats.
 * Rates are basis points: 2500 = 25 %.
 */
export type Minor = bigint;

const DECIMAL = /^(-)?(\d+)(?:[.,](\d{1,2}))?$/;

/** Parses "1234.5", "-0,75" or "1 234,50" into minor units (two decimals). */
export function parseAmount(text: string): Minor {
	const compact = text.replace(/[\s ]/g, '');
	const match = DECIMAL.exec(compact);
	if (!match) {
		throw new DomainError('AMOUNT_INVALID', `"${text}" is not a valid amount`, {
			hint: 'Use a decimal number with at most two decimals, e.g. "1234.50".',
		});
	}
	const [, sign, whole, frac = ''] = match;
	const minor = BigInt(whole!) * 100n + BigInt(frac.padEnd(2, '0'));
	return sign ? -minor : minor;
}

/** Formats minor units as a plain decimal string ("-1234.50"), the wire format of the API. */
export function formatAmount(minor: Minor): string {
	const negative = minor < 0n;
	const abs = negative ? -minor : minor;
	const whole = abs / 100n;
	const frac = (abs % 100n).toString().padStart(2, '0');
	return `${negative ? '-' : ''}${whole}.${frac}`;
}

/** Divides with rounding half away from zero. */
export function divRound(numerator: bigint, denominator: bigint): bigint {
	if (denominator === 0n) throw new RangeError('Division by zero');
	const negative = numerator < 0n !== denominator < 0n;
	const n = numerator < 0n ? -numerator : numerator;
	const d = denominator < 0n ? -denominator : denominator;
	const q = (n * 2n + d) / (d * 2n);
	return negative ? -q : q;
}

/** `amount * rate` where rate is in basis points, rounded to whole minor units. */
export function applyRate(amount: Minor, rateBp: number): Minor {
	return divRound(amount * BigInt(rateBp), 10_000n);
}

/** VAT contained in a gross (VAT-inclusive) amount. */
export function vatFromGross(gross: Minor, rateBp: number): Minor {
	return divRound(gross * BigInt(rateBp), 10_000n + BigInt(rateBp));
}

/** Splits an amount into parts proportional to weights; remainders go to the largest parts first. */
export function allocate(amount: Minor, weights: readonly number[]): Minor[] {
	if (weights.length === 0) throw new RangeError('allocate needs at least one weight');
	const big = weights.map((w) => BigInt(w));
	const total = big.reduce((a, b) => a + b, 0n);
	if (total === 0n) throw new RangeError('allocate weights must not sum to zero');
	const parts = big.map((w) => (amount * w) / total);
	let remainder = amount - parts.reduce((a, b) => a + b, 0n);
	const step = remainder < 0n ? -1n : 1n;
	const order = big.map((w, i) => ({ w, i })).sort((a, b) => (b.w > a.w ? 1 : b.w < a.w ? -1 : a.i - b.i));
	for (let k = 0; remainder !== 0n; k = (k + 1) % order.length) {
		parts[order[k]!.i]! += step;
		remainder -= step;
	}
	return parts;
}

export const sum = (values: Iterable<Minor>): Minor => {
	let total = 0n;
	for (const v of values) total += v;
	return total;
};
