/* Hook-level invalidation tests (T19) — mocked `../api`, real hooks + a real
   QueryClient, per the documents.ts hook-test pattern (client/INSIGHTS.md
   "What Works"). Proves the cross-surface refresh the individual component
   tasks each assume: a case created from a finding refreshes the agent's
   case list + dashboards; a run refreshes the agent + cross-agent
   dashboards; promote refreshes the agent. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Agent, EvalCase, EvalRunGroup } from "@devdigest/shared";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();
const apiDel = vi.fn();
vi.mock("../api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    put: (...args: unknown[]) => apiPut(...args),
    del: (...args: unknown[]) => apiDel(...args),
  },
}));

import {
  useCreateCaseFromFinding,
  useRunAllEvals,
  usePromoteVersion,
  evalKeys,
} from "./evals";

afterEach(() => {
  cleanup();
  apiGet.mockReset();
  apiPost.mockReset();
  apiPut.mockReset();
  apiDel.mockReset();
});

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useCreateCaseFromFinding — cross-surface invalidation", () => {
  it("invalidates the owning agent's case list + dashboards after creating a case from a finding", async () => {
    const evalCase: EvalCase = {
      id: "c1",
      owner_kind: "agent",
      owner_id: "ag1",
      name: "stripe-key-leak",
      input_diff: "",
      input_files: null,
      input_meta: null,
      expected_output: [],
      notes: null,
    };
    apiPost.mockResolvedValueOnce({ case: evalCase, already_added: false });

    const qc = new QueryClient();
    // Pre-seed the keys this mutation must invalidate so we can observe the flip.
    qc.setQueryData(evalKeys.cases("ag1"), []);
    qc.setQueryData(evalKeys.agentDashboard("ag1"), {});
    qc.setQueryData(evalKeys.dashboard(), {});

    const { result } = renderHook(() => useCreateCaseFromFinding(), { wrapper: wrapper(qc) });
    result.current.mutate({ findingId: "finding-1" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiPost).toHaveBeenCalledWith("/findings/finding-1/eval-case", {});
    expect(qc.getQueryState(evalKeys.cases("ag1"))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(evalKeys.agentDashboard("ag1"))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(evalKeys.dashboard())?.isInvalidated).toBe(true);
  });
});

describe("useRunAllEvals — cross-surface invalidation", () => {
  it("invalidates the agent's case list + run history + agent dashboard + cross-agent dashboard after a run", async () => {
    const runGroup: EvalRunGroup = {
      id: "rg1",
      run_group_id: "rg1",
      agent_id: "ag1",
      agent_version: 2,
      ran_at: "2026-07-01T00:00:00Z",
      recall: 0.8,
      precision: 0.7,
      citation_accuracy: 0.9,
      traces_passed: 4,
      traces_total: 5,
      cost_usd: 0.01,
    };
    apiPost.mockResolvedValueOnce(runGroup);

    const qc = new QueryClient();
    qc.setQueryData(evalKeys.cases("ag1"), []);
    qc.setQueryData(evalKeys.runs("ag1"), []);
    qc.setQueryData(evalKeys.agentDashboard("ag1"), {});
    qc.setQueryData(evalKeys.dashboard(), {});

    const { result } = renderHook(() => useRunAllEvals(), { wrapper: wrapper(qc) });
    result.current.mutate("ag1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiPost).toHaveBeenCalledWith("/agents/ag1/eval-runs");
    expect(qc.getQueryState(evalKeys.cases("ag1"))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(evalKeys.runs("ag1"))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(evalKeys.agentDashboard("ag1"))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(evalKeys.dashboard())?.isInvalidated).toBe(true);
  });
});

describe("usePromoteVersion — refreshes the agent", () => {
  it("invalidates the agents list + this agent's eval dashboard/runs/cross-dashboard, and writes the updated agent into cache", async () => {
    const agent: Agent = {
      id: "ag1",
      name: "Security Reviewer",
      description: "",
      provider: "openai",
      model: "gpt-4.1",
      system_prompt: "x",
      output_schema: null,
      strategy: "single-pass",
      ci_fail_on: "critical",
      repo_intel: true,
      enabled: true,
      version: 3,
    };
    apiPost.mockResolvedValueOnce(agent);

    const qc = new QueryClient();
    qc.setQueryData(["agents"], []);
    qc.setQueryData(evalKeys.agentDashboard("ag1"), {});
    qc.setQueryData(evalKeys.runs("ag1"), []);
    qc.setQueryData(evalKeys.dashboard(), {});

    const { result } = renderHook(() => usePromoteVersion(), { wrapper: wrapper(qc) });
    result.current.mutate({ agentId: "ag1", version: 3 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiPost).toHaveBeenCalledWith("/agents/ag1/eval-promote", { version: 3 });
    expect(qc.getQueryState(["agents"])?.isInvalidated).toBe(true);
    expect(qc.getQueryData(["agent", "ag1"])).toEqual(agent);
    expect(qc.getQueryState(evalKeys.agentDashboard("ag1"))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(evalKeys.runs("ag1"))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(evalKeys.dashboard())?.isInvalidated).toBe(true);
  });
});
