/* AgentPicker — PR-page agent picker (SPEC-05, replaces `RunReviewDropdown`).
   Pixel-faithful to the design mock's `RunReviewDropdown` (0d4883bb:24-65) with
   honest copy. Lists every ENABLED agent with a real time/cost guideline + a
   checkbox, plus Select all / Clear and a "Configure agents…" footer.

   Primary-button behaviour (PR-page variant):
   - 0 selected  → "Select an agent" (disabled)                       (AC-3)
   - exactly 1   → "Run <agent name>" → INLINE single-agent review via
                   the existing `useRunReview`, no multi-agent run,
                   preserving today's inline SSE/accordion hand-off     (AC-4)
   - N>1         → "Run multi-agent review (N)" → launch a multi-agent
                   run and navigate to its results page                 (AC-5)

   The individual agent runs still surface in the PR run history via the
   unchanged `GET /pulls/:id/runs` (AC-38); this picker adds no grouped
   multi-agent-run entry to the PR reviews list (AC-39). */
"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Icon } from "@devdigest/ui";
import { useAgents } from "@/lib/hooks/agents";
import { useRunReview } from "@/lib/hooks/reviews";
import { useAgentEstimates, useLaunchMultiAgentRun, type EstimateRow } from "@/lib/hooks/multi-agent";
import { agentVisual } from "@/lib/agent-visuals";
import { s, checkboxStyle, rowStyle } from "./styles";

/** A recent-run estimate is "usable" (shows a time/cost guideline) only when the
 *  agent has history with real numbers; otherwise it shows "no history" (AC-12).
 *  Mirrors the Configure page's `usableEstimate` for a consistent guideline. */
function usableEstimate(est: EstimateRow | undefined): est is EstimateRow & {
  avg_latency_ms: number;
  avg_cost_usd: number;
} {
  return !!est && est.runs > 0 && est.avg_latency_ms != null && est.avg_cost_usd != null;
}

export function AgentPicker({
  prId,
  size = "sm",
  kind = "primary",
  warnMerged = false,
  onRunStart,
  onRunsStarted,
  onRunSettled,
}: {
  prId: string;
  size?: "sm" | "md" | "lg";
  kind?: "primary" | "secondary";
  /** PR is already merged/closed — dim the trigger and warn, but still allow. */
  warnMerged?: boolean;
  /** Fired the moment an inline single-agent run is kicked off (AC-4). */
  onRunStart?: () => void;
  /** Hands the inline run's ids up so the PR page can stream SSE live status. */
  onRunsStarted?: (runIds: string[]) => void;
  /** Fired when an inline run request settles (success or error). */
  onRunSettled?: () => void;
}) {
  const t = useTranslations("multiAgent");
  // The trigger is generic PR-review chrome, not multi-agent copy — reuse the
  // existing, correct label from the `prReview` namespace (as RunReviewDropdown did).
  const tPr = useTranslations("prReview");
  const router = useRouter();
  const { data: agents } = useAgents();
  const { data: estimatesData } = useAgentEstimates();
  const run = useRunReview();
  const launch = useLaunchMultiAgentRun();

  const [open, setOpen] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Close on outside click while open (mock behaviour).
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // AC-2 — every ENABLED agent in the workspace.
  const enabledAgents = (agents ?? []).filter((a) => a.enabled);
  const enabledIds = enabledAgents.map((a) => a.id);

  // `null` selection = untouched ⇒ default to all enabled (mock default, and
  // preserves the prior "Run Review" = run-all default). Once the user toggles /
  // clears / selects-all, the choice is explicit and survives agent refetches.
  const [sel, setSel] = useState<string[] | null>(null);
  const selected = sel ?? enabledIds;

  const toggle = (id: string) =>
    setSel((cur) => {
      const base = cur ?? enabledIds;
      return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    });
  const allOn = enabledIds.length > 0 && enabledIds.every((id) => selected.includes(id));
  const setAll = (on: boolean) => setSel(on ? enabledIds : []);

  const estimateById = new Map<string, EstimateRow>(
    (estimatesData?.estimates ?? []).map((e) => [e.agent_id, e]),
  );
  const guidelineFor = (agentId: string): string => {
    const est = estimateById.get(agentId);
    return usableEstimate(est)
      ? t("common.durationCost", {
          seconds: (est.avg_latency_ms / 1000).toFixed(1),
          cost: "$" + est.avg_cost_usd.toFixed(2),
        })
      : t("common.noHistory");
  };

  const busy = run.isPending || launch.isPending;
  const count = selected.length;

  // AC-4 — exactly one agent: inline single-agent review, NO multi-agent run.
  const runInline = async (agentId: string) => {
    onRunStart?.();
    try {
      const res = await run.mutateAsync({ prId, agentId });
      onRunsStarted?.(res.runs.map((r) => r.run_id));
    } finally {
      onRunSettled?.();
    }
  };

  // AC-5 — more than one agent: launch a multi-agent run, then navigate to it.
  const launchMulti = async (agentIds: string[]) => {
    const { run_id } = await launch.mutateAsync({ prId, agentIds });
    router.push(`/multi-agent/runs/${run_id}`);
  };

  const onPrimary = () => {
    if (busy || count === 0) return;
    setOpen(false);
    if (count === 1) {
      const only = selected[0];
      if (only) void runInline(only);
      return;
    }
    void launchMulti(selected);
  };

  const onlyAgent = count === 1 ? enabledAgents.find((a) => a.id === selected[0]) : undefined;
  const primaryLabel =
    count === 0
      ? t("agentPicker.runBar.selectAgent")
      : count === 1
        ? t("agentPicker.runBar.runOne", { name: onlyAgent?.name ?? "" })
        : t("agentPicker.runBar.runMany", { count });

  return (
    <div ref={containerRef} style={s.root}>
      <span
        title={warnMerged ? tPr("runReview.mergedTooltip") : undefined}
        style={warnMerged ? { opacity: 0.6 } : undefined}
      >
        <Button
          kind={kind}
          size={size}
          icon="Sparkles"
          iconRight="ChevronDown"
          loading={busy}
          onClick={() => setOpen((o) => !o)}
        >
          {busy ? tPr("runReview.running") : tPr("runReview.runReview")}
        </Button>
      </span>

      {open && (
        <div style={s.popover}>
          <div style={s.header}>
            <span style={s.headerLabel}>{t("agentPicker.header")}</span>
            <button type="button" onClick={() => setAll(!allOn)} style={s.selectAllBtn}>
              {allOn ? t("agentPicker.clear") : t("common.selectAll")}
            </button>
          </div>

          {enabledAgents.map((a) => {
            const on = selected.includes(a.id);
            const visual = agentVisual({ id: a.id, name: a.name });
            const AgIcon = Icon[visual.icon];
            return (
              <button
                key={a.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(a.id)}
                onMouseEnter={() => setHoveredId(a.id)}
                onMouseLeave={() => setHoveredId((h) => (h === a.id ? null : h))}
                style={rowStyle(hoveredId === a.id)}
              >
                <span style={checkboxStyle(on)}>
                  {on && <Icon.Check size={11} style={{ color: "#fff" }} />}
                </span>
                <AgIcon size={14} style={{ color: visual.color, flexShrink: 0 }} />
                <span style={s.rowName}>{a.name}</span>
                <span className="mono" style={s.rowGuide}>
                  {guidelineFor(a.id)}
                </span>
              </button>
            );
          })}

          <div style={s.runBar}>
            <Button
              kind="primary"
              size="sm"
              icon={count > 1 ? "Users" : "Play"}
              disabled={count === 0}
              loading={busy}
              onClick={onPrimary}
              style={{ width: "100%", justifyContent: "center" }}
            >
              {primaryLabel}
            </Button>
          </div>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              router.push("/agents");
            }}
            style={s.configureBtn}
          >
            <Icon.Settings size={13} />
            {t("agentPicker.configureAgents")}
          </button>
        </div>
      )}
    </div>
  );
}
