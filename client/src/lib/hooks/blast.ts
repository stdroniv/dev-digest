/* hooks/blast.ts — React Query hooks for the Blast Radius panel. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastResponse, BlastSummaryResponse } from "../types";

/**
 * Fetch the blast-radius shaped payload for a PR.
 * Keyed by ["blast", prId]; enabled only when prId is present.
 * Zero AI calls on this path — reads only from the repo-intel index.
 */
export function useBlastRadius(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["blast", prId],
    queryFn: () => api.get<BlastResponse>(`/pulls/${prId}/blast`),
    enabled: prId != null,
  });
}

/**
 * Fetch a one-paragraph plain-English summary of the blast radius.
 * The `enabled` option MUST be explicitly set to true by the caller (e.g.
 * on a user-initiated disclosure button) — it defaults to false so the
 * single LLM call never fires on panel mount.
 */
export function useBlastSummary(
  prId: string | null | undefined,
  options: { enabled: boolean },
) {
  return useQuery({
    queryKey: ["blast-summary", prId],
    queryFn: () =>
      api.get<BlastSummaryResponse>(`/pulls/${prId}/blast/summary`),
    enabled: options.enabled && prId != null,
  });
}
