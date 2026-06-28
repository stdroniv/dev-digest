/**
 * blast/summary.service — hermetic unit tests.
 *
 * Tests the BlastSummaryService without a DB or real LLM.
 * A mock BlastService is injected via the optional constructor parameter.
 *
 * Covered:
 *  - No LLM key → skipped:'no_key', summary:null, zero complete() calls.
 *  - With a key: first call invokes complete() once, returns summary, cached:false.
 *  - Second call with same prId+sha → cached:true, still only 1 complete() total.
 *  - No symbols → skipped:'no_data'.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { BlastSummaryService, summaryCache } from './summary.service.js';
import { MockLLMProvider } from '../../adapters/mocks.js';
import type { Container } from '../../platform/container.js';
import type { BlastResponse } from './types.js';

// Clear the module-scope cache between test cases.
afterEach(() => summaryCache.clear());

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_BLAST: BlastResponse = {
  symbols: [
    {
      file: 'src/svc.ts',
      name: 'doWork',
      kind: 'function',
      callers: [{ file: 'src/api.ts', symbol: 'handler', line: 10, rank: 5 }],
      endpoints: ['GET /api/data'],
      crons: [],
    },
  ],
  totals: { symbols: 1, callers: 1, endpoints: 1, crons: 0 },
  impactedEndpoints: ['GET /api/data'],
  impactedCrons: [],
  index: { status: 'full', degraded: false, lastIndexedSha: 'sha-abc123' },
  degraded: false,
};

const EMPTY_BLAST: BlastResponse = {
  symbols: [],
  totals: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
  impactedEndpoints: [],
  impactedCrons: [],
  index: { status: 'degraded', degraded: true, lastIndexedSha: null },
  degraded: true,
  reason: 'no_data',
};

function mockBlastSvc(response: BlastResponse) {
  return { getBlast: vi.fn().mockResolvedValue(response) };
}

// A container where no LLM key is configured (llm() always throws).
const NO_KEY_CONTAINER = {
  llm: async (_id: unknown) => {
    throw new Error('no api key configured');
  },
} as unknown as Container;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BlastSummaryService — no LLM key', () => {
  it('returns skipped:"no_key" and summary:null when no provider is configured', async () => {
    const svc = new BlastSummaryService(NO_KEY_CONTAINER, mockBlastSvc(MOCK_BLAST));
    const result = await svc.getSummary('ws-1', 'pr-no-key-1');
    expect(result.skipped).toBe('no_key');
    expect(result.summary).toBeNull();
    expect(result.cached).toBe(false);
  });

  it('makes zero complete() calls when no provider is configured', async () => {
    const llm = new MockLLMProvider('openai');
    const svc = new BlastSummaryService(NO_KEY_CONTAINER, mockBlastSvc(MOCK_BLAST));
    await svc.getSummary('ws-1', 'pr-no-key-2');
    const completeCalls = llm.calls.filter((c) => c.method === 'complete');
    expect(completeCalls).toHaveLength(0);
  });
});

describe('BlastSummaryService — no symbols', () => {
  it('returns skipped:"no_data" when the blast result has no symbols', async () => {
    const svc = new BlastSummaryService(NO_KEY_CONTAINER, mockBlastSvc(EMPTY_BLAST));
    const result = await svc.getSummary('ws-1', 'pr-empty-1');
    expect(result.skipped).toBe('no_data');
    expect(result.summary).toBeNull();
  });
});

describe('BlastSummaryService — with LLM key', () => {
  const SUMMARY_TEXT = 'Changing doWork could break the public API endpoint.';

  function makeContainer(llm: MockLLMProvider): Container {
    return {
      llm: async (id: unknown) => {
        if (id === 'openai') return llm;
        throw new Error('no key for ' + String(id));
      },
    } as unknown as Container;
  }

  it('returns summary:string and cached:false on the first call', async () => {
    const llm = new MockLLMProvider('openai', { completionText: SUMMARY_TEXT });
    const svc = new BlastSummaryService(makeContainer(llm), mockBlastSvc(MOCK_BLAST));
    const result = await svc.getSummary('ws-1', 'pr-with-key-1');
    expect(result.summary).toBe(SUMMARY_TEXT);
    expect(result.cached).toBe(false);
    expect(result.skipped).toBeUndefined();
  });

  it('invokes complete() exactly once on the first call', async () => {
    const llm = new MockLLMProvider('openai', { completionText: SUMMARY_TEXT });
    const svc = new BlastSummaryService(makeContainer(llm), mockBlastSvc(MOCK_BLAST));
    await svc.getSummary('ws-1', 'pr-with-key-2');
    const completeCalls = llm.calls.filter((c) => c.method === 'complete');
    expect(completeCalls).toHaveLength(1);
  });

  it('returns cached:true on the second call with the same prId+sha', async () => {
    const llm = new MockLLMProvider('openai', { completionText: SUMMARY_TEXT });
    const svc = new BlastSummaryService(makeContainer(llm), mockBlastSvc(MOCK_BLAST));

    const first = await svc.getSummary('ws-1', 'pr-cache-test-1');
    expect(first.cached).toBe(false);

    const second = await svc.getSummary('ws-1', 'pr-cache-test-1');
    expect(second.cached).toBe(true);
    expect(second.summary).toBe(SUMMARY_TEXT);
  });

  it('total complete() calls remains 1 after a cache hit', async () => {
    const llm = new MockLLMProvider('openai', { completionText: SUMMARY_TEXT });
    const svc = new BlastSummaryService(makeContainer(llm), mockBlastSvc(MOCK_BLAST));

    await svc.getSummary('ws-1', 'pr-cache-count-1');
    await svc.getSummary('ws-1', 'pr-cache-count-1');

    const completeCalls = llm.calls.filter((c) => c.method === 'complete');
    expect(completeCalls).toHaveLength(1);
  });

  it('does NOT return a cache hit for a different prId', async () => {
    const llm = new MockLLMProvider('openai', { completionText: SUMMARY_TEXT });
    const svc = new BlastSummaryService(makeContainer(llm), mockBlastSvc(MOCK_BLAST));

    await svc.getSummary('ws-1', 'pr-diff-a');
    const second = await svc.getSummary('ws-1', 'pr-diff-b');

    expect(second.cached).toBe(false);
    const completeCalls = llm.calls.filter((c) => c.method === 'complete');
    expect(completeCalls).toHaveLength(2);
  });
});
