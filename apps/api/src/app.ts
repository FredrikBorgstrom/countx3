import { DomainError } from '@countx3/core';
import type { Db } from '@countx3/db';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { execute } from './dispatch.ts';
import { errorBody } from './errors.ts';
import { handleMcpRequest } from './mcp.ts';
import { openApiDocument } from './openapi.ts';
import { deleteSession, logIn, type Principal, resolvePrincipal, signUp } from './principal.ts';

export interface AppOptions {
	db: Db;
	publicUrl: string;
	/** Allowed browser origins: a list, or a predicate (used in development to allow any localhost port). */
	corsOrigins: string[] | ((origin: string) => boolean);
}

type Env = { Variables: { principal: Principal } };

const SignUp = z.object({ email: z.email(), name: z.string().min(1).max(200), password: z.string() });
const LogIn = z.object({ email: z.string(), password: z.string() });

export function createApp({ db, publicUrl, corsOrigins }: AppOptions) {
	const app = new Hono<Env>();

	const origin = typeof corsOrigins === 'function' ? (o: string) => (corsOrigins(o) ? o : null) : corsOrigins;
	app.use(
		'*',
		cors({
			origin,
			allowHeaders: [
				'Authorization',
				'Content-Type',
				'Mcp-Protocol-Version',
				'Mcp-Session-Id',
				'Idempotency-Key',
			],
		}),
	);

	app.onError((error, c) => {
		const { status, body } = errorBody(error);
		return c.json({ ok: false, error: body }, status as 400);
	});

	app.get('/healthz', (c) => c.json({ ok: true }));
	app.get('/v1/openapi.json', (c) => c.json(openApiDocument(publicUrl)));

	app.post('/v1/auth/signup', async (c) => {
		const input = SignUp.safeParse(await c.req.json().catch(() => ({})));
		if (!input.success)
			throw new DomainError('INVALID_INPUT', 'Email, name and password are required.', { status: 400 });
		const { user, sessionToken } = await signUp(db, input.data);
		return c.json({
			ok: true,
			data: { sessionToken, user: { id: user.id, email: user.email, name: user.name } },
		});
	});

	app.post('/v1/auth/login', async (c) => {
		const input = LogIn.safeParse(await c.req.json().catch(() => ({})));
		if (!input.success)
			throw new DomainError('INVALID_INPUT', 'Email and password are required.', { status: 400 });
		const { user, sessionToken } = await logIn(db, input.data);
		return c.json({
			ok: true,
			data: { sessionToken, user: { id: user.id, email: user.email, name: user.name } },
		});
	});

	app.post('/v1/auth/logout', async (c) => {
		const secret = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '');
		if (secret) await deleteSession(db, secret);
		return c.json({ ok: true, data: {} });
	});

	const requireAuth = createMiddleware<Env>(async (c, next) => {
		const principal = await resolvePrincipal(db, c.req.header('Authorization'));
		if (!principal) {
			throw new DomainError('UNAUTHENTICATED', 'Missing or invalid bearer token.', {
				status: 401,
				hint: 'Send "Authorization: Bearer <token>"; create an agent token in the app or with `countx3 login`.',
			});
		}
		c.set('principal', principal);
		await next();
	});

	app.post('/v1/ops/:name', requireAuth, async (c) => {
		const body = await c.req.json().catch(() => {
			throw new DomainError('INVALID_JSON', 'The request body must be JSON.', { status: 400 });
		});
		const idempotencyKey = c.req.header('Idempotency-Key');
		const input = idempotencyKey && body && typeof body === 'object' ? { ...body, idempotencyKey } : body;
		const result = await execute(db, c.req.param('name'), input, c.get('principal'));
		return c.json({ ok: true, ...result });
	});

	app.all('/mcp', requireAuth, (c) => handleMcpRequest(db, c.get('principal'), c.req.raw));

	return app;
}
