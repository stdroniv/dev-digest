import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import {
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
  API_CONTRACT_REVIEWER_PROMPT,
} from './seed-prompts.js';
import { GENERAL_REVIEWER_PROMPT } from '../platform/reviewer-prompts.js';
import { DEMO_SKILLS, AGENT_SKILL_LINKS, STATS_DEMO_REVIEWS } from './seed-skills.js';
import { seedCi } from './seed-ci.js';
import { seedEvalCases } from './seed-evals.js';
import { seedHardEvalCases } from './seed-evals-hard.js';
import { seedApiContractSkillEvalCases } from './seed-evals-skills.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, and the three built-in agents (General + Security +
 * Performance), all on the default openrouter/deepseek-v4-flash provider+model.
 *
 * Course lessons populate the other tables (skills, conventions, memory, eval,
 * …) once their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

/**
 * Options for {@link seed}.
 *
 * `includeEvalFixtures` controls whether the demo eval cases (AC-7 Security
 * Reviewer + the hard cross-agent set) are seeded. They insert extra reviews /
 * findings / agent-runs against the demo reviewer agents, which perturbs the
 * counts that the pre-existing integration tests assert on (e.g. skill-stats'
 * `findings_30d`). So they are OFF by default — every `.it.test.ts` that calls
 * `seed()` in `beforeAll` gets the deterministic demo data — and turned ON only
 * at the CLI `db:seed` entrypoint used by dev / e2e, where the Eval Dashboard
 * demo wants them present.
 */
export interface SeedOptions {
  includeEvalFixtures?: boolean;
}

export async function seed(
  db: Db,
  opts: SeedOptions = {},
): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0 },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
    ]);
  }

  // ---- built-in agents (the three starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    // L02 — two reviewers built FROM skills (the control experiment). Each is a
    // bare persona; the team rules it checks live in its linked skills below.
    {
      workspaceId,
      name: 'Test Quality Reviewer',
      description: 'Flags uncovered branches, missed corner cases, over-mocking, and flaky tests.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'API Contract Reviewer',
      description: 'Detects breaking changes to HTTP request/response contracts before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: API_CONTRACT_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  // ---- L02 skills + agent links ----
  // The knowledge layer: markdown rule blocks stored in the DB and injected into
  // an agent's prompt. `phantom-api-gate` is seeded via the IMPORT path (an
  // untrusted source, disabled until vetted) so the whole flow is represented.
  for (const s of DEMO_SKILLS) {
    let [skill] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, s.name)));
    if (!skill) {
      [skill] = await db
        .insert(t.skills)
        .values({ workspaceId, ...s })
        .returning();
      // Record the immutable v1 body snapshot (mirrors SkillsRepository.insert).
      await db
        .insert(t.skillVersions)
        .values({ skillId: skill!.id, version: 1, body: s.body })
        .onConflictDoNothing();
    }
  }

  // Link skills to agents in order (the order drives prompt-block order).
  for (const [agentName, skillNames] of Object.entries(AGENT_SKILL_LINKS)) {
    const [agent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, agentName)));
    if (!agent) continue;
    for (let i = 0; i < skillNames.length; i++) {
      const [skill] = await db
        .select()
        .from(t.skills)
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, skillNames[i]!)));
      if (!skill) continue;
      await db
        .insert(t.agentSkills)
        .values({ agentId: agent.id, skillId: skill.id, order: i })
        .onConflictDoNothing();
    }
  }

  // ---- one completed agent run for PR #482 ----
  // Gives the Agent runs timeline a settled run, the PR list a non-null COST
  // aggregate, and the trace sidebar a COST stat — all on deterministic data
  // (fixed tokens + $0.0123) so the demo and e2e flows have something to assert.
  const [securityAgent] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Security Reviewer')));
  const [existingRun] = await db
    .select({ id: t.agentRuns.id })
    .from(t.agentRuns)
    .where(eq(t.agentRuns.prId, pr!.id));
  let seededRunId: string | undefined = existingRun?.id;
  if (securityAgent && !existingRun) {
    const tokensIn = 9119;
    const tokensOut = 612;
    const costUsd = 0.0123;
    const [run] = await db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        agentId: securityAgent.id,
        prId: pr!.id,
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        durationMs: 8200,
        tokensIn,
        tokensOut,
        status: 'done',
        source: 'local',
        findingsCount: 2,
        grounding: '2/2 passed',
        score: 61,
        blockers: 1,
        costUsd,
      })
      .returning();
    seededRunId = run!.id;
    await db.insert(t.runTraces).values({
      runId: run!.id,
      trace: {
        config: {
          agent: 'Security Reviewer',
          version: '1',
          provider: DEFAULT_PROVIDER,
          model: DEFAULT_MODEL,
          pr: 482,
          source: 'local',
        },
        stats: {
          duration_ms: 8200,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          findings: 2,
          grounding: '2/2 passed',
          cost_usd: costUsd,
        },
        prompt_assembly: { system: SECURITY_REVIEWER_PROMPT, user: 'Review PR #482' },
        tool_calls: [],
        raw_output: '',
        memory_pulled: [],
        specs_read: [],
        log: [],
      },
    });
  }

  // Link the sample review to the seeded run + agent. Real runs set
  // `reviews.run_id` in the executor; the demo review is created standalone, so
  // without this the timeline run can't attribute its findings — per-run
  // `findings_counts` (the severity counters + hover popover) come back null and
  // the review run shows a generic "Agent". Outside the `!existingRun` guard so
  // re-running `pnpm db:seed` repairs an already-seeded DB.
  if (securityAgent && seededRunId) {
    await db
      .update(t.reviews)
      .set({ runId: seededRunId, agentId: securityAgent.id })
      .where(and(eq(t.reviews.prId, pr!.id), eq(t.reviews.kind, 'review')));
  }

  // ---- Skills → Stats tab demo (PR #501) ----
  // A second demo PR whose reviews are attributed to the `pr-quality-rubric`
  // agents, with categorized + decided findings, so that skill's Stats tab shows
  // realistic non-zero metrics. Guarded on PR #501 so re-seeding is idempotent.
  let [statsPr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 501)));
  if (!statsPr) {
    [statsPr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 501,
        title: 'Refactor checkout totals and tax rounding',
        author: 'devon.li',
        branch: 'feat/checkout-totals',
        base: 'main',
        headSha: 'b7c8d9e0f1a2',
        additions: 184,
        deletions: 52,
        filesCount: 7,
        status: 'needs_review',
        body: 'Refactor checkout total calculation and fix tax rounding for multi-currency carts.',
      })
      .returning();

    // Resolve the seeded agents once, by name.
    const agentRows = await db
      .select({ id: t.agents.id, name: t.agents.name })
      .from(t.agents)
      .where(eq(t.agents.workspaceId, workspaceId));
    const agentIdByName = new Map(agentRows.map((a) => [a.name, a.id]));

    for (const demo of STATS_DEMO_REVIEWS) {
      const agentId = agentIdByName.get(demo.agent);
      if (!agentId) continue;
      const [review] = await db
        .insert(t.reviews)
        .values({
          workspaceId,
          prId: statsPr!.id,
          agentId,
          kind: 'review',
          verdict: 'comment',
          summary: `${demo.agent} review of PR #501 (stats demo).`,
          model: 'seed',
        })
        .returning();
      await db.insert(t.findings).values(
        demo.findings.map((f, i) => ({
          reviewId: review!.id,
          file: 'src/checkout/totals.ts',
          startLine: 10 + i,
          endLine: 10 + i,
          severity: f.severity,
          category: f.category,
          title: `${f.category} finding ${i + 1}`,
          rationale: `Seeded ${f.category} finding for the skill-stats demo.`,
          confidence: 0.8,
          acceptedAt: f.decision === 'accepted' ? new Date() : null,
          dismissedAt: f.decision === 'dismissed' ? new Date() : null,
        })),
      );
    }
  }

  // ---- T8 — Export-to-CI demo data (installations/runs/agent_runs, AC-35/39/40/42) ----
  await seedCi(db, workspaceId);

  if (opts.includeEvalFixtures) {
    // ---- L06 — eval cases for the demo Security Reviewer agent (AC-7) ----
    await seedEvalCases(db, workspaceId, repoId);

    // ---- Hard, real-world eval cases across all 5 reviewer agents ----
    await seedHardEvalCases(db, workspaceId, repoId);

    // ---- Eval cases for the API Contract Reviewer's four granular skills
    //      (breaking-change, response-schema, semver-discipline, deprecation-policy) ----
    await seedApiContractSkillEvalCases(db, workspaceId);
  }

  return { workspaceId, userId };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  // The CLI seed backs the dev app + e2e — include the eval-dashboard demo data.
  seed(handle.db, { includeEvalFixtures: true })
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
