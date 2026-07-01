import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';

/**
 * One tool, ready to register. `index.ts` calls
 * `server.registerTool(def.name, def.config, def.handler)`. The handler receives
 * the SDK-validated args (already parsed against `inputSchema`); each tool
 * re-parses with its specific object schema to apply defaults and get a precise
 * type internally. The handler ALWAYS returns a result (never throws past
 * `runTool`) so a domain failure becomes an `isError` result, not a crash.
 */
export interface ToolDefinition {
  name: string;
  config: {
    title: string;
    description: string;
    inputSchema: z.ZodRawShape;
    outputSchema: z.ZodRawShape;
    annotations: ToolAnnotations;
  };
  handler: (args: unknown) => Promise<CallToolResult>;
}
