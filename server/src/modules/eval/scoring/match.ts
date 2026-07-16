import type { EvalExpectedFinding } from '@devdigest/shared';
import { normalizePath, rangesOverlap } from '../../_shared/finding-match.js';

export { rangesOverlap };

/** A finding-shaped location — the fields the match rule actually needs. */
export interface ScorableFinding {
  file: string;
  start_line: number;
  end_line: number;
}

/**
 * A finding "matches" an expectation when the `file` is equal (after path
 * normalisation) AND the `[start_line, end_line]` ranges overlap. No text or
 * semantic comparison — this is the single deterministic match rule the
 * whole scorer is built on (spec `Match`).
 */
export function matchFinding(
  expected: EvalExpectedFinding,
  actual: ScorableFinding,
): boolean {
  if (normalizePath(expected.file) !== normalizePath(actual.file)) return false;
  return rangesOverlap(
    [expected.start_line, expected.end_line],
    [actual.start_line, actual.end_line],
  );
}
