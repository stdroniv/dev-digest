import { z } from 'zod';
import type { LLMProvider, ChatMessage } from '@devdigest/shared';
import { wrapUntrusted, INJECTION_GUARD } from '../prompt.js';

/**
 * summarizeFileDiff — pure per-file "What this does" summarizer.
 *
 * Input is deliberately lean: one file's path + its own unified-diff patch.
 * Produces a SINGLE plain-text line describing what the file's change does,
 * for the Smart-Diff view's on-demand per-file summary. The patch is
 * UNTRUSTED repo content — it is delimiter-wrapped via `wrapUntrusted` and
 * the system prompt carries `INJECTION_GUARD`, mirroring every other
 * diff-consuming generator in this package (`classifyIntent`,
 * `generateRiskBrief`, `generateWhyRiskBrief`). The LLM provider and model
 * are injected by the caller (server resolves them via
 * `resolveFeatureModelWithFallback`; tests inject `MockLLMProvider`).
 */

/** Cap the patch so a huge file diff can't blow the token budget. Local to
 * this generator — file patches run larger than PR descriptions/titles. */
export const MAX_FILE_SUMMARY_PATCH_CHARS = 6000;

/** One-field structured-output schema for the summary line. */
const FileSummaryOutput = z.object({ summary: z.string() });
type FileSummaryOutput = z.infer<typeof FileSummaryOutput>;

export interface SummarizeFileDiffInput {
  llm: LLMProvider;
  model: string;
  path: string;
  /** The file's own unified-diff patch (untrusted). */
  patch: string;
}

export interface SummarizeFileDiffResult {
  summary: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

const FILE_SUMMARY_SYSTEM =
  "You are a PR review assistant. Given ONE file's unified-diff patch, produce a single " +
  'plain-text line describing what this file\'s change does — a "What this does" summary ' +
  'for a human reviewer. Rules:\n' +
  '  - Exactly ONE line: no markdown, no bullet points, no line breaks.\n' +
  '  - Roughly 120 characters or fewer.\n' +
  '  - Imperative, present tense (e.g. "Adds retry logic to the webhook handler").\n' +
  '  - Describe the CHANGE shown in the patch, not the whole file.\n\n' +
  INJECTION_GUARD;

export async function summarizeFileDiff(
  input: SummarizeFileDiffInput,
): Promise<SummarizeFileDiffResult> {
  const patch = input.patch.slice(0, MAX_FILE_SUMMARY_PATCH_CHARS);

  const messages: ChatMessage[] = [
    { role: 'system', content: FILE_SUMMARY_SYSTEM },
    { role: 'user', content: `File: ${input.path}\n\n${wrapUntrusted('file-diff', patch)}` },
  ];

  const res = await input.llm.completeStructured<FileSummaryOutput>({
    model: input.model,
    schema: FileSummaryOutput,
    schemaName: 'FileSummary',
    messages,
    maxRetries: 2,
  });

  return {
    summary: res.data.summary,
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
    costUsd: res.costUsd ?? 0,
  };
}
