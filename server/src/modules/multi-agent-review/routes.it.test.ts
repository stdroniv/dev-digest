/**
 * multi-agent-review — DB-backed integration tests (Testcontainers pg).
 *
 * Covers the plan's T5 acceptance:
 *  - AC-35/36/37: launch persists one `agent_runs` row per selected agent
 *    (each tagged `multi_agent_run_id`), and `GET /multi-agent-runs/:id`
 *    reassembles it with columns + findings + SUMMED totals — repeatable on a
 *    later re-read (AC-37), from persisted data only.
 *  - AC-33: one agent fails, the other succeeds — the failed column is
 *    isolated (status='failed', no findings), survivors keep presenting, and
 *    the failed agent is excluded from the reviewed set (never a "did not
 *    flag" take in `conflicts`).
 *  - AC-34: every agent fails — the whole run has an empty reviewed set (no
 *    conflicts), while every column + its trace stay independently readable.
 *  - AC-11/12/13: `GET /multi-agent/estimates` — mean over recent completed
 *    runs, "no history" (null) for an agent with zero, sum math is on the
 *    caller (pure `estimate.ts` already unit-tests the sum itself).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { waitForPrRuns } from '../../../test/helpers/runs.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** Same diff shape as reviews.it.test.ts — touches src/config.ts line 11, so a
 *  finding cited there survives citation grounding. */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** Agent A (openai): flags a CRITICAL at src/config.ts:11. */
const REVIEW_A: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 20,
  findings: [
    {
      id: 'a-f1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      confidence: 0.95,
      kind: 'finding',
    },
  ],
};

/** Agent B (anthropic): flags the SAME location as agent A but at a DIFFERENT
 *  severity — a divergent-severity conflict (AC-29) once both are grouped. */
const REVIEW_B: Review = {
  verdict: 'comment',
  summary: 'Looks fine overall; one nit.',
  score: 70,
  findings: [
    {
      id: 'b-f1',
      severity: 'WARNING',
      category: 'style',
      title: 'Consider an env var here',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'Prefer configuration over a literal.',
      confidence: 0.6,
      kind: 'finding',
    },
  ],
};

/** A schema-invalid fixture — MockLLMProvider throws when the fixture fails
 *  `Review.safeParse`, which is the deterministic way to force a real agent
 *  run failure (isolated to that one provider) without new mock plumbing. */
const BROKEN_FIXTURE = { not_a_review: true };

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `multi-agent-review-${repoSeq++}`;
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
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
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

d('multi-agent-review — DB-backed (Testcontainers pg)', () => {
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

  // T8 (registering this module in `modules/index.ts`) is out of scope here —
  // register the plugin directly onto the built app instead of through the
  // static registry, exercising the SAME `routes.ts` default export the real
  // registration will use. Must happen before the first `.inject()` (which
  // implicitly calls `.ready()` and locks further registration).
  async function appWith(openaiFixture: unknown, anthropicFixture: unknown) {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: {
          openai: new MockLLMProvider('openai', { structured: openaiFixture }),
          anthropic: new MockLLMProvider('anthropic', { structured: anthropicFixture }),
        },
      },
    });
    return app;
  }

  it('launches a run, persists columns+findings, and totals=SUM on both first read and revisit (AC-35/36/37)', async () => {
    const app = await appWith(REVIEW_A, REVIEW_B);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agentA = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Security', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sec' },
      })
    ).json();
    const agentB = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Style', provider: 'anthropic', model: 'claude-x', system_prompt: 'style' },
      })
    ).json();

    const launch = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: [agentA.id, agentB.id] },
    });
    expect(launch.statusCode).toBe(200);
    const launchBody = launch.json();
    expect(launchBody.pr_id).toBe(pr.id);
    const runId = launchBody.run_id;
    expect(runId).toBeTruthy();

    // AC-35: exactly one agent_runs row per selected agent, each tagged with
    // this multi_agent_run_id.
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });
    const taggedRuns = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.multiAgentRunId, runId));
    expect(taggedRuns).toHaveLength(2);

    // AC-36/37: GET reassembles columns + findings + summed totals; re-reading
    // returns the same persisted shape (nothing is recomputed differently).
    const read = async () => (await app.inject({ method: 'GET', url: `/multi-agent-runs/${runId}` })).json();
    const first = await read();
    expect(first.pr_id).toBe(pr.id);
    expect(first.agent_count).toBe(2);
    expect(first.columns).toHaveLength(2);

    const byAgent = new Map(first.columns.map((c: { agent_id: string }) => [c.agent_id, c]));
    const colA = byAgent.get(agentA.id) as { status: string; findings: unknown[]; duration_ms: number; cost_usd: number };
    const colB = byAgent.get(agentB.id) as { status: string; findings: unknown[]; duration_ms: number; cost_usd: number };
    expect(colA.status).toBe('done');
    expect(colB.status).toBe('done');
    expect(colA.findings).toHaveLength(1);
    expect(colB.findings).toHaveLength(1);

    // Totals are the SUM over columns (Rec A — never Math.max).
    expect(first.total_duration_ms).toBe(colA.duration_ms + colB.duration_ms);
    expect(first.total_cost_usd).toBeCloseTo(colA.cost_usd + colB.cost_usd, 9);

    // Both agents flagged src/config.ts:11 at DIFFERENT severities — a
    // divergent-severity conflict (AC-29), with a take for each reviewed agent.
    expect(first.conflicts).toHaveLength(1);
    const conflict = first.conflicts[0];
    expect(conflict.file).toBe('src/config.ts');
    expect(conflict.line).toBe(11);
    expect(conflict.takes).toHaveLength(2);
    const verdicts = new Set(conflict.takes.map((t: { verdict: string }) => t.verdict));
    expect(verdicts).toEqual(new Set(['CRITICAL', 'WARNING']));

    // Revisit (AC-37): renders identically from persisted data.
    const second = await read();
    expect(second).toEqual(first);

    // AC-29 wire field: the divergent-severity row is flagged a genuine conflict
    // on the wire (the client's "Show only conflicts" filter reads this).
    expect(conflict.is_conflict).toBe(true);

    // AC-38: the individual agent runs still surface in the PR's normal run
    // history (GET /pulls/:id/runs is untouched by the grouping feature).
    const historyRuns = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/runs` })).json();
    expect(Array.isArray(historyRuns)).toBe(true);
    const historyStr = JSON.stringify(historyRuns);
    for (const r of taggedRuns) expect(historyStr).toContain(r.id);

    // AC-39: no grouped multi-run entry is injected into the PR reviews list —
    // it holds exactly the two per-agent reviews and nothing extra.
    const reviewsList = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })).json();
    expect(Array.isArray(reviewsList)).toBe(true);
    expect(reviewsList).toHaveLength(2);

    await app.close();
  });

  it('one agent fails, the other succeeds: failed column isolated, survivor still presents, reviewed set excludes the failure (AC-33)', async () => {
    const app = await appWith(BROKEN_FIXTURE, REVIEW_B);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agentA = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'BrokenAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sec' },
      })
    ).json();
    const agentB = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'GoodAgent', provider: 'anthropic', model: 'claude-x', system_prompt: 'style' },
      })
    ).json();

    const launch = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agent_ids: [agentA.id, agentB.id] },
      })
    ).json();
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });

    const run = (
      await app.inject({ method: 'GET', url: `/multi-agent-runs/${launch.run_id}` })
    ).json();
    expect(run.columns).toHaveLength(2);
    const byAgent = new Map(run.columns.map((c: { agent_id: string }) => [c.agent_id, c]));
    const failedCol = byAgent.get(agentA.id) as { status: string; findings: unknown[] };
    const okCol = byAgent.get(agentB.id) as { status: string; findings: unknown[] };
    expect(failedCol.status).toBe('failed');
    expect(failedCol.findings).toHaveLength(0);
    // Survivor still presents its own results — the whole run is not failed.
    expect(okCol.status).toBe('done');
    expect(okCol.findings).toHaveLength(1);

    // The failed agent is excluded from the reviewed set — never a take in
    // `conflicts` (not even a "did not flag" — see the plan's Reviewed-agent set).
    for (const conflict of run.conflicts as { takes: { agent_id: string }[] }[]) {
      expect(conflict.takes.some((take) => take.agent_id === agentA.id)).toBe(false);
    }

    await app.close();
  });

  it('every agent fails: the run has an empty reviewed set (no conflicts), each column still independently readable (AC-34)', async () => {
    const app = await appWith(BROKEN_FIXTURE, BROKEN_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agentA = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'BrokenA', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sec' },
      })
    ).json();
    const agentB = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'BrokenB', provider: 'anthropic', model: 'claude-x', system_prompt: 'style' },
      })
    ).json();

    const launch = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agent_ids: [agentA.id, agentB.id] },
      })
    ).json();
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });

    const run = (
      await app.inject({ method: 'GET', url: `/multi-agent-runs/${launch.run_id}` })
    ).json();
    expect(run.columns).toHaveLength(2);
    expect(run.columns.every((c: { status: string }) => c.status === 'failed')).toBe(true);
    expect(run.columns.every((c: { findings: unknown[] }) => c.findings.length === 0)).toBe(true);
    // Empty reviewed set ⇒ no disagreement grouping at all.
    expect(run.conflicts).toEqual([]);
    // No cost data on the failure path ⇒ null total (never coerced to 0).
    expect(run.total_cost_usd).toBeNull();
    // Duration is still tracked per failed run (Date.now() diff even on throw).
    const sumDuration = run.columns.reduce((s: number, c: { duration_ms: number | null }) => s + (c.duration_ms ?? 0), 0);
    expect(run.total_duration_ms).toBe(sumDuration);

    // Each column's trace is still independently readable (AC-34).
    for (const c of run.columns as { run_id: string }[]) {
      const trace = await app.inject({ method: 'GET', url: `/runs/${c.run_id}/trace` });
      expect(trace.statusCode).toBe(200);
    }

    await app.close();
  });

  it('a second launch on the same PR creates an independent run — both remain retrievable', async () => {
    const app = await appWith(REVIEW_A, REVIEW_B);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agentA = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'A', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    const first = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agent_ids: [agentA.id] },
      })
    ).json();
    const second = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/multi-agent-run`,
        payload: { agent_ids: [agentA.id] },
      })
    ).json();
    expect(first.run_id).not.toBe(second.run_id);

    await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });
    const readFirst = await app.inject({ method: 'GET', url: `/multi-agent-runs/${first.run_id}` });
    const readSecond = await app.inject({ method: 'GET', url: `/multi-agent-runs/${second.run_id}` });
    expect(readFirst.statusCode).toBe(200);
    expect(readSecond.statusCode).toBe(200);
    expect(readFirst.json().columns).toHaveLength(1);
    expect(readSecond.json().columns).toHaveLength(1);

    await app.close();
  });

  it('404s when the selected agent_ids match no enabled agent in the workspace', async () => {
    const app = await appWith(REVIEW_A, REVIEW_B);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-run`,
      payload: { agent_ids: ['00000000-0000-0000-0000-000000000000'] },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('GET /multi-agent-runs/:id 404s for an unknown id', async () => {
    const app = await appWith(REVIEW_A, REVIEW_B);
    const res = await app.inject({
      method: 'GET',
      url: '/multi-agent-runs/00000000-0000-0000-0000-000000000000',
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('GET /multi-agent/estimates: mean over completed runs, "no history" (null) for a brand-new agent (AC-11/12)', async () => {
    const app = await appWith(REVIEW_A, REVIEW_B);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const seasoned = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Seasoned', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    const fresh = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'BrandNew', provider: 'anthropic', model: 'claude-x', system_prompt: 's', enabled: true },
      })
    ).json();

    // Give `seasoned` one completed run via the normal single-agent path (not
    // the multi-agent one — estimates read across ALL of an agent's `done` runs).
    await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: seasoned.id },
    });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const estimates = (
      await app.inject({ method: 'GET', url: '/multi-agent/estimates' })
    ).json().estimates as { agent_id: string; runs: number; avg_latency_ms: number | null; avg_cost_usd: number | null }[];

    const seasonedRow = estimates.find((e) => e.agent_id === seasoned.id)!;
    expect(seasonedRow.runs).toBeGreaterThanOrEqual(1);
    expect(seasonedRow.avg_latency_ms).not.toBeNull();
    expect(seasonedRow.avg_cost_usd).not.toBeNull();

    const freshRow = estimates.find((e) => e.agent_id === fresh.id)!;
    expect(freshRow.runs).toBe(0);
    expect(freshRow.avg_latency_ms).toBeNull();
    expect(freshRow.avg_cost_usd).toBeNull();

    await app.close();
  });
});
