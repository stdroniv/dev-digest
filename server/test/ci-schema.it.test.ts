/**
 * `ci_installations` / `ci_runs` migration 0020 (Testcontainers pg) — SPEC-05 T4.
 * Asserts (a) the new columns exist and round-trip through Drizzle after
 * `runMigrations` applies 0020, and (b) the `(ci_installation_id,
 * actions_run_id)` unique index rejects a duplicate insert, so repeated
 * reconcile can't double-insert the same Actions run (AC-30/34).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[ci-schema.it] Docker not available — skipping.');
}

d('ci_installations / ci_runs — migration 0020 columns + idempotent-reconcile key', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let agentId: string;

  beforeAll(async () => {
    pg = await startPg();
    const { db } = pg.handle;
    const [ws] = await db.insert(t.workspaces).values({ name: 'ci-schema-test' }).returning();
    workspaceId = ws!.id;
    const [agent] = await db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'CI Schema Agent',
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'review',
      })
      .returning();
    agentId = agent!.id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  it('information_schema reports the new ci_installations + ci_runs columns', async () => {
    const cols = await pg.handle.sql<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND ((table_name = 'ci_installations'
              AND column_name IN ('workflow_version', 'installed_config_hash', 'updated_at'))
          OR (table_name = 'ci_runs' AND column_name = 'actions_run_id'))`;
    const names = cols.map((c) => `${c.table_name}.${c.column_name}`).sort();
    expect(names).toEqual(
      [
        'ci_installations.installed_config_hash',
        'ci_installations.updated_at',
        'ci_installations.workflow_version',
        'ci_runs.actions_run_id',
      ].sort(),
    );
  });

  it('ci_runs_installation_actions_run_uq unique index exists', async () => {
    const rows = await pg.handle.sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'ci_runs' AND indexname = 'ci_runs_installation_actions_run_uq'`;
    expect(rows).toHaveLength(1);
  });

  it('inserting ci_installations round-trips workflowVersion/installedConfigHash/updatedAt', async () => {
    const { db } = pg.handle;
    const [row] = await db
      .insert(t.ciInstallations)
      .values({
        agentId,
        repo: 'acme/widgets',
        targetType: 'gha',
      })
      .returning();
    expect(row!.workflowVersion).toBe(1); // default
    expect(row!.installedConfigHash).toBeNull();
    expect(row!.updatedAt).toBeInstanceOf(Date);

    const [bumped] = await db
      .insert(t.ciInstallations)
      .values({
        agentId,
        repo: 'acme/other',
        targetType: 'gha',
        workflowVersion: 2,
        installedConfigHash: 'sha256:abc',
      })
      .returning();
    expect(bumped!.workflowVersion).toBe(2);
    expect(bumped!.installedConfigHash).toBe('sha256:abc');
  });

  it('rejects a duplicate (ci_installation_id, actions_run_id) insert on ci_runs', async () => {
    const { db } = pg.handle;
    const [installation] = await db
      .insert(t.ciInstallations)
      .values({ agentId, repo: 'acme/idempotent', targetType: 'gha' })
      .returning();
    const installationId = installation!.id;

    await db.insert(t.ciRuns).values({
      ciInstallationId: installationId,
      prNumber: 1,
      status: 'succeeded',
      actionsRunId: 'run-123',
    });

    await expect(
      db.insert(t.ciRuns).values({
        ciInstallationId: installationId,
        prNumber: 1,
        status: 'succeeded',
        actionsRunId: 'run-123',
      }),
    ).rejects.toThrow(/duplicate key|unique/i);

    // A different actionsRunId on the SAME installation is still allowed.
    await expect(
      db.insert(t.ciRuns).values({
        ciInstallationId: installationId,
        prNumber: 2,
        status: 'succeeded',
        actionsRunId: 'run-456',
      }),
    ).resolves.not.toThrow();
  });
});
