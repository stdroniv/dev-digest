/**
 * summarizeFileDiff — hermetic unit tests.
 *
 * Acceptance:
 * 1. Exactly ONE completeStructured call.
 * 2. The patch is wrapped via <untrusted source="file-diff">…</untrusted>.
 * 3. Returns the summary line from the fixture, propagating tokens/cost.
 */
import { describe, it, expect } from 'vitest';
import { MockLLMProvider } from '../../../server/src/adapters/mocks.js';
import { summarizeFileDiff, MAX_FILE_SUMMARY_PATCH_CHARS } from './generate.js';

const PATCH =
  '@@ -10,3 +10,4 @@\n   port: 3000,\n+  retries: 3,\n   redisUrl: x,';

function userMessage(llm: MockLLMProvider): string {
  const call = llm.calls.find((c) => c.method === 'completeStructured');
  const req = call!.req as { messages: { role: string; content: string }[] };
  return req.messages.find((m) => m.role === 'user')?.content ?? '';
}

describe('summarizeFileDiff', () => {
  it('makes exactly ONE completeStructured call', async () => {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { FileSummary: { summary: 'Adds a retries config option.' } },
    });
    await summarizeFileDiff({ llm, model: 'gpt-4o-mini', path: 'src/config.ts', patch: PATCH });

    const structuredCalls = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(structuredCalls).toHaveLength(1);
  });

  it('wraps the patch in <untrusted source="file-diff">…</untrusted>', async () => {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { FileSummary: { summary: 'Adds a retries config option.' } },
    });
    await summarizeFileDiff({ llm, model: 'gpt-4o-mini', path: 'src/config.ts', patch: PATCH });

    const userMsg = userMessage(llm);
    expect(userMsg).toContain('<untrusted source="file-diff">');
    expect(userMsg).toContain(`<untrusted source="file-diff">\n${PATCH}`);
    expect(userMsg).toContain('File: src/config.ts');
  });

  it('caps the patch length before wrapping', async () => {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { FileSummary: { summary: 'Adds a lot of lines.' } },
    });
    const hugePatch = 'x'.repeat(MAX_FILE_SUMMARY_PATCH_CHARS + 5000);
    await summarizeFileDiff({ llm, model: 'gpt-4o-mini', path: 'src/big.ts', patch: hugePatch });

    const userMsg = userMessage(llm);
    // The wrapped content must not exceed the cap.
    const wrapped = userMsg.split('<untrusted source="file-diff">\n')[1]?.split('\n</untrusted>')[0];
    expect(wrapped?.length).toBeLessThanOrEqual(MAX_FILE_SUMMARY_PATCH_CHARS);
  });

  it('returns the summary line and propagates tokens/cost from the provider', async () => {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { FileSummary: { summary: 'Adds a retries config option.' } },
    });
    const result = await summarizeFileDiff({
      llm,
      model: 'gpt-4o-mini',
      path: 'src/config.ts',
      patch: PATCH,
    });

    expect(result.summary).toBe('Adds a retries config option.');
    expect(result.tokensIn).toBe(100);
    expect(result.tokensOut).toBe(50);
    expect(result.costUsd).toBe(0.001);
  });
});
