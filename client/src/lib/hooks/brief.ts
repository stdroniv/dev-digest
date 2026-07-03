/* hooks/brief.ts — React Query hooks for the PR Intent card and Smart Diff. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Intent, Risks, SmartDiff, WhyRiskBriefState, FileSummaryState } from "@devdigest/shared";

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
 * Fetch the stored risks for a PR (null when not yet computed).
 * Keyed by ["risks", prId] so it is independently cacheable.
 */
export function useRisks(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["risks", prId],
    queryFn: () => api.get<Risks | null>(`/pulls/${prId}/risks`),
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

/**
 * Fetch the cached Why+Risk Brief for a PR — read only, never triggers generation.
 * Keyed by ["why-risk-brief", prId] so it is independently cacheable.
 */
export function useWhyRiskBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["why-risk-brief", prId],
    queryFn: () => api.get<WhyRiskBriefState>(`/pulls/${prId}/why-risk-brief`),
    enabled: prId != null,
  });
}

/**
 * (Re)generate the PR's Why+Risk Brief via the server.
 * On success, seeds the ["why-risk-brief", prId] query so the card refreshes.
 */
export function useGenerateWhyRiskBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<WhyRiskBriefState>(`/pulls/${prId}/why-risk-brief`),
    onSuccess: (data) => {
      qc.setQueryData(["why-risk-brief", prId], data);
    },
  });
}

/**
 * Fetch the cached per-file "What this does" summary (Smart Diff, core files
 * only) — read only, never triggers generation. LAZY: pass `enabled` so this
 * only fetches once the user opens/requests the summary for that file, not
 * on mount for every file.
 * Keyed by ["file-summary", prId, path] so each file caches independently.
 */
export function useFileSummary(prId: string | null | undefined, path: string, enabled: boolean) {
  return useQuery({
    queryKey: ["file-summary", prId, path],
    queryFn: () => api.get<FileSummaryState>(`/pulls/${prId}/file-summary?path=${encodeURIComponent(path)}`),
    enabled: enabled && prId != null,
  });
}

/**
 * (Re)generate a per-file "What this does" summary via the server.
 * On success, seeds the ["file-summary", prId, path] query for that file.
 */
export function useGenerateFileSummary(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { path: string; regenerate?: boolean }) =>
      api.post<FileSummaryState>(`/pulls/${prId}/file-summary`, vars),
    onSuccess: (data, vars) => {
      qc.setQueryData(["file-summary", prId, vars.path], data);
    },
  });
}
