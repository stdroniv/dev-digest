"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, MonoLink } from "@devdigest/ui";
import type { CiRun } from "@devdigest/shared";
import { formatUsd } from "@/lib/cost";
import { CI_STATUS_META } from "./constants";
import { formatTimestamp } from "./helpers";
import { s } from "./styles";
import { CiFindingsCell } from "./CiFindingsCell";

/**
 * One CI Runs table row (AC-35): Timestamp, Pull request, Agent, Source,
 * Duration, Findings, Cost, Status, Trace. The status token is keyed off
 * `run.status`, NOT the CRITICAL findings count — a succeeded run with
 * blocker findings still reads "Succeeded" (AC-33); the blocked-merge signal
 * is conveyed by the CRITICAL chip in the Findings cell.
 */
export function CiRunRow({ run, last }: { run: CiRun; last: boolean }) {
  const t = useTranslations("ci");
  const statusMeta = run.status ? CI_STATUS_META[run.status] : null;

  return (
    <div style={s.row(last)}>
      <span className="mono" style={s.timestamp}>
        {formatTimestamp(run.ran_at)}
      </span>
      <div style={s.prCell}>
        {run.pr_number != null && (
          <span className="mono" style={s.prNumber}>
            #{run.pr_number}{" "}
          </span>
        )}
        <span style={s.prTitle}>{run.pr_title ?? "—"}</span>
      </div>
      <span style={s.agentCell}>
        <Icon.Cpu size={13} style={{ color: "var(--text-muted)" }} />
        {run.agent ?? "—"}
      </span>
      <div>
        <Badge color="var(--text-secondary)" icon="Workflow">
          {run.source ?? "—"}
        </Badge>
      </div>
      <span className="tnum" style={s.duration}>
        {run.duration_s != null ? `${run.duration_s}s` : "—"}
      </span>
      <CiFindingsCell counts={run.findings_counts} />
      <span className="mono tnum" style={s.cost}>
        {formatUsd(run.cost_usd)}
      </span>
      <div>
        {statusMeta ? (
          <Badge dot color={statusMeta.c} bg={statusMeta.bg}>
            {t(`runs.status.${statusMeta.labelKey}`)}
          </Badge>
        ) : (
          <span style={s.muted}>—</span>
        )}
      </div>
      {run.github_url ? (
        <MonoLink href={run.github_url}>{t("runs.traceLink")}</MonoLink>
      ) : (
        <span style={s.muted}>—</span>
      )}
    </div>
  );
}
