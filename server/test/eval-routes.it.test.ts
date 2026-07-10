import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { createMockReviewerLLM } from '../src/modules/eval/mock-reviewer.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval-routes.it] Docker not available — skipping.');
}

const FIXTURE_DIFF =
  'diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n@@ -10,0 +10,3 @@\n+  const a = 1;\n+  const b = 2;\n+  const c = 3;';

/**
 * T7 — eval routes (schema-first, AC-19). The mock reviewer LLM is injected
 * via `Container.overrides.llm.openai` (respected transparently by
 * `container.llm('openai')`), so a full create → run → history → compare →
 * promote round trip works over real HTTP with no real key/network.
 */
d('eval routes (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let prId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'eval-routes-fixture', fullName: 'acme/eval-routes-fixture' })
      .returning();
    repoId = repo!.id;

    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 9101,
        title: 'Eval routes fixture PR',
        author: 'tester',
        branch: 'feat/eval-routes-fixture',
        base: 'main',
        headSha: 'cafef00d',
        status: 'needs_review',
      })
      .returning();
    prId = pr!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const diff = parseUnifiedDiff(FIXTURE_DIFF);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: FIXTURE_DIFF }),
        github: new MockGitHubClient(),
        llm: { openai: createMockReviewerLLM(diff, 'baseline') },
      },
    });
  }

  async function createAgent(app: Awaited<ReturnType<typeof makeApp>>, name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name, provider: 'openai', model: 'gpt-4.1', system_prompt: 'Fixture prompt.' },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string; version: number };
  }

  it('POST /agents/:id/eval-cases rejects an invalid body (missing name) with 422 (AC-19)', async () => {
    const app = await makeApp();
    const agent = await createAgent(app, 'Eval Routes 422 Fixture Agent');
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval-cases`,
      payload: { expected_output: [] },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('404s for an unknown agent on eval-cases / eval-runs / eval-dashboard', async () => {
    const app = await makeApp();
    const unknownId = '00000000-0000-0000-0000-000000000000';
    expect((await app.inject({ method: 'GET', url: `/agents/${unknownId}/eval-cases` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/agents/${unknownId}/eval-runs` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/agents/${unknownId}/eval-dashboard` })).statusCode).toBe(404);
    await app.close();
  });

  it('full round trip: author case → run all → history → dashboard → single-case run → compare → promote', async () => {
    const app = await makeApp();
    const agent = await createAgent(app, 'Eval Routes Round-trip Agent');

    const authored = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval-cases`,
      payload: {
        name: 'Round-trip case',
        input_diff: FIXTURE_DIFF,
        expected_output: [{ file: 'src/config.ts', start_line: 10, end_line: 10 }],
      },
    });
    expect(authored.statusCode).toBe(201);
    const authoredCase = authored.json() as { id: string };

    const listRes = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` });
    expect(listRes.statusCode).toBe(200);
    expect((listRes.json() as unknown[]).length).toBeGreaterThanOrEqual(1);

    const runAllRes = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(runAllRes.statusCode).toBe(200);
    const groupV1 = runAllRes.json() as { run_group_id: string; agent_version: number };
    expect(groupV1.agent_version).toBe(agent.version);

    const historyRes = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs` });
    expect(historyRes.statusCode).toBe(200);
    expect((historyRes.json() as unknown[]).length).toBeGreaterThanOrEqual(1);

    const dashboardRes = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-dashboard` });
    expect(dashboardRes.statusCode).toBe(200);

    const singleRunRes = await app.inject({
      method: 'POST',
      url: `/eval-cases/${authoredCase.id}/eval-runs`,
    });
    expect(singleRunRes.statusCode).toBe(200);

    const updateRes = await app.inject({
      method: 'PUT',
      url: `/eval-cases/${authoredCase.id}`,
      payload: { name: 'Round-trip case (renamed)' },
    });
    expect(updateRes.statusCode).toBe(200);
    expect((updateRes.json() as { name: string }).name).toBe('Round-trip case (renamed)');

    // Bump the agent's config → version 2, then run again to get a 2nd run_group.
    const updateAgentRes = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}`,
      payload: { system_prompt: 'Fixture prompt v2 (edited).' },
    });
    expect(updateAgentRes.statusCode).toBe(200);
    const agentV2 = updateAgentRes.json() as { version: number };
    expect(agentV2.version).toBe(agent.version + 1);

    const runAllV2Res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(runAllV2Res.statusCode).toBe(200);
    const groupV2 = runAllV2Res.json() as { run_group_id: string; agent_version: number };

    const compareRes = await app.inject({
      method: 'POST',
      url: '/eval-runs/compare',
      payload: { old_run_group_id: groupV1.run_group_id, new_run_group_id: groupV2.run_group_id },
    });
    expect(compareRes.statusCode).toBe(200);
    const comparison = compareRes.json() as { newer_version: number | null; system_prompt_diff: string };
    expect(comparison.newer_version).toBe(agentV2.version);
    expect(comparison.system_prompt_diff).not.toBe('');

    const runAllAgentsRes = await app.inject({ method: 'POST', url: '/eval-runs/run-all-agents' });
    expect(runAllAgentsRes.statusCode).toBe(200);

    const dashboardAllRes = await app.inject({ method: 'GET', url: '/eval-dashboard' });
    expect(dashboardAllRes.statusCode).toBe(200);

    const promoteRes = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval-promote`,
      payload: { version: agent.version },
    });
    expect(promoteRes.statusCode).toBe(200);
    expect((promoteRes.json() as { system_prompt: string }).system_prompt).toBe('Fixture prompt.');

    const deleteRes = await app.inject({ method: 'DELETE', url: `/eval-cases/${authoredCase.id}` });
    expect(deleteRes.statusCode).toBe(200);
    const listAfterDelete = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` });
    expect((listAfterDelete.json() as { id: string }[]).some((c) => c.id === authoredCase.id)).toBe(false);

    await app.close();
  });

  it('create-from-finding: accepted → must_find, no-decision → 422, idempotent re-create (AC-1/AC-4/AC-5)', async () => {
    const app = await makeApp();
    const agent = await createAgent(app, 'Eval Routes Finding Agent');

    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({ workspaceId, prId, agentId: agent.id, kind: 'review', model: 'seed' })
      .returning();
    const [accepted] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 10,
        endLine: 10,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Fixture finding',
        rationale: 'r',
        confidence: 0.9,
        acceptedAt: new Date(),
      })
      .returning();
    const [undecided] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 11,
        endLine: 11,
        severity: 'WARNING',
        category: 'bug',
        title: 'Undecided fixture finding',
        rationale: 'r',
        confidence: 0.5,
      })
      .returning();

    const createdRes = await app.inject({ method: 'POST', url: `/findings/${accepted!.id}/eval-case` });
    expect(createdRes.statusCode).toBe(201);
    expect((createdRes.json() as { already_added: boolean }).already_added).toBe(false);

    const againRes = await app.inject({ method: 'POST', url: `/findings/${accepted!.id}/eval-case` });
    expect(againRes.statusCode).toBe(200);
    expect((againRes.json() as { already_added: boolean }).already_added).toBe(true);

    const noDecisionRes = await app.inject({ method: 'POST', url: `/findings/${undecided!.id}/eval-case` });
    expect(noDecisionRes.statusCode).toBe(422);

    await app.close();
  });
});
