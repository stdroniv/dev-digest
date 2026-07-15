import { describe, expect, it } from 'vitest';
import type { RepoRef, WorkflowRunMeta } from '@devdigest/shared';
import { MockGitHubClient } from '../../adapters/mocks.js';
import { deriveRunOutcome } from './reconcile.js';

/**
 * Hermetic (no DB) unit tests for `deriveRunOutcome` — the pure-ish
 * per-run failure-state matrix reconcile.ts drives (AC-31/32/33). Uses the
 * real `MockGitHubClient` (its `artifactContents` fixture option) rather
 * than a hand-rolled stub, so these tests exercise the exact `downloadRunArtifact`
 * contract (bytes | null) the real octokit adapter (T3) also implements.
 */

const REPO: RepoRef = { owner: 'acme', name: 'widgets' };

function runMeta(overrides: Partial<WorkflowRunMeta> = {}): WorkflowRunMeta {
  return {
    id: 'run-1',
    status: 'completed',
    conclusion: 'success',
    headBranch: 'devdigest/ci',
    headSha: 'abc123',
    createdAt: '2026-07-10T00:00:00.000Z',
    htmlUrl: 'https://github.com/acme/widgets/actions/runs/1',
    workflowFileName: 'devdigest-review-security-reviewer.yml',
    ...overrides,
  };
}

function artifactBytes(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}

describe('deriveRunOutcome — in-progress (AC-32)', () => {
  it('queued/in_progress runs map to running with no fabricated data', async () => {
    const github = new MockGitHubClient();
    for (const status of ['queued', 'in_progress'] as const) {
      const outcome = await deriveRunOutcome(github, REPO, runMeta({ status }), 'critical');
      expect(outcome).toEqual({
        status: 'running',
        findingsCount: null,
        costUsd: null,
        durationMs: null,
        prNumber: null,
        prTitle: null,
        critical: null,
        warning: null,
        suggestion: null,
        blockers: null,
        note: null,
      });
    }
  });
});

describe('deriveRunOutcome — missing artifact (AC-32)', () => {
  it('a completed run with no artifact is Failed, with no fabricated findings/cost', async () => {
    const github = new MockGitHubClient({ artifactContents: {} }); // no fixture -> null
    const outcome = await deriveRunOutcome(github, REPO, runMeta(), 'critical');
    expect(outcome.status).toBe('failed');
    expect(outcome.findingsCount).toBeNull();
    expect(outcome.costUsd).toBeNull();
    expect(outcome.note).toMatch(/no result artifact/i);
  });
});

describe('deriveRunOutcome — schema-invalid artifact (AC-31)', () => {
  it('present-but-invalid JSON is Failed with a note, no fabrication', async () => {
    const github = new MockGitHubClient({
      artifactContents: { 'run-1:devdigest-result.json': new TextEncoder().encode('not json') },
    });
    const outcome = await deriveRunOutcome(github, REPO, runMeta(), 'critical');
    expect(outcome.status).toBe('failed');
    expect(outcome.findingsCount).toBeNull();
    expect(outcome.costUsd).toBeNull();
    expect(outcome.note).toBeTruthy();
  });

  it('valid JSON that fails the CiResultArtifact schema is Failed with a note, no fabrication', async () => {
    const github = new MockGitHubClient({
      artifactContents: {
        'run-1:devdigest-result.json': artifactBytes({ agent: 'Security Reviewer' }), // missing findings_count/cost_usd
      },
    });
    const outcome = await deriveRunOutcome(github, REPO, runMeta(), 'critical');
    expect(outcome.status).toBe('failed');
    expect(outcome.findingsCount).toBeNull();
    expect(outcome.costUsd).toBeNull();
    expect(outcome.note).toMatch(/schema validation/i);
  });
});

describe('deriveRunOutcome — skipped_no_credentials (AC-27)', () => {
  it('never blocks, regardless of fail-on policy', async () => {
    const github = new MockGitHubClient({
      artifactContents: {
        'run-1:devdigest-result.json': artifactBytes({
          agent: 'Security Reviewer',
          findings_count: 0,
          cost_usd: null,
          status: 'skipped_no_credentials',
        }),
      },
    });
    const outcome = await deriveRunOutcome(github, REPO, runMeta(), 'critical');
    expect(outcome.status).toBe('skipped_no_credentials');
    expect(outcome.blockers).toBe(0);
  });
});

describe('deriveRunOutcome — success + CRITICAL still Succeeded (AC-33)', () => {
  it('a run that executed cleanly and found a CRITICAL is succeeded, not failed', async () => {
    const github = new MockGitHubClient({
      artifactContents: {
        'run-1:devdigest-result.json': artifactBytes({
          agent: 'Security Reviewer',
          findings_count: 2,
          critical: 1,
          warning: 1,
          suggestion: 0,
          cost_usd: 0.042,
          duration_ms: 12000,
          pr_number: 482,
        }),
      },
    });
    const outcome = await deriveRunOutcome(github, REPO, runMeta(), 'critical');
    expect(outcome.status).toBe('succeeded');
    expect(outcome.blockers).toBe(1); // the CRITICAL trips the gate
    expect(outcome.findingsCount).toBe(2);
    expect(outcome.costUsd).toBe(0.042);
    expect(outcome.prNumber).toBe(482);
    // AC-35 fidelity: per-severity + duration are carried through from the artifact.
    expect(outcome.critical).toBe(1);
    expect(outcome.warning).toBe(1);
    expect(outcome.suggestion).toBe(0);
    expect(outcome.durationMs).toBe(12000);
    // Best-effort PR title via GitHub — MockGitHubClient always resolves one.
    expect(outcome.prTitle).toBeTruthy();
  });

  it('a run with no severity data on the artifact carries null critical/warning/suggestion', async () => {
    const github = new MockGitHubClient({
      artifactContents: {
        'run-1:devdigest-result.json': artifactBytes({
          agent: 'Security Reviewer',
          findings_count: 0,
          cost_usd: 0.01,
        }),
      },
    });
    const outcome = await deriveRunOutcome(github, REPO, runMeta(), 'critical');
    expect(outcome.critical).toBeNull();
    expect(outcome.warning).toBeNull();
    expect(outcome.suggestion).toBeNull();
    expect(outcome.durationMs).toBeNull();
  });

  it('zero findings maps to no_findings', async () => {
    const github = new MockGitHubClient({
      artifactContents: {
        'run-1:devdigest-result.json': artifactBytes({
          agent: 'Security Reviewer',
          findings_count: 0,
          cost_usd: 0.01,
        }),
      },
    });
    const outcome = await deriveRunOutcome(github, REPO, runMeta(), 'critical');
    expect(outcome.status).toBe('no_findings');
    expect(outcome.blockers).toBe(0);
  });

  it('a getPullRequest failure degrades pr_title to null rather than failing ingest', async () => {
    const github = new MockGitHubClient({
      artifactContents: {
        'run-1:devdigest-result.json': artifactBytes({
          agent: 'Security Reviewer',
          findings_count: 1,
          critical: 1,
          cost_usd: 0.01,
          pr_number: 482,
        }),
      },
    });
    // Override just this one method to simulate a lookup failure (deleted PR,
    // rate limit, missing token, …) — must not throw out of deriveRunOutcome.
    github.getPullRequest = async () => {
      throw new Error('boom');
    };
    const outcome = await deriveRunOutcome(github, REPO, runMeta(), 'critical');
    expect(outcome.status).toBe('succeeded');
    expect(outcome.prTitle).toBeNull();
  });

  it('"Fail CI on: never" never blocks even with a CRITICAL', async () => {
    const github = new MockGitHubClient({
      artifactContents: {
        'run-1:devdigest-result.json': artifactBytes({
          agent: 'Security Reviewer',
          findings_count: 1,
          critical: 1,
          cost_usd: 0.01,
        }),
      },
    });
    const outcome = await deriveRunOutcome(github, REPO, runMeta(), 'never');
    expect(outcome.status).toBe('succeeded');
    expect(outcome.blockers).toBe(0);
  });
});
