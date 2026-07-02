/**
 * T9 — run-executor project-context wiring (SPEC-01). Proves the full
 * deterministic slice with a `MockLLMProvider`:
 *   (a) an attached doc's content appears in `prompt_assembly` under a
 *       `## Project context` block labelled by its path (AC-20/21/22)
 *   (b) `trace.specs_read` lists the read path and `trace.documents_read`
 *       carries its token volume + correct origin (AC-25/26/28)
 *   (c) a missing attached path lands in `trace.documents_unavailable` and the
 *       run still completes successfully (AC-24 — never fails the run)
 *   (d) with NOTHING attached to either the agent or its skills,
 *       `trace.prompt_assembly.specs` is null/absent and the assembled prompt
 *       has no `## Project context` section — byte-identical to a pre-feature
 *       run (AC-23/R6 non-regression — the single most load-bearing case here).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[run-executor-documents] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = {
  verdict: 'approve',
  summary: 'Looks fine.',
  score: 100,
  findings: [],
};

let repoSeq = 0;
async function setupRepoAndPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  clonePath: string | null,
) {
  const name = `docs-fixture-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({
      workspaceId,
      owner: 'acme',
      name,
      fullName: `acme/${name}`,
      ...(clonePath ? { clonePath } : {}),
    })
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

d('run-executor: project-context documents (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let clonePath: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    clonePath = await mkdtemp(join(tmpdir(), 'run-executor-documents-'));
    await mkdir(join(clonePath, 'specs'), { recursive: true });
    await writeFile(join(clonePath, 'specs', 'agent-doc.md'), '# Agent invariant\nNever log secrets.');
    await writeFile(join(clonePath, 'specs', 'skill-doc.md'), '# Skill convention\nUse named exports.');
  });
  afterAll(async () => {
    await pg?.stop();
    if (clonePath) await rm(clonePath, { recursive: true, force: true });
  });

  function appWith() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
      },
    });
  }

  it('reads the effective document set from the PR\'s own clone, injects it into the prompt, and records it in the trace', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, clonePath);

    // Agent with one attached doc + one attached-but-missing path (AC-24).
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Doc Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sec' },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/documents`,
      payload: { paths: ['specs/agent-doc.md', 'specs/missing.md'], repo_id: pr.repoId },
    });

    // Enabled skill with its own attached doc, linked to the agent.
    const skill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: {
          name: 'Naming Convention',
          description: 'House naming rules',
          type: 'convention',
          body: 'Use named exports everywhere.',
          enabled: true,
        },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/documents`,
      payload: { paths: ['specs/skill-doc.md'], repo_id: pr.repoId },
    });
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(200);
    const runId = res.json().runs[0].run_id;

    const runs = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    // (c) a missing attached path never fails the run — it completes 'done'.
    expect(runs.find((r) => r.id === runId)?.status).toBe('done');

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();

    // (a) both docs' content appear under a single `## Project context` block,
    // each labelled by its own repo-relative path.
    expect(trace.prompt_assembly.user).toContain('## Project context');
    expect(trace.prompt_assembly.user).toContain('<untrusted source="specs/agent-doc.md">');
    expect(trace.prompt_assembly.user).toContain('Never log secrets.');
    expect(trace.prompt_assembly.user).toContain('<untrusted source="specs/skill-doc.md">');
    expect(trace.prompt_assembly.user).toContain('Use named exports everywhere.');
    expect(trace.prompt_assembly.specs).toContain('specs/agent-doc.md');

    // (b) specs_read lists both read paths; documents_read carries per-doc
    // token volume + correct origin (agent vs skill, with skill_id/skill_name).
    expect(trace.specs_read.sort()).toEqual(['specs/agent-doc.md', 'specs/skill-doc.md'].sort());
    expect(trace.documents_read).toHaveLength(2);
    const agentDocEntry = trace.documents_read.find(
      (d: { path: string }) => d.path === 'specs/agent-doc.md',
    );
    expect(agentDocEntry.origin).toEqual({ type: 'agent' });
    expect(agentDocEntry.tokens).toBeGreaterThan(0);
    const skillDocEntry = trace.documents_read.find(
      (d: { path: string }) => d.path === 'specs/skill-doc.md',
    );
    expect(skillDocEntry.origin).toEqual({
      type: 'skill',
      skill_id: skill.id,
      skill_name: 'Naming Convention',
    });
    expect(skillDocEntry.tokens).toBeGreaterThan(0);
    expect(trace.stats.specs_tokens).toBeGreaterThan(0);

    // (c) the missing path is recorded as unavailable, not as an error.
    expect(trace.documents_unavailable).toEqual(['specs/missing.md']);

    await app.close();
  });

  it('nothing attached → no ## Project context block; prompt is unchanged (AC-23/R6 non-regression)', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, clonePath);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Plain Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sec' },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = res.json().runs[0].run_id;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();

    expect(trace.prompt_assembly.specs).toBeNull();
    expect(trace.prompt_assembly.user).not.toContain('## Project context');
    expect(trace.specs_read).toEqual([]);
    expect(trace.documents_read).toEqual([]);
    expect(trace.documents_unavailable).toEqual([]);
    expect(trace.stats.specs_tokens).toBeNull();

    await app.close();
  });

  it('repo with no clone path: attached docs all land in documents_unavailable, run still completes', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, null);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'No Clone Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sec' },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/documents`,
      payload: { paths: ['specs/agent-doc.md'], repo_id: pr.repoId },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = res.json().runs[0].run_id;
    const runs = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    expect(runs.find((r) => r.id === runId)?.status).toBe('done');

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.documents_unavailable).toEqual(['specs/agent-doc.md']);
    expect(trace.specs_read).toEqual([]);
    expect(trace.prompt_assembly.specs).toBeNull();

    await app.close();
  });

  it('documents attached under a DIFFERENT repo than the reviewed PR never leak into that PR\'s review, and documents_repo_excluded stays empty', async () => {
    const app = await appWith();
    // repoX owns docs attached under IT specifically; repoY (a different
    // repo) owns the PR actually being reviewed. Since `linkedDocuments` is
    // now fetched scoped to the reviewed PR's OWN repo (repoY), repoX's
    // attachment is simply a different, unrelated list — there is no
    // "mismatch" to detect or record any more (that whole exclusion-tracking
    // mechanism, and the `excludedByRepoMismatch`/per-origin exclusion shape,
    // was removed; `documents_repo_excluded` is now always written as `[]`).
    const { repo: repoX } = await setupRepoAndPr(pg.handle.db, workspaceId, clonePath);
    const { pr: prY } = await setupRepoAndPr(pg.handle.db, workspaceId, clonePath);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: 'Cross Repo Agent',
          provider: 'openai',
          model: 'gpt-4.1',
          system_prompt: 'sec',
        },
      })
    ).json();
    // Attach the agent's docs under repoX only.
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/documents`,
      payload: { paths: ['specs/agent-doc.md', 'specs/skill-doc.md'], repo_id: repoX.id },
    });

    // Review a PR that belongs to repoY, not repoX.
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${prY.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(200);
    const runId = res.json().runs[0].run_id;

    const runs = await waitForPrRuns(pg.handle.db, prY.id, { expected: 1 });
    expect(runs.find((r) => r.id === runId)?.status).toBe('done');

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();

    // repoX's docs are simply not part of repoY's effective set — no
    // ## Project context block, nothing read.
    expect(trace.prompt_assembly.specs).toBeNull();
    expect(trace.prompt_assembly.user).not.toContain('## Project context');
    expect(trace.specs_read).toEqual([]);
    expect(trace.documents_read).toEqual([]);

    // `documents_repo_excluded` is always written as `[]` now — a repo
    // mismatch can no longer occur by construction, so there is nothing to
    // record here (this is the field this test exists to guard).
    expect(trace.documents_repo_excluded).toEqual([]);

    // repoX's paths were never even attempted against repoY's clone, so they
    // must NOT appear as "unavailable" either — they were simply never part
    // of the effective set in the first place.
    expect(trace.documents_unavailable).toEqual([]);

    await app.close();
  });

  it("documents are drawn only from the reviewed PR's own repo: repo X's attached docs stay invisible to a repo Y review, while repo Y's own attachment is read normally", async () => {
    const app = await appWith();
    const { repo: repoX } = await setupRepoAndPr(pg.handle.db, workspaceId, clonePath);
    const { repo: repoY, pr: prY } = await setupRepoAndPr(pg.handle.db, workspaceId, clonePath);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: 'Own Repo Only Agent',
          provider: 'openai',
          model: 'gpt-4.1',
          system_prompt: 'sec',
        },
      })
    ).json();

    // Same agent has DIFFERENT docs attached under each repo independently.
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/documents`,
      payload: { paths: ['specs/agent-doc.md'], repo_id: repoX.id },
    });
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/documents`,
      payload: { paths: ['specs/skill-doc.md'], repo_id: repoY.id },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${prY.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = res.json().runs[0].run_id;
    await waitForPrRuns(pg.handle.db, prY.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();

    // Only repoY's own attached doc is read — repoX's stays entirely absent.
    expect(trace.specs_read).toEqual(['specs/skill-doc.md']);
    expect(trace.prompt_assembly.user).toContain('specs/skill-doc.md');
    expect(trace.prompt_assembly.user).not.toContain('specs/agent-doc.md');
    expect(trace.documents_repo_excluded).toEqual([]);

    await app.close();
  });
});
