import { describe, it, expect } from 'vitest';
import { rangesOverlap, matchFinding } from './match.js';
import type { EvalExpectedFinding } from '@devdigest/shared';

describe('rangesOverlap', () => {
  it('true when ranges are identical', () => {
    expect(rangesOverlap([10, 20], [10, 20])).toBe(true);
  });

  it('true when ranges partially overlap', () => {
    expect(rangesOverlap([10, 20], [15, 25])).toBe(true);
  });

  it('true when one range is fully inside the other', () => {
    expect(rangesOverlap([10, 20], [12, 14])).toBe(true);
  });

  it('true when ranges touch at a single line', () => {
    expect(rangesOverlap([10, 20], [20, 30])).toBe(true);
  });

  it('false when ranges are disjoint', () => {
    expect(rangesOverlap([10, 20], [21, 30])).toBe(false);
  });

  it('tolerates a start > end (order-independent)', () => {
    expect(rangesOverlap([20, 10], [5, 12])).toBe(true);
  });
});

const expected = (over: Partial<EvalExpectedFinding> = {}): EvalExpectedFinding => ({
  file: 'src/x.ts',
  start_line: 10,
  end_line: 20,
  ...over,
});

describe('matchFinding', () => {
  it('matches when file (raw) and lines are equal', () => {
    expect(matchFinding(expected(), { file: 'src/x.ts', start_line: 10, end_line: 20 })).toBe(
      true,
    );
  });

  it('matches across a/ vs unprefixed path formatting (normalisation)', () => {
    expect(
      matchFinding(expected({ file: 'a/src/x.ts' }), {
        file: 'src/x.ts',
        start_line: 12,
        end_line: 12,
      }),
    ).toBe(true);
  });

  it('does not match when the file differs', () => {
    expect(
      matchFinding(expected(), { file: 'src/y.ts', start_line: 10, end_line: 20 }),
    ).toBe(false);
  });

  it('does not match when the file is equal but lines do not overlap', () => {
    expect(
      matchFinding(expected(), { file: 'src/x.ts', start_line: 100, end_line: 120 }),
    ).toBe(false);
  });
});
