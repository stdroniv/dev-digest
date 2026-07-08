import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import { EvalRepository } from '../src/modules/eval/repository.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval-repository.it] Docker not available — skipping.');
}

/**
 * T4 — eval repository (cases + runs + derived aggregate). The key
 * regression this suite guards: `eval_runs.case_id` has `onDelete: 'cascade'`
 * (schema/eval.ts), so a naive `DELETE FROM eval_cases` would silently erase
 * every historical run row that ever scored it. `deleteCase` must instead
 * soft-exclude (AC-24) — proven below by deleting a case that already has a
 * run and asserting the run row survives while the case leaves the live set.
 */
d('EvalRepository (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let agentId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
    const [agent] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(eq(t.agents.workspaceId, workspaceId))
      .limit(1);
    agentId = agent!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('insertCase → listCasesForOwner round-trips', async () => {
    const repo = new EvalRepository(pg.handle.db);
    const created = await repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name: 'Repository fixture case',
      inputDiff: 'diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1,0 +1,1 @@\n+hello',
      inputMeta: { source: 'test' },
      expectedOutput: [{ file: 'x.ts', start_line: 1, end_line: 1 }],
      notes: null,
    });
    expect(created.id).toBeDefined();

    const list = await repo.listCasesForOwner(workspaceId, 'agent', agentId);
    expect(list.some((c) => c.id === created.id)).toBe(true);
  });

  it('deleteCase soft-excludes from the live set but RETAINS historical eval_runs rows (AC-24)', async () => {
    const repo = new EvalRepository(pg.handle.db);
    const created = await repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name: 'Delete-retains-history fixture',
      inputDiff: 'diff --git a/y.ts b/y.ts\n--- a/y.ts\n+++ b/y.ts\n@@ -1,0 +1,1 @@\n+hi',
      inputMeta: null,
      expectedOutput: [],
      notes: null,
    });

    const run = await repo.insertRun({
      caseId: created.id,
      actualOutput: [],
      pass: true,
      recall: 1,
      precision: 1,
      citationAccuracy: 1,
      durationMs: 5,
      costUsd: 0.001,
      runGroupId: randomUUID(),
      agentVersion: 1,
    });

    const deleted = await repo.deleteCase(workspaceId, created.id);
    expect(deleted).toBe(true);

    // No longer in the live set.
    const live = await repo.listCasesForOwner(workspaceId, 'agent', agentId);
    expect(live.some((c) => c.id === created.id)).toBe(false);
    expect(await repo.getCase(workspaceId, created.id)).toBeUndefined();

    // But its historical run row is fully intact...
    const [runRow] = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.id, run.id));
    expect(runRow).toBeDefined();
    expect(runRow!.caseId).toBe(created.id);

    // ...and the case row itself still exists (soft-excluded, not hard-deleted
    // — a real DELETE would have cascaded the run row away with it).
    const [caseRow] = await pg.handle.db
      .select()
      .from(t.evalCases)
      .where(eq(t.evalCases.id, created.id));
    expect(caseRow).toBeDefined();

    // Resolvable via the "including deleted" lookup (used for run-history joins).
    const resolved = await repo.getCaseIncludingDeleted(workspaceId, created.id);
    expect(resolved?.name).toBe('Delete-retains-history fixture');
  });

  it('deleteCase on an unknown id returns false', async () => {
    const repo = new EvalRepository(pg.handle.db);
    const ok = await repo.deleteCase(workspaceId, '00000000-0000-0000-0000-000000000000');
    expect(ok).toBe(false);
  });

  it('latestRunsForOwner returns only the LATEST row per live case (AC-25)', async () => {
    const repo = new EvalRepository(pg.handle.db);
    const created = await repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name: 'Latest-run fixture',
      inputDiff: '',
      inputMeta: null,
      expectedOutput: [],
      notes: null,
    });

    await repo.insertRun({
      caseId: created.id,
      actualOutput: [],
      pass: false,
      recall: 0,
      precision: 0,
      citationAccuracy: 0,
      durationMs: 1,
      costUsd: null,
      runGroupId: randomUUID(),
      agentVersion: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await repo.insertRun({
      caseId: created.id,
      actualOutput: [],
      pass: true,
      recall: 1,
      precision: 1,
      citationAccuracy: 1,
      durationMs: 1,
      costUsd: null,
      runGroupId: randomUUID(),
      agentVersion: 2,
    });

    const latest = await repo.latestRunsForOwner(workspaceId, 'agent', agentId);
    const found = latest.find((r) => r.caseId === created.id);
    expect(found?.id).toBe(second.id);
    expect(found?.pass).toBe(true);
  });
});
