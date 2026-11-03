/**
 * Seeds the LOCAL development database with a demo user and company: `bun scripts/seed_dev.ts`.
 * It runs the API in-process on a free port, so no server needs to be running.
 * Never point this at production. The credentials below exist only in local dev databases.
 */
import { createApp } from '@countx3/api';
import { createDb } from '@countx3/db';
import { Countx3Error, createClient } from '@countx3/sdk';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://countx3_app:countx3_app@localhost/countx3_dev';
if (!['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname))
	throw new Error(`Refusing to seed a non-local database: ${new URL(databaseUrl).host}`);

const { db, close } = createDb(databaseUrl);
const server = Bun.serve({ port: 0, fetch: createApp({ db, publicUrl: '', corsOrigins: [] }).fetch });
const url = server.url.origin;

export const DEMO_EMAIL = 'demo@countx3.test';
export const DEMO_PASSWORD = 'demo-password-local-only';

const anonymous = createClient({ baseUrl: url });
const session = await anonymous.auth
	.signUp({ email: DEMO_EMAIL, name: 'Demo Person', password: DEMO_PASSWORD })
	.catch(async (error) => {
		if (error instanceof Countx3Error && error.code === 'EMAIL_TAKEN')
			return anonymous.auth.logIn({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
		throw error;
	});
const api = createClient({ baseUrl: url, token: session.sessionToken });

const existing = (await api.call('companies.list', {})).items.find((c) => c.name === 'Demo AB');
if (existing) {
	console.log(`Demo AB already exists (${existing.id}). Log in as ${DEMO_EMAIL}.`);
	server.stop();
	await close();
	process.exit(0);
}

const year = new Date().getFullYear();
const company = await api.call('companies.create', {
	name: 'Demo AB',
	legalForm: 'AB',
	organizationNumber: '556036-0793',
	fiscalYear: { start: `${year}-01-01`, end: `${year}-12-31` },
});
const companyId = company.id;
const d = (month: number, day: number) =>
	`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

await api.call('openingBalances.set', {
	companyId,
	fiscalYearId: company.fiscalYears[0]!.id,
	items: [
		{ account: '1930', amount: '75000.00' },
		{ account: '2081', amount: '-25000.00' },
		{ account: '2091', amount: '-50000.00' },
	],
});

const book = (date: string, description: string, lines: [string, string, string?][]) =>
	api.call('vouchers.create', {
		companyId,
		date,
		description,
		book: true,
		lines: lines.map(([account, amount, taxCode]) => ({ account, amount, taxCode })),
	});

await book(d(1, 15), 'Faktura 1001 Konsulttjänster', [
	['1930', '31250.00'],
	['3001', '-25000.00', 'MP1'],
	['2611', '-6250.00'],
]);
await book(d(1, 20), 'Lokalhyra januari', [
	['5010', '6000.00', 'IP1'],
	['2641', '1500.00'],
	['1930', '-7500.00'],
]);
await book(d(2, 3), 'Datorskärm Webhallen', [
	['5410', '3196.00', 'IP1'],
	['2641', '799.00'],
	['1930', '-3995.00'],
]);
await book(d(2, 14), 'Faktura 1002 Konsulttjänster', [
	['1930', '43750.00'],
	['3001', '-35000.00', 'MP1'],
	['2611', '-8750.00'],
]);
await book(d(2, 28), 'Bankavgift februari', [
	['6570', '125.00'],
	['1930', '-125.00'],
]);

// An agent token with draft-only rights, and a draft created by it, to show the agent workflow.
const token = await api.call('tokens.create', {
	name: 'Claude Code (demo)',
	client: 'claude-code',
	scopes: ['company:read', 'ledger:read', 'ledger:write'],
	companyId,
});
await createClient({ baseUrl: url, token: token.token }).call('vouchers.create', {
	companyId,
	date: d(3, 2),
	description: 'Kontorsmaterial Clas Ohlson (kvitto via agent)',
	lines: [
		{ account: '6110', amount: '476.00', taxCode: 'IP1' },
		{ account: '2641', amount: '119.00' },
		{ account: '1930', amount: '-595.00' },
	],
});

console.log(`Seeded Demo AB (${companyId}). Log in at the web app as ${DEMO_EMAIL}.`);
server.stop();
await close();
