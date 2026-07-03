import { describe, it, expect } from 'vitest';
import type { ProjectDocument } from '@devdigest/shared';
import { selectContextDocs, WHY_RISK_BRIEF_DOC_BUDGET_TOKENS } from './select-docs.js';

const DOCS: ProjectDocument[] = [
  { path: 'specs/SPEC-01-a.md', root: 'specs', tokens: 500 },
  { path: 'specs/SPEC-02-b.md', root: 'specs', tokens: 300 },
  { path: 'docs/architecture.md', root: 'docs', tokens: 400 },
  { path: 'docs/testing.md', root: 'docs', tokens: 100 },
  { path: 'INSIGHTS.md', root: 'insights', tokens: 200 },
  { path: 'client/INSIGHTS.md', root: 'insights', tokens: 250 },
];

/** Deterministic (seeded) Fisher-Yates — different `seed` values yield different
 * permutations of the same array, so re-invoking with several seeds exercises
 * genuinely different input orderings rather than the same order every time. */
function shuffled<T>(arr: T[], seed: number): T[] {
  const copy = [...arr];
  let state = seed;
  for (let i = copy.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const j = state % (i + 1);
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

describe('selectContextDocs', () => {
  it('exports a named budget constant', () => {
    expect(typeof WHY_RISK_BRIEF_DOC_BUDGET_TOKENS).toBe('number');
    expect(WHY_RISK_BRIEF_DOC_BUDGET_TOKENS).toBeGreaterThan(0);
  });

  it('is idempotent on shuffled input — same selection regardless of input order', () => {
    const baseline = selectContextDocs(DOCS, 1000);
    const seeds = [1, 2, 3, 4, 5];

    // sanity check: the seeds actually produce distinct orderings of DOCS
    const orderings = new Set(seeds.map((s) => shuffled(DOCS, s).map((d) => d.path).join(',')));
    expect(orderings.size).toBeGreaterThan(1);

    for (const seed of seeds) {
      const result = selectContextDocs(shuffled(DOCS, seed), 1000);
      expect(result.selected.map((d) => d.path)).toEqual(baseline.selected.map((d) => d.path));
      expect(result.truncated).toBe(baseline.truncated);
    }
  });

  it('orders specs > docs > insights, then tokens ascending, then path ascending', () => {
    // total budget: all six docs = 500+300+400+100+200+250 = 1750
    const result = selectContextDocs(DOCS, 1750);
    expect(result.selected.map((d) => d.path)).toEqual([
      'specs/SPEC-02-b.md', // specs, 300
      'specs/SPEC-01-a.md', // specs, 500
      'docs/testing.md', // docs, 100
      'docs/architecture.md', // docs, 400
      'INSIGHTS.md', // insights, 200
      'client/INSIGHTS.md', // insights, 250
    ]);
    expect(result.truncated).toBe(false);
  });

  it('breaks ties on identical root+tokens by path ascending', () => {
    const docs: ProjectDocument[] = [
      { path: 'docs/z.md', root: 'docs', tokens: 100 },
      { path: 'docs/a.md', root: 'docs', tokens: 100 },
    ];
    const result = selectContextDocs(docs, 1000);
    expect(result.selected.map((d) => d.path)).toEqual(['docs/a.md', 'docs/z.md']);
  });

  it('sets truncated=true and respects the budget when docs exceed it', () => {
    const result = selectContextDocs(DOCS, 900);
    const totalTokens = result.selected.reduce((sum, d) => sum + d.tokens, 0);
    expect(totalTokens).toBeLessThanOrEqual(900);
    expect(result.truncated).toBe(true);
    expect(result.selected.length).toBeLessThan(DOCS.length);
  });

  it('sets truncated=false when everything fits under budget', () => {
    const result = selectContextDocs(DOCS, 10_000);
    expect(result.truncated).toBe(false);
    expect(result.selected).toHaveLength(DOCS.length);
  });

  it('returns an empty, non-truncated selection for an empty doc set', () => {
    const result = selectContextDocs([], 1000);
    expect(result.selected).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});
