import { describe, it, expect } from 'vitest';
import { computeRecall, computePrecision, computeCitationAccuracy } from './metrics.js';
import type { EvalExpectedFinding } from '@devdigest/shared';
import type { ScorableFinding } from './match.js';

const DIFF = [
  'diff --git a/src/x.ts b/src/x.ts',
  '--- a/src/x.ts',
  '+++ b/src/x.ts',
  '@@ -1,3 +1,4 @@',
  ' line1',
  '+line2',
  '+line3',
  ' line4',
  '-oldline',
].join('\n');
// new-side lines covered: 1 (context), 2 (+), 3 (+), 4 (context) → src/x.ts: {1,2,3,4}

const mustFind: EvalExpectedFinding[] = [
  { file: 'src/x.ts', start_line: 2, end_line: 2, severity: 'WARNING', category: 'bug' },
];

describe('computeRecall', () => {
  it('empty expectation set (must_not_flag) is a defined 1, never NaN (AC-20)', () => {
    expect(computeRecall([], [])).toBe(1);
    expect(computeRecall([], [{ file: 'x', start_line: 1, end_line: 1 }])).toBe(1);
  });

  it('1.0 when every expected finding is matched', () => {
    const actual: ScorableFinding[] = [{ file: 'src/x.ts', start_line: 2, end_line: 2 }];
    expect(computeRecall(mustFind, actual)).toBe(1);
  });

  it('0 when no actual findings are produced (a missed must_find)', () => {
    expect(computeRecall(mustFind, [])).toBe(0);
  });

  it('fractional recall across multiple expectations', () => {
    const expected: EvalExpectedFinding[] = [
      { file: 'src/x.ts', start_line: 2, end_line: 2 },
      { file: 'src/y.ts', start_line: 2, end_line: 2 },
    ];
    const actual: ScorableFinding[] = [{ file: 'src/x.ts', start_line: 2, end_line: 2 }];
    expect(computeRecall(expected, actual)).toBe(0.5);
  });

  it('is reproducible: identical inputs always yield the identical value (AC-12)', () => {
    const a = computeRecall(mustFind, [{ file: 'src/x.ts', start_line: 2, end_line: 2 }]);
    const b = computeRecall(mustFind, [{ file: 'src/x.ts', start_line: 2, end_line: 2 }]);
    expect(a).toBe(b);
  });
});

describe('computePrecision', () => {
  it('no actual findings is a defined trivial 1, never NaN (AC-20)', () => {
    expect(computePrecision([], [])).toBe(1);
    expect(computePrecision(mustFind, [])).toBe(1);
  });

  it('a must_not_flag case (expected=[]) — any actual finding is noise, precision drops', () => {
    const actual: ScorableFinding[] = [{ file: 'src/x.ts', start_line: 2, end_line: 2 }];
    expect(computePrecision([], actual)).toBe(0);
  });

  it('a correctly-silent must_not_flag case scores a defined precision (AC-20)', () => {
    expect(computePrecision([], [])).toBe(1);
  });

  it('extra findings on top of a correct match dent precision only (matched extras do not)', () => {
    const actual: ScorableFinding[] = [
      { file: 'src/x.ts', start_line: 2, end_line: 2 }, // matches
      { file: 'src/z.ts', start_line: 9, end_line: 9 }, // noise (no expectation)
    ];
    expect(computePrecision(mustFind, actual)).toBe(0.5);
  });

  it('1.0 when every actual finding matches an expectation', () => {
    const actual: ScorableFinding[] = [{ file: 'src/x.ts', start_line: 2, end_line: 2 }];
    expect(computePrecision(mustFind, actual)).toBe(1);
  });
});

describe('computeCitationAccuracy', () => {
  it('no actual findings is a defined trivial 1, never NaN (AC-20)', () => {
    expect(computeCitationAccuracy([], DIFF)).toBe(1);
  });

  it('empty diff + a produced finding scores 0 (nothing to cite), not NaN (AC-20)', () => {
    const actual: ScorableFinding[] = [{ file: 'src/x.ts', start_line: 2, end_line: 2 }];
    expect(computeCitationAccuracy(actual, '')).toBe(0);
  });

  it('1.0 when the finding cites a real in-diff file:line', () => {
    const actual: ScorableFinding[] = [{ file: 'src/x.ts', start_line: 2, end_line: 2 }];
    expect(computeCitationAccuracy(actual, DIFF)).toBe(1);
  });

  it('matches across a/ vs unprefixed path formatting (normalisation)', () => {
    const actual: ScorableFinding[] = [{ file: 'a/src/x.ts', start_line: 2, end_line: 2 }];
    expect(computeCitationAccuracy(actual, DIFF)).toBe(1);
  });

  it('an out-of-diff citation lowers citation_accuracy (spec edge case)', () => {
    const actual: ScorableFinding[] = [
      { file: 'src/x.ts', start_line: 2, end_line: 2 }, // in-diff
      { file: 'src/x.ts', start_line: 999, end_line: 999 }, // out-of-diff
    ];
    expect(computeCitationAccuracy(actual, DIFF)).toBe(0.5);
  });

  it('a citation for a file never touched by the diff scores 0 for that finding', () => {
    const actual: ScorableFinding[] = [{ file: 'src/unrelated.ts', start_line: 1, end_line: 1 }];
    expect(computeCitationAccuracy(actual, DIFF)).toBe(0);
  });

  it('is reproducible: identical inputs always yield the identical value (AC-12)', () => {
    const actual: ScorableFinding[] = [{ file: 'src/x.ts', start_line: 2, end_line: 2 }];
    expect(computeCitationAccuracy(actual, DIFF)).toBe(computeCitationAccuracy(actual, DIFF));
  });
});
