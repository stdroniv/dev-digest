/**
 * Path normalisation for the eval scorer's match rule.
 *
 * Diff-header style paths carry an `a/`/`b/` prefix (git's convention for the
 * pre-/post-image side of a hunk header, e.g. `a/src/x.ts` / `b/src/x.ts`).
 * An expected finding's `file` and an actual finding's `file` must compare
 * equal regardless of whether either side carries that prefix — this is a
 * pure string transform, no filesystem access.
 */
export function normalizePath(path: string): string {
  return path.replace(/^[ab]\//, '');
}
