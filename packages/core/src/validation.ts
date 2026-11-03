import { isValidDate, type LocalDate } from './dates.ts';
import { DomainError, type Issue } from './errors.ts';
import type { Account, FiscalYear, VoucherInput } from './ledger.ts';
import { formatAmount, sum } from './money.ts';

export interface LedgerContext {
	accounts: ReadonlyMap<string, Account>;
	fiscalYears: readonly FiscalYear[];
	/** Nothing may be booked on or before this date (closed period). */
	lockedThrough?: LocalDate | undefined;
	knownSeries?: ReadonlySet<string> | undefined;
}

export const fiscalYearFor = (fiscalYears: readonly FiscalYear[], date: LocalDate) =>
	fiscalYears.find((fy) => fy.start <= date && date <= fy.end);

export function validateVoucher(voucher: VoucherInput, ctx: LedgerContext): Issue[] {
	const issues: Issue[] = [];

	if (!voucher.description.trim()) {
		issues.push({
			code: 'DESCRIPTION_REQUIRED',
			path: 'description',
			message: 'A voucher must describe what the transaction concerns.',
			hint: 'Add a short text such as "Kontorsmaterial Clas Ohlson".',
		});
	}

	if (ctx.knownSeries && !ctx.knownSeries.has(voucher.series)) {
		issues.push({
			code: 'SERIES_UNKNOWN',
			path: 'series',
			message: `Voucher series "${voucher.series}" does not exist.`,
			hint: `Use one of: ${[...ctx.knownSeries].join(', ')}.`,
		});
	}

	if (!isValidDate(voucher.date)) {
		issues.push({
			code: 'DATE_INVALID',
			path: 'date',
			message: `"${voucher.date}" is not a valid date.`,
			hint: 'Use YYYY-MM-DD.',
		});
	} else {
		const fy = fiscalYearFor(ctx.fiscalYears, voucher.date);
		if (!fy) {
			issues.push({
				code: 'DATE_OUTSIDE_FISCAL_YEAR',
				path: 'date',
				message: `${voucher.date} is not inside any fiscal year.`,
				hint: 'Create the fiscal year first, or check the date.',
			});
		} else if (fy.closed) {
			issues.push({
				code: 'FISCAL_YEAR_CLOSED',
				path: 'date',
				message: `Fiscal year ${fy.start}–${fy.end} is closed.`,
				hint: 'Book the correction in the current fiscal year instead.',
			});
		}
		if (ctx.lockedThrough && voucher.date <= ctx.lockedThrough) {
			issues.push({
				code: 'PERIOD_LOCKED',
				path: 'date',
				message: `The period up to ${ctx.lockedThrough} is locked.`,
				hint: 'Use a date after the lock, or ask an owner to unlock the period.',
			});
		}
	}

	if (voucher.lines.length < 2) {
		issues.push({
			code: 'TOO_FEW_LINES',
			path: 'lines',
			message: 'A voucher needs at least two lines.',
			hint: 'Add both the debit and the credit side.',
		});
	}

	voucher.lines.forEach((line, index) => {
		const path = `lines.${index}`;
		const account = ctx.accounts.get(line.account);
		if (!account) {
			issues.push({
				code: 'ACCOUNT_UNKNOWN',
				path: `${path}.account`,
				message: `Account ${line.account} does not exist in the chart of accounts.`,
				hint: 'List accounts with accounts.list, or create it with accounts.create.',
			});
		} else if (!account.active) {
			issues.push({
				code: 'ACCOUNT_INACTIVE',
				path: `${path}.account`,
				message: `Account ${line.account} (${account.name}) is inactive.`,
				hint: 'Activate the account or use another one.',
			});
		}
		if (line.amount === 0n) {
			issues.push({
				code: 'LINE_AMOUNT_ZERO',
				path: `${path}.amount`,
				message: 'Line amount must not be zero.',
			});
		}
		if ((line.foreignAmount === undefined) !== (line.foreignCurrency === undefined)) {
			issues.push({
				code: 'FOREIGN_AMOUNT_INCOMPLETE',
				path,
				message: 'foreignAmount and foreignCurrency must be given together.',
			});
		}
	});

	const balance = sum(voucher.lines.map((l) => l.amount));
	if (balance !== 0n) {
		issues.push({
			code: 'VOUCHER_UNBALANCED',
			path: 'lines',
			message: `Debits and credits differ by ${formatAmount(balance)}.`,
			hint: 'Positive amounts are debits and negative are credits; they must sum to 0.00.',
		});
	}

	return issues;
}

export function assertValidVoucher(voucher: VoucherInput, ctx: LedgerContext) {
	const issues = validateVoucher(voucher, ctx);
	if (issues.length > 0) {
		throw new DomainError('VOUCHER_INVALID', `The voucher has ${issues.length} problem(s).`, { issues });
	}
}
