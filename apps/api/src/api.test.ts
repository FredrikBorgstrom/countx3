import { afterAll, describe, expect, test } from 'bun:test';
import { operationList, toolName } from '@countx3/contracts';
import { createDb } from '@countx3/db';
import { createApp } from './app.ts';

const { db, close } = createDb(
	process.env.TEST_DATABASE_URL ?? 'postgres://countx3_app:countx3_app@localhost/countx3_test',
);
const app = createApp({ db, publicUrl: 'http://test', corsOrigins: ['*'] });
afterAll(() => close());

type Envelope = {
	ok: boolean;
	data?: any;
	error?: { code: string; message: string; issues?: { code: string }[] };
	dryRun?: boolean;
	replayed?: boolean;
};

async function post(
	path: string,
	body: unknown,
	token?: string,
	headers: Record<string, string> = {},
): Promise<Envelope> {
	const res = await app.request(path, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...headers,
		},
		body: JSON.stringify(body),
	});
	return res.json() as Promise<Envelope>;
}

const call = (token: string, name: string, input: unknown = {}, headers: Record<string, string> = {}) =>
	post(`/v1/ops/${name}`, input, token, headers);

async function ok(token: string, name: string, input: unknown = {}) {
	const res = await call(token, name, input);
	if (!res.ok) throw new Error(`${name} failed: ${JSON.stringify(res.error)}`);
	return res.data;
}

async function newUser() {
	const email = `${Bun.randomUUIDv7()}@example.test`;
	const res = await post('/v1/auth/signup', {
		email,
		name: 'Test Person',
		password: 'correct horse battery',
	});
	return res.data.sessionToken as string;
}

const purchase = {
	date: '2026-03-10',
	description: 'Kontorsmaterial',
	lines: [
		{ account: '6110', amount: '800.00', taxCode: 'IP1' },
		{ account: '2641', amount: '200.00' },
		{ account: '1930', amount: '-1000.00' },
	],
};

const sale = {
	date: '2026-03-15',
	description: 'Faktura 1001',
	lines: [
		{ account: '1930', amount: '12500.00' },
		{ account: '3001', amount: '-10000.00', taxCode: 'MP1' },
		{ account: '2611', amount: '-2500.00' },
	],
};

async function newCompany(session: string, name = 'Test AB') {
	return ok(session, 'companies.create', {
		name,
		legalForm: 'AB',
		organizationNumber: '556036-0793',
		fiscalYear: { start: '2026-01-01', end: '2026-12-31' },
	});
}

describe('bookkeeping through the API', async () => {
	const session = await newUser();
	const company = await newCompany(session);
	const companyId = company.id as string;

	test('company setup', async () => {
		expect(company.role).toBe('owner');
		expect(company.fiscalYears).toHaveLength(1);
		const accounts = await ok(session, 'accounts.list', { companyId, search: '193' });
		expect(accounts.items.map((a: { number: string }) => a.number)).toEqual(['1930']);
		const me = await ok(session, 'me.get');
		expect(me.companies.map((c: { id: string }) => c.id)).toContain(companyId);
	});

	test('dry run validates without saving', async () => {
		const res = await call(session, 'vouchers.create', { companyId, ...purchase, book: true, dryRun: true });
		expect(res.ok).toBe(true);
		expect(res.dryRun).toBe(true);
		expect(res.data.ref).toBe('A1');
		const list = await ok(session, 'vouchers.list', { companyId });
		expect(list.items).toEqual([]);
	});

	test('validation errors are structured', async () => {
		const res = await call(session, 'vouchers.create', {
			companyId,
			...purchase,
			lines: [
				{ account: '6110', amount: '800.00' },
				{ account: '9999', amount: '-700.00' },
			],
		});
		expect(res.error?.code).toBe('VOUCHER_INVALID');
		expect(res.error?.issues?.map((i) => i.code)).toEqual(['ACCOUNT_UNKNOWN', 'VOUCHER_UNBALANCED']);
		const bad = await call(session, 'vouchers.create', { companyId, ...purchase, date: '10/3/2026' });
		expect(bad.error?.code).toBe('INVALID_INPUT');
	});

	test('draft → book → correct', async () => {
		const draft = await ok(session, 'vouchers.create', { companyId, ...purchase });
		expect(draft.status).toBe('draft');
		const updated = await ok(session, 'vouchers.update', {
			companyId,
			voucherId: draft.id,
			description: 'Pärmar och pennor',
		});
		expect(updated.description).toBe('Pärmar och pennor');
		const booked = await ok(session, 'vouchers.book', { companyId, voucherId: draft.id });
		expect(booked.ref).toBe('A1');
		expect(booked.hash).toHaveLength(64);

		const immutable = await call(session, 'vouchers.update', {
			companyId,
			voucherId: draft.id,
			description: 'x',
		});
		expect(immutable.error?.code).toBe('VOUCHER_IMMUTABLE');
		const undeletable = await call(session, 'vouchers.delete', { companyId, voucherId: draft.id });
		expect(undeletable.error?.code).toBe('VOUCHER_IMMUTABLE');

		const saleVoucher = await ok(session, 'vouchers.create', { companyId, ...sale, book: true });
		expect(saleVoucher.ref).toBe('A2');

		const corrected = await ok(session, 'vouchers.correct', {
			companyId,
			voucherId: booked.id,
			reason: 'Fel konto',
			replacementLines: [
				{ account: '5460', amount: '800.00' },
				{ account: '2641', amount: '200.00' },
				{ account: '1930', amount: '-1000.00' },
			],
		});
		expect(corrected.reversal.ref).toBe('A3');
		expect(corrected.reversal.correctsVoucherId).toBe(booked.id);
		expect(corrected.reversal.lines.map((l: { amount: string }) => l.amount)).toEqual([
			'-800.00',
			'-200.00',
			'1000.00',
		]);
		expect(corrected.replacement.ref).toBe('A4');

		const byRef = await ok(session, 'vouchers.get', { companyId, ref: 'a4' });
		expect(byRef.id).toBe(corrected.replacement.id);
	});

	test('reports agree with each other', async () => {
		const tb = await ok(session, 'reports.trialBalance', { companyId, from: '2026-01-01', to: '2026-12-31' });
		const row = (account: string) => tb.rows.find((r: { account: string }) => r.account === account);
		expect(row('1930').closing).toBe('11500.00');
		expect(row('6110').closing).toBe('0.00');
		expect(row('5460').closing).toBe('800.00');

		const is = await ok(session, 'reports.incomeStatement', {
			companyId,
			from: '2026-01-01',
			to: '2026-12-31',
		});
		const result = is.rows.find((r: { key: string }) => r.key === 'yearResult');
		expect(result.amount).toBe('9200.00');

		const bs = await ok(session, 'reports.balanceSheet', { companyId, date: '2026-12-31' });
		const total = (key: string) => bs.rows.find((r: { key: string }) => r.key === key).amount;
		expect(total('totalAssets')).toBe(total('totalEquityAndLiabilities'));
		expect(total('unclosedResult')).toBe('9200.00');

		const gl = await ok(session, 'reports.generalLedger', {
			companyId,
			from: '2026-01-01',
			to: '2026-12-31',
			accounts: ['1930'],
		});
		expect(gl.accounts[0].lines.map((l: { balance: string }) => l.balance)).toEqual([
			'-1000.00',
			'0.00',
			'-1000.00',
			'11500.00',
		]);
	});

	test('hash chain verifies', async () => {
		const verified = await ok(session, 'ledger.verify', { companyId });
		expect(verified).toMatchObject({ intact: true, bookedVouchers: 4, break: null });
	});

	test('idempotency keys make retries safe', async () => {
		const input = { companyId, ...purchase, date: '2026-04-01', idempotencyKey: 'receipt-42' };
		const first = await call(session, 'vouchers.create', input);
		const retry = await call(session, 'vouchers.create', input);
		expect(retry.replayed).toBe(true);
		expect(retry.data.id).toBe(first.data.id);
		const conflicting = await call(session, 'vouchers.create', { ...input, description: 'Annat' });
		expect(conflicting.error?.code).toBe('IDEMPOTENCY_KEY_REUSED');
		await ok(session, 'vouchers.delete', { companyId, voucherId: first.data.id });
	});

	test('agent tokens are scoped and audited', async () => {
		const token = await ok(session, 'tokens.create', {
			name: 'Claude Code på laptopen',
			client: 'claude-code',
			scopes: ['ledger:read', 'ledger:write', 'company:read'],
			companyId,
		});
		const agent = token.token as string;
		expect(agent.startsWith('cx3_')).toBe(true);
		expect(token.companyId).toBe(companyId);
		const elsewhere = await call(agent, 'companies.create', {
			name: 'Annat AB',
			legalForm: 'AB',
			organizationNumber: '556036-0793',
			fiscalYear: { start: '2026-01-01', end: '2026-12-31' },
		});
		expect(elsewhere.error?.code).toBe('TOKEN_COMPANY_MISMATCH');

		const me = await ok(agent, 'me.get');
		expect(me.principal).toMatchObject({ type: 'token', client: 'claude-code' });

		const booking = await call(agent, 'vouchers.create', {
			companyId,
			...purchase,
			date: '2026-05-02',
			book: true,
		});
		expect(booking.error?.code).toBe('MISSING_SCOPE');
		const draft = await ok(agent, 'vouchers.create', { companyId, ...purchase, date: '2026-05-02' });
		expect(draft.createdBy).toMatchObject({ type: 'agent', client: 'claude-code' });
		const bookDenied = await call(agent, 'vouchers.book', { companyId, voucherId: draft.id });
		expect(bookDenied.error?.code).toBe('MISSING_SCOPE');
		await ok(session, 'vouchers.book', { companyId, voucherId: draft.id });

		const mint = await call(agent, 'tokens.create', { name: 'x', scopes: ['ledger:read'] });
		expect(mint.error?.code).toBe('HUMAN_ONLY');

		const audit = await ok(session, 'audit.list', { companyId, limit: 5 });
		expect(audit.items.map((e: { operation: string }) => e.operation)).toEqual([
			'vouchers.book',
			'vouchers.create',
			'vouchers.delete',
			'vouchers.create',
			'vouchers.correct',
		]);
		expect(audit.items[1].actor).toMatchObject({
			type: 'agent',
			client: 'claude-code',
			name: 'Claude Code på laptopen',
		});

		await ok(session, 'tokens.revoke', { tokenId: token.id });
		expect((await call(agent, 'me.get')).error?.code).toBe('UNAUTHENTICATED');
	});

	test('other users cannot reach the company', async () => {
		const stranger = await newUser();
		const res = await call(stranger, 'vouchers.list', { companyId });
		expect(res.error?.code).toBe('COMPANY_NOT_FOUND');
	});

	test('locked periods reject bookings and locks only move forward', async () => {
		await ok(session, 'periods.lock', { companyId, through: '2026-03-31' });
		const res = await call(session, 'vouchers.create', { companyId, ...purchase });
		expect(res.error?.issues?.map((i) => i.code)).toEqual(['PERIOD_LOCKED']);
		const back = await call(session, 'periods.lock', { companyId, through: '2026-02-28' });
		expect(back.error?.code).toBe('LOCK_CANNOT_MOVE_BACK');
	});

	test('SIE export can be imported into another company', async () => {
		const exported = await ok(session, 'sie.export', { companyId });
		expect(exported.text).toContain('#VER "A" "4" 20260310');
		const other = await newCompany(session, 'Kopia AB');
		const imported = await ok(session, 'sie.import', {
			companyId: other.id,
			contentBase64: exported.contentBase64,
		});
		expect(imported).toMatchObject({ vouchersBooked: 5, accountsCreated: 0, warnings: [] });
		const range = { from: '2026-01-01', to: '2026-12-31' };
		const a = await ok(session, 'reports.trialBalance', { companyId, ...range });
		const b = await ok(session, 'reports.trialBalance', { companyId: other.id, ...range });
		expect(b.rows).toEqual(a.rows);
		expect((await ok(session, 'ledger.verify', { companyId: other.id })).intact).toBe(true);
	});
});

describe('agent surfaces', async () => {
	const session = await newUser();

	test('every operation is in the OpenAPI document', async () => {
		const doc = (await (await app.request('/v1/openapi.json')).json()) as { paths: Record<string, unknown> };
		expect(Object.keys(doc.paths).sort()).toEqual(operationList.map((op) => `/v1/ops/${op.name}`).sort());
	});

	test('MCP lists every operation as a tool and calls it', async () => {
		const rpc = async (method: string, params: unknown, id = 1) => {
			const res = await app.request('/mcp', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${session}`,
					'Content-Type': 'application/json',
					Accept: 'application/json, text/event-stream',
					'Mcp-Protocol-Version': '2025-11-25',
				},
				body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
			});
			return (await res.json()) as { result?: any; error?: unknown };
		};
		const init = await rpc('initialize', {
			protocolVersion: '2025-11-25',
			capabilities: {},
			clientInfo: { name: 'test', version: '1' },
		});
		expect(init.result?.serverInfo?.name).toBe('countx3');
		expect(init.result?.instructions).toContain('vouchers_correct');

		const tools = await rpc('tools/list', {}, 2);
		const names = tools.result.tools.map((t: { name: string }) => t.name).sort();
		expect(names).toEqual(operationList.map((op) => toolName(op.name)).sort());
		const create = tools.result.tools.find((t: { name: string }) => t.name === 'vouchers_create');
		expect(create.inputSchema.required).toEqual(
			expect.arrayContaining(['companyId', 'date', 'description', 'lines']),
		);
		expect(create.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });

		const called = await rpc('tools/call', { name: 'companies_list', arguments: {} }, 3);
		expect(JSON.parse(called.result.content[0].text)).toEqual({ data: { items: [] } });
		const failed = await rpc(
			'tools/call',
			{ name: 'vouchers_list', arguments: { companyId: Bun.randomUUIDv7() } },
			4,
		);
		expect(failed.result.isError).toBe(true);
		expect(JSON.parse(failed.result.content[0].text).error.code).toBe('COMPANY_NOT_FOUND');
	});

	test('unauthenticated requests are refused with a hint', async () => {
		const res = await post('/v1/ops/me.get', {});
		expect(res.error?.code).toBe('UNAUTHENTICATED');
	});
});
