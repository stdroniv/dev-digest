import { existsSync, readFileSync } from 'node:fs';
import {
  reviewPullRequest,
  OpenRouterProvider,
  gateTriggered,
  countBlockers,
  verdictFromFindings,
  toReviewPayload,
} from '@devdigest/reviewer-core';
import type { CiResultArtifact, CiRunStatus, LLMProvider } from '@devdigest/shared';
import { parseArgs, parsePostAs, readEventContext, type PostAs } from './context.js';
import { loadManifest, ManifestError } from './manifest.js';
import { RunnerGitHubClient, type GitHubReviewPayload, type RepoRef } from './github.js';
import { parseUnifiedDiff } from './diff.js';
import { writeResultArtifact, uploadResultArtifact } from './artifact.js';

/**
 * The CI agent-runner entrypoint (T2). Runs the SAME review engine used
 * locally (`reviewPullRequest`, grounding gate included — AC-18), derives
 * the verdict/exit code from the manifest's `ci_fail_on` via reviewer-core's
 * own gate helpers (AC-21/22/23 — never re-implemented here), posts per
 * "Post results as" (AC-19/24), and writes a `devdigest-result.json`
 * artifact (AC-20). See `context.ts` for the full CLI/env contract.
 */

/** Minimal surface `run()` needs from a GitHub REST client — lets tests inject a mock. */
export interface RunnerGitHub {
  getPullRequestDiff(repo: RepoRef, prNumber: number): Promise<string>;
  createReview(repo: RepoRef, prNumber: number, payload: GitHubReviewPayload): Promise<{ id: string }>;
  createIssueComment(repo: RepoRef, prNumber: number, body: string): Promise<{ id: string }>;
}

export interface RunnerDeps {
  /** Override the GitHub client (tests only — production always uses `RunnerGitHubClient`). */
  createGitHubClient?: (token: string) => RunnerGitHub;
  /** Override the LLM provider (tests only — production always uses `OpenRouterProvider`). */
  createLlm?: (apiKey: string) => LLMProvider;
  /** Override where devdigest-result.json is written (tests only). */
  resultPath?: string;
  /** Injectable clock (tests only). */
  now?: () => number;
}

const DEFAULT_RESULT_PATH = 'devdigest-result.json';

function zeroCounts(): { critical: number; warning: number; suggestion: number } {
  return { critical: 0, warning: 0, suggestion: 0 };
}

/** Resolve linked skill slugs to bodies from `.devdigest/skills/<slug>.md` (committed by the export bundle). Missing files are skipped with a warning, never fatal. */
function resolveSkillBodies(slugs: string[]): string[] {
  const bodies: string[] = [];
  for (const slug of slugs) {
    const path = `.devdigest/skills/${slug}.md`;
    if (!existsSync(path)) {
      console.warn(`[devdigest] linked skill "${slug}" not found at ${path} — skipping`);
      continue;
    }
    bodies.push(readFileSync(path, 'utf8'));
  }
  return bodies;
}

/**
 * Run one CI review. Returns the process exit code (0 = pass/skip, non-zero
 * = the "Fail CI on" gate tripped, AC-22/24) — `main()` below is the only
 * caller that turns this into `process.exit`.
 */
export async function run(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  deps: RunnerDeps = {},
): Promise<number> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const resultPath = deps.resultPath ?? env.DEVDIGEST_RESULT_PATH ?? DEFAULT_RESULT_PATH;

  const args = parseArgs(argv);
  if (!args.slug) {
    console.error('[devdigest] --slug=<agent-slug> is required');
    return 1;
  }

  const manifestPath = args.manifestPath ?? `.devdigest/agents/${args.slug}.yaml`;
  let manifest;
  try {
    manifest = loadManifest(manifestPath);
  } catch (err) {
    if (err instanceof ManifestError) {
      console.error(`[devdigest] ${err.message}`);
      return 1;
    }
    throw err;
  }

  const postAs: PostAs = args.postAs ?? parsePostAs(env.DEVDIGEST_POST_AS) ?? 'github_review';

  const ctx = readEventContext(env);

  // AC-27 — skip-on-no-credentials FIRST: checked before any GitHub API call,
  // before constructing an LLM client, before posting anything. Neither the
  // OPENROUTER_API_KEY value nor GITHUB_TOKEN is read/logged in this branch.
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.log(
      '[devdigest] OPENROUTER_API_KEY unavailable (fork PR or missing repo secret) — skipping review, no credentials.',
    );
    const artifact: CiResultArtifact = {
      findings_count: 0,
      ...zeroCounts(),
      cost_usd: null,
      duration_ms: now() - startedAt,
      agent: manifest.name,
      version: String(manifest.workflow_version),
      pr_number: ctx.prNumber,
      status: 'skipped_no_credentials' satisfies CiRunStatus,
    };
    const json = writeResultArtifact(resultPath, artifact);
    await uploadResultArtifact(json);
    return 0;
  }

  const githubToken = env.GITHUB_TOKEN;
  if (!githubToken) {
    console.error('[devdigest] GITHUB_TOKEN is not set');
    return 1;
  }

  const github = deps.createGitHubClient
    ? deps.createGitHubClient(githubToken)
    : new RunnerGitHubClient(githubToken);
  const llm = deps.createLlm ? deps.createLlm(apiKey) : new OpenRouterProvider(apiKey);

  const diffText = await github.getPullRequestDiff(ctx.repo, ctx.prNumber);
  const diff = parseUnifiedDiff(diffText);
  const skills = resolveSkillBodies(manifest.skills);

  const outcome = await reviewPullRequest({
    systemPrompt: manifest.system_prompt,
    model: manifest.model,
    diff,
    skills,
    strategy: manifest.strategy,
    llm,
  });

  const findings = outcome.review.findings;
  const failOn = manifest.ci_fail_on;
  // Deterministic gate + verdict — reused from reviewer-core, never re-derived
  // here (AC-21/22/23).
  const triggered = gateTriggered(findings, failOn);
  const blockers = countBlockers(findings, failOn);
  const verdict = verdictFromFindings(findings, failOn);
  console.log(
    `[devdigest] ${findings.length} finding(s), ${blockers} blocker(s) at fail_on="${failOn}", verdict=${verdict}`,
  );

  const payload = toReviewPayload(outcome.review, {
    failOn,
    diff,
    title: `DevDigest — ${manifest.name}`,
  });

  // AC-19/24 — post per "Post results as"; "none" posts NOTHING regardless
  // of the gate outcome (the exit code alone still carries the block).
  if (postAs === 'github_review') {
    await github.createReview(ctx.repo, ctx.prNumber, payload);
  } else if (postAs === 'pr_comment') {
    await github.createIssueComment(ctx.repo, ctx.prNumber, payload.body);
  }

  const counts = zeroCounts();
  for (const f of findings) {
    if (f.severity === 'CRITICAL') counts.critical++;
    else if (f.severity === 'WARNING') counts.warning++;
    else counts.suggestion++;
  }
  const status: CiRunStatus = findings.length === 0 ? 'no_findings' : 'succeeded';

  const artifact: CiResultArtifact = {
    findings_count: findings.length,
    ...counts,
    cost_usd: outcome.costUsd,
    duration_ms: now() - startedAt,
    agent: manifest.name,
    version: String(manifest.workflow_version),
    pr_number: ctx.prNumber,
    status,
  };
  const json = writeResultArtifact(resultPath, artifact);
  await uploadResultArtifact(json);

  // AC-22/23/24 — the ONLY thing deciding the exit code is the deterministic
  // gate (never post success/failure, never findings_count alone).
  return triggered ? 1 : 0;
}

// Only auto-run + `process.exit` when invoked as the actual entrypoint (real
// `node .devdigest/runner.mjs …` or `node dist/runner.mjs …`) — importing
// `run` from a test (including importing the built `dist/runner.mjs`) must
// never trigger this.
if (import.meta.url === `file://${process.argv[1]}`) {
  run()
    .then((code) => process.exit(code))
    .catch((err) => {
      // A genuine crash writes NO artifact — the studio's reconcile treats a
      // missing artifact as Failed (AC-32); we don't fabricate one here.
      console.error('[devdigest] runner crashed:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
