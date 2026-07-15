/* AgentColHeader — one agent column's header in the Columns view
   (design `8bb91114`:12-19). Icon tile (agentVisual) + name + mono
   `"<dur>s · $<cost>"` + CircularScore (AC-19). For a `running`/`failed` column
   the score/cost may be null, so the header shows a live status badge instead of
   a score (AC-31 running, AC-33 failed). Score colour threshold (75/50) lives in
   the vendored CircularScore — the mock's 70 is drift. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, CircularScore } from "@devdigest/ui";
import type { AgentColumn } from "@devdigest/shared";
import { agentVisual } from "@/lib/agent-visuals";

import { s, STATUS_COLOR } from "./styles";

function StatusBadge({ status }: { status: AgentColumn["status"] }) {
  const t = useTranslations("multiAgent");
  const color = STATUS_COLOR[status];
  return (
    <span style={s.statusBadge} data-testid={`agent-status-${status}`}>
      <span style={s.statusDot(color)} />
      <span style={s.statusLabel(color)}>{t(`results.status.${status}`)}</span>
    </span>
  );
}

export function AgentColHeader({ column }: { column: AgentColumn }) {
  const t = useTranslations("multiAgent");
  const visual = agentVisual({ id: column.agent_id, name: column.agent_name });
  const TileIcon = Icon[visual.icon];

  // Honest per-agent time/cost line — shown only when both are known. Numbers are
  // formatted mock-faithfully: `(ms/1000).toFixed(1)` and `$<cost>.toFixed(2)`.
  const hasCost = column.duration_ms != null && column.cost_usd != null;
  const durationCost = hasCost
    ? t("common.durationCost", {
        seconds: (column.duration_ms! / 1000).toFixed(1),
        cost: `$${column.cost_usd!.toFixed(2)}`,
      })
    : null;

  const showScore = column.status === "done" && column.score != null;

  return (
    <div style={s.headerRow}>
      <div style={s.iconTile(visual.color)}>
        <TileIcon size={16} />
      </div>
      <div style={s.nameBlock}>
        <div style={s.name} title={column.agent_name}>
          {column.agent_name}
        </div>
        {durationCost != null && (
          <div className="mono tnum" style={s.sub}>
            {durationCost}
          </div>
        )}
      </div>
      {showScore ? (
        <CircularScore score={column.score!} size={32} stroke={3.5} />
      ) : (
        <StatusBadge status={column.status} />
      )}
    </div>
  );
}
