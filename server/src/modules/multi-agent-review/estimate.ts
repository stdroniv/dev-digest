/**
 * Pure math for GET /multi-agent/estimates — the honest pre-launch estimate
 * mechanic (AC-11/12/13). `repository.ts` computes the count/avg aggregates in
 * SQL (mirrors `SkillsRepository.getStats`'s style); this file only shapes the
 * zero-history → null guard, so the interesting math stays hermetically
 * unit-testable without a DB (mirrors `computeSkillStats` in
 * `modules/skills/helpers.ts`).
 */

/** One agent's raw aggregate over its recent completed (`status='done'`) runs. */
export interface AgentRunAgg {
  agent_id: string;
  agent_name: string;
  /** Row count backing the aggregate; 0 ⇒ no history. */
  runs: number;
  /** SQL avg() over `done` runs — meaningful only when `runs > 0`. */
  avg_latency_ms: number | null;
  avg_cost_usd: number | null;
}

/** GET /multi-agent/estimates response row (pinned shape; not a shared
 *  vendored contract — this endpoint is local to the multi-agent-review
 *  module and consumed directly by the client's `useAgentEstimates` hook). */
export interface EstimateRow {
  agent_id: string;
  agent_name: string;
  avg_latency_ms: number | null;
  avg_cost_usd: number | null;
  runs: number;
}

/**
 * AC-11: an agent with ≥1 recent completed run shows the mean of those runs.
 * AC-12: zero completed runs ⇒ null estimate (client shows "no history" and
 * excludes the agent from the summed total).
 */
export function toEstimateRow(agg: AgentRunAgg): EstimateRow {
  if (agg.runs <= 0) {
    return {
      agent_id: agg.agent_id,
      agent_name: agg.agent_name,
      avg_latency_ms: null,
      avg_cost_usd: null,
      runs: 0,
    };
  }
  return {
    agent_id: agg.agent_id,
    agent_name: agg.agent_name,
    avg_latency_ms: agg.avg_latency_ms,
    avg_cost_usd: agg.avg_cost_usd,
    runs: agg.runs,
  };
}
