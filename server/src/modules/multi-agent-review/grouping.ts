/**
 * "Where agents disagree" grouping (AC-26/27/28/29) — pure, no I/O.
 *
 * Clusters findings across the RUN'S REVIEWED agents (see "Reviewed-agent set"
 * in the plan — columns with `status === 'done'`; failed/running agents
 * contribute no findings and are never enumerated as "did not flag") by
 * (normalized file path, overlapping inclusive line range), using the shared
 * `rangesOverlap`/`normalizePath` kernel (lifted in T3, NOT the `eval` module's
 * copy — keeps this module onion-clean, no sibling-module import).
 *
 * Emits ONE `Conflict`-shaped row per cluster (every grouped code location —
 * both genuine disagreements AND full-consensus "duplicate" locations), per
 * AC-26/27: the section's default view shows every grouped location, and the
 * client's "Show only conflicts" toggle (T17) filters down using the same
 * classification rule (AC-29) recomputed from each row's `takes` — there is no
 * separate `is_conflict` flag on the wire (the vendored `Conflict` contract has
 * none), so the classification is inherent in the takes shape a caller reads
 * back: a cluster is a true conflict when its takes are NOT unanimous
 * (≥1 'ignored' alongside a flag) OR the flagged severities diverge.
 *
 * Findings are matched on normalized paths + numeric line ranges only — never
 * on interpreting the (foreign, PR-diff-derived) title/rationale text — per
 * the spec's "Untrusted inputs" section.
 */
import type { Conflict, ConflictTake, Severity } from '@devdigest/shared';
import { normalizePath, rangesOverlap } from '../_shared/finding-match.js';

/** A finding as seen by the grouping algorithm — the full line range (not the
 *  trimmed `AgentColumnFinding` display shape, which only carries `start_line`). */
export interface GroupableFinding {
  file: string;
  start_line: number;
  end_line: number;
  severity: Severity;
  title: string;
  /** Fallback note when `title` is empty (Q4 — plan's ConflictTake.note rule). */
  rationale?: string | null;
}

/** One reviewed agent's findings. Callers MUST pass only agents in the
 *  reviewed set (`status === 'done'`) — grouping has no status of its own to
 *  filter on, by design (keeps this module pure/DB-free). */
export interface ReviewedAgentFindings {
  agent_id: string;
  /** Display name shown in each ConflictTake (the plan calls this "persona"). */
  persona: string;
  findings: GroupableFinding[];
}

interface ClusterItem {
  agentId: string;
  persona: string;
  finding: GroupableFinding;
}

/** Do two findings occupy the "same code location"? Same normalized file +
 *  overlapping inclusive line range — no semantic/text matching (spec-mandated). */
function sameLocation(a: GroupableFinding, b: GroupableFinding): boolean {
  return (
    normalizePath(a.file) === normalizePath(b.file) &&
    rangesOverlap([a.start_line, a.end_line], [b.start_line, b.end_line])
  );
}

/**
 * Cluster every reviewed agent's findings into code locations, then build a
 * `Conflict` row per cluster with one `ConflictTake` per reviewed agent.
 * Deterministic: clustering is a stable single pass over the input order
 * (callers should pass agents/findings in a stable read order, e.g. column
 * order then DB insertion order) — no randomness, no LLM.
 */
export function computeConflicts(agents: ReviewedAgentFindings[]): Conflict[] {
  const items: ClusterItem[] = [];
  for (const agent of agents) {
    for (const finding of agent.findings) {
      items.push({ agentId: agent.agent_id, persona: agent.persona, finding });
    }
  }

  const clusters: ClusterItem[][] = [];
  for (const item of items) {
    const cluster = clusters.find((c) => c.some((m) => sameLocation(m.finding, item.finding)));
    if (cluster) cluster.push(item);
    else clusters.push([item]);
  }

  return clusters.map((cluster) => {
    // First-flag-wins per agent within a cluster (an agent rarely reports two
    // overlapping findings at the same spot; stable input order makes this
    // deterministic when it does happen).
    const findingByAgent = new Map<string, GroupableFinding>();
    for (const item of cluster) {
      if (!findingByAgent.has(item.agentId)) findingByAgent.set(item.agentId, item.finding);
    }

    const takes: ConflictTake[] = agents.map((agent): ConflictTake => {
      const finding = findingByAgent.get(agent.agent_id);
      if (finding) {
        return {
          agent_id: agent.agent_id,
          persona: agent.persona,
          verdict: finding.severity,
          note: finding.title || finding.rationale || '',
        };
      }
      return { agent_id: agent.agent_id, persona: agent.persona, verdict: 'ignored', note: '' };
    });

    // Representative file/line/title for the cluster's row header — the
    // first-encountered finding (stable given the input's stable order).
    const representative = cluster[0]!.finding;
    return {
      file: normalizePath(representative.file),
      line: representative.start_line,
      title: representative.title,
      is_conflict: takesConflict(takes),
      takes,
    };
  });
}

/**
 * AC-29's conflict classification, exposed as a pure predicate so callers
 * (unit tests here, and — if ever needed — a server-side filter) can decide
 * "is this row a genuine conflict, or does everyone agree" from a `Conflict`'s
 * `takes` alone, without re-deriving it from raw findings.
 */
export function isGenuineConflict(conflict: Conflict): boolean {
  return takesConflict(conflict.takes);
}

/** AC-29 predicate over a cluster's takes. Shared by `computeConflicts` (to set
 *  each row's `is_conflict`) and `isGenuineConflict` — one source of truth so the
 *  wire `is_conflict` and the predicate can't drift. */
function takesConflict(takes: ConflictTake[]): boolean {
  const flagged = takes.filter((t) => t.verdict !== 'ignored');
  const notFlagged = takes.length - flagged.length;
  const severities = new Set(flagged.map((t) => t.verdict));
  return (flagged.length >= 1 && notFlagged >= 1) || severities.size > 1;
}
