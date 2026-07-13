/* ConflictsSection — T17 "Where agents disagree" (design `8bb91114:21-40`).
   Display-only over foreign, agent-produced text: the server (T5) does the
   file+line-range grouping and emits one `Conflict` row per grouped code
   location (agreements AND genuine conflicts). This component renders those
   rows and offers a client-side "Show only conflicts" filter. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SectionLabel, Toggle, SEV } from "@devdigest/ui";
import type { Conflict, ConflictTake } from "@devdigest/shared";
import { s } from "./styles";

/** Status-dot color: the severity token when flagged, muted when 'ignored'. */
function takeDotColor(verdict: ConflictTake["verdict"]): string {
  if (verdict === "ignored") return "var(--text-muted)";
  return SEV[verdict]?.c ?? "var(--warn)";
}

export function ConflictsSection({
  conflicts,
  reviewedAgentCount,
}: {
  conflicts: Conflict[];
  reviewedAgentCount: number;
}) {
  const t = useTranslations("multiAgent");
  const [onlyConflicts, setOnlyConflicts] = React.useState(false);

  // AC-30 / AC-34 — the disagreement section only exists once ≥2 agents have
  // actually reviewed (columns with status 'done' = the reviewed set). The
  // parent (T18) applies the same gate before mounting this; this is a
  // defensive no-op so the component is safe regardless of the caller. An
  // all-fail run (0 reviewed) and a 2-dispatched/1-failed run (1 reviewed) both
  // hide the section rather than render it empty.
  if (reviewedAgentCount < 2) return null;

  // Server-computed classification (AC-29) — filter on the wire field, never a
  // re-derived client predicate (no drift risk).
  const visible = onlyConflicts ? conflicts.filter((c) => c.is_conflict) : conflicts;

  return (
    <div style={s.root}>
      <SectionLabel
        icon="Activity"
        right={
          <label style={s.toggleLabel}>
            {t("conflicts.onlyConflicts")}
            <Toggle on={onlyConflicts} onChange={setOnlyConflicts} size={15} />
            {/* Always-visible shown/total — the classification (AC-29) is strict
                (unanimous same-severity flags = agreement), so on a typical run
                every row is a genuine conflict and toggling filters nothing out.
                This count is the toggle's only visible feedback in that (common)
                case — without it, "shown = 3" before and after reads as broken. */}
            <span style={s.count}>
              {t("conflicts.shownCount", { shown: visible.length, total: conflicts.length })}
            </span>
          </label>
        }
      >
        {t("conflicts.title")}
      </SectionLabel>

      {onlyConflicts && visible.length === 0 ? (
        <div style={s.empty}>{t("conflicts.empty")}</div>
      ) : (
        <div style={s.list}>
          {visible.map((c, i) => (
            <div
              key={`${c.file}:${c.line}:${i}`}
              data-conflict={`${c.file}:${c.line}`}
              style={s.card}
            >
              <div style={s.cardHeader}>
                <Icon.Code size={13} style={s.codeIcon} />
                <span className="mono" style={s.fileLine}>
                  {c.file}:{c.line}
                </span>
                <span style={s.title}>{c.title}</span>
              </div>
              <div style={s.takesGrid(c.takes.length)}>
                {c.takes.map((take, ti) => {
                  const flagged = take.verdict !== "ignored";
                  return (
                    <div key={`${take.agent_id}:${ti}`} style={s.take}>
                      <div style={s.persona}>{take.persona}</div>
                      <div style={s.verdictRow}>
                        <span style={s.dot(takeDotColor(take.verdict))} />
                        <span style={s.verdictText(flagged)}>
                          {flagged ? take.verdict : t("conflicts.didNotFlag")}
                        </span>
                      </div>
                      <div style={s.note}>{take.note}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
