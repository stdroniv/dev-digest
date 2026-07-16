import { and, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { CiInstallationRow, CiRunRow } from '../../db/rows.js';
import type { CiRunStatus, CiTarget, RunSummary, SeverityCounts } from '@devdigest/shared';
import { groupSeverities } from '../pulls/status.js';
import type { AgentConfigRow } from './helpers.js';

export type { CiInstallationRow, CiRunRow };

/**
 * T6 — `ci` module data access (`ci_installations`, `ci_runs`, plus the
 * `agent_runs(source='ci')` rows reconcile writes). Mirrors `modules/agents/
 * repository.ts`'s pragmatic ports/adapters style (server INSIGHTS.md: no
 * strict onion) — rows in, rows out, no thrown domain errors (that's
 * `service.ts`'s job).
 */

// ---------------------------------------------------------------- installations

export interface InsertInstallation {
  agentId: string;
  repo: string;
  targetType: CiTarget;
  workflowVersion: number;
  installedConfigHash: string;
}

export interface BumpInstallation {
  workflowVersion: number;
  installedConfigHash: string;
}

// ---------------------------------------------------------------- ci_runs upsert

export interface UpsertCiRunInput {
  ciInstallationId: string;
  actionsRunId: string;
  prNumber: number | null;
  /** Best-effort PR title, resolved via GitHub during reconcile (AC-35). */
  prTitle: string | null;
  ranAt: Date;
  status: CiRunStatus;
  findingsCount: number | null;
  /** Per-severity breakdown from the artifact (AC-35's Findings column). */
  critical: number | null;
  warning: number | null;
  suggestion: number | null;
  /** Run duration from the artifact, in ms (AC-35's Duration column). */
  durationMs: number | null;
  costUsd: number | null;
  githubUrl: string | null;
  source: string;
}

export interface UpsertCiRunResult {
  row: CiRunRow;
  /**
   * True exactly once per Actions run — the reconcile call that first
   * observes a TERMINAL status (anything but `running`) for this
   * `(ciInstallationId, actionsRunId)` pair. `agent_runs` has no column
   * linking it back to a specific `ci_runs` row (T4's schema doesn't carry
   * one), so this flag is reconcile's ONLY signal for "insert the matching
   * agent_runs(source='ci') row now" — see reconcile.ts for how it's used to
   * avoid a double-insert across repeated reconcile calls (AC-30/34).
   */
  justBecameTerminal: boolean;
}

// ---------------------------------------------------------------- agent_runs (ci)

export interface InsertCiAgentRunInput {
  workspaceId: string;
  agentId: string;
  provider: string | null;
  model: string | null;
  /** The CiRunStatus string, stored verbatim (agent_runs.status has no DB
   *  enum — local runs use running/done/failed/cancelled; a CI-sourced row
   *  carries its own richer CiRunStatus vocabulary instead of being forced
   *  into that local set). */
  status: string;
  /** Failure/skip note (AC-31/32) — mirrors the existing local-run `error` column. */
  error: string | null;
  findingsCount: number | null;
  blockers: number | null;
  costUsd: number | null;
  durationMs: number | null;
}

export interface ListCiRunsFilters {
  agentId?: string;
  repo?: string;
  status?: CiRunStatus;
  /** Run origin — every `ci_runs` row is `'ci'` today (reconcile/seed), so
   *  `'local'` currently narrows to the empty set; kept for the AC-36 filter
   *  surface and applied in SQL alongside the other predicates. */
  source?: 'local' | 'ci';
  since?: string;
  until?: string;
}

/** A `ci_runs` row enriched with read-time joins T7's route needs (agent name, repo). */
export interface CiRunJoined extends CiRunRow {
  agentName: string | null;
  installationRepo: string | null;
}

export class CiRepository {
  constructor(private db: Db) {}

  // ---- installations --------------------------------------------------

  async findInstallation(agentId: string, repo: string): Promise<CiInstallationRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.ciInstallations)
      .where(and(eq(t.ciInstallations.agentId, agentId), eq(t.ciInstallations.repo, repo)));
    return row;
  }

  async insertInstallation(values: InsertInstallation): Promise<CiInstallationRow> {
    const [row] = await this.db.insert(t.ciInstallations).values(values).returning();
    return row!;
  }

  async bumpInstallation(
    id: string,
    values: BumpInstallation,
  ): Promise<CiInstallationRow | undefined> {
    const [row] = await this.db
      .update(t.ciInstallations)
      .set({
        workflowVersion: values.workflowVersion,
        installedConfigHash: values.installedConfigHash,
        updatedAt: new Date(),
      })
      .where(eq(t.ciInstallations.id, id))
      .returning();
    return row;
  }

  async listByAgent(agentId: string): Promise<CiInstallationRow[]> {
    return this.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId))
      .orderBy(desc(t.ciInstallations.installedAt));
  }

  /** Every installation, across every agent/workspace — the reconcile sweep's input (AC-34). */
  async listAllInstallations(): Promise<CiInstallationRow[]> {
    return this.db.select().from(t.ciInstallations);
  }

  /**
   * Names of every OTHER agent in `workspaceId` that has at least one CI
   * installation (i.e. has been exported before) — the slug-collision input
   * for `SlugAllocator`/`resolveAgentSlug` (AC-15/17). Deliberately excludes
   * `excludeAgentId` so re-exporting the SAME agent recomputes the SAME slug.
   */
  async otherExportedAgentNames(workspaceId: string, excludeAgentId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ name: t.agents.name })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(
        and(eq(t.agents.workspaceId, workspaceId), ne(t.ciInstallations.agentId, excludeAgentId)),
      );
    return rows.map((r) => r.name);
  }

  /**
   * An agent's CI-relevant config fields by id, WITHOUT workspace scoping —
   * needed by reconcile.ts, which sweeps installations across every
   * workspace and has no per-request workspace context (unlike
   * `AgentsRepository.getById`, which is always workspace-scoped). Shape
   * matches `helpers.ts`'s `AgentConfigRow` exactly, so `toBundleAgent(...)`
   * accepts it directly.
   */
  async getAgentConfig(
    agentId: string,
  ): Promise<(AgentConfigRow & { workspaceId: string }) | undefined> {
    const [row] = await this.db
      .select({
        workspaceId: t.agents.workspaceId,
        name: t.agents.name,
        provider: t.agents.provider,
        model: t.agents.model,
        systemPrompt: t.agents.systemPrompt,
        strategy: t.agents.strategy,
        ciFailOn: t.agents.ciFailOn,
      })
      .from(t.agents)
      .where(eq(t.agents.id, agentId));
    return row;
  }

  // ---- ci_runs ----------------------------------------------------------

  /** The most recent run for an installation — drives the AC-39 derived `status`/`last_run_at`. */
  async latestRunForInstallation(installationId: string): Promise<CiRunRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.ciRuns)
      .where(eq(t.ciRuns.ciInstallationId, installationId))
      .orderBy(sql`${t.ciRuns.ranAt} DESC NULLS LAST`)
      .limit(1);
    return row;
  }

  /**
   * Idempotent upsert keyed by `(ciInstallationId, actionsRunId)` — mirrors
   * the T4 unique index, so a repeated reconcile of the SAME Actions run
   * updates the existing row instead of inserting a duplicate (AC-30/34).
   * Select-then-branch (not `onConflictDoUpdate`) so we can compare the
   * PREVIOUS status to the new one and report `justBecameTerminal`.
   */
  async upsertCiRun(values: UpsertCiRunInput): Promise<UpsertCiRunResult> {
    const [existing] = await this.db
      .select()
      .from(t.ciRuns)
      .where(
        and(
          eq(t.ciRuns.ciInstallationId, values.ciInstallationId),
          eq(t.ciRuns.actionsRunId, values.actionsRunId),
        ),
      );

    const isTerminal = values.status !== 'running';
    const wasTerminal = existing ? existing.status !== 'running' && existing.status != null : false;
    const justBecameTerminal = isTerminal && !wasTerminal;

    if (existing) {
      const [row] = await this.db
        .update(t.ciRuns)
        .set({
          prNumber: values.prNumber,
          prTitle: values.prTitle,
          ranAt: values.ranAt,
          status: values.status,
          findingsCount: values.findingsCount,
          critical: values.critical,
          warning: values.warning,
          suggestion: values.suggestion,
          durationMs: values.durationMs,
          costUsd: values.costUsd,
          githubUrl: values.githubUrl,
          source: values.source,
        })
        .where(eq(t.ciRuns.id, existing.id))
        .returning();
      return { row: row!, justBecameTerminal };
    }

    const [row] = await this.db.insert(t.ciRuns).values(values).returning();
    return { row: row!, justBecameTerminal };
  }

  /**
   * All ingested CI runs for one workspace, newest first, joined with the
   * owning agent's name and the installation's repo (T7's `GET /ci-runs`,
   * AC-35/36). Scoped by `eq(t.agents.workspaceId, workspaceId)` — mirrors
   * `listAgentRuns`'s `eq(t.agentRuns.workspaceId, workspaceId)` scoping — so
   * this never returns another workspace's runs (security fix: previously
   * unscoped). NOTE: T4's `ci_runs` schema carries only an aggregate
   * `findings_count` (no critical/warning/suggestion columns) and no
   * duration/pr_title columns — `service.ts`'s `toCiRunDto` maps those
   * unavailable DTO fields to null/nullish rather than fabricating them.
   */
  async listCiRuns(workspaceId: string, filters: ListCiRunsFilters = {}): Promise<CiRunJoined[]> {
    const conditions = [eq(t.agents.workspaceId, workspaceId)];
    if (filters.agentId) conditions.push(eq(t.ciInstallations.agentId, filters.agentId));
    if (filters.repo) conditions.push(eq(t.ciInstallations.repo, filters.repo));
    if (filters.status) conditions.push(eq(t.ciRuns.status, filters.status));
    if (filters.source) conditions.push(eq(t.ciRuns.source, filters.source));
    if (filters.since) conditions.push(gte(t.ciRuns.ranAt, new Date(filters.since)));
    if (filters.until) conditions.push(lte(t.ciRuns.ranAt, new Date(filters.until)));

    const rows = await this.db
      .select({
        run: t.ciRuns,
        agentName: t.agents.name,
        installationRepo: t.ciInstallations.repo,
      })
      .from(t.ciRuns)
      .leftJoin(t.ciInstallations, eq(t.ciInstallations.id, t.ciRuns.ciInstallationId))
      .leftJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(and(...conditions))
      .orderBy(sql`${t.ciRuns.ranAt} DESC NULLS LAST`);

    return rows.map((r) => ({ ...r.run, agentName: r.agentName, installationRepo: r.installationRepo }));
  }

  // ---- agent_runs(source='ci') ------------------------------------------

  async insertAgentRun(values: InsertCiAgentRunInput): Promise<string> {
    const [row] = await this.db
      .insert(t.agentRuns)
      .values({
        workspaceId: values.workspaceId,
        agentId: values.agentId,
        prId: null,
        provider: values.provider,
        model: values.model,
        status: values.status,
        error: values.error,
        source: 'ci',
        findingsCount: values.findingsCount,
        grounding: null,
        score: null,
        blockers: values.blockers,
        costUsd: values.costUsd,
        durationMs: values.durationMs,
      })
      .returning({ id: t.agentRuns.id });
    return row!.id;
  }

  /**
   * Every run (local AND CI) for one agent, newest first — the Stats tab's
   * run history (AC-42). Mirrors `reviews/repository/run.repo.ts`'s
   * `listRunsForPull` exactly, but scoped by `agentId` instead of `prId`:
   * per-severity counts are computed FRESH from `findings -> reviews` for
   * LOCAL rows only (server INSIGHTS.md: don't trust the denormalized
   * columns when a fresher join target exists); CI rows have no local
   * findings/review rows by design (AC-30 — "without reconstructing a local
   * per-finding trace"), so they fall back to the denormalized
   * `findings_count`/`blockers` aggregates, which for them ARE the source of
   * truth (there is nothing fresher to join).
   */
  async listAgentRuns(workspaceId: string, agentId: string): Promise<RunSummary[]> {
    const rows = await this.db
      .select({ run: t.agentRuns, agentName: t.agents.name })
      .from(t.agentRuns)
      .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
      .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.agentId, agentId)))
      .orderBy(sql`${t.agentRuns.ranAt} DESC NULLS LAST`);

    const localRunIds = rows.filter((r) => r.run.source === 'local').map((r) => r.run.id);
    let countsByRun = new Map<string, SeverityCounts>();
    if (localRunIds.length > 0) {
      const findingRows = await this.db
        .select({ runId: t.reviews.runId, severity: t.findings.severity })
        .from(t.findings)
        .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
        .where(inArray(t.reviews.runId, localRunIds));
      countsByRun = groupSeverities(
        findingRows
          .filter((f) => f.runId != null)
          .map((f) => ({ key: f.runId as string, severity: f.severity })),
      );
    }

    return rows.map(({ run, agentName }) => {
      const c = run.source === 'local' ? countsByRun.get(run.id) : undefined;
      return {
        run_id: run.id,
        agent_id: run.agentId,
        agent_name: agentName ?? null,
        provider: run.provider,
        model: run.model,
        status: run.status,
        error: run.error,
        duration_ms: run.durationMs,
        tokens_in: run.tokensIn,
        tokens_out: run.tokensOut,
        findings_count: c ? c.critical + c.warning + c.suggestion : run.findingsCount,
        grounding: run.grounding,
        ran_at: run.ranAt ? run.ranAt.toISOString() : null,
        score: run.score,
        blockers: c ? c.critical : run.blockers,
        cost_usd: run.costUsd,
        findings_counts: c ?? null,
        source: run.source,
      };
    });
  }
}
