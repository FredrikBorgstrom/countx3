import { AGENT_INSTRUCTIONS, operationList, requestSchema, toolName } from '@countx3/contracts';
import type { Db } from '@countx3/db';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { execute } from './dispatch.ts';
import { errorBody } from './errors.ts';
import type { Principal } from './principal.ts';

/** An MCP server exposing every operation (except human-only ones) as a tool for this principal. */
export function createMcpServer(db: Db, principal: Principal) {
	const server = new McpServer({ name: 'countx3', version: '0.1.0' }, { instructions: AGENT_INSTRUCTIONS });
	for (const op of operationList) {
		if (op.humanOnly && principal.kind === 'token') continue;
		server.registerTool(
			toolName(op.name),
			{
				title: op.summary,
				description: op.description,
				inputSchema: requestSchema(op),
				annotations: {
					title: op.summary,
					readOnlyHint: op.kind === 'query',
					// Nothing booked can be destroyed: corrections append, drafts are the only deletable records.
					destructiveHint: false,
					idempotentHint: op.kind === 'query',
					openWorldHint: false,
				},
			},
			async (args: unknown) => {
				try {
					const result = await execute(db, op.name, args, principal);
					return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
				} catch (error) {
					return {
						isError: true,
						content: [{ type: 'text' as const, text: JSON.stringify({ error: errorBody(error).body }) }],
					};
				}
			},
		);
	}
	return server;
}

/** Stateless Streamable HTTP: a fresh server and transport per request. */
export async function handleMcpRequest(db: Db, principal: Principal, request: Request) {
	const server = createMcpServer(db, principal);
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});
	await server.connect(transport);
	return transport.handleRequest(request);
}
