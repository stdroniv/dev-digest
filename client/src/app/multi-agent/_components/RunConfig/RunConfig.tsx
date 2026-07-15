/* RunConfig/RunConfig.tsx — the Configure-run experience (SPEC-05, T14).
   Faithful port of the mock `RunConfig` (`8bb91114:107-148`) with the plan's
   HONEST copy + math: totals are the SUM of per-agent estimates (never
   `Math.max`), and no string claims parallelism (all copy from `multiAgent`
   i18n, never inlined).

   Two-step flow (AC-6): step 1 picks a PR via a searchable select (only
   non-stale PRs listed, AC-7; the vendor `SearchableSelect` filters by number
   and title so a repo with many open PRs stays navigable);
   step 2 is gated behind a "Pick a pull request first" empty state until a PR
   is chosen (AC-8), then lists one `PersonaPickCard` per enabled agent (AC-9)
   with its estimate or "no history" (AC-11/12). The run bar uses the
   Configure-page label logic and shows the summed estimate only when a PR and
   ≥1 agent are selected (AC-13).

   This component only RAISES `onRun(prId, agentIds)`; the launch + navigation
   are the page's job (T18). `preselectedPr`/`preselectedAgents` seed the
   selection so the results page's "Configure run" affordance round-trips
   (AC-17). */
"use client";

import React, { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, SearchableSelect } from "@devdigest/ui";
import { useAgents } from "@/lib/hooks/agents";
import { useAgentEstimates, type EstimateRow } from "@/lib/hooks/multi-agent";
import { agentVisual } from "@/lib/agent-visuals";
import { PersonaPickCard } from "./PersonaPickCard";
import { usePrOptions } from "./usePrOptions";
import { PR_DROPDOWN_WIDTH } from "./constants";
import { s } from "./styles";

export interface RunConfigProps {
  /** Preselected PR id (AC-17, from the results page's `?pr=`). */
  preselectedPr?: string | null;
  /** Preselected agent ids (AC-17, from the results page's `?agents=`). */
  preselectedAgents?: string[];
  /** Raised when the run bar is activated with a PR + ≥1 agent selected. The
   *  actual launch + navigation live in the page (T18). */
  onRun: (prId: string, agentIds: string[]) => void;
}

/** A recent-run estimate is "usable" (contributes to the summed total and shows
 *  a time/cost guideline) only when the agent has history with real numbers;
 *  otherwise the agent is shown as "no history" and excluded (AC-12). */
function usableEstimate(est: EstimateRow | undefined): est is EstimateRow & {
  avg_latency_ms: number;
  avg_cost_usd: number;
} {
  return !!est && est.runs > 0 && est.avg_latency_ms != null && est.avg_cost_usd != null;
}

export function RunConfig({ preselectedPr, preselectedAgents, onRun }: RunConfigProps) {
  const t = useTranslations("multiAgent");
  const { prs } = usePrOptions();
  const { data: agents } = useAgents();
  const { data: estimatesData } = useAgentEstimates();

  const [selectedPrId, setSelectedPrId] = useState<string | null>(preselectedPr ?? null);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>(preselectedAgents ?? []);

  const enabledAgents = (agents ?? []).filter((a) => a.enabled);
  const enabledIds = enabledAgents.map((a) => a.id);

  // AC-7 — only eligible (non-stale) PRs are selectable.
  const eligiblePrs = prs.filter((p) => p.status !== "stale");
  const selectedPr = eligiblePrs.find((p) => p.id === selectedPrId) ?? null;
  const hasPr = !!selectedPr;

  const estimateById = useMemo(() => {
    const map = new Map<string, EstimateRow>();
    for (const e of estimatesData?.estimates ?? []) map.set(e.agent_id, e);
    return map;
  }, [estimatesData]);

  // AC-7+ — the PR picker is searchable (filters by number and title) so a
  // repo with many open PRs stays navigable.
  const prOptions = eligiblePrs.map((p) => ({
    value: p.id,
    label: t("configure.prItem", { number: p.number, title: p.title }),
  }));

  const toggle = (id: string) =>
    setSelectedAgentIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    );
  const allOn = enabledIds.length > 0 && enabledIds.every((id) => selectedAgentIds.includes(id));
  const setAll = (on: boolean) => setSelectedAgentIds(on ? enabledIds : []);

  // AC-13 — total = SUM of the selected agents' estimated time/cost, excluding
  // no-history agents (AC-12). Never `Math.max`; execution is sequential.
  let sumLatencyMs = 0;
  let sumCost = 0;
  for (const id of selectedAgentIds) {
    const est = estimateById.get(id);
    if (usableEstimate(est)) {
      sumLatencyMs += est.avg_latency_ms;
      sumCost += est.avg_cost_usd;
    }
  }

  const count = selectedAgentIds.length;
  const runLabel =
    count > 1
      ? t("configure.runBar.runMany", { count })
      : count === 1
        ? t("configure.runBar.runOne")
        : t("configure.runBar.select");

  const guidelineFor = (agentId: string): string => {
    const est = estimateById.get(agentId);
    return usableEstimate(est)
      ? t("common.durationCost", {
          seconds: (est.avg_latency_ms / 1000).toFixed(1),
          cost: "$" + est.avg_cost_usd.toFixed(2),
        })
      : t("common.noHistory");
  };

  return (
    <div style={s.root}>
      <h1 style={s.title}>{t("configure.title")}</h1>
      <p style={s.subtitle}>{t("configure.subtitle")}</p>

      {/* step 1 — pull request */}
      <div style={s.stepRow}>
        <span style={{ ...s.stepBadge, background: "var(--accent-bg)", color: "var(--accent-text)" }}>
          1
        </span>
        <span style={s.stepLabel}>{t("configure.step1Label")}</span>
      </div>
      <div style={{ ...s.prSlot, width: PR_DROPDOWN_WIDTH }}>
        <SearchableSelect
          value={selectedPrId ?? ""}
          onChange={setSelectedPrId}
          options={prOptions}
          placeholder={t("configure.prPlaceholder")}
          mono={false}
        />
      </div>

      {/* step 2 — agents to run (gated on a chosen PR) */}
      <div style={s.stepRow}>
        <span
          style={{
            ...s.stepBadge,
            background: hasPr ? "var(--accent-bg)" : "var(--bg-hover)",
            color: hasPr ? "var(--accent-text)" : "var(--text-muted)",
          }}
        >
          2
        </span>
        <span style={{ ...s.stepLabel, color: hasPr ? "var(--text-primary)" : "var(--text-muted)" }}>
          {t("configure.step2Label")}
        </span>
        {hasPr && (
          <button type="button" style={s.selectAllBtn} onClick={() => setAll(!allOn)}>
            {allOn ? t("configure.clearAll") : t("common.selectAll")}
          </button>
        )}
      </div>

      {hasPr ? (
        <div style={s.agentList}>
          {enabledAgents.map((a) => {
            const v = agentVisual({ id: a.id, name: a.name });
            return (
              <PersonaPickCard
                key={a.id}
                name={a.name}
                summary={a.description}
                color={v.color}
                icon={v.icon}
                guideline={guidelineFor(a.id)}
                on={selectedAgentIds.includes(a.id)}
                onToggle={() => toggle(a.id)}
              />
            );
          })}
        </div>
      ) : (
        <div style={s.emptyBox}>
          <div style={s.emptyIconTile}>
            <Icon.GitPullRequest size={21} style={{ color: "var(--text-muted)" }} />
          </div>
          <div style={s.emptyTitle}>{t("configure.noPr.title")}</div>
          <p style={s.emptyBody}>{t("configure.noPr.body")}</p>
        </div>
      )}

      {/* run bar */}
      <div style={s.runBar}>
        <Button
          kind="primary"
          icon="Users"
          disabled={!hasPr || count === 0}
          onClick={() => selectedPr && onRun(selectedPr.id, selectedAgentIds)}
        >
          {runLabel}
        </Button>
        {hasPr && count > 0 && (
          <span className="mono" style={s.estimate}>
            {t("configure.estimate", {
              seconds: (sumLatencyMs / 1000).toFixed(1),
              cost: "$" + sumCost.toFixed(2),
              count,
            })}
          </span>
        )}
      </div>
    </div>
  );
}
