import { describe, it, expect } from 'vitest';
import { MockLLMProvider } from '../../server/src/adapters/mocks.js';
import { extractConventions, buildExtractionPrompt } from '../src/index.js';

/**
 * Extractor wiring: the model's structured output flows back as drafts, sampled
 * file contents are delimiter-wrapped (untrusted), and an empty sample set never
 * calls the model.
 */
describe('extractConventions', () => {
  const fixture = {
    conventions: [
      {
        category: 'Data access',
        rule: 'Await db calls',
        evidence: { file: 'src/a.ts', start_line: 2, end_line: 2, snippet: 'await db.find(id)' },
        confidence: 0.9,
      },
    ],
  };

  it('returns the model drafts and calls completeStructured once', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const drafts = await extractConventions({
      llm,
      model: 'gpt-4o-mini',
      samples: [{ path: 'src/a.ts', content: 'const x = await db.find(id)' }],
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.category).toBe('Data access');
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
  });

  it('short-circuits with no samples (no model call)', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const drafts = await extractConventions({ llm, model: 'gpt-4o-mini', samples: [] });
    expect(drafts).toEqual([]);
    expect(llm.calls).toHaveLength(0);
  });

  it('wraps sampled content as untrusted data', () => {
    const messages = buildExtractionPrompt([{ path: 'src/a.ts', content: 'secret instructions here' }]);
    const user = messages.find((m) => m.role === 'user')!.content;
    expect(user).toContain('<untrusted source="src/a.ts">');
    expect(user).toContain('secret instructions here');
  });
});
