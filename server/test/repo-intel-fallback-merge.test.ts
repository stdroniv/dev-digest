/**
 * Hermetic unit tests for `mergeFallbackCallers`.
 *
 * No DB, no Docker — pure function tests.
 */

import { describe, it, expect } from 'vitest';
import { mergeFallbackCallers } from '../src/modules/repo-intel/service.js';
import type { BlastCallerRow } from '../src/modules/repo-intel/types.js';

function caller(
  file: string,
  symbol: string,
  viaSymbol: string,
  rank = 1,
): BlastCallerRow {
  return { file, symbol, viaSymbol, line: 1, rank };
}

describe('mergeFallbackCallers', () => {
  it('returns resolved unchanged when fallback is empty', () => {
    const resolved = [caller('a.ts', 'fn', 'doWork')];
    const result = mergeFallbackCallers(resolved, []);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(resolved[0]);
  });

  it('concatenates disjoint resolved + fallback', () => {
    const resolved = [caller('a.ts', 'fn', 'doWork')];
    const fallback = [caller('b.ts', 'handler', 'getAppCategories')];
    const result = mergeFallbackCallers(resolved, fallback);
    expect(result).toHaveLength(2);
    const files = result.map((r) => r.file);
    expect(files).toContain('a.ts');
    expect(files).toContain('b.ts');
  });

  it('deduplicates an overlapping (file, symbol, viaSymbol) triple, keeping the resolved row', () => {
    const resolvedRow = caller('a.ts', 'fn', 'doWork', 9);
    const fallbackRow = caller('a.ts', 'fn', 'doWork', 3); // same key, different rank
    const result = mergeFallbackCallers([resolvedRow], [fallbackRow]);
    // Only the resolved row survives (first-occurrence wins).
    expect(result).toHaveLength(1);
    expect(result[0]!.rank).toBe(9); // the resolved row's rank
  });

  it('preserves input order (resolved first, then non-duplicate fallback)', () => {
    const r1 = caller('a.ts', 'fn', 'A', 5);
    const r2 = caller('b.ts', 'fn', 'B', 3);
    const f1 = caller('c.ts', 'fn', 'C', 7);
    const f2 = caller('b.ts', 'fn', 'B', 2); // duplicate of r2
    const result = mergeFallbackCallers([r1, r2], [f1, f2]);
    expect(result).toHaveLength(3);
    expect(result[0]!.file).toBe('a.ts');
    expect(result[1]!.file).toBe('b.ts');
    expect(result[2]!.file).toBe('c.ts');
  });

  it('returns empty when both inputs are empty', () => {
    expect(mergeFallbackCallers([], [])).toHaveLength(0);
  });
});
