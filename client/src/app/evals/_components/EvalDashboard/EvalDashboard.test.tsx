import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import evalsMessages from "../../../../../messages/en/evals.json";
import shellMessages from "../../../../../messages/en/shell.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/evals",
  useSearchParams: () => new URLSearchParams(),
}));

const AGENTS = [
  { id: "ag1", name: "Security Reviewer", provider: "openai", model: "gpt-4.1" },
  { id: "ag2", name: "Style Reviewer", provider: "anthropic", model: "claude-3.5" },
];

const CROSS_DASHBOARD = {
  agents: [
    {
      id: "r1",
      run_group_id: "rg1",
      agent_id: "ag1",
      agent_name: "Security Reviewer",
      agent_version: 3,
      ran_at: "2026-07-01T00:00:00Z",
      recall: 0.8,
      precision: 0.6,
      citation_accuracy: 0.9,
      traces_passed: 4,
      traces_total: 5,
      cost_usd: 0.01,
      cases_total: 5,
    },
    {
      id: "r2",
      run_group_id: "rg2",
      agent_id: "ag2",
      agent_name: "Style Reviewer",
      agent_version: 1,
      ran_at: "2026-06-20T00:00:00Z",
      recall: 0.5,
      precision: 0.7,
      citation_accuracy: 0.4,
      traces_passed: 2,
      traces_total: 4,
      cost_usd: 0.02,
      cases_total: 4,
    },
  ],
  recent_runs: [
    {
      id: "r1",
      run_group_id: "rg1",
      agent_id: "ag1",
      agent_name: "Security Reviewer",
      agent_version: 3,
      ran_at: "2026-07-01T00:00:00Z",
      recall: 0.8,
      precision: 0.6,
      citation_accuracy: 0.9,
      traces_passed: 4,
      traces_total: 5,
      cost_usd: 0.01,
    },
  ],
};

const AGENT_DASHBOARD = {
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
  alert: null,
};

const runAllAgentsMutate = vi.fn();

vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: AGENTS }),
}));

vi.mock("@/lib/hooks/evals", () => ({
  useEvalDashboard: () => ({ data: CROSS_DASHBOARD, isLoading: false, isError: false, refetch: vi.fn() }),
  useRunAllAgents: () => ({ mutate: runAllAgentsMutate, isPending: false }),
  useAgentEvalDashboard: () => ({ data: AGENT_DASHBOARD, isLoading: false, isError: false, refetch: vi.fn() }),
  useAgentEvalRuns: () => ({ data: [], isLoading: false }),
  useRunAllEvals: () => ({ mutate: vi.fn(), isPending: false }),
  useCompareRuns: () => ({ mutate: vi.fn(), data: undefined, isPending: false, isError: false }),
  usePromoteVersion: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { EvalDashboard } from "./EvalDashboard";

afterEach(() => {
  cleanup();
  runAllAgentsMutate.mockReset();
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

describe("EvalDashboard (T17, AC-17)", () => {
  it("renders a card per agent with recall/precision/citation and pass count", () => {
    renderWithIntl(<EvalDashboard />);
    expect(screen.getAllByText("Security Reviewer").length).toBeGreaterThan(0);
    expect(screen.getByText("Style Reviewer")).toBeInTheDocument();
    expect(screen.getByText(/4\/5 pass/)).toBeInTheDocument();
    const card = screen.getAllByText("Security Reviewer")[0]!.closest("button")!;
    expect(within(card).getByText("80%")).toBeInTheDocument(); // ag1 recall
    expect(within(card).getByText("60%")).toBeInTheDocument(); // ag1 precision
    expect(within(card).getByText("90%")).toBeInTheDocument(); // ag1 citation
  });

  it("renders the cross-agent Recent Eval Runs table newest-first", () => {
    renderWithIntl(<EvalDashboard />);
    expect(screen.getByText(/Recent Eval Runs/)).toBeInTheDocument();
    expect(screen.getAllByText("Security Reviewer").length).toBeGreaterThan(0);
  });

  it('"Run all agents" invokes the mutation and reflects per-agent results (AC-26)', () => {
    runAllAgentsMutate.mockImplementation((_input, opts) => {
      opts?.onSuccess?.([
        { agent_id: "ag1", agent_name: "Security Reviewer", ok: true, run: { traces_passed: 4, traces_total: 5 } },
        { agent_id: "ag2", agent_name: "Style Reviewer", ok: false, error: "boom" },
      ]);
    });
    renderWithIntl(<EvalDashboard />);
    fireEvent.click(screen.getByText("Run all agents"));
    expect(runAllAgentsMutate).toHaveBeenCalled();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("clicking an agent card drills into the agent eval detail (AC-18)", () => {
    renderWithIntl(<EvalDashboard />);
    const card = screen.getAllByText("Security Reviewer")[0]!.closest("button")!;
    fireEvent.click(card);
    expect(screen.getByText(/Regression harness/)).toBeInTheDocument();
  });
});
