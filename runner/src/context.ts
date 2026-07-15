import { readFileSync } from 'node:fs';

/**
 * CLI/env contract for the generated workflow (T5) to drive:
 *
 *   node .devdigest/runner.mjs --slug=<agent-slug> [--manifest=<path>] [--post-as=<github_review|pr_comment|none>]
 *
 * Env (all read-only; NEVER logged):
 *   GITHUB_TOKEN         — CI-provided token (`${{ github.token }}` /
 *                          `${{ secrets.GITHUB_TOKEN }}`), used only for the
 *                          runner's own minimal REST calls (diff/review/comment).
 *   OPENROUTER_API_KEY   — repo secret for the LLM; empty/unset on fork PRs ->
 *                          skip-on-no-credentials (AC-27), checked before this
 *                          module or anything else touches it.
 *   GITHUB_REPOSITORY    — auto-set by Actions ("owner/repo").
 *   GITHUB_EVENT_PATH    — auto-set by Actions; JSON with `pull_request.number`.
 *   GITHUB_API_URL       — auto-set by Actions (GHE support); defaults to
 *                          https://api.github.com.
 *   DEVDIGEST_PR_NUMBER  — optional override (tests / manual runs) that skips
 *                          reading GITHUB_EVENT_PATH.
 *   DEVDIGEST_POST_AS    — optional override for --post-as (CLI flag wins).
 *   DEVDIGEST_RESULT_PATH— optional override for where devdigest-result.json
 *                          is written (default: ./devdigest-result.json).
 *   ACTIONS_RUNTIME_URL / ACTIONS_RUNTIME_TOKEN / GITHUB_RUN_ID — auto-set by
 *                          Actions; used only by artifact.ts's upload step.
 */

export type PostAs = 'github_review' | 'pr_comment' | 'none';

export interface CliArgs {
  slug?: string;
  manifestPath?: string;
  postAs?: PostAs;
}

const VALID_POST_AS: PostAs[] = ['github_review', 'pr_comment', 'none'];

/** Narrow an arbitrary string (CLI flag or env var) to `PostAs`, else `undefined` — never trust either blindly. */
export function parsePostAs(value: string | undefined): PostAs | undefined {
  return value != null && (VALID_POST_AS as string[]).includes(value) ? (value as PostAs) : undefined;
}

/** Parse `--key=value` / `--key value` style flags (no external CLI-parsing dep). */
export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
    if (key === 'slug') out.slug = value;
    else if (key === 'manifest') out.manifestPath = value;
    else if (key === 'post-as') {
      const postAs = parsePostAs(value);
      if (postAs) out.postAs = postAs;
    }
  }
  return out;
}

export interface EventContext {
  repo: { owner: string; name: string };
  prNumber: number;
}

/**
 * Resolve the (repo, PR number) this run is reviewing. Reads
 * `GITHUB_REPOSITORY` + the Actions event payload at `GITHUB_EVENT_PATH`
 * (`pull_request.number`) — the workflow triggers on `pull_request` (never
 * `pull_request_target`), so this is always the PR that fired the event, and
 * fork PRs never carry more than a read-only token here (AC-27/28 posture).
 * `DEVDIGEST_PR_NUMBER` is an explicit override for tests/manual runs.
 */
export function readEventContext(env: NodeJS.ProcessEnv = process.env): EventContext {
  const repoFull = env.GITHUB_REPOSITORY;
  if (!repoFull) {
    throw new Error('GITHUB_REPOSITORY is not set (expected inside a GitHub Actions job)');
  }
  const [owner, name] = repoFull.split('/');
  if (!owner || !name) {
    throw new Error(`GITHUB_REPOSITORY has an unexpected shape: "${repoFull}"`);
  }

  const override = env.DEVDIGEST_PR_NUMBER ? Number(env.DEVDIGEST_PR_NUMBER) : undefined;
  if (override) return { repo: { owner, name }, prNumber: override };

  const eventPath = env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error('GITHUB_EVENT_PATH is not set and DEVDIGEST_PR_NUMBER was not provided');
  }
  const raw = readFileSync(eventPath, 'utf8');
  const event = JSON.parse(raw) as { pull_request?: { number?: number }; number?: number };
  const prNumber = event.pull_request?.number ?? event.number;
  if (!prNumber) {
    throw new Error(`No pull_request.number found in the event payload at ${eventPath}`);
  }
  return { repo: { owner, name }, prNumber };
}
