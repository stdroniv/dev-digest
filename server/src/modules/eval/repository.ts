import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * T4 — eval data-access. Owns `eval_cases` / `eval_runs`. Workspace-scoped
 * throughout (cases carry `workspace_id`; runs are scoped via their case).
 *
 * Deleting a case (AC-24) must NOT hard-DELETE the row: `eval_runs.case_id`
 * has `onDelete: 'cascade'` (schema/eval.ts), so a real delete would silently
 * erase every historical run that ever scored this case — the opposite of
 * "prior runs that already scored it remain in history". Instead we
 * SOFT-EXCLUDE: mark `input_meta._deleted = true` on the case row (jsonb,
 * requires no schema/migration change) and filter it out of every "live set"
 * read (`listCasesForOwner`, and therefore `latestRunsForOwner`'s derived
 * aggregate). The row — and every `eval_runs` row that points at it — stays
 * fully intact and independently queryable (by id, or via a past
 * `run_group_id`), so old runs stay reproducible/inspectable. See
 * `server/INSIGHTS.md` for the write-up of why this approach (over adding a
 * migration) was chosen.
 */

import type { EvalCaseRow, EvalRunRow } from '../../db/rows.js';
export type { EvalCaseRow, EvalRunRow };

const DELETED_KEY = '_deleted';

function metaOf(row: Pick<EvalCaseRow, 'inputMeta'>): Record<string, unknown> {
  return (row.inputMeta as Record<string, unknown> | null) ?? {};
}

function isDeleted(row: Pick<EvalCaseRow, 'inputMeta'>): boolean {
  return metaOf(row)[DELETED_KEY] === true;
}

export interface InsertEvalCase {
  workspaceId: string;
  ownerKind: 'skill' | 'agent';
  ownerId: string;
  name: string;
  inputDiff?: string | null;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
}

export interface UpdateEvalCase {
  name?: string;
  inputDiff?: string | null;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
}

export interface InsertEvalRun {
  caseId: string;
  actualOutput: unknown;
  pass: boolean;
  recall: number;
  precision: number;
  citationAccuracy: number;
  durationMs: number;
  costUsd: number | null;
  runGroupId: string;
  agentVersion: number | null;
}

/** One run_group's rows + a derived summary (ran_at = latest row's ran_at). */
export interface RunGroupRows {
  runGroupId: string;
  agentVersion: number | null;
  ranAt: Date;
  rows: EvalRunRow[];
}

export class EvalRepository {
  constructor(private db: Db) {}

  // ---- cases ----------------------------------------------------------------

  async insertCase(values: InsertEvalCase): Promise<EvalCaseRow> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        name: values.name,
        inputDiff: values.inputDiff ?? null,
        inputFiles: (values.inputFiles as object | null | undefined) ?? null,
        inputMeta: (values.inputMeta as object | null | undefined) ?? null,
        expectedOutput: (values.expectedOutput as object | undefined) ?? [],
        notes: values.notes ?? null,
      })
      .returning();
    return row!;
  }

  /** A live (non-soft-deleted) case, workspace-scoped. */
  async getCase(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    const row = await this.getCaseIncludingDeleted(workspaceId, id);
    return row && !isDeleted(row) ? row : undefined;
  }

  /** Resolve a case regardless of live-set membership — used for run-history
   *  joins (a deleted case's name must still show up on its old runs). */
  async getCaseIncludingDeleted(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
    return row;
  }

  /** The live set of cases for an owner (agent/skill) — soft-deleted excluded. */
  async listCasesForOwner(
    workspaceId: string,
    ownerKind: 'skill' | 'agent',
    ownerId: string,
  ): Promise<EvalCaseRow[]> {
    const rows = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      );
    return rows.filter((r) => !isDeleted(r));
  }

  /**
   * Find a case previously frozen from this exact finding (idempotency key
   * stored in `input_meta.source_finding_id` — AC-5). Includes soft-deleted
   * cases, so re-clicking after a delete surfaces "already added" rather than
   * silently minting a duplicate.
   */
  async findByFindingId(
    workspaceId: string,
    ownerId: string,
    findingId: string,
  ): Promise<EvalCaseRow | undefined> {
    const rows = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, ownerId),
        ),
      );
    return rows.find((r) => metaOf(r).source_finding_id === findingId);
  }

  async updateCase(
    workspaceId: string,
    id: string,
    patch: UpdateEvalCase,
  ): Promise<EvalCaseRow | undefined> {
    const existing = await this.getCase(workspaceId, id);
    if (!existing) return undefined;
    const [row] = await this.db
      .update(t.evalCases)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.inputDiff !== undefined ? { inputDiff: patch.inputDiff } : {}),
        ...(patch.inputFiles !== undefined ? { inputFiles: patch.inputFiles as object | null } : {}),
        ...(patch.inputMeta !== undefined ? { inputMeta: patch.inputMeta as object | null } : {}),
        ...(patch.expectedOutput !== undefined
          ? { expectedOutput: patch.expectedOutput as object }
          : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning();
    return row;
  }

  /** Soft-delete (see class doc for why). Returns false if the case wasn't
   *  found live in this workspace. */
  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    const existing = await this.getCase(workspaceId, id);
    if (!existing) return false;
    const meta = { ...metaOf(existing), [DELETED_KEY]: true };
    await this.db
      .update(t.evalCases)
      .set({ inputMeta: meta })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
    return true;
  }

  // ---- runs -------------------------------------------------------------

  async insertRun(values: InsertEvalRun): Promise<EvalRunRow> {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({
        caseId: values.caseId,
        actualOutput: values.actualOutput as object,
        pass: values.pass,
        recall: values.recall,
        precision: values.precision,
        citationAccuracy: values.citationAccuracy,
        durationMs: values.durationMs,
        costUsd: values.costUsd,
        runGroupId: values.runGroupId,
        agentVersion: values.agentVersion,
      })
      .returning();
    return row!;
  }

  /**
   * The LATEST run row per case, for every case CURRENTLY in the live set
   * (AC-25: the derived aggregate always reads the latest per-case record,
   * never a second persisted row). A soft-deleted case's rows are excluded
   * going forward (it's no longer part of "the set"), though they remain
   * queryable via `runsForGroup`/`getRunGroupRows` for any run_group that
   * scored it in the past.
   */
  async latestRunsForOwner(
    workspaceId: string,
    ownerKind: 'skill' | 'agent',
    ownerId: string,
  ): Promise<(EvalRunRow & { caseName: string })[]> {
    const cases = await this.listCasesForOwner(workspaceId, ownerKind, ownerId);
    if (cases.length === 0) return [];
    const caseIds = cases.map((c) => c.id);
    const runs = await this.db
      .select()
      .from(t.evalRuns)
      .where(inArray(t.evalRuns.caseId, caseIds))
      .orderBy(desc(t.evalRuns.ranAt));
    const byCase = new Map<string, EvalRunRow>();
    for (const r of runs) {
      if (!byCase.has(r.caseId)) byCase.set(r.caseId, r);
    }
    const nameById = new Map(cases.map((c) => [c.id, c.name]));
    return [...byCase.values()].map((r) => ({ ...r, caseName: nameById.get(r.caseId) ?? '' }));
  }

  /** All rows for one `run_group_id` (one full "run all evals" batch). */
  async runsForGroup(runGroupId: string): Promise<(EvalRunRow & { caseName: string | null })[]> {
    const rows = await this.db
      .select({ run: t.evalRuns, caseName: t.evalCases.name })
      .from(t.evalRuns)
      .leftJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(eq(t.evalRuns.runGroupId, runGroupId));
    return rows.map((r) => ({ ...r.run, caseName: r.caseName }));
  }

  /**
   * Distinct run_groups for an owner, newest first — one entry per "run all
   * evals" / single-case-run batch (AC-15 history). Reads ALL cases ever
   * owned (including soft-deleted, so a past run_group that included a since-
   * deleted case still shows its full row set — its snapshot in time, per
   * AC-24). `ranAt` is the max `ran_at` across the group's rows.
   */
  async listRunGroups(
    workspaceId: string,
    ownerKind: 'skill' | 'agent',
    ownerId: string,
  ): Promise<RunGroupRows[]> {
    const cases = await this.db
      .select({ id: t.evalCases.id })
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      );
    if (cases.length === 0) return [];
    const caseIds = cases.map((c) => c.id);
    const runs = await this.db
      .select()
      .from(t.evalRuns)
      .where(inArray(t.evalRuns.caseId, caseIds))
      .orderBy(desc(t.evalRuns.ranAt));

    const groups = new Map<string, EvalRunRow[]>();
    for (const r of runs) {
      // Pre-T2 rows (back-compat, ungrouped) have no run_group_id — excluded
      // from grouped history (they predate this feature).
      if (!r.runGroupId) continue;
      const arr = groups.get(r.runGroupId) ?? [];
      arr.push(r);
      groups.set(r.runGroupId, arr);
    }
    return [...groups.entries()]
      .map(([runGroupId, rows]) => ({
        runGroupId,
        agentVersion: rows[0]!.agentVersion,
        ranAt: rows.reduce((max, r) => (r.ranAt > max ? r.ranAt : max), rows[0]!.ranAt),
        rows,
      }))
      .sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime());
  }

  async getRunGroupRows(runGroupId: string): Promise<EvalRunRow[]> {
    return this.db.select().from(t.evalRuns).where(eq(t.evalRuns.runGroupId, runGroupId));
  }
}
