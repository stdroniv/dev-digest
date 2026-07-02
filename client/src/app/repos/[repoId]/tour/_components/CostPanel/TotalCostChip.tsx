/* TotalCostChip — the total generation cost surfaced near the tour header
   (SPEC-02 AC-22; Q8: un-mocked design addition). Mirrors CostPanel's total
   row exactly — both read the same `useTourCostBreakdown`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { TourSection } from "@devdigest/shared";
import { formatUsd } from "@/lib/cost";
import { useTourCostBreakdown } from "./useTourCostBreakdown";
import { s } from "./styles";

export function TotalCostChip({ sections }: { sections: TourSection[] }) {
  const t = useTranslations("tour");
  const { totalTokensIn, totalTokensOut, totalUsd, pricingKnown } = useTourCostBreakdown(sections);

  return (
    <span style={s.chip}>
      <Icon.DollarSign size={13} />
      {pricingKnown
        ? t("cost.approx", { amount: formatUsd(totalUsd) })
        : t("cost.tokensInOut", { tokensIn: totalTokensIn, tokensOut: totalTokensOut })}
    </span>
  );
}
