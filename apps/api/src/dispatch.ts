import { type AnyOperation, type OperationName, operations, requestSchema } from '@countx3/contracts';
import { canonicalJson, DomainError, type Issue, sha256Hex } from '@countx3/core';
import { auditEvents, companies, companyMembers, type Db, idempotencyKeys, withContext } from '@countx3/db';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { type HandlerContext, jurisdictions } from './context.ts';
import { handlers } from './handlers/index.ts';
import { actorOf, effectiveScopes, type Principal } from './principal.ts';

export interface ExecuteResult {
	data: unknown;
	dryRun?: true;
	replayed?: true;
}

class DryRunRollback extends Error {
	constructor(readonly data: unknown) {
		super('dry run');
	}
}

const zodIssues = (error: z.ZodError): Issue[] =>
	error.issues.map((i) => ({ code: 'INVALID_INPUT', path: i.path.join('.'), message: i.message }));

/** Long strings (file contents) are summarised in the audit log. */
const forAudit = (value: unknown): unknown => {
	if (typeof value === 'string' && value.length > 2000) return `[${value.length} characters]`;
	if (Array.isArray(value)) return value.map(forAudit);
	if (value && typeof value === 'object')
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, forAudit(v)]));
	return value;
};

/** Runs one operation for a principal. Every transport (REST, MCP, CLI via REST) goes through here. */
export async function execute(
	db: Db,
	name: string,
	rawInput: unknown,
	principal: Principal,
): Promise<ExecuteResult> {
	const op = (operations as Record<string, AnyOperation>)[name];
	if (!op) {
		throw new DomainError('UNKNOWN_OPERATION', `There is no operation named "${name}".`, {
			status: 404,
			hint: 'GET /v1/openapi.json or `countx3 ops` lists all operations.',
		});
	}
	const parsed = requestSchema(op).safeParse(rawInput ?? {});
	if (!parsed.success) {
		throw new DomainError('INVALID_INPUT', `The input to ${name} is invalid.`, {
			status: 400,
			issues: zodIssues(parsed.error),
		});
	}
	const { dryRun, idempotencyKey, ...rest } = parsed.data as Record<string, unknown> & {
		dryRun?: boolean;
		idempotencyKey?: string;
	};
	// Only company-scoped operations take companyId as context; for others (tokens.create) it is ordinary input.
	const { companyId, ...scoped } = rest as { companyId?: string };
	const input = op.companyScoped ? scoped : rest;

	if (op.humanOnly && principal.kind === 'token') {
		throw new DomainError(
			'HUMAN_ONLY',
			`${name} can only be performed by a signed-in person, not with an API token.`,
			{
				status: 403,
			},
		);
	}
	if (principal.kind === 'token' && principal.companyId) {
		if (op.companyScoped ? companyId !== principal.companyId : op.kind === 'mutation') {
			throw new DomainError('TOKEN_COMPANY_MISMATCH', 'This token is restricted to another company.', {
				status: 403,
			});
		}
	}

	try {
		return await withContext(
			db,
			{ userId: principal.userId, companyId: op.companyScoped ? companyId : undefined },
			async (tx) => {
				const ctx: HandlerContext = {
					tx,
					principal,
					actor: actorOf(principal),
					scopes: effectiveScopes(principal, undefined),
					companyId: op.companyScoped ? companyId : undefined,
					role: undefined,
					pack: undefined,
					auditTarget: undefined,
				};

				if (op.companyScoped) {
					const [membership] = await tx
						.select({ role: companyMembers.role, country: companies.country })
						.from(companyMembers)
						.innerJoin(companies, eq(companies.id, companyMembers.companyId))
						.where(
							and(eq(companyMembers.companyId, companyId!), eq(companyMembers.userId, principal.userId)),
						);
					if (!membership)
						throw new DomainError('COMPANY_NOT_FOUND', 'Company not found or not accessible.', {
							status: 404,
						});
					ctx.role = membership.role;
					ctx.pack = jurisdictions[membership.country];
					ctx.scopes = effectiveScopes(principal, membership.role);
				}
				if (op.scope !== 'authenticated' && !ctx.scopes.has(op.scope)) {
					throw new DomainError('MISSING_SCOPE', `${name} requires the scope "${op.scope}".`, {
						status: 403,
						hint:
							principal.kind === 'token'
								? 'Ask the user to create a token with this scope (tokens.create).'
								: 'Your role in this company does not allow this.',
					});
				}

				const idempotency = op.kind === 'mutation' && idempotencyKey && !dryRun;
				const principalKey =
					principal.kind === 'token' ? `token:${principal.tokenId}` : `user:${principal.userId}`;
				const requestHash = idempotency ? await sha256Hex(canonicalJson({ name, input })) : '';
				if (idempotency) {
					const [previous] = await tx
						.select()
						.from(idempotencyKeys)
						.where(and(eq(idempotencyKeys.principal, principalKey), eq(idempotencyKeys.key, idempotencyKey)));
					if (previous) {
						if (previous.requestHash !== requestHash || previous.operation !== name) {
							throw new DomainError(
								'IDEMPOTENCY_KEY_REUSED',
								'This idempotency key was already used for a different request.',
								{
									status: 409,
								},
							);
						}
						return { data: previous.response, replayed: true } satisfies ExecuteResult;
					}
				}

				const handler = (
					handlers as unknown as Record<string, (ctx: HandlerContext, input: unknown) => Promise<unknown>>
				)[name]!;
				const data = op.output.parse(await handler(ctx, op.input.parse(input)));

				if (op.kind === 'mutation') {
					await tx.insert(auditEvents).values({
						companyId: ctx.companyId ?? null,
						actor: ctx.actor,
						operation: name,
						targetType: ctx.auditTarget?.type,
						targetId: ctx.auditTarget?.id,
						data: forAudit(input) as object,
					});
				}
				if (idempotency) {
					await tx.insert(idempotencyKeys).values({
						principal: principalKey,
						key: idempotencyKey,
						operation: name,
						requestHash,
						response: data as object,
					});
				}
				if (dryRun && op.kind === 'mutation') throw new DryRunRollback(data);
				return { data } satisfies ExecuteResult;
			},
		);
	} catch (error) {
		if (error instanceof DryRunRollback) return { data: error.data, dryRun: true };
		throw error;
	}
}

export const isOperationName = (name: string): name is OperationName => name in operations;
