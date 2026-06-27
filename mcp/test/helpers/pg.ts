import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb, type DbHandle } from '@devdigest/api/db/client.js';
import { runMigrations } from '@devdigest/api/db/migrate.js';

/**
 * Testcontainers helper (mirrors server/test/helpers/pg.ts): spin a Postgres +
 * pgvector container, run the SAME migrations, return a Drizzle client. The MCP
 * package reads the same DB the API does, so the harness is identical.
 *
 * Integration tests gate on `dockerAvailable()` and self-skip when Docker is
 * unreachable (CI/sandbox).
 */
export interface PgFixture {
  container: StartedPostgreSqlContainer;
  handle: DbHandle;
  url: string;
  stop: () => Promise<void>;
}

let dockerCache: boolean | undefined;

export async function dockerAvailable(): Promise<boolean> {
  if (dockerCache !== undefined) return dockerCache;
  try {
    const { execSync } = await import('node:child_process');
    execSync('docker info', { stdio: 'ignore', timeout: 5000 });
    dockerCache = true;
  } catch {
    dockerCache = false;
  }
  return dockerCache;
}

export async function startPg(): Promise<PgFixture> {
  const container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
    .withDatabase('devdigest')
    .withUsername('devdigest')
    .withPassword('devdigest')
    .start();
  const url = container.getConnectionUri();
  await runMigrations(url);
  const handle = createDb(url, { max: 5 });
  return {
    container,
    handle,
    url,
    stop: async () => {
      await handle.close();
      await container.stop();
    },
  };
}
