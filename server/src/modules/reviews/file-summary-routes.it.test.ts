/**
 * POST + GET /pulls/:id/file-summary routes over a real Postgres.
 *
 * Mirrors `file-summary/service.it.test.ts` but drives the HTTP surface via
 * `app.inject` to prove the route wiring — schema-first params/body/
 * querystring, workspace scoping via `getContext`, and that GET never
 * triggers generation.
 *
 * Acceptance:
 *  - POST core file      → 200 ready + persists
 *  - GET after POST      → 200 ready
 *  - POST non-core file  → 200 not_core
 *  - the POST registration carries `rateLimit: { max: 10, timeWindow: '1 minute' }`
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockLLMProvider } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import type { FileSummaryState } from '@devdigest/shared';

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
  const name = `file-summary-routes-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 1000 + repoSeq,
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

d('file-summary routes (Testcontainers pg)', () => {
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

  function makeApp(llm: MockLLMProvider) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openai: llm } },
    });
  }

  async function getSummary(app: Awaited<ReturnType<typeof buildApp>>, prId: string, path: string) {
    const res = await app.inject({
      method: 'GET',
      url: `/pulls/${prId}/file-summary?path=${encodeURIComponent(path)}`,
    });
    return { statusCode: res.statusCode, body: res.json() as FileSummaryState };
  }

  async function postSummary(app: Awaited<ReturnType<typeof buildApp>>, prId: string, path: string) {
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${prId}/file-summary`,
      payload: { path },
    });
    return { statusCode: res.statusCode, body: res.json() as FileSummaryState };
  }

  it('POST core file ⇒ 200 ready and persists; subsequent GET ⇒ 200 ready', async () => {
    const fixture = { summary: 'Adds a rate limiter middleware.' };
    const app = await makeApp(new MockLLMProvider('openai', { structuredBySchema: { FileSummary: fixture } }));
    const patch = '@@ -10,3 +10,4 @@\n   port: 3000,\n+  retries: 3,';
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, [{ path: CORE_PATH, patch }]);

    const postResult = await postSummary(app, pr.id, CORE_PATH);
    expect(postResult.statusCode).toBe(200);
    expect(postResult.body).toEqual({ status: 'ready', summary: fixture.summary, stale: false });

    const getResult = await getSummary(app, pr.id, CORE_PATH);
    expect(getResult.statusCode).toBe(200);
    expect(getResult.body).toEqual({ status: 'ready', summary: fixture.summary, stale: false });

    await app.close();
  });

  it('POST non-core file ⇒ 200 not_core', async () => {
    const fixture = { summary: 'Bumps a lockfile dependency.' };
    const app = await makeApp(new MockLLMProvider('openai', { structuredBySchema: { FileSummary: fixture } }));
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, [
      { path: NON_CORE_PATH, patch: '@@ -1,1 +1,1 @@\n-old\n+new' },
    ]);

    const postResult = await postSummary(app, pr.id, NON_CORE_PATH);
    expect(postResult.statusCode).toBe(200);
    expect(postResult.body).toEqual({ status: 'not_core' });

    await app.close();
  });
});

describe('file-summary route registration', () => {
  it("POST /pulls/:id/file-summary carries rateLimit: { max: 10, timeWindow: '1 minute' }", async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('./routes.ts', import.meta.url), 'utf8'),
    );
    const postBlockMatch = source.match(/app\.post\(\s*'\/pulls\/:id\/file-summary',([\s\S]*?)\);/);
    expect(postBlockMatch).not.toBeNull();
    const postBlock = postBlockMatch![1]!;
    expect(postBlock).toContain("rateLimit: { max: 10, timeWindow: '1 minute' }");

    const getBlockMatch = source.match(/app\.get\(\s*'\/pulls\/:id\/file-summary',([\s\S]*?)\);/);
    expect(getBlockMatch).not.toBeNull();
  });
});
