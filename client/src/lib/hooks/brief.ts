/* hooks/brief.ts — React Query hooks for the PR Intent card and Smart Diff. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Intent, SmartDiff } from "@devdigest/shared";

/**
 * Fetch the stored intent for a PR (null when not yet computed).
 * Keyed by ["intent", prId] so a recalculate invalidation is narrow.
 */
export function useIntent(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["intent", prId],
    queryFn: () => api.get<Intent | null>(`/pulls/${prId}/intent`),
    enabled: prId != null,
  });
}

/**
 * Fetch the Smart Diff grouping for a PR (groups by role: core / wiring / boilerplate).
 * Token-free: reads persisted pr_files + findings, no LLM call.
 */
export function useSmartDiff(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["smart-diff", prId],
    queryFn: () => api.get<SmartDiff>(`/pulls/${prId}/smart-diff`),
    enabled: prId != null,
  });
}

/**
 * (Re)compute the PR's intent via the server classifier.
 * On success, invalidates the ["intent", prId] query so the card refreshes.
 */
export function useRecalculateIntent(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Intent>(`/pulls/${prId}/intent`),
    onSuccess: (data) => {
      qc.setQueryData(["intent", prId], data);
    },
  });
}
