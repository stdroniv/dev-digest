/**
 * FileSummaryService.compute / .get — DB-backed integration tests.
 *
 * Acceptance:
 *  - non-core path            ⇒ compute()/get() return `not_core`, no model call
 *  - null-patch core file     ⇒ compute()/get() return `no_diff`
 *  - no LLM provider          ⇒ compute() returns `skipped/no_model`, persists NOTHING
 *  - happy path core file     ⇒ compute() returns `ready` + persists a row; get() returns `ready` stale:false
 *  - after compute(), mutating the stored patch then get() ⇒ `ready` stale:true, SAME cached summary
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockLLMProvider, MockSecretsProvider } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import { FileSummaryService } from './service.js';
import { getFileSummary } from './repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const CORE_PATH = 'src/middleware/ratelimit.ts';
const NON_CORE_PATH = 'pnpm-lock.yaml';

let repoSeq = 0;
async function setupRepoAndPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  files: { path: string; patch: string | null }[],
) {
  const name = `file-summary-svc-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 900 + repoSeq,
      title: 'Add rate limiting',
      author: 'dev',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'abc123',
      status: 'needs_review',
    })
    .returning();
  for (const f of files) {
    await db.insert(t.prFiles).values({ prId: pr!.id, path: f.path, additions: 10, deletions: 0, patch: f.patch });
  }
  return { repo: repo!, pr: pr! };
}

d('FileSummaryService — DB-backed (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('non-core path ⇒ compute()/get() return not_core, no model call', async () => {
    const mockLLM = new MockLLMProvider('openai', {
      structuredBySchema: { FileSummary: { summary: 'Bumps a lockfile dependency.' } },
    });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openai: mockLLM } },
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, [
      { path: NON_CORE_PATH, patch: '@@ -1,1 +1,1 @@\n-old\n+new' },
    ]);
    const service = new FileSummaryService(app.container);

    const computeResult = await service.compute(workspaceId, pr.id, NON_CORE_PATH);
    expect(computeResult).toEqual({ status: 'not_core' });

    const getResult = await service.get(workspaceId, pr.id, NON_CORE_PATH);
    expect(getResult).toEqual({ status: 'not_core' });

    expect(mockLLM.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(0);

    await app.close();
  });

  it('null-patch core file ⇒ compute()/get() return no_diff', async () => {
    const mockLLM = new MockLLMProvider('openai', {
      structuredBySchema: { FileSummary: { summary: 'Adds a rate limiter middleware.' } },
    });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openai: mockLLM } },
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, [{ path: CORE_PATH, patch: null }]);
    const service = new FileSummaryService(app.container);

    const computeResult = await service.compute(workspaceId, pr.id, CORE_PATH);
    expect(computeResult).toEqual({ status: 'no_diff' });

    const getResult = await service.get(workspaceId, pr.id, CORE_PATH);
    expect(getResult).toEqual({ status: 'no_diff' });

    expect(mockLLM.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(0);

    await app.close();
  });

  it('no LLM provider configured ⇒ compute() returns skipped/no_model and persists nothing', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { secrets: new MockSecretsProvider({}) },
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, [
      { path: CORE_PATH, patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  retries: 3,' },
    ]);
    const service = new FileSummaryService(app.container);

    const result = await service.compute(workspaceId, pr.id, CORE_PATH);
    expect(result).toEqual({ status: 'skipped', reason: 'no_model' });

    const row = await getFileSummary(pg.handle.db, pr.id, CORE_PATH);
    expect(row).toBeUndefined();

    await app.close();
  });

  it('happy path: compute() returns ready + persists; get() then returns ready stale:false', async () => {
    const mockLLM = new MockLLMProvider('openai', {
      structuredBySchema: { FileSummary: { summary: 'Adds a rate limiter middleware.' } },
    });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openai: mockLLM } },
    });
    const patch = '@@ -10,3 +10,4 @@\n   port: 3000,\n+  retries: 3,';
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, [{ path: CORE_PATH, patch }]);
    const service = new FileSummaryService(app.container);

    const computeResult = await service.compute(workspaceId, pr.id, CORE_PATH);
    expect(computeResult).toEqual({
      status: 'ready',
      summary: 'Adds a rate limiter middleware.',
      stale: false,
    });

    // Exactly one model round-trip.
    expect(mockLLM.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);

    const row = await getFileSummary(pg.handle.db, pr.id, CORE_PATH);
    expect(row).toBeDefined();
    expect(row!.summary).toBe('Adds a rate limiter middleware.');

    const getResult = await service.get(workspaceId, pr.id, CORE_PATH);
    expect(getResult).toEqual({
      status: 'ready',
      summary: 'Adds a rate limiter middleware.',
      stale: false,
    });

    // get() must never call the LLM — still exactly one call from compute().
    expect(mockLLM.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);

    await app.close();
  });

  it('after compute(), mutating the stored patch then get() ⇒ ready stale:true, same cached summary', async () => {
    const mockLLM = new MockLLMProvider('openai', {
      structuredBySchema: { FileSummary: { summary: 'Adds a rate limiter middleware.' } },
    });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openai: mockLLM } },
    });
    const patch = '@@ -10,3 +10,4 @@\n   port: 3000,\n+  retries: 3,';
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, [{ path: CORE_PATH, patch }]);
    const service = new FileSummaryService(app.container);

    const computeResult = await service.compute(workspaceId, pr.id, CORE_PATH);
    expect(computeResult.status).toBe('ready');

    // Mutate the stored patch (a later PR sync changed the file's diff).
    await pg.handle.db
      .update(t.prFiles)
      .set({ patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  retries: 99,' })
      .where(and(eq(t.prFiles.prId, pr.id), eq(t.prFiles.path, CORE_PATH)));

    const getResult = await service.get(workspaceId, pr.id, CORE_PATH);
    expect(getResult.status).toBe('ready');
    if (getResult.status !== 'ready') throw new Error('expected ready');
    expect(getResult.stale).toBe(true);
    // Same cached summary — get() never recomputes/regenerates.
    expect(getResult.summary).toBe('Adds a rate limiter middleware.');

    // Still exactly one model round-trip total (from compute() only).
    expect(mockLLM.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);

    await app.close();
  });
});
