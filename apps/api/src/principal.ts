import type { Role, Scope } from '@countx3/contracts';
import { scopes as allScopes, roleScopes } from '@countx3/contracts';
import { type Actor, DomainError, sha256Hex } from '@countx3/core';
import { apiTokens, type Db, sessions, users } from '@countx3/db';
import { and, eq, gt, isNull, or } from 'drizzle-orm';

export type Principal =
	| { kind: 'user'; userId: string; name: string; email: string; sessionId: string }
	| {
			kind: 'token';
			userId: string;
			name: string;
			email: string;
			tokenId: string;
			tokenName: string;
			client: string | null;
			scopes: Scope[];
			companyId: string | null;
	  };

const SESSION_DAYS = 30;

const randomSecret = (prefix: string) =>
	`${prefix}_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')}`;

export const newTokenSecret = () => randomSecret('cx3');

export async function createSession(db: Db, userId: string) {
	const secret = randomSecret('cx3s');
	await db.insert(sessions).values({
		userId,
		secretHash: await sha256Hex(secret),
		expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000),
	});
	return secret;
}

export async function deleteSession(db: Db, secret: string) {
	await db.delete(sessions).where(eq(sessions.secretHash, await sha256Hex(secret)));
}

export async function signUp(db: Db, input: { email: string; name: string; password: string }) {
	if (input.password.length < 10) {
		throw new DomainError('PASSWORD_TOO_SHORT', 'Passwords must be at least 10 characters.', { status: 400 });
	}
	const email = input.email.trim().toLowerCase();
	const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
	if (existing.length > 0)
		throw new DomainError('EMAIL_TAKEN', 'An account with this email already exists.', { status: 409 });
	const [user] = await db
		.insert(users)
		.values({ email, name: input.name.trim(), passwordHash: await Bun.password.hash(input.password) })
		.returning();
	return { user: user!, sessionToken: await createSession(db, user!.id) };
}

export async function logIn(db: Db, input: { email: string; password: string }) {
	const [user] = await db.select().from(users).where(eq(users.email, input.email.trim().toLowerCase()));
	const ok = user?.passwordHash ? await Bun.password.verify(input.password, user.passwordHash) : false;
	if (!user || !ok) throw new DomainError('INVALID_CREDENTIALS', 'Wrong email or password.', { status: 401 });
	return { user, sessionToken: await createSession(db, user.id) };
}

/** Resolves a bearer secret (session `cx3s_…` or agent token `cx3_…`) to a principal. */
export async function resolvePrincipal(
	db: Db,
	authorization: string | undefined | null,
): Promise<Principal | null> {
	const secret = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
	if (!secret) return null;
	const hash = await sha256Hex(secret);
	const now = new Date();

	if (secret.startsWith('cx3s_')) {
		const [row] = await db
			.select({ session: sessions, user: users })
			.from(sessions)
			.innerJoin(users, eq(users.id, sessions.userId))
			.where(and(eq(sessions.secretHash, hash), gt(sessions.expiresAt, now)));
		if (!row) return null;
		return {
			kind: 'user',
			userId: row.user.id,
			name: row.user.name,
			email: row.user.email,
			sessionId: row.session.id,
		};
	}

	const [row] = await db
		.select({ token: apiTokens, user: users })
		.from(apiTokens)
		.innerJoin(users, eq(users.id, apiTokens.userId))
		.where(
			and(
				eq(apiTokens.secretHash, hash),
				isNull(apiTokens.revokedAt),
				or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, now)),
			),
		);
	if (!row) return null;
	await db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, row.token.id));
	return {
		kind: 'token',
		userId: row.user.id,
		name: row.user.name,
		email: row.user.email,
		tokenId: row.token.id,
		tokenName: row.token.name,
		client: row.token.client,
		scopes: row.token.scopes as Scope[],
		companyId: row.token.companyId,
	};
}

export function actorOf(principal: Principal): Actor & { onBehalfOf?: string } {
	if (principal.kind === 'user') return { type: 'user', id: principal.userId, name: principal.name };
	return {
		type: 'agent',
		id: principal.tokenId,
		name: principal.tokenName,
		client: principal.client ?? undefined,
		onBehalfOf: principal.userId,
	};
}

/** Scopes the principal holds: its role in the company (if any), narrowed by the token's scopes. */
export function effectiveScopes(principal: Principal, role: Role | undefined): Set<Scope> {
	const base = role ? roleScopes[role] : allScopes;
	return new Set(principal.kind === 'token' ? base.filter((s) => principal.scopes.includes(s)) : base);
}
