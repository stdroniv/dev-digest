/* hooks/settings.ts — React Query hooks for the per-workspace `root_folders`
   override (SPEC-01 AC-8/AC-9): the Markdown-discovery root folder names the
   documents module scans under. Shares the `["settings"]` cache entry with
   `useSettings`/`useUpdateSettings` (hooks/core.ts) — `root_folders` is a
   passthrough key on the same `Settings` object (T4), not a separate endpoint. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Settings } from "@devdigest/shared";

/**
 * Default Markdown-discovery root folder names, shown when a workspace hasn't
 * overridden `root_folders`. Mirrors `DEFAULT_ROOT_FOLDERS` in
 * `server/src/modules/settings/helpers.ts` — keep both lists in sync.
 */
export const DEFAULT_ROOT_FOLDERS = ["specs", "docs", "insights"];

function extractRootFolders(settings: Settings): string[] {
  const raw = (settings as { root_folders?: unknown }).root_folders;
  return Array.isArray(raw) && raw.length > 0 && raw.every((r) => typeof r === "string" && r.length > 0)
    ? (raw as string[])
    : [...DEFAULT_ROOT_FOLDERS];
}

/** The current per-workspace `root_folders` override, defaulted client-side. */
export function useRootFolders() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<Settings>("/settings"),
    select: extractRootFolders,
  });
}

/** Persist a new `root_folders` override via `PUT /settings` (passthrough key — no schema change). */
export function useSetRootFolders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rootFolders: string[]) => api.put<Settings>("/settings", { root_folders: rootFolders }),
    onSuccess: (data) => qc.setQueryData(["settings"], data),
  });
}
