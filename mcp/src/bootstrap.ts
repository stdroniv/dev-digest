import { loadConfig, type AppConfig } from '@devdigest/api/platform/config.js';
import { createDb, type Db } from '@devdigest/api/db/client.js';
import { Container, type ContainerOverrides } from '@devdigest/api/platform/container.js';
import { AgentsService } from '@devdigest/api/modules/agents/service.js';
import { ReviewService } from '@devdigest/api/modules/reviews/service.js';
import { ConventionsService } from '@devdigest/api/modules/conventions/service.js';
import { stderrLogger, type Logger } from './logger.js';

/**
 * In-process bootstrap — mirrors `server/src/app.ts:buildApp` MINUS Fastify.
 *
 * Builds the same DI `Container` the API uses and instantiates the existing
 * application services so the MCP tools can call them directly (no HTTP, no
 * port). The services own ALL business logic; the MCP layer is a thin adapter.
 *
 * Deliberately does NOT call `reapStaleRuns()` (unlike `buildApp`):
 * `reapStaleRunningRuns` marks EVERY `status='running'` row failed regardless of
 * owner, so it would clobber an in-flight review owned by a concurrently-running
 * API process. The MCP server's own blocking runs complete in-process.
 */
export interface Services {
  agents: AgentsService;
  reviews: ReviewService;
  conventions: ConventionsService;
}

export interface Bootstrap {
  container: Container;
  services: Services;
  logger: Logger;
  /** Close the postgres pool (only the handle we created, if any). */
  shutdown: () => Promise<void>;
}

export interface BootstrapOptions {
  /** Override config (tests). Defaults to `loadConfig()` from env. */
  config?: AppConfig;
  /** Reuse an existing Db (tests). When omitted we create + own the handle. */
  db?: Db;
  /** Inject mock adapters (tests). */
  overrides?: ContainerOverrides;
  /** stderr-only logger; defaults to the shared one. */
  logger?: Logger;
}

export function bootstrap(opts: BootstrapOptions = {}): Bootstrap {
  const config = opts.config ?? loadConfig();
  // Only create (and later close) a handle when the caller did not supply a db.
  const handle = opts.db ? null : createDb(config.databaseUrl);
  const db = opts.db ?? handle!.db;

  const container = new Container(config, db, opts.overrides);
  const services: Services = {
    agents: new AgentsService(container),
    reviews: new ReviewService(container),
    conventions: new ConventionsService(container),
  };

  return {
    container,
    services,
    logger: opts.logger ?? stderrLogger,
    shutdown: async () => {
      if (handle) await handle.close();
    },
  };
}
