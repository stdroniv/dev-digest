/**
 * Findings counters (Testcontainers pg) — the per-severity tally surfaced on the
 * PR list (`GET /repos/:id/pulls` → PrMeta.findings_counts) and on each
 * Agent-runs row (`GET /pulls/:id/runs` → RunSummary.findings_counts). Both are
 * computed on read from reviews/findings (no denorm), so this proves the wiring
 * end-to-end against real Postgres:
 *  - PR-list counts AGGREGATE across the latest review PER reviewer agent (an
 *    older review for the same agent is excluded);
 *  - DISMISSED findings are still counted (kept consistent with findings_count);
 *  - per-run counts reflect that run's own review.
 *
 * No LLM/GitHub — data is inserted directly, so the numbers are deterministic.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { PrMeta, RunSummary } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

type Sev = 'CRITICAL' | 'WARNING' | 'SUGGESTION';

d('findings counters (PR list + agent runs)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let prId: string;
  // run ids we assert the per-run breakdown for
  const runs: Record<'aOld' | 'aNew' | 'b', string> = { aOld: '', aNew: '', b: '' };

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const db = pg.handle.db;
    const [ws] = await db.select().from(t.workspaces);
    workspaceId = ws!.id;

    // Fresh repo + PR (non-zero diff stats so the list never tries a GH backfill).
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'findings-demo', fullName: 'acme/findings-demo' })
      .returning();
    repoId = repo!.id;
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 1,
        title: 'Findings counters demo',
        author: 'dev',
        branch: 'feat/x',
        base: 'main',
        headSha: 'sha1',
        additions: 5,
        deletions: 1,
        filesCount: 1,
        status: 'open',
        body: '',
      })
      .returning();
    prId = pr!.id;

    // Two reviewer agents.
    const [agentA] = await db
      .insert(t.agents)
      .values({ workspaceId, name: 'Security', provider: 'openai', model: 'gpt-4.1', systemPrompt: 'sec' })
      .returning();
    const [agentB] = await db
      .insert(t.agents)
      .values({ workspaceId, name: 'Performance', provider: 'openai', model: 'gpt-4.1', systemPrompt: 'perf' })
      .returning();

    // Helper: one run + its review + findings. createdAt drives "latest per agent".
    async function addRun(opts: {
      agentId: string;
      createdAt: Date;
      findings: { severity: Sev; dismissed?: boolean }[];
    }): Promise<string> {
      const [run] = await db
        .insert(t.agentRuns)
        .values({
          workspaceId,
          agentId: opts.agentId,
          prId,
          status: 'done',
          source: 'local',
          findingsCount: opts.findings.length,
        })
        .returning({ id: t.agentRuns.id });
      const runId = run!.id;
      const [review] = await db
        .insert(t.reviews)
        .values({
          workspaceId,
          prId,
          agentId: opts.agentId,
          runId,
          kind: 'review',
          verdict: 'comment',
          summary: '',
          score: 70,
          model: 'gpt-4.1',
          createdAt: opts.createdAt,
        })
        .returning({ id: t.reviews.id });
      const reviewId = review!.id;
      let i = 0;
      for (const f of opts.findings) {
        await db.insert(t.findings).values({
          reviewId,
          file: 'src/x.ts',
          startLine: ++i,
          endLine: i,
          severity: f.severity,
          category: 'bug',
          title: `f${i}`,
          rationale: 'r',
          confidence: 0.9,
          dismissedAt: f.dismissed ? new Date() : null,
        });
      }
      return runId;
    }

    // Agent A — an OLDER review (1 critical, must be ignored by the list) and a
    // NEWER review (2 critical + 1 warning, the one the list should count).
    runs.aOld = await addRun({
      agentId: agentA!.id,
      createdAt: new Date('2026-06-10T00:00:00Z'),
      findings: [{ severity: 'CRITICAL' }],
    });
    runs.aNew = await addRun({
      agentId: agentA!.id,
      createdAt: new Date('2026-06-12T00:00:00Z'),
      findings: [{ severity: 'CRITICAL' }, { severity: 'CRITICAL' }, { severity: 'WARNING' }],
    });
    // Agent B — 1 warning + 1 suggestion (the suggestion DISMISSED, still counted).
    runs.b = await addRun({
      agentId: agentB!.id,
      createdAt: new Date('2026-06-11T00:00:00Z'),
      findings: [{ severity: 'WARNING' }, { severity: 'SUGGESTION', dismissed: true }],
    });
  });

  afterAll(async () => {
    await pg?.stop();
  });

  it('PR list aggregates the latest review PER agent (older A review excluded, dismissed counted)', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });
    expect(res.statusCode).toBe(200);
    const list = res.json() as PrMeta[];
    const row = list.find((p) => p.id === prId);
    expect(row).toBeDefined();
    // A(new): 2 critical + 1 warning; B: 1 warning + 1 suggestion (dismissed).
    // A(old)'s extra critical is excluded (not the latest review for agent A).
    expect(row!.findings_counts).toEqual({ critical: 2, warning: 2, suggestion: 1 });
    await app.close();
  });

  it('the SEEDED PR #482 run exposes its per-severity counts (seed links review→run)', async () => {
    // Regression guard: the demo seed creates the sample review standalone, then
    // links it to the timeline run. Without that link, `reviews.run_id` is null
    // and the per-run join finds nothing → findings_counts null → "—" in the UI.
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const [pr482] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.number, 482));
    expect(pr482).toBeDefined();
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr482!.id}/runs` });
    const seededRun = (res.json() as RunSummary[]).find((r) => r.findings_count === 2);
    expect(seededRun).toBeDefined();
    // Seed findings: 1 CRITICAL (security) + 1 WARNING (perf).
    expect(seededRun!.findings_counts).toEqual({ critical: 1, warning: 1, suggestion: 0 });
    await app.close();
  });

  it('agent-runs reports each run’s own per-severity breakdown', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/runs` });
    expect(res.statusCode).toBe(200);
    const byId = new Map((res.json() as RunSummary[]).map((r) => [r.run_id, r]));
    expect(byId.get(runs.aOld)!.findings_counts).toEqual({ critical: 1, warning: 0, suggestion: 0 });
    expect(byId.get(runs.aNew)!.findings_counts).toEqual({ critical: 2, warning: 1, suggestion: 0 });
    expect(byId.get(runs.b)!.findings_counts).toEqual({ critical: 0, warning: 1, suggestion: 1 });
    await app.close();
  });

  it('derives findings_count + blockers from findings when the run’s denorm columns are stale', async () => {
    // Regression for the Timeline showing "0 finding(s)" + a green "approved" badge: the
    // agent_runs.findings_count / blockers columns can be 0/null while the review actually
    // produced findings. listRunsForPull must read the fresh per-severity join, not the
    // stale denorm columns.
    const db = pg.handle.db;
    const [pr2] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 2,
        title: 'Stale denorm counts',
        author: 'dev',
        branch: 'feat/stale',
        base: 'main',
        headSha: 'sha2',
        additions: 3,
        deletions: 0,
        filesCount: 1,
        status: 'open',
        body: '',
      })
      .returning();
    const [agent] = await db
      .insert(t.agents)
      .values({ workspaceId, name: 'Stale', provider: 'openai', model: 'gpt-4.1', systemPrompt: 's' })
      .returning();
    // Denorm columns intentionally stale: findingsCount 0, blockers null.
    const [run] = await db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        agentId: agent!.id,
        prId: pr2!.id,
        status: 'done',
        source: 'local',
        findingsCount: 0,
        blockers: null,
      })
      .returning({ id: t.agentRuns.id });
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr2!.id,
        agentId: agent!.id,
        runId: run!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary: '',
        score: 40,
        model: 'gpt-4.1',
      })
      .returning({ id: t.reviews.id });
    // 1 CRITICAL (a blocker) + 1 WARNING — but the denorm columns above say "0".
    await db.insert(t.findings).values([
      { reviewId: review!.id, file: 'src/a.ts', startLine: 1, endLine: 1, severity: 'CRITICAL', category: 'security', title: 'c', rationale: 'r', confidence: 0.9 },
      { reviewId: review!.id, file: 'src/a.ts', startLine: 2, endLine: 2, severity: 'WARNING', category: 'perf', title: 'w', rationale: 'r', confidence: 0.8 },
    ]);

    const app = await buildApp({ config: config(), db });
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr2!.id}/runs` });
    expect(res.statusCode).toBe(200);
    const row = (res.json() as RunSummary[]).find((r) => r.run_id === run!.id);
    expect(row).toBeDefined();
    expect(row!.findings_count).toBe(2); // not the stale 0
    expect(row!.blockers).toBe(1); // critical count → "rejected" badge, not green "approved"
    expect(row!.findings_counts).toEqual({ critical: 1, warning: 1, suggestion: 0 });
    await app.close();
  });
});
