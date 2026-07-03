import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AgentDocumentLink, SkillDocumentLink } from "@devdigest/shared";

const apiPost = vi.fn();
const apiGet = vi.fn();
vi.mock("../api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
}));

import {
  useAgentDocuments,
  useSetAgentDocuments,
  useSkillDocuments,
  useSetSkillDocuments,
} from "./documents";

afterEach(() => {
  cleanup();
  apiPost.mockReset();
  apiGet.mockReset();
});

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
}

describe("useAgentDocuments", () => {
  it("is disabled (does not fetch) when repoId is null", () => {
    const qc = new QueryClient();
    const { result } = renderHook(() => useAgentDocuments("ag1", null), {
      wrapper: wrapper(qc),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(apiGet).not.toHaveBeenCalled();
  });

  it("GETs ?repo_id= and stores the result under a query key scoped to (agentId, repoId)", async () => {
    const links: AgentDocumentLink[] = [{ path: "specs/SPEC-01.md", order: 0, repo_id: "repo-1" }];
    apiGet.mockResolvedValueOnce(links);

    const qc = new QueryClient();
    const { result } = renderHook(() => useAgentDocuments("ag1", "repo-1"), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiGet).toHaveBeenCalledWith("/agents/ag1/documents?repo_id=repo-1");
    expect(qc.getQueryData(["agent-documents", "ag1", "repo-1"])).toEqual(links);
  });

  it("fetches independently per repo — switching repoId issues a fresh GET for the new repo's key", async () => {
    const linksA: AgentDocumentLink[] = [{ path: "specs/a.md", order: 0, repo_id: "repo-A" }];
    const linksB: AgentDocumentLink[] = [{ path: "specs/b.md", order: 0, repo_id: "repo-B" }];
    apiGet.mockResolvedValueOnce(linksA).mockResolvedValueOnce(linksB);

    const qc = new QueryClient();
    const { result, rerender } = renderHook(
      ({ repoId }: { repoId: string }) => useAgentDocuments("ag1", repoId),
      { wrapper: wrapper(qc), initialProps: { repoId: "repo-A" } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(linksA);

    rerender({ repoId: "repo-B" });
    await waitFor(() => expect(result.current.data).toEqual(linksB));

    // Both repos' lists remain independently cached — switching back doesn't refetch.
    expect(qc.getQueryData(["agent-documents", "ag1", "repo-A"])).toEqual(linksA);
    expect(qc.getQueryData(["agent-documents", "ag1", "repo-B"])).toEqual(linksB);
  });
});

describe("useSetAgentDocuments", () => {
  it("always sends repo_id in the POST body — including when clearing (paths: [])", async () => {
    apiPost.mockResolvedValueOnce([]);

    const qc = new QueryClient();
    const { result } = renderHook(() => useSetAgentDocuments("ag1"), {
      wrapper: wrapper(qc),
    });

    result.current.mutate({ paths: [], repoId: "repo-1" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiPost).toHaveBeenCalledWith("/agents/ag1/documents", {
      paths: [],
      repo_id: "repo-1",
    });
  });

  it("writes the mutation response back to the repo-scoped cache key it targeted", async () => {
    const links: AgentDocumentLink[] = [
      { path: "specs/SPEC-01.md", order: 0, repo_id: "repo-1" },
      { path: "docs/architecture.md", order: 1, repo_id: "repo-1" },
    ];
    apiPost.mockResolvedValueOnce(links);

    const qc = new QueryClient();
    const { result } = renderHook(() => useSetAgentDocuments("ag1"), {
      wrapper: wrapper(qc),
    });

    result.current.mutate({
      paths: ["specs/SPEC-01.md", "docs/architecture.md"],
      repoId: "repo-1",
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiPost).toHaveBeenCalledWith("/agents/ag1/documents", {
      paths: ["specs/SPEC-01.md", "docs/architecture.md"],
      repo_id: "repo-1",
    });
    expect(qc.getQueryData(["agent-documents", "ag1", "repo-1"])).toEqual(links);
  });
});

describe("useSkillDocuments", () => {
  it("is disabled (does not fetch) when repoId is null", () => {
    const qc = new QueryClient();
    const { result } = renderHook(() => useSkillDocuments("sk1", null), {
      wrapper: wrapper(qc),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(apiGet).not.toHaveBeenCalled();
  });

  it("GETs ?repo_id= and stores the result under a query key scoped to (skillId, repoId)", async () => {
    const links: SkillDocumentLink[] = [{ path: "specs/SPEC-01.md", order: 0, repo_id: "repo-1" }];
    apiGet.mockResolvedValueOnce(links);

    const qc = new QueryClient();
    const { result } = renderHook(() => useSkillDocuments("sk1", "repo-1"), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiGet).toHaveBeenCalledWith("/skills/sk1/documents?repo_id=repo-1");
    expect(qc.getQueryData(["skill-documents", "sk1", "repo-1"])).toEqual(links);
  });
});

describe("useSetSkillDocuments", () => {
  it("always sends repo_id in the POST body — including when clearing (paths: [])", async () => {
    apiPost.mockResolvedValueOnce([]);

    const qc = new QueryClient();
    const { result } = renderHook(() => useSetSkillDocuments("sk1"), {
      wrapper: wrapper(qc),
    });

    result.current.mutate({ paths: [], repoId: "repo-1" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiPost).toHaveBeenCalledWith("/skills/sk1/documents", {
      paths: [],
      repo_id: "repo-1",
    });
  });
});
