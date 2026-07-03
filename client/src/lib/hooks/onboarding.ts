/* hooks/onboarding.ts — React Query hooks for the Onboarding Tour screen
   (SPEC-02): fetch the persisted tour + availability/staleness/job status,
   kick off a whole-tour generation, and regenerate a single section.

   Polling: while the LATEST job for the repo is still active (`queued` /
   `running`), refetch every 1.5s so an in-progress whole-tour or per-section
   run shows live. STOP polling the moment the job reaches a terminal status
   (`done` / `failed`) — `GET /tour` keeps returning the latest job even after
   it's terminal (so a failed job's `error` stays displayable), so polling
   must key off `job.status`, not mere `job` presence, or a failed job would
   poll forever. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { GetTourResponse, TourJob, TourSectionKind } from "@devdigest/shared";

export function useOnboardingTour(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["onboarding-tour", repoId],
    queryFn: () => api.get<GetTourResponse>(`/repos/${repoId}/tour`),
    enabled: !!repoId,
    refetchInterval: (query) => {
      const job = query.state.data?.job;
      return job && (job.status === "queued" || job.status === "running") ? 1500 : false;
    },
  });
}

/** Kick off a whole-tour generation (AC-6). Returns the enqueued job; the
   caller relies on `useOnboardingTour`'s polling (via query invalidation) to
   observe progress and the eventual result. */
export function useGenerateTour(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ job: TourJob }>(`/repos/${repoId}/tour/generate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["onboarding-tour", repoId] }),
  });
}

/** Regenerate exactly one section (AC-24/27/34). */
export function useRegenerateSection(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind: TourSectionKind) =>
      api.post<{ job: TourJob }>(`/repos/${repoId}/tour/sections/${kind}/regenerate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["onboarding-tour", repoId] }),
  });
}
