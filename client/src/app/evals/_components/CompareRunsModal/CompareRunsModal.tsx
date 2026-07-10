/* Compare-runs modal (SPEC-04, T18, design 4). Read-only side-by-side of two
   run groups — per-metric old→new + delta (recall/precision/citation/cost,
   AC-16) and a colorized diff of the two agent versions' system prompts.
   Exposes exactly one write: a confirmed "Promote vN" that sets the active
   version to the newer of the two (AC-27). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Skeleton, ErrorState, Modal } from "@devdigest/ui";
import type { EvalMetricDelta } from "@devdigest/shared";
import { useCompareRuns, usePromoteVersion } from "@/lib/hooks/evals";
import { formatUsd } from "@/lib/cost";
import { s } from "./styles";

type MetricKey = "recall" | "precision" | "citation_accuracy";

function pct(v: number) {
  return `${Math.round(v * 100)}%`;
}

function MetricDeltaCard({ label, delta, format }: { label: string; delta: EvalMetricDelta; format: (v: number) => string }) {
  const up = delta.delta > 0;
  const flat = delta.delta === 0;
  const dc = flat ? "var(--text-muted)" : up ? "var(--ok)" : "var(--crit)";
  return (
    <div style={s.metricCard}>
      <span style={s.metricLabel}>{label}</span>
      <div style={s.metricValueRow}>
        <span>{format(delta.old)}</span>
        <span style={s.metricArrow}>→</span>
        <span>{format(delta.new)}</span>
      </div>
      <span style={{ ...s.metricDelta, color: dc }}>
        {flat ? "—" : up ? "▲" : "▼"} {format(Math.abs(delta.delta))}
      </span>
    </div>
  );
}

/** Parses the server-computed unified-style prompt diff text and colorizes
    `+`/`-` prefixed lines (added/removed) vs plain context lines. */
function PromptDiff({ text }: { text: string }) {
  if (!text.trim()) {
    return null;
  }
  const lines = text.split("\n");
  return (
    <div style={s.diffBox}>
      {lines.map((line, i) => {
        if (line.startsWith("+")) {
          return (
            <span key={i} style={s.diffAdded}>
              {line}
            </span>
          );
        }
        if (line.startsWith("-")) {
          return (
            <span key={i} style={s.diffRemoved}>
              {line}
            </span>
          );
        }
        return (
          <span key={i} style={s.diffContext}>
            {line}
          </span>
        );
      })}
    </div>
  );
}

export function CompareRunsModal({
  agentId,
  oldRunGroupId,
  newRunGroupId,
  onClose,
}: {
  agentId: string;
  oldRunGroupId: string;
  newRunGroupId: string;
  onClose: () => void;
}) {
  const t = useTranslations("evals");
  const compare = useCompareRuns();
  const promote = usePromoteVersion();
  const [confirmingPromote, setConfirmingPromote] = React.useState(false);
  const [promotedVersion, setPromotedVersion] = React.useState<number | null>(null);

  React.useEffect(() => {
    compare.mutate({ old_run_group_id: oldRunGroupId, new_run_group_id: newRunGroupId });
    // Fire once per (old, new) pair — the mutation object identity is stable
    // across renders (useMutation), so it's intentionally excluded here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oldRunGroupId, newRunGroupId]);

  const comparison = compare.data;
  const newerVersion = comparison?.newer_version ?? null;

  const doPromote = () => {
    if (newerVersion == null) return;
    promote.mutate(
      { agentId, version: newerVersion },
      {
        onSuccess: () => {
          setPromotedVersion(newerVersion);
          setConfirmingPromote(false);
        },
      },
    );
  };

  const title = comparison
    ? `${t("compareModal.title")} · v${comparison.old_run.agent_version ?? "—"} → v${comparison.new_run.agent_version ?? "—"}`
    : t("compareModal.title");

  return (
    <Modal
      width={720}
      title={title}
      subtitle={t("compareModal.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {promotedVersion != null && (
            <span style={s.promotedNote}>{t("compareModal.promoted", { version: promotedVersion })}</span>
          )}
          {confirmingPromote && promotedVersion == null && (
            <div style={s.confirmRow}>
              <span>{t("compareModal.confirmPromote", { version: newerVersion ?? "—" })}</span>
              <Button kind="secondary" onClick={() => setConfirmingPromote(false)}>
                {t("compareModal.cancel")}
              </Button>
              <Button kind="primary" onClick={doPromote} disabled={promote.isPending}>
                {promote.isPending ? t("compareModal.promoting") : t("compareModal.confirm")}
              </Button>
            </div>
          )}
          <Button kind="secondary" onClick={onClose}>
            {t("compareModal.close")}
          </Button>
          {promotedVersion == null && !confirmingPromote && (
            <Button
              kind="primary"
              icon="ArrowUp"
              onClick={() => setConfirmingPromote(true)}
              disabled={newerVersion == null || compare.isPending}
            >
              {t("compareModal.promote", { version: newerVersion ?? "—" })}
            </Button>
          )}
        </div>
      }
    >
      <div style={s.body}>
        {compare.isPending || !comparison ? (
          compare.isError ? (
            <ErrorState title="Couldn't compare these runs" />
          ) : (
            <>
              <Skeleton height={90} />
              <Skeleton height={160} />
            </>
          )
        ) : (
          <>
            <div style={s.metricsGrid}>
              <MetricDeltaCard label={t("metrics.recall")} delta={comparison.recall} format={pct} />
              <MetricDeltaCard label={t("metrics.precision")} delta={comparison.precision} format={pct} />
              <MetricDeltaCard
                label={t("metrics.citationAccuracy")}
                delta={comparison.citation_accuracy}
                format={pct}
              />
              <MetricDeltaCard label={t("compareModal.costLabel")} delta={comparison.cost_usd} format={formatUsd} />
            </div>

            <div style={s.diffSection}>
              <div style={s.diffHeading}>{t("compareModal.promptDiffHeading")}</div>
              <div style={s.diffLegend}>
                <span>{`v${comparison.old_run.agent_version ?? "—"} old`}</span>
                <span>{`v${comparison.new_run.agent_version ?? "—"} new`}</span>
              </div>
              {comparison.system_prompt_diff.trim() ? (
                <PromptDiff text={comparison.system_prompt_diff} />
              ) : (
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("compareModal.noPromptDiff")}</div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
