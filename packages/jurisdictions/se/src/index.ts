import {
	addDays,
	endOfMonth,
	endOfQuarter,
	type Issue,
	type JurisdictionPack,
	type LocalDate,
	monthSpan,
} from '@countx3/core';
import { basAktiebolag, basEnskildFirma, classifyBasAccount } from './bas.ts';
import { isValidOrganisationsnummer, isValidPersonnummer } from './identifiers.ts';
import { balanceSheet, incomeStatement } from './layouts.ts';
import { swedishTaxCodes } from './tax-codes.ts';

export * from './bas.ts';
export * from './identifiers.ts';
export * from './tax-codes.ts';

const isWeekend = (date: LocalDate) => {
	const day = new Date(`${date}T00:00:00Z`).getUTCDay();
	return day === 0 || day === 6;
};

export const sweden: JurisdictionPack = {
	country: 'SE',
	name: 'Sverige',
	currency: 'SEK',
	legalForms: [
		{ code: 'AB', name: 'Aktiebolag' },
		{ code: 'EF', name: 'Enskild näringsidkare' },
	],
	chartTemplates: [basAktiebolag, basEnskildFirma],
	defaultChartTemplate: (legalForm) => (legalForm === 'EF' ? basEnskildFirma : basAktiebolag),
	classifyAccount: classifyBasAccount,
	defaultVoucherSeries: [
		{ code: 'A', name: 'Bokföring' },
		{ code: 'B', name: 'Kundfakturor' },
		{ code: 'C', name: 'Kundinbetalningar' },
		{ code: 'D', name: 'Leverantörsfakturor' },
		{ code: 'E', name: 'Leverantörsbetalningar' },
		{ code: 'L', name: 'Lön' },
	],
	taxCodes: swedishTaxCodes,
	reportLayouts: { balanceSheet, incomeStatement },
	resultTransferAccount: (legalForm) => (legalForm === 'EF' ? '2019' : '2099'),

	validateOrganizationNumber(value, legalForm) {
		const valid = legalForm === 'EF' ? isValidPersonnummer(value) : isValidOrganisationsnummer(value);
		if (valid) return null;
		return {
			code: 'ORGANIZATION_NUMBER_INVALID',
			path: 'organizationNumber',
			message: `"${value}" is not a valid ${legalForm === 'EF' ? 'personnummer' : 'organisationsnummer'}.`,
			hint: 'Use the format NNNNNN-NNNN; the last digit is a Luhn check digit.',
		};
	},

	// Bokföringslagen 3 kap.
	validateFiscalYear(fy, { legalForm, previousEnd }) {
		const issues: Issue[] = [];
		if (!fy.start.endsWith('-01')) {
			issues.push({
				code: 'FISCAL_YEAR_START',
				path: 'start',
				message: 'A fiscal year must start on the first day of a month.',
			});
		}
		if (fy.end !== endOfMonth(fy.end)) {
			issues.push({
				code: 'FISCAL_YEAR_END',
				path: 'end',
				message: 'A fiscal year must end on the last day of a month.',
			});
		}
		if (legalForm === 'EF' && (!fy.start.endsWith('-01-01') || !fy.end.endsWith('-12-31'))) {
			issues.push({
				code: 'FISCAL_YEAR_CALENDAR_REQUIRED',
				message: 'A sole trader (enskild näringsidkare) must use the calendar year (BFL 3:1).',
			});
		}
		const months = monthSpan(fy.start, fy.end);
		if (previousEnd === undefined) {
			if (months < 1 || months > 18) {
				issues.push({
					code: 'FISCAL_YEAR_LENGTH',
					message: 'The first fiscal year may be 1–18 months (BFL 3:3).',
				});
			}
		} else {
			if (fy.start !== addDays(previousEnd, 1)) {
				issues.push({
					code: 'FISCAL_YEAR_GAP',
					path: 'start',
					message: `The fiscal year must start the day after the previous one ends (${addDays(previousEnd, 1)}).`,
				});
			}
			if (months !== 12) {
				issues.push({
					code: 'FISCAL_YEAR_LENGTH',
					message: 'A fiscal year must be 12 months; changing it needs Skatteverket approval in most cases.',
				});
			}
		}
		return issues;
	},

	// BFL 5:2 and BFN vägledning 2013:2 punkt 3.6–3.7.
	bookingDeadline(transactionDate, { cash, smallCompany }) {
		if (cash) {
			let next = addDays(transactionDate, 1);
			while (isWeekend(next)) next = addDays(next, 1);
			return next;
		}
		return addDays(smallCompany ? endOfQuarter(transactionDate) : endOfMonth(transactionDate), 50);
	},

	// BFL 7:2: until the end of the seventh year after the calendar year in which the fiscal year ended.
	archiveUntil: (fiscalYearEnd) => `${Number(fiscalYearEnd.slice(0, 4)) + 7}-12-31`,
};
