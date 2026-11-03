import { AGENT_INSTRUCTIONS, operationList, requestSchema, toolName } from '@countx3/contracts';
import { Countx3Error, createClient } from '@countx3/sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Config } from './config.ts';

/**
 * `countx3 mcp`: a local stdio MCP server for agents that prefer spawning a process (e.g. Codex).
 * Tools are generated from the same registry as the remote /mcp endpoint and call the REST API.
 */
export async function runMcpServer(config: Config & { url: string }) {
	const client = createClient({ baseUrl: config.url, token: config.token });
	const instructions = config.company
		? `${AGENT_INSTRUCTIONS}\n- The default company is ${config.company}; it is used when companyId is omitted.`
		: AGENT_INSTRUCTIONS;
	const server = new McpServer({ name: 'countx3', version: '0.1.0' }, { instructions });

	for (const op of operationList) {
		if (op.humanOnly) continue;
		const schema =
			op.companyScoped && config.company ? requestSchema(op).partial({ companyId: true }) : requestSchema(op);
		server.registerTool(
			toolName(op.name),
			{
				title: op.summary,
				description: op.description,
				inputSchema: schema,
				annotations: {
					title: op.summary,
					readOnlyHint: op.kind === 'query',
					destructiveHint: false,
					openWorldHint: false,
				},
			},
			async (args: Record<string, unknown>) => {
				const input =
					op.companyScoped && !args.companyId && config.company
						? { ...args, companyId: config.company }
						: args;
				try {
					const result = await client.callRaw(op.name, input);
					return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
				} catch (error) {
					const body =
						error instanceof Countx3Error ? error.toJSON() : { code: 'CLIENT_ERROR', message: String(error) };
					return {
						isError: true,
						content: [{ type: 'text' as const, text: JSON.stringify({ error: body }) }],
					};
				}
			},
		);
	}
	await server.connect(new StdioServerTransport());
}
