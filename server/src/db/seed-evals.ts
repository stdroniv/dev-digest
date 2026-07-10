import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import * as t from './schema.js';

/**
 * T9 — seed ≥8 eval cases for the demo "Security Reviewer" agent (AC-7), from
 * real accepted/dismissed findings, with BOTH expectation types represented.
 * Freezes each case with the SAME shape `EvalService.createCaseFromFinding`
 * writes (`input_diff` text + `input_meta.source_finding_id`/`pr_title`/
 * `pr_number`/`pr_body`) — a seeded case runs identically to a clicked one.
 * The one-click-from-finding path stays the primary write path; this only
 * guarantees the AC-7 floor. Idempotent: re-running `pnpm db:seed` is a no-op
 * once the agent already has any eval cases.
 */

interface EvalDemoFinding {
  file: string;
  startLine: number;
  endLine: number;
  severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION';
  category: 'bug' | 'security' | 'perf' | 'style' | 'test';
  title: string;
  rationale: string;
  decision: 'accepted' | 'dismissed';
}

// 8 findings, mixed accepted (→ must_find) / dismissed (→ must_not_flag),
// spanning the demo repo's real changed files (acme/payments-api).
const EVAL_DEMO_FINDINGS: EvalDemoFinding[] = [
  {
    file: 'src/config.ts',
    startLine: 12,
    endLine: 12,
    severity: 'CRITICAL',
    category: 'security',
    title: 'Hardcoded Stripe secret key',
    rationale: 'A literal `sk_live_` key is committed in plaintext.',
    decision: 'accepted',
  },
  {
    file: 'src/api/public/webhooks.ts',
    startLine: 40,
    endLine: 44,
    severity: 'WARNING',
    category: 'security',
    title: 'Missing webhook signature verification',
    rationale: 'The handler trusts the payload without verifying its signature.',
    decision: 'accepted',
  },
  {
    file: 'src/middleware/ratelimit.ts',
    startLine: 18,
    endLine: 22,
    severity: 'WARNING',
    category: 'security',
    title: 'Rate limiter keyed on a client-supplied header',
    rationale: '`X-Forwarded-For` is attacker-controlled and trivially spoofed.',
    decision: 'accepted',
  },
  {
    file: 'src/api/users.ts',
    startLine: 12,
    endLine: 15,
    severity: 'WARNING',
    category: 'security',
    title: 'Unvalidated redirect target',
    rationale: 'The redirect URL is taken from user input with no allowlist.',
    decision: 'accepted',
  },
  {
    file: 'src/api/users.ts',
    startLine: 45,
    endLine: 52,
    severity: 'WARNING',
    category: 'perf',
    title: 'N+1 query in user list endpoint',
    rationale: 'Out of scope for a security review — correctly dismissed.',
    decision: 'dismissed',
  },
  {
    file: 'src/config.ts',
    startLine: 30,
    endLine: 30,
    severity: 'SUGGESTION',
    category: 'style',
    title: 'Inconsistent import ordering',
    rationale: 'Cosmetic only — not a security concern.',
    decision: 'dismissed',
  },
  {
    file: 'src/api/public/webhooks.ts',
    startLine: 10,
    endLine: 10,
    severity: 'SUGGESTION',
    category: 'style',
    title: 'Prefer const over let',
    rationale: 'Stylistic nit unrelated to correctness or security.',
    decision: 'dismissed',
  },
  {
    file: 'src/middleware/ratelimit.ts',
    startLine: 5,
    endLine: 5,
    severity: 'CRITICAL',
    category: 'security',
    title: 'False positive: rate-limit bucket name mistaken for a secret',
    rationale: 'Not actually a secret — dismissed as a false positive.',
    decision: 'dismissed',
  },
];

/**
 * Design-fidelity run history for the demo agent. Five run groups (v3→v7) whose
 * metrics trend upward, with a deliberate precision dip on the newest so the
 * detail surface shows a real regression alert ("Precision dipped 2pts"), a
 * populated trend chart + sparklines, and a Compare prompt-diff between adjacent
 * versions (each carries the actual system prompt that produced it — the v6→v7
 * step adds the "Flag unused imports" line). Without this the dashboard is empty
 * on a fresh seed and the first single run trips the sparkline's degenerate case.
 */
interface EvalDemoRun {
  version: number;
  ranAt: string;
  recall: number;
  precision: number;
  citation: number;
  /** How many of the set's cases pass in this run (drives traces_passed). */
  passed: number;
  cost: number;
  prompt: string;
}

const EVAL_DEMO_RUNS: EvalDemoRun[] = [
  {
    version: 3,
    ranAt: '2026-05-19T10:08:00Z',
    recall: 0.7,
    precision: 0.9,
    citation: 0.9,
    passed: 5,
    cost: 0.02,
    prompt: 'You are a PR reviewer. Look for security problems in the diff and report them.',
  },
  {
    version: 4,
    ranAt: '2026-05-22T14:33:00Z',
    recall: 0.74,
    precision: 0.92,
    citation: 0.92,
    passed: 6,
    cost: 0.022,
    prompt:
      'You are a security PR reviewer. Look for hardcoded secrets and untrusted input reaching a sink.\nReturn findings ranked by severity.',
  },
  {
    version: 5,
    ranAt: '2026-05-25T11:02:00Z',
    recall: 0.77,
    precision: 0.93,
    citation: 0.93,
    passed: 6,
    cost: 0.024,
    prompt:
      'You are a security PR reviewer. Look for hardcoded secrets and untrusted input reaching a sink.\nReturn findings ranked by severity.\nCite file and line for each finding.',
  },
  {
    version: 6,
    ranAt: '2026-05-27T16:40:00Z',
    recall: 0.8,
    precision: 0.93,
    citation: 0.94,
    passed: 7,
    cost: 0.021,
    prompt:
      'You are a security-focused PR reviewer. Examine the diff for hardcoded secrets, untrusted input reaching a sink, and the lethal trifecta.\nReturn at most 5 findings ranked by severity.\nEvery finding MUST cite file and start_line-end_line inside the diff hunks.',
  },
  {
    version: 7,
    ranAt: '2026-05-29T09:14:00Z',
    recall: 0.81,
    precision: 0.91,
    citation: 0.95,
    passed: 7,
    cost: 0.023,
    prompt:
      'You are a security-focused PR reviewer. Examine the diff for hardcoded secrets, untrusted input reaching a sink, and the lethal trifecta.\nReturn at most 5 findings ranked by severity.\nFlag unused imports as suggestions.\nEvery finding MUST cite file and start_line-end_line inside the diff hunks.',
  },
];

/** Build a minimal synthetic unified diff that covers exactly `[startLine,
 *  endLine]` as ADDED lines in `file` — enough for the scorer's match rule
 *  and citation check, without needing a real clone. */
function buildDiffText(file: string, startLine: number, endLine: number): string {
  const count = Math.max(endLine - startLine + 1, 1);
  const body = Array.from({ length: count }, (_, i) => `+  // seeded line ${startLine + i}`).join('\n');
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -${startLine},0 +${startLine},${count} @@`,
    body,
  ].join('\n');
}

/** T12 — a demo SKILL's eval cases (R-G1-1..7), both `must_find` and
 *  `must_not_flag` represented, so a freshly seeded workspace shows a
 *  populated Skill Evals tab (the `skill-evals` artboard's populated state).
 *  Owns `secret-leakage-gate` (already a DEMO_SKILL, `db/seed-skills.ts`) —
 *  its rubric is about hardcoded secrets, which matches these fixtures'
 *  theme. Idempotent: guarded on this skill already having any eval case,
 *  mirroring the agent-case guard below. */
interface SkillEvalDemoCase {
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  title: string;
  /** `true` → must_find (one expected finding); `false` → must_not_flag ([]). */
  mustFind: boolean;
}

const SKILL_EVAL_DEMO_CASES: SkillEvalDemoCase[] = [
  {
    name: 'stripe-live-key-must-find',
    file: 'src/config.ts',
    startLine: 12,
    endLine: 12,
    title: 'Hardcoded Stripe secret key (sk_live_)',
    mustFind: true,
  },
  {
    name: 'service-role-key-must-find',
    file: 'src/api/admin.ts',
    startLine: 8,
    endLine: 8,
    title: 'Supabase service_role key committed in source',
    mustFind: true,
  },
  {
    name: 'placeholder-key-must-not-flag',
    file: 'src/config.ts',
    startLine: 40,
    endLine: 40,
    title: 'Placeholder/example key in a fixture — not a real secret',
    mustFind: false,
  },
  {
    name: 'env-var-reference-must-not-flag',
    file: 'src/api/users.ts',
    startLine: 5,
    endLine: 5,
    title: 'process.env reference — reads a secret, does not leak one',
    mustFind: false,
  },
];

async function seedSkillEvalCases(db: Db, workspaceId: string): Promise<void> {
  const [skill] = await db
    .select()
    .from(t.skills)
    .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, 'secret-leakage-gate')));
  if (!skill) return;

  const [existingCase] = await db
    .select({ id: t.evalCases.id })
    .from(t.evalCases)
    .where(
      and(
        eq(t.evalCases.workspaceId, workspaceId),
        eq(t.evalCases.ownerKind, 'skill'),
        eq(t.evalCases.ownerId, skill.id),
      ),
    );
  if (existingCase) return; // idempotent — already seeded

  await db.insert(t.evalCases).values(
    SKILL_EVAL_DEMO_CASES.map((c) => ({
      workspaceId,
      ownerKind: 'skill' as const,
      ownerId: skill.id,
      name: c.name,
      inputDiff: buildDiffText(c.file, c.startLine, c.endLine),
      inputMeta: { title: c.title },
      expectedOutput: c.mustFind
        ? [
            {
              file: c.file,
              start_line: c.startLine,
              end_line: c.endLine,
              severity: 'CRITICAL',
              category: 'security',
              title: c.title,
            },
          ]
        : [],
      notes: null,
    })),
  );
}

async function seedAgentEvalCases(db: Db, workspaceId: string, repoId: string): Promise<void> {
  const [agent] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Security Reviewer')));
  if (!agent) return;

  const [existingCase] = await db
    .select({ id: t.evalCases.id })
    .from(t.evalCases)
    .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerId, agent.id)));
  if (existingCase) return; // idempotent — already seeded

  // A dedicated fixture PR (#512), kept separate from #482/#501 which other
  // tests/fixtures rely on staying exactly as they are (server/INSIGHTS).
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 512)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 512,
        title: 'Harden public API auth + rate limiting (eval fixture PR)',
        author: 'marisa.koch',
        branch: 'feat/harden-public-api',
        base: 'main',
        headSha: 'c3d4e5f6a7b8',
        additions: 60,
        deletions: 4,
        filesCount: 4,
        status: 'needs_review',
        body: 'Fixture PR for L06 eval-case seeding — security-relevant changes across auth, rate limiting, and webhook handling.',
      })
      .returning();
  }
  const prRow = pr!;

  const [review] = await db
    .insert(t.reviews)
    .values({
      workspaceId,
      prId: prRow.id,
      agentId: agent.id,
      kind: 'review',
      verdict: 'request_changes',
      summary: 'Eval-case seed review for the Security Reviewer demo set.',
      model: 'seed',
    })
    .returning();
  const reviewRow = review!;

  const findingRows = await db
    .insert(t.findings)
    .values(
      EVAL_DEMO_FINDINGS.map((f) => ({
        reviewId: reviewRow.id,
        file: f.file,
        startLine: f.startLine,
        endLine: f.endLine,
        severity: f.severity,
        category: f.category,
        title: f.title,
        rationale: f.rationale,
        confidence: 0.9,
        acceptedAt: f.decision === 'accepted' ? new Date() : null,
        dismissedAt: f.decision === 'dismissed' ? new Date() : null,
      })),
    )
    .returning();

  // Freeze each finding into an eval case — same shape
  // `EvalService.createCaseFromFinding` writes.
  const caseRows: { id: string }[] = [];
  for (let i = 0; i < findingRows.length; i++) {
    const finding = findingRows[i]!;
    const demo = EVAL_DEMO_FINDINGS[i]!;
    const expectedOutput =
      demo.decision === 'accepted'
        ? [
            {
              file: demo.file,
              start_line: demo.startLine,
              end_line: demo.endLine,
              severity: demo.severity,
              category: demo.category,
              title: demo.title,
            },
          ]
        : [];
    const [caseRow] = await db
      .insert(t.evalCases)
      .values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: agent.id,
        name: `From finding: ${demo.title}`,
        inputDiff: buildDiffText(demo.file, demo.startLine, demo.endLine),
        inputMeta: {
          source_finding_id: finding.id,
          pr_title: prRow.title,
          pr_number: prRow.number,
          pr_body: prRow.body ?? null,
        },
        expectedOutput,
        notes: null,
      })
      .returning({ id: t.evalCases.id });
    caseRows.push(caseRow!);
  }

  await seedEvalRuns(db, agent, caseRows);
}

/** Entry point called from `db/seed.ts` (gated by `includeEvalFixtures`) — the
 *  demo agent's cases/runs (AC-7) plus the demo skill's cases (T12, R-G1-1..7).
 *  Each half is independently idempotent, so re-running `pnpm db:seed` is a
 *  no-op regardless of which half already ran. */
export async function seedEvalCases(db: Db, workspaceId: string, repoId: string): Promise<void> {
  await seedAgentEvalCases(db, workspaceId, repoId);
  await seedSkillEvalCases(db, workspaceId);
}

/**
 * Seed the run history + per-version config snapshots for the demo agent. One
 * `run_group_id` ties the N per-case rows of a run together (AC-9); the run-group
 * aggregate is DERIVED (averaged) from those rows, so setting every row of a
 * group to the group's target metrics yields exactly that aggregate, and `pass`
 * on the first `passed` rows yields the traces-passed count.
 */
async function seedEvalRuns(
  db: Db,
  agent: typeof t.agents.$inferSelect,
  caseRows: { id: string }[],
): Promise<void> {
  const numCases = caseRows.length;
  if (numCases === 0) return;

  for (const run of EVAL_DEMO_RUNS) {
    // Immutable config snapshot so Compare can diff adjacent versions' prompts.
    await db
      .insert(t.agentVersions)
      .values({
        agentId: agent.id,
        version: run.version,
        configJson: {
          provider: agent.provider,
          model: agent.model,
          system_prompt: run.prompt,
          output_schema: agent.outputSchema,
          strategy: agent.strategy,
          ci_fail_on: agent.ciFailOn,
          repo_intel: agent.repoIntel,
          skills: [],
        },
      })
      .onConflictDoNothing();

    const runGroupId = randomUUID();
    const ranAt = new Date(run.ranAt);
    // Cost SUMS across the group's rows (toRunGroupDto), so spread the run total.
    const perRowCost = run.cost / numCases;
    await db.insert(t.evalRuns).values(
      caseRows.map((c, i) => ({
        caseId: c.id,
        ranAt,
        actualOutput: null,
        pass: i < run.passed,
        recall: run.recall,
        precision: run.precision,
        citationAccuracy: run.citation,
        durationMs: 1800,
        costUsd: perRowCost,
        runGroupId,
        agentVersion: run.version,
      })),
    );
  }
}
