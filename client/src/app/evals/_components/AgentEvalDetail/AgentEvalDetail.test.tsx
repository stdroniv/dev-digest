import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import evalsMessages from "../../../../../messages/en/evals.json";
import shellMessages from "../../../../../messages/en/shell.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/evals/ag1",
  useSearchParams: () => new URLSearchParams(),
}));

const AGENTS = [{ id: "ag1", name: "Security Reviewer", provider: "openai", model: "gpt-4.1" }];

const DASHBOARD = {
  owner_kind: "agent",
  owner_id: "ag1",
  cases_total: 5,
  current: { recall: 0.8, precision: 0.6, citation_accuracy: 0.9, traces_passed: 4, traces_total: 5, cost_usd: 0.01 },
  delta: { recall: 0.1, precision: -0.05, citation_accuracy: 0 },
  trend: [
    { ran_at: "2026-06-01T00:00:00Z", recall: 0.7, precision: 0.65, citation_accuracy: 0.9, pass_rate: 0.8, cost_usd: 0.01 },
    { ran_at: "2026-07-01T00:00:00Z", recall: 0.8, precision: 0.6, citation_accuracy: 0.9, pass_rate: 0.8, cost_usd: 0.01 },
  ],
  recent_runs: [],
  alert: "Precision dipped 5pts on v3",
};

const RUNS = [
  {
    id: "r2",
    run_group_id: "rg2",
    agent_id: "ag1",
    agent_version: 3,
    ran_at: "2026-07-01T00:00:00Z",
    recall: 0.8,
    precision: 0.6,
    citation_accuracy: 0.9,
    traces_passed: 4,
    traces_total: 5,
    cost_usd: 0.012,
  },
  {
    id: "r1",
    run_group_id: "rg1",
    agent_id: "ag1",
    agent_version: 2,
    ran_at: "2026-06-01T00:00:00Z",
    recall: 0.7,
    precision: 0.65,
    citation_accuracy: 0.9,
    traces_passed: 3,
    traces_total: 5,
    cost_usd: 0.008,
  },
];

const runAllMutate = vi.fn();
const compareMutate = vi.fn();

// Mutable per-test override so a single test can feed a degenerate dashboard
// (e.g. a single-point trend) without disturbing the others.
const hoisted = vi.hoisted(() => ({ dashboard: undefined as any }));

vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: AGENTS }),
}));

vi.mock("@/lib/hooks/evals", () => ({
  useAgentEvalDashboard: () => ({ data: hoisted.dashboard ?? DASHBOARD, isLoading: false, isError: false, refetch: vi.fn() }),
  useAgentEvalRuns: () => ({ data: RUNS, isLoading: false }),
  useRunAllEvals: () => ({ mutate: runAllMutate, isPending: false }),
  useCompareRuns: () => ({ mutate: compareMutate, data: undefined, isPending: true, isError: false }),
  usePromoteVersion: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { AgentEvalDetail } from "./AgentEvalDetail";

afterEach(() => {
  cleanup();
  runAllMutate.mockReset();
  compareMutate.mockReset();
  hoisted.dashboard = undefined;
});

function renderWithIntl(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ evals: evalsMessages, shell: shellMessages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("AgentEvalDetail (T17, AC-15/AC-18)", () => {
  it("renders the header, metric cards with delta, and the alert banner (AC-14)", () => {
    renderWithIntl(<AgentEvalDetail agentId="ag1" agentName="Security Reviewer" />);
    expect(screen.getByText(/Security Reviewer · Regression harness · 2 runs on the gold set/)).toBeInTheDocument();
    expect(screen.getByText("RECALL")).toBeInTheDocument();
    expect(screen.getByText("PRECISION")).toBeInTheDocument();
    expect(screen.getByText("CITATION ACCURACY")).toBeInTheDocument();
    expect(screen.getByText("Precision dipped 5pts on v3")).toBeInTheDocument();
  });

  it("does not emit a NaN `cx` warning when an agent has a single run (single-point trend)", () => {
    // Regression: a 1-point sparkline computes i/(len-1) = 0/0 = NaN for its
    // <circle cx>, which React reports via console.error. sparkOf() must drop
    // sub-2-point trends so the card renders without a sparkline instead.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    hoisted.dashboard = { ...DASHBOARD, trend: [DASHBOARD.trend[0]] };
    renderWithIntl(<AgentEvalDetail agentId="ag1" agentName="Security Reviewer" />);
    expect(screen.getByText("RECALL")).toBeInTheDocument();
    const sawNaNWarning = errSpy.mock.calls.some((args) =>
      args.some((a) => typeof a === "string" && a.includes("NaN")),
    );
    expect(sawNaNWarning).toBe(false);
    errSpy.mockRestore();
  });

  it("renders Metric Trend heading and the per-agent recent runs table with all AC-15 fields", () => {
    renderWithIntl(<AgentEvalDetail agentId="ag1" agentName="Security Reviewer" />);
    expect(screen.getByText("Metric trend")).toBeInTheDocument();
    expect(screen.getByText("Recent runs")).toBeInTheDocument();
    // both runs' versions render
    expect(screen.getByText("v3")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    // cost column
    expect(screen.getByText("$0.012")).toBeInTheDocument();
    expect(screen.getByText("$0.0080")).toBeInTheDocument();
    // pass counts
    expect(screen.getByText("4/5")).toBeInTheDocument();
    expect(screen.getByText("3/5")).toBeInTheDocument();
  });

  it("selecting exactly two runs enables Compare and opens the CompareRunsModal (AC-15/AC-18)", () => {
    renderWithIntl(<AgentEvalDetail agentId="ag1" agentName="Security Reviewer" />);
    const compareButton = screen.getByText("Compare").closest("button")!;
    expect(compareButton).toBeDisabled();

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);

    expect(compareButton).not.toBeDisabled();
    fireEvent.click(compareButton);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(compareMutate).toHaveBeenCalledWith({ old_run_group_id: "rg1", new_run_group_id: "rg2" });
  });
});
