/**
 * reconcileCiRuns — DB-backed integration tests (SPEC-05 T6).
 *
 * Acceptance:
 *  - a valid artifact ingests into ci_runs + agent_runs(source='ci') EXACTLY
 *    ONCE across two reconcile calls (AC-30/34)
 *  - schema-invalid artifact           ⇒ ci_runs.status='failed' + a note (AC-31)
 *  - missing artifact on a completed run ⇒ 'failed' (AC-32)
 *  - in-progress run                   ⇒ 'running' (AC-32)
 *  - success + CRITICAL                ⇒ 'succeeded', never 'failed' (AC-33)
 *  - a running run that later completes gets exactly ONE agent_runs row on
 *    the transition, never a second one, even after being reconciled again
 *    post-terminal (the T4 unique key covers ci_runs; agent_runs has no such
 *    key, so this exercises CiRepository.upsertCiRun's `justBecameTerminal`
 *    signal directly)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { WorkflowRunMeta } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { loadConfig } from '../../platform/config.js';
import { Container } from '../../platform/container.js';
import { MockGitHubClient } from '../../adapters/mocks.js';
import * as t from '../../db/schema.js';
import { CiService } from './service.js';
import { resolveAgentSlug } from './helpers.js';
import { workflowFileName } from './constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

function runMeta(overrides: Partial<WorkflowRunMeta> = {}): WorkflowRunMeta {
  return {
    id: 'run-1',
    status: 'completed',
    conclusion: 'success',
    headBranch: 'devdigest/ci',
    headSha: 'abc123',
    createdAt: '2026-07-10T00:00:00.000Z',
    htmlUrl: 'https://github.com/acme/recon/actions/runs/1',
    workflowFileName: 'devdigest-review-x.yml',
    ...overrides,
  };
}

function artifactBytes(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}

let seq = 0;

d('reconcileCiRuns — DB-backed (T6)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    const [ws] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'ci-reconcile-test' })
      .returning();
    workspaceId = ws!.id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  async function makeAgentWithInstallation(repo: string, name = `Reconcile Agent ${seq++}`) {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name,
        provider: 'openrouter',
        model: 'anthropic/claude-3.5-sonnet',
        systemPrompt: 'Review this PR.',
        ciFailOn: 'critical',
      })
      .returning();
    const [installation] = await pg.handle.db
      .insert(t.ciInstallations)
      .values({ agentId: agent!.id, repo, targetType: 'gha', workflowVersion: 1 })
      .returning();
    // No other agent has been exported in this workspace, so the slug the
    // service will independently derive is just slugify(name) — reuse the
    // exact same helper (with no exclusions) to build the fixture keys.
    const slug = resolveAgentSlug(agent!.name, []);
    return { agent: agent!, installation: installation!, fileName: workflowFileName(slug) };
  }

  function reconcileWith(github: MockGitHubClient) {
    const container = new Container(config(), pg.handle.db, { github });
    return new CiService(container).reconcile();
  }

  it('ingests the full failure-state matrix in one sweep, and does not double-insert on a second reconcile (AC-30/31/32/33/34)', async () => {
    const { agent, installation, fileName } = await makeAgentWithInstallation('acme/recon-matrix');

    const inProgress = runMeta({ id: 'run-running', status: 'in_progress' });
    const validCritical = runMeta({ id: 'run-valid', status: 'completed' });
    const invalidJson = runMeta({ id: 'run-invalid-json', status: 'completed' });
    const schemaInvalid = runMeta({ id: 'run-schema-invalid', status: 'completed' });
    const missingArtifact = runMeta({ id: 'run-missing', status: 'completed' });

    const github = new MockGitHubClient({
      workflowRuns: {
        [fileName]: [inProgress, validCritical, invalidJson, schemaInvalid, missingArtifact],
      },
      artifactContents: {
        'run-valid:devdigest-result.json': artifactBytes({
          agent: agent.name,
          findings_count: 2,
          critical: 1,
          warning: 1,
          suggestion: 0,
          cost_usd: 0.05,
          duration_ms: 8000,
          pr_number: 501,
        }),
        'run-invalid-json:devdigest-result.json': new TextEncoder().encode('not json at all'),
        'run-schema-invalid:devdigest-result.json': artifactBytes({ agent: agent.name }), // missing findings_count/cost_usd
        // 'run-missing' deliberately has no fixture -> downloadRunArtifact -> null
      },
    });

    const summary1 = await reconcileWith(github);
    expect(summary1.runsSeen).toBe(5);

    const ciRuns = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(eq(t.ciRuns.ciInstallationId, installation.id));
    expect(ciRuns).toHaveLength(5);

    const byActionsId = new Map(ciRuns.map((r) => [r.actionsRunId, r]));
    expect(byActionsId.get('run-running')!.status).toBe('running'); // AC-32
    expect(byActionsId.get('run-valid')!.status).toBe('succeeded'); // AC-33 — CRITICAL present, still succeeded
    expect(byActionsId.get('run-valid')!.findingsCount).toBe(2);
    expect(byActionsId.get('run-valid')!.costUsd).toBe(0.05);
    expect(byActionsId.get('run-invalid-json')!.status).toBe('failed'); // AC-31
    expect(byActionsId.get('run-invalid-json')!.findingsCount).toBeNull();
    expect(byActionsId.get('run-schema-invalid')!.status).toBe('failed'); // AC-31
    expect(byActionsId.get('run-schema-invalid')!.findingsCount).toBeNull();
    expect(byActionsId.get('run-missing')!.status).toBe('failed'); // AC-32
    expect(byActionsId.get('run-missing')!.findingsCount).toBeNull();

    // 4 of the 5 runs are terminal on this very first sweep -> 4 agent_runs(source='ci') rows.
    let agentRuns = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.agentId, agent.id), eq(t.agentRuns.source, 'ci')));
    expect(agentRuns).toHaveLength(4);
    const succeededRow = agentRuns.find((r) => r.status === 'succeeded');
    expect(succeededRow?.blockers).toBe(1); // the CRITICAL trips the critical gate
    expect(succeededRow?.error).toBeNull();
    const failedRows = agentRuns.filter((r) => r.status === 'failed');
    expect(failedRows).toHaveLength(3);
    for (const r of failedRows) {
      expect(r.findingsCount).toBeNull();
      expect(r.costUsd).toBeNull();
      expect(r.error).toBeTruthy(); // a note, not fabricated data
    }

    // A second reconcile of the IDENTICAL fixtures must not create duplicates.
    const summary2 = await reconcileWith(github);
    expect(summary2.runsSeen).toBe(5);

    const ciRunsAfter = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(eq(t.ciRuns.ciInstallationId, installation.id));
    expect(ciRunsAfter).toHaveLength(5); // still 5, upserted in place

    agentRuns = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.agentId, agent.id), eq(t.agentRuns.source, 'ci')));
    expect(agentRuns).toHaveLength(4); // unchanged — no double-insert (AC-30/34)
  });

  it('a running run that later completes gets exactly one agent_runs row on the transition, never two (no double-insert)', async () => {
    const { agent, installation, fileName } = await makeAgentWithInstallation('acme/recon-transition');

    const running = runMeta({ id: 'run-transition', status: 'in_progress' });
    const githubRunning = new MockGitHubClient({ workflowRuns: { [fileName]: [running] } });
    await reconcileWith(githubRunning);

    let ciRuns = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(eq(t.ciRuns.ciInstallationId, installation.id));
    expect(ciRuns).toHaveLength(1);
    expect(ciRuns[0]!.status).toBe('running');

    let agentRuns = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.agentId, agent.id), eq(t.agentRuns.source, 'ci')));
    expect(agentRuns).toHaveLength(0); // nothing to log yet — still in progress

    const completed = runMeta({ id: 'run-transition', status: 'completed' });
    const githubCompleted = new MockGitHubClient({
      workflowRuns: { [fileName]: [completed] },
      artifactContents: {
        'run-transition:devdigest-result.json': artifactBytes({
          agent: agent.name,
          findings_count: 0,
          cost_usd: 0.01,
        }),
      },
    });
    await reconcileWith(githubCompleted);
    await reconcileWith(githubCompleted); // reconcile again post-terminal — must stay a no-op for agent_runs

    ciRuns = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(eq(t.ciRuns.ciInstallationId, installation.id));
    expect(ciRuns).toHaveLength(1); // same row, updated in place
    expect(ciRuns[0]!.status).toBe('no_findings');

    agentRuns = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.agentId, agent.id), eq(t.agentRuns.source, 'ci')));
    expect(agentRuns).toHaveLength(1); // exactly one, written on the running->terminal transition
    expect(agentRuns[0]!.status).toBe('no_findings');
  });

  it('service.listCiRuns / listAgentRuns surface the ingested rows (what T7 routes call)', async () => {
    const { agent, fileName } = await makeAgentWithInstallation('acme/recon-read');
    const run = runMeta({ id: 'run-read' });
    const github = new MockGitHubClient({
      workflowRuns: { [fileName]: [run] },
      artifactContents: {
        'run-read:devdigest-result.json': artifactBytes({
          agent: agent.name,
          findings_count: 1,
          critical: 0,
          warning: 1,
          suggestion: 0,
          duration_ms: 4200,
          cost_usd: 0.02,
          pr_number: 900,
        }),
      },
    });
    const container = new Container(config(), pg.handle.db, { github });
    const service = new CiService(container);
    await service.reconcile();

    const ciRuns = await service.listCiRuns(workspaceId, { agentId: agent.id });
    expect(ciRuns.length).toBeGreaterThanOrEqual(1);
    const row = ciRuns.find((r) => r.actions_run_id === 'run-read')!;
    expect(row.status).toBe('succeeded');
    expect(row.findings_count).toBe(1);
    expect(row.agent).toBe(agent.name);
    // AC-35 fidelity gap closure: a reconciled artifact with per-severity +
    // duration data populates findings_counts/duration_s on the CiRun DTO.
    expect(row.findings_counts).toEqual({ critical: 0, warning: 1, suggestion: 0 });
    expect(row.duration_s).toBe(4.2);
    expect(row.pr_title).toBeTruthy();

    const agentRuns = await service.listAgentRuns(workspaceId, agent.id);
    expect(agentRuns.some((r) => r.source === 'ci')).toBe(true);
  });

  it('a run with no severity/duration data on its artifact still returns null findings_counts/duration_s (AC-35)', async () => {
    const { agent, fileName } = await makeAgentWithInstallation('acme/recon-read-bare');
    const run = runMeta({ id: 'run-read-bare' });
    const github = new MockGitHubClient({
      workflowRuns: { [fileName]: [run] },
      artifactContents: {
        'run-read-bare:devdigest-result.json': artifactBytes({
          agent: agent.name,
          findings_count: 0,
          cost_usd: 0.0,
        }),
      },
    });
    const container = new Container(config(), pg.handle.db, { github });
    const service = new CiService(container);
    await service.reconcile();

    const ciRuns = await service.listCiRuns(workspaceId, { agentId: agent.id });
    const row = ciRuns.find((r) => r.actions_run_id === 'run-read-bare')!;
    expect(row.status).toBe('no_findings');
    expect(row.findings_counts).toBeNull();
    expect(row.duration_s).toBeNull();
  });

  it('one installation throwing (deleted/inaccessible repo — a real GitHub 404/403) is skipped, not fatal to the sweep', async () => {
    const bad = await makeAgentWithInstallation('acme/recon-bad-repo');
    const good = await makeAgentWithInstallation('acme/recon-good-repo');
    const goodRun = runMeta({ id: 'run-good' });

    const github = new MockGitHubClient({
      workflowRuns: { [good.fileName]: [goodRun] },
      artifactContents: {
        'run-good:devdigest-result.json': artifactBytes({
          agent: good.agent.name,
          findings_count: 0,
          cost_usd: 0.01,
        }),
      },
    });
    // Simulate a real octokit 404 for one repo only — the other installation
    // must still reconcile normally in the same sweep.
    const realListWorkflowRuns = github.listWorkflowRuns.bind(github);
    github.listWorkflowRuns = async (repo, opts) => {
      if (repo.name === 'recon-bad-repo') {
        throw new Error(
          'Not Found - https://docs.github.com/rest/actions/workflow-runs#list-workflow-runs-for-a-repository',
        );
      }
      return realListWorkflowRuns(repo, opts);
    };

    const container = new Container(config(), pg.handle.db, { github });
    const summary = await new CiService(container).reconcile();

    expect(summary.installationsFailed).toBeGreaterThanOrEqual(1);
    expect(summary.installationsChecked).toBeGreaterThanOrEqual(2);

    const goodRuns = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(eq(t.ciRuns.ciInstallationId, good.installation.id));
    expect(goodRuns).toHaveLength(1); // healthy installation still ingested despite the other's failure

    const badRuns = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(eq(t.ciRuns.ciInstallationId, bad.installation.id));
    expect(badRuns).toHaveLength(0); // failing installation contributed nothing, but didn't crash the sweep
  });
});
