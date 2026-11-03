/**
 * Errors carry a stable machine-readable code and a remediation hint, so that
 * coding agents can recover without parsing prose.
 */
export interface Issue {
	code: string;
	message: string;
	/** What the caller can do to fix it. */
	hint?: string;
	/** JSON-path-like location in the input, e.g. `lines.2.account`. */
	path?: string;
}

export class DomainError extends Error {
	readonly code: string;
	readonly hint: string | undefined;
	readonly issues: Issue[];
	readonly status: number;

	constructor(
		code: string,
		message: string,
		opts: { hint?: string; issues?: Issue[]; status?: number } = {},
	) {
		super(message);
		this.name = 'DomainError';
		this.code = code;
		this.hint = opts.hint;
		this.issues = opts.issues ?? [];
		this.status = opts.status ?? 422;
	}

	toJSON() {
		return { code: this.code, message: this.message, hint: this.hint, issues: this.issues };
	}
}

export const notFound = (what: string, id: string) =>
	new DomainError('NOT_FOUND', `${what} ${id} was not found`, { status: 404 });
