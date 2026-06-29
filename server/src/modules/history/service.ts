/**
 * history — service.
 *
 * buildPriorPrs: pure function (exported for hermetic unit tests, step 4).
 * HistoryService: orchestrator that reads DB + git and calls buildPriorPrs.
 *
 * Degrade-to-safe: missing clone / no files / any git error → { history: [] },
 * never a 500. Missing PR → NotFoundError (→ 404 at the route layer).
 */

import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { getPull, getPrFiles } from '../reviews/repository/pull.repo.js';
import { RepoIntelRepository } from '../repo-intel/repository.js';
import type { GitCommit, RepoRef } from '@devdigest/shared';
import type { PrHistory } from '@devdigest/shared';
import { parsePrRef, stripPrRef } from './pr-ref.js';

// ---------------------------------------------------------------------------
// Constants (exported for tests / reuse)
// ---------------------------------------------------------------------------

/** Maximum prior PRs emitted (newest-first). */
export const MAX_PRS_RETURNED = 8;

/** Maximum changed files scanned per call (guards against huge PRs). */
export const MAX_FILES_SCANNED = 25;

/** Maximum commits read per file (caps git-log output). */
export const MAX_COMMITS_PER_FILE = 50;

// ---------------------------------------------------------------------------
// Pure builder — no DB / git / I/O
// ---------------------------------------------------------------------------

interface PrEntry {
  pr_number: number;
  title: string;
  author: string;
  merged_at: string;
  filesOverlap: Set<string>;
}

/**
 * Build a `PrHistory` payload from per-file commit lists.
 *
 * Algorithm:
 *  1. For each (file, commit): parse the PR number from the subject.
 *  2. Skip commits whose PR number is null or equals `ownPrNumber`.
 *  3. Accumulate a Map<prNumber, PrEntry> — first sighting sets title/author/date;
 *     subsequent sightings update `merged_at` to the max date and grow filesOverlap.
 *  4. Sort entries by `merged_at` desc (recency), take top `maxPrs`.
 *  5. Emit PrHistoryItem[] with sorted files_overlap and a deterministic notes string.
 *
 * Exported as a pure function so service.test.ts can drive it without DB or git.
 */
export function buildPriorPrs(
  commitsByFile: Array<{ file: string; commits: GitCommit[] }>,
  ownPrNumber: number,
  opts?: { maxPrs?: number },
): PrHistory {
  const maxPrs = opts?.maxPrs ?? MAX_PRS_RETURNED;
  const byPr = new Map<number, PrEntry>();

  for (const { file, commits } of commitsByFile) {
    for (const c of commits) {
      const n = parsePrRef(c.message);
      if (n == null || n === ownPrNumber) continue;

      const existing = byPr.get(n);
      if (!existing) {
        byPr.set(n, {
          pr_number: n,
          title: stripPrRef(c.message),
          author: c.author,
          merged_at: c.date,
          filesOverlap: new Set([file]),
        });
      } else {
        // Keep the max merged_at across sightings; ISO-8601 strings sort lexically.
        if (c.date > existing.merged_at) {
          existing.merged_at = c.date;
        }
        existing.filesOverlap.add(file);
      }
    }
  }

  const items = [...byPr.values()]
    // Sort newest-first by merged_at (string comparison works for ISO dates).
    .sort((a, b) => (b.merged_at > a.merged_at ? 1 : -1))
    .slice(0, maxPrs)
    .map((e) => ({
      pr_number: e.pr_number,
      title: e.title,
      author: e.author,
      merged_at: e.merged_at,
      files_overlap: [...e.filesOverlap].sort(),
      notes: `Touched ${e.filesOverlap.size} of these files`,
    }));

  return { history: items };
}

// ---------------------------------------------------------------------------
// Orchestrator — reads DB + git, calls buildPriorPrs
// ---------------------------------------------------------------------------

export class HistoryService {
  constructor(private container: Container) {}

  async getPriorPrs(workspaceId: string, prId: string): Promise<PrHistory> {
    // (a) Resolve PR by workspaceId + uuid. Missing → 404 (NOT caught below).
    const pr = await getPull(this.container.db, workspaceId, prId);
    if (!pr) throw new NotFoundError('Pull request not found');

    // (b) Get changed files for this PR.
    const files = (await getPrFiles(this.container.db, pr.id)).map((r) => r.path);
    if (files.length === 0) return { history: [] };

    // (c)–(f) wrapped in try/catch: any git/FS error degrades to empty, never 500.
    try {
      // (c) Get repo basics — need owner, name, and clonePath.
      const basics = await new RepoIntelRepository(this.container.db).getRepoBasics(
        pr.repoId,
      );
      if (!basics || !basics.clonePath) return { history: [] };

      // (d) Cap changed files.
      const cappedFiles = files.slice(0, MAX_FILES_SCANNED);
      if (cappedFiles.length < files.length) {
        console.warn(
          `[history] PR ${pr.id}: truncated changed files from ${files.length} to ${MAX_FILES_SCANNED}`,
        );
      }

      const ref: RepoRef = { owner: basics.owner, name: basics.name };

      // (e) Fetch commits per file, capping each list to MAX_COMMITS_PER_FILE.
      const commitsByFile: Array<{ file: string; commits: GitCommit[] }> = [];
      for (const file of cappedFiles) {
        let commits: GitCommit[] = [];
        try {
          commits = (await this.container.git.log(ref, file)).slice(
            0,
            MAX_COMMITS_PER_FILE,
          );
        } catch {
          // A single-file git error degrades that file's contribution; continue.
          commits = [];
        }
        commitsByFile.push({ file, commits });
      }

      // (f) Build the response from the pure function.
      return buildPriorPrs(commitsByFile, pr.number, { maxPrs: MAX_PRS_RETURNED });
    } catch {
      // Any other error (DB, FS, etc.) → empty response rather than a 500.
      return { history: [] };
    }
  }
}
