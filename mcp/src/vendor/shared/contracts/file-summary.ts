import { z } from 'zod';

/**
 * Per-file "What this does" AI summary (Smart-Diff view, core-group files
 * only) — a single plain-text line describing what one file's change does,
 * generated on-demand from that file's own diff. Distinct from the
 * PR-wide `WhyRiskBrief` (`./why-risk-brief.js`): this is per-FILE, computed
 * lazily per click rather than eagerly for the whole PR.
 *
 * Field names are snake_case (the dominant convention in this file's
 * siblings) — `client/src/lib/api.ts` does zero key remapping, so
 * client/server keys must match verbatim.
 */

// ---- Read/generate envelope, discriminated on `status`. Both the GET and
// POST routes return this shape with HTTP 200 (never throws on a degraded/
// missing input — the state itself carries the reason). ----
export const FileSummaryState = z.discriminatedUnion('status', [
  // A summary has been generated and is cached.
  z.object({
    status: z.literal('ready'),
    summary: z.string(),
    stale: z.boolean(),
  }),
  // No summary has been generated yet for this file.
  z.object({ status: z.literal('not_generated') }),
  // The file has no patch (binary / too large) — nothing to summarize.
  z.object({ status: z.literal('no_diff') }),
  // The path is not a core-group file (Smart-Diff classification) — summaries
  // are scoped to core files only.
  z.object({ status: z.literal('not_core') }),
  // No LLM provider is configured — not an error.
  z.object({ status: z.literal('skipped'), reason: z.literal('no_model') }),
]);
export type FileSummaryState = z.infer<typeof FileSummaryState>;
