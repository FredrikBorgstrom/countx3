import * as companies from './operations/companies.ts';
import * as ledger from './operations/ledger.ts';
import type { AnyOperation } from './registry.ts';

export * from './agent.ts';
export * from './registry.ts';
export * from './schemas.ts';

const all = [...Object.values(companies), ...Object.values(ledger)];

type ByName<T extends { name: string }> = { [Op in T as Op['name']]: Op };
type AllOps = (typeof companies)[keyof typeof companies] | (typeof ledger)[keyof typeof ledger];

/** Every operation, keyed by name. */
export const operations = Object.fromEntries(all.map((op) => [op.name, op])) as ByName<AllOps>;
export type Operations = typeof operations;
export type OperationName = keyof Operations;

export const operationList: readonly AnyOperation[] = all as unknown as AnyOperation[];
