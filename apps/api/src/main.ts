import { createDb } from '@countx3/db';
import { createApp } from './app.ts';

const port = Number(process.env.PORT ?? 8787);
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://countx3_app:countx3_app@localhost/countx3_dev';
const publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${port}`;
// Web, Tauri (macOS uses tauri://localhost, Windows http://tauri.localhost) and Capacitor (capacitor://localhost, https://localhost) origins.
const appOrigins = [
	'tauri://localhost',
	'http://tauri.localhost',
	'capacitor://localhost',
	'https://localhost',
];
const corsOrigins = process.env.CORS_ORIGINS
	? process.env.CORS_ORIGINS.split(',')
	: (origin: string) => appOrigins.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);

const { db } = createDb(databaseUrl);
const app = createApp({ db, publicUrl, corsOrigins });

Bun.serve({ port, fetch: app.fetch });
console.log(`countx3 API on ${publicUrl} (MCP at ${publicUrl}/mcp)`);
