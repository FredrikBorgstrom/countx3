import { DomainError } from '@countx3/core';

/** Maps any thrown error to an HTTP status and the public error body. Internal details are never leaked. */
export function errorBody(error: unknown): {
	status: number;
	body: { code: string; message: string; hint?: string; issues?: unknown[] };
} {
	if (error instanceof DomainError) {
		const { code, message, hint, issues } = error.toJSON();
		return {
			status: error.status,
			body: { code, message, hint, issues: issues.length ? issues : undefined },
		};
	}
	console.error(error);
	return { status: 500, body: { code: 'INTERNAL', message: 'Something went wrong on our side.' } };
}
