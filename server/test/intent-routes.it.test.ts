/**
 * Intent routes — DB-backed integration tests.
 *
 * Acceptance (plan C3):
 *  - POST /pulls/:id/intent computes, persists, and returns an Intent
 *  - POST then GET returns the same Intent (round-trip)
 *  - GET on a PR with no computed intent returns null (200)
 *  - POST on a non-existent PR returns 404
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import {
  MockLLMProvider,
  MockEmbedder,
  MockGitHubClient,
  MockGitClient,
} from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Intent } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const INTENT_FIXTURE: Intent = {
  intent: 'Introduce token-bucket rate limiting on all public endpoints',
  in_scope: ['rate limiter middleware', 'public API routes', 'config updates'],
  out_of_scope: ['authentication', 'database changes'],
};

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `intent-rt-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 700,
      title: 'Add rate limiting',
      author: 'dev',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'def456',
      additions: 10,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting. Closes #471.',
    })
    .returning();
  return { repo: repo!, pr: pr! };
}

d('Intent routes — DB-backed (Testcontainers pg)', () => {
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

  function makeApp() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient(),
        llm: { openai: new MockLLMProvider('openai', { structuredBySchema: { Intent: INTENT_FIXTURE } }) },
      },
    });
  }

  it('POST /pulls/:id/intent computes, persists, and returns an Intent', async () => {
    const app = await makeApp();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent` });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Intent;
    expect(body.intent).toBe(INTENT_FIXTURE.intent);
    expect(body.in_scope).toEqual(INTENT_FIXTURE.in_scope);
    expect(body.out_of_scope).toEqual(INTENT_FIXTURE.out_of_scope);

    await app.close();
  });

  it('GET /pulls/:id/intent returns the same Intent after POST (round-trip)', async () => {
    const app = await makeApp();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    // First compute it
    const post = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent` });
    expect(post.statusCode).toBe(200);

    // Then read it back
    const get = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(get.statusCode).toBe(200);
    const stored = get.json() as Intent;
    expect(stored.intent).toBe(INTENT_FIXTURE.intent);
    expect(stored.in_scope).toEqual(INTENT_FIXTURE.in_scope);
    expect(stored.out_of_scope).toEqual(INTENT_FIXTURE.out_of_scope);

    await app.close();
  });

  it('GET /pulls/:id/intent returns null for a PR with no computed intent', async () => {
    const app = await makeApp();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    // No POST has been made — intent has never been computed
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();

    await app.close();
  });

  it('POST /pulls/:id/intent returns 404 for a non-existent PR id', async () => {
    const app = await makeApp();
    const fakePrId = '00000000-0000-0000-0000-000000000000';

    const res = await app.inject({ method: 'POST', url: `/pulls/${fakePrId}/intent` });

    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('POST /pulls/:id/intent is idempotent: recompute replaces the stored Intent', async () => {
    const secondFixture: Intent = {
      intent: 'Updated intent after recompute',
      in_scope: ['updated scope'],
      out_of_scope: ['still out of scope'],
    };
    const llmWithTwo = new MockLLMProvider('openai', {
      structuredSequence: [INTENT_FIXTURE, secondFixture],
    });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient(),
        llm: { openai: llmWithTwo },
      },
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    // First compute
    const first = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent` });
    expect(first.statusCode).toBe(200);
    expect((first.json() as Intent).intent).toBe(INTENT_FIXTURE.intent);

    // Recompute (manual Recalculate button path)
    const second = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent` });
    expect(second.statusCode).toBe(200);
    expect((second.json() as Intent).intent).toBe(secondFixture.intent);

    // GET reflects the latest value
    const get = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect((get.json() as Intent).intent).toBe(secondFixture.intent);

    await app.close();
  });
});
