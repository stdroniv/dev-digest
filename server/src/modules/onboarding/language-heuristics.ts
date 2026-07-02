import { readFile, readdir, realpath } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { isRepoRelativePath } from '../documents/path-safety.js';
import { toRepoRelativePosix } from '../documents/helpers.js';

/**
 * Fallback grounding helpers for non-indexed repos (AC-32): README discovery,
 * a bounded file-tree walk, and a language-heuristic extension histogram.
 * Mirrors `documents/service.ts`'s clone-read safety pattern (resolve + `sep`
 * prefix guard) so a fallback read can never escape the repo's `clonePath`.
 */

const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
  'vendor',
  '.git',
  '.turbo',
  '.cache',
]);

/** Bound on how many file-tree entries the fallback walk collects. */
export const MAX_FILE_TREE_ENTRIES = 300;

const README_CANDIDATES = [
  'README.md',
  'Readme.md',
  'readme.md',
  'README.MD',
  'README',
  'README.rst',
  'README.txt',
];

/** Cap README content so a huge file can't blow the grounding token budget. */
const MAX_README_CHARS = 20_000;

/**
 * Defense-in-depth read guard (mirrors `documents/service.ts` `readFromClone`):
 * even a hardcoded/derived relative path is re-validated and resolved strictly
 * inside `clonePath` before ever touching the filesystem.
 *
 * The imported repo is an untrusted trust boundary, so a README candidate
 * name (unlike `documents/service.ts`'s caller-supplied paths) can be a REAL
 * OS symlink committed by the repo — `resolve()` only normalizes the path
 * string, it does not follow symlinks, so the string-prefix check above
 * would pass while `readFile` transparently follows the symlink outside the
 * clone. Re-resolve the candidate's REAL path via `realpath` (which does
 * follow symlinks) and re-check containment before ever reading bytes. A
 * missing candidate or an escaping symlink both degrade to "not found" —
 * exactly like today's missing-README case, never a throw.
 */
async function safeReadFile(clonePath: string, relPath: string): Promise<string | null> {
  if (!isRepoRelativePath(relPath)) return null;
  const resolvedClone = resolve(clonePath);
  const resolvedTarget = resolve(clonePath, relPath);
  if (resolvedTarget !== resolvedClone && !resolvedTarget.startsWith(resolvedClone + sep)) {
    return null;
  }
  // Both sides must be realpath'd (not just the target) before comparing:
  // on macOS `TMPDIR`/`/tmp` itself resolves through a symlink
  // (`/var` -> `/private/var`), so realpath-ing only the target and
  // comparing it against the un-resolved clone root would falsely reject
  // every file in a perfectly legitimate clone.
  const realClone = await realpath(resolvedClone).catch(() => null);
  if (realClone == null) return null;
  const realTarget = await realpath(resolvedTarget).catch(() => null);
  if (realTarget == null) return null;
  if (realTarget !== realClone && !realTarget.startsWith(realClone + sep)) {
    return null;
  }
  return readFile(realTarget, 'utf8').catch(() => null);
}

/** Find and read the repo's README (first match of common filenames), capped. */
export async function findReadme(clonePath: string): Promise<string | null> {
  for (const name of README_CANDIDATES) {
    const content = await safeReadFile(clonePath, name);
    if (content != null) return content.slice(0, MAX_README_CHARS);
  }
  return null;
}

/**
 * Bounded recursive walk of the clone, skipping VCS/build/dependency dirs and
 * dotfiles. Returns repo-relative POSIX paths. Never throws — a missing or
 * unreadable directory yields fewer entries, not an error (mirrors
 * `documents/helpers.ts` `walkRoot`).
 */
export async function walkFileTree(
  clonePath: string,
  limit = MAX_FILE_TREE_ENTRIES,
): Promise<string[]> {
  const out: string[] = [];
  await walk(clonePath, clonePath, out, limit);
  return out;
}

async function walk(clonePath: string, dir: string, out: string[], limit: number): Promise<void> {
  if (out.length >= limit) return;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (out.length >= limit) return;
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      await walk(clonePath, join(dir, entry.name), out, limit);
    } else if (entry.isFile()) {
      out.push(toRepoRelativePosix(clonePath, join(dir, entry.name)));
    }
  }
}

/** Human-readable label per file extension for the language-heuristics hint list. */
const EXT_LABELS: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript (JSX)',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript (JSX)',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.go': 'Go',
  '.rb': 'Ruby',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.rs': 'Rust',
  '.php': 'PHP',
  '.cs': 'C#',
  '.cpp': 'C++',
  '.c': 'C',
  '.swift': 'Swift',
  '.md': 'Markdown',
  '.json': 'JSON',
  '.yml': 'YAML',
  '.yaml': 'YAML',
};

/** Extension histogram over a file list, sorted desc, capped to `topN` entries. */
export function computeLanguageHints(files: string[], topN = 8): string[] {
  const counts = new Map<string, number>();
  for (const f of files) {
    const ext = extname(f).toLowerCase() || '(no extension)';
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([ext, count]) => `${EXT_LABELS[ext] ?? ext}: ${count} file${count === 1 ? '' : 's'}`);
}
