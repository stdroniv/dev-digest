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
  console.warn('[eval-skill.it] Docker not available — skipping.');
}

const FIXTURE_DIFF =
  'diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n@@ -10,0 +10,3 @@\n+  const a = 1;\n+  const b = 2;\n+  const c = 3;';

/**
 * T11 — skill eval routes (Gap 1 backend, R-G1-2..7): create → run → dashboard
 * → history over real HTTP, offline via a container-wide mock LLM override
 * (`server/INSIGHTS.md:45`). Skills routes resolve the DEFAULT workspace via
 * `getContext` (`server/INSIGHTS.md` skills-routes note) — so the fixture
 * skill is inserted into the SAME `workspaceId` `seed()` returns, not a fresh
 * one, or the HTTP routes would 404 it.
 */
d('skill eval routes (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
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

  async function insertSkill(
    name: string,
    body = '# Secret leakage gate\n\nFlag hardcoded secrets.',
    enabled = true,
  ) {
    const [skill] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId,
        name,
        description: 'Eval-skill fixture',
        type: 'security',
        source: 'manual',
        body,
        enabled,
      })
      .returning();
    return skill!;
  }

  it('404s for an unknown skill on eval-cases / eval-runs / eval-dashboard', async () => {
    const app = await makeApp();
    const unknownId = '00000000-0000-0000-0000-000000000000';
    expect((await app.inject({ method: 'GET', url: `/skills/${unknownId}/eval-cases` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/skills/${unknownId}/eval-runs` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/skills/${unknownId}/eval-dashboard` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/skills/${unknownId}/eval-runs` })).statusCode).toBe(404);
    await app.close();
  });

  it('POST /skills/:id/eval-cases rejects an invalid body (missing name) with 422 (AC-19)', async () => {
    const app = await makeApp();
    const skill = await insertSkill('Eval Skill 422 Fixture');
    const res = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/eval-cases`,
      payload: { expected_output: [] },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('empty-set dashboard (a skill with ZERO cases) returns defined, non-NaN aggregates (R-G1-7)', async () => {
    const app = await makeApp();
    const skill = await insertSkill('Eval Skill Zero-Case Fixture');

    const dashboardRes = await app.inject({ method: 'GET', url: `/skills/${skill.id}/eval-dashboard` });
    expect(dashboardRes.statusCode).toBe(200);
    const dashboard = dashboardRes.json() as {
      owner_kind: string;
      cases_total: number;
      current: { recall: number; precision: number; citation_accuracy: number; traces_passed: number; traces_total: number };
    };
    expect(dashboard.owner_kind).toBe('skill');
    expect(dashboard.cases_total).toBe(0);
    expect(dashboard.current.traces_total).toBe(0);
    expect(Number.isNaN(dashboard.current.recall)).toBe(false);
    expect(Number.isNaN(dashboard.current.precision)).toBe(false);
    expect(Number.isNaN(dashboard.current.citation_accuracy)).toBe(false);

    // run-all over an empty set never calls the LLM and returns a defined,
    // zero-traces run group rather than throwing (AC-20 parity).
    const runAllRes = await app.inject({ method: 'POST', url: `/skills/${skill.id}/eval-runs` });
    expect(runAllRes.statusCode).toBe(200);
    const runAll = runAllRes.json() as { traces_total: number };
    expect(runAll.traces_total).toBe(0);

    await app.close();
  });

  it('full round trip: author case → run all → history → dashboard → single-case run (R-G1-2..5)', async () => {
    const app = await makeApp();
    const skill = await insertSkill('Eval Skill Round-Trip Fixture');

    const authored = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/eval-cases`,
      payload: {
        name: 'Skill round-trip case',
        input_diff: FIXTURE_DIFF,
        expected_output: [{ file: 'src/config.ts', start_line: 10, end_line: 10 }],
      },
    });
    expect(authored.statusCode).toBe(201);
    const authoredCase = authored.json() as { id: string; owner_kind: string; owner_id: string };
    expect(authoredCase.owner_kind).toBe('skill');
    expect(authoredCase.owner_id).toBe(skill.id);

    const listRes = await app.inject({ method: 'GET', url: `/skills/${skill.id}/eval-cases` });
    expect(listRes.statusCode).toBe(200);
    expect((listRes.json() as unknown[]).length).toBeGreaterThanOrEqual(1);

    const runAllRes = await app.inject({ method: 'POST', url: `/skills/${skill.id}/eval-runs` });
    expect(runAllRes.statusCode).toBe(200);
    const group = runAllRes.json() as { run_group_id: string; agent_id: string; agent_version: number | null; recall: number };
    // `agent_id`/`agent_version` are reused fields carrying the SKILL's id/version.
    expect(group.agent_id).toBe(skill.id);
    expect(group.agent_version).toBe(skill.version);
    expect(group.recall).toBe(1);

    const historyRes = await app.inject({ method: 'GET', url: `/skills/${skill.id}/eval-runs` });
    expect(historyRes.statusCode).toBe(200);
    const history = historyRes.json() as { run_group_id: string }[];
    expect(history.some((g) => g.run_group_id === group.run_group_id)).toBe(true);

    const dashboardRes = await app.inject({ method: 'GET', url: `/skills/${skill.id}/eval-dashboard` });
    expect(dashboardRes.statusCode).toBe(200);
    const dashboard = dashboardRes.json() as { cases_total: number; current: { traces_total: number } };
    expect(dashboard.cases_total).toBeGreaterThanOrEqual(1);
    expect(dashboard.current.traces_total).toBeGreaterThanOrEqual(1);

    // A single-case run against a SKILL-owned case no longer throws — the
    // pre-refactor "only agent-owned eval cases can be run" guard is removed.
    const singleRunRes = await app.inject({
      method: 'POST',
      url: `/eval-cases/${authoredCase.id}/eval-runs`,
    });
    expect(singleRunRes.statusCode).toBe(200);
    const singleRun = singleRunRes.json() as { run: { case_id: string; recall: number } };
    expect(singleRun.run.case_id).toBe(authoredCase.id);
    expect(singleRun.run.recall).toBe(1);

    // Update + delete reuse the owner-agnostic routes.
    const updateRes = await app.inject({
      method: 'PUT',
      url: `/eval-cases/${authoredCase.id}`,
      payload: { name: 'Skill round-trip case (renamed)' },
    });
    expect(updateRes.statusCode).toBe(200);

    const deleteRes = await app.inject({ method: 'DELETE', url: `/eval-cases/${authoredCase.id}` });
    expect(deleteRes.statusCode).toBe(200);
    const listAfterDelete = await app.inject({ method: 'GET', url: `/skills/${skill.id}/eval-cases` });
    expect((listAfterDelete.json() as { id: string }[]).some((c) => c.id === authoredCase.id)).toBe(false);

    await app.close();
  });

  it('a DISABLED skill blocks both run-all and single-case runs with 422, but authoring/listing/dashboard stay allowed (security fix — mirrors run-executor.ts enabled filter)', async () => {
    const app = await makeApp();
    const skill = await insertSkill('Eval Skill Disabled Fixture', undefined, false);
    expect(skill.enabled).toBe(false);

    // Authoring a case for a disabled skill is still allowed.
    const authored = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/eval-cases`,
      payload: {
        name: 'Disabled-skill fixture case',
        input_diff: FIXTURE_DIFF,
        expected_output: [{ file: 'src/config.ts', start_line: 10, end_line: 10 }],
      },
    });
    expect(authored.statusCode).toBe(201);
    const authoredCase = authored.json() as { id: string };

    // Listing + dashboard stay allowed for a disabled skill.
    expect((await app.inject({ method: 'GET', url: `/skills/${skill.id}/eval-cases` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/skills/${skill.id}/eval-dashboard` })).statusCode).toBe(200);

    // Both run entry points reject with 422 — the skill's body must never
    // reach the LLM provider before the human-enable step.
    const runAllRes = await app.inject({ method: 'POST', url: `/skills/${skill.id}/eval-runs` });
    expect(runAllRes.statusCode).toBe(422);

    const runSingleRes = await app.inject({
      method: 'POST',
      url: `/eval-cases/${authoredCase.id}/eval-runs`,
    });
    expect(runSingleRes.statusCode).toBe(422);

    await app.close();
  });
});
