import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface Config {
	url?: string;
	token?: string;
	company?: string;
}

export const configPath = () =>
	process.env.COUNTX3_CONFIG ??
	join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'countx3', 'config.json');

export async function readConfig(): Promise<Config> {
	const file = Bun.file(configPath());
	return (await file.exists()) ? ((await file.json()) as Config) : {};
}

export async function writeConfig(config: Config) {
	const path = configPath();
	await mkdir(dirname(path), { recursive: true });
	await Bun.write(path, `${JSON.stringify(config, null, 2)}\n`);
	await Bun.$`chmod 600 ${path}`.quiet();
}

/** Environment variables win over the config file, so agents can be configured per process. */
export async function effectiveConfig(): Promise<Required<Pick<Config, 'url'>> & Config> {
	const file = await readConfig();
	return {
		url: process.env.COUNTX3_URL ?? file.url ?? 'http://localhost:8787',
		token: process.env.COUNTX3_TOKEN ?? file.token,
		company: process.env.COUNTX3_COMPANY ?? file.company,
	};
}
