/* pricing.ts — pure $ estimation for the Generation cost panel (SPEC-02
   AC-19/20/21). Persisted token counts are the measured truth; the dollar
   figure is ALWAYS a view-time estimate from the CURRENTLY active model's
   pricing (Q10) — never persisted, always shown as approximate. */

export interface ModelPricing {
  promptPerM: number;
  completionPerM: number;
}

/** null when pricing for the active model is unknown (AC-21) — tokens-only. */
export function estimateSectionCostUsd(
  tokensIn: number,
  tokensOut: number,
  pricing: ModelPricing | null | undefined,
): number | null {
  if (!pricing) return null;
  return (tokensIn / 1_000_000) * pricing.promptPerM + (tokensOut / 1_000_000) * pricing.completionPerM;
}
