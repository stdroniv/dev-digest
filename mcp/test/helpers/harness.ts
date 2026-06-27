import { loadConfig } from '@devdigest/api/platform/config.js';
import type { ContainerOverrides } from '@devdigest/api/platform/container.js';
import type { Db } from '@devdigest/api/db/client.js';
import { bootstrap } from '../../src/bootstrap.js';
import type { ToolDeps } from '../../src/deps.js';
import type { Logger } from '../../src/logger.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** Silent logger so integration output stays clean (and off stdout). */
const quietLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

/** Build the tool dependency bundle against a testcontainer DB + mock adapters. */
export function buildDeps(db: Db, overrides: ContainerOverrides = {}): ToolDeps {
  const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
  const boot = bootstrap({ config, db, overrides, logger: quietLogger });
  return { container: boot.container, services: boot.services, logger: boot.logger };
}

/** Narrow a tool result's structuredContent to a typed record for assertions. */
export function structured<T = Record<string, unknown>>(result: CallToolResult): T {
  return result.structuredContent as T;
}
