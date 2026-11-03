import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { allocate, applyRate, divRound, formatAmount, parseAmount, vatFromGross } from './money.ts';

describe('amounts', () => {
	test('parses and formats', () => {
		expect(parseAmount('1234.5')).toBe(123450n);
		expect(parseAmount('-0,75')).toBe(-75n);
		expect(parseAmount('1 234,50')).toBe(123450n);
		expect(formatAmount(-5n)).toBe('-0.05');
		expect(() => parseAmount('1.234')).toThrow('not a valid amount');
	});

	test('format/parse round-trips', () => {
		fc.assert(
			fc.property(
				fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
				(n) => parseAmount(formatAmount(n)) === n,
			),
		);
	});

	test('rounds half away from zero', () => {
		expect(divRound(5n, 2n)).toBe(3n);
		expect(divRound(-5n, 2n)).toBe(-3n);
		expect(divRound(4n, 3n)).toBe(1n);
	});

	test('VAT helpers', () => {
		expect(applyRate(10000n, 2500)).toBe(2500n);
		expect(vatFromGross(12500n, 2500)).toBe(2500n);
		expect(vatFromGross(10600n, 600)).toBe(600n);
		expect(applyRate(333n, 1200)).toBe(40n);
	});

	test('allocate always sums to the amount', () => {
		fc.assert(
			fc.property(
				fc.bigInt({ min: -(10n ** 9n), max: 10n ** 9n }),
				fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 8 }),
				(amount, weights) => allocate(amount, weights).reduce((a, b) => a + b, 0n) === amount,
			),
		);
		expect(allocate(100n, [1, 1, 1])).toEqual([34n, 33n, 33n]);
	});
});
