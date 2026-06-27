/**
 * Brief-populate integration test — DB-backed.
 *
 * Acceptance criteria (plan step 8):
 * (a) After a review run, getBrief(db, prId) returns a defined PrBrief whose
 *     risks.risks matches RISKS_FIXTURE.
 * (b) GET /pulls/:id/risks returns { risks: [...] } (not null).
 * (c) The persisted pr_brief.json passes PrBrief.safeParse (proves blast/history
 *     placeholders are valid).
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
  MockSecretsProvider,
} from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { getBrief } from '../src/modules/reviews/repository/pull.repo.js';
import { PrBrief } from '@devdigest/shared';
import type { Intent, Review, Risks } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const INTENT_FIXTURE: Intent = {
  intent: 'Add rate limiting to public API endpoints to prevent abuse',
  in_scope: ['rate limiter middleware', 'public API routes'],
  out_of_scope: ['authentication', 'payment processing'],
};

const RISKS_FIXTURE: Risks = {
  risks: [
    {
      kind: 'regression',
      title: 'Rate limiter may break existing integration tests',
      explanation:
        'Adding a rate limiter to public routes could cause existing integration tests to fail if they exceed the limit.',
      severity: 'medium',
      file_refs: ['src/config.ts'],
    },
  ],
};

// Minimal unified diff — one file, one hunk, so grounding keeps the finding.
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
  const name = `brief-pop-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 900,
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

d('Brief population — DB-backed (Testcontainers pg)', () => {
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

  it('persists a pr_brief row after a review run, with risks matching the fixture', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient(),
        llm: {
          openai: new MockLLMProvider('openai', {
            structuredBySchema: {
              Intent: INTENT_FIXTURE,
              Review: REVIEW_FIXTURE,
              Risks: RISKS_FIXTURE,
            },
          }),
        },
      },
    });

    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    // No brief row yet
    const briefBefore = await getBrief(pg.handle.db, pr.id);
    expect(briefBefore).toBeUndefined();

    // Create an openai-provider agent
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: 'BriefPopulateAgent',
          provider: 'openai',
          model: 'gpt-4.1',
          system_prompt: 'Review.',
        },
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

    // (a) getBrief returns a defined PrBrief whose risks match the fixture
    const brief = await getBrief(pg.handle.db, pr.id);
    expect(brief).toBeDefined();
    expect(brief!.risks.risks).toHaveLength(1);
    expect(brief!.risks.risks[0]!.kind).toBe(RISKS_FIXTURE.risks[0]!.kind);
    expect(brief!.risks.risks[0]!.severity).toBe(RISKS_FIXTURE.risks[0]!.severity);

    // (b) GET /pulls/:id/risks returns { risks: [...] } (not null)
    const risksRes = await app.inject({
      method: 'GET',
      url: `/pulls/${pr.id}/risks`,
    });
    expect(risksRes.statusCode).toBe(200);
    const risksBody = risksRes.json() as { risks: unknown[] } | null;
    expect(risksBody).not.toBeNull();
    expect((risksBody as { risks: unknown[] }).risks).toHaveLength(1);

    // (c) The persisted json passes PrBrief.safeParse (proves blast/history placeholders are valid)
    const [row] = await pg.handle.db
      .select()
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, pr.id));
    expect(row).toBeDefined();
    const parsed = PrBrief.safeParse(row!.json);
    expect(parsed.success).toBe(true);

    await app.close();
  });

  it('review run completes as done when brief generation fails (non-fatal)', async () => {
    // LLM that succeeds for Intent + Review but has no Risks fixture → MockLLMProvider
    // falls back to {} → Risks schema validation fails → throws → run-executor catches
    // → continues without brief (run still completes as done).
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient(),
        llm: {
          openai: new MockLLMProvider('openai', {
            structuredBySchema: {
              Intent: INTENT_FIXTURE,
              Review: REVIEW_FIXTURE,
              // Risks: intentionally omitted → {} → schema fails → non-fatal
            },
          }),
        },
      },
    });

    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: 'BriefNonFatalAgent',
          provider: 'openai',
          model: 'gpt-4.1',
          system_prompt: 'Review.',
        },
      })
    ).json();

    await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });

    const runs = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    // The run must complete as done, not failed — brief failure is non-fatal
    const completedRun = runs.find((r) => r.status === 'done');
    expect(completedRun).toBeDefined();
    expect(completedRun!.status).toBe('done');

    // No brief row was persisted (brief compute failed)
    const brief = await getBrief(pg.handle.db, pr.id);
    expect(brief).toBeUndefined();

    await app.close();
  });

  it('populates risks when only OpenRouter is configured and risk_brief is unset', async () => {
    // Reproduces the bug: no OPENAI_API_KEY → container.llm('openai') throws
    // ConfigError → old code's resolveFeatureModel falls back to openai/gpt-4.1
    // → brief fails. Fix: BriefService uses briefFallback (openrouter agent) instead.
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider({ OPENROUTER_API_KEY: 'or-test' }),
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient(),
        llm: {
          openrouter: new MockLLMProvider('openrouter', {
            structuredBySchema: {
              Review: REVIEW_FIXTURE,
              Risks: RISKS_FIXTURE,
            },
          }),
          // No openai mock — container.llm('openai') would throw ConfigError
          // (OPENAI_API_KEY not in MockSecretsProvider) reproducing the original bug.
        },
      },
    });

    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    // Create an openrouter-provider agent (no OpenAI agent)
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: 'OpenRouterOnlyAgent',
          provider: 'openrouter',
          model: 'deepseek/deepseek-v4-flash',
          system_prompt: 'Review.',
        },
      })
    ).json();

    // Trigger the review
    const runRes = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(runRes.statusCode).toBe(200);

    // Wait for the background run to complete
    const runs = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    // The run must complete as done (review succeeded with openrouter)
    const completedRun = runs.find((r) => r.status === 'done');
    expect(completedRun).toBeDefined();
    expect(completedRun!.status).toBe('done');

    // (a) getBrief returns a defined PrBrief whose risks match the fixture
    // This FAILS before the fix (brief is undefined because llm('openai') throws)
    const brief = await getBrief(pg.handle.db, pr.id);
    expect(brief).toBeDefined();
    expect(brief!.risks.risks).toHaveLength(1);

    // (b) GET /pulls/:id/risks returns { risks: [...] } (not null)
    const risksRes = await app.inject({
      method: 'GET',
      url: `/pulls/${pr.id}/risks`,
    });
    expect(risksRes.statusCode).toBe(200);
    const risksBody = risksRes.json() as { risks: unknown[] } | null;
    expect(risksBody).not.toBeNull();
    expect((risksBody as { risks: unknown[] }).risks).toHaveLength(1);

    await app.close();
  });
});
