import type { LocalDate } from './dates.ts';
import { DomainError } from './errors.ts';

export type TaxKind =
	| 'output' // VAT on domestic sales
	| 'input' // deductible VAT on purchases
	| 'reverse_charge' // buyer accounts for the VAT (EU purchases, construction services, imports)
	| 'exempt'
	| 'export'
	| 'eu_goods_sale'
	| 'eu_services_sale';

export interface TaxRatePeriod {
	from: LocalDate;
	/** Inclusive; open-ended when missing. */
	to?: LocalDate | undefined;
	rateBp: number;
	/** Overrides TaxCode.vatAccount for this period, when the account follows the rate. */
	vatAccount?: string | undefined;
}

export interface TaxCode {
	code: string;
	label: string;
	kind: TaxKind;
	/** Rates change over time (e.g. Swedish food VAT 12 % → 6 % on 2026-04-01), so they are date-effective. */
	rates: readonly TaxRatePeriod[];
	/** Account the VAT amount is booked to. */
	vatAccount?: string | undefined;
	/** For reverse charge: the account for the deductible input VAT. */
	inputVatAccount?: string | undefined;
}

export function ratePeriodOn(code: TaxCode, date: LocalDate): TaxRatePeriod {
	const period = code.rates.find((r) => r.from <= date && (r.to === undefined || date <= r.to));
	if (!period) {
		throw new DomainError('TAX_RATE_NOT_EFFECTIVE', `Tax code ${code.code} has no rate on ${date}.`, {
			hint: 'Check the transaction date or choose another tax code.',
		});
	}
	return period;
}

export const rateOn = (code: TaxCode, date: LocalDate) => ratePeriodOn(code, date).rateBp;

export const vatAccountOn = (code: TaxCode, date: LocalDate) =>
	ratePeriodOn(code, date).vatAccount ?? code.vatAccount;
