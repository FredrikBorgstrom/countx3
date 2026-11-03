import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { addMonths, endOfMonth, endOfQuarter, parseDate } from './dates.ts';
import { GENESIS_HASH, verifyChain, voucherHash } from './hashchain.ts';
import { type Account, type BookedVoucher, entriesOf, reversalOf, type VoucherInput } from './ledger.ts';
import { applyLayout, generalLedger, type ReportLayout, trialBalance } from './reports.ts';
import { rateOn, type TaxCode } from './tax.ts';
import { type LedgerContext, validateVoucher } from './validation.ts';

const accounts: Account[] = [
	{ number: '1930', name: 'Företagskonto', type: 'asset', active: true },
	{ number: '2641', name: 'Debiterad ingående moms', type: 'liability', active: true },
	{ number: '3001', name: 'Försäljning 25 %', type: 'income', active: true },
	{ number: '2611', name: 'Utgående moms 25 %', type: 'liability', active: true },
	{ number: '5410', name: 'Förbrukningsinventarier', type: 'expense', active: true },
	{ number: '6991', name: 'Gammalt konto', type: 'expense', active: false },
];

const ctx: LedgerContext = {
	accounts: new Map(accounts.map((a) => [a.number, a])),
	fiscalYears: [
		{ id: 'fy25', start: '2025-01-01', end: '2025-12-31', closed: true },
		{ id: 'fy26', start: '2026-01-01', end: '2026-12-31', closed: false },
	],
	lockedThrough: '2026-01-31',
	knownSeries: new Set(['A']),
};

const purchase: VoucherInput = {
	series: 'A',
	date: '2026-03-10',
	description: 'Skrivbordslampa',
	lines: [
		{ account: '5410', amount: 80000n },
		{ account: '2641', amount: 20000n },
		{ account: '1930', amount: -100000n },
	],
};

const codes = (input: VoucherInput) => validateVoucher(input, ctx).map((i) => i.code);

describe('voucher validation', () => {
	test('accepts a balanced voucher', () => {
		expect(codes(purchase)).toEqual([]);
	});

	test('reports every problem with a stable code', () => {
		expect(
			codes({
				...purchase,
				lines: [
					{ account: '5410', amount: 1n },
					{ account: '1930', amount: 0n },
				],
			}),
		).toEqual(['LINE_AMOUNT_ZERO', 'VOUCHER_UNBALANCED']);
		expect(codes({ ...purchase, description: ' ', series: 'Z' })).toEqual([
			'DESCRIPTION_REQUIRED',
			'SERIES_UNKNOWN',
		]);
		expect(codes({ ...purchase, date: '2025-06-01' })).toEqual(['FISCAL_YEAR_CLOSED', 'PERIOD_LOCKED']);
		expect(codes({ ...purchase, date: '2026-01-15' })).toEqual(['PERIOD_LOCKED']);
		expect(codes({ ...purchase, date: '2027-02-30' })).toEqual(['DATE_INVALID']);
		expect(
			codes({
				...purchase,
				lines: [
					{ account: '6991', amount: 5n },
					{ account: '9999', amount: -5n },
				],
			}),
		).toEqual(['ACCOUNT_INACTIVE', 'ACCOUNT_UNKNOWN']);
	});

	test('every random voucher is reported unbalanced iff it does not sum to zero', () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.bigInt({ min: -1000000n, max: 1000000n }).filter((n) => n !== 0n),
					{ minLength: 2, maxLength: 6 },
				),
				(amounts) => {
					const lines = amounts.map((amount) => ({ account: '1930', amount }));
					const unbalanced = codes({ ...purchase, lines }).includes('VOUCHER_UNBALANCED');
					return unbalanced === (amounts.reduce((a, b) => a + b, 0n) !== 0n);
				},
			),
		);
	});
});

async function book(inputs: VoucherInput[]): Promise<BookedVoucher[]> {
	const booked: BookedVoucher[] = [];
	let prevHash = GENESIS_HASH;
	for (const [i, input] of inputs.entries()) {
		const v = {
			...input,
			id: `v${i + 1}`,
			companyId: 'c1',
			number: i + 1,
			bookingSeq: i + 1,
			bookedAt: `2026-03-1${i}T10:00:00.000Z`,
			bookedBy: { type: 'agent' as const, id: 't1', name: 'Claude Code', client: 'claude-code' },
			prevHash,
		};
		const hash = await voucherHash(v);
		booked.push({ ...v, hash });
		prevHash = hash;
	}
	return booked;
}

describe('hash chain', () => {
	test('detects tampering, reordering and gaps', async () => {
		const chain = await book([
			purchase,
			{ ...purchase, date: '2026-03-11' },
			{ ...purchase, date: '2026-03-12' },
		]);
		expect(await verifyChain(chain)).toBeNull();

		const tampered = chain.map((v) =>
			v.id === 'v2' ? { ...v, lines: [{ ...v.lines[0]!, amount: 1n }, ...v.lines.slice(1)] } : v,
		);
		expect(await verifyChain(tampered)).toEqual({ bookingSeq: 2, voucherId: 'v2', reason: 'HASH_MISMATCH' });
		expect((await verifyChain([chain[0]!, chain[2]!]))?.reason).toBe('SEQUENCE_GAP');
	});
});

describe('reports', () => {
	test('trial balance, general ledger and layout', async () => {
		const [v1, v2] = await book([
			purchase,
			{
				series: 'A',
				date: '2026-04-02',
				description: 'Faktura 1001',
				lines: [
					{ account: '1930', amount: 125000n },
					{ account: '3001', amount: -100000n },
					{ account: '2611', amount: -25000n },
				],
			},
		]);
		const data = {
			accounts,
			openingBalances: new Map([['1930', 500000n]]),
			entries: [...entriesOf(v1!), ...entriesOf(v2!)],
		};
		const tb = trialBalance(data, '2026-04-01', '2026-04-30');
		expect(tb.find((r) => r.account === '1930')).toEqual({
			account: '1930',
			name: 'Företagskonto',
			opening: 400000n,
			debit: 125000n,
			credit: 0n,
			closing: 525000n,
		});
		expect(tb.find((r) => r.account === '5410')?.opening).toBe(80000n);

		const gl = generalLedger(data, '2026-01-01', '2026-12-31').find((a) => a.account === '1930')!;
		expect(gl.lines.map((l) => l.balance)).toEqual([400000n, 525000n]);

		const layout: ReportLayout = {
			id: 'is',
			title: 'Resultaträkning',
			negate: true,
			rows: [
				{ key: 'revenue', label: 'Nettoomsättning', ranges: [{ from: '3000', to: '3799' }] },
				{ key: 'other', label: 'Övriga externa kostnader', ranges: [{ from: '5000', to: '6999' }] },
				{ key: 'result', label: 'Resultat', total: ['revenue', 'other'] },
			],
		};
		const full = trialBalance(data, '2026-01-01', '2026-12-31');
		const rows = applyLayout(layout, full, (r) => r.closing);
		expect(rows.map((r) => [r.key, r.amount])).toEqual([
			['revenue', 100000n],
			['other', -80000n],
			['result', 20000n],
		]);
	});

	test('reversal negates every line and references the original', async () => {
		const [v1] = await book([purchase]);
		const reversal = reversalOf(v1!, '2026-03-20', 'fel konto');
		expect(reversal.correctsVoucherId).toBe('v1');
		expect(reversal.lines.map((l) => l.amount)).toEqual([-80000n, -20000n, 100000n]);
		expect(codes(reversal)).toEqual([]);
	});
});

describe('dates and tax', () => {
	test('calendar helpers', () => {
		expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
		expect(endOfQuarter('2026-05-03')).toBe('2026-06-30');
		expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
		expect(() => parseDate('2026-13-01')).toThrow();
	});

	test('date-effective rates', () => {
		const food: TaxCode = {
			code: 'FOOD',
			label: 'Livsmedel',
			kind: 'output',
			rates: [
				{ from: '1900-01-01', to: '2026-03-31', rateBp: 1200 },
				{ from: '2026-04-01', to: '2027-12-31', rateBp: 600 },
				{ from: '2028-01-01', rateBp: 1200 },
			],
		};
		expect(rateOn(food, '2026-03-31')).toBe(1200);
		expect(rateOn(food, '2026-04-01')).toBe(600);
		expect(rateOn(food, '2028-01-01')).toBe(1200);
	});
});
