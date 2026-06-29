/* hooks/history.ts — React Query hook for the Prior PRs accordion. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { PrHistory } from "../types";

/**
 * Fetch prior PRs that touched the same files as this PR.
 *
 * The `enabled` option MUST be explicitly set to true by the caller (e.g.
 * on the first accordion expand) — it defaults to false so the git-log
 * filesystem work never runs on Overview mount.
 *
 * Mirrors `useBlastSummary`'s explicit enabled gate.
 */
export function usePriorPrs(
  prId: string | null | undefined,
  options: { enabled: boolean },
) {
  return useQuery({
    queryKey: ["prior-prs", prId],
    queryFn: () => api.get<PrHistory>(`/pulls/${prId}/prior-prs`),
    enabled: options.enabled && prId != null,
  });
}
