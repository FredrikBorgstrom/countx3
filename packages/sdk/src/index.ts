import type { OperationName, Operations, RequestOf, ResultOf } from '@countx3/contracts';

export interface ErrorDetails {
	code: string;
	message: string;
	hint?: string;
	issues?: { code: string; message: string; hint?: string; path?: string }[];
}

export class Countx3Error extends Error {
	readonly code: string;
	readonly hint: string | undefined;
	readonly issues: ErrorDetails['issues'];
	readonly status: number;

	constructor(details: ErrorDetails, status: number) {
		super(details.message);
		this.name = 'Countx3Error';
		this.code = details.code;
		this.hint = details.hint;
		this.issues = details.issues;
		this.status = status;
	}

	toJSON(): ErrorDetails {
		return { code: this.code, message: this.message, hint: this.hint, issues: this.issues };
	}
}

export interface ClientOptions {
	baseUrl: string;
	/** Session token or agent token; a function lets the app swap it after login. */
	token?: string | (() => string | undefined);
	fetch?: typeof fetch;
}

export interface CallResult<T> {
	data: T;
	dryRun?: true;
	replayed?: true;
}

type Group = OperationName extends `${infer G}.${string}` ? G : never;
type GroupOps<G extends string> = {
	[N in OperationName as N extends `${G}.${infer A}` ? A : never]: (
		input: RequestOf<Operations[N]>,
	) => Promise<ResultOf<Operations[N]>>;
};
/** `client.ops.vouchers.create({...})` — one typed function per operation. */
export type OpsProxy = { [G in Group]: GroupOps<G> };

export function createClient(options: ClientOptions) {
	const doFetch = options.fetch ?? fetch;
	const base = options.baseUrl.replace(/\/$/, '');
	const token = () => (typeof options.token === 'function' ? options.token() : options.token);

	async function request<T>(path: string, body: unknown, withAuth = true): Promise<CallResult<T>> {
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		const t = withAuth ? token() : undefined;
		if (t) headers.Authorization = `Bearer ${t}`;
		const res = await doFetch(`${base}${path}`, {
			method: 'POST',
			headers,
			body: JSON.stringify(body ?? {}),
		});
		const envelope = (await res.json().catch(() => null)) as
			| ({ ok: true; data: T; dryRun?: true; replayed?: true } | { ok: false; error: ErrorDetails })
			| null;
		if (!envelope)
			throw new Countx3Error(
				{ code: 'BAD_RESPONSE', message: `Unexpected response (${res.status}) from ${base}` },
				res.status,
			);
		if (!envelope.ok) throw new Countx3Error(envelope.error, res.status);
		const { ok: _, ...result } = envelope;
		return result;
	}

	/** Calls an operation by name and returns the full result (data plus dryRun/replayed flags). */
	const callRaw = <T = unknown>(name: string, input: unknown) => request<T>(`/v1/ops/${name}`, input);

	/** Calls an operation by name; fully typed from the operation registry. */
	async function call<N extends OperationName>(
		name: N,
		input: RequestOf<Operations[N]>,
	): Promise<ResultOf<Operations[N]>> {
		return (await callRaw<ResultOf<Operations[N]>>(name, input)).data;
	}

	const ops = new Proxy({} as OpsProxy, {
		get: (_, group: string) =>
			new Proxy(
				{},
				{
					get: (__, action: string) => (input: unknown) =>
						call(`${group}.${action}` as OperationName, input as never),
				},
			),
	});

	type Session = { sessionToken: string; user: { id: string; email: string; name: string } };
	const auth = {
		signUp: async (input: { email: string; name: string; password: string }) =>
			(await request<Session>('/v1/auth/signup', input, false)).data,
		logIn: async (input: { email: string; password: string }) =>
			(await request<Session>('/v1/auth/login', input, false)).data,
		logOut: async () => {
			await request('/v1/auth/logout', {});
		},
	};

	return { call, callRaw, ops, auth };
}

export type Client = ReturnType<typeof createClient>;
