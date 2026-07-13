/**
 * multi-agent-review — orchestration.
 *
 *   launch()       resolve targets, create the grouping row, fan out via the
 *                  EXISTING (untouched) reviews run seam — non-blocking.
 *   getRun()       assemble a persisted run's columns + findings + totals +
 *                  the "Where agents disagree" grouping, all derived on read.
 *   getEstimates() per-enabled-agent pre-launch estimate (mean over recent
 *                  completed runs).
 *
 * Reuses `ReviewService.runReview` (reviews module) for the actual fan-out —
 * this module never touches the run-executor. Reuses `agentsRepo`/`reviewRepo`
 * off the container rather than re-querying agents/PRs itself.
 */
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import type { AgentColumn, AgentColumnFinding, Conflict, MultiAgentRun, Severity } from '@devdigest/shared';
import { ReviewService } from '../reviews/service.js';
import type { Logger } from '../reviews/run-executor.js';
import { getPull } from '../reviews/repository/pull.repo.js';
import * as repo from './repository.js';
import { computeConflicts, type ReviewedAgentFindings } from './grouping.js';
import { toEstimateRow, type EstimateRow } from './estimate.js';

/** Map the DB's free-form `agent_runs.status` onto the contract's tri-state.
 *  Anything terminal that isn't `done` (failed, cancelled, or a stray null)
 *  reads as `failed` — it isolates cleanly from the "reviewed" set the same
 *  way an actual failure does (AC-33), and never blocks the other columns. */
function toColumnStatus(status: string | null): 'done' | 'failed' | 'running' {
  if (status === 'done') return 'done';
  if (status === 'running') return 'running';
  return 'failed';
}

function toColumnFinding(f: repo.FindingForRun): AgentColumnFinding {
  return {
    id: f.id,
    severity: f.severity as Severity,
    category: f.category,
    title: f.title,
    file: f.file,
    start_line: f.startLine,
    kind: f.kind,
  };
}

export class MultiAgentReviewService {
  private reviewService: ReviewService;

  constructor(private container: Container) {
    this.reviewService = new ReviewService(container);
  }

  /**
   * Launch a multi-agent run: create the grouping row, resolve the requested
   * agent set down to workspace-enabled agents (404 if none match), then fan
   * out via `ReviewService.runReview` — which itself returns as soon as the
   * per-agent rows exist (fire-and-forget executor, unchanged). A second
   * launch on an in-progress PR creates a brand-new row; it never reuses or
   * overwrites the earlier one (both stay independently retrievable).
   */
  async launch(
    workspaceId: string,
    prId: string,
    agentIds: string[],
    logger?: Logger,
  ): Promise<{ run_id: string; pr_id: string }> {
    const pull = await getPull(this.container.db, workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const enabled = await this.container.agentsRepo.listEnabled(workspaceId);
    const idSet = new Set(agentIds);
    const targets = enabled.filter((a) => idSet.has(a.id));
    if (targets.length === 0) throw new NotFoundError('No matching enabled agents found');

    const run = await repo.createMultiAgentRun(this.container.db, { workspaceId, prId });

    // Non-blocking: runReview creates the agent_runs rows synchronously and
    // returns immediately; the actual reviews execute in the background
    // (unchanged fire-and-forget executor — see T4).
    await this.reviewService.runReview(workspaceId, prId, targets, logger, run.id);

    return { run_id: run.id, pr_id: prId };
  }

  /**
   * Assemble the grouped run for `GET /multi-agent-runs/:id`. Totals and the
   * disagreement grouping are computed HERE, on every read — nothing about
   * them is stored (AC-36's "persist the run" is satisfied by the underlying
   * `agent_runs`/`findings` rows already being durable; this is a live view
   * over them, so a later disposition change on a finding is reflected
   * immediately on a subsequent read).
   */
  async getRun(workspaceId: string, id: string): Promise<MultiAgentRun> {
    const run = await repo.getMultiAgentRun(this.container.db, workspaceId, id);
    if (!run) throw new NotFoundError('Multi-agent run not found');

    const pull = await getPull(this.container.db, workspaceId, run.prId);

    const columnRows = await repo.getColumnsForRun(this.container.db, run.id);
    const runIds = columnRows.map((c) => c.runId);
    const [reviews, findings] = await Promise.all([
      repo.getReviewsForRuns(this.container.db, runIds),
      repo.getFindingsForRuns(this.container.db, runIds),
    ]);

    const reviewByRun = new Map(reviews.map((r) => [r.runId, r]));
    const findingsByRun = new Map<string, repo.FindingForRun[]>();
    for (const f of findings) {
      const list = findingsByRun.get(f.runId);
      if (list) list.push(f);
      else findingsByRun.set(f.runId, [f]);
    }

    const columns: AgentColumn[] = columnRows.map((c) => {
      const review = reviewByRun.get(c.runId);
      const runFindings = findingsByRun.get(c.runId) ?? [];
      return {
        run_id: c.runId,
        agent_id: c.agentId ?? '',
        agent_name: c.agentName ?? 'Unknown agent',
        provider: c.provider,
        model: c.model,
        status: toColumnStatus(c.status),
        verdict: review?.verdict ?? null,
        score: c.score,
        summary: review?.summary ?? null,
        duration_ms: c.durationMs,
        cost_usd: c.costUsd,
        findings: runFindings.map(toColumnFinding),
      };
    });

    // AC-15: totals are the SUM over columns (never Math.max — Rec A).
    const totalDurationMs = columns.reduce((sum, c) => sum + (c.duration_ms ?? 0), 0);
    const hasAnyCost = columns.some((c) => c.cost_usd != null);
    const totalCostUsd = hasAnyCost ? columns.reduce((sum, c) => sum + (c.cost_usd ?? 0), 0) : null;

    // "Reviewed-agent set" (plan, normative): status === 'done' only — failed
    // AND running are excluded, so they never show up as "did not flag".
    const reviewedInput: ReviewedAgentFindings[] = columns
      .filter((c) => c.status === 'done')
      .map((c) => ({
        agent_id: c.agent_id,
        persona: c.agent_name,
        findings: (findingsByRun.get(c.run_id) ?? []).map((f) => ({
          file: f.file,
          start_line: f.startLine,
          end_line: f.endLine,
          severity: f.severity as Severity,
          title: f.title,
          rationale: f.rationale,
        })),
      }));
    const conflicts: Conflict[] = computeConflicts(reviewedInput);

    return {
      id: run.id,
      pr_id: run.prId,
      pr_number: pull?.number ?? null,
      ran_at: run.ranAt.toISOString(),
      agent_count: columns.length,
      total_duration_ms: totalDurationMs,
      total_cost_usd: totalCostUsd,
      columns,
      conflicts,
    };
  }

  /** GET /multi-agent/estimates — one row per enabled agent (AC-11/12). */
  async getEstimates(workspaceId: string): Promise<{ estimates: EstimateRow[] }> {
    const enabled = await this.container.agentsRepo.listEnabled(workspaceId);
    const agentIds = enabled.map((a) => a.id);
    const aggregates = await repo.getCompletedRunAggregates(this.container.db, workspaceId, agentIds);
    const aggByAgent = new Map(aggregates.map((a) => [a.agentId, a]));

    const estimates = enabled.map((agent) => {
      const agg = aggByAgent.get(agent.id);
      return toEstimateRow({
        agent_id: agent.id,
        agent_name: agent.name,
        runs: agg?.runs ?? 0,
        avg_latency_ms: agg?.avgDurationMs ?? null,
        avg_cost_usd: agg?.avgCostUsd ?? null,
      });
    });

    return { estimates };
  }
}
