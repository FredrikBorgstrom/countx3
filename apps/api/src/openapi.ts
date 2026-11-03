import { ErrorBody, operationList, requestSchema } from '@countx3/contracts';
import { z } from 'zod';

const json = (schema: z.ZodType, io: 'input' | 'output') =>
	z.toJSONSchema(schema, { io, unrepresentable: 'any' });

/** OpenAPI 3.1 document generated from the operation registry. */
export function openApiDocument(serverUrl: string) {
	const paths: Record<string, unknown> = {};
	for (const op of operationList) {
		paths[`/v1/ops/${op.name}`] = {
			post: {
				operationId: op.name,
				summary: op.summary,
				description: op.description,
				tags: [op.name.split('.')[0]],
				'x-scope': op.scope,
				'x-kind': op.kind,
				'x-human-only': op.humanOnly ?? false,
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: json(requestSchema(op), 'input'),
							examples: examplesOf(op.examples),
						},
					},
				},
				responses: {
					200: {
						description: 'Success',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									required: ['ok', 'data'],
									properties: {
										ok: { const: true },
										data: json(op.output, 'output'),
										dryRun: { type: 'boolean', description: 'Present when nothing was saved.' },
										replayed: {
											type: 'boolean',
											description: 'Present when an idempotency key matched an earlier request.',
										},
									},
								},
							},
						},
					},
					default: {
						description: 'Error',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: { ok: { const: false }, error: json(ErrorBody, 'output') },
								},
							},
						},
					},
				},
			},
		};
	}
	return {
		openapi: '3.1.0',
		info: {
			title: 'countx3 API',
			version: '0.1.0',
			description:
				'Every operation is POST /v1/ops/{name} with a JSON body. The same operations are available as MCP tools at /mcp and as `countx3` CLI commands.',
		},
		servers: [{ url: serverUrl }],
		security: [{ bearer: [] }],
		components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
		paths,
	};
}

const examplesOf = (examples: { title: string; input: Record<string, unknown> }[] | undefined) =>
	examples &&
	Object.fromEntries(examples.map((e, i) => [`example${i + 1}`, { summary: e.title, value: e.input }]));
