import type { Operations, Role, Scope } from '@countx3/contracts';
import type { Actor, JurisdictionPack } from '@countx3/core';
import type { Tx } from '@countx3/db';
import { sweden } from '@countx3/jurisdiction-se';
import type { z } from 'zod';
import type { Principal } from './principal.ts';

export const jurisdictions: Record<string, JurisdictionPack> = { SE: sweden };

export interface HandlerContext {
	tx: Tx;
	principal: Principal;
	actor: Actor;
	scopes: Set<Scope>;
	/** Set for company-scoped operations (and by companies.create once the company exists). */
	companyId: string | undefined;
	role: Role | undefined;
	pack: JurisdictionPack | undefined;
	/** Handlers name what they changed; the dispatcher writes it to the audit log. */
	auditTarget: { type: string; id: string } | undefined;
}

type InputOf<N extends keyof Operations> = z.output<Operations[N]['input']>;
type OutputOf<N extends keyof Operations> = z.input<Operations[N]['output']>;

export type Handler<N extends keyof Operations> = (
	ctx: HandlerContext,
	input: InputOf<N>,
) => Promise<OutputOf<N>>;
export type Handlers = { [N in keyof Operations]: Handler<N> };

/** Narrows the context of a company-scoped operation. */
export function companyContext(ctx: HandlerContext) {
	if (!ctx.companyId || !ctx.pack || !ctx.role) throw new Error('company context missing');
	return { ...ctx, companyId: ctx.companyId, pack: ctx.pack, role: ctx.role };
}
export type CompanyContext = ReturnType<typeof companyContext>;
