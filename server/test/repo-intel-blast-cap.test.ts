/**
 * capCallersPerSymbol — hermetic unit tests (no DB, no Docker).
 *
 * Verifies that the per-symbol caller cap in repo-intel/service.ts keeps at
 * most MAX_CALLERS_PER_SYMBOL (20) callers per `viaSymbol`, while a global
 * `callers.slice(0, 20)` would have truncated across ALL symbols.
 */
import { describe, it, expect } from 'vitest';
import { capCallersPerSymbol } from '../src/modules/repo-intel/service.js';
import type { BlastCallerRow } from '../src/modules/repo-intel/types.js';

/** Build `count` callers for a single `viaSymbol`, with descending ranks. */
function makeCallers(
  viaSymbol: string,
  count: number,
  baseRank = 0,
): BlastCallerRow[] {
  return Array.from({ length: count }, (_, i) => ({
    file: `src/${viaSymbol}/file${i}.ts`,
    symbol: `fn${i}`,
    viaSymbol,
    line: i + 1,
    rank: baseRank + count - i, // descending within this group
  }));
}

describe('capCallersPerSymbol', () => {
  it('22 distinct viaSymbols × 2 callers each → length 44 (old global slice gave 20)', () => {
    const input: BlastCallerRow[] = [];
    for (let s = 0; s < 22; s++) {
      input.push(...makeCallers(`sym${s}`, 2, s * 100));
    }
    // Sort rank-desc as the service does before calling capCallersPerSymbol
    input.sort((a, b) => b.rank - a.rank);

    const result = capCallersPerSymbol(input);

    // 22 symbols × 2 callers each = 44; the old global slice(0,20) returned 20
    expect(result).toHaveLength(44);
  });

  it('one viaSymbol with 25 callers → capped at 20', () => {
    const input = makeCallers('bigSymbol', 25, 0);
    input.sort((a, b) => b.rank - a.rank);

    const result = capCallersPerSymbol(input);

    expect(result).toHaveLength(20);
  });

  it('mixed input preserves rank-desc order within each group', () => {
    // Two symbols with interleaved ranks; cap is well above count so nothing is dropped.
    const input: BlastCallerRow[] = [
      { file: 'a1.ts', symbol: 'fnA1', viaSymbol: 'symA', line: 1, rank: 100 },
      { file: 'b1.ts', symbol: 'fnB1', viaSymbol: 'symB', line: 1, rank: 90 },
      { file: 'a2.ts', symbol: 'fnA2', viaSymbol: 'symA', line: 2, rank: 50 },
      { file: 'b2.ts', symbol: 'fnB2', viaSymbol: 'symB', line: 2, rank: 40 },
      { file: 'a3.ts', symbol: 'fnA3', viaSymbol: 'symA', line: 3, rank: 10 },
    ];
    // Input is already rank-desc (as produced by callers.sort((a, b) => b.rank - a.rank))

    const result = capCallersPerSymbol(input);

    expect(result).toHaveLength(5);

    const aResults = result.filter((c) => c.viaSymbol === 'symA');
    expect(aResults.map((c) => c.rank)).toEqual([100, 50, 10]);

    const bResults = result.filter((c) => c.viaSymbol === 'symB');
    expect(bResults.map((c) => c.rank)).toEqual([90, 40]);
  });

  it('custom cap parameter is respected', () => {
    const input = makeCallers('sym', 10, 0);
    input.sort((a, b) => b.rank - a.rank);

    const result = capCallersPerSymbol(input, 3);

    expect(result).toHaveLength(3);
  });
});
