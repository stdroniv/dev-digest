/* hooks/conventions.ts — React Query hooks for the Conventions Extractor:
   scan a repo, list candidates, accept/reject/edit, and build the editable
   `repo-conventions` skill body from the accepted ones. Skill persistence reuses
   useCreateSkill / useSetAgentSkills from hooks/skills.ts. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ConventionCandidate, ConventionStatus } from "@devdigest/shared";

/** The editable skill the server assembles from accepted candidates (not persisted). */
export interface ConventionSkillPreview {
  name: string;
  description: string;
  body: string;
  evidence_files: string[];
}

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

/** Run a scan; the server samples, calls a cheap model, verifies, and persists. */
export function useExtractConventions(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ConventionCandidate[]>(`/repos/${repoId}/conventions/extract`),
    onSuccess: (data) => qc.setQueryData(["conventions", repoId], data),
  });
}

export interface PatchConventionInput {
  id: string;
  repoId: string;
  patch: { status?: ConventionStatus; category?: string; rule?: string };
}

/** Accept / reject / edit one candidate (optimistic status flip). */
export function usePatchConvention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: PatchConventionInput) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, patch),
    onMutate: async ({ id, repoId, patch }) => {
      await qc.cancelQueries({ queryKey: ["conventions", repoId] });
      const prev = qc.getQueryData<ConventionCandidate[]>(["conventions", repoId]);
      if (prev) {
        // Rejecting drops the candidate from the list (it's dismissed); accept /
        // edit just merge the patch into the existing card.
        const next =
          patch.status === "rejected"
            ? prev.filter((c) => c.id !== id)
            : prev.map((c) => (c.id === id ? { ...c, ...patch } : c));
        qc.setQueryData<ConventionCandidate[]>(["conventions", repoId], next);
      }
      return { prev, repoId };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["conventions", ctx.repoId], ctx.prev);
    },
    onSettled: (_d, _e, vars) => qc.invalidateQueries({ queryKey: ["conventions", vars.repoId] }),
  });
}

/** Assemble the editable skill from the repo's ACCEPTED candidates (no persist). */
export function useConventionSkillPreview(repoId: string) {
  return useMutation({
    mutationFn: () =>
      api.post<ConventionSkillPreview>(`/repos/${repoId}/conventions/skill-preview`),
  });
}
