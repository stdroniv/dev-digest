/* SectionCard — the collapsible card shell shared by all five Onboarding Tour
   sections (SPEC-02 AC-14) plus the "Generation cost" card (T11). Owns:
   - the leading icon + title + chevron collapse toggle,
   - a per-section Regenerate refresh icon (AC-24) distinct from the
     whole-tour Regenerate button, wired to `useRegenerateSection`,
   - a per-section spinner while `status === "generating"` (AC-27) — siblings
     stay unaffected because each card only reads its OWN section's status,
   - a section-scoped failure banner while `status === "failed"` (AC-34) that
     never hides `children` — a failed regen always preserves prior content
     (server-side, T3/T5), so the card renders both the banner AND the last-
     good content beneath it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, IconBtn, Skeleton, type IconName } from "@devdigest/ui";
import type { TourSection, TourSectionKind } from "@devdigest/shared";
import { useRegenerateSection } from "@/lib/hooks/onboarding";
import { s } from "./styles";

export function SectionCard({
  kind,
  icon,
  title,
  section,
  repoId,
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  children,
}: {
  kind: TourSectionKind;
  icon: IconName;
  title: string;
  section: TourSection;
  repoId: string;
  defaultOpen?: boolean;
  /** Optional controlled open state (e.g. AnchorNav "reveal" on click, AC-15).
     Uncontrolled (internal state) when omitted. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const t = useTranslations("tour");
  const [openState, setOpenState] = React.useState(defaultOpen);
  const open = openProp ?? openState;
  const setOpen = React.useCallback(
    (updater: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof updater === "function" ? updater(open) : updater;
      if (onOpenChange) onOpenChange(next);
      else setOpenState(next);
    },
    [open, onOpenChange],
  );
  const regenerate = useRegenerateSection(repoId);
  const I = Icon[icon];

  const generating = section.status === "generating";
  const failed = section.status === "failed";

  return (
    <section id={`tour-section-${kind}`} style={s.card} data-status={section.status}>
      <div style={s.head}>
        <button type="button" style={s.headToggle} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <I size={16} style={s.headIcon} />
          <span style={s.headTitle}>{title}</span>
        </button>
        <div style={s.headActions}>
          {generating && (
            <span role="status" aria-label={t("sectionCard.generating")}>
              <Icon.RefreshCw size={14} style={s.spinIcon} />
            </span>
          )}
          <IconBtn
            icon="RefreshCw"
            label={t("sectionCard.regenerateSection")}
            onClick={() => regenerate.mutate(kind)}
          />
          <button type="button" aria-label={open ? "Collapse" : "Expand"} onClick={() => setOpen((o) => !o)} style={s.chevronBtn}>
            <Icon.ChevronDown size={15} style={s.chevron(open)} />
          </button>
        </div>
      </div>
      {open && (
        <div style={s.body}>
          {failed && (
            <div role="alert" style={s.failureBanner}>
              <Icon.AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                {section.error ?? t("unknownError")}{" "}
                <button type="button" style={s.retryLink} onClick={() => regenerate.mutate(kind)}>
                  {t("sectionCard.retry")}
                </button>
              </span>
            </div>
          )}
          {section.content ? (
            children
          ) : generating ? (
            <Skeleton height={80} />
          ) : (
            !failed && <div style={s.emptyBody}>{t("unknownError")}</div>
          )}
        </div>
      )}
    </section>
  );
}
