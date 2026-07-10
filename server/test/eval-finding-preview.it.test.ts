import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval-finding-preview.it] Docker not available — skipping.');
}

const FIXTURE_DIFF =
  'diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n@@ -10,0 +10,3 @@\n+  const a = 1;\n+  const b = 2;\n+  const c = 3;';

/**
 * T3 — Gap 2 "Turn into eval case" seeded modal: the non-saving preview route
 * + create-with-edits + idempotency. Mirrors `eval-routes.it.test.ts`'s
 * setup pattern (workspace/review/finding seeding).
 */
d('eval finding preview + create-with-edits (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let prId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'eval-preview-fixture', fullName: 'acme/eval-preview-fixture' })
      .returning();
    repoId = repo!.id;

    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 9201,
        title: 'Eval preview fixture PR',
        author: 'tester',
        branch: 'feat/eval-preview-fixture',
        base: 'main',
        headSha: 'f00dcafe',
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
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient({ diff: FIXTURE_DIFF }), github: new MockGitHubClient() },
    });
  }

  async function createAgent(app: Awaited<ReturnType<typeof makeApp>>, name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name, provider: 'openai', model: 'gpt-4.1', system_prompt: 'Fixture prompt.' },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string };
  }

  async function insertReviewWithFinding(
    app: Awaited<ReturnType<typeof makeApp>>,
    agentId: string,
    decision: 'accepted' | 'dismissed' | 'none',
  ) {
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
    void app;
    return finding!;
  }

  it('preview returns the derived draft for an accepted finding, already_added:false (R-G2-1)', async () => {
    const app = await makeApp();
    const agent = await createAgent(app, 'Eval Preview Accepted Agent');
    const finding = await insertReviewWithFinding(app, agent.id, 'accepted');

    const res = await app.inject({ method: 'GET', url: `/findings/${finding.id}/eval-case/preview` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      name: string;
      input_diff: string;
      expected_output: { file: string; start_line: number; end_line: number }[];
      owner_id: string;
      already_added: boolean;
      existing_case?: unknown;
    };
    expect(body.owner_id).toBe(agent.id);
    expect(body.already_added).toBe(false);
    expect(body.existing_case).toBeUndefined();
    expect(body.expected_output).toEqual([
      expect.objectContaining({ file: 'src/config.ts', start_line: 10, end_line: 10 }),
    ]);
    expect(body.input_diff).toContain('src/config.ts');

    await app.close();
  });

  it('preview for a dismissed finding derives an empty expected_output (must_not_flag)', async () => {
    const app = await makeApp();
    const agent = await createAgent(app, 'Eval Preview Dismissed Agent');
    const finding = await insertReviewWithFinding(app, agent.id, 'dismissed');

    const res = await app.inject({ method: 'GET', url: `/findings/${finding.id}/eval-case/preview` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { expected_output: unknown[]; already_added: boolean };
    expect(body.expected_output).toEqual([]);
    expect(body.already_added).toBe(false);

    await app.close();
  });

  it('preview for a no-decision finding returns 422 (R-G2-5)', async () => {
    const app = await makeApp();
    const agent = await createAgent(app, 'Eval Preview No-Decision Agent');
    const finding = await insertReviewWithFinding(app, agent.id, 'none');

    const res = await app.inject({ method: 'GET', url: `/findings/${finding.id}/eval-case/preview` });
    expect(res.statusCode).toBe(422);

    await app.close();
  });

  it('POST with an edits body creates the case with the edited name/expected_output + the finding link (R-G2-2)', async () => {
    const app = await makeApp();
    const agent = await createAgent(app, 'Eval Preview Create-With-Edits Agent');
    const finding = await insertReviewWithFinding(app, agent.id, 'accepted');

    const createRes = await app.inject({
      method: 'POST',
      url: `/findings/${finding.id}/eval-case`,
      payload: {
        name: 'renamed-by-user',
        expected_output: [
          { file: 'src/config.ts', start_line: 10, end_line: 10, severity: 'WARNING', category: 'bug' },
        ],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json() as {
      case: { id: string; name: string; expected_output: unknown[]; input_meta: { source_finding_id?: string } };
      already_added: boolean;
    };
    expect(created.already_added).toBe(false);
    expect(created.case.name).toBe('renamed-by-user');
    expect(created.case.expected_output).toEqual([
      expect.objectContaining({ severity: 'WARNING', category: 'bug' }),
    ]);
    expect(created.case.input_meta.source_finding_id).toBe(finding.id);

    // A second POST is idempotent — no duplicate, same case id (AC-5).
    const againRes = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case` });
    expect(againRes.statusCode).toBe(200);
    const again = againRes.json() as { case: { id: string }; already_added: boolean };
    expect(again.already_added).toBe(true);
    expect(again.case.id).toBe(created.case.id);

    // The preview now reports already_added + the existing case (R-G2-4).
    const previewRes = await app.inject({ method: 'GET', url: `/findings/${finding.id}/eval-case/preview` });
    expect(previewRes.statusCode).toBe(200);
    const preview = previewRes.json() as { already_added: boolean; existing_case?: { id: string } };
    expect(preview.already_added).toBe(true);
    expect(preview.existing_case?.id).toBe(created.case.id);

    await app.close();
  });

  it('malformed POST body (expected_output not an array) returns 422 (schema-first, AC-19)', async () => {
    const app = await makeApp();
    const agent = await createAgent(app, 'Eval Preview Malformed Body Agent');
    const finding = await insertReviewWithFinding(app, agent.id, 'accepted');

    const res = await app.inject({
      method: 'POST',
      url: `/findings/${finding.id}/eval-case`,
      payload: { expected_output: 'not-an-array' },
    });
    expect(res.statusCode).toBe(422);

    await app.close();
  });
});
