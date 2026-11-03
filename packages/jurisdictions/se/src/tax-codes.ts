import type { TaxCode } from '@countx3/core';

const ALWAYS = '1900-01-01';
const always = (rateBp: number) => [{ from: ALWAYS, rateBp }];

/**
 * Swedish tax codes. Rates are date-effective: food moved from 12 % to 6 % for
 * 2026-04-01 – 2027-12-31 (restaurant and catering services stay at 12 %).
 * Mapping to momsdeklaration boxes is added with the VAT return module.
 */
export const swedishTaxCodes: TaxCode[] = [
	{ code: 'MP1', label: 'Utgående moms 25 %', kind: 'output', rates: always(2500), vatAccount: '2611' },
	{ code: 'MP2', label: 'Utgående moms 12 %', kind: 'output', rates: always(1200), vatAccount: '2621' },
	{ code: 'MP3', label: 'Utgående moms 6 %', kind: 'output', rates: always(600), vatAccount: '2631' },
	{
		code: 'MPL',
		label: 'Utgående moms livsmedel',
		kind: 'output',
		rates: [
			{ from: ALWAYS, to: '2026-03-31', rateBp: 1200, vatAccount: '2621' },
			{ from: '2026-04-01', to: '2027-12-31', rateBp: 600, vatAccount: '2631' },
			{ from: '2028-01-01', rateBp: 1200, vatAccount: '2621' },
		],
	},
	{ code: 'IP1', label: 'Ingående moms 25 %', kind: 'input', rates: always(2500), vatAccount: '2641' },
	{ code: 'IP2', label: 'Ingående moms 12 %', kind: 'input', rates: always(1200), vatAccount: '2641' },
	{ code: 'IP3', label: 'Ingående moms 6 %', kind: 'input', rates: always(600), vatAccount: '2641' },
	{
		code: 'EUIV',
		label: 'Inköp av varor från annat EU-land (omvänd skattskyldighet)',
		kind: 'reverse_charge',
		rates: always(2500),
		vatAccount: '2614',
		inputVatAccount: '2645',
	},
	{
		code: 'EUIT',
		label: 'Inköp av tjänster från annat EU-land (omvänd skattskyldighet)',
		kind: 'reverse_charge',
		rates: always(2500),
		vatAccount: '2614',
		inputVatAccount: '2645',
	},
	{
		code: 'IMPTJ',
		label: 'Inköp av tjänster från land utanför EU (omvänd skattskyldighet)',
		kind: 'reverse_charge',
		rates: always(2500),
		vatAccount: '2614',
		inputVatAccount: '2645',
	},
	{
		code: 'OMVBYGG',
		label: 'Inköp av byggtjänster i Sverige (omvänd skattskyldighet)',
		kind: 'reverse_charge',
		rates: always(2500),
		vatAccount: '2614',
		inputVatAccount: '2647',
	},
	{ code: 'EUFV', label: 'Försäljning av varor till annat EU-land', kind: 'eu_goods_sale', rates: always(0) },
	{
		code: 'EUFT',
		label: 'Försäljning av tjänster till annat EU-land',
		kind: 'eu_services_sale',
		rates: always(0),
	},
	{ code: 'EXP', label: 'Export utanför EU', kind: 'export', rates: always(0) },
	{ code: 'MF', label: 'Momsfri försäljning', kind: 'exempt', rates: always(0) },
];
