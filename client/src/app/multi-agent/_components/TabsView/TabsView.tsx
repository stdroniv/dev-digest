/* TabsView — Multi-Agent Review "Tabs + detail" view (SPEC-05 AC-21/22/32).

   Design: `8bb91114` `TabsView` (lines ~67-91). Pixel-faithful EXCEPT the
   honest overrides pinned in the plan — no "parallel" copy, totals are SUM
   (owned by the parent page), and the score-color threshold is the vendored
   75/50 (NOT the mock's 70).

   A tab per agent (icon + name + score, active tab underlined in the agent
   color); a detail panel (CircularScore 44 + agent name in the agent color +
   summary + right-side "View trace" + mono "<dur>s · $<cost>"); then a
   `MultiAgentFindingCard` per finding.

   `AgentColumnFinding` is lean, so per-finding confidence + suggested fix come
   from the PR's full persisted findings (`usePrReviews(prId)`) matched by id —
   the server contract stays unchanged (finding ids are stable across both
   sources). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { CircularScore, Icon, MonoLink } from "@devdigest/ui";
import type { AgentColumn, FindingRecord } from "@devdigest/shared";
import { agentVisual } from "@/lib/agent-visuals";
import { usePrReviews } from "@/lib/hooks/reviews";
import { MultiAgentFindingCard } from "./MultiAgentFindingCard";
import { s } from "./styles";

/** Vendored `CircularScore` threshold (plan "Design → real primitive map"):
 *  >=75 ok / >=50 warn / else crit. The mock's 70 is drift — do not use it. */
function scoreColor(score: number): string {
  return score >= 75 ? "var(--ok)" : score >= 50 ? "var(--warn)" : "var(--crit)";
}

export function TabsView({
  columns,
  prId,
  onViewTrace,
}: {
  columns: AgentColumn[];
  /** The reviewed PR — used to enrich each lean finding with its confidence +
   *  suggested fix from the PR's full persisted findings. */
  prId: string;
  /** Opens the given agent's run trace / live log (AC-32); wired by the page. */
  onViewTrace: (column: AgentColumn) => void;
}) {
  const t = useTranslations("multiAgent");
  const [sel, setSel] = React.useState(0);
  const { data: reviews } = usePrReviews(prId);

  // Finding-detail lookup by id (confidence + suggestion + rationale). Same
  // persisted findings as the columns, just the full shape (AC-22 enrichment).
  const detailById = React.useMemo(() => {
    const map = new Map<string, FindingRecord>();
    for (const r of reviews ?? []) for (const f of r.findings) map.set(f.id, f);
    return map;
  }, [reviews]);

  if (columns.length === 0) return null;
  const safeSel = sel < columns.length ? sel : 0;
  const active = columns[safeSel]!;
  const activeVisual = agentVisual({ id: active.agent_id, name: active.agent_name });

  return (
    <div style={s.root}>
      <div style={s.tabBar} role="tablist" aria-label={t("results.title")}>
        {columns.map((col, i) => {
          const on = i === safeSel;
          const visual = agentVisual({ id: col.agent_id, name: col.agent_name });
          const TabIcon = Icon[visual.icon];
          return (
            <button
              key={col.run_id}
              role="tab"
              aria-selected={on}
              onClick={() => setSel(i)}
              style={s.tab(on, visual.color)}
            >
              <TabIcon size={15} style={{ color: on ? visual.color : "var(--text-muted)" }} />
              <span style={s.tabName(on)}>{col.agent_name}</span>
              {col.status === "done" && col.score != null ? (
                <span className="tnum" style={s.tabScore(scoreColor(col.score))}>
                  {col.score}
                </span>
              ) : (
                <span aria-label={col.status} style={s.statusDot(col.status)} />
              )}
            </button>
          );
        })}
      </div>

      <div style={s.detailWrap} role="tabpanel">
        <div style={s.detailCard(activeVisual.color)}>
          {active.score != null && <CircularScore score={active.score} size={44} />}
          <div style={s.detailIdentity}>
            <div style={s.detailName(activeVisual.color)}>{active.agent_name}</div>
            <p style={s.detailSummary}>{active.summary ?? t("tabs.noSummary")}</p>
          </div>
          <div style={s.detailMeta}>
            <MonoLink onClick={() => onViewTrace(active)}>{t("common.viewTrace")}</MonoLink>
            {active.duration_ms != null && (
              <span className="mono tnum" style={s.detailMetaMono}>
                {t("common.durationCost", {
                  seconds: (active.duration_ms / 1000).toFixed(1),
                  cost: "$" + (active.cost_usd ?? 0).toFixed(2),
                })}
              </span>
            )}
          </div>
        </div>

        <div style={s.findingList}>
          {active.findings.map((f) => (
            <MultiAgentFindingCard
              key={f.id}
              finding={f}
              detail={detailById.get(f.id)}
              prId={prId}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
