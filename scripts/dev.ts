/**
 * Runs the local API (http://localhost:8787) and web app (http://localhost:5173) together: `bun run dev`.
 * Pending migrations are applied first. A server that is already running is reused, so the desktop app
 * (whose Tauri config calls this script) and a separate `bun run dev` can share one API and web server.
 */
import { join } from 'node:path';
import { SQL } from 'bun';

const root = join(import.meta.dir, '..');
const OWNER_URL =
	process.env.DATABASE_OWNER_URL ?? 'postgres://countx3_owner:countx3_owner@localhost/countx3_dev';

const isUp = (url: string) =>
	fetch(url, { signal: AbortSignal.timeout(1000) }).then(
		() => true,
		() => false,
	);

try {
	const sql = new SQL(OWNER_URL);
	await sql`select 1`;
	await sql.close();
} catch {
	console.error(
		'Postgres is not reachable or the countx3_dev database is missing. Run `bun run setup` first.',
	);
	process.exit(1);
}
const migrate = Bun.spawnSync(['bun', 'src/migrate.ts'], {
	cwd: join(root, 'packages/db'),
	env: { ...process.env, DATABASE_OWNER_URL: OWNER_URL },
	stdout: 'inherit',
	stderr: 'inherit',
});
if (migrate.exitCode !== 0) process.exit(migrate.exitCode);

const servers = [
	{
		name: 'api',
		url: 'http://localhost:8787/healthz',
		cwd: 'apps/api',
		cmd: ['bun', '--hot', 'src/main.ts'],
	},
	{
		name: 'web',
		url: 'http://localhost:5173',
		cwd: 'apps/web',
		cmd: ['bun', 'run', 'dev', '--', '--port', '5173', '--strictPort'],
	},
];

/** Prefixes each output line with the server's name so both logs can share one terminal. */
async function relay(stream: ReadableStream<Uint8Array>, name: string, out: NodeJS.WritableStream) {
	const decoder = new TextDecoder();
	let pending = '';
	for await (const bytes of stream) {
		const lines = (pending + decoder.decode(bytes, { stream: true })).split('\n');
		pending = lines.pop() ?? '';
		for (const line of lines) out.write(`[${name}] ${line}\n`);
	}
	if (pending) out.write(`[${name}] ${pending}\n`);
}

const children: Bun.Subprocess<'ignore', 'pipe', 'pipe'>[] = [];
for (const server of servers) {
	if (await isUp(server.url)) {
		console.log(`[${server.name}] already running at ${new URL(server.url).origin}, reusing it`);
		continue;
	}
	const child = Bun.spawn(server.cmd, { cwd: join(root, server.cwd), stdout: 'pipe', stderr: 'pipe' });
	relay(child.stdout, server.name, process.stdout);
	relay(child.stderr, server.name, process.stderr);
	children.push(child);
}
if (children.length === 0) process.exit(0);

console.log('\ncountx3 is starting: open http://localhost:5173 (demo login: see scripts/seed_dev.ts)\n');

const stop = () => {
	for (const child of children) child.kill();
	process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
// If one server dies, stop the other so the terminal doesn't look healthy while half the app is down.
const exited = await Promise.race(children.map((child) => child.exited));
for (const child of children) child.kill();
process.exit(exited);
