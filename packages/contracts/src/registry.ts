import { z } from 'zod';

export const scopes = [
	'company:read',
	'company:admin',
	'ledger:read',
	'ledger:write',
	'ledger:book',
	'tokens:manage',
] as const;
export type Scope = (typeof scopes)[number];

export const roles = ['owner', 'accountant', 'member', 'auditor'] as const;
export type Role = (typeof roles)[number];

/** What each company role may do. Tokens are further limited to the scopes they were created with. */
export const roleScopes: Record<Role, readonly Scope[]> = {
	owner: scopes,
	accountant: ['company:read', 'ledger:read', 'ledger:write', 'ledger:book', 'tokens:manage'],
	member: ['company:read', 'ledger:read', 'ledger:write', 'tokens:manage'],
	auditor: ['company:read', 'ledger:read'],
};

/**
 * One definition per operation. REST routes, OpenAPI, MCP tools, CLI commands and the typed SDK
 * are all generated from these, so every surface always offers the same capabilities.
 */
export interface Operation<
	N extends string = string,
	I extends z.ZodObject = z.ZodObject,
	O extends z.ZodType = z.ZodType,
	K extends 'query' | 'mutation' = 'query' | 'mutation',
	C extends boolean = boolean,
> {
	/** `group.action`, e.g. `vouchers.create`. */
	name: N;
	summary: string;
	/** Written for agents: when to use it, what it changes, what to call next. */
	description: string;
	/** `authenticated` = any signed-in principal. */
	scope: Scope | 'authenticated';
	kind: K;
	/** Adds a required `companyId` to the input and runs under that company's row-level security. */
	companyScoped: C;
	/** Only a human session may call it (e.g. minting tokens); agent tokens are refused. */
	humanOnly?: boolean;
	input: I;
	output: O;
	examples?: { title: string; input: Record<string, unknown> }[];
}

export const defineOperation = <
	const N extends string,
	I extends z.ZodObject,
	O extends z.ZodType,
	const K extends 'query' | 'mutation',
	const C extends boolean,
>(
	op: Operation<N, I, O, K, C>,
) => op;

export type AnyOperation = Operation<string, z.ZodObject, z.ZodType, 'query' | 'mutation', boolean>;

const mutationOptions = {
	dryRun: z
		.boolean()
		.optional()
		.describe('Validate and compute the result without saving anything. Always available on mutations.'),
	idempotencyKey: z
		.string()
		.min(1)
		.max(200)
		.optional()
		.describe('Retrying with the same key returns the first result instead of repeating the change.'),
};

const companyIdField = { companyId: z.uuid().describe('The company to act on (see companies.list).') };

/** The complete input accepted on the wire: operation input plus companyId / dryRun / idempotencyKey. */
export function requestSchema(op: AnyOperation): z.ZodObject {
	let schema: z.ZodObject = op.input;
	if (op.companyScoped) schema = schema.extend(companyIdField);
	if (op.kind === 'mutation') schema = schema.extend(mutationOptions);
	return schema;
}

type CompanyPart<C> = C extends true ? { companyId: string } : unknown;
type MutationPart<K> = K extends 'mutation' ? { dryRun?: boolean; idempotencyKey?: string } : unknown;

/** An empty input object (`z.object({})`) is `Record<string, never>`; treat it as "no fields" so it can be intersected. */
type InputPart<I extends z.ZodObject> = string extends keyof z.input<I> ? unknown : z.input<I>;

export type RequestOf<Op> =
	Op extends Operation<string, infer I, z.ZodType, infer K, infer C>
		? InputPart<I> & CompanyPart<C> & MutationPart<K>
		: never;

export type ResultOf<Op> = Op extends Operation<string, z.ZodObject, infer O> ? z.output<O> : never;

/** CLI and MCP names derived from the operation name. */
export const toolName = (name: string) => name.replace('.', '_');
export const cliPath = (name: string) =>
	name.split('.').map((part) => part.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
