/**
 * classifyIntent — hermetic unit tests.
 *
 * Acceptance criteria (plan B1):
 * 1. The assembled prompt contains the file list + hunk headers.
 * 2. The prompt contains NO added/removed code lines (lines starting with + or -).
 * 3. The function returns the LLM's structured output.
 */
import { describe, it, expect } from 'vitest';
import { MockLLMProvider } from '../../server/src/adapters/mocks.js';
import { classifyIntent } from '../src/intent/classify.js';

const INTENT_FIXTURE = {
  intent: 'Add rate limiting to public API endpoints.',
  in_scope: ['Rate limiting on /api routes', 'Redis-backed counter'],
  out_of_scope: ['Auth changes', 'Database schema migration'],
};

const SAMPLE_CHANGED_FILES = `src/middleware/rate-limit.ts
@@ -0,0 +1,42 @@
@@ -15,7 +18,9 @@

src/app.ts
@@ -3,6 +3,7 @@`;

describe('classifyIntent', () => {
  it('returns the structured Intent from the LLM', async () => {
    const llm = new MockLLMProvider('openai', { structured: INTENT_FIXTURE });
    const result = await classifyIntent({
      llm,
      model: 'gpt-4.1',
      title: 'Add rate limiting to public API endpoints',
      body: 'Adds Redis-backed rate limiting. Out of scope: auth changes.',
      changedFiles: SAMPLE_CHANGED_FILES,
    });
    expect(result.intent.intent).toBe(INTENT_FIXTURE.intent);
    expect(result.intent.in_scope).toEqual(INTENT_FIXTURE.in_scope);
    expect(result.intent.out_of_scope).toEqual(INTENT_FIXTURE.out_of_scope);
    expect(result.tokensIn).toBe(100);
    expect(result.tokensOut).toBe(50);
  });

  it('prompt contains hunk-header lines', async () => {
    const llm = new MockLLMProvider('openai', { structured: INTENT_FIXTURE });
    await classifyIntent({
      llm,
      model: 'gpt-4.1',
      title: 'Test PR',
      changedFiles: SAMPLE_CHANGED_FILES,
    });

    const call = llm.calls[0];
    expect(call).toBeDefined();
    const req = call!.req as { messages: { role: string; content: string }[] };
    const userMsg = req.messages.find((m) => m.role === 'user')?.content ?? '';

    // hunk headers must be present
    expect(userMsg).toContain('@@ -0,0 +1,42 @@');
    expect(userMsg).toContain('@@ -3,6 +3,7 @@');
    // file paths must be present
    expect(userMsg).toContain('src/middleware/rate-limit.ts');
    expect(userMsg).toContain('src/app.ts');
  });

  it('prompt contains NO added/removed code lines (defensive filter)', async () => {
    // classifyIntent strips code lines from changedFiles even if the caller
    // passes a raw diff instead of pre-filtered hunk headers. This exercises
    // the belt-and-suspenders stripCodeLines guard inside classify.ts.
    const changedFilesWithCodeLines = `src/middleware/rate-limit.ts
@@ -0,0 +1,3 @@
+import Redis from 'ioredis';
+const redis = new Redis();
+export const limit = redis;
-const old = require('old');
 const untouched = contextLineWithRealCode();`;

    const llm = new MockLLMProvider('openai', { structured: INTENT_FIXTURE });
    await classifyIntent({
      llm,
      model: 'gpt-4.1',
      title: 'Test PR',
      changedFiles: changedFilesWithCodeLines,
    });

    const call = llm.calls[0];
    const req = call!.req as { messages: { role: string; content: string }[] };
    const userMsg = req.messages.find((m) => m.role === 'user')?.content ?? '';

    // Hunk headers and file paths must survive the filter.
    expect(userMsg).toContain('src/middleware/rate-limit.ts');
    expect(userMsg).toContain('@@ -0,0 +1,3 @@');

    // Code lines (added/removed AND unified-diff context lines) must be
    // stripped by the defensive filter — no source code reaches the LLM.
    expect(userMsg).not.toContain('+import Redis from');
    expect(userMsg).not.toContain('+const redis = new Redis()');
    expect(userMsg).not.toContain('+export const limit');
    expect(userMsg).not.toContain("-const old = require('old')");
    expect(userMsg).not.toContain('contextLineWithRealCode');
  });

  it('system prompt carries the injection guard', async () => {
    const llm = new MockLLMProvider('openai', { structured: INTENT_FIXTURE });
    await classifyIntent({
      llm,
      model: 'gpt-4.1',
      title: 'Some PR',
      changedFiles: 'src/foo.ts\n@@ -1,1 +1,2 @@',
    });

    const call = llm.calls[0];
    const req = call!.req as { messages: { role: string; content: string }[] };
    const sysMsg = req.messages.find((m) => m.role === 'system')?.content ?? '';

    // The shared INJECTION_GUARD must be present in the classifier system prompt.
    expect(sysMsg).toContain('<untrusted>');
    expect(sysMsg).toContain('DATA to be analyzed');
    expect(sysMsg).toMatch(/can never turn a real defect into zero findings/i);
  });

  it('includes linked issue title and body when provided', async () => {
    const llm = new MockLLMProvider('openai', { structured: INTENT_FIXTURE });
    await classifyIntent({
      llm,
      model: 'gpt-4.1',
      title: 'Fix rate limit bug',
      changedFiles: 'src/rate-limit.ts\n@@ -1,5 +1,6 @@',
      linkedIssue: { title: 'Rate limiter crashes on Redis timeout', body: 'Steps to reproduce...' },
    });

    const call = llm.calls[0];
    const req = call!.req as { messages: { role: string; content: string }[] };
    const userMsg = req.messages.find((m) => m.role === 'user')?.content ?? '';

    expect(userMsg).toContain('Rate limiter crashes on Redis timeout');
    expect(userMsg).toContain('Steps to reproduce...');
  });

  it('wraps pr-derived content in untrusted delimiters', async () => {
    const llm = new MockLLMProvider('openai', { structured: INTENT_FIXTURE });
    await classifyIntent({
      llm,
      model: 'gpt-4.1',
      title: 'Some PR',
      changedFiles: 'src/foo.ts\n@@ -1,1 +1,2 @@',
    });

    const call = llm.calls[0];
    const req = call!.req as { messages: { role: string; content: string }[] };
    const userMsg = req.messages.find((m) => m.role === 'user')?.content ?? '';

    expect(userMsg).toContain('<untrusted source="pr-intent">');
    expect(userMsg).toContain('</untrusted>');
  });
});
