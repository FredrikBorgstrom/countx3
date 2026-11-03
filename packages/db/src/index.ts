import { DomainError } from '@countx3/core';
import { SQL } from 'bun';
import { sql } from 'drizzle-orm';
import { type BunSQLDatabase, drizzle } from 'drizzle-orm/bun-sql';
import * as schema from './schema.ts';

export * from './schema.ts';
export { schema };

export type Db = BunSQLDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function createDb(url: string) {
	const client = new SQL(url);
	return { db: drizzle({ client, schema }), close: () => client.close() };
}

export interface DbContext {
	userId?: string | undefined;
	companyId?: string | undefined;
}

/** Runs `fn` in a transaction whose row-level-security context is the given user and company. */
export function withContext<T>(db: Db, ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
	return db
		.transaction(async (tx) => {
			await tx.execute(
				sql`select set_config('app.user_id', ${ctx.userId ?? ''}, true), set_config('app.company_id', ${ctx.companyId ?? ''}, true)`,
			);
			return fn(tx);
		})
		.catch((error) => {
			throw translateDbError(error);
		});
}

/** Switches the company context inside a running transaction (used right after creating a company). */
export const setCompanyContext = (tx: Tx, companyId: string) =>
	tx.execute(sql`select set_config('app.company_id', ${companyId}, true)`);

const guardMessages: Record<string, string> = {
	VOUCHER_IMMUTABLE: 'Booked vouchers cannot be changed or deleted.',
	VOUCHER_UNBALANCED: 'The voucher does not balance.',
	AUDIT_APPEND_ONLY: 'The audit log is append-only.',
};

/** Turns errors raised by our database guards into DomainErrors with stable codes. */
export function translateDbError(error: unknown): unknown {
	if (error instanceof DomainError) return error;
	// Drizzle wraps driver errors in DrizzleQueryError; the Postgres error is its cause.
	const cause = (error as { cause?: unknown })?.cause;
	const e = (cause ?? error) as { errno?: string; hint?: string; message?: string };
	if (e?.errno === 'P0001' && e.hint) {
		return new DomainError(e.hint, guardMessages[e.hint] ?? e.message ?? e.hint, {
			hint: e.hint === 'VOUCHER_IMMUTABLE' ? 'Use vouchers.correct to book a correction voucher.' : undefined,
			status: e.hint === 'NOT_FOUND' ? 404 : 409,
		});
	}
	if (e?.errno === '23505') {
		return new DomainError('CONFLICT', 'A record with the same key already exists.', { status: 409 });
	}
	if (e?.errno === '42501') {
		return new DomainError('FORBIDDEN', 'Access denied by row-level security.', { status: 403 });
	}
	return error;
}
