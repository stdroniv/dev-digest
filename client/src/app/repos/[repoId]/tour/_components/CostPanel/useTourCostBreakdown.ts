/* useTourCostBreakdown — resolves the CURRENT active "onboarding" feature
   model + its live pricing (Settings → Feature Models, same source as
   SettingsModels.tsx) and combines it with each persisted section's measured
   `cost.tokensIn/tokensOut` to derive a per-section + total $ estimate. */
"use client";

import { useSettings } from "@/lib/hooks";
import { useProviderModels } from "@/lib/hooks/agents";
import { FEATURE_MODELS } from "@/lib/feature-models";
import type { FeatureModelChoice, FeatureModelId } from "@/lib/types";
import type { TourSection, TourSectionKind } from "@devdigest/shared";
import { estimateSectionCostUsd } from "./pricing";

export interface CostRow {
  kind: TourSectionKind;
  tokensIn: number;
  tokensOut: number;
  usd: number | null;
}

export interface TourCostBreakdown {
  rows: CostRow[];
  totalTokensIn: number;
  totalTokensOut: number;
  totalUsd: number | null;
  modelId: string;
  pricingKnown: boolean;
}

const FEATURE_ID: FeatureModelId = "onboarding";

export function useTourCostBreakdown(sections: TourSection[] | undefined): TourCostBreakdown {
  const { data: settings } = useSettings();
  const def = FEATURE_MODELS.find((f) => f.id === FEATURE_ID)!;
  const chosen = (settings?.feature_models ?? {}) as Partial<Record<FeatureModelId, FeatureModelChoice>>;
  const provider = chosen[FEATURE_ID]?.provider ?? def.defaultProvider;
  const modelId = chosen[FEATURE_ID]?.model ?? def.defaultModel;

  const { data: models } = useProviderModels(provider);
  const pricing = models?.find((m) => m.id === modelId)?.pricing ?? null;
  const pricingKnown = pricing != null;

  const rows: CostRow[] = (sections ?? []).map((sec) => {
    const tokensIn = sec.cost?.tokensIn ?? 0;
    const tokensOut = sec.cost?.tokensOut ?? 0;
    return { kind: sec.kind, tokensIn, tokensOut, usd: estimateSectionCostUsd(tokensIn, tokensOut, pricing) };
  });

  const totalTokensIn = rows.reduce((sum, r) => sum + r.tokensIn, 0);
  const totalTokensOut = rows.reduce((sum, r) => sum + r.tokensOut, 0);
  const totalUsd = estimateSectionCostUsd(totalTokensIn, totalTokensOut, pricing);

  return { rows, totalTokensIn, totalTokensOut, totalUsd, modelId, pricingKnown };
}
