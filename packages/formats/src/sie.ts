import {
	type AccountType,
	compactDate,
	formatAmount,
	fromCompactDate,
	type LocalDate,
	type Minor,
	parseAmount,
} from '@countx3/core';
import { decodeCp437, encodeCp437 } from './cp437.ts';

/** SIE 4 (type 4E/4I): the Swedish standard file for moving bookkeeping between systems. Spec: sie.se/format. */
export interface SieDocument {
	program?: { name: string; version: string } | undefined;
	generatedOn?: LocalDate | undefined;
	companyName: string;
	organizationNumber?: string | undefined;
	currency?: string | undefined;
	/** Index 0 = current year, -1 = previous year, … */
	fiscalYears: { index: number; start: LocalDate; end: LocalDate }[];
	accounts: { number: string; name: string; type?: AccountType | undefined }[];
	openingBalances: SieBalance[];
	closingBalances: SieBalance[];
	results: SieBalance[];
	vouchers: SieVoucher[];
}

export interface SieBalance {
	yearIndex: number;
	account: string;
	amount: Minor;
}

export interface SieVoucher {
	series: string;
	number?: number | undefined;
	date: LocalDate;
	text: string;
	registeredOn?: LocalDate | undefined;
	transactions: SieTransaction[];
}

export interface SieTransaction {
	account: string;
	amount: Minor;
	date?: LocalDate | undefined;
	text?: string | undefined;
	quantity?: number | undefined;
}

// --- Reading ---------------------------------------------------------------------------------

type Token = string | string[];

/** Splits one SIE line into fields: bare words, "quoted strings" (with \" escapes) and {object lists}. */
export function tokenize(line: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	const readQuoted = () => {
		let value = '';
		i++;
		while (i < line.length && line[i] !== '"') {
			if (line[i] === '\\' && i + 1 < line.length) i++;
			value += line[i++];
		}
		i++;
		return value;
	};
	while (i < line.length) {
		const c = line[i]!;
		if (c === ' ' || c === '\t') {
			i++;
		} else if (c === '"') {
			tokens.push(readQuoted());
		} else if (c === '{') {
			const items: string[] = [];
			i++;
			while (i < line.length && line[i] !== '}') {
				if (line[i] === ' ' || line[i] === '\t') i++;
				else if (line[i] === '"') items.push(readQuoted());
				else {
					let word = '';
					while (i < line.length && !' \t}'.includes(line[i]!)) word += line[i++];
					items.push(word);
				}
			}
			i++;
			tokens.push(items);
		} else {
			let word = '';
			while (i < line.length && line[i] !== ' ' && line[i] !== '\t') word += line[i++];
			tokens.push(word);
		}
	}
	return tokens;
}

/** Decodes SIE bytes: PC8 (CP437) per the spec, but files that are valid UTF-8 are accepted too. */
export function decodeSie(bytes: Uint8Array): { text: string; encoding: 'cp437' | 'utf-8' } {
	try {
		const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		if (/[\u0080-\uffff]/.test(text))
			return { text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, encoding: 'utf-8' };
	} catch {
		// Not UTF-8: the normal case for PC8 files.
	}
	return { text: decodeCp437(bytes), encoding: 'cp437' };
}

const KTYP: Record<string, AccountType> = { T: 'asset', S: 'liability', I: 'income', K: 'expense' };
const IGNORED = new Set([
	'#FLAGGA',
	'#FORMAT',
	'#SIETYP',
	'#KSUMMA',
	'#PROSA',
	'#KPTYP',
	'#SRU',
	'#DIM',
	'#UNDERDIM',
	'#OBJEKT',
	'#OIB',
	'#OUB',
	'#PSALDO',
	'#PBUDGET',
	'#ADRESS',
	'#FNR',
	'#TAXAR',
	'#BKOD',
	'#OMFATTN',
	'#FTYP',
	'#ENHET',
	'#RTRANS',
	'#BTRANS',
]);

export function parseSie(bytes: Uint8Array): { document: SieDocument; warnings: string[] } {
	const { text, encoding } = decodeSie(bytes);
	const warnings: string[] = [];
	if (encoding === 'utf-8') warnings.push('The file is UTF-8 encoded rather than PC8; it was read as UTF-8.');
	const doc: SieDocument = {
		companyName: '',
		fiscalYears: [],
		accounts: [],
		openingBalances: [],
		closingBalances: [],
		results: [],
		vouchers: [],
	};
	const accountTypes = new Map<string, AccountType>();
	let voucher: SieVoucher | null = null;
	let inBlock = false;

	const lines = text.split(/\r?\n/);
	lines.forEach((raw, index) => {
		const line = raw.trim();
		if (!line) return;
		const where = `line ${index + 1}`;
		if (line === '{') {
			if (!voucher) warnings.push(`${where}: "{" without #VER`);
			inBlock = true;
			return;
		}
		if (line === '}') {
			if (voucher) doc.vouchers.push(voucher);
			voucher = null;
			inBlock = false;
			return;
		}
		const [label, ...fields] = tokenize(line);
		const str = (i: number) => (typeof fields[i] === 'string' ? (fields[i] as string) : '');
		try {
			switch (label) {
				case '#PROGRAM':
					doc.program = { name: str(0), version: str(1) };
					break;
				case '#GEN':
					doc.generatedOn = fromCompactDate(str(0));
					break;
				case '#FNAMN':
					doc.companyName = str(0);
					break;
				case '#ORGNR':
					doc.organizationNumber = str(0);
					break;
				case '#VALUTA':
					doc.currency = str(0);
					break;
				case '#RAR':
					doc.fiscalYears.push({
						index: Number(str(0)),
						start: fromCompactDate(str(1)),
						end: fromCompactDate(str(2)),
					});
					break;
				case '#KONTO':
					doc.accounts.push({ number: str(0), name: str(1) });
					break;
				case '#KTYP':
					if (KTYP[str(1)]) accountTypes.set(str(0), KTYP[str(1)]!);
					break;
				case '#IB':
				case '#UB':
				case '#RES': {
					const balance = { yearIndex: Number(str(0)), account: str(1), amount: parseAmount(str(2)) };
					(label === '#IB' ? doc.openingBalances : label === '#UB' ? doc.closingBalances : doc.results).push(
						balance,
					);
					break;
				}
				case '#VER':
					voucher = {
						series: str(0),
						number: str(1) ? Number(str(1)) : undefined,
						date: fromCompactDate(str(2)),
						text: str(3),
						registeredOn: str(4) ? fromCompactDate(str(4)) : undefined,
						transactions: [],
					};
					break;
				case '#TRANS':
					if (!voucher || !inBlock) {
						warnings.push(`${where}: #TRANS outside a voucher block was skipped`);
						break;
					}
					voucher.transactions.push({
						account: str(0),
						amount: parseAmount(str(2)),
						date: str(3) ? fromCompactDate(str(3)) : undefined,
						text: str(4) || undefined,
						quantity: str(5) ? Number(str(5)) : undefined,
					});
					break;
				default:
					if (!IGNORED.has(label as string))
						warnings.push(`${where}: ${label} is not supported and was skipped`);
			}
		} catch (error) {
			warnings.push(`${where}: ${(error as Error).message}`);
		}
	});
	for (const account of doc.accounts) account.type = accountTypes.get(account.number);
	return { document: doc, warnings };
}

// --- Writing ---------------------------------------------------------------------------------

const quote = (value: string) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
const KTYP_OUT: Record<AccountType, string> = {
	asset: 'T',
	liability: 'S',
	equity: 'S',
	income: 'I',
	expense: 'K',
};

export function writeSie(doc: SieDocument): { text: string; bytes: Uint8Array } {
	const out: string[] = ['#FLAGGA 0', '#FORMAT PC8', '#SIETYP 4'];
	if (doc.program) out.push(`#PROGRAM ${quote(doc.program.name)} ${quote(doc.program.version)}`);
	if (doc.generatedOn) out.push(`#GEN ${compactDate(doc.generatedOn)}`);
	out.push(`#FNAMN ${quote(doc.companyName)}`);
	if (doc.organizationNumber) out.push(`#ORGNR ${doc.organizationNumber}`);
	for (const fy of doc.fiscalYears)
		out.push(`#RAR ${fy.index} ${compactDate(fy.start)} ${compactDate(fy.end)}`);
	if (doc.currency) out.push(`#VALUTA ${doc.currency}`);
	for (const a of doc.accounts) {
		out.push(`#KONTO ${a.number} ${quote(a.name)}`);
		if (a.type) out.push(`#KTYP ${a.number} ${KTYP_OUT[a.type]}`);
	}
	const balances = (label: string, rows: SieBalance[]) => {
		for (const b of rows) out.push(`${label} ${b.yearIndex} ${b.account} ${formatAmount(b.amount)}`);
	};
	balances('#IB', doc.openingBalances);
	balances('#UB', doc.closingBalances);
	balances('#RES', doc.results);
	for (const v of doc.vouchers) {
		const registered = v.registeredOn ? ` ${compactDate(v.registeredOn)}` : '';
		out.push(
			`#VER ${quote(v.series)} ${quote(v.number?.toString() ?? '')} ${compactDate(v.date)} ${quote(v.text)}${registered}`,
		);
		out.push('{');
		for (const t of v.transactions) {
			const parts = [`#TRANS ${t.account} {} ${formatAmount(t.amount)}`];
			if (t.date || t.text || t.quantity !== undefined) parts.push(t.date ? compactDate(t.date) : '""');
			if (t.text || t.quantity !== undefined) parts.push(quote(t.text ?? ''));
			if (t.quantity !== undefined) parts.push(String(t.quantity));
			out.push(`   ${parts.join(' ')}`);
		}
		out.push('}');
	}
	const text = `${out.join('\r\n')}\r\n`;
	return { text, bytes: encodeCp437(text) };
}
