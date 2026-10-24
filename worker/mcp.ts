import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { z } from 'zod';

/** A companion is its own player. The owner's login never becomes a player token. */
export interface Companion { version: 1; ownerId: string; playerId: string; name: string }
export const MCP_SCOPE = 'plunge:profile';
export const MCP_ORIGIN = 'https://plunge.texas42.workers.dev';
export const MCP_RESOURCE = `${MCP_ORIGIN}/api/mcp`;

export async function companionRequest(request: Request, companion: Companion, ownerName: string): Promise<Response> {
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: 'texas-42', version: '0.1.0' }, {
      instructions: 'Plunge is a social Texas 42 table. You are a separate companion player connected by a human. '
        + 'This first connection exposes identity only. It cannot join a table, read hands, coach, or play yet. '
        + 'Call get_player to confirm who you are; never claim that a game action happened.',
    });
    server.registerTool('get_player', {
      title: 'Your Texas 42 player',
      description: 'Confirm your connected companion identity and available capabilities. Does not join or change a game.',
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: [MCP_SCOPE] }] },
    }, async () => {
      const result = {
        player: { id: companion.playerId, name: companion.name, kind: 'companion' },
        connectedBy: ownerName,
        capabilities: { identity: true, gameplay: false, coaching: false },
        manageConnection: `${MCP_ORIGIN}/oauth/connections`,
      };
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    });
    return server;
  }, { legacy: 'stateless', maxRequestBodySize: 32_000 });
  // There are no long-lived sessions or subscriptions in this first connection.
  return handler.fetch(request);
}
