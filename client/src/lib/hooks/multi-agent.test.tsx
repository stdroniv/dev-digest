import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { MultiAgentRun } from "@devdigest/shared";

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock("../api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
}));

import {
  useAgentEstimates,
  useLaunchMultiAgentRun,
  useLearnFinding,
  useMultiAgentRun,
  type EstimateRow,
} from "./multi-agent";

afterEach(() => {
  cleanup();
  apiGet.mockReset();
  apiPost.mockReset();
  vi.useRealTimers();
});

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** A minimal single-column MultiAgentRun fixture at a given column status. */
function runFixture(status: "running" | "done" | "failed"): MultiAgentRun {
  return {
    id: "run-1",
    pr_id: "pr-1",
    pr_number: 42,
    ran_at: "2026-07-12T00:00:00.000Z",
    agent_count: 1,
    total_duration_ms: status === "done" ? 1200 : 0,
    total_cost_usd: status === "done" ? 0.12 : null,
    columns: [
      {
        run_id: "ar-1",
        agent_id: "ag-1",
        agent_name: "Security Reviewer",
        provider: "openai",
        model: "gpt-4o",
        status,
        verdict: status === "done" ? "approve" : null,
        score: status === "done" ? 82 : null,
        summary: status === "done" ? "Looks fine." : null,
        duration_ms: status === "done" ? 1200 : null,
        cost_usd: status === "done" ? 0.12 : null,
        findings: [],
      },
    ],
    conflicts: [],
  };
}

describe("useAgentEstimates", () => {
  it("GETs /multi-agent/estimates and stores the { estimates } payload", async () => {
    const estimates: EstimateRow[] = [
      { agent_id: "ag-1", agent_name: "Security Reviewer", avg_latency_ms: 4000, avg_cost_usd: 0.02, runs: 3 },
      { agent_id: "ag-2", agent_name: "General Reviewer", avg_latency_ms: null, avg_cost_usd: null, runs: 0 },
    ];
    apiGet.mockResolvedValueOnce({ estimates });

    const qc = new QueryClient();
    const { result } = renderHook(() => useAgentEstimates(), { wrapper: wrapper(qc) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiGet).toHaveBeenCalledWith("/multi-agent/estimates");
    expect(result.current.data).toEqual({ estimates });
    expect(qc.getQueryData(["agent-estimates"])).toEqual({ estimates });
  });
});

describe("useLaunchMultiAgentRun", () => {
  it("POSTs agent_ids to /pulls/:id/multi-agent-run and invalidates the PR run history", async () => {
    apiPost.mockResolvedValueOnce({ run_id: "run-1", pr_id: "pr-1" });

    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useLaunchMultiAgentRun(), { wrapper: wrapper(qc) });

    result.current.mutate({ prId: "pr-1", agentIds: ["ag-1", "ag-2"] });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiPost).toHaveBeenCalledWith("/pulls/pr-1/multi-agent-run", { agent_ids: ["ag-1", "ag-2"] });
    expect(result.current.data).toEqual({ run_id: "run-1", pr_id: "pr-1" });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["pr-runs", "pr-1"] });
  });
});

describe("useLearnFinding", () => {
  it("POSTs to /findings/:id/learn and resolves the memory id", async () => {
    apiPost.mockResolvedValueOnce({ memory_id: "mem-1" });

    const qc = new QueryClient();
    const { result } = renderHook(() => useLearnFinding(), { wrapper: wrapper(qc) });

    result.current.mutate("finding-1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiPost).toHaveBeenCalledWith("/findings/finding-1/learn");
    expect(result.current.data).toEqual({ memory_id: "mem-1" });
  });
});

describe("useMultiAgentRun", () => {
  it("does not fetch when runId is null", () => {
    const qc = new QueryClient();
    const { result } = renderHook(() => useMultiAgentRun(null), { wrapper: wrapper(qc) });

    expect(result.current.fetchStatus).toBe("idle");
    expect(apiGet).not.toHaveBeenCalled();
  });

  it("polls every 4s while any column is running, and stops (false) once every column is non-running", async () => {
    // Simulating the actual 4s wall-clock interval via fake timers + jsdom +
    // TanStack Query's internal scheduling is flaky (the observer's cache
    // update lands a tick later than any single `advanceTimersByTimeAsync`
    // reliably flushes — see client/INSIGHTS.md's fake-timer notes for the
    // general hazard). Instead, read the REAL `refetchInterval` predicate
    // that this live hook wired into its query observer (via the actual
    // QueryClient — not a reimplementation) and drive it directly with
    // synthetic query snapshots. This exercises the exact function
    // TanStack Query calls to decide whether to keep polling.
    apiGet.mockResolvedValueOnce(runFixture("running"));

    const qc = new QueryClient();
    const { result } = renderHook(() => useMultiAgentRun("run-1"), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const query = qc.getQueryCache().find({ queryKey: ["multi-agent-run", "run-1"] });
    const refetchInterval = query?.observers[0]?.options.refetchInterval as
      | ((q: { state: { data?: MultiAgentRun } }) => number | false)
      | undefined;
    expect(typeof refetchInterval).toBe("function");

    // Any column running → keep polling every 4s.
    expect(refetchInterval!({ state: { data: runFixture("running") } })).toBe(4000);
    // Every column settled (done or failed) → stop polling.
    expect(refetchInterval!({ state: { data: runFixture("done") } })).toBe(false);
    expect(refetchInterval!({ state: { data: runFixture("failed") } })).toBe(false);
    // No data yet → nothing to poll for.
    expect(refetchInterval!({ state: { data: undefined } })).toBe(false);
  });
});
