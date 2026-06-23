import { and, desc, eq, ne, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionRow } from '../../db/rows.js';

export type { ConventionRow };

/**
 * Conventions Extractor data-access. Owns the `conventions` table. Workspace-scoped
 * throughout. The generated skill is written through the skills repository (reused),
 * not here.
 */

/** Minimal repo metadata the sampler + GitHub-link builder need. */
export interface RepoMeta {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  clonePath: string | null;
}

export interface InsertConvention {
  category: string | null;
  rule: string;
  evidencePath: string | null;
  evidenceSnippet: string | null;
  evidenceStartLine: number | null;
  evidenceEndLine: number | null;
  confidence: number | null;
}

export interface UpdateConvention {
  status?: 'pending' | 'accepted' | 'rejected';
  category?: string;
  rule?: string;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  /** Repo row (workspace-scoped) for sampling + link building. */
  async getRepoMeta(workspaceId: string, repoId: string): Promise<RepoMeta | undefined> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        owner: t.repos.owner,
        name: t.repos.name,
        fullName: t.repos.fullName,
        defaultBranch: t.repos.defaultBranch,
        clonePath: t.repos.clonePath,
      })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /**
   * Actionable candidates for a repo (pending + accepted), newest first. Rejected
   * candidates are excluded — the user dismissed them, so they drop off the list.
   */
  async listByRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          ne(t.conventions.status, 'rejected'),
        ),
      )
      .orderBy(desc(t.conventions.createdAt));
  }

  /** Accepted candidates for a repo, oldest first (stable skill ordering). */
  async listAccepted(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.status, 'accepted'),
        ),
      )
      .orderBy(t.conventions.createdAt);
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  /** Map domain insert items to Drizzle row values (a run's candidates are `pending`). */
  private toRows(workspaceId: string, repoId: string, runId: string, items: InsertConvention[]) {
    return items.map((it) => ({
      workspaceId,
      repoId,
      runId,
      category: it.category,
      rule: it.rule,
      evidencePath: it.evidencePath,
      evidenceSnippet: it.evidenceSnippet,
      evidenceStartLine: it.evidenceStartLine,
      evidenceEndLine: it.evidenceEndLine,
      confidence: it.confidence,
      status: 'pending' as const,
      accepted: false,
    }));
  }

  /** Bulk-insert the VERIFIED candidates of one extraction run (status = pending). */
  async insertMany(
    workspaceId: string,
    repoId: string,
    runId: string,
    items: InsertConvention[],
  ): Promise<ConventionRow[]> {
    if (items.length === 0) return [];
    return this.db
      .insert(t.conventions)
      .values(this.toRows(workspaceId, repoId, runId, items))
      .returning();
  }

  /**
   * Replace a repo's auto-extracted candidates with one fresh run while PRESERVING
   * any the user already accepted: delete the prior non-accepted rows
   * (pending/rejected), then insert this run's verified candidates — atomically.
   * Without this, `extract()` only ever appended, so each re-scan piled up duplicate
   * `pending` cards. A transaction-scoped advisory lock (keyed on the repo, released
   * at COMMIT/ROLLBACK) serializes concurrent re-scans of the SAME repo so two
   * interleaved delete-then-insert pairs can't both insert a batch and re-introduce
   * the pile-up (there is no unique constraint on `(repo_id, rule)` to catch it).
   */
  async replaceForRepo(
    workspaceId: string,
    repoId: string,
    runId: string,
    items: InsertConvention[],
  ): Promise<ConventionRow[]> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${repoId}))`);
      await tx
        .delete(t.conventions)
        .where(
          and(
            eq(t.conventions.workspaceId, workspaceId),
            eq(t.conventions.repoId, repoId),
            ne(t.conventions.status, 'accepted'),
          ),
        );
      if (items.length === 0) return [];
      return tx
        .insert(t.conventions)
        .values(this.toRows(workspaceId, repoId, runId, items))
        .returning();
    });
  }

  /** Accept / reject / edit one candidate. Keeps `accepted` in sync with `status`. */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateConvention,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({
        ...(patch.status !== undefined
          ? { status: patch.status, accepted: patch.status === 'accepted' }
          : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
      })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }
}
