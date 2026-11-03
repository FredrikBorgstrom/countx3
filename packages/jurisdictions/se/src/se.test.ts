import { describe, expect, test } from 'bun:test';
import { rateOn } from '@countx3/core';
import {
	basAktiebolag,
	basEnskildFirma,
	isValidBankgiro,
	isValidOcrReference,
	isValidOrganisationsnummer,
	isValidPersonnummer,
	ocrReference,
	sweden,
	swedishTaxCodes,
} from './index.ts';

describe('identifiers', () => {
	test('organisationsnummer and personnummer', () => {
		expect(isValidOrganisationsnummer('556036-0793')).toBe(true);
		expect(isValidOrganisationsnummer('556036-0794')).toBe(false);
		expect(isValidOrganisationsnummer('811218-9876')).toBe(false);
		expect(isValidPersonnummer('811218-9876')).toBe(true);
		expect(isValidPersonnummer('19811218-9876')).toBe(true);
		expect(sweden.validateOrganizationNumber('811218-9876', 'EF')).toBeNull();
		expect(sweden.validateOrganizationNumber('811218-9876', 'AB')?.code).toBe('ORGANIZATION_NUMBER_INVALID');
	});

	test('OCR references and bankgiro', () => {
		const ocr = ocrReference('12345');
		expect(ocr).toBe('1234574');
		expect(isValidOcrReference(ocr, true)).toBe(true);
		expect(isValidOcrReference('1234575')).toBe(false);
		expect(isValidBankgiro('5050-1055')).toBe(true);
		expect(isValidBankgiro('5050-1056')).toBe(false);
	});
});

describe('chart of accounts', () => {
	test('every starter account is classified and unique', () => {
		for (const chart of [basAktiebolag, basEnskildFirma]) {
			const numbers = chart.accounts.map((a) => a.number);
			expect(new Set(numbers).size).toBe(numbers.length);
			for (const a of chart.accounts) expect(a.type).toBeDefined();
		}
		expect(sweden.classifyAccount('2099')).toBe('equity');
		expect(sweden.classifyAccount('2440')).toBe('liability');
		expect(sweden.classifyAccount('8410')).toBe('expense');
	});

	test('default tax codes exist', () => {
		const codes = new Set(swedishTaxCodes.map((c) => c.code));
		for (const a of basAktiebolag.accounts)
			if (a.defaultTaxCode) expect(codes.has(a.defaultTaxCode)).toBe(true);
	});
});

describe('rules', () => {
	test('food VAT follows the temporary reduction', () => {
		const food = swedishTaxCodes.find((c) => c.code === 'MPL')!;
		expect([
			rateOn(food, '2026-03-31'),
			rateOn(food, '2026-04-01'),
			rateOn(food, '2027-12-31'),
			rateOn(food, '2028-01-01'),
		]).toEqual([1200, 600, 600, 1200]);
	});

	test('fiscal years', () => {
		const codes = (start: string, end: string, legalForm: string, previousEnd?: string) =>
			sweden.validateFiscalYear({ start, end }, { legalForm, previousEnd }).map((i) => i.code);
		expect(codes('2026-01-01', '2026-12-31', 'EF')).toEqual([]);
		expect(codes('2026-05-01', '2027-04-30', 'AB', '2026-04-30')).toEqual([]);
		expect(codes('2026-05-01', '2027-04-30', 'EF')).toEqual(['FISCAL_YEAR_CALENDAR_REQUIRED']);
		expect(codes('2026-03-01', '2027-08-31', 'AB')).toEqual([]);
		expect(codes('2026-03-01', '2027-09-30', 'AB')).toEqual(['FISCAL_YEAR_LENGTH']);
		expect(codes('2026-01-15', '2026-12-30', 'AB')).toEqual(['FISCAL_YEAR_START', 'FISCAL_YEAR_END']);
	});

	test('booking deadlines and archiving', () => {
		expect(sweden.bookingDeadline('2026-10-30', { cash: true, smallCompany: false })).toBe('2026-11-02');
		expect(sweden.bookingDeadline('2026-10-05', { cash: false, smallCompany: false })).toBe('2026-12-20');
		expect(sweden.bookingDeadline('2026-10-05', { cash: false, smallCompany: true })).toBe('2027-02-19');
		expect(sweden.archiveUntil('2026-06-30')).toBe('2033-12-31');
	});
});
