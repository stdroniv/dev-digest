import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { generateWorkflow, workflowFile } from './workflow.js';

interface ParsedWorkflow {
  on: { pull_request: { types: string[] } };
  permissions: Record<string, string>;
  jobs: {
    review: {
      steps: Array<{
        name?: string;
        uses?: string;
        run?: string;
        env?: Record<string, string>;
        with?: Record<string, string>;
      }>;
    };
  };
}

function parse(yaml: string): ParsedWorkflow {
  return parseYaml(yaml) as ParsedWorkflow;
}

describe('generateWorkflow', () => {
  it('requests ONLY contents:read + pull-requests:write and nothing else (AC-25)', () => {
    const doc = parse(generateWorkflow({ slug: 'security-reviewer' }));
    expect(doc.permissions).toEqual({ contents: 'read', 'pull-requests': 'write' });
    expect(Object.keys(doc.permissions).sort()).toEqual(['contents', 'pull-requests']);
  });

  it('defaults triggers to opened + synchronize, reopened only when selected (AC-6)', () => {
    const defaults = parse(generateWorkflow({ slug: 'security-reviewer' }));
    expect(defaults.on.pull_request.types).toEqual(['opened', 'synchronize']);

    const withReopened = parse(
      generateWorkflow({ slug: 'security-reviewer', triggers: ['opened', 'synchronize', 'reopened'] }),
    );
    expect(withReopened.on.pull_request.types).toEqual(['opened', 'synchronize', 'reopened']);
  });

  it('uses the pull_request event (never pull_request_target) so forks get no secret (AC-27/28)', () => {
    const yaml = generateWorkflow({ slug: 'security-reviewer' });
    expect(yaml).toContain('pull_request:');
    expect(yaml).not.toContain('pull_request_target');
  });

  it('the ONLY uses: is first-party, SHA-pinned actions/checkout (AC-4/29)', () => {
    const doc = parse(generateWorkflow({ slug: 'security-reviewer' }));
    const usesLines = doc.jobs.review.steps.map((s) => s.uses).filter((u): u is string => !!u);
    expect(usesLines).toHaveLength(1);
    expect(usesLines[0]).toMatch(/^actions\/checkout@[0-9a-f]{40}/);
  });

  it('pins the checkout ref to the PR base sha, never the PR merge commit (security regression)', () => {
    // A pull_request event without `ref:` checks out the PR MERGE commit —
    // which includes the PR author's edits to .devdigest/runner.mjs, and the
    // very next step executes that file with OPENROUTER_API_KEY. Pinning to
    // the base sha guarantees only the trusted base-branch runner ever runs.
    const doc = parse(generateWorkflow({ slug: 'security-reviewer' }));
    const checkoutStep = doc.jobs.review.steps.find((s) => s.uses?.startsWith('actions/checkout@'));
    expect(checkoutStep?.with).toEqual({ ref: '${{ github.event.pull_request.base.sha }}' });
  });

  it('never emits a devdigest/…@v1-style placeholder action', () => {
    const yaml = generateWorkflow({ slug: 'security-reviewer' });
    expect(yaml).not.toMatch(/uses:\s*devdigest\//);
  });

  it('runs the runner with the exact CLI contract and env, no literal secret value (AC-26)', () => {
    const doc = parse(generateWorkflow({ slug: 'security-reviewer', postAs: 'pr_comment' }));
    const runStep = doc.jobs.review.steps.find((s) => s.run);
    expect(runStep?.run).toContain('node .devdigest/runner.mjs --slug=security-reviewer --post-as=pr_comment');
    expect(runStep?.env).toEqual({
      OPENROUTER_API_KEY: '${{ secrets.OPENROUTER_API_KEY }}',
      GITHUB_TOKEN: '${{ github.token }}',
    });
  });

  it('guards the run step on .devdigest/runner.mjs existing, so the export PR that first adds it exits 0 instead of crashing', () => {
    const doc = parse(generateWorkflow({ slug: 'security-reviewer' }));
    const runStep = doc.jobs.review.steps.find((s) => s.run);
    expect(runStep?.run).toContain('if [ ! -f .devdigest/runner.mjs ]; then');
    expect(runStep?.run).toContain('exit 0');
    // The guard must run BEFORE the node invocation, not after.
    const guardIndex = runStep!.run!.indexOf('if [ ! -f .devdigest/runner.mjs ]');
    const nodeIndex = runStep!.run!.indexOf('node .devdigest/runner.mjs');
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(guardIndex).toBeLessThan(nodeIndex);
  });

  it('defaults post-as to github_review', () => {
    const doc = parse(generateWorkflow({ slug: 'security-reviewer' }));
    const runStep = doc.jobs.review.steps.find((s) => s.run);
    expect(runStep?.run).toContain('--post-as=github_review');
  });

  it('drops duplicate/invalid trigger entries and falls back to the default when empty', () => {
    const doc = parse(
      generateWorkflow({
        slug: 'security-reviewer',
        // @ts-expect-error deliberately feeding a bogus entry to prove it's dropped
        triggers: ['opened', 'opened', 'bogus'],
      }),
    );
    expect(doc.on.pull_request.types).toEqual(['opened']);
  });
});

describe('workflowFile', () => {
  it('produces the workflow at .github/workflows/devdigest-review-<slug>.yml, marked editable (AC-2/3/16)', () => {
    const file = workflowFile({ slug: 'security-reviewer' });
    expect(file.path).toBe('.github/workflows/devdigest-review-security-reviewer.yml');
    expect(file.editable).toBe(true);
  });

  it('slug-keys two agents to distinct workflow filenames (AC-16)', () => {
    const a = workflowFile({ slug: 'security-reviewer' });
    const b = workflowFile({ slug: 'style-reviewer' });
    expect(a.path).not.toBe(b.path);
  });
});
