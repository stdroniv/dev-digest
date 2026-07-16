/**
 * Pure finding-location matching primitives, shared across modules.
 *
 * Originally lived only in `eval/scoring/{match,normalize}.ts` (the eval
 * scorer's match rule); lifted here so `multi-agent-review`'s "Where agents
 * disagree" grouping can reuse the same deterministic file+line-range match
 * without depending on the `eval` module (onion: sibling modules should not
 * import each other directly). `eval/scoring/match.ts` and
 * `eval/scoring/normalize.ts` re-export from here — no behavior change.
 */

/** Do two inclusive line ranges overlap? Order-tolerant (start may be > end). */
export function rangesOverlap(a: [number, number], b: [number, number]): boolean {
  const aLo = Math.min(a[0], a[1]);
  const aHi = Math.max(a[0], a[1]);
  const bLo = Math.min(b[0], b[1]);
  const bHi = Math.max(b[0], b[1]);
  return aLo <= bHi && bLo <= aHi;
}

/**
 * Path normalisation for matching a file across diff-header-prefixed and
 * unprefixed forms.
 *
 * Diff-header style paths carry an `a/`/`b/` prefix (git's convention for the
 * pre-/post-image side of a hunk header, e.g. `a/src/x.ts` / `b/src/x.ts`).
 * Two paths must compare equal regardless of whether either side carries that
 * prefix — this is a pure string transform, no filesystem access.
 */
export function normalizePath(path: string): string {
  return path.replace(/^[ab]\//, '');
}
