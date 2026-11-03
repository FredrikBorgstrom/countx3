import type { ReportLayout } from '@countx3/core';

const r = (from: string, to: string) => ({ from, to });

/** Resultaträkning, kostnadsslagsindelad, following the K2 schema grouping of BAS accounts. */
export const incomeStatement: ReportLayout = {
	id: 'se-k2-income-statement',
	title: 'Resultaträkning',
	negate: true,
	rows: [
		{ key: 'netSales', label: 'Nettoomsättning', ranges: [r('3000', '3799')] },
		{ key: 'otherOperatingIncome', label: 'Övriga rörelseintäkter', ranges: [r('3800', '3999')] },
		{ key: 'operatingIncome', label: 'Summa rörelseintäkter', total: ['netSales', 'otherOperatingIncome'] },
		{ key: 'goods', label: 'Råvaror och förnödenheter / handelsvaror', ranges: [r('4000', '4999')] },
		{ key: 'otherExternal', label: 'Övriga externa kostnader', ranges: [r('5000', '6999')] },
		{ key: 'personnel', label: 'Personalkostnader', ranges: [r('7000', '7699')] },
		{ key: 'depreciation', label: 'Av- och nedskrivningar', ranges: [r('7700', '7899')] },
		{ key: 'otherOperatingCosts', label: 'Övriga rörelsekostnader', ranges: [r('7900', '7999')] },
		{
			key: 'operatingResult',
			label: 'Rörelseresultat',
			total: [
				'operatingIncome',
				'goods',
				'otherExternal',
				'personnel',
				'depreciation',
				'otherOperatingCosts',
			],
		},
		{ key: 'financialIncome', label: 'Finansiella intäkter', ranges: [r('8000', '8399')] },
		{ key: 'financialCosts', label: 'Finansiella kostnader', ranges: [r('8400', '8799')] },
		{
			key: 'resultAfterFinancial',
			label: 'Resultat efter finansiella poster',
			total: ['operatingResult', 'financialIncome', 'financialCosts'],
		},
		{ key: 'appropriations', label: 'Bokslutsdispositioner', ranges: [r('8800', '8899')] },
		{ key: 'tax', label: 'Skatt', ranges: [r('8900', '8989')] },
		{ key: 'yearResult', label: 'Årets resultat', total: ['resultAfterFinancial', 'appropriations', 'tax'] },
	],
};

/** Balansräkning. Assets are debit-normal; equity and liabilities rows are negated to show as positive. */
export const balanceSheet: ReportLayout = {
	id: 'se-k2-balance-sheet',
	title: 'Balansräkning',
	negate: false,
	rows: [
		{ key: 'intangible', label: 'Immateriella anläggningstillgångar', ranges: [r('1000', '1099')] },
		{ key: 'tangible', label: 'Materiella anläggningstillgångar', ranges: [r('1100', '1299')] },
		{ key: 'financialFixed', label: 'Finansiella anläggningstillgångar', ranges: [r('1300', '1399')] },
		{
			key: 'fixedAssets',
			label: 'Summa anläggningstillgångar',
			total: ['intangible', 'tangible', 'financialFixed'],
		},
		{ key: 'inventory', label: 'Varulager', ranges: [r('1400', '1499')] },
		{ key: 'receivables', label: 'Kortfristiga fordringar', ranges: [r('1500', '1799')] },
		{ key: 'investments', label: 'Kortfristiga placeringar', ranges: [r('1800', '1899')] },
		{ key: 'cash', label: 'Kassa och bank', ranges: [r('1900', '1999')] },
		{
			key: 'currentAssets',
			label: 'Summa omsättningstillgångar',
			total: ['inventory', 'receivables', 'investments', 'cash'],
		},
		{ key: 'totalAssets', label: 'Summa tillgångar', total: ['fixedAssets', 'currentAssets'] },
		{ key: 'equity', label: 'Eget kapital', ranges: [r('2000', '2099')], negate: true },
		// Result accounts net to zero once the year-end closing voucher moves 8999 to equity.
		{ key: 'unclosedResult', label: 'Beräknat resultat', ranges: [r('3000', '8999')], negate: true },
		{ key: 'untaxedReserves', label: 'Obeskattade reserver', ranges: [r('2100', '2199')], negate: true },
		{ key: 'provisions', label: 'Avsättningar', ranges: [r('2200', '2299')], negate: true },
		{ key: 'longTermLiabilities', label: 'Långfristiga skulder', ranges: [r('2300', '2399')], negate: true },
		{ key: 'currentLiabilities', label: 'Kortfristiga skulder', ranges: [r('2400', '2999')], negate: true },
		{
			key: 'totalEquityAndLiabilities',
			label: 'Summa eget kapital och skulder',
			total: [
				'equity',
				'unclosedResult',
				'untaxedReserves',
				'provisions',
				'longTermLiabilities',
				'currentLiabilities',
			],
		},
	],
};
