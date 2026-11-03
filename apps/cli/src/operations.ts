import { type AnyOperation, operationList, requestSchema } from '@countx3/contracts';
import { z } from 'zod';
import { kebab } from './args.ts';

type JsonSchema = {
	type?: string | string[];
	properties?: Record<string, JsonSchema>;
	required?: string[];
	description?: string;
	enum?: unknown[];
	items?: JsonSchema;
	default?: unknown;
	anyOf?: JsonSchema[];
};

export const inputJsonSchema = (op: AnyOperation) =>
	z.toJSONSchema(requestSchema(op), { io: 'input' }) as JsonSchema;

/** `vouchers create` → `vouchers.create`; also accepts kebab-case groups (`fiscal-years list`). */
export function findOperation(group: string, action: string | undefined) {
	const camel = (s: string) => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
	return operationList.find((op) => op.name === `${camel(group)}.${camel(action ?? '')}`);
}

const typeOf = (schema: JsonSchema): string => {
	if (schema.anyOf) return schema.anyOf.map(typeOf).find((t) => t !== 'null') ?? 'string';
	return (Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type) ?? 'string';
};

/** Converts a CLI flag value to the JSON type the schema expects. */
export function coerce(name: string, value: string | boolean, schema: JsonSchema | undefined): unknown {
	const type = schema ? typeOf(schema) : 'string';
	if (typeof value === 'boolean') {
		if (type === 'boolean') return value;
		throw new UsageError(`--${kebab(name)} needs a value`);
	}
	switch (type) {
		case 'number':
		case 'integer': {
			const n = Number(value);
			if (Number.isNaN(n)) throw new UsageError(`--${kebab(name)} must be a number`);
			return n;
		}
		case 'boolean':
			return value === 'true' || value === '1' || value === 'yes';
		case 'array':
			if (value.trim().startsWith('[')) return parseJson(name, value);
			return value.split(',').map((v) => v.trim());
		case 'object':
			return parseJson(name, value);
		default:
			return value;
	}
}

function parseJson(name: string, value: string) {
	try {
		return JSON.parse(value);
	} catch {
		throw new UsageError(`--${kebab(name)} must be valid JSON`);
	}
}

export class UsageError extends Error {}

export function operationHelp(op: AnyOperation) {
	const schema = inputJsonSchema(op);
	const required = new Set(schema.required ?? []);
	const flags = Object.entries(schema.properties ?? {}).map(([name, prop]) => {
		const flag = name === 'companyId' ? '--company <id>' : `--${kebab(name)} <${typeOf(prop)}>`;
		const extra = [
			required.has(name) && name !== 'companyId' ? 'required' : null,
			prop.enum ? `one of ${prop.enum.join('|')}` : null,
		]
			.filter(Boolean)
			.join(', ');
		return `  ${flag.padEnd(34)} ${prop.description ?? ''}${extra ? ` (${extra})` : ''}`;
	});
	const [group, action] = op.name.split('.');
	const lines = [
		`countx3 ${kebab(group!)} ${kebab(action!)} — ${op.summary}`,
		'',
		op.description,
		'',
		`Scope: ${op.scope} · ${op.kind}${op.humanOnly ? ' · human only' : ''}`,
		'',
		'Flags:',
		...flags,
		'  --input <file|->'.padEnd(36) +
			' Read the whole input as JSON from a file or stdin; flags override it.',
	];
	if ('contentBase64' in (schema.properties ?? {}))
		lines.push('  --file <path>'.padEnd(36) + ' Read contentBase64 from a file.');
	lines.push('  --out <path>'.padEnd(36) + ' Write contentBase64 of the result to a file.');
	for (const example of op.examples ?? []) {
		lines.push(
			'',
			`Example: ${example.title}`,
			`  countx3 ${kebab(group!)} ${kebab(action!)} --input - <<'EOF'`,
			JSON.stringify(example.input, null, 2),
			'EOF',
		);
	}
	return lines.join('\n');
}
