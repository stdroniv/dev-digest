/* CostPanel — the "Generation cost" 6th collapsible card (SPEC-02 AC-19/20/21;
   Q8: un-mocked design addition, styled like the five section cards). Lists
   each section's measured tokens + a view-time $ estimate from the CURRENT
   active model's pricing, plus a Total row. Persisted tokens are the measured
   truth; $ is always approximate and never persisted (Q10). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { TourSection } from "@devdigest/shared";
import { formatUsd } from "@/lib/cost";
import { useTourCostBreakdown } from "./useTourCostBreakdown";
import { SECTION_MESSAGE_KEY } from "./section-labels";
import { s } from "./styles";

export function CostPanel({
  sections,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
}: {
  sections: TourSection[];
  defaultOpen?: boolean;
  /** Optional controlled open state (AnchorNav "reveal" on click, AC-15). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
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
  const { rows, totalTokensIn, totalTokensOut, totalUsd, modelId, pricingKnown } = useTourCostBreakdown(sections);

  return (
    <section id="tour-section-cost" style={s.card}>
      <button type="button" style={s.head} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon.DollarSign size={16} style={s.headIcon} />
        <span style={s.headTitle}>{t("cost.title")}</span>
        <Icon.ChevronDown size={15} style={s.chevron(open)} />
      </button>
      {open && (
        <div style={s.body}>
          {rows.map((row) => (
            <div key={row.kind} style={s.row}>
              <span style={s.rowLabel}>{t(`sections.${SECTION_MESSAGE_KEY[row.kind]}.title`)}</span>
              <div style={s.rowRight}>
                <span style={s.rowTokens}>{t("cost.tokensInOut", { tokensIn: row.tokensIn, tokensOut: row.tokensOut })}</span>
                {row.usd != null ? (
                  <span style={s.rowUsd}>{t("cost.approx", { amount: formatUsd(row.usd) })}</span>
                ) : (
                  <span style={s.noPricing}>{t("cost.noPricing", { model: modelId })}</span>
                )}
              </div>
            </div>
          ))}
          <div style={s.totalRow}>
            <span>{t("cost.total")}</span>
            <div style={s.rowRight}>
              <span style={s.rowTokens}>{t("cost.tokensInOut", { tokensIn: totalTokensIn, tokensOut: totalTokensOut })}</span>
              {pricingKnown ? (
                <span style={s.rowUsd}>{t("cost.approx", { amount: formatUsd(totalUsd) })}</span>
              ) : (
                <span style={s.noPricing}>{t("cost.noPricing", { model: modelId })}</span>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
