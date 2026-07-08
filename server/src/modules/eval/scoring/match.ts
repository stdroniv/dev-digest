import type { EvalExpectedFinding } from '@devdigest/shared';
import { normalizePath } from './normalize.js';

/** A finding-shaped location — the fields the match rule actually needs. */
export interface ScorableFinding {
  file: string;
  start_line: number;
  end_line: number;
}

/** Do two inclusive line ranges overlap? Order-tolerant (start may be > end). */
export function rangesOverlap(a: [number, number], b: [number, number]): boolean {
  const aLo = Math.min(a[0], a[1]);
  const aHi = Math.max(a[0], a[1]);
  const bLo = Math.min(b[0], b[1]);
  const bHi = Math.max(b[0], b[1]);
  return aLo <= bHi && bLo <= aHi;
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
