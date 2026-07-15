/**
 * POST /findings/:id/learn (memory module, T6/AC-25) over a real Postgres.
 *
 * The module is wired into `modules/index.ts` (T8), so this test builds the
 * real app via `buildApp` (same DI container / error handler / db as every
 * other route) — the memory routes are already registered by the static
 * registry; no manual `app.register()` is needed.
 *
 * Acceptance:
 *  - POST against a seeded finding inserts a `memory` row: scope='repo',
 *    kind='learning', content derived from the finding's title + rationale,
 *    confidence = finding.confidence, embedding null, sources referencing the
 *    producing agent + PR number (AC-25).
 *  - a missing finding id → 404.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import * as t from '../../db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('POST /findings/:id/learn (memory module)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let findingId: string;
  let prNumber: number;
  let repoId: string;
  const agentName = 'Learn-Test Reviewer';

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const db = pg.handle.db;
    const [ws] = await db.select().from(t.workspaces);
    workspaceId = ws!.id;

    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'memory-learn-demo', fullName: 'acme/memory-learn-demo' })
      .returning();
    repoId = repo!.id;

    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 9911,
        title: 'Learn demo PR',
        author: 'dev',
        branch: 'feat/learn',
        base: 'main',
        headSha: 'sha-learn',
        additions: 4,
        deletions: 0,
        filesCount: 1,
        status: 'open',
        body: '',
      })
      .returning();
    prNumber = pr!.number;

    const [agent] = await db
      .insert(t.agents)
      .values({ workspaceId, name: agentName, provider: 'openai', model: 'gpt-4.1', systemPrompt: 'sec' })
      .returning();

    const [run] = await db
      .insert(t.agentRuns)
      .values({ workspaceId, agentId: agent!.id, prId: pr!.id, status: 'done', source: 'local' })
      .returning({ id: t.agentRuns.id });

    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        agentId: agent!.id,
        runId: run!.id,
        kind: 'review',
        verdict: 'comment',
        summary: '',
        score: 80,
        model: 'gpt-4.1',
      })
      .returning({ id: t.reviews.id });

    const [finding] = await db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'src/x.ts',
        startLine: 10,
        endLine: 12,
        severity: 'WARNING',
        category: 'bug',
        title: 'Missing null check',
        rationale: 'x could be undefined here, causing a crash.',
        confidence: 0.82,
      })
      .returning({ id: t.findings.id });
    findingId = finding!.id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  it('inserts a memory row attributed to the finding + producing agent + PR', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });

    const res = await app.inject({ method: 'POST', url: `/findings/${findingId}/learn` });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { memory_id: string };
    expect(body.memory_id).toBeTruthy();

    const [row] = await pg.handle.db.select().from(t.memory).where(eq(t.memory.id, body.memory_id));
    expect(row).toBeDefined();
    expect(row!.workspaceId).toBe(workspaceId);
    expect(row!.repoId).toBe(repoId);
    expect(row!.scope).toBe('repo');
    expect(row!.kind).toBe('learning');
    expect(row!.content).toContain('Missing null check');
    expect(row!.content).toContain('x could be undefined here, causing a crash.');
    expect(row!.confidence).toBeCloseTo(0.82);
    expect(row!.embedding).toBeNull();
    expect(row!.sources).toEqual([
      { pr: prNumber, context: `learned from a warning finding by ${agentName}` },
    ]);

    await app.close();
  });

  it('404s for a missing finding id', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });

    const res = await app.inject({ method: 'POST', url: `/findings/${randomUUID()}/learn` });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
