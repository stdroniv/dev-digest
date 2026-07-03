import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillDocumentLink, SkillSource, SkillType } from '@devdigest/shared';
import { INITIAL_SKILL_VERSION } from './constants.js';
import { isBodyChange, type SkillStatsRaw } from './helpers.js';

/**
 * A1 — skills data-access. Owns the `skills` table + its immutable `skill_versions`
 * body snapshots. The `agent_skills` link table is owned by the agents repository
 * (A2 owns the agent side: link/reorder). Workspace-scoped throughout.
 */

import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
export type { SkillRow, SkillVersionRow };

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  source?: SkillSource;
  body: string;
  enabled?: boolean;
  evidenceFiles?: string[] | null;
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

export class SkillsRepository {
  constructor(private db: Db) {}

  /** All skills in a workspace, newest first. */
  async list(workspaceId: string): Promise<SkillRow[]> {
    return this.db
      .select()
      .from(t.skills)
      .where(eq(t.skills.workspaceId, workspaceId))
      .orderBy(desc(t.skills.createdAt));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /**
   * Find a skill in a workspace by name, CASE-INSENSITIVELY. Used to block
   * duplicate names on create/rename (`lower(name)` matches the unique index).
   */
  async findByName(workspaceId: string, name: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(
        and(
          eq(t.skills.workspaceId, workspaceId),
          sql`lower(${t.skills.name}) = lower(${name})`,
        ),
      );
    return row;
  }

  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  /**
   * Insert a skill at v1 with its immutable v1 body snapshot. The client defers
   * the POST until the user's first Save, so by the time we persist, the body is
   * the user's authored content — it earns v1 directly (no draft state).
   */
  async insert(values: InsertSkill): Promise<SkillRow> {
    const [row] = await this.db
      .insert(t.skills)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description,
        type: values.type,
        source: values.source ?? 'manual',
        body: values.body,
        enabled: values.enabled ?? true,
        version: INITIAL_SKILL_VERSION,
        evidenceFiles: values.evidenceFiles ?? null,
      })
      .returning();
    await this.snapshotBody(row!.id, INITIAL_SKILL_VERSION, row!.body);
    return row!;
  }

  /**
   * Update a skill. A body change bumps the version + appends an immutable
   * snapshot; name/description/type/enabled edits do NOT version.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkill,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const writeSnapshot = isBodyChange(existing, patch);
    const nextVersion = writeSnapshot ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.skills)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(writeSnapshot ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();

    if (writeSnapshot && row) await this.snapshotBody(row.id, nextVersion, row.body);
    return row;
  }

  /**
   * Raw aggregates for one skill's Stats tab over a rolling window. Reads the
   * `agent_skills` link (owned by the agents module) read-only — cross-module
   * aggregation, like the pulls/reviews modules already do. The percentage math
   * is left to `computeSkillStats` (pure); here we only count rows.
   */
  async getStats(workspaceId: string, skillId: string, windowDays: number): Promise<SkillStatsRaw> {
    const windowStart = sql`now() - (${windowDays} * interval '1 day')`;

    // Agents linked to this skill (workspace-scoped), ordered for display.
    const agents = await this.db
      .select({ id: t.agents.id, name: t.agents.name })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agents.id, t.agentSkills.agentId))
      .where(and(eq(t.agentSkills.skillId, skillId), eq(t.agents.workspaceId, workspaceId)))
      .orderBy(asc(t.agents.name));

    const agentIds = agents.map((a) => a.id);
    // Empty array → `inArray(col, [])` would emit invalid SQL; use a `false`
    // predicate so the skill simply matches no reviews/findings.
    const usesSkill = agentIds.length ? inArray(t.reviews.agentId, agentIds) : sql`false`;

    // Pull frequency: in-window reviews by this skill's agents vs all in-window
    // reviews with an agent. One pass with FILTER for the numerator.
    const [pull] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        forSkill: sql<number>`count(*) filter (where ${usesSkill})::int`,
      })
      .from(t.reviews)
      .where(
        and(
          eq(t.reviews.workspaceId, workspaceId),
          isNotNull(t.reviews.agentId),
          gte(t.reviews.createdAt, windowStart),
        ),
      );

    // In-window findings from this skill's agents (accept/dismiss state + category).
    const findings = agentIds.length
      ? await this.db
          .select({
            category: t.findings.category,
            acceptedAt: t.findings.acceptedAt,
            dismissedAt: t.findings.dismissedAt,
          })
          .from(t.findings)
          .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
          .where(
            and(
              eq(t.reviews.workspaceId, workspaceId),
              inArray(t.reviews.agentId, agentIds),
              gte(t.reviews.createdAt, windowStart),
            ),
          )
      : [];

    return {
      agents,
      reviewsInWindowTotal: pull?.total ?? 0,
      reviewsInWindowForSkill: pull?.forSkill ?? 0,
      findings,
    };
  }

  private async snapshotBody(skillId: string, version: number, body: string): Promise<void> {
    await this.db
      .insert(t.skillVersions)
      .values({ skillId, version, body })
      .onConflictDoNothing();
  }

  // ---- skill_versions (immutable body snapshots) --------------------------

  /** All body snapshots for a skill, newest version first. */
  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  /** A single body snapshot, or undefined if that version was never recorded. */
  async getVersion(skillId: string, version: number): Promise<SkillVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row;
  }

  // ---- skill_documents link table (project-context attachments) -----------

  /**
   * Documents linked to a skill under a specific repository, in `order`
   * ascending (path-only, never content). Scoped by `(skillId, repoId)` — the
   * composite PK `(skill_id, repo_id, path)` means each repo keeps its own
   * independent ordered list (AC-29).
   */
  async linkedDocuments(skillId: string, repoId: string): Promise<SkillDocumentLink[]> {
    const rows = await this.db
      .select({
        path: t.skillDocuments.path,
        order: t.skillDocuments.order,
        repoId: t.skillDocuments.repoId,
      })
      .from(t.skillDocuments)
      .where(and(eq(t.skillDocuments.skillId, skillId), eq(t.skillDocuments.repoId, repoId)))
      .orderBy(asc(t.skillDocuments.order));
    return rows.map((r) => ({ path: r.path, order: r.order, repo_id: r.repoId }));
  }

  /**
   * Replace the linked-documents list for a skill WITHIN one repository with
   * `paths`, assigning order = index. Mirrors `agents/repository.ts`
   * `setDocuments`: dedupe + a transaction-scoped advisory lock serializes
   * concurrent calls for the SAME skill (the vendored Checkbox double-fires
   * onChange), so the plain delete-all + insert can't deadlock or hit the
   * `(skill_id, repo_id, path)` PK twice. Attaching/detaching documents is
   * metadata — it must NOT bump `skills.version` (versioning keys strictly on
   * body changes, see `update()`/`isBodyChange`).
   *
   * Per-repo scoping (AC-29/AC-30/AC-31/AC-32): the delete + insert are both
   * scoped to `(skillId, repoId)`, so replacing/clearing repo A's list never
   * touches repo B's rows — each repo's list is fully independent.
   */
  async setDocuments(
    skillId: string,
    paths: string[],
    repoId: string,
  ): Promise<SkillDocumentLink[]> {
    const uniquePaths = [...new Set(paths)];
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${skillId}))`);

      await tx
        .delete(t.skillDocuments)
        .where(and(eq(t.skillDocuments.skillId, skillId), eq(t.skillDocuments.repoId, repoId)));
      if (uniquePaths.length > 0) {
        await tx
          .insert(t.skillDocuments)
          .values(uniquePaths.map((path, i) => ({ skillId, path, order: i, repoId })));
      }
    });
    return this.linkedDocuments(skillId, repoId);
  }
}
