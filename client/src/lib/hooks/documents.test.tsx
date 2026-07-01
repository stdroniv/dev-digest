import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AgentDocumentLink } from "@devdigest/shared";

const apiPost = vi.fn();
const apiGet = vi.fn();
vi.mock("../api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
}));

import { useSetAgentDocuments } from "./documents";

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

describe("useSetAgentDocuments", () => {
  it("POSTs { paths } to /agents/:id/documents and updates the agent-documents cache", async () => {
    const links: AgentDocumentLink[] = [
      { path: "specs/SPEC-01.md", order: 0 },
      { path: "docs/architecture.md", order: 1 },
    ];
    apiPost.mockResolvedValueOnce(links);

    const qc = new QueryClient();
    const { result } = renderHook(() => useSetAgentDocuments("ag1"), {
      wrapper: wrapper(qc),
    });

    result.current.mutate(["specs/SPEC-01.md", "docs/architecture.md"]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiPost).toHaveBeenCalledWith("/agents/ag1/documents", {
      paths: ["specs/SPEC-01.md", "docs/architecture.md"],
    });
    expect(qc.getQueryData(["agent-documents", "ag1"])).toEqual(links);
  });
});
