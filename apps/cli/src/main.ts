#!/usr/bin/env bun
import { operationList } from '@countx3/contracts';
import { Countx3Error, createClient } from '@countx3/sdk';
import { kebab, type ParsedArgs, parseArgs } from './args.ts';
import { configPath, effectiveConfig, readConfig, writeConfig } from './config.ts';
import { runMcpServer } from './mcp.ts';
import { coerce, findOperation, inputJsonSchema, operationHelp, UsageError } from './operations.ts';

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

const USAGE = `countx3 — bookkeeping from the command line (and for coding agents)

Usage:
  countx3 <group> <action> [--flags]   Run an operation, e.g. countx3 vouchers list --from 2026-01-01
  countx3 <group> <action> --help      Describe an operation, its flags and examples
  countx3 ops [--json]                 List every operation
  countx3 schema <group.action>        JSON Schema of an operation's input
  countx3 login [--url URL] [--email EMAIL]    Sign in as a person (stores a session token)
  countx3 login --token cx3_…          Use an agent token instead
  countx3 use <companyId>              Set the default company (used when --company is omitted)
  countx3 config                       Show the effective configuration
  countx3 mcp                          Run a stdio MCP server (for Claude Code, Codex, …)

Environment: COUNTX3_URL, COUNTX3_TOKEN, COUNTX3_COMPANY override ${configPath()}.
Results are JSON on stdout; errors are JSON on stderr with a stable "code" and a "hint". Exit codes: 0 ok, 1 error, 2 usage.`;

async function readPassword(promptText: string): Promise<string> {
	if (process.env.COUNTX3_PASSWORD) return process.env.COUNTX3_PASSWORD;
	if (!process.stdin.isTTY) return (await Bun.stdin.text()).trim();
	process.stdout.write(promptText);
	process.stdin.setRawMode(true);
	process.stdin.resume();
	return new Promise((resolve) => {
		let password = '';
		const onData = (chunk: Buffer) => {
			for (const char of chunk.toString('utf8')) {
				if (char === '\r' || char === '\n') {
					process.stdin.setRawMode(false);
					process.stdin.pause();
					process.stdin.off('data', onData);
					process.stdout.write('\n');
					resolve(password);
					return;
				}
				if (char === '\u0003') process.exit(130);
				password = char === '\u007f' ? password.slice(0, -1) : password + char;
			}
		};
		process.stdin.on('data', onData);
	});
}

async function login(args: ParsedArgs) {
	const current = await readConfig();
	const url = (args.flags.get('url') as string | undefined) ?? current.url ?? 'http://localhost:8787';
	const token = args.flags.get('token');
	if (typeof token === 'string') {
		await writeConfig({ ...current, url, token });
		const me = await createClient({ baseUrl: url, token }).call('me.get', {});
		print({ signedInAs: me.principal, companies: me.companies });
		return;
	}
	const email = (args.flags.get('email') as string | undefined) ?? prompt('Email:') ?? '';
	const password = await readPassword('Password: ');
	const session = await createClient({ baseUrl: url }).auth.logIn({ email, password });
	await writeConfig({ ...current, url, token: session.sessionToken });
	print({ signedInAs: session.user });
}

async function runOperation(args: ParsedArgs, group: string, action: string | undefined) {
	const op = findOperation(group, action);
	if (!op) {
		const inGroup = operationList.filter((o) =>
			o.name.startsWith(`${group.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}.`),
		);
		throw new UsageError(
			inGroup.length
				? `Unknown action. Available: ${inGroup.map((o) => kebab(o.name.split('.')[1]!)).join(', ')}`
				: `Unknown command "${group}". Run \`countx3 ops\` to list operations.`,
		);
	}
	if (args.flags.get('help')) {
		console.log(operationHelp(op));
		return;
	}

	const config = await effectiveConfig();
	const schema = inputJsonSchema(op);
	let input: Record<string, unknown> = {};
	const source = args.flags.get('input');
	if (typeof source === 'string') {
		input = JSON.parse(source === '-' ? await Bun.stdin.text() : await Bun.file(source).text());
	}
	for (const [name, value] of args.flags) {
		if (['input', 'help', 'out', 'file', 'company'].includes(name)) continue;
		if (!schema.properties?.[name])
			throw new UsageError(`Unknown flag --${kebab(name)} for ${op.name}. See --help.`);
		input[name] = coerce(name, value, schema.properties[name]);
	}
	const file = args.flags.get('file');
	if (typeof file === 'string')
		input.contentBase64 = Buffer.from(await Bun.file(file).arrayBuffer()).toString('base64');
	if (op.companyScoped) {
		const company = args.flags.get('company');
		input.companyId ??= typeof company === 'string' ? company : config.company;
		if (!input.companyId)
			throw new UsageError('No company given. Pass --company <id> or run `countx3 use <id>`.');
	}

	const result = await createClient({ baseUrl: config.url, token: config.token }).callRaw<
		Record<string, unknown>
	>(op.name, input);
	const out = args.flags.get('out');
	if (typeof out === 'string' && typeof result.data.contentBase64 === 'string') {
		await Bun.write(out, Buffer.from(result.data.contentBase64, 'base64'));
		print({ ...result, data: { fileName: result.data.fileName, writtenTo: out } });
		return;
	}
	print(result);
}

async function main(argv: string[]) {
	const args = parseArgs(argv);
	const [command, sub] = args.positional;
	switch (command) {
		case undefined:
		case 'help':
			console.log(USAGE);
			return;
		case 'ops': {
			const list = operationList.map((op) => ({
				name: op.name,
				kind: op.kind,
				scope: op.scope,
				summary: op.summary,
			}));
			if (args.flags.get('json')) print(list);
			else
				for (const op of list)
					console.log(`${op.name.padEnd(28)} ${op.kind.padEnd(9)} ${op.scope.padEnd(15)} ${op.summary}`);
			return;
		}
		case 'schema': {
			const [group, action] = (sub ?? '').split('.');
			const op = findOperation(group ?? '', action);
			if (!op) throw new UsageError('Usage: countx3 schema <group.action>');
			print(inputJsonSchema(op));
			return;
		}
		case 'login':
			return login(args);
		case 'logout': {
			const config = await readConfig();
			if (config.token?.startsWith('cx3s_'))
				await createClient({ baseUrl: config.url ?? '', token: config.token }).auth.logOut();
			await writeConfig({ ...config, token: undefined });
			print({ signedOut: true });
			return;
		}
		case 'use': {
			if (!sub) throw new UsageError('Usage: countx3 use <companyId>');
			await writeConfig({ ...(await readConfig()), company: sub });
			print({ company: sub });
			return;
		}
		case 'config': {
			const config = await effectiveConfig();
			print({ ...config, token: config.token ? `${config.token.slice(0, 12)}…` : null, file: configPath() });
			return;
		}
		case 'mcp':
			return runMcpServer(await effectiveConfig());
		default:
			return runOperation(args, command, sub);
	}
}

try {
	await main(process.argv.slice(2));
} catch (error) {
	if (error instanceof UsageError) {
		console.error(error.message);
		process.exit(2);
	}
	const body =
		error instanceof Countx3Error
			? error.toJSON()
			: {
					code: 'CLIENT_ERROR',
					message: error instanceof Error ? error.message : String(error),
					hint: 'Is the API running? Check `countx3 config`.',
				};
	console.error(JSON.stringify({ error: body }, null, 2));
	process.exit(1);
}
