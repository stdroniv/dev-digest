import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import type { GetTourResponse, TourJob } from "@devdigest/shared";

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock("../api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
}));

import { useOnboardingTour, useGenerateTour, useRegenerateSection } from "./onboarding";

afterEach(() => {
  cleanup();
  apiGet.mockReset();
  apiPost.mockReset();
});

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

const EMPTY_RESPONSE: GetTourResponse = {
  availability: "empty",
  tour: null,
  stale: false,
  job: null,
};

function jobOf(status: TourJob["status"]): TourJob {
  return {
    id: "job-1",
    kind: "whole",
    sectionKind: null,
    status,
    error: status === "failed" ? "boom" : null,
    failedSectionKinds: status === "failed" ? ["architecture"] : [],
  };
}

describe("useOnboardingTour", () => {
  it("GETs /repos/:id/tour under query key ['onboarding-tour', repoId]", async () => {
    apiGet.mockResolvedValueOnce(EMPTY_RESPONSE);
    const qc = new QueryClient();
    const { result } = renderHook(() => useOnboardingTour("repo-1"), { wrapper: wrapper(qc) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiGet).toHaveBeenCalledWith("/repos/repo-1/tour");
    expect(qc.getQueryData(["onboarding-tour", "repo-1"])).toEqual(EMPTY_RESPONSE);
  });

  it("is disabled (does not fetch) when repoId is nullish", () => {
    const qc = new QueryClient();
    const { result } = renderHook(() => useOnboardingTour(null), { wrapper: wrapper(qc) });

    expect(result.current.fetchStatus).toBe("idle");
    expect(apiGet).not.toHaveBeenCalled();
  });

  it("refetchInterval returns a number while job.status is queued or running", async () => {
    apiGet.mockResolvedValueOnce({ ...EMPTY_RESPONSE, job: jobOf("queued") });
    const qc = new QueryClient();
    const { result } = renderHook(() => useOnboardingTour("repo-1"), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const interval = qc.getQueryCache().find({ queryKey: ["onboarding-tour", "repo-1"] });
    expect(interval).toBeDefined();
    const opts = interval!.options as { refetchInterval: (q: unknown) => number | false };
    expect(opts.refetchInterval(interval)).toBe(1500);

    apiGet.mockResolvedValueOnce({ ...EMPTY_RESPONSE, job: jobOf("running") });
  });

  it("refetchInterval returns false when job is null", async () => {
    apiGet.mockResolvedValueOnce(EMPTY_RESPONSE);
    const qc = new QueryClient();
    const { result } = renderHook(() => useOnboardingTour("repo-1"), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const entry = qc.getQueryCache().find({ queryKey: ["onboarding-tour", "repo-1"] });
    const opts = entry!.options as { refetchInterval: (q: unknown) => number | false };
    expect(opts.refetchInterval(entry)).toBe(false);
  });

  it("refetchInterval returns false once job.status is terminal (failed) — stops polling but keeps the error displayable", async () => {
    apiGet.mockResolvedValueOnce({ ...EMPTY_RESPONSE, job: jobOf("failed") });
    const qc = new QueryClient();
    const { result } = renderHook(() => useOnboardingTour("repo-1"), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const entry = qc.getQueryCache().find({ queryKey: ["onboarding-tour", "repo-1"] });
    const opts = entry!.options as { refetchInterval: (q: unknown) => number | false };
    expect(opts.refetchInterval(entry)).toBe(false);
    expect(result.current.data?.job?.error).toBe("boom");
  });

  it("refetchInterval returns false once job.status is terminal (done)", async () => {
    apiGet.mockResolvedValueOnce({ ...EMPTY_RESPONSE, job: jobOf("done") });
    const qc = new QueryClient();
    const { result } = renderHook(() => useOnboardingTour("repo-1"), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const entry = qc.getQueryCache().find({ queryKey: ["onboarding-tour", "repo-1"] });
    const opts = entry!.options as { refetchInterval: (q: unknown) => number | false };
    expect(opts.refetchInterval(entry)).toBe(false);
  });
});

describe("useGenerateTour", () => {
  it("POSTs /repos/:id/tour/generate and invalidates the tour query on success", async () => {
    apiPost.mockResolvedValueOnce({ job: jobOf("queued") });
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useGenerateTour("repo-1"), { wrapper: wrapper(qc) });

    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiPost).toHaveBeenCalledWith("/repos/repo-1/tour/generate");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["onboarding-tour", "repo-1"] });
  });
});

describe("useRegenerateSection", () => {
  it("POSTs /repos/:id/tour/sections/:kind/regenerate and invalidates the tour query on success", async () => {
    apiPost.mockResolvedValueOnce({ job: jobOf("queued") });
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useRegenerateSection("repo-1"), { wrapper: wrapper(qc) });

    result.current.mutate("critical_paths");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiPost).toHaveBeenCalledWith("/repos/repo-1/tour/sections/critical_paths/regenerate");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["onboarding-tour", "repo-1"] });
  });
});
