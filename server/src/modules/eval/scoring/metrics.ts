import type { EvalExpectedFinding } from '@devdigest/shared';
import { matchFinding, type ScorableFinding } from './match.js';
import { normalizePath } from './normalize.js';

/**
 * recall — of all expected `must_find` findings in a case, the fraction that
 * were matched by an actual finding. An empty expectation set (a
 * `must_not_flag` case has `expected_output: []`) is vacuously fully
 * recalled — there is nothing to have missed — so this returns `1`, never
 * `NaN` (AC-20).
 */
export function computeRecall(
  expected: EvalExpectedFinding[],
  actual: ScorableFinding[],
): number {
  if (expected.length === 0) return 1;
  const matched = expected.filter((exp) => actual.some((a) => matchFinding(exp, a)));
  return matched.length / expected.length;
}

/**
 * precision — of all actual findings produced, the fraction that are NOT
 * noise. A finding is noise when it matches no expected finding in this
 * case — which includes every actual finding produced against a
 * `must_not_flag` case (`expected: []`, so nothing can ever match). No
 * actual findings at all is a trivially perfect precision (`1`), never
 * `NaN` (AC-20).
 */
export function computePrecision(
  expected: EvalExpectedFinding[],
  actual: ScorableFinding[],
): number {
  if (actual.length === 0) return 1;
  const notNoise = actual.filter((a) => expected.some((exp) => matchFinding(exp, a)));
  return notNoise.length / actual.length;
}

/** One new-side (post-image) line touched by a hunk, per file, from raw diff text. */
function buildDiffLineIndex(inputDiff: string): Map<string, Set<number>> {
  const index = new Map<string, Set<number>>();
  let currentPath = '';
  let cursor = 0;
  let inHunk = false;

  for (const line of (inputDiff ?? '').split('\n')) {
    if (line.startsWith('diff --git') || line.startsWith('--- ')) {
      inHunk = false;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const p = normalizePath(line.slice(4).trim());
      currentPath = p === '/dev/null' ? currentPath : p;
      if (!index.has(currentPath)) index.set(currentPath, new Set());
      inHunk = false;
      continue;
    }
    const hh = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hh) {
      cursor = Number(hh[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk || !currentPath) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      index.get(currentPath)!.add(cursor);
      cursor++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      // deletion: no new-side line consumed
    } else {
      // context line: advances the new-side cursor and counts as covered
      index.get(currentPath)!.add(cursor);
      cursor++;
    }
  }
  return index;
}

/**
 * citation_accuracy — of all actual findings produced, the fraction that
 * cite a real `file:line` inside the case's frozen input diff (survived the
 * grounding gate). No actual findings is a trivially perfect citation
 * accuracy (`1`), never `NaN` (AC-20). An out-of-diff citation lowers this
 * metric and is never a substitute for a recall match (spec edge case).
 */
export function computeCitationAccuracy(
  actual: ScorableFinding[],
  inputDiff: string,
): number {
  if (actual.length === 0) return 1;
  const lineIndex = buildDiffLineIndex(inputDiff ?? '');
  const cited = actual.filter((a) => {
    const lines = lineIndex.get(normalizePath(a.file));
    if (!lines) return false;
    const lo = Math.min(a.start_line, a.end_line);
    const hi = Math.max(a.start_line, a.end_line);
    for (let n = lo; n <= hi; n++) if (lines.has(n)) return true;
    return false;
  });
  return cited.length / actual.length;
}
