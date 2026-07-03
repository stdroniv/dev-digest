import { createHash } from 'node:crypto';

/**
 * hashPatch — deterministic sha256 of a file's diff patch, used as the
 * staleness fingerprint for the cached per-file "What this does" summary:
 * `FileSummaryService.get` recomputes this over the PR's CURRENT patch and
 * compares against the stored `patchHash` to decide `stale`.
 */
export function hashPatch(patch: string): string {
  return createHash('sha256').update(patch).digest('hex');
}
