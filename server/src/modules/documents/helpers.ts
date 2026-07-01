import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { MARKDOWN_EXTENSION } from './constants.js';

/**
 * Pure Markdown-discovery walk (hermetically testable, no DB/container).
 *
 * Given a repo clone's absolute path and a list of configured root folder
 * NAMES (e.g. `['specs', 'docs', 'insights']`), recursively collects every
 * `.md` file at any depth under each root that exists on disk. A root that
 * doesn't exist (a workspace may configure a folder name the repo doesn't
 * have) is silently skipped — not an error.
 *
 * Output paths are repo-relative and normalised to POSIX (forward slashes)
 * regardless of host OS, so downstream consumers (attachment tables, the
 * `readContent`/`preview` re-read, prompt assembly) always see a stable,
 * platform-independent path.
 */

/** One discovered `.md` file, tagged with the root it was found under. */
export interface DiscoveredMarkdownFile {
  /** Repo-relative POSIX path, e.g. "specs/SPEC-01-project-context.md". */
  path: string;
  /** The configured root this file was found under, e.g. "specs". */
  root: string;
}

/** Normalise an absolute filesystem path to a repo-relative POSIX path. */
export function toRepoRelativePosix(clonePath: string, absolutePath: string): string {
  return relative(clonePath, absolutePath).split(sep).join('/');
}

/**
 * Recursively walk one root directory under the clone, collecting every
 * `.md` file at any depth. `rootAbsPath` need not exist — a missing
 * directory (ENOENT) resolves to an empty list rather than throwing.
 */
async function walkRoot(
  clonePath: string,
  rootAbsPath: string,
  root: string,
): Promise<DiscoveredMarkdownFile[]> {
  const entries = await readdir(rootAbsPath, { withFileTypes: true }).catch(() => []);
  const out: DiscoveredMarkdownFile[] = [];
  for (const entry of entries) {
    const abs = join(rootAbsPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkRoot(clonePath, abs, root)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(MARKDOWN_EXTENSION)) {
      out.push({ path: toRepoRelativePosix(clonePath, abs), root });
    }
  }
  return out;
}

/**
 * Walk every configured root under `clonePath`, collecting `.md` files at any
 * depth, tagged with their originating root. Roots are walked independently
 * (a root name appearing twice would just re-walk — callers should dedupe
 * their root list, but this function doesn't need to know that).
 */
export async function collectMarkdownFiles(
  clonePath: string,
  roots: string[],
): Promise<DiscoveredMarkdownFile[]> {
  const results: DiscoveredMarkdownFile[] = [];
  for (const root of roots) {
    const rootAbsPath = join(clonePath, root);
    results.push(...(await walkRoot(clonePath, rootAbsPath, root)));
  }
  return results;
}
