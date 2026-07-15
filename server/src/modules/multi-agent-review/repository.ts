/**
 * multi-agent-review data-access. Owns `multi_agent_runs` (the grouping row);
 * reads (read-only, cross-module) `agent_runs`+`agents`, and `reviews`→`findings`
 * (owned by the reviews module) to assemble a run's columns/findings and the
 * per-agent estimate aggregates. Free-function style, mirroring
 * `why-risk-brief/repository.ts` / `reviews/repository/run.repo.ts`.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

// ---- multi_agent_runs (the grouping row) -----------------------------------

export interface MultiAgentRunRow {
  id: string;
  workspaceId: string;
  prId: string;
  ranAt: Date;
}

/** A NEW row every launch — even for a PR with an already-in-progress run
 *  (never reused/overwritten; both stay independently retrievable). */
export async function createMultiAgentRun(
  db: Db,
  values: { workspaceId: string; prId: string },
): Promise<MultiAgentRunRow> {
  const [row] = await db
    .insert(t.multiAgentRuns)
    .values({ workspaceId: values.workspaceId, prId: values.prId })
    .returning();
  return row!;
}

/** Workspace-scoped read of the grouping row itself (no columns/findings). */
export async function getMultiAgentRun(
  db: Db,
  workspaceId: string,
  id: string,
): Promise<MultiAgentRunRow | undefined> {
  const [row] = await db
    .select()
    .from(t.multiAgentRuns)
    .where(and(eq(t.multiAgentRuns.id, id), eq(t.multiAgentRuns.workspaceId, workspaceId)));
  return row;
}

// ---- columns: agent_runs joined to their agent ------------------------------

export interface ColumnRow {
  runId: string;
  agentId: string | null;
  agentName: string | null;
  provider: string | null;
  model: string | null;
  status: string | null;
  score: number | null;
  durationMs: number | null;
  costUsd: number | null;
}

/** Every `agent_runs` row tagged with this multi-agent run, oldest first
 *  (stable order — also feeds the deterministic grouping input order). */
export async function getColumnsForRun(db: Db, multiAgentRunId: string): Promise<ColumnRow[]> {
  return db
    .select({
      runId: t.agentRuns.id,
      agentId: t.agentRuns.agentId,
      agentName: t.agents.name,
      provider: t.agentRuns.provider,
      model: t.agentRuns.model,
      status: t.agentRuns.status,
      score: t.agentRuns.score,
      durationMs: t.agentRuns.durationMs,
      costUsd: t.agentRuns.costUsd,
    })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(eq(t.agentRuns.multiAgentRunId, multiAgentRunId))
    .orderBy(asc(t.agentRuns.ranAt));
}

// ---- reviews + findings, keyed by run id -----------------------------------

export interface ReviewForRun {
  runId: string;
  verdict: string | null;
  summary: string | null;
}

/** The one `kind='review'` review each run produced (failed/running runs have
 *  none — `run-executor` only inserts a review on success). */
export async function getReviewsForRuns(db: Db, runIds: string[]): Promise<ReviewForRun[]> {
  if (runIds.length === 0) return [];
  const rows = await db
    .select({ runId: t.reviews.runId, verdict: t.reviews.verdict, summary: t.reviews.summary })
    .from(t.reviews)
    .where(and(inArray(t.reviews.runId, runIds), eq(t.reviews.kind, 'review')));
  return rows
    .filter((r): r is { runId: string; verdict: string | null; summary: string | null } => r.runId != null);
}

export interface FindingForRun {
  runId: string;
  id: string;
  file: string;
  startLine: number;
  endLine: number;
  severity: string;
  category: string;
  title: string;
  rationale: string;
  kind: string;
}

/** All findings for a set of agent-run ids, attributed back to the run via
 *  `reviews.run_id` (kind='review'). A failed/running run has no `reviews`
 *  row, so it naturally contributes nothing here (no extra status filter
 *  needed — matches "Failed/running agents contribute no findings"). */
export async function getFindingsForRuns(db: Db, runIds: string[]): Promise<FindingForRun[]> {
  if (runIds.length === 0) return [];
  const rows = await db
    .select({
      runId: t.reviews.runId,
      id: t.findings.id,
      file: t.findings.file,
      startLine: t.findings.startLine,
      endLine: t.findings.endLine,
      severity: t.findings.severity,
      category: t.findings.category,
      title: t.findings.title,
      rationale: t.findings.rationale,
      kind: t.findings.kind,
    })
    .from(t.findings)
    .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
    .where(and(inArray(t.reviews.runId, runIds), eq(t.reviews.kind, 'review')));
  return rows.filter((r): r is FindingForRun => r.runId != null);
}

// ---- estimates: per-agent aggregate over recent completed (`done`) runs ----

export interface AgentRunAggRaw {
  agentId: string;
  runs: number;
  avgDurationMs: number | null;
  avgCostUsd: number | null;
}

/**
 * Count + mean duration/cost per agent, over that agent's `status='done'`
 * runs in the workspace. Mirrors `SkillsRepository.getStats`'s aggregation
 * style (`skills/repository.ts:143-183`): count/avg computed in SQL here; the
 * zero-history → null shaping is left to the pure `estimate.ts` helper.
 */
export async function getCompletedRunAggregates(
  db: Db,
  workspaceId: string,
  agentIds: string[],
): Promise<AgentRunAggRaw[]> {
  // Empty array → `inArray(col, [])` would emit invalid SQL; guard with a
  // `false` predicate so the query simply matches no rows.
  const scoped = agentIds.length ? inArray(t.agentRuns.agentId, agentIds) : sql`false`;
  const rows = await db
    .select({
      agentId: t.agentRuns.agentId,
      runs: sql<number>`count(*)::int`,
      avgDurationMs: sql<number | null>`avg(${t.agentRuns.durationMs})::float`,
      avgCostUsd: sql<number | null>`avg(${t.agentRuns.costUsd})::float`,
    })
    .from(t.agentRuns)
    .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.status, 'done'), scoped))
    .groupBy(t.agentRuns.agentId);
  return rows.filter((r): r is AgentRunAggRaw => r.agentId != null);
}
