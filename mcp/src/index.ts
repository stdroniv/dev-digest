import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { bootstrap } from './bootstrap.js';
import { stderrLogger } from './logger.js';
import type { ToolDeps } from './deps.js';
import type { ToolDefinition } from './tools/types.js';
import { makeListAgentsTool } from './tools/list-agents.js';
import { makeReviewPrTool } from './tools/review-pr.js';
import { makeGetFindingsTool } from './tools/get-findings.js';
import { makeGetConventionsTool } from './tools/get-conventions.js';
import { makeGetBlastRadiusTool } from './tools/get-blast-radius.js';

/**
 * DevDigest MCP server (stdio, 5 tools).
 *
 * Thin presentation/adapter over the server's existing application services
 * (booted in-process via `bootstrap`). No business logic lives here.
 *
 * stdout is the JSON-RPC channel: ONLY the `StdioServerTransport` writes there;
 * every diagnostic goes to stderr via `stderrLogger`. NO `console.log` anywhere.
 */

/** Build the 5 tool definitions for the given dependency bundle. */
export function buildTools(deps: ToolDeps): ToolDefinition[] {
  return [
    makeListAgentsTool(deps),
    makeReviewPrTool(deps),
    makeGetFindingsTool(deps),
    makeGetConventionsTool(deps),
    makeGetBlastRadiusTool(deps),
  ];
}

/** Construct an `McpServer` with the 5 tools registered. */
export function createMcpServer(deps: ToolDeps): McpServer {
  const server = new McpServer({ name: 'devdigest-mcp', version: '0.0.0' });
  for (const tool of buildTools(deps)) {
    server.registerTool(tool.name, tool.config, tool.handler);
  }
  return server;
}

async function main(): Promise<void> {
  const boot = bootstrap({ logger: stderrLogger });
  const deps: ToolDeps = {
    container: boot.container,
    services: boot.services,
    logger: boot.logger,
  };
  const server = createMcpServer(deps);
  const transport = new StdioServerTransport();

  // Guarded double-close (mirrors server/src/server.ts): close the MCP server,
  // then the postgres pool.
  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    try {
      await server.close();
    } catch (err) {
      stderrLogger.error({ err: (err as Error).message }, 'error closing MCP server');
    }
    try {
      await boot.shutdown();
    } catch (err) {
      stderrLogger.error({ err: (err as Error).message }, 'error closing db handle');
    }
  };

  // stdin EOF (client disconnected) → shut down.
  transport.onclose = () => {
    void shutdown().then(() => process.exit(0));
  };
  process.on('SIGINT', () => void shutdown().then(() => process.exit(0)));
  process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)));

  await server.connect(transport);
  stderrLogger.info('devdigest MCP server ready on stdio');
}

// Run only when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    stderrLogger.error({ err: (err as Error).message }, 'fatal: MCP server failed to start');
    process.exit(1);
  });
}
