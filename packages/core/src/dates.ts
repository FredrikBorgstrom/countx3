import { DomainError } from './errors.ts';

/** Calendar date without time zone, ISO format `YYYY-MM-DD`. Compares correctly as a string. */
export type LocalDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDate(text: string): LocalDate {
	const match = ISO_DATE.exec(text);
	if (match) {
		const [, y, m, d] = match.map(Number) as [number, number, number, number];
		const date = new Date(Date.UTC(y, m - 1, d));
		if (date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d) return text;
	}
	throw new DomainError('DATE_INVALID', `"${text}" is not a valid date`, {
		hint: 'Use ISO format YYYY-MM-DD, e.g. "2026-03-31".',
	});
}

export const isValidDate = (text: string) => {
	try {
		parseDate(text);
		return true;
	} catch {
		return false;
	}
};

const toUtc = (date: LocalDate) => {
	const [y, m, d] = date.split('-').map(Number) as [number, number, number];
	return new Date(Date.UTC(y, m - 1, d));
};

const fromUtc = (date: Date): LocalDate => date.toISOString().slice(0, 10);

export const addDays = (date: LocalDate, days: number): LocalDate => {
	const utc = toUtc(date);
	utc.setUTCDate(utc.getUTCDate() + days);
	return fromUtc(utc);
};

export const addMonths = (date: LocalDate, months: number): LocalDate => {
	const [y, m, d] = date.split('-').map(Number) as [number, number, number];
	const target = new Date(Date.UTC(y, m - 1 + months, 1));
	const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
	target.setUTCDate(Math.min(d, lastDay));
	return fromUtc(target);
};

export const startOfMonth = (date: LocalDate): LocalDate => `${date.slice(0, 7)}-01`;

export const endOfMonth = (date: LocalDate): LocalDate => addDays(addMonths(startOfMonth(date), 1), -1);

export const endOfQuarter = (date: LocalDate): LocalDate => {
	const month = Number(date.slice(5, 7));
	const quarterEndMonth = Math.ceil(month / 3) * 3;
	return endOfMonth(`${date.slice(0, 4)}-${String(quarterEndMonth).padStart(2, '0')}-01`);
};

/** Whole months from `from` to `to` inclusive, counting partial months as whole. */
export const monthSpan = (from: LocalDate, to: LocalDate): number =>
	(Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
	Number(to.slice(5, 7)) -
	Number(from.slice(5, 7)) +
	1;

export const today = (): LocalDate => fromUtc(new Date());

export const compactDate = (date: LocalDate) => date.replaceAll('-', '');

export const fromCompactDate = (text: string): LocalDate =>
	parseDate(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`);
