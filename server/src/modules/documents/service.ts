import { access, readFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { ProjectDocument } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { getRootFolders } from '../settings/root-folders.js';
import { collectMarkdownFiles } from './helpers.js';

/**
 * Markdown discovery + read service (Project Context, SPEC-01).
 *
 * Discovers `.md` files under a repo clone's configured root folders
 * (default `specs`/`docs`/`insights`, per-workspace override via
 * `getRootFolders`), and re-reads content fresh from the clone at both
 * preview time and run time. This service only reads bytes and estimates a
 * token count — it never interprets or executes document content, which is
 * untrusted Markdown (see `security`).
 *
 * Deliberately reads the clone directly (not `RepoIntel.getConventionSamples`,
 * which is TS/JS-only and drops config/markdown files via its junk filter —
 * server/INSIGHTS) via the repo's PERSISTED `clonePath` column, mirroring
 * `ConventionsService.sample()` — never a cwd-derived `clonePathFor` helper,
 * which resolves incorrectly outside the API process's own cwd (server/INSIGHTS
 * cwd-divergence note).
 */

/** Minimal repo shape this service needs — a structural subset of the `repos` row. */
export interface RepoCloneRef {
  id: string;
  workspaceId: string;
  clonePath: string | null;
}

/**
 * Result of `discover()`. `cloned: false` is the distinct "not cloned" signal
 * (no clone path persisted, or the clone directory is absent on disk) — the
 * routes layer (T6) translates this into `state: 'not_cloned'`, as opposed to
 * `cloned: true` with an empty `documents` array, which becomes `state: 'empty'`.
 */
export type DocumentsDiscoverResult =
  | { cloned: false }
  | { cloned: true; documents: ProjectDocument[] };

export class DocumentsService {
  constructor(private container: Container) {}

  /**
   * Discover every `.md` file under the repo's configured root folders,
   * with a locally-estimated token count computed during the scan (the
   * estimate source used by AC-15/26 and embedded directly in the list
   * response per Q5 — no separate token-count call).
   */
  async discover(repo: RepoCloneRef): Promise<DocumentsDiscoverResult> {
    if (!(await this.isCloned(repo))) return { cloned: false };
    const clonePath = repo.clonePath as string;

    const roots = await getRootFolders(this.container, repo.workspaceId);
    const found = await collectMarkdownFiles(clonePath, roots);

    const documents: ProjectDocument[] = [];
    for (const file of found) {
      const content = await this.readFromClone(clonePath, file.path);
      if (content == null) continue; // vanished between walk and read — skip, don't fail the whole scan
      documents.push({
        path: file.path,
        root: file.root,
        tokens: this.container.tokenizer.count(content),
      });
    }
    return { cloned: true, documents };
  }

  /**
   * Fresh read of one document's content from the clone, e.g. for the
   * run-executor (AC-20/24) to embed in the prompt. Returns `null` when the
   * repo isn't cloned or the file no longer exists — never throws.
   */
  async readContent(repo: RepoCloneRef, path: string): Promise<string | null> {
    if (!repo.clonePath) return null;
    return this.readFromClone(repo.clonePath, path);
  }

  /** Same fresh content read, for the UI preview pane (AC-3/14). */
  async preview(repo: RepoCloneRef, path: string): Promise<string | null> {
    return this.readContent(repo, path);
  }

  // ---- internals ----------------------------------------------------------

  private async isCloned(repo: RepoCloneRef): Promise<boolean> {
    if (!repo.clonePath) return false;
    try {
      await access(repo.clonePath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Defense-in-depth (security fix, alongside the route-level `RepoRelativePath`
   * guard in `agents/routes.ts`/`skills/routes.ts`/`documents/routes.ts`): even
   * a path that somehow bypasses the route-level validation (e.g. a row
   * persisted before this fix) must never be able to escape `clonePath`. Resolve
   * both to absolute paths and require the resolved target to sit strictly
   * inside the resolved clone dir (trailing separator check so `/repo` doesn't
   * prefix-match `/repo-evil`). Returns `null` — the existing "unavailable"
   * signal — rather than throwing, consistent with this service's "never throws" contract.
   *
   * The cheap string-prefix check above only guards against `../`-style escapes;
   * it does NOT catch a malicious cloned repo committing a real OS symlink under
   * a root folder that points outside the clone (`resolve()` never follows
   * symlinks). Mirrors `onboarding/language-heuristics.ts` `safeReadFile`:
   * realpath both the clone root and the resolved target (following symlinks)
   * and re-check containment before ever reading bytes. Both sides must be
   * realpath'd — not just the target — since on macOS `TMPDIR`/`/tmp` itself
   * resolves through a symlink (`/var` -> `/private/var`), so comparing a
   * realpath'd target against the un-resolved clone root would falsely reject
   * every file in a legitimate clone. A missing file or an escaping symlink
   * both degrade to `null`, never a throw.
   */
  private async readFromClone(clonePath: string, path: string): Promise<string | null> {
    const resolvedClone = resolve(clonePath);
    const resolvedTarget = resolve(clonePath, path);
    if (resolvedTarget !== resolvedClone && !resolvedTarget.startsWith(resolvedClone + sep)) {
      return null;
    }
    const realClone = await realpath(resolvedClone).catch(() => null);
    if (realClone == null) return null;
    const realTarget = await realpath(resolvedTarget).catch(() => null);
    if (realTarget == null) return null;
    if (realTarget !== realClone && !realTarget.startsWith(realClone + sep)) {
      return null;
    }
    return readFile(realTarget, 'utf8').catch(() => null);
  }
}
