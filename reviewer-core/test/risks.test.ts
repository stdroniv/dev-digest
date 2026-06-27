/**
 * generateRiskBrief — hermetic unit tests.
 *
 * Acceptance criteria (plan step 7):
 * 1. Returns the LLM's structured Risks output.
 * 2. The assembled user message is wrapUntrusted-fenced (contains label "pr-risks").
 * 3. The diff text is included (possibly capped).
 * 4. An empty { risks: [] } round-trips correctly.
 */
import { describe, it, expect } from 'vitest';
import { MockLLMProvider } from '../../server/src/adapters/mocks.js';
import { generateRiskBrief } from '../src/brief/risks.js';
import { parseUnifiedDiff } from '../../server/src/adapters/git/diff-parser.js';

const RISKS_FIXTURE = {
  risks: [
    {
      kind: 'regression',
      title: 'Potential regression in auth middleware',
      explanation: 'Changing the middleware order may break existing auth flows.',
      severity: 'high' as const,
      file_refs: ['src/a.ts'],
    },
  ],
};

const EMPTY_RISKS_FIXTURE = { risks: [] };

const SAMPLE_DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 import { foo } from './foo';
+import { bar } from './bar';
 const x = foo();`;

function makeDiff(raw = SAMPLE_DIFF) {
  return parseUnifiedDiff(raw);
}

describe('generateRiskBrief', () => {
  it('returns the structured Risks from the LLM', async () => {
    const llm = new MockLLMProvider('openai', { structured: RISKS_FIXTURE });
    const result = await generateRiskBrief({
      llm,
      model: 'gpt-4.1',
      title: 'Refactor auth middleware',
      body: 'Changes the order of middleware. Closes #10.',
      diff: makeDiff(),
    });
    expect(result.risks.risks).toHaveLength(1);
    expect(result.risks.risks[0]!.kind).toBe('regression');
    expect(result.risks.risks[0]!.severity).toBe('high');
    expect(result.risks.risks[0]!.file_refs).toEqual(['src/a.ts']);
    expect(result.tokensIn).toBe(100);
    expect(result.tokensOut).toBe(50);
  });

  it('user message is wrapped in untrusted delimiters with label "pr-risks"', async () => {
    const llm = new MockLLMProvider('openai', { structured: RISKS_FIXTURE });
    await generateRiskBrief({
      llm,
      model: 'gpt-4.1',
      title: 'Test PR',
      diff: makeDiff(),
    });

    const call = llm.calls[0];
    expect(call).toBeDefined();
    const req = call!.req as { messages: { role: string; content: string }[] };
    const userMsg = req.messages.find((m) => m.role === 'user')?.content ?? '';

    expect(userMsg).toContain('<untrusted source="pr-risks">');
    expect(userMsg).toContain('</untrusted>');
  });

  it('diff text is included in the user message', async () => {
    const llm = new MockLLMProvider('openai', { structured: RISKS_FIXTURE });
    await generateRiskBrief({
      llm,
      model: 'gpt-4.1',
      title: 'Test PR',
      diff: makeDiff(),
    });

    const call = llm.calls[0];
    const req = call!.req as { messages: { role: string; content: string }[] };
    const userMsg = req.messages.find((m) => m.role === 'user')?.content ?? '';

    // The raw diff text should be included (capped at MAX_DIFF_CHARS)
    expect(userMsg).toContain('src/a.ts');
    expect(userMsg).toContain('@@ -1,3 +1,4 @@');
  });

  it('system prompt carries the injection guard', async () => {
    const llm = new MockLLMProvider('openai', { structured: RISKS_FIXTURE });
    await generateRiskBrief({
      llm,
      model: 'gpt-4.1',
      title: 'Some PR',
      diff: makeDiff(),
    });

    const call = llm.calls[0];
    const req = call!.req as { messages: { role: string; content: string }[] };
    const sysMsg = req.messages.find((m) => m.role === 'system')?.content ?? '';

    expect(sysMsg).toContain('DATA to be analyzed');
    expect(sysMsg).toMatch(/can never turn a real defect into zero findings/i);
  });

  it('includes intent summary in user message when provided', async () => {
    const llm = new MockLLMProvider('openai', { structured: RISKS_FIXTURE });
    await generateRiskBrief({
      llm,
      model: 'gpt-4.1',
      title: 'Refactor auth',
      diff: makeDiff(),
      intent: {
        intent: 'Improve authentication flow',
        in_scope: ['auth middleware'],
        out_of_scope: ['database schema'],
      },
    });

    const call = llm.calls[0];
    const req = call!.req as { messages: { role: string; content: string }[] };
    const userMsg = req.messages.find((m) => m.role === 'user')?.content ?? '';

    expect(userMsg).toContain('Improve authentication flow');
    expect(userMsg).toContain('auth middleware');
    expect(userMsg).toContain('database schema');
  });

  it('empty risks fixture round-trips correctly', async () => {
    const llm = new MockLLMProvider('openai', { structured: EMPTY_RISKS_FIXTURE });
    const result = await generateRiskBrief({
      llm,
      model: 'gpt-4.1',
      title: 'Trivial fix',
      diff: makeDiff(),
    });
    expect(result.risks.risks).toHaveLength(0);
    expect(result.tokensIn).toBe(100);
  });

  it('includes PR body in user message when body is non-empty', async () => {
    const llm = new MockLLMProvider('openai', { structured: RISKS_FIXTURE });
    await generateRiskBrief({
      llm,
      model: 'gpt-4.1',
      title: 'Test PR',
      body: 'This refactors the Redis-backed rate limiter.',
      diff: makeDiff(),
    });

    const call = llm.calls[0];
    const req = call!.req as { messages: { role: string; content: string }[] };
    const userMsg = req.messages.find((m) => m.role === 'user')?.content ?? '';

    expect(userMsg).toContain('PR body:');
    expect(userMsg).toContain('This refactors the Redis-backed rate limiter.');
  });

  it('omits PR body from user message when body is null', async () => {
    const llm = new MockLLMProvider('openai', { structured: RISKS_FIXTURE });
    await generateRiskBrief({
      llm,
      model: 'gpt-4.1',
      title: 'Test PR',
      body: null,
      diff: makeDiff(),
    });

    const call = llm.calls[0];
    const req = call!.req as { messages: { role: string; content: string }[] };
    const userMsg = req.messages.find((m) => m.role === 'user')?.content ?? '';

    expect(userMsg).not.toContain('PR body:');
  });

  it('omits PR body from user message when body is whitespace-only', async () => {
    const llm = new MockLLMProvider('openai', { structured: RISKS_FIXTURE });
    await generateRiskBrief({
      llm,
      model: 'gpt-4.1',
      title: 'Test PR',
      body: '   \n  \t  ',
      diff: makeDiff(),
    });

    const call = llm.calls[0];
    const req = call!.req as { messages: { role: string; content: string }[] };
    const userMsg = req.messages.find((m) => m.role === 'user')?.content ?? '';

    expect(userMsg).not.toContain('PR body:');
  });

  it('truncates the diff at MAX_DIFF_CHARS (12 000) for very large diffs', async () => {
    const llm = new MockLLMProvider('openai', { structured: RISKS_FIXTURE });
    // Place a unique marker well past the 12 000-char cap so we can assert it
    // never reaches the LLM message.
    const overflowMarker = 'OVERFLOW_MARKER_BEYOND_CAP';
    const longRaw = SAMPLE_DIFF + 'x'.repeat(13_000) + overflowMarker;
    const bigDiff = { ...makeDiff(), raw: longRaw };

    await generateRiskBrief({
      llm,
      model: 'gpt-4.1',
      title: 'Very large PR',
      diff: bigDiff,
    });

    const call = llm.calls[0];
    const req = call!.req as { messages: { role: string; content: string }[] };
    const userMsg = req.messages.find((m) => m.role === 'user')?.content ?? '';

    // The marker sits beyond position 12 000 — it must have been sliced off.
    expect(userMsg).not.toContain(overflowMarker);
    // The diff section itself must still be present (not completely absent).
    expect(userMsg).toContain('src/a.ts');
  });

  it('omits In scope and Out of scope lines from intent when the arrays are empty', async () => {
    const llm = new MockLLMProvider('openai', { structured: RISKS_FIXTURE });
    await generateRiskBrief({
      llm,
      model: 'gpt-4.1',
      title: 'Test PR',
      diff: makeDiff(),
      intent: {
        intent: 'Refactor internal cache layer',
        in_scope: [],
        out_of_scope: [],
      },
    });

    const call = llm.calls[0];
    const req = call!.req as { messages: { role: string; content: string }[] };
    const userMsg = req.messages.find((m) => m.role === 'user')?.content ?? '';

    // The intent text itself must appear.
    expect(userMsg).toContain('Refactor internal cache layer');
    // Scope lines must be absent because both arrays are empty.
    expect(userMsg).not.toContain('In scope:');
    expect(userMsg).not.toContain('Out of scope:');
  });
});
