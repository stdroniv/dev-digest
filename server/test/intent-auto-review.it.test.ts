/**
 * Auto-on-first-review intent wiring — DB-backed integration tests.
 *
 * Acceptance (plan C5):
 *  - First review on a PR with no stored intent computes+persists a pr_intent row.
 *  - The run trace has non-null intent_tokens and intent_tokens_saved (fresh compute).
 *  - Second review on the same PR reuses the stored intent: trace has null
 *    intent_tokens / intent_tokens_saved (no re-classification happened).
 *  - A review run is non-fatal when intent computation throws (the try/catch in
 *    run-executor.ts absorbs the failure and the agent run completes as 'done').
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
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
import type { Intent, Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const INTENT_FIXTURE: Intent = {
  intent: 'Add rate limiting to public API endpoints to prevent abuse',
  in_scope: ['rate limiter middleware', 'public API routes'],
  out_of_scope: ['authentication', 'payment processing'],
};

// Minimal unified diff — one file at line 10-11, so grounding keeps the finding
// at line 11 and drops the hallucinated one at line 999.
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
  ],
};

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `intent-ar-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 800,
      title: 'Add rate limiting',
      author: 'dev',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting. Closes #471.',
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('Auto-on-first-review intent wiring — DB-backed (Testcontainers pg)', () => {
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

  it('first review on a PR with no stored intent computes and persists a pr_intent row', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient(),
        llm: {
          openai: new MockLLMProvider('openai', {
            structuredBySchema: { Intent: INTENT_FIXTURE, Review: REVIEW_FIXTURE },
          }),
        },
      },
    });

    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    // No intent row yet
    const before = await pg.handle.db
      .select()
      .from(t.prIntent)
      .where(eq(t.prIntent.prId, pr.id));
    expect(before).toHaveLength(0);

    // Create an openai-provider agent so the mock LLM covers both intent + review
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'IntentReviewAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'Review.' },
      })
    ).json();

    // Trigger the review (fire-and-forget)
    const runRes = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(runRes.statusCode).toBe(200);

    // Wait for the background run to reach a terminal state
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    // Intent row must now exist
    const after = await pg.handle.db
      .select()
      .from(t.prIntent)
      .where(eq(t.prIntent.prId, pr.id));
    expect(after).toHaveLength(1);
    expect(after[0]!.intent).toBe(INTENT_FIXTURE.intent);

    await app.close();
  });

  it('run trace has non-null intent_tokens and intent_tokens_saved when intent is freshly computed', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient(),
        llm: {
          openai: new MockLLMProvider('openai', {
            structuredBySchema: { Intent: INTENT_FIXTURE, Review: REVIEW_FIXTURE },
          }),
        },
      },
    });

    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'TraceIntentAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'Rev.' },
      })
    ).json();

    const runRes = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = runRes.json().runs[0].run_id as string;

    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();

    // Intent was freshly computed on this run → stats are populated
    expect(trace.stats.intent_tokens).not.toBeNull();
    expect(trace.stats.intent_tokens).toBeGreaterThan(0);
    expect(trace.stats.intent_tokens_saved).not.toBeNull();
    expect(trace.stats.intent_tokens_saved).toBeGreaterThanOrEqual(0);

    await app.close();
  });

  it('second review reuses stored intent: trace stats have null intent_tokens', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient(),
        llm: {
          openai: new MockLLMProvider('openai', {
            structuredBySchema: { Intent: INTENT_FIXTURE, Review: REVIEW_FIXTURE },
          }),
        },
      },
    });

    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'ReuseIntentAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'Rev.' },
      })
    ).json();

    // First review: computes intent
    await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    // Second review: intent row now exists → should be reused, not recomputed
    const run2Res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId2 = run2Res.json().runs[0].run_id as string;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });

    const trace2 = (await app.inject({ method: 'GET', url: `/runs/${runId2}/trace` })).json();

    // Intent was reused (not freshly computed) → null savings stats
    expect(trace2.stats.intent_tokens).toBeNull();
    expect(trace2.stats.intent_tokens_saved).toBeNull();

    await app.close();
  });

  it('review run completes as done when intent computation throws (non-fatal)', async () => {
    // LLM that succeeds for Review but has no Intent fixture → MockLLMProvider
    // falls back to `{}` which fails Intent schema validation → throws.
    // The run-executor catches this and continues the review without intent.
    const mockLLM = new MockLLMProvider('openai', {
      structuredBySchema: {
        // Intent: intentionally omitted → will default to {} → schema validation
        //         fails → throws → run-executor catches → continues without intent
        Review: REVIEW_FIXTURE,
      },
    });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient(),
        llm: { openai: mockLLM },
      },
    });

    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'NonFatalIntentAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'Rev.' },
      })
    ).json();

    await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });

    const runs = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    // The review run must complete as 'done', not 'failed' — intent failure is non-fatal
    const completedRun = runs.find((r) => r.status === 'done');
    expect(completedRun).toBeDefined();
    expect(completedRun!.status).toBe('done');

    // No intent row was persisted (compute failed before upsertIntent was called)
    const intentRows = await pg.handle.db
      .select()
      .from(t.prIntent)
      .where(eq(t.prIntent.prId, pr.id));
    expect(intentRows).toHaveLength(0);

    await app.close();
  });
});
