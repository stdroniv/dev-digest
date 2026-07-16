/**
 * `ci` module routes — DB-backed integration tests (SPEC-05 T7), driven via
 * `app.inject` over a real Postgres with a mocked `GitHubClient` override
 * (container override pattern — mirrors `why-risk-brief-routes.it.test.ts`).
 *
 * Acceptance:
 *  - POST /agents/:id/ci/preview        → 200, the AC-2 file set, zero side effect
 *  - POST /agents/:id/ci/install        → 200 twice, idempotent (AC-17/41)
 *  - a disabled (unresolved) linked skill → 422 naming the skill on BOTH
 *    preview and install (AC-12)
 *  - GET  /agents/:id/ci/bundle.zip     → 200, application/zip, same file set (AC-10)
 *  - GET  /agents/:id/ci/installations  → 200, [] then 1 row post-install (AC-39/40)
 *  - POST /ci/reconcile                 → 200, safe to call twice (AC-30/34)
 *  - GET  /ci-runs                      → 200, ingested rows, honours `source` filter (AC-35/36)
 *  - GET  /agents/:id/runs              → 200, rows carry `source` (AC-42)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { unzipSync } from 'fflate';
import type { CiExport, CiInstallation, CiRun, RunSummary, WorkflowRunMeta } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import { MockGitHubClient } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import { resolveAgentSlug } from './helpers.js';
import { workflowFileName } from './constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let seq = 0;

d('ci module routes (Testcontainers pg)', () => {
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

  async function makeAgent(name = `CI Routes Agent ${seq++}`) {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name,
        provider: 'openrouter',
        model: 'anthropic/claude-3.5-sonnet',
        systemPrompt: 'Review this PR for security issues.',
        ciFailOn: 'critical',
      })
      .returning();
    return agent!;
  }

  async function makeSkill(name: string, enabled: boolean) {
    const [skill] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId,
        name,
        description: 'test skill',
        type: 'custom',
        source: 'manual',
        body: `# ${name}\n`,
        enabled,
      })
      .returning();
    return skill!;
  }

  async function linkSkill(agentId: string, skillId: string, order = 0) {
    await pg.handle.db.insert(t.agentSkills).values({ agentId, skillId, order });
  }

  function makeApp(github: MockGitHubClient = new MockGitHubClient()) {
    return buildApp({ config: config(), db: pg.handle.db, overrides: { github } });
  }

  it('POST /agents/:id/ci/preview returns the AC-2 file set with zero side effect', async () => {
    const agent = await makeAgent();
    const skill = await makeSkill(`Preview Skill ${seq}`, true);
    await linkSkill(agent.id, skill.id);
    const app = await makeApp();

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/ci/preview`,
      payload: { repo: 'acme/preview-repo' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as CiExport;
    const paths = body.files.map((f) => f.path);
    expect(paths).toEqual([
      expect.stringMatching(/^\.devdigest\/agents\/.+\.yaml$/),
      expect.stringMatching(/^\.devdigest\/skills\/.+\.md$/),
      '.devdigest/memory.jsonl',
      '.devdigest/runner.mjs',
      expect.stringMatching(/^\.github\/workflows\/devdigest-review-.+\.yml$/),
    ]);
    expect(body.files.every((f) => f.editable)).toBe(true);
    expect(body.files.find((f) => f.path === '.devdigest/memory.jsonl')?.contents).toBe('');
    expect(body.pr_url).toBeNull();
    expect(body.installation.id).toBe('preview'); // never-installed stub, nothing persisted

    const rows = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agent.id));
    expect(rows).toHaveLength(0); // preview commits nothing (AC-2/3)

    await app.close();
  });

  it('POST /agents/:id/ci/install is idempotent across two calls (AC-17/41)', async () => {
    const agent = await makeAgent();
    const app = await makeApp();
    const payload = { repo: 'acme/install-repo' };

    const before = await app.inject({ method: 'GET', url: `/agents/${agent.id}/ci/installations` });
    expect(before.statusCode).toBe(200);
    expect(before.json() as CiInstallation[]).toEqual([]);

    const first = await app.inject({ method: 'POST', url: `/agents/${agent.id}/ci/install`, payload });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as CiExport;
    expect(firstBody.pr_url).toBeTruthy();
    expect(firstBody.installation.workflow_version).toBe(1);

    const second = await app.inject({ method: 'POST', url: `/agents/${agent.id}/ci/install`, payload });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as CiExport;
    expect(secondBody.installation.id).toBe(firstBody.installation.id);
    expect(secondBody.installation.workflow_version).toBe(2);
    expect(secondBody.pr_url).toBe(firstBody.pr_url); // reused the same open PR

    const rows = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agent.id));
    expect(rows).toHaveLength(1); // never a duplicate row

    const after = await app.inject({ method: 'GET', url: `/agents/${agent.id}/ci/installations` });
    expect(after.statusCode).toBe(200);
    const list = after.json() as CiInstallation[];
    expect(list).toHaveLength(1);
    expect(list[0]!.workflow_version).toBe(2);

    await app.close();
  });

  it('a disabled (unresolved) linked skill blocks preview + install with 422 naming the skill (AC-12)', async () => {
    const agent = await makeAgent();
    const skill = await makeSkill(`Draft Rubric ${seq}`, false); // disabled = unresolved (AC-12)
    await linkSkill(agent.id, skill.id);
    const app = await makeApp();
    const payload = { repo: 'acme/unresolved-repo' };

    const previewRes = await app.inject({ method: 'POST', url: `/agents/${agent.id}/ci/preview`, payload });
    expect(previewRes.statusCode).toBe(422);
    const previewBody = previewRes.json() as { error: { code: string; message: string } };
    expect(previewBody.error.code).toBe('validation_error');
    expect(previewBody.error.message).toContain(skill.name);

    const installRes = await app.inject({ method: 'POST', url: `/agents/${agent.id}/ci/install`, payload });
    expect(installRes.statusCode).toBe(422);
    const installBody = installRes.json() as { error: { message: string } };
    expect(installBody.error.message).toContain(skill.name);

    // Nothing was ever committed/persisted for the blocked install.
    const rows = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agent.id));
    expect(rows).toHaveLength(0);

    await app.close();
  });

  it('GET /agents/:id/ci/bundle.zip returns application/zip with the identical file set (AC-10)', async () => {
    const agent = await makeAgent();
    const skill = await makeSkill(`Zip Skill ${seq}`, true);
    await linkSkill(agent.id, skill.id);
    const app = await makeApp();

    const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/ci/bundle.zip` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toContain('attachment');

    const entries = unzipSync(res.rawPayload);
    const paths = Object.keys(entries);
    expect(paths).toContain('.devdigest/memory.jsonl');
    expect(paths).toContain('.devdigest/runner.mjs');
    expect(paths.some((p) => p.startsWith('.devdigest/agents/'))).toBe(true);
    expect(paths.some((p) => p.startsWith('.devdigest/skills/'))).toBe(true);
    expect(paths.some((p) => p.startsWith('.github/workflows/devdigest-review-'))).toBe(true);

    await app.close();
  });

  it('POST /ci/reconcile ingests runs (safe to call twice); GET /ci-runs + GET /agents/:id/runs surface them, honouring the source filter (AC-30/34/35/36/42)', async () => {
    const agent = await makeAgent();
    const repo = `acme/reconcile-routes-${seq}`;

    // Install first (via a plain mock) so a real ci_installations row + a
    // real workflow filename exist for the fixture Actions run to key off of.
    const installApp = await makeApp();
    const installRes = await installApp.inject({
      method: 'POST',
      url: `/agents/${agent.id}/ci/install`,
      payload: { repo },
    });
    expect(installRes.statusCode).toBe(200);
    await installApp.close();

    const slug = resolveAgentSlug(agent.name, []);
    const fileName = workflowFileName(slug);
    const runId = `run-routes-${seq}`;
    const runMeta: WorkflowRunMeta = {
      id: runId,
      status: 'completed',
      conclusion: 'success',
      headBranch: 'devdigest/ci',
      headSha: 'abc123',
      createdAt: new Date().toISOString(),
      htmlUrl: `https://github.com/${repo}/actions/runs/1`,
      workflowFileName: fileName,
    };
    const reconcileGithub = new MockGitHubClient({
      workflowRuns: { [fileName]: [runMeta] },
      artifactContents: {
        [`${runId}:devdigest-result.json`]: new TextEncoder().encode(
          JSON.stringify({
            agent: agent.name,
            findings_count: 1,
            critical: 1,
            warning: 0,
            suggestion: 0,
            cost_usd: 0.01,
            pr_number: 777,
          }),
        ),
      },
    });
    const app = await makeApp(reconcileGithub);

    const first = await app.inject({ method: 'POST', url: '/ci/reconcile' });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: 'POST', url: '/ci/reconcile' }); // safe to call twice (AC-30/34)
    expect(second.statusCode).toBe(200);

    const runsRes = await app.inject({ method: 'GET', url: `/ci-runs?agent_id=${agent.id}` });
    expect(runsRes.statusCode).toBe(200);
    const runs = runsRes.json() as CiRun[];
    const row = runs.find((r) => r.actions_run_id === runId);
    expect(row).toBeTruthy();
    expect(row!.status).toBe('succeeded'); // AC-33
    expect(row!.findings_count).toBe(1);
    expect(row!.source).toBe('ci');

    // `source` filter (AC-36): `ci` matches, `local` yields nothing — every
    // `ci_runs` row is source='ci' by construction.
    const ciOnly = await app.inject({ method: 'GET', url: `/ci-runs?agent_id=${agent.id}&source=ci` });
    expect((ciOnly.json() as CiRun[]).some((r) => r.actions_run_id === runId)).toBe(true);
    const localOnly = await app.inject({ method: 'GET', url: `/ci-runs?agent_id=${agent.id}&source=local` });
    expect(localOnly.json()).toEqual([]);

    const agentRunsRes = await app.inject({ method: 'GET', url: `/agents/${agent.id}/runs` });
    expect(agentRunsRes.statusCode).toBe(200);
    const agentRuns = agentRunsRes.json() as RunSummary[];
    expect(agentRuns.some((r) => r.source === 'ci')).toBe(true); // AC-42

    await app.close();
  });

  it('GET /ci-runs is scoped to the caller workspace — a run under a DIFFERENT workspace/agent is never returned (security fix)', async () => {
    // Seed a completely separate workspace + agent + installation + ci_run
    // directly, to prove GET /ci-runs (which resolves the DEFAULT workspace
    // via getContext) never leaks another workspace's runs.
    const [otherWorkspace] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `Other Workspace ${seq++}` })
      .returning();
    const [otherAgent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: otherWorkspace!.id,
        name: `Cross-Workspace Agent ${seq}`,
        provider: 'openrouter',
        model: 'anthropic/claude-3.5-sonnet',
        systemPrompt: 'Review this PR for security issues.',
        ciFailOn: 'critical',
      })
      .returning();
    const [otherInstallation] = await pg.handle.db
      .insert(t.ciInstallations)
      .values({
        agentId: otherAgent!.id,
        repo: 'other-workspace/isolated-repo',
        targetType: 'gha',
        workflowVersion: 1,
        installedConfigHash: 'hash',
      })
      .returning();
    const otherRunId = `run-cross-ws-${seq}`;
    await pg.handle.db.insert(t.ciRuns).values({
      ciInstallationId: otherInstallation!.id,
      prNumber: 42,
      ranAt: new Date(),
      status: 'succeeded',
      findingsCount: 0,
      costUsd: 0,
      githubUrl: `https://github.com/other-workspace/isolated-repo/actions/runs/${seq}`,
      source: 'ci',
      actionsRunId: otherRunId,
    });

    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/ci-runs' });
    expect(res.statusCode).toBe(200);
    const runs = res.json() as CiRun[];
    expect(runs.some((r) => r.actions_run_id === otherRunId)).toBe(false);

    await app.close();
  });
});
