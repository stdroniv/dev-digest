import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { EvalService } from '../src/modules/eval/service.js';
import { EvalRepository } from '../src/modules/eval/repository.js';
import { createMockReviewerLLM } from '../src/modules/eval/mock-reviewer.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval-service.it] Docker not available — skipping.');
}

const FIXTURE_DIFF =
  'diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n@@ -10,0 +10,3 @@\n+  const a = 1;\n+  const b = 2;\n+  const c = 3;';

/** A minimal, always-valid Review fixture for the eval-runner model-picker
 *  tests (T4) — content doesn't matter, only which model/provider threaded
 *  the completeStructured call. */
const NEUTRAL_REVIEW_FIXTURE: Review = {
  verdict: 'approve',
  summary: 'Nothing notable.',
  score: 95,
  findings: [],
};

/**
 * T6 — eval service. Uses the T5 mock reviewer (`llmOverride`) throughout so
 * no LLM keys/network are required — this suite only needs Postgres
 * (testcontainers), same as every other `.it.test.ts` in this package.
 */
d('EvalService (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let prId: string;
  let agentId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'eval-service-fixture', fullName: 'acme/eval-service-fixture' })
      .returning();
    repoId = repo!.id;

    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 9001,
        title: 'Eval service fixture PR',
        author: 'tester',
        branch: 'feat/eval-fixture',
        base: 'main',
        headSha: 'deadbeef',
        status: 'needs_review',
      })
      .returning();
    prId = pr!.id;

    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient({ diff: FIXTURE_DIFF }), github: new MockGitHubClient() },
    });

    const agent = await app.container.agentsRepo.insert({
      workspaceId,
      name: 'Eval Service Fixture Agent',
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'You are a security-focused code reviewer. Version 1.',
    });
    agentId = agent.id;
    await app.close();
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient({ diff: FIXTURE_DIFF }), github: new MockGitHubClient() },
    });
  }

  async function insertReviewWithFinding(decision: 'accepted' | 'dismissed' | 'none') {
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({ workspaceId, prId, agentId, kind: 'review', model: 'seed' })
      .returning();
    const [finding] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 10,
        endLine: 10,
        severity: 'CRITICAL',
        category: 'security',
        title: `Fixture finding (${decision})`,
        rationale: 'Fixture rationale.',
        confidence: 0.9,
        acceptedAt: decision === 'accepted' ? new Date() : null,
        dismissedAt: decision === 'dismissed' ? new Date() : null,
      })
      .returning();
    return finding!;
  }

  it('accepted finding → must_find case with the frozen diff (AC-1)', async () => {
    const app = await makeApp();
    const service = new EvalService(app.container);
    const finding = await insertReviewWithFinding('accepted');

    const result = await service.createCaseFromFinding(workspaceId, finding.id);
    expect(result.status).toBe('created');
    if (result.status !== 'created') throw new Error('expected created');
    expect(result.case.expected_output).toEqual([
      {
        file: 'src/config.ts',
        start_line: 10,
        end_line: 10,
        severity: 'CRITICAL',
        category: 'security',
        title: `Fixture finding (accepted)`,
      },
    ]);
    expect(result.case.input_diff).toContain('src/config.ts');
    await app.close();
  });

  it('dismissed finding → must_not_flag case ([]) with the frozen diff (AC-2)', async () => {
    const app = await makeApp();
    const service = new EvalService(app.container);
    const finding = await insertReviewWithFinding('dismissed');

    const result = await service.createCaseFromFinding(workspaceId, finding.id);
    expect(result.status).toBe('created');
    if (result.status !== 'created') throw new Error('expected created');
    expect(result.case.expected_output).toEqual([]);
    await app.close();
  });

  it('no-decision finding yields no case (AC-4)', async () => {
    const app = await makeApp();
    const service = new EvalService(app.container);
    const finding = await insertReviewWithFinding('none');

    const result = await service.createCaseFromFinding(workspaceId, finding.id);
    expect(result.status).toBe('no_decision');
    await app.close();
  });

  it('repeated clicks on the same finding are idempotent (AC-5)', async () => {
    const app = await makeApp();
    const service = new EvalService(app.container);
    const finding = await insertReviewWithFinding('accepted');

    const first = await service.createCaseFromFinding(workspaceId, finding.id);
    expect(first.status).toBe('created');
    const second = await service.createCaseFromFinding(workspaceId, finding.id);
    expect(second.status).toBe('already_exists');
    if (first.status !== 'created' || second.status !== 'already_exists') {
      throw new Error('unexpected status');
    }
    expect(second.case.id).toBe(first.case.id);
    await app.close();
  });

  it('a case is a snapshot — a later decision flip does not mutate it (edge case)', async () => {
    const app = await makeApp();
    const service = new EvalService(app.container);
    const finding = await insertReviewWithFinding('accepted');

    const created = await service.createCaseFromFinding(workspaceId, finding.id);
    if (created.status !== 'created') throw new Error('expected created');

    // Flip the decision after the case was frozen.
    await pg.handle.db
      .update(t.findings)
      .set({ acceptedAt: null, dismissedAt: new Date() })
      .where(eq(t.findings.id, finding.id));

    const cases = await service.listCases(workspaceId, agentId);
    const stillFrozen = cases?.find((c) => c.id === created.case.id);
    expect(stillFrozen?.expected_output).toEqual(created.case.expected_output);
    await app.close();
  });

  it('run-all persists one row per case under ONE run_group_id, attributed to the current agent version (AC-9/AC-10)', async () => {
    const app = await makeApp();
    const service = new EvalService(app.container);
    const repo = new EvalRepository(app.container.db);

    const case1 = await repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name: 'run-all fixture 1',
      inputDiff: FIXTURE_DIFF,
      expectedOutput: [{ file: 'src/config.ts', start_line: 10, end_line: 10 }],
    });
    const case2 = await repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name: 'run-all fixture 2',
      inputDiff: FIXTURE_DIFF,
      expectedOutput: [],
    });

    const diff = parseUnifiedDiff(FIXTURE_DIFF);
    const group = await service.runAllForAgent(workspaceId, agentId, {
      llmOverride: createMockReviewerLLM(diff, 'baseline'),
    });

    expect(group.run_group_id).toBeDefined();
    expect(group.traces_total).toBeGreaterThanOrEqual(2);

    const rows = await repo.getRunGroupRows(group.run_group_id);
    const caseIds = rows.map((r) => r.caseId);
    expect(caseIds).toContain(case1.id);
    expect(caseIds).toContain(case2.id);
    for (const row of rows) {
      expect(row.runGroupId).toBe(group.run_group_id);
      expect(typeof row.agentVersion).toBe('number');
    }
    await app.close();
  });

  it('single-case run persists one record and updates the derived aggregate (AC-25)', async () => {
    const app = await makeApp();
    const service = new EvalService(app.container);
    const repo = new EvalRepository(app.container.db);

    const caseRow = await repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name: 'single-case fixture',
      inputDiff: FIXTURE_DIFF,
      expectedOutput: [{ file: 'src/config.ts', start_line: 10, end_line: 10 }],
    });

    const diff = parseUnifiedDiff(FIXTURE_DIFF);
    const result = await service.runSingleCase(workspaceId, caseRow.id, {
      llmOverride: createMockReviewerLLM(diff, 'baseline'),
    });
    expect(result?.run.case_id).toBe(caseRow.id);

    const dashboard = await service.agentDashboard(workspaceId, agentId);
    expect(dashboard).toBeDefined();
    expect(dashboard!.cases_total).toBeGreaterThanOrEqual(1);
    expect(dashboard!.current.traces_total).toBeGreaterThanOrEqual(1);
    await app.close();
  });

  it('run-all-agents isolates one agent\'s failure so the rest still complete (AC-26)', async () => {
    const app = await makeApp();
    const service = new EvalService(app.container);

    // A second agent with NO llmOverride and NO configured provider keys —
    // container.llm('openai') throws ConfigError (no OPENAI_API_KEY), so this
    // agent's run fails while the fixture agent (llmOverride not applicable
    // here — runAllAgents has no override hook, so BOTH would fail without
    // keys). To prove isolation deterministically we instead assert the
    // FAILING agent's error does not abort the batch: the fixture agent
    // (also keyless) fails too, but a THIRD, zero-case agent succeeds
    // trivially (an empty set never calls the LLM — AC-20).
    const zeroCaseAgent = await app.container.agentsRepo.insert({
      workspaceId,
      name: 'Eval Zero-Case Agent',
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'No cases ever attached to this agent.',
    });

    const results = await service.runAllAgents(workspaceId);
    const zeroCaseResult = results.find((r) => r.agent_id === zeroCaseAgent.id);
    expect(zeroCaseResult?.ok).toBe(true);
    expect(zeroCaseResult?.run?.traces_total).toBe(0);
    // The batch completed for every agent (no early abort on a prior failure).
    expect(results.length).toBeGreaterThanOrEqual(2);
    await app.close();
  });

  it('comparison returns per-metric deltas + a non-empty prompt diff across versions, and promote applies the target config (AC-16/AC-27)', async () => {
    const app = await makeApp();
    const service = new EvalService(app.container);
    const repo = new EvalRepository(app.container.db);

    const promoteAgent = await app.container.agentsRepo.insert({
      workspaceId,
      name: 'Eval Promote Fixture Agent',
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'Prompt v1.',
    });

    const caseRow = await repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: promoteAgent.id,
      name: 'compare fixture case',
      inputDiff: FIXTURE_DIFF,
      expectedOutput: [{ file: 'src/config.ts', start_line: 10, end_line: 10 }],
    });
    void caseRow;

    const diff = parseUnifiedDiff(FIXTURE_DIFF);
    const groupV1 = await service.runAllForAgent(workspaceId, promoteAgent.id, {
      llmOverride: createMockReviewerLLM(diff, 'baseline'),
    });
    expect(groupV1.agent_version).toBe(1);

    // Bump the agent's config (→ version 2, immutable snapshot recorded).
    await app.container.agentsRepo.update(workspaceId, promoteAgent.id, { systemPrompt: 'Prompt v2 (edited).' });
    const groupV2 = await service.runAllForAgent(workspaceId, promoteAgent.id, {
      llmOverride: createMockReviewerLLM(diff, 'degraded'),
    });
    expect(groupV2.agent_version).toBe(2);

    const comparison = await service.compare(workspaceId, groupV1.run_group_id, groupV2.run_group_id);
    expect(comparison.old_run.agent_version).toBe(1);
    expect(comparison.new_run.agent_version).toBe(2);
    expect(comparison.newer_version).toBe(2);
    expect(comparison.system_prompt_diff).not.toBe('');
    expect(comparison.precision.delta).toBe(comparison.precision.new - comparison.precision.old);

    // Promote v1 back (a "roll back to the older version" flow): applies v1's
    // config as the new live config (see service.ts doc — versions are never
    // mutated in place, so this bumps to a NEW version number whose CONFIG
    // matches v1's snapshot exactly).
    const promoted = await service.promote(workspaceId, promoteAgent.id, 1);
    expect(promoted?.system_prompt).toBe('Prompt v1.');

    // Same-version compare/promote → no-op (edge case).
    const noop = await service.promote(workspaceId, promoteAgent.id, promoted!.version);
    expect(noop?.version).toBe(promoted!.version);
    await app.close();
  });

  // ---- Eval Runner model picker (R1a/R1b/R2) -------------------------------

  it('unset eval_runner → the case executes on the agent\'s OWN model (R1a)', async () => {
    const mockOpenai = new MockLLMProvider('openai', {
      structuredBySchema: { Review: NEUTRAL_REVIEW_FIXTURE },
    });
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: FIXTURE_DIFF }),
        github: new MockGitHubClient(),
        llm: { openai: mockOpenai },
      },
    });
    const repo = new EvalRepository(app.container.db);
    const service = new EvalService(app.container);

    const caseRow = await repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name: 'eval_runner unset fixture',
      inputDiff: FIXTURE_DIFF,
      expectedOutput: [],
    });

    // No opts.llmOverride and no eval_runner settings override anywhere yet.
    const result = await service.runSingleCase(workspaceId, caseRow.id);
    expect(result).toBeDefined();

    const structuredCalls = mockOpenai.calls.filter((c) => c.method === 'completeStructured');
    expect(structuredCalls.length).toBeGreaterThan(0);
    for (const call of structuredCalls) {
      expect((call.req as { model: string }).model).toBe('gpt-4.1'); // the fixture agent's own model
    }

    await app.close();
  });

  it('eval_runner override → the case executes on the FIXED override model, not the agent\'s own (R1b)', async () => {
    const mockOpenrouter = new MockLLMProvider('openrouter', {
      structuredBySchema: { Review: NEUTRAL_REVIEW_FIXTURE },
    });
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: FIXTURE_DIFF }),
        github: new MockGitHubClient(),
        llm: { openrouter: mockOpenrouter },
      },
    });

    const put = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: {
        feature_models: { eval_runner: { provider: 'openrouter', model: 'openrouter/eval-fixed-x' } },
      },
    });
    expect(put.statusCode).toBe(200);

    const repo = new EvalRepository(app.container.db);
    const service = new EvalService(app.container);
    const caseRow = await repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId, // this agent's OWN model is openai/gpt-4.1 — the override must win
      name: 'eval_runner override fixture',
      inputDiff: FIXTURE_DIFF,
      expectedOutput: [],
    });

    const result = await service.runSingleCase(workspaceId, caseRow.id);
    expect(result).toBeDefined();

    const structuredCalls = mockOpenrouter.calls.filter((c) => c.method === 'completeStructured');
    expect(structuredCalls.length).toBeGreaterThan(0);
    for (const call of structuredCalls) {
      expect((call.req as { model: string }).model).toBe('openrouter/eval-fixed-x');
    }

    await app.close();
  });

  it('batch isolation: an eval_runner override pointing at an unreachable provider fails only the agents with cases, not the whole batch (R2)', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: FIXTURE_DIFF }),
        github: new MockGitHubClient(),
        // No provider has a configured key on THIS app instance, regardless of
        // the host machine's real ~/.devdigest/secrets.json — makes the override
        // provider deterministically unreachable.
        secrets: new MockSecretsProvider({}),
      },
    });

    const put = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: {
        feature_models: { eval_runner: { provider: 'anthropic', model: 'claude-unreachable' } },
      },
    });
    expect(put.statusCode).toBe(200);

    const repo = new EvalRepository(app.container.db);
    const service = new EvalService(app.container);

    // An agent with a case attached — its run must fail, but in isolation.
    const failingAgent = await app.container.agentsRepo.insert({
      workspaceId,
      name: 'Eval Isolation Fixture Agent',
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'Isolation fixture agent.',
    });
    await repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: failingAgent.id,
      name: 'isolation fixture case',
      inputDiff: FIXTURE_DIFF,
      expectedOutput: [],
    });

    // A zero-case agent — an empty set never resolves/calls the LLM (AC-20),
    // so it must still succeed even though the override is unreachable.
    const zeroCaseAgent = await app.container.agentsRepo.insert({
      workspaceId,
      name: 'Eval Isolation Zero-Case Agent',
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'No cases attached.',
    });

    const results = await service.runAllAgents(workspaceId);

    const failingResult = results.find((r) => r.agent_id === failingAgent.id);
    expect(failingResult?.ok).toBe(false);
    expect(failingResult?.error).toBeTruthy();

    const zeroCaseResult = results.find((r) => r.agent_id === zeroCaseAgent.id);
    expect(zeroCaseResult?.ok).toBe(true);
    expect(zeroCaseResult?.run?.traces_total).toBe(0);

    // The batch completed for every agent — no early abort on a prior failure.
    expect(results.length).toBeGreaterThanOrEqual(2);

    await app.close();
  });
});
