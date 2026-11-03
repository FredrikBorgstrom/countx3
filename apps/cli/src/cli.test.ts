import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '@countx3/api';
import { operationList, toolName } from '@countx3/contracts';
import { createDb } from '@countx3/db';
import { createClient } from '@countx3/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const MAIN = join(import.meta.dir, 'main.ts');
const { db, close } = createDb(
	process.env.TEST_DATABASE_URL ?? 'postgres://countx3_app:countx3_app@localhost/countx3_test',
);
const server = Bun.serve({
	port: 0,
	fetch: createApp({ db, publicUrl: 'http://cli-test', corsOrigins: ['*'] }).fetch,
});
const url = `http://localhost:${server.port}`;

let dir: string;
let env: Record<string, string>;
let companyId: string;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'countx3-cli-'));
	const client = createClient({ baseUrl: url });
	const { sessionToken } = await client.auth.signUp({
		email: `${Bun.randomUUIDv7()}@example.test`,
		name: 'CLI',
		password: 'correct horse battery',
	});
	env = {
		...(process.env as Record<string, string>),
		COUNTX3_URL: url,
		COUNTX3_TOKEN: sessionToken,
		COUNTX3_CONFIG: join(dir, 'config.json'),
	};
});

afterAll(async () => {
	server.stop(true);
	await close();
	await rm(dir, { recursive: true, force: true });
});

async function cli(args: string[], stdin?: string) {
	const proc = Bun.spawn(['bun', MAIN, ...args], {
		env,
		stdin: stdin === undefined ? 'ignore' : new Blob([stdin]),
		stdout: 'pipe',
		stderr: 'pipe',
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { code, stdout, stderr, json: () => JSON.parse(stdout || stderr) };
}

describe('countx3 CLI', () => {
	test('lists every operation', async () => {
		const res = await cli(['ops', '--json']);
		expect(
			res
				.json()
				.map((o: { name: string }) => o.name)
				.sort(),
		).toEqual(operationList.map((o) => o.name).sort());
	});

	test('creates a company from stdin and books with flags', async () => {
		const created = await cli(
			['companies', 'create', '--input', '-'],
			JSON.stringify({
				name: 'Cli AB',
				legalForm: 'AB',
				organizationNumber: '556036-0793',
				fiscalYear: { start: '2026-01-01', end: '2026-12-31' },
			}),
		);
		expect(created.code).toBe(0);
		companyId = created.json().data.id;
		expect((await cli(['use', companyId])).code).toBe(0);

		const lines = JSON.stringify([
			{ account: '5410', amount: '400.00' },
			{ account: '2641', amount: '100.00' },
			{ account: '1930', amount: '-500.00' },
		]);
		const booked = await cli([
			'vouchers',
			'create',
			'--date',
			'2026-02-02',
			'--description',
			'Skrivbordslampa',
			'--lines',
			lines,
			'--book',
		]);
		expect(booked.code).toBe(0);
		expect(booked.json().data.ref).toBe('A1');

		const preview = await cli([
			'vouchers',
			'create',
			'--date',
			'2026-02-03',
			'--description',
			'Test',
			'--lines',
			lines,
			'--dry-run',
		]);
		expect(preview.json().dryRun).toBe(true);
	});

	test('errors are JSON with a code and a non-zero exit', async () => {
		const res = await cli([
			'vouchers',
			'create',
			'--date',
			'2026-02-02',
			'--description',
			'Fel',
			'--lines',
			'[{"account":"1930","amount":"1"},{"account":"3001","amount":"-2"}]',
		]);
		expect(res.code).toBe(1);
		expect(res.json().error.code).toBe('VOUCHER_INVALID');
		const usage = await cli(['vouchers', 'create', '--colour', 'red']);
		expect(usage.code).toBe(2);
		expect(usage.stderr).toContain('Unknown flag --colour');
	});

	test('help describes flags and examples', async () => {
		const res = await cli(['vouchers', 'create', '--help']);
		expect(res.stdout).toContain('--description <string>');
		expect(res.stdout).toContain('Office supplies paid by card');
	});

	test('SIE files round-trip through --out and --file', async () => {
		const file = join(dir, 'export.se');
		const exported = await cli(['sie', 'export', '--out', file]);
		expect(exported.json().data.writtenTo).toBe(file);
		const other = await cli(
			['companies', 'create', '--input', '-'],
			JSON.stringify({
				name: 'Kopia AB',
				legalForm: 'AB',
				organizationNumber: '556036-0793',
				fiscalYear: { start: '2026-01-01', end: '2026-12-31' },
			}),
		);
		const imported = await cli(['sie', 'import', '--company', other.json().data.id, '--file', file]);
		expect(imported.json().data.vouchersBooked).toBe(1);
	});

	test('stdio MCP server exposes the registry and uses the default company', async () => {
		const transport = new StdioClientTransport({ command: 'bun', args: [MAIN, 'mcp'], env });
		const client = new Client({ name: 'cli-test', version: '1' });
		await client.connect(transport);
		try {
			const { tools } = await client.listTools();
			expect(tools.map((t) => t.name).sort()).toEqual(
				operationList
					.filter((o) => !o.humanOnly)
					.map((o) => toolName(o.name))
					.sort(),
			);
			const result = await client.callTool({ name: 'vouchers_list', arguments: {} });
			const body = JSON.parse((result.content as { text: string }[])[0]!.text);
			expect(body.data.items.map((v: { ref: string }) => v.ref)).toEqual(['A1']);
		} finally {
			await client.close();
		}
	});
});
