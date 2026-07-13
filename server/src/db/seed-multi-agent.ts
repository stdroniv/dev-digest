import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import * as t from './schema.js';

/**
 * T9 — demo multi-agent run for PR #482 (the seeded PR). Gives the Configure
 * page real ("non no-history") per-agent estimates (`GET /multi-agent/
 * estimates`) and makes `/multi-agent/runs/<id>` (both Columns + Tabs) +
 * the "Where agents disagree" section demoable on a fresh DB.
 *
 * Three of the five seeded agents (Security, Performance, API Contract
 * Reviewer) each get one completed (`status='done'`) `agent_runs` row
 * threaded to a single `multi_agent_runs` row via `multiAgentRunId`, each
 * with its own `reviews` row + a few findings. The findings are placed so
 * `multi-agent-review`'s grouping (T5, file+overlapping-line-range
 * clustering) produces a non-empty `conflicts` array with:
 *  - `src/config.ts:12`      — Security flags CRITICAL, the other two don't
 *                              (flagged-vs-not-flagged conflict).
 *  - `src/api/users.ts`      — Security (WARNING) and Performance (CRITICAL)
 *                              both flag OVERLAPPING ranges (45-52 / 45-50)
 *                              → an overlap-across-two-agents pair AND a
 *                              divergent-severity pair in one cluster.
 *  - `src/api/public/webhooks.ts` (10-15 / 12-18) — Security and Performance
 *                              both flag overlapping ranges with the SAME
 *                              severity (WARNING) → a second, distinct
 *                              overlap-across-two-agents pair (agreement,
 *                              still a conflict since API Contract didn't
 *                              flag it).
 *  - `src/api/public/webhooks.ts:30-31` — only API Contract Reviewer flags.
 */
export interface MultiAgentSeedAgents {
  securityId: string;
  performanceId: string;
  apiContractId: string;
}

interface AgentRunSeed {
  agentId: string;
  agentName: string;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  score: number;
  verdict: string;
  summary: string;
  findings: Array<{
    file: string;
    startLine: number;
    endLine: number;
    severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION';
    category: string;
    title: string;
    rationale: string;
    confidence: number;
  }>;
}

export async function seedMultiAgentDemo(
  db: Db,
  workspaceId: string,
  prId: string,
  agents: MultiAgentSeedAgents,
): Promise<void> {
  // Idempotency guard: skip entirely if this PR already has a multi-agent run
  // (re-running `pnpm db:seed` must not duplicate).
  const [existing] = await db
    .select({ id: t.multiAgentRuns.id })
    .from(t.multiAgentRuns)
    .where(eq(t.multiAgentRuns.prId, prId));
  if (existing) return;

  // Backdated so the pre-existing PR #482 demo review (seeded moments ago, at
  // effectively "now") stays the newest `agentRuns` row and keeps its
  // accordion open-by-default in the regular Agent runs tab — these three
  // runs are additional history, not a replacement.
  const ranAt = new Date(Date.now() - 2 * 60 * 60 * 1000);

  const [maRun] = await db.insert(t.multiAgentRuns).values({ workspaceId, prId, ranAt }).returning();
  const multiAgentRunId = maRun!.id;

  const runSeeds: AgentRunSeed[] = [
    {
      agentId: agents.securityId,
      agentName: 'Security Reviewer',
      durationMs: 7400,
      tokensIn: 8300,
      tokensOut: 520,
      costUsd: 0.0091,
      score: 58,
      verdict: 'request_changes',
      summary: 'A hardcoded secret and a possible rate-limit bypass need to be addressed before merge.',
      findings: [
        {
          file: 'src/config.ts',
          startLine: 12,
          endLine: 12,
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key in commit',
          rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
          confidence: 0.96,
        },
        {
          file: 'src/api/users.ts',
          startLine: 45,
          endLine: 52,
          severity: 'WARNING',
          category: 'security',
          title: 'Rate-limit bypass risk in bulk user lookup',
          rationale: 'The per-user loop issues unauthenticated lookups that could sidestep the new limiter.',
          confidence: 0.72,
        },
        {
          file: 'src/api/public/webhooks.ts',
          startLine: 10,
          endLine: 15,
          severity: 'WARNING',
          category: 'security',
          title: 'Webhook payload accepted without signature revalidation',
          rationale: 'The handler trusts the payload body before the signature check runs.',
          confidence: 0.81,
        },
      ],
    },
    {
      agentId: agents.performanceId,
      agentName: 'Performance Reviewer',
      durationMs: 6100,
      tokensIn: 7100,
      tokensOut: 430,
      costUsd: 0.0076,
      score: 64,
      verdict: 'request_changes',
      summary: 'The new limiter introduces a severe N+1 query and some redundant per-request validation.',
      findings: [
        {
          file: 'src/api/users.ts',
          startLine: 45,
          endLine: 50,
          severity: 'CRITICAL',
          category: 'perf',
          title: 'N+1 query causes severe latency spike under new limiter',
          rationale: 'Each of the up-to-500 users in a lookup now issues its own round trip.',
          confidence: 0.93,
        },
        {
          file: 'src/api/public/webhooks.ts',
          startLine: 12,
          endLine: 18,
          severity: 'WARNING',
          category: 'perf',
          title: 'Redundant per-request validation adds latency',
          rationale: 'The same payload shape is validated twice on the hot path.',
          confidence: 0.68,
        },
      ],
    },
    {
      agentId: agents.apiContractId,
      agentName: 'API Contract Reviewer',
      durationMs: 4300,
      tokensIn: 5200,
      tokensOut: 260,
      costUsd: 0.0052,
      score: 91,
      verdict: 'comment',
      summary: 'No breaking changes; one minor versioning nit on the new webhook endpoint.',
      findings: [
        {
          file: 'src/api/public/webhooks.ts',
          startLine: 30,
          endLine: 31,
          severity: 'SUGGESTION',
          category: 'api',
          title: 'New webhook endpoint ships without a version prefix',
          rationale: 'Every other public route is under `/v1/` — this one is bare `/webhooks`.',
          confidence: 0.6,
        },
      ],
    },
  ];

  for (const run of runSeeds) {
    const blockers = run.findings.filter((f) => f.severity === 'CRITICAL').length;
    const [agentRun] = await db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        agentId: run.agentId,
        prId,
        multiAgentRunId,
        ranAt,
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4-flash',
        durationMs: run.durationMs,
        tokensIn: run.tokensIn,
        tokensOut: run.tokensOut,
        status: 'done',
        source: 'local',
        findingsCount: run.findings.length,
        grounding: `${run.findings.length}/${run.findings.length} passed`,
        score: run.score,
        blockers,
        costUsd: run.costUsd,
      })
      .returning();
    const runId = agentRun!.id;

    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId,
        agentId: run.agentId,
        runId,
        kind: 'review',
        verdict: run.verdict,
        summary: run.summary,
        score: run.score,
        model: 'deepseek/deepseek-v4-flash',
      })
      .returning({ id: t.reviews.id });
    const reviewId = review!.id;

    await db.insert(t.findings).values(
      run.findings.map((f) => ({
        reviewId,
        file: f.file,
        startLine: f.startLine,
        endLine: f.endLine,
        severity: f.severity,
        category: f.category,
        title: f.title,
        rationale: f.rationale,
        confidence: f.confidence,
      })),
    );

    await db.insert(t.runTraces).values({
      runId,
      trace: {
        config: {
          agent: run.agentName,
          version: '1',
          provider: 'openrouter',
          model: 'deepseek/deepseek-v4-flash',
          pr: 482,
          source: 'local',
        },
        stats: {
          duration_ms: run.durationMs,
          tokens_in: run.tokensIn,
          tokens_out: run.tokensOut,
          findings: run.findings.length,
          grounding: `${run.findings.length}/${run.findings.length} passed`,
          cost_usd: run.costUsd,
        },
        prompt_assembly: { system: `${run.agentName} system prompt (multi-agent demo)`, user: 'Review PR #482' },
        tool_calls: [],
        raw_output: '',
        memory_pulled: [],
        specs_read: [],
        log: [],
      },
    });
  }
}
