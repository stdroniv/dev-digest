import { and, desc, eq, ne } from 'drizzle-orm';
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
      .values(
        items.map((it) => ({
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
        })),
      )
      .returning();
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
