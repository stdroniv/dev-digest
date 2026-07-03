import { z } from 'zod';

/**
 * Why+Risk Brief (SPEC-03): a standalone per-PR artifact that collapses intent,
 * blast summary, grouped diff stats, the linked issue, and repo Context docs into
 * one glanceable card — a short `what`, a `why`/intent, one overall `risk_level`,
 * a grounded `risks` list, and a prioritized `review_focus` ("read these first")
 * list. Generated in a single structured LLM pass, grounded against real changed
 * files / blast-impacted endpoints, and advisory only — never a merge gate. This
 * is a NEW, distinct artifact; it never reads or modifies the composite `pr_brief`
 * (`./brief.js`).
 *
 * Field names are snake_case (the dominant convention in this file's siblings) —
 * `client/src/lib/api.ts` does zero key remapping, so client/server keys must
 * match verbatim.
 */

// ---- Risk level (fixed 3-value scale, one per brief) ----
export const WhyRiskLevel = z.enum(['low', 'medium', 'high']);
export type WhyRiskLevel = z.infer<typeof WhyRiskLevel>;

// ---- Grounded reference: kind-tagged flat string (union-free for structured output) ----
// `kind:'file'` values are grounded against changed files; `kind:'endpoint'` values
// are grounded against blast-impacted endpoints (both flat string[] — see
// `server/src/modules/blast/types.ts`).
export const BriefRef = z.object({
  kind: z.enum(['file', 'endpoint']),
  value: z.string(),
});
export type BriefRef = z.infer<typeof BriefRef>;

// ---- One risk: short description + one-or-more grounded refs. NO per-risk severity. ----
export const WhyRiskItem = z.object({
  description: z.string(),
  refs: z.array(BriefRef),
});
export type WhyRiskItem = z.infer<typeof WhyRiskItem>;

// ---- One review-focus item: a single real file link, in reviewer-priority order ----
export const WhyRiskFocusItem = z.object({
  path: z.string(),
});
export type WhyRiskFocusItem = z.infer<typeof WhyRiskFocusItem>;

// ---- The brief itself: both the LLM structured-output schema AND the stored,
// grounded payload. ----
export const WhyRiskBrief = z.object({
  what: z.string(),
  why: z.string(),
  risk_level: WhyRiskLevel,
  risks: z.array(WhyRiskItem),
  review_focus: z.array(WhyRiskFocusItem),
});
export type WhyRiskBrief = z.infer<typeof WhyRiskBrief>;

// ---- Read/generate envelope, discriminated on `status`. Both the GET and POST
// routes return this shape with HTTP 200 (never throws on a degraded/missing
// input — the state itself carries the reason). ----
export const WhyRiskBriefState = z.discriminatedUnion('status', [
  // No intent computed yet for this PR — brief generation is refused (intent is
  // the only mandatory input).
  z.object({ status: z.literal('not_available') }),
  // Intent is present but no brief has been generated yet.
  z.object({ status: z.literal('not_generated') }),
  // Intent is present but no LLM provider is configured — not an error.
  z.object({ status: z.literal('skipped'), reason: z.literal('no_model') }),
  // A brief has been generated and is cached.
  z.object({
    status: z.literal('ready'),
    brief: WhyRiskBrief,
    stale: z.boolean(),
    docs_truncated: z.boolean(),
    generated_at: z.string(),
  }),
]);
export type WhyRiskBriefState = z.infer<typeof WhyRiskBriefState>;
