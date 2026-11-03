import {
	DomainError,
	isBalanceAccount,
	type LocalDate,
	sum,
	today,
	trialBalance,
	type VoucherInput,
} from '@countx3/core';
import { accounts, fiscalYears, openingBalances, voucherSeries, vouchers } from '@countx3/db';
import { parseSie, type SieDocument, writeSie } from '@countx3/formats';
import { and, asc, eq } from 'drizzle-orm';
import { bookDraft, insertDraft } from '../booking.ts';
import { companyContext, type Handlers } from '../context.ts';
import {
	fiscalYearDto,
	getCompany,
	inputFromRow,
	linesFor,
	listFiscalYears,
	loadLedgerData,
} from '../store.ts';

const VERSION = '0.1.0';

export const sieHandlers = {
	async 'sie.export'(ctx, input) {
		const c = companyContext(ctx);
		const company = await getCompany(c.tx, c.companyId);
		const years = await listFiscalYears(c.tx, c.companyId);
		const index = input.fiscalYearId ? years.findIndex((y) => y.id === input.fiscalYearId) : 0;
		const fy = years[index];
		if (!fy) throw new DomainError('NOT_FOUND', 'Fiscal year not found.', { status: 404 });
		const previous = years[index + 1];

		const { data } = await loadLedgerData(c.tx, c.companyId, fy.start, fy.end);
		const balances = trialBalance(data, fy.start, fy.end);
		const accountByNumber = new Map(data.accounts.map((a) => [a.number, a]));
		const rows = await c.tx
			.select()
			.from(vouchers)
			.where(and(eq(vouchers.fiscalYearId, fy.id), eq(vouchers.status, 'booked')))
			.orderBy(asc(vouchers.series), asc(vouchers.number));
		const lines = await linesFor(
			c.tx,
			rows.map((v) => v.id),
		);

		const doc: SieDocument = {
			program: { name: 'countx3', version: VERSION },
			generatedOn: today(),
			companyName: company.name,
			organizationNumber: company.organizationNumber,
			currency: company.currency,
			fiscalYears: [
				{ index: 0, start: fy.start, end: fy.end },
				...(previous ? [{ index: -1, start: previous.start, end: previous.end }] : []),
			],
			accounts: data.accounts.map((a) => ({ number: a.number, name: a.name, type: a.type })),
			openingBalances: [...data.openingBalances].map(([account, amount]) => ({
				yearIndex: 0,
				account,
				amount,
			})),
			closingBalances: balances
				.filter((b) => isBalanceAccount(accountByNumber.get(b.account)?.type ?? 'expense'))
				.map((b) => ({ yearIndex: 0, account: b.account, amount: b.closing })),
			results: balances
				.filter((b) => !isBalanceAccount(accountByNumber.get(b.account)?.type ?? 'expense'))
				.map((b) => ({ yearIndex: 0, account: b.account, amount: b.closing })),
			vouchers: rows.map((v) => ({
				series: v.series,
				number: v.number!,
				date: v.date,
				text: v.description,
				registeredOn: v.bookedAt!.toISOString().slice(0, 10) as LocalDate,
				transactions: inputFromRow(v, lines.get(v.id)!).lines.map((l) => ({
					account: l.account,
					amount: l.amount,
					text: l.description,
					quantity: l.quantity,
				})),
			})),
		};
		const { text, bytes } = writeSie(doc);
		return {
			fileName: `${company.organizationNumber.replace(/\D/g, '')}_${fy.start.slice(0, 4)}.se`,
			contentBase64: Buffer.from(bytes).toString('base64'),
			text,
		};
	},

	async 'sie.import'(ctx, input) {
		const c = companyContext(ctx);
		const company = await getCompany(c.tx, c.companyId);
		const { document, warnings } = parseSie(new Uint8Array(Buffer.from(input.contentBase64, 'base64')));
		const current = document.fiscalYears.find((y) => y.index === 0);
		if (!current) {
			throw new DomainError('SIE_NO_FISCAL_YEAR', 'The file has no #RAR 0 (current fiscal year).', {
				hint: 'Export an SIE 4 file again.',
			});
		}

		// Fiscal year: reuse an identical one without booked vouchers, or create it.
		const years = await listFiscalYears(c.tx, c.companyId);
		let fy = years.find((y) => y.start === current.start && y.end === current.end);
		if (fy) {
			const [booked] = await c.tx
				.select({ id: vouchers.id })
				.from(vouchers)
				.where(and(eq(vouchers.fiscalYearId, fy.id), eq(vouchers.status, 'booked')))
				.limit(1);
			if (booked) {
				throw new DomainError(
					'FISCAL_YEAR_NOT_EMPTY',
					`Fiscal year ${fy.start}–${fy.end} already has booked vouchers.`,
					{
						hint: 'SIE import only fills an empty fiscal year.',
					},
				);
			}
		} else {
			if (years.some((y) => y.start <= current.end && current.start <= y.end)) {
				throw new DomainError(
					'FISCAL_YEAR_OVERLAP',
					`The file's fiscal year ${current.start}–${current.end} overlaps an existing one.`,
				);
			}
			const issues = c.pack.validateFiscalYear(current, { legalForm: company.legalForm });
			if (issues.length > 0)
				throw new DomainError('VALIDATION_FAILED', issues.map((i) => i.message).join(' '), { issues });
			[fy] = await c.tx
				.insert(fiscalYears)
				.values({ companyId: c.companyId, start: current.start, end: current.end })
				.returning();
		}

		// Accounts: create the ones that are missing; existing names are kept.
		const existing = new Set(
			(
				await c.tx
					.select({ number: accounts.number })
					.from(accounts)
					.where(eq(accounts.companyId, c.companyId))
			).map((a) => a.number),
		);
		const used = new Set([
			...document.accounts.map((a) => a.number),
			...document.openingBalances.map((b) => b.account),
			...document.vouchers.flatMap((v) => v.transactions.map((t) => t.account)),
		]);
		const named = new Map(document.accounts.map((a) => [a.number, a]));
		const toCreate = [...used].filter((n) => !existing.has(n));
		for (const number of toCreate) {
			const type = c.pack.classifyAccount(number) ?? named.get(number)?.type;
			if (!type)
				throw new DomainError('ACCOUNT_TYPE_UNKNOWN', `Cannot classify account ${number} from the file.`);
			await c.tx
				.insert(accounts)
				.values({ companyId: c.companyId, number, name: named.get(number)?.name ?? `Konto ${number}`, type });
		}

		// Opening balances (balance sheet accounts only).
		const types = new Map(
			(await c.tx.select().from(accounts).where(eq(accounts.companyId, c.companyId))).map((a) => [
				a.number,
				a.type,
			]),
		);
		const ib = document.openingBalances.filter((b) => b.yearIndex === 0 && b.amount !== 0n);
		const balanceIb = ib.filter((b) => isBalanceAccount(types.get(b.account)!));
		if (balanceIb.length !== ib.length) warnings.push('Opening balances on result accounts were ignored.');
		if (sum(balanceIb.map((b) => b.amount)) !== 0n)
			warnings.push('The opening balances in the file do not sum to zero.');
		await c.tx.delete(openingBalances).where(eq(openingBalances.fiscalYearId, fy!.id));
		if (balanceIb.length > 0) {
			await c.tx.insert(openingBalances).values(
				balanceIb.map((b) => ({
					companyId: c.companyId,
					fiscalYearId: fy!.id,
					account: b.account,
					amount: b.amount,
				})),
			);
		}

		// Vouchers, in series and number order so that numbering is preserved where the source was gap-free.
		const seriesKnown = new Set(
			(await c.tx.select().from(voucherSeries).where(eq(voucherSeries.companyId, c.companyId))).map(
				(s) => s.code,
			),
		);
		const sorted = [...document.vouchers].sort((a, b) =>
			a.series === b.series ? (a.number ?? 0) - (b.number ?? 0) : a.series < b.series ? -1 : 1,
		);
		let booked = 0;
		for (const v of sorted) {
			const series = v.series || 'A';
			if (!seriesKnown.has(series)) {
				await c.tx
					.insert(voucherSeries)
					.values({ companyId: c.companyId, code: series, name: `Importerad serie ${series}` });
				seriesKnown.add(series);
			}
			const voucher: VoucherInput = {
				series,
				date: v.date,
				description: v.text || `Importerad verifikation ${series}${v.number ?? ''}`,
				lines: v.transactions
					.filter((t) => t.amount !== 0n)
					.map((t) => ({ account: t.account, amount: t.amount, description: t.text, quantity: t.quantity })),
			};
			try {
				const id = await insertDraft(c, voucher, 'sie_import');
				await bookDraft(c, id);
			} catch (error) {
				if (error instanceof DomainError) {
					throw new DomainError(
						error.code,
						`Voucher ${series}${v.number ?? ''} (${v.date}): ${error.message}`,
						{
							issues: error.issues,
							hint: 'Nothing was imported. Fix the file or the company settings and try again.',
						},
					);
				}
				throw error;
			}
			booked++;
		}

		ctx.auditTarget = { type: 'fiscalYear', id: fy!.id };
		return {
			fiscalYear: fiscalYearDto(fy!),
			accountsCreated: toCreate.length,
			openingBalances: balanceIb.length,
			vouchersBooked: booked,
			warnings,
		};
	},
} satisfies Partial<Handlers>;
