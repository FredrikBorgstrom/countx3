import type { LocalDate } from './dates.ts';
import type { Issue } from './errors.ts';
import type { Account, AccountType } from './ledger.ts';
import type { ReportLayout } from './reports.ts';
import type { TaxCode } from './tax.ts';

export interface ChartTemplate {
	id: string;
	name: string;
	accounts: readonly Account[];
}

export interface LegalForm {
	code: string;
	name: string;
}

/**
 * Everything country-specific lives behind this interface; the core ledger never names a country.
 * Later modules (VAT returns, annual reports, e-invoicing, payroll) add their own members here.
 */
export interface JurisdictionPack {
	/** ISO 3166-1 alpha-2. */
	country: string;
	name: string;
	currency: string;
	legalForms: readonly LegalForm[];
	chartTemplates: readonly ChartTemplate[];
	defaultChartTemplate(legalForm: string): ChartTemplate;
	classifyAccount(number: string): AccountType | undefined;
	defaultVoucherSeries: readonly { code: string; name: string }[];
	taxCodes: readonly TaxCode[];
	reportLayouts: { balanceSheet: ReportLayout; incomeStatement: ReportLayout };
	/** Account that receives the year's result when a fiscal year is closed. */
	resultTransferAccount(legalForm: string): string;
	validateOrganizationNumber(value: string, legalForm: string): Issue | null;
	validateFiscalYear(
		fy: { start: LocalDate; end: LocalDate },
		opts: { legalForm: string; previousEnd?: LocalDate | undefined },
	): Issue[];
	/** Last day a transaction may be booked (grundbokföring). */
	bookingDeadline(transactionDate: LocalDate, opts: { cash: boolean; smallCompany: boolean }): LocalDate;
	/** Last day the accounting records must be kept. */
	archiveUntil(fiscalYearEnd: LocalDate): LocalDate;
}
