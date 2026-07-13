import { describe, it, expect } from 'vitest';
import { Review } from '@devdigest/shared';
import {
  MockLLMProvider,
  MockGitClient,
  MockGitHubClient,
  MockCodeIndex,
  MockEmbedder,
} from '../src/adapters/mocks.js';
import { assemblePrompt } from '../src/platform/prompt.js';
import { groundFindings } from '../src/platform/grounding.js';
import { estimateCost } from '../src/adapters/llm/pricing.js';

describe('mock adapters (no network)', () => {
  it('MockGitClient.diff parses into hunks with new line numbers', async () => {
    const git = new MockGitClient();
    const diff = await git.diff();
    expect(diff.files[0]!.path).toBe('src/config.ts');
    expect(diff.files[0]!.hunks[0]!.newLineNumbers.length).toBeGreaterThan(0);
  });

  it('MockGitHubClient records posted reviews and opened PRs', async () => {
    const gh = new MockGitHubClient();
    await gh.postReview({ owner: 'a', name: 'b' }, 482, { body: 'x', event: 'COMMENT' });
    expect(gh.posted).toHaveLength(1);
    const { url } = await gh.openPullRequest({ owner: 'a', name: 'b' }, {
      title: 't',
      head: 'h',
      base: 'main',
      body: 'b',
    });
    expect(url).toContain('github.com');
  });

  it('MockCodeIndex + MockEmbedder return deterministic shapes', async () => {
    const ci = new MockCodeIndex();
    expect((await ci.symbols({ owner: 'a', name: 'b' }))[0]!.name).toBe('rateLimit');
    const emb = await new MockEmbedder().embed(['a', 'b']);
    expect(emb[0]!).toHaveLength(1536);
  });
});

describe('MockGitHubClient — CI Actions run + artifact methods (SPEC-05 T3)', () => {
  const repo = { owner: 'acme', name: 'widgets' };

  it('listWorkflowRuns records the call and returns the fixture keyed by workflowFileName', async () => {
    const runs = [
      {
        id: 'run-1',
        status: 'completed' as const,
        conclusion: 'success' as const,
        headBranch: 'feat/x',
        headSha: 'sha1',
        createdAt: '2026-07-01T00:00:00Z',
        htmlUrl: 'https://github.com/acme/widgets/actions/runs/1',
        workflowFileName: 'devdigest-review-security.yml',
      },
    ];
    const gh = new MockGitHubClient({ workflowRuns: { 'devdigest-review-security.yml': runs } });
    const opts = { workflowFileName: 'devdigest-review-security.yml', since: '2026-06-25T00:00:00Z' };

    const result = await gh.listWorkflowRuns(repo, opts);

    expect(result).toEqual(runs);
    expect(gh.listWorkflowRunsCalls).toHaveLength(1);
    expect(gh.listWorkflowRunsCalls[0]).toEqual({ repo, opts });
  });

  it('listWorkflowRuns returns [] for an unconfigured workflow file (no fixture)', async () => {
    const gh = new MockGitHubClient();
    const result = await gh.listWorkflowRuns(repo, { workflowFileName: 'other.yml' });
    expect(result).toEqual([]);
  });

  it('downloadRunArtifact records the call and returns the fixture bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const gh = new MockGitHubClient({
      artifactContents: { 'run-1:devdigest-result.json': bytes },
    });

    const result = await gh.downloadRunArtifact(repo, 'run-1', 'devdigest-result.json');

    expect(result).toBe(bytes);
    expect(gh.downloadRunArtifactCalls).toEqual([
      { repo, runId: 'run-1', name: 'devdigest-result.json' },
    ]);
  });

  it('downloadRunArtifact returns null (not throw) when no artifact is configured (AC-32)', async () => {
    const gh = new MockGitHubClient();
    const result = await gh.downloadRunArtifact(repo, 'run-missing', 'devdigest-result.json');
    expect(result).toBeNull();
    expect(gh.downloadRunArtifactCalls).toEqual([
      { repo, runId: 'run-missing', name: 'devdigest-result.json' },
    ]);
  });
});

describe('structured review pipeline (mock LLM → grounding)', () => {
  it('runs assemble → completeStructured(Review) → groundFindings end-to-end', async () => {
    // a fixture review where one finding is grounded and one is hallucinated
    const fixture = {
      verdict: 'request_changes',
      summary: 'secret key committed',
      score: 38,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key',
          file: 'src/config.ts',
          start_line: 11,
          end_line: 11,
          rationale: 'sk_live in diff',
          confidence: 0.98,
          kind: 'finding',
        },
        {
          id: 'f-hallucinated',
          severity: 'WARNING',
          category: 'bug',
          title: 'phantom finding on a line not in the diff',
          file: 'src/config.ts',
          start_line: 999,
          end_line: 999,
          rationale: 'not real',
          confidence: 0.3,
          kind: 'finding',
        },
      ],
    };
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const git = new MockGitClient();
    const diff = await git.diff();

    const { messages } = assemblePrompt({
      system: 'security reviewer',
      diff: diff.raw,
      task: 'Review PR #482',
    });
    const result = await llm.completeStructured({
      model: 'gpt-4.1',
      schema: Review,
      schemaName: 'Review',
      messages,
    });
    expect(result.data.findings).toHaveLength(2);

    const grounded = groundFindings(result.data.findings, diff);
    expect(grounded.kept).toHaveLength(1); // the real one survives
    expect(grounded.kept[0]!.id).toBe('f1');
    expect(grounded.dropped[0]!.finding.id).toBe('f-hallucinated');
    expect(llm.calls.find((c) => c.method === 'completeStructured')).toBeTruthy();
  });
});

describe('pricing / cost discipline', () => {
  it('estimates cost for known models and returns null for unknown', () => {
    expect(estimateCost('gpt-4o-mini', 1_000_000, 0)).toBeCloseTo(0.15, 5);
    expect(estimateCost('some-future-model', 1000, 1000)).toBeNull();
  });
});
