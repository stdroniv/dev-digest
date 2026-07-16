import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { CiExport, CiInstallation, CiRun } from "@devdigest/shared";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiGetBlob = vi.fn();
vi.mock("../api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    getBlob: (...args: unknown[]) => apiGetBlob(...args),
  },
}));

import {
  ciKeys,
  useCiRuns,
  useReconcileCiRuns,
  useCiInstallations,
  useAgentRuns,
  useExportPreview,
  useExportInstall,
  useExportZip,
} from "./ci";

afterEach(() => {
  cleanup();
  apiGet.mockReset();
  apiPost.mockReset();
  apiGetBlob.mockReset();
});

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useCiRuns", () => {
  it("GETs /ci-runs with no query string when called with no filters", async () => {
    const runs: CiRun[] = [];
    apiGet.mockResolvedValueOnce(runs);

    const qc = new QueryClient();
    const { result } = renderHook(() => useCiRuns(), { wrapper: wrapper(qc) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiGet).toHaveBeenCalledWith("/ci-runs");
  });

  it("builds a query string from the given filters (AC-36)", async () => {
    apiGet.mockResolvedValueOnce([]);
    const qc = new QueryClient();
    const { result } = renderHook(
      () => useCiRuns({ agent_id: "ag1", status: "failed", source: "ci" }),
      { wrapper: wrapper(qc) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiGet).toHaveBeenCalledWith("/ci-runs?agent_id=ag1&status=failed&source=ci");
  });
});

describe("useReconcileCiRuns", () => {
  it("POSTs /ci/reconcile and invalidates the CI-runs + installations caches", async () => {
    apiPost.mockResolvedValueOnce({ ok: true });
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useReconcileCiRuns(), { wrapper: wrapper(qc) });

    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiPost).toHaveBeenCalledWith("/ci/reconcile");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ciKeys.runs() });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["ci-installations"] });
  });
});

describe("useCiInstallations", () => {
  it("is disabled (does not fetch) without an agentId", () => {
    const qc = new QueryClient();
    const { result } = renderHook(() => useCiInstallations(null), { wrapper: wrapper(qc) });
    expect(result.current.fetchStatus).toBe("idle");
    expect(apiGet).not.toHaveBeenCalled();
  });

  it("GETs an agent's CI installations", async () => {
    const installations: CiInstallation[] = [];
    apiGet.mockResolvedValueOnce(installations);
    const qc = new QueryClient();
    const { result } = renderHook(() => useCiInstallations("ag1"), { wrapper: wrapper(qc) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiGet).toHaveBeenCalledWith("/agents/ag1/ci/installations");
  });
});

describe("useAgentRuns", () => {
  it("GETs an agent's local+CI run history", async () => {
    apiGet.mockResolvedValueOnce([]);
    const qc = new QueryClient();
    const { result } = renderHook(() => useAgentRuns("ag1"), { wrapper: wrapper(qc) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiGet).toHaveBeenCalledWith("/agents/ag1/runs");
  });
});

describe("useExportPreview", () => {
  it("POSTs a preview request scoped to the agent (AC-2/3)", async () => {
    const preview = { installation: {}, files: [], pr_url: null } as unknown as CiExport;
    apiPost.mockResolvedValueOnce(preview);
    const qc = new QueryClient();
    const { result } = renderHook(() => useExportPreview(), { wrapper: wrapper(qc) });

    result.current.mutate({ agentId: "ag1", input: { repo: "acme/payments-api" } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiPost).toHaveBeenCalledWith("/agents/ag1/ci/preview", { repo: "acme/payments-api" });
  });
});

describe("useExportInstall", () => {
  it("POSTs an install request and invalidates the agent's installations + CI runs (AC-9/17)", async () => {
    const exportResult = {
      installation: { id: "inst1" },
      files: [],
      pr_url: "https://github.com/acme/payments-api/pull/1",
    } as unknown as CiExport;
    apiPost.mockResolvedValueOnce(exportResult);
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useExportInstall(), { wrapper: wrapper(qc) });

    result.current.mutate({ agentId: "ag1", input: { repo: "acme/payments-api" } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiPost).toHaveBeenCalledWith("/agents/ag1/ci/install", { repo: "acme/payments-api" });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ciKeys.installations("ag1") });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ciKeys.runs() });
  });
});

describe("useExportZip", () => {
  it("fetches the same generated bundle as a zip Blob (AC-10)", async () => {
    const blob = new Blob(["zip-bytes"], { type: "application/zip" });
    apiGetBlob.mockResolvedValueOnce(blob);
    const qc = new QueryClient();
    const { result } = renderHook(() => useExportZip(), { wrapper: wrapper(qc) });

    result.current.mutate("ag1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiGetBlob).toHaveBeenCalledWith("/agents/ag1/ci/bundle.zip");
    expect(result.current.data).toBe(blob);
  });
});
