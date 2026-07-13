/* RunConfig/usePrOptions.ts — selectable-PR source for the Configure step
   (SPEC-05, T14 / AC-6..7).

   LIMITATION (flagged): the API exposes no workspace-wide PR list — only the
   repo-scoped `GET /repos/:id/pulls` (see `usePulls` in `hooks/core.ts`). This
   hook therefore aggregates that call across every repo the workspace knows via
   `useQueries`, reusing the same `["pulls", repoId]` cache keys as the PR pages
   (so the two views stay in sync and share fetches). If a dedicated
   `GET /pulls` (workspace-scoped) endpoint is added later, collapse this to a
   single query. Data still flows through the shared `api` client, never `fetch`.

   Stale filtering (AC-7) is intentionally left to the consumer so RunConfig's
   own tests exercise it. */
"use client";

import { useQueries } from "@tanstack/react-query";
import { useRepos } from "@/lib/hooks/core";
import { api } from "@/lib/api";
import type { PrMeta, PrStatus } from "@devdigest/shared";

/** A selectable pull request for the Configure step. `id` is required (it is
 *  what `onRun`/the launch endpoint keys on), so PRs without one are dropped. */
export interface PrOption {
  id: string;
  number: number;
  title: string;
  status: PrStatus;
}

export interface UsePrOptionsResult {
  prs: PrOption[];
  isLoading: boolean;
}

export function usePrOptions(): UsePrOptionsResult {
  const { data: repos } = useRepos();
  const repoList = repos ?? [];

  const results = useQueries({
    queries: repoList.map((repo) => ({
      queryKey: ["pulls", repo.id],
      queryFn: () => api.get<PrMeta[]>(`/repos/${repo.id}/pulls`),
    })),
  });

  const prs = results
    .flatMap((res) => res.data ?? [])
    .flatMap((pr): PrOption[] =>
      typeof pr.id === "string" && pr.id.length > 0
        ? [{ id: pr.id, number: pr.number, title: pr.title, status: pr.status }]
        : []
    );

  return { prs, isLoading: results.some((r) => r.isLoading) };
}
