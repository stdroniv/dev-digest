import type { LLMProvider, ChatMessage } from '@devdigest/shared';
import { Intent } from '@devdigest/shared';
import { wrapUntrusted, INJECTION_GUARD, MAX_PR_DESCRIPTION_CHARS } from '../prompt.js';

/**
 * classifyIntent — pure intent classifier.
 *
 * Input is deliberately lean: PR title + body + linked-issue title/body + a
 * list of changed files with ONLY their @@ … @@ hunk-header lines (no diff
 * bodies). The LLM provider and model are injected by the caller (server
 * resolves them via resolveFeatureModel; tests inject MockLLMProvider).
 */
export interface ClassifyIntentInput {
  llm: LLMProvider;
  model: string;
  title: string;
  body?: string | null;
  linkedIssue?: { title: string; body?: string | null } | null;
  /**
   * Compact changed-files block: `path\n@@ … @@\n@@ … @@` per file, files
   * separated by blank lines. Contains ONLY hunk-header lines — never added/
   * removed code lines (those blow the token budget and are not needed for
   * intent classification).
   */
  changedFiles: string;
}

export interface ClassifyIntentResult {
  intent: Intent;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}

const CLASSIFY_SYSTEM =
  'You are a PR intent classifier. Analyse the pull request title, description, ' +
  'linked issue, and changed files (hunk headers only) to derive:\n' +
  '  intent        — a single sentence summarising what this PR sets out to do\n' +
  '  in_scope      — bullet list of concerns/areas the PR explicitly covers\n' +
  '  out_of_scope  — bullet list of concerns/areas the PR deliberately leaves out\n' +
  'Be concise and factual. Focus on the stated purpose, not implementation details. ' +
  'Infer out_of_scope from contrasts in the PR description or obvious gaps.\n\n' +
  INJECTION_GUARD;

/**
 * Defensive filter: keep only the line shapes the caller contract permits —
 * `@@ … @@` hunk headers, bare file-path lines, and blank separators (exactly
 * what the server's buildHunkHeadersBlock emits). Everything else is dropped.
 *
 * This is belt-and-suspenders against a caller passing a raw unified diff by
 * mistake: in unified-diff format EVERY body line begins with a space
 * (context), `+` (added), or `-` (removed), so dropping those three prefixes
 * guarantees no source code — including unchanged *context* lines — can reach
 * the LLM. (The earlier filter dropped only `+`/`-` and leaked context lines.)
 */
function stripCodeLines(block: string): string {
  return block
    .split('\n')
    .filter((line) => !/^[ +-]/.test(line))
    .join('\n');
}

export async function classifyIntent(input: ClassifyIntentInput): Promise<ClassifyIntentResult> {
  const parts: string[] = [];
  parts.push(`PR title: ${input.title.slice(0, MAX_PR_DESCRIPTION_CHARS)}`);
  if (input.body?.trim()) {
    parts.push(`PR body:\n${input.body.trim().slice(0, MAX_PR_DESCRIPTION_CHARS)}`);
  }
  if (input.linkedIssue) {
    parts.push(`Linked issue: ${input.linkedIssue.title.slice(0, MAX_PR_DESCRIPTION_CHARS)}`);
    if (input.linkedIssue.body?.trim()) {
      parts.push(`Linked issue body:\n${input.linkedIssue.body.trim().slice(0, MAX_PR_DESCRIPTION_CHARS)}`);
    }
  }
  parts.push(`Changed files (hunk headers only):\n${stripCodeLines(input.changedFiles)}`);

  const messages: ChatMessage[] = [
    { role: 'system', content: CLASSIFY_SYSTEM },
    { role: 'user', content: wrapUntrusted('pr-intent', parts.join('\n\n')) },
  ];

  const res = await input.llm.completeStructured<Intent>({
    model: input.model,
    schema: Intent,
    schemaName: 'Intent',
    messages,
    maxRetries: 2,
  });

  return { intent: res.data, tokensIn: res.tokensIn, tokensOut: res.tokensOut, costUsd: res.costUsd };
}
