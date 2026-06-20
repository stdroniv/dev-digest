/* FindingsPanel — hide-low-confidence + j/k navigation + FindingCard list,
   wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState } from "@devdigest/ui";
import type { FindingRecord, Severity } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
import { usePathShas } from "../../../../../../../lib/hooks/use-path-shas";
import { KEY_TO_ACTION, LOW_CONFIDENCE_THRESHOLD } from "./constants";
import { countBySeverity, visibleFindings } from "./helpers";
import { SeverityFilter } from "./SeverityFilter";
import { s } from "./styles";

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  prNumber,
  focusFindingId,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  prNumber?: number | null;
  /** When set (from a `#finding-<id>` deep link), focus + scroll to this finding. */
  focusFindingId?: string | null;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const [hideLow, setHideLow] = React.useState(false);
  const [sevFilter, setSevFilter] = React.useState<Severity | null>(null);
  const [focusIdx, setFocusIdx] = React.useState(0);

  // Counters reflect the post-hide-low set, so a chip's number always equals the
  // rows shown when that severity is selected.
  const counts = React.useMemo(
    () =>
      countBySeverity(
        hideLow ? findings.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD) : findings,
      ),
    [findings, hideLow],
  );

  const shown = React.useMemo(
    () => visibleFindings(findings, hideLow, sevFilter),
    [findings, hideLow, sevFilter],
  );

  // SHA-256 of each visible finding's path → PR-files diff anchor (async; resolves to a
  // precise anchor, falling back to the bare /files URL until ready).
  const shas = usePathShas(React.useMemo(() => shown.map((f) => f.file), [shown]));

  // Deep link (`#finding-<id>`): focus + scroll the targeted card into view once it's shown.
  React.useEffect(() => {
    if (!focusFindingId) return;
    const idx = shown.findIndex((f) => f.id === focusFindingId);
    if (idx < 0) return;
    setFocusIdx(idx);
    const el = document.querySelector(`[data-finding-id="${focusFindingId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusFindingId, shown]);

  // Keep j/k focus valid when the visible set shrinks/changes under a filter.
  const handleSevChange = React.useCallback((sev: Severity | null) => {
    setSevFilter(sev);
    setFocusIdx(0);
  }, []);

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) {
        action.mutate({ findingId: shown[focusIdx]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focusIdx, action, prId]);

  return (
    <div>
      <div style={s.toolbar}>
        <SeverityFilter counts={counts} active={sevFilter} onChange={handleSevChange} />
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focusIdx}
              defaultExpanded={i === 0 || i === focusIdx}
              pending={action.isPending}
              repoFullName={repoFullName}
              prNumber={prNumber}
              pathSha={shas[f.file]}
              onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
            />
          ))
        )}
      </div>
    </div>
  );
}
