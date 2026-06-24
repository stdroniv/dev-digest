/* hooks/brief.ts — React Query hooks for the PR Intent card. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Intent } from "@devdigest/shared";

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
