import type { Handlers } from '../context.ts';
import { companyHandlers } from './companies.ts';
import { ledgerHandlers } from './ledger.ts';

/** Exactly one handler per operation; the type makes a missing one a compile error. */
export const handlers: Handlers = { ...companyHandlers, ...ledgerHandlers };
