import type { Container } from '@devdigest/api/platform/container.js';
import type { Services } from './bootstrap.js';
import type { Logger } from './logger.js';

/**
 * The dependency bundle every tool handler receives — the DI container (for the
 * read-only resolvers), the application services (all business logic), and the
 * stderr-only logger.
 */
export interface ToolDeps {
  container: Container;
  services: Services;
  logger: Logger;
}
