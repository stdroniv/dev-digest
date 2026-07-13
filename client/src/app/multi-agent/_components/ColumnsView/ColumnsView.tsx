/* ColumnsView — Multi-Agent Review "Columns" view (design `8bb91114`:52-65).
   One column per agent: a card with a 2px top border in the agent colour, an
   AgentColHeader (identity + dur·cost + score, AC-19), a body of that agent's
   findings as AgentFindingMini (AC-20), and a footer with a "View trace" link +
   the finding count. A `running`/`failed` column surfaces its live status in the
   header (AC-31/33); a `done` column with zero findings renders an empty body +
   count 0.

   The page (T18) owns the trace surface — "View trace" raises `onViewTrace(column)`
   and the "Where agents disagree" section is rendered by the page, not here. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { MonoLink } from "@devdigest/ui";
import type { AgentColumn, AgentColumnFinding } from "@devdigest/shared";
import { agentVisual } from "@/lib/agent-visuals";

import { AgentColHeader } from "./AgentColHeader";
import { AgentFindingMini } from "./AgentFindingMini";
import { s } from "./styles";

export interface ColumnsViewProps {
  /** One entry per agent run in the multi-agent run (see AgentColumn contract). */
  columns: AgentColumn[];
  /** Opens the given agent's run trace / live log — owned by the page (AC-32). */
  onViewTrace: (column: AgentColumn) => void;
  /** In-app deep link to a finding's card on the PR overview's Agent runs tab.
   *  Omitted (→ plain text) until the owning repo/PR is resolved. */
  findingHref?: (finding: AgentColumnFinding) => string | undefined;
  /** github.com blob link for a finding's file:line. Omitted (→ plain text)
   *  until the repo is resolved. */
  fileHref?: (finding: AgentColumnFinding) => string | undefined;
}

export function ColumnsView({ columns, onViewTrace, findingHref, fileHref }: ColumnsViewProps) {
  const t = useTranslations("multiAgent");
  const n = columns.length;
  // Fit up to 5 columns to the width; beyond that, keep 5 tracks and scroll.
  const cols = n <= 5 ? n : 5;

  return (
    <div style={s.wrapper}>
      <div style={s.grid(Math.max(cols, 1), n > 5)}>
        {columns.map((column) => {
          const color = agentVisual({
            id: column.agent_id,
            name: column.agent_name,
          }).color;
          return (
            <div key={column.run_id} style={s.column}>
              <div style={s.header(color)}>
                <AgentColHeader column={column} />
              </div>
              <div style={s.body}>
                {column.findings.length > 0 ? (
                  column.findings.map((finding) => (
                    <AgentFindingMini
                      key={finding.id}
                      finding={finding}
                      findingHref={findingHref?.(finding)}
                      fileHref={fileHref?.(finding)}
                    />
                  ))
                ) : (
                  <div style={s.emptyBody}>{t("columns.noFindings")}</div>
                )}
              </div>
              <div style={s.footer}>
                <MonoLink onClick={() => onViewTrace(column)}>
                  {t("common.viewTrace")}
                </MonoLink>
                <span style={s.count}>
                  {t("common.findingsCount", { count: column.findings.length })}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
