import type { PrFile } from '@devdigest/shared';

/**
 * Hunk-header extractor for the intent classifier.
 *
 * Given PR files (from a fresh PrDetail), returns a compact text block:
 *   path/to/file.ts
 *   @@ -1,5 +1,12 @@
 *   @@ -42,8 +49,9 @@
 *
 *   path/to/other.ts
 *   @@ -0,0 +1,30 @@
 *
 * Only @@ … @@ hunk-header lines are kept — added/removed code lines are
 * dropped. This keeps the classifier prompt lean while still communicating
 * *where* each file changed (which is useful for intent inference).
 */

const HUNK_HEADER_RE = /^@@[ \t][^@]*@@/m;

/** Extract hunk headers from a single file patch. */
function extractHunkHeaderLines(patch: string): string[] {
  return patch.split('\n').filter((line) => HUNK_HEADER_RE.test(line));
}

/**
 * Build the compact changed-files block (path + hunk headers) for the
 * intent classifier. Files with no parseable hunk headers are omitted.
 */
export function buildHunkHeadersBlock(files: PrFile[]): string {
  const blocks: string[] = [];
  for (const file of files) {
    if (!file.patch) continue;
    const headers = extractHunkHeaderLines(file.patch);
    if (headers.length === 0) continue;
    blocks.push(`${file.path}\n${headers.join('\n')}`);
  }
  return blocks.join('\n\n');
}

/**
 * Concatenate all raw patches (for token-savings measurement).
 * Returns the full patch text so the caller can count its tokens and compare
 * against the leaner hunk-headers-only block.
 */
export function buildFullPatchText(files: PrFile[]): string {
  return files
    .filter((f) => f.patch)
    .map((f) => `${f.path}\n${f.patch}`)
    .join('\n\n');
}
