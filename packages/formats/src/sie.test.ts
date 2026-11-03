import { describe, expect, test } from 'bun:test';
import { CP437_HIGH_LENGTH, decodeCp437, encodeCp437 } from './cp437.ts';
import { parseSie, type SieDocument, tokenize, writeSie } from './sie.ts';

describe('cp437', () => {
	test('covers all high bytes and round-trips Swedish text', () => {
		expect(CP437_HIGH_LENGTH).toBe(128);
		const text = 'Företagskonto ÅÄÖ åäö é';
		expect(decodeCp437(encodeCp437(text))).toBe(text);
		expect([...encodeCp437('åäöÅÄÖ')]).toEqual([0x86, 0x84, 0x94, 0x8f, 0x8e, 0x99]);
	});
});

describe('SIE 4', () => {
	test('tokenizes quotes, escapes and object lists', () => {
		expect(tokenize('#TRANS 1930 {"1" "Nord"} -1000.50 20260115 "Text \\"x\\""')).toEqual([
			'#TRANS',
			'1930',
			['1', 'Nord'],
			'-1000.50',
			'20260115',
			'Text "x"',
		]);
		expect(tokenize('#TRANS 3001 {} 5')).toEqual(['#TRANS', '3001', [], '5']);
	});

	test('reads a file from another program (PC8, CRLF, unknown labels)', () => {
		const file = [
			'#FLAGGA 0',
			'#PROGRAM "Annat program" 3.1',
			'#FORMAT PC8',
			'#GEN 20270115',
			'#SIETYP 4',
			'#FNAMN "Exempel Åkeri AB"',
			'#ORGNR 556036-0793',
			'#RAR 0 20260101 20261231',
			'#RAR -1 20250101 20251231',
			'#KONTO 1930 "Företagskonto"',
			'#KTYP 1930 T',
			'#KONTO 3001 "Försäljning"',
			'#SRU 1930 7281',
			'#IB 0 1930 10000.00',
			'#IB -1 1930 2500',
			'#VER A 1 20260115 "Faktura 1001" 20260116',
			'{',
			'#TRANS 1930 {} 1250.00',
			'#BTRANS 1930 {} 99.00',
			'#TRANS 3001 {} -1000.00 20260115 "Konsult"',
			'#TRANS 2611 {} -250.00',
			'}',
			'#FOO bar',
		].join('\r\n');
		const { document, warnings } = parseSie(encodeCp437(file));
		expect(document.companyName).toBe('Exempel Åkeri AB');
		expect(document.fiscalYears).toEqual([
			{ index: 0, start: '2026-01-01', end: '2026-12-31' },
			{ index: -1, start: '2025-01-01', end: '2025-12-31' },
		]);
		expect(document.accounts[0]).toEqual({ number: '1930', name: 'Företagskonto', type: 'asset' });
		expect(document.openingBalances).toEqual([
			{ yearIndex: 0, account: '1930', amount: 1000000n },
			{ yearIndex: -1, account: '1930', amount: 250000n },
		]);
		expect(document.vouchers).toHaveLength(1);
		expect(document.vouchers[0]!.transactions.map((t) => t.amount)).toEqual([125000n, -100000n, -25000n]);
		expect(document.vouchers[0]!.transactions[1]!.text).toBe('Konsult');
		expect(warnings).toEqual(['line 23: #FOO is not supported and was skipped']);
	});

	test('write → parse round-trips', () => {
		const doc: SieDocument = {
			program: { name: 'countx3', version: '0.1' },
			generatedOn: '2026-11-03',
			companyName: 'Rund "Tur" AB',
			organizationNumber: '556036-0793',
			currency: 'SEK',
			fiscalYears: [{ index: 0, start: '2026-01-01', end: '2026-12-31' }],
			accounts: [
				{ number: '1930', name: 'Företagskonto', type: 'asset' },
				{ number: '2440', name: 'Leverantörsskulder', type: 'liability' },
				{ number: '6110', name: 'Kontorsmateriel', type: 'expense' },
			],
			openingBalances: [{ yearIndex: 0, account: '1930', amount: 500000n }],
			closingBalances: [{ yearIndex: 0, account: '1930', amount: 400000n }],
			results: [{ yearIndex: 0, account: '6110', amount: 100000n }],
			vouchers: [
				{
					series: 'A',
					number: 1,
					date: '2026-03-10',
					text: 'Pärmar',
					registeredOn: '2026-03-11',
					transactions: [
						{ account: '6110', amount: 100000n, text: 'Pärmar', quantity: 4 },
						{ account: '1930', amount: -100000n },
					],
				},
			],
		};
		const { bytes } = writeSie(doc);
		const { document, warnings } = parseSie(bytes);
		expect(warnings).toEqual([]);
		expect(document).toEqual({
			...doc,
			accounts: doc.accounts,
			vouchers: [
				{
					...doc.vouchers[0]!,
					transactions: [
						{ ...doc.vouchers[0]!.transactions[0]!, date: undefined },
						{ account: '1930', amount: -100000n, date: undefined, text: undefined, quantity: undefined },
					],
				},
			],
		});
	});
});
