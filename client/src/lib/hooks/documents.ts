/* hooks/documents.ts — React Query hooks for Project Context documents (SPEC-01):
   repo-scoped document discovery + preview, and the agent/skill document
   attachment links used by the Project Context screen and the Agent/Skill
   editors' Context tabs. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { AgentDocumentLink, ProjectDocument, SkillDocumentLink } from "@devdigest/shared";

// ---- repo documents (Project Context screen) -------------------------------

export interface RepoDocumentsResponse {
  documents: ProjectDocument[];
  state: "ready" | "not_cloned" | "empty";
}

export function useRepoDocuments(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["repo-documents", repoId],
    queryFn: () => api.get<RepoDocumentsResponse>(`/repos/${repoId}/documents`),
    enabled: !!repoId,
  });
}

export interface DocumentContentResponse {
  path: string;
  content: string;
}

/** Lazily loads a single document's content — only fetches once a path is selected. */
export function useDocumentPreview(repoId: string | null | undefined, path: string | null | undefined) {
  return useQuery({
    queryKey: ["repo-document-content", repoId, path],
    queryFn: () =>
      api.get<DocumentContentResponse>(
        `/repos/${repoId}/documents/content?path=${encodeURIComponent(path!)}`,
      ),
    enabled: !!repoId && !!path,
  });
}

// ---- agent ↔ document links (Agent editor → Context tab) --------------------

export function useAgentDocuments(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-documents", agentId],
    queryFn: () => api.get<AgentDocumentLink[]>(`/agents/${agentId}/documents`),
    enabled: !!agentId,
  });
}

/** Replace the full ordered set of an agent's linked documents (attach + reorder). */
export function useSetAgentDocuments(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paths: string[]) =>
      api.post<AgentDocumentLink[]>(`/agents/${agentId}/documents`, { paths }),
    onSuccess: (data) => {
      qc.setQueryData(["agent-documents", agentId], data);
      qc.invalidateQueries({ queryKey: ["agent", agentId] });
    },
  });
}

// ---- skill ↔ document links (Skill editor → "Project context to use") ------

export function useSkillDocuments(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-documents", skillId],
    queryFn: () => api.get<SkillDocumentLink[]>(`/skills/${skillId}/documents`),
    enabled: !!skillId,
  });
}

/** Replace the full ordered set of a skill's linked documents (attach + reorder). */
export function useSetSkillDocuments(skillId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paths: string[]) =>
      api.post<SkillDocumentLink[]>(`/skills/${skillId}/documents`, { paths }),
    onSuccess: (data) => {
      qc.setQueryData(["skill-documents", skillId], data);
      qc.invalidateQueries({ queryKey: ["skill", skillId] });
    },
  });
}
