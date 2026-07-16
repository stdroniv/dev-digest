import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Relative import (not the `@devdigest/shared` alias — this test file lives
// under `test/`, outside runner's own tsconfig `include`, and isn't part of
// the bundle-under-test) straight into the SAME schema the runner bundles
// and the studio's ingest uses, so this is a real independent validation of
// the written artifact, not a self-check against the runner's own copy.
import { CiResultArtifact } from '../../server/src/vendor/shared/contracts/eval-ci.js';

/**
 * Bundle-parse smoke test (T2 acceptance). Deliberately imports the actual
 * COMMITTED `dist/runner.mjs` (not `src/runner.ts`) — esbuild-bundling
 * openai/yaml/zod/@devdigest/reviewer-core/@devdigest/shared into one file
 * can break things source-only tests never exercise (tree-shaking, ESM/CJS
 * interop). Lives under `test/` (excluded from `tsconfig.json`'s `include`,
 * same convention as `reviewer-core/test/` — reviewer-core/INSIGHTS.md) so
 * importing an untyped `.mjs` build output doesn't fail `tsc --noEmit`.
 *
 * Requires `node build.mjs` to have run first (see package.json `pretest`
 * intentionally NOT wired — the plan's acceptance steps run build then test
 * explicitly; keeping them decoupled avoids a surprise rebuild mid-CI).
 *
 * No network, no real keys: GitHub + the LLM are both dependency-injected
 * mocks (`RunnerDeps.createGitHubClient` / `createLlm`), and the
 * `ACTIONS_RUNTIME_URL`/`ACTIONS_RUNTIME_TOKEN` artifact-upload env vars are
 * simply absent, so `uploadResultArtifact` no-ops.
 */

const DIST_PATH = new URL('../dist/runner.mjs', import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let run: (argv: string[], env: NodeJS.ProcessEnv, deps: any) => Promise<number>;

beforeAll(async () => {
  if (!existsSync(new URL('.', DIST_PATH))) {
    throw new Error('dist/runner.mjs is missing — run `node build.mjs` before the test suite.');
  }
  ({ run } = await import(DIST_PATH.href));
});

// A single-file diff whose new-side covers lines 1-3 of src/example.ts — a
// finding anchored at line 2 grounds cleanly against it.
const DIFF = [
  'diff --git a/src/example.ts b/src/example.ts',
  '--- a/src/example.ts',
  '+++ b/src/example.ts',
  '@@ -1,2 +1,3 @@',
  ' line1',
  '+line2',
  ' line3',
  '',
].join('\n');

const CRITICAL_FINDING = {
  id: 'f1',
  severity: 'CRITICAL',
  category: 'security',
  title: 'Hardcoded secret',
  file: 'src/example.ts',
  start_line: 2,
  end_line: 2,
  rationale: 'A secret is hardcoded in the added line.',
  confidence: 0.95,
};

function writeManifestFixture(dir: string, overrides: Record<string, string> = {}): string {
  const path = join(dir, 'agent.yaml');
  const fields: Record<string, string> = {
    name: 'Test Agent',
    slug: 'test-agent',
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
    system_prompt: 'You are a thorough code reviewer.',
    strategy: 'single-pass',
    ci_fail_on: 'critical',
    workflow_version: '1',
    ...overrides,
  };
  const yaml = [
    `name: ${fields.name}`,
    `slug: ${fields.slug}`,
    `provider: ${fields.provider}`,
    `model: ${fields.model}`,
    `system_prompt: "${fields.system_prompt}"`,
    'skills: []',
    `strategy: ${fields.strategy}`,
    `ci_fail_on: ${fields.ci_fail_on}`,
    `workflow_version: ${fields.workflow_version}`,
    '',
  ].join('\n');
  writeFileSync(path, yaml, 'utf8');
  return path;
}

interface GithubCall {
  method: string;
}

function makeGithubMock(diff: string) {
  const calls: GithubCall[] = [];
  const client = {
    async getPullRequestDiff() {
      calls.push({ method: 'getPullRequestDiff' });
      return diff;
    },
    async createReview() {
      calls.push({ method: 'createReview' });
      return { id: 'review-1' };
    },
    async createIssueComment() {
      calls.push({ method: 'createIssueComment' });
      return { id: 'comment-1' };
    },
  };
  return { calls, client };
}

function makeLlmMock(findings: unknown[]) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    id: 'openrouter' as const,
    async listModels() {
      return [];
    },
    async complete() {
      throw new Error('not used by reviewPullRequest');
    },
    async completeStructured() {
      calls++;
      return {
        data: { verdict: 'comment', summary: 'test review', score: 10, findings },
        model: 'deepseek/deepseek-v4-flash',
        tokensIn: 100,
        tokensOut: 50,
        costUsd: 0.01,
        raw: '{}',
        attempts: 1,
      };
    },
    async embed() {
      return [];
    },
  };
}

function baseEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    GITHUB_REPOSITORY: 'acme/widgets',
    DEVDIGEST_PR_NUMBER: '42',
    GITHUB_TOKEN: 'fake-github-token',
    OPENROUTER_API_KEY: 'fake-openrouter-key',
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe('runner (dist bundle) — post-as x fail-on x skip-on-no-creds matrix', () => {
  it('(1) CRITICAL finding + ci_fail_on=critical -> non-zero exit + REQUEST_CHANGES posted', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'devdigest-runner-'));
    const manifestPath = writeManifestFixture(dir, { ci_fail_on: 'critical' });
    const resultPath = join(dir, 'devdigest-result.json');
    const github = makeGithubMock(DIFF);
    const llm = makeLlmMock([CRITICAL_FINDING]);

    const code = await run(
      ['--slug=test-agent', `--manifest=${manifestPath}`],
      baseEnv(),
      {
        createGitHubClient: () => github.client,
        createLlm: () => llm,
        resultPath,
      },
    );

    expect(code).not.toBe(0);
    expect(github.calls.some((c) => c.method === 'createReview')).toBe(true);
    const artifact = JSON.parse(readFileSync(resultPath, 'utf8'));
    expect(artifact.status).toBe('succeeded');
    expect(artifact.critical).toBe(1);
    // devdigest-result.json validates against the SAME shared CiResultArtifact
    // schema the studio's ingest uses (AC-20/31) — an independent check, not
    // just the runner's own internal `CiResultArtifact.parse` call.
    expect(() => CiResultArtifact.parse(artifact)).not.toThrow();
  });

  it('(2) ci_fail_on=never -> exit 0 even with a CRITICAL finding', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'devdigest-runner-'));
    const manifestPath = writeManifestFixture(dir, { ci_fail_on: 'never' });
    const resultPath = join(dir, 'devdigest-result.json');
    const github = makeGithubMock(DIFF);
    const llm = makeLlmMock([CRITICAL_FINDING]);

    const code = await run(
      ['--slug=test-agent', `--manifest=${manifestPath}`],
      baseEnv(),
      {
        createGitHubClient: () => github.client,
        createLlm: () => llm,
        resultPath,
      },
    );

    expect(code).toBe(0);
    const artifact = JSON.parse(readFileSync(resultPath, 'utf8'));
    expect(artifact.critical).toBe(1);
  });

  it('(3) empty OPENROUTER_API_KEY -> exit 0, status skipped_no_credentials, nothing posted, no LLM/GitHub access', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'devdigest-runner-'));
    const manifestPath = writeManifestFixture(dir, { ci_fail_on: 'critical' });
    const resultPath = join(dir, 'devdigest-result.json');
    const github = makeGithubMock(DIFF);
    const llm = makeLlmMock([CRITICAL_FINDING]);
    let githubFactoryCalls = 0;
    let llmFactoryCalls = 0;

    const code = await run(
      ['--slug=test-agent', `--manifest=${manifestPath}`],
      baseEnv({ OPENROUTER_API_KEY: '' }),
      {
        createGitHubClient: () => {
          githubFactoryCalls++;
          return github.client;
        },
        createLlm: () => {
          llmFactoryCalls++;
          return llm;
        },
        resultPath,
      },
    );

    expect(code).toBe(0);
    expect(githubFactoryCalls).toBe(0);
    expect(llmFactoryCalls).toBe(0);
    expect(github.calls.length).toBe(0);
    expect(llm.calls).toBe(0);
    const artifact = JSON.parse(readFileSync(resultPath, 'utf8'));
    expect(artifact.status).toBe('skipped_no_credentials');
    expect(artifact.findings_count).toBe(0);
  });

  it('(4) post-as=none + ci_fail_on=critical -> nothing posted, still non-zero exit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'devdigest-runner-'));
    const manifestPath = writeManifestFixture(dir, { ci_fail_on: 'critical' });
    const resultPath = join(dir, 'devdigest-result.json');
    const github = makeGithubMock(DIFF);
    const llm = makeLlmMock([CRITICAL_FINDING]);

    const code = await run(
      ['--slug=test-agent', `--manifest=${manifestPath}`, '--post-as=none'],
      baseEnv(),
      {
        createGitHubClient: () => github.client,
        createLlm: () => llm,
        resultPath,
      },
    );

    expect(code).not.toBe(0);
    expect(github.calls.some((c) => c.method === 'createReview')).toBe(false);
    expect(github.calls.some((c) => c.method === 'createIssueComment')).toBe(false);
    const artifact = JSON.parse(readFileSync(resultPath, 'utf8'));
    expect(artifact.critical).toBe(1);
  });
});
