import { afterAll, describe, expect, test } from 'bun:test';
import { DomainError, GENESIS_HASH } from '@countx3/core';
import { eq, sql } from 'drizzle-orm';
import { createDb, schema, setCompanyContext, withContext } from './index.ts';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://countx3_app:countx3_app@localhost/countx3_test';
const { db, close } = createDb(url);
afterAll(() => close());

const actor = { type: 'user' as const, id: 'u', name: 'Test' };

async function setupCompany() {
	const userId = Bun.randomUUIDv7();
	const companyId = Bun.randomUUIDv7();
	await withContext(db, { userId }, async (tx) => {
		await tx.insert(schema.users).values({ id: userId, email: `${userId}@example.test`, name: 'Test' });
		await setCompanyContext(tx, companyId);
		await tx.insert(schema.companies).values({
			id: companyId,
			name: 'Test AB',
			country: 'SE',
			legalForm: 'AB',
			organizationNumber: '556036-0793',
			currency: 'SEK',
			lastHash: GENESIS_HASH,
		});
		await tx.insert(schema.companyMembers).values({ companyId, userId, role: 'owner' });
	});
	const fiscalYearId = await withContext(db, { userId, companyId }, async (tx) => {
		const [fy] = await tx
			.insert(schema.fiscalYears)
			.values({ companyId, start: '2026-01-01', end: '2026-12-31' })
			.returning({ id: schema.fiscalYears.id });
		return fy!.id;
	});
	return { userId, companyId, fiscalYearId };
}

async function insertDraft(companyId: string, fiscalYearId: string, amounts: bigint[]) {
	return withContext(db, { companyId }, async (tx) => {
		const [v] = await tx
			.insert(schema.vouchers)
			.values({
				companyId,
				fiscalYearId,
				status: 'draft',
				series: 'A',
				date: '2026-02-01',
				description: 'Test',
				createdBy: actor,
			})
			.returning({ id: schema.vouchers.id });
		await tx.insert(schema.voucherLines).values(
			amounts.map((amount, i) => ({
				companyId,
				voucherId: v!.id,
				lineNo: i + 1,
				account: i === 0 ? '1930' : '3001',
				amount,
			})),
		);
		return v!.id;
	});
}

const book = (companyId: string, voucherId: string) =>
	withContext(db, { companyId }, (tx) =>
		tx
			.update(schema.vouchers)
			.set({
				status: 'booked',
				number: 1,
				bookingSeq: 1,
				bookedAt: new Date(),
				bookedBy: actor,
				prevHash: GENESIS_HASH,
				hash: 'x'.repeat(64),
			})
			.where(eq(schema.vouchers.id, voucherId)),
	);

const errorCode = (promise: Promise<unknown>) =>
	promise.then(
		() => 'OK',
		(e) => (e instanceof DomainError ? e.code : String(e)),
	);

describe('database guards', () => {
	test('tenants cannot see each other', async () => {
		const a = await setupCompany();
		const b = await setupCompany();
		const visible = await withContext(db, { userId: a.userId, companyId: b.companyId }, (tx) =>
			tx.select().from(schema.fiscalYears),
		);
		expect(visible.map((fy) => fy.companyId)).toEqual([b.companyId]);
		const companies = await withContext(db, { userId: a.userId }, (tx) => tx.select().from(schema.companies));
		expect(companies.map((c) => c.id)).toEqual([a.companyId]);
		const cross = withContext(db, { companyId: a.companyId }, (tx) =>
			tx
				.insert(schema.accounts)
				.values({ companyId: b.companyId, number: '1930', name: 'Bank', type: 'asset' }),
		);
		expect(await errorCode(cross)).toBe('FORBIDDEN');
	});

	test('unbalanced vouchers cannot be booked', async () => {
		const { companyId, fiscalYearId } = await setupCompany();
		const id = await insertDraft(companyId, fiscalYearId, [100n, -99n]);
		expect(await errorCode(book(companyId, id))).toBe('VOUCHER_UNBALANCED');
	});

	test('booked vouchers and their lines are immutable', async () => {
		const { companyId, fiscalYearId } = await setupCompany();
		const id = await insertDraft(companyId, fiscalYearId, [100n, -100n]);
		await book(companyId, id);
		const update = withContext(db, { companyId }, (tx) =>
			tx.update(schema.vouchers).set({ description: 'Changed' }).where(eq(schema.vouchers.id, id)),
		);
		expect(await errorCode(update)).toBe('VOUCHER_IMMUTABLE');
		const remove = withContext(db, { companyId }, (tx) =>
			tx.delete(schema.vouchers).where(eq(schema.vouchers.id, id)),
		);
		expect(await errorCode(remove)).toBe('VOUCHER_IMMUTABLE');
		const line = withContext(db, { companyId }, (tx) =>
			tx.update(schema.voucherLines).set({ amount: 5n }).where(eq(schema.voucherLines.voucherId, id)),
		);
		expect(await errorCode(line)).toBe('VOUCHER_IMMUTABLE');
	});

	test('drafts can be deleted, audit log cannot', async () => {
		const { companyId, fiscalYearId } = await setupCompany();
		const id = await insertDraft(companyId, fiscalYearId, [100n, -100n]);
		await withContext(db, { companyId }, (tx) =>
			tx.delete(schema.vouchers).where(eq(schema.vouchers.id, id)),
		);
		await withContext(db, { companyId }, (tx) =>
			tx.insert(schema.auditEvents).values({ companyId, actor, operation: 'test' }),
		);
		const tamper = withContext(db, { companyId }, (tx) =>
			tx.execute(sql`delete from audit_events where company_id = ${companyId}`),
		);
		expect(await errorCode(tamper)).toBe('FORBIDDEN');
	});
});
