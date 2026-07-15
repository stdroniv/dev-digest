/**
 * `seedCi` — DB-backed integration test (SPEC-05 T8).
 *
 * Acceptance:
 *  - GET /ci-runs returns the seeded runs with correct per-severity
 *    `findings_counts` + `duration_s` populated (AC-35).
 *  - GET /agents/:id/runs shows `source:'ci'` rows (AC-42).
 *  - GET /agents/:id/ci/installations shows both installations, including
 *    the `update_available:true` (drift) one (AC-39/40).
 *  - Idempotent: calling the seed twice leaves one copy of each row.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { CiInstallation, CiRun, RunSummary } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from '../../test/helpers/pg.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../platform/config.js';
import { seed } from './seed.js';
import { seedCi } from './seed-ci.js';
import * as t from './schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('seedCi (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let agentId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
    const [agent] = await pg.handle.db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Security Reviewer')));
    agentId = agent!.id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  it('GET /ci-runs returns the seeded runs with per-severity findings_counts + duration_s populated (AC-35)', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });

    const res = await app.inject({ method: 'GET', url: `/ci-runs?agent_id=${agentId}` });
    expect(res.statusCode).toBe(200);
    const runs = res.json() as CiRun[];

    const succeeded = runs.find((r) => r.actions_run_id === '1000479');
    expect(succeeded).toBeTruthy();
    expect(succeeded!.status).toBe('succeeded');
    expect(succeeded!.findings_counts).toEqual({ critical: 1, warning: 4, suggestion: 0 });
    expect(succeeded!.findings_count).toBe(5);
    expect(succeeded!.duration_s).toBe(9.1);
    expect(succeeded!.pr_number).toBe(479);
    expect(succeeded!.pr_title).toBe('Migrate sessions table to UUID primary key');
    expect(succeeded!.source).toBe('ci');

    const noFindings = runs.find((r) => r.actions_run_id === '1000477');
    expect(noFindings!.status).toBe('no_findings');
    expect(noFindings!.findings_counts).toEqual({ critical: 0, warning: 0, suggestion: 0 });
    expect(noFindings!.duration_s).toBe(5.2);

    const running = runs.find((r) => r.actions_run_id === '1000465');
    expect(running!.status).toBe('running');
    expect(running!.findings_counts).toBeNull();
    expect(running!.duration_s).toBeNull();

    const failed = runs.find((r) => r.actions_run_id === '1000471');
    expect(failed!.status).toBe('failed');
    expect(failed!.findings_counts).toBeNull();

    const skipped = runs.find((r) => r.actions_run_id === '1000460');
    expect(skipped!.status).toBe('skipped_no_credentials');
    expect(skipped!.findings_counts).toEqual({ critical: 0, warning: 0, suggestion: 0 });

    await app.close();
  });

  it('GET /agents/:id/runs shows source:"ci" rows (AC-42)', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });

    const res = await app.inject({ method: 'GET', url: `/agents/${agentId}/runs` });
    expect(res.statusCode).toBe(200);
    const runs = res.json() as RunSummary[];

    const ciRuns = runs.filter((r) => r.source === 'ci');
    // 5 of the 6 seeded ci_runs reach a terminal status — the `running` one
    // gets no matching agent_runs row yet (mirrors reconcile.ts).
    expect(ciRuns.length).toBe(5);
    expect(ciRuns.every((r) => r.agent_id === agentId)).toBe(true);

    await app.close();
  });

  it('GET /agents/:id/ci/installations shows both installations, including update_available:true (AC-39/40)', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });

    const res = await app.inject({ method: 'GET', url: `/agents/${agentId}/ci/installations` });
    expect(res.statusCode).toBe(200);
    const installations = res.json() as CiInstallation[];
    expect(installations.length).toBe(2);

    const current = installations.find((i) => i.repo === 'acme/payments-api');
    const drifted = installations.find((i) => i.repo === 'acme/billing-service');
    expect(current).toBeTruthy();
    expect(drifted).toBeTruthy();
    expect(current!.update_available).toBe(false);
    expect(drifted!.update_available).toBe(true);
    expect(current!.target_type).toBe('gha');

    await app.close();
  });

  it('is idempotent — re-running the seed leaves one copy of each row', async () => {
    await seedCi(pg.handle.db, workspaceId);
    await seedCi(pg.handle.db, workspaceId);

    const installations = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId));
    expect(installations).toHaveLength(2);

    const runs = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(eq(t.ciRuns.ciInstallationId, installations.find((i) => i.repo === 'acme/payments-api')!.id));
    expect(runs).toHaveLength(6);

    const agentRuns = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.agentId, agentId), eq(t.agentRuns.source, 'ci')));
    expect(agentRuns).toHaveLength(5);
  });
});
