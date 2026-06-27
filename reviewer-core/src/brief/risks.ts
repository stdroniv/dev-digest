import type { LLMProvider, ChatMessage, UnifiedDiff } from '@devdigest/shared';
import { Risks, type Intent } from '@devdigest/shared';
import { wrapUntrusted, INJECTION_GUARD, MAX_PR_DESCRIPTION_CHARS } from '../prompt.js';

/**
 * generateRiskBrief — pure merge-risk assessor.
 *
 * Input: PR title, optional body, optional intent, and a unified diff.
 * The LLM provider and model are injected by the caller (server resolves them
 * via resolveFeatureModel; tests inject MockLLMProvider).
 */
export interface GenerateRiskBriefInput {
  llm: LLMProvider;
  model: string;
  title: string;
  body?: string | null;
  intent?: Intent | null;
  diff: UnifiedDiff;
}

export interface GenerateRiskBriefResult {
  risks: Risks;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}

/** Cap the diff so a huge change can't blow the token budget. */
const MAX_DIFF_CHARS = 12000;

const RISK_SYSTEM =
  'You are a merge-risk assessor. Analyse the pull request title, description, ' +
  'intent/scope (when provided), and the diff to identify risks that could cause ' +
  'regressions, data loss, security incidents, or operational incidents if this PR ' +
  'is merged. Produce a JSON array of risks; each risk has `kind`, `title`, ' +
  '`explanation`, `severity` (high|medium|low), and `file_refs` citing changed ' +
  'files. Be concise and factual; report a real risk regardless of stated scope.\n\n' +
  INJECTION_GUARD;

export async function generateRiskBrief(
  input: GenerateRiskBriefInput,
): Promise<GenerateRiskBriefResult> {
  const parts: string[] = [];
  parts.push(`PR title: ${input.title.slice(0, MAX_PR_DESCRIPTION_CHARS)}`);
  if (input.body?.trim()) {
    parts.push(`PR body:\n${input.body.trim().slice(0, MAX_PR_DESCRIPTION_CHARS)}`);
  }
  if (input.intent) {
    const intentLines: string[] = [`Intent: ${input.intent.intent}`];
    if (input.intent.in_scope.length > 0) {
      intentLines.push(`In scope: ${input.intent.in_scope.join(', ')}`);
    }
    if (input.intent.out_of_scope.length > 0) {
      intentLines.push(`Out of scope: ${input.intent.out_of_scope.join(', ')}`);
    }
    parts.push(intentLines.join('\n'));
  }
  parts.push(`Diff:\n${input.diff.raw.slice(0, MAX_DIFF_CHARS)}`);

  const messages: ChatMessage[] = [
    { role: 'system', content: RISK_SYSTEM },
    { role: 'user', content: wrapUntrusted('pr-risks', parts.join('\n\n')) },
  ];

  const res = await input.llm.completeStructured<Risks>({
    model: input.model,
    schema: Risks,
    schemaName: 'Risks',
    messages,
    maxRetries: 2,
  });

  return {
    risks: res.data,
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
    costUsd: res.costUsd,
  };
}
