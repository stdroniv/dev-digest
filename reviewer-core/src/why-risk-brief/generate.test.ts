/**
 * generateWhyRiskBrief — hermetic unit tests (SPEC-03 plan T5).
 *
 * Acceptance:
 * 1. Exactly ONE completeStructured call (AC-27).
 * 2. The user message wraps EVERY foreign block in <untrusted…> — intent, blast,
 *    smart-diff, linked issue, AND each context doc (AC-25).
 * 3. No raw +/- diff lines appear in the assembled message (AC-5).
 * 4. Refs absent from the supplied oracles are stripped from the returned brief
 *    (AC-8/10 via groundBriefRefs).
 * 5. Order preservation — the model's risks/review_focus order survives
 *    grounding untouched (AC-6): grounding only ever removes, never re-sorts.
 */
import { describe, it, expect } from 'vitest';
import type { Intent, WhyRiskBrief } from '@devdigest/shared';
import { MockLLMProvider } from '../../../server/src/adapters/mocks.js';
import { generateWhyRiskBrief } from './generate.js';

const INTENT: Intent = {
  intent: 'Add retry logic to the payment webhook handler.',
  in_scope: ['Retry on transient network failures'],
  out_of_scope: ['Auth changes'],
};

// Deliberately non-alphabetical order: 'z-file' before 'a-file' in both risks
// and review_focus, so the test can prove the pipeline never re-sorts.
const FIXTURE: WhyRiskBrief = {
  what: 'Adds retry logic to the payment webhook handler.',
  why: 'Reduces dropped webhook events under transient network failures.',
  risk_level: 'medium',
  risks: [
    {
      description: 'Retry loop touches the hot webhook path.',
      refs: [{ kind: 'file', value: 'src/z-file.ts' }],
    },
    {
      description: 'Retry could double-charge on partial failure; one cited file is fabricated.',
      refs: [
        { kind: 'file', value: 'src/a-file.ts' },
        { kind: 'file', value: 'src/ghost.ts' },
      ],
    },
    {
      description: 'Entirely fabricated risk — every ref is ungrounded.',
      refs: [{ kind: 'file', value: 'src/only-ghost.ts' }],
    },
  ],
  review_focus: [
    { path: 'src/z-file.ts' },
    { path: 'src/ghost.ts' },
    { path: 'src/a-file.ts' },
  ],
};

const BASE_INPUT = {
  llm: undefined as unknown as MockLLMProvider, // set per test
  model: 'gpt-4.1-mini',
  intent: INTENT,
  blastBlock: 'Impacted endpoints:\nPOST /webhooks/payment (high blast radius)',
  smartDiffBlock: 'src/z-file.ts: 40 lines changed (core group)\nsrc/a-file.ts: 5 lines changed',
  linkedIssue: { title: 'Webhook drops events under timeout', body: 'Steps to reproduce...' },
  contextDocs: [
    { path: 'specs/SPEC-03-why-risk-brief.md', content: 'The brief must be grounded.' },
  ],
  changedFiles: ['src/a-file.ts', 'src/z-file.ts'],
  impactedEndpoints: ['POST /webhooks/payment'],
};

function userMessage(llm: MockLLMProvider): string {
  const call = llm.calls.find((c) => c.method === 'completeStructured');
  const req = call!.req as { messages: { role: string; content: string }[] };
  return req.messages.find((m) => m.role === 'user')?.content ?? '';
}

describe('generateWhyRiskBrief', () => {
  it('makes exactly ONE completeStructured call (AC-27)', async () => {
    const llm = new MockLLMProvider('openai', { structuredBySchema: { WhyRiskBrief: FIXTURE } });
    await generateWhyRiskBrief({ ...BASE_INPUT, llm });

    const structuredCalls = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(structuredCalls).toHaveLength(1);
  });

  it('wraps intent, blast, smart-diff, linked issue, and each context doc in <untrusted…> (AC-25)', async () => {
    const llm = new MockLLMProvider('openai', { structuredBySchema: { WhyRiskBrief: FIXTURE } });
    await generateWhyRiskBrief({ ...BASE_INPUT, llm });

    const userMsg = userMessage(llm);

    expect(userMsg).toContain('<untrusted source="pr-intent">');
    expect(userMsg).toContain('<untrusted source="blast">');
    expect(userMsg).toContain('<untrusted source="smart-diff">');
    expect(userMsg).toContain('<untrusted source="linked-issue">');
    expect(userMsg).toContain('<untrusted source="specs/SPEC-03-why-risk-brief.md">');

    // Intent and smart-diff content specifically must be INSIDE their wrapper,
    // not left plain outside it (explicit per-block check, not just presence).
    expect(userMsg).toContain(
      '<untrusted source="pr-intent">\nIntent: Add retry logic to the payment webhook handler.',
    );
    expect(userMsg).toContain('<untrusted source="smart-diff">\nsrc/z-file.ts: 40 lines changed');
  });

  it('assembles no raw +/- diff lines anywhere in the message (AC-5)', async () => {
    const llm = new MockLLMProvider('openai', { structuredBySchema: { WhyRiskBrief: FIXTURE } });
    await generateWhyRiskBrief({ ...BASE_INPUT, llm });

    const userMsg = userMessage(llm);
    // A raw unified-diff body line always starts with a space, '+', or '-'.
    // None of the assembled summary blocks should ever produce such a line.
    for (const line of userMsg.split('\n')) {
      expect(line).not.toMatch(/^[+-]/);
    }
  });

  it('strips refs/items absent from the supplied oracles (AC-8/10 via groundBriefRefs)', async () => {
    const llm = new MockLLMProvider('openai', { structuredBySchema: { WhyRiskBrief: FIXTURE } });
    const result = await generateWhyRiskBrief({ ...BASE_INPUT, llm });

    // Third risk (fully ungrounded) is dropped entirely.
    expect(result.brief.risks).toHaveLength(2);
    // Second risk keeps only its grounded ref (ghost ref removed).
    expect(result.brief.risks[1]?.refs).toEqual([{ kind: 'file', value: 'src/a-file.ts' }]);
    // Ghost review_focus item is dropped.
    expect(result.brief.review_focus).toHaveLength(2);
    expect(result.brief.review_focus.map((f) => f.path)).not.toContain('src/ghost.ts');
  });

  it('preserves the model-returned order — grounding never re-sorts (AC-6)', async () => {
    const llm = new MockLLMProvider('openai', { structuredBySchema: { WhyRiskBrief: FIXTURE } });
    const result = await generateWhyRiskBrief({ ...BASE_INPUT, llm });

    // Fixture order is deliberately z-file before a-file (non-alphabetical) —
    // that exact relative order must survive.
    expect(result.brief.risks.map((r) => r.description)).toEqual([
      'Retry loop touches the hot webhook path.',
      'Retry could double-charge on partial failure; one cited file is fabricated.',
    ]);
    expect(result.brief.review_focus.map((f) => f.path)).toEqual([
      'src/z-file.ts',
      'src/a-file.ts',
    ]);
  });

  it('returns tokens/cost propagated from the provider', async () => {
    const llm = new MockLLMProvider('openai', { structuredBySchema: { WhyRiskBrief: FIXTURE } });
    const result = await generateWhyRiskBrief({ ...BASE_INPUT, llm });

    expect(result.tokensIn).toBe(100);
    expect(result.tokensOut).toBe(50);
    expect(result.costUsd).toBe(0.001);
  });
});
