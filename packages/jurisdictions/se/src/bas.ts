import type { Account, AccountType } from '@countx3/core';

/**
 * BAS classification by account number. Class 2 holds both equity (20–21) and liabilities (22–29);
 * class 8 holds financial income (80–83) and costs, appropriations and tax (84–89).
 */
export function classifyBasAccount(number: string): AccountType | undefined {
	if (!/^\d{4}$/.test(number)) return undefined;
	const n = Number(number);
	if (n >= 1000 && n < 2000) return 'asset';
	if (n >= 2000 && n < 2200) return 'equity';
	if (n >= 2200 && n < 3000) return 'liability';
	if (n >= 3000 && n < 4000) return 'income';
	if (n >= 4000 && n < 8000) return 'expense';
	if (n >= 8000 && n < 8400) return 'income';
	if (n >= 8400 && n < 10000) return 'expense';
	return undefined;
}

type Row = readonly [number: string, name: string, defaultTaxCode?: string];

/**
 * A curated starter chart for small companies, using BAS account numbers and names.
 * The full BAS 2026 chart is added once its licence for embedding is confirmed with BAS-kontogruppen.
 */
const common: Row[] = [
	['1210', 'Maskiner och andra tekniska anläggningar'],
	['1219', 'Ackumulerade avskrivningar på maskiner och andra tekniska anläggningar'],
	['1220', 'Inventarier och verktyg'],
	['1229', 'Ackumulerade avskrivningar på inventarier och verktyg'],
	['1250', 'Datorer'],
	['1259', 'Ackumulerade avskrivningar på datorer'],
	['1380', 'Andra långfristiga fordringar'],
	['1460', 'Lager av handelsvaror'],
	['1510', 'Kundfordringar'],
	['1630', 'Avräkning för skatter och avgifter (skattekonto)'],
	['1650', 'Momsfordran'],
	['1680', 'Andra kortfristiga fordringar'],
	['1710', 'Förutbetalda hyreskostnader'],
	['1790', 'Övriga förutbetalda kostnader och upplupna intäkter'],
	['1910', 'Kassa'],
	['1920', 'PlusGiro'],
	['1930', 'Företagskonto/checkkonto/affärskonto'],
	['1940', 'Övriga bankkonton'],
	['2350', 'Övriga långfristiga skulder till kreditinstitut'],
	['2440', 'Leverantörsskulder'],
	['2510', 'Skatteskulder'],
	['2611', 'Utgående moms på försäljning inom Sverige, 25 %'],
	['2614', 'Utgående moms omvänd skattskyldighet, 25 %'],
	['2615', 'Utgående moms import av varor, 25 %'],
	['2621', 'Utgående moms på försäljning inom Sverige, 12 %'],
	['2631', 'Utgående moms på försäljning inom Sverige, 6 %'],
	['2641', 'Debiterad ingående moms'],
	['2645', 'Beräknad ingående moms på förvärv från utlandet'],
	['2647', 'Ingående moms omvänd skattskyldighet varor och tjänster i Sverige'],
	['2650', 'Redovisningskonto för moms'],
	['2710', 'Personalskatt'],
	['2731', 'Avräkning lagstadgade sociala avgifter'],
	['2890', 'Övriga kortfristiga skulder'],
	['2893', 'Skulder till närstående personer, kortfristig del'],
	['2910', 'Upplupna löner'],
	['2920', 'Upplupna semesterlöner'],
	['2940', 'Upplupna lagstadgade sociala och andra avgifter'],
	['2990', 'Övriga upplupna kostnader och förutbetalda intäkter'],
	['3001', 'Försäljning inom Sverige, 25 % moms', 'MP1'],
	['3002', 'Försäljning inom Sverige, 12 % moms', 'MP2'],
	['3003', 'Försäljning inom Sverige, 6 % moms', 'MP3'],
	['3004', 'Försäljning inom Sverige, momsfri', 'MF'],
	['3105', 'Försäljning varor till land utanför EU', 'EXP'],
	['3106', 'Försäljning varor till annat EU-land, momsfri', 'EUFV'],
	['3305', 'Försäljning tjänster till land utanför EU', 'EXP'],
	['3308', 'Försäljning tjänster till annat EU-land', 'EUFT'],
	['3740', 'Öres- och kronutjämning'],
	['3960', 'Valutakursvinster på fordringar och skulder av rörelsekaraktär'],
	['3990', 'Övriga ersättningar och intäkter'],
	['4010', 'Inköp material och varor', 'IP1'],
	['4056', 'Inköp av varor från annat EU-land, 25 %', 'EUIV'],
	['4531', 'Import tjänster land utanför EU, 25 % moms', 'IMPTJ'],
	['4535', 'Inköp av tjänster från annat EU-land, 25 %', 'EUIT'],
	['5010', 'Lokalhyra', 'IP1'],
	['5090', 'Övriga lokalkostnader', 'IP1'],
	['5410', 'Förbrukningsinventarier', 'IP1'],
	['5460', 'Förbrukningsmaterial', 'IP1'],
	['5611', 'Drivmedel för personbilar', 'IP1'],
	['5800', 'Resekostnader', 'IP1'],
	['5810', 'Biljetter', 'IP3'],
	['5831', 'Kost och logi i Sverige', 'IP2'],
	['5910', 'Annonsering', 'IP1'],
	['6071', 'Representation, avdragsgill', 'IP1'],
	['6072', 'Representation, ej avdragsgill'],
	['6110', 'Kontorsmateriel', 'IP1'],
	['6212', 'Mobiltelefon', 'IP1'],
	['6230', 'Datakommunikation', 'IP1'],
	['6250', 'Postbefordran'],
	['6310', 'Företagsförsäkringar'],
	['6530', 'Redovisningstjänster', 'IP1'],
	['6540', 'IT-tjänster', 'IP1'],
	['6550', 'Konsultarvoden', 'IP1'],
	['6570', 'Bankkostnader'],
	['6970', 'Tidningar, tidskrifter och facklitteratur', 'IP3'],
	['6981', 'Föreningsavgifter, avdragsgilla'],
	['6982', 'Föreningsavgifter, ej avdragsgilla'],
	['6991', 'Övriga externa kostnader, avdragsgilla', 'IP1'],
	['6992', 'Övriga externa kostnader, ej avdragsgilla'],
	['7010', 'Löner till kollektivanställda'],
	['7210', 'Löner till tjänstemän'],
	['7290', 'Förändring av semesterlöneskuld'],
	['7410', 'Pensionsförsäkringspremier'],
	['7510', 'Lagstadgade sociala avgifter'],
	['7533', 'Särskild löneskatt för pensionskostnader'],
	['7690', 'Övriga personalkostnader'],
	['7832', 'Avskrivningar på inventarier och verktyg'],
	['7835', 'Avskrivningar på datorer'],
	['7960', 'Valutakursförluster på fordringar och skulder av rörelsekaraktär'],
	['8310', 'Ränteintäkter från omsättningstillgångar'],
	['8314', 'Skattefria ränteintäkter'],
	['8410', 'Räntekostnader för långfristiga skulder'],
	['8423', 'Kostnadsränta för skatter och avgifter'],
];

const aktiebolag: Row[] = [
	['2081', 'Aktiekapital'],
	['2091', 'Balanserad vinst eller förlust'],
	['2098', 'Vinst eller förlust från föregående år'],
	['2099', 'Årets resultat'],
	['2150', 'Ackumulerade överavskrivningar'],
	['2393', 'Lån från närstående personer, långfristiga'],
	['7220', 'Löner till företagsledare'],
	['8811', 'Avsättning till periodiseringsfond'],
	['8819', 'Återföring från periodiseringsfond'],
	['8910', 'Skatt som belastar årets resultat'],
	['8999', 'Årets resultat'],
];

const enskildFirma: Row[] = [
	['2010', 'Eget kapital'],
	['2013', 'Övriga egna uttag'],
	['2018', 'Övriga egna insättningar'],
	['2019', 'Årets resultat'],
	['8999', 'Årets resultat'],
];

const toAccounts = (rows: Row[]): Account[] =>
	rows
		.map(([number, name, defaultTaxCode]) => ({
			number,
			name,
			type: classifyBasAccount(number)!,
			active: true,
			defaultTaxCode,
		}))
		.sort((a, b) => (a.number < b.number ? -1 : 1));

export const basAktiebolag = {
	id: 'bas-2026-ab',
	name: 'BAS 2026 – aktiebolag (urval)',
	accounts: toAccounts([...common, ...aktiebolag]),
};
export const basEnskildFirma = {
	id: 'bas-2026-ef',
	name: 'BAS 2026 – enskild firma (urval)',
	accounts: toAccounts([...common, ...enskildFirma]),
};
