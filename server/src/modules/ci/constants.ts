import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Shared path/default constants for the `ci` module's bundle generator (T5) —
 * `bundle.ts`, `manifest.ts`, `workflow.ts`, `zip.ts` all read from here so
 * the committed file set (AC-2) and its paths never drift between them.
 */

// Anchor to THIS module's own file location, not `process.cwd()`, so every
// consumer (the API at cwd=server/, a future CLI/MCP caller, tests) resolves
// the SAME absolute path regardless of where the process was started —
// mirrors the `cloneDir` anchoring fix in `platform/config.ts` (server
// INSIGHTS.md "What Works").
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** repo-root/runner/dist/runner.mjs — the T2-committed build this bundle ships as `.devdigest/runner.mjs` (AC-4). */
export const DEFAULT_RUNNER_DIST_PATH = resolve(MODULE_DIR, '../../../../runner/dist/runner.mjs');

export const AGENT_MANIFEST_DIR = '.devdigest/agents';
export const SKILLS_DIR = '.devdigest/skills';
export const MEMORY_FILE_PATH = '.devdigest/memory.jsonl';
export const RUNNER_FILE_PATH = '.devdigest/runner.mjs';
export const WORKFLOWS_DIR = '.github/workflows';

export function manifestFilePath(slug: string): string {
  return `${AGENT_MANIFEST_DIR}/${slug}.yaml`;
}

export function skillFilePath(slug: string): string {
  return `${SKILLS_DIR}/${slug}.md`;
}

/** Repo-relative workflow file NAME (no directory) — the octokit adapter's `listWorkflowRuns` filters on this basename. */
export function workflowFileName(slug: string): string {
  return `devdigest-review-${slug}.yml`;
}

export function workflowFilePath(slug: string): string {
  return `${WORKFLOWS_DIR}/${workflowFileName(slug)}`;
}

/** Default CI triggers (AC-6) — `reopened` is opt-in only, never on by default. */
export const DEFAULT_TRIGGERS = ['opened', 'synchronize'] as const;

export const DEFAULT_POST_AS = 'github_review' as const;

export const DEFAULT_WORKFLOW_VERSION = 1;

// First-party, SHA-pinned `actions/checkout` (v4.2.2) — the ONLY `uses:` line
// the generated workflow may ever emit (AC-4/25/29). It fetches this commit
// so the committed runner (RUNNER_FILE_PATH) is present on disk for the run
// step; the review logic itself ships fully inside that committed file, so
// no other action — first-party or marketplace — is needed.
export const ACTIONS_CHECKOUT_USES = 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2';
