import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Logger } from './logger.js';

/**
 * Domain / tool-execution error (PR/agent/repo not found, mutually-exclusive
 * args, etc.). These are NOT JSON-RPC protocol errors: the model self-corrects
 * from an `isError:true` tool RESULT, not from a thrown protocol error. So every
 * recoverable, actionable failure is thrown as an `McpToolError` and mapped to an
 * `isError` result by `runTool` — never surfaced as a protocol throw.
 *
 * (Protocol errors — unknown tool, schema-invalid args — are raised by the SDK
 * from the registered input schema; we let those flow.)
 */
export class McpToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpToolError';
  }
}

/** Build a tool-execution-error result with an actionable text message. */
export function toolErrorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

/**
 * Build a success result carrying `structuredContent` (validated by the SDK
 * against the tool's `outputSchema`).
 *
 * The spec's backward-compat rule is to ALSO serialize the JSON into a `content`
 * text block — but that DOUBLES tokens. This is an internal stdio server whose
 * client we control, so the duplicate text block is gated behind
 * `DEVDIGEST_MCP_EMIT_TEXT=true` (default: structured-only, empty content).
 */
export function okResult(structuredContent: Record<string, unknown>): CallToolResult {
  const emitText = process.env.DEVDIGEST_MCP_EMIT_TEXT === 'true';
  return {
    structuredContent,
    content: emitText ? [{ type: 'text', text: JSON.stringify(structuredContent) }] : [],
  };
}

/** Fixed, internals-free message returned to the client for unexpected bugs. */
const UNEXPECTED_ERROR_MESSAGE = 'An unexpected internal error occurred while running the tool.';

/**
 * Run a tool handler, mapping thrown errors to `isError` results so the handler
 * never crashes the transport and the model always gets an actionable message.
 * `McpToolError` carries a curated, client-safe message and is surfaced verbatim.
 * Anything else is an unexpected bug: the raw exception may carry internal detail
 * (paths, SQL, secrets), so we NEVER echo it to the client — we log the detail to
 * stderr via `logger` and return a fixed generic message instead.
 */
export async function runTool(
  fn: () => Promise<CallToolResult>,
  logger?: Logger,
): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof McpToolError) return toolErrorResult(err.message);
    const message = err instanceof Error ? err.message : String(err);
    logger?.error({ err: message }, 'Unexpected error while running an MCP tool');
    return toolErrorResult(UNEXPECTED_ERROR_MESSAGE);
  }
}
