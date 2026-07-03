import type { LLMProvider, ChatMessage } from '@devdigest/shared';
import { WhyRiskBrief, type Intent } from '@devdigest/shared';
import { wrapUntrusted, INJECTION_GUARD, MAX_PR_DESCRIPTION_CHARS } from '../prompt.js';
import { groundBriefRefs } from './grounding.js';

/**
 * generateWhyRiskBrief — pure single-pass Why+Risk Brief synthesizer (SPEC-03).
 *
 * Input is deliberately lean and PRE-ASSEMBLED by the caller (server): intent,
 * an optional blast-radius summary block, an optional grouped-diff-stats
 * ("smart diff") block, an optional linked-issue title/body, and already-
 * selected Context-doc `{path, content}` pairs. There is NO diff/code input —
 * this is a summary-of-summaries pass (R-AC5). The LLM provider and model are
 * injected by the caller (server resolves them via resolveFeatureModel; tests
 * inject MockLLMProvider).
 *
 * Every foreign (author/repo-derived) block is individually delimiter-wrapped
 * via `wrapUntrusted(label, content)` — including the intent and smart-diff
 * blocks, which sibling generators (`classifyIntent`, `generateRiskBrief`)
 * fold into one outer wrap; this generator wraps each block separately so a
 * caller/test can assert every one of them is fenced (AC-25).
 *
 * After the single `completeStructured` call, the result is passed through
 * `groundBriefRefs` (removal-only) before being returned, so the caller always
 * receives an already-grounded brief (AC-7–10).
 */
export interface GenerateWhyRiskBriefInput {
  llm: LLMProvider;
  model: string;
  intent: Intent;
  /** Pre-assembled blast-radius summary text, or null when blast is unavailable/degraded. */
  blastBlock: string | null;
  /** Pre-assembled grouped-diff-stats ("smart diff") text, or null when unavailable. */
  smartDiffBlock: string | null;
  /** Linked-issue title/body, or null when no issue could be resolved. */
  linkedIssue: { title: string; body?: string | null } | null;
  /** Already-selected (budget-filtered) Context docs, with content read fresh. */
  contextDocs: { path: string; content: string }[];
  /** Oracle: real changed files in this PR — used only for post-hoc grounding. */
  changedFiles: string[];
  /** Oracle: real blast-impacted endpoints — used only for post-hoc grounding. */
  impactedEndpoints: string[];
}

export interface GenerateWhyRiskBriefResult {
  brief: WhyRiskBrief;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

const WHY_RISK_BRIEF_SYSTEM =
  'You are a PR review triage assistant. Synthesize the PR intent, blast-radius summary, ' +
  'grouped diff statistics ("smart diff"), linked issue, and repo Context docs (whichever ' +
  'of these are provided — some may be missing) into ONE glanceable Why+Risk Brief for a ' +
  'human reviewer. You are given summaries only, never a raw diff or code lines — do not ' +
  'invent or reproduce any. Produce:\n' +
  '  what          — one short sentence: what this PR changes\n' +
  '  why           — one short sentence: why (the intent / motivation)\n' +
  '  risk_level    — exactly ONE overall value: low, medium, or high\n' +
  '  risks         — a list of risks; each is a short description plus one-or-more `refs` ' +
  '({kind:"file"|"endpoint", value}) citing a real changed file or blast-impacted endpoint ' +
  'from the material given. Do NOT attach a per-risk severity — `risk_level` is the single ' +
  'overall signal, not a per-risk field.\n' +
  '  review_focus  — a list of {path} entries: the changed files a reviewer should read ' +
  'FIRST, ordered by REVIEWER PRIORITY — files in the PR\'s core change group and files with ' +
  'higher blast impact come first. NEVER order alphabetically or by filename.\n' +
  'Be concise and factual; when an input is missing, produce a partial brief from what is ' +
  'available rather than fabricating the missing signal.\n\n' +
  INJECTION_GUARD;

/** Format Intent as compact prose, mirroring generateRiskBrief's intent formatting. */
function formatIntent(intent: Intent): string {
  const lines: string[] = [`Intent: ${intent.intent}`];
  if (intent.in_scope.length > 0) {
    lines.push(`In scope: ${intent.in_scope.join(', ')}`);
  }
  if (intent.out_of_scope.length > 0) {
    lines.push(`Out of scope: ${intent.out_of_scope.join(', ')}`);
  }
  return lines.join('\n');
}

export async function generateWhyRiskBrief(
  input: GenerateWhyRiskBriefInput,
): Promise<GenerateWhyRiskBriefResult> {
  const parts: string[] = [];

  const intentText = formatIntent(input.intent).slice(0, MAX_PR_DESCRIPTION_CHARS);
  parts.push(`## PR intent\n${wrapUntrusted('pr-intent', intentText)}`);

  if (input.blastBlock?.trim()) {
    parts.push(
      `## Blast-radius summary\n${wrapUntrusted('blast', input.blastBlock.trim().slice(0, MAX_PR_DESCRIPTION_CHARS))}`,
    );
  }

  if (input.smartDiffBlock?.trim()) {
    parts.push(
      `## Grouped diff statistics\n${wrapUntrusted('smart-diff', input.smartDiffBlock.trim().slice(0, MAX_PR_DESCRIPTION_CHARS))}`,
    );
  }

  if (input.linkedIssue) {
    const issueLines: string[] = [`Title: ${input.linkedIssue.title}`];
    if (input.linkedIssue.body?.trim()) {
      issueLines.push(`Body:\n${input.linkedIssue.body.trim()}`);
    }
    const issueText = issueLines.join('\n').slice(0, MAX_PR_DESCRIPTION_CHARS);
    parts.push(`## Linked issue\n${wrapUntrusted('linked-issue', issueText)}`);
  }

  if (input.contextDocs.length > 0) {
    const docsBlock = input.contextDocs
      .map((doc) => wrapUntrusted(doc.path, doc.content.slice(0, MAX_PR_DESCRIPTION_CHARS)))
      .join('\n\n');
    parts.push(`## Context docs\n${docsBlock}`);
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: WHY_RISK_BRIEF_SYSTEM },
    { role: 'user', content: parts.join('\n\n') },
  ];

  const res = await input.llm.completeStructured<WhyRiskBrief>({
    model: input.model,
    schema: WhyRiskBrief,
    schemaName: 'WhyRiskBrief',
    messages,
    maxRetries: 2,
  });

  const grounded = groundBriefRefs(res.data, {
    changedFiles: new Set(input.changedFiles),
    impactedEndpoints: new Set(input.impactedEndpoints),
  });

  return {
    brief: grounded,
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
    costUsd: res.costUsd ?? 0,
  };
}
