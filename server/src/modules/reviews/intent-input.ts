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

/** Markdown doc extensions — these files carry the PR's intent as prose, so the
 * classifier reads their FULL content (via buildSpecDocsBlock) instead of just
 * hunk headers. */
const DOC_FILE_RE = /\.(?:md|mdx|markdown)$/i;

/** True when a changed file is a plan/spec/doc whose prose should be read in full. */
export function isDocFile(path: string): boolean {
  return DOC_FILE_RE.test(path);
}

/** Extract hunk headers from a single file patch. */
function extractHunkHeaderLines(patch: string): string[] {
  return patch.split('\n').filter((line) => HUNK_HEADER_RE.test(line));
}

/**
 * Build the compact changed-files block (path + hunk headers) for the
 * intent classifier. Files with no parseable hunk headers are omitted.
 * Markdown doc/spec files are also omitted here — their full prose is sent
 * separately via buildSpecDocsBlock, so listing their hunk headers too would
 * be redundant.
 */
export function buildHunkHeadersBlock(files: PrFile[]): string {
  const blocks: string[] = [];
  for (const file of files) {
    if (isDocFile(file.path)) continue;
    if (!file.patch) continue;
    const headers = extractHunkHeaderLines(file.patch);
    if (headers.length === 0) continue;
    blocks.push(`${file.path}\n${headers.join('\n')}`);
  }
  return blocks.join('\n\n');
}

const MAX_SPEC_DOC_CHARS = 8000;

/**
 * Reconstruct the current text of markdown doc/spec/plan files from their
 * patch — keep added lines and context lines, drop removed lines, strip the
 * unified-diff prefixes. This gives the classifier the prose content of docs
 * that describe the PR's intent, without fetching extra files from GitHub.
 *
 * A new file (all `+` lines) comes back in full. An edited file comes back
 * as the post-edit sections (changed + surrounding context). Each file is
 * capped at MAX_SPEC_DOC_CHARS to keep the token budget bounded.
 */
export function buildSpecDocsBlock(files: PrFile[]): string {
  const blocks: string[] = [];
  for (const file of files) {
    if (!isDocFile(file.path) || !file.patch) continue;
    const text = file.patch
      .split('\n')
      .filter((line) => !line.startsWith('-') && !HUNK_HEADER_RE.test(line))
      .map((line) => (line.startsWith('+') || line.startsWith(' ') ? line.slice(1) : line))
      .join('\n')
      .trim()
      .slice(0, MAX_SPEC_DOC_CHARS);
    if (text.length > 0) blocks.push(`${file.path}\n${text}`);
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
