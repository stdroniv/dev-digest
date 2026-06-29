/**
 * pr-ref — pure PR-number parser for git commit subjects.
 *
 * No git, no DB, no I/O. Exported for hermetic unit tests (step 2 / pr-ref.test.ts).
 */

/**
 * Parse the PR number from a git commit message (first line only).
 *
 * Recognises, in order:
 *  1. Squash-merge subject:  "Add rate limiting (#482)"  → 482
 *  2. Merge-commit subject:  "Merge pull request #77 from acme/feat" → 77
 *
 * Returns null when neither pattern matches.
 * A `(#N)` on a non-first line (body) is intentionally ignored.
 */
export function parsePrRef(message: string): number | null {
  // Take only the first line (subject); body refs are not PR refs.
  const subject = message.split('\n')[0] ?? '';
  // Pattern 1 — squash-merge: trailing "(#N)" at end of subject.
  const squash = subject.match(/\(#(\d+)\)\s*$/);
  if (squash) {
    const n = squash[1];
    if (n != null) return Number(n);
  }
  // Pattern 2 — merge commit: "Merge pull request #N ..."
  const merge = subject.match(/^Merge pull request #(\d+)\b/);
  if (merge) {
    const n = merge[1];
    if (n != null) return Number(n);
  }
  return null;
}

/**
 * Strip a trailing `(#N)` squash-merge ref from the commit subject and trim.
 * When no ref is present, the original subject is returned unchanged.
 */
export function stripPrRef(message: string): string {
  const subject = message.split('\n')[0] ?? '';
  return subject.replace(/\s*\(#\d+\)\s*$/, '').trim();
}
