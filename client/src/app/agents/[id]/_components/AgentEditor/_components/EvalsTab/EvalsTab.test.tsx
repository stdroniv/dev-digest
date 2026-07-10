import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalCase, EvalDashboard } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/evals.json";

const CASES: EvalCase[] = [
  {
    id: "c1",
    owner_kind: "agent",
    owner_id: "ag1",
    name: "stripe-key-leak",
    input_diff: "--- a/src/config.ts\n+++ b/src/config.ts",
    input_files: null,
    input_meta: null,
    expected_output: [
      { file: "src/config.ts", start_line: 10, end_line: 12, severity: "CRITICAL", category: "security" },
    ],
    notes: null,
  },
  {
    id: "c2",
    owner_kind: "agent",
    owner_id: "ag1",
    name: "clean-refactor-no-flag",
    input_diff: "--- a/src/util.ts\n+++ b/src/util.ts",
    input_files: null,
    input_meta: null,
    expected_output: [],
    notes: null,
  },
];

const DASHBOARD: EvalDashboard = {
  owner_kind: "agent",
  owner_id: "ag1",
  cases_total: 2,
  current: { recall: 0.8, precision: 0.6, citation_accuracy: 0.9, traces_passed: 1, traces_total: 2, cost_usd: 0.01 },
  delta: { recall: 0.1, precision: -0.05, citation_accuracy: 0 },
  trend: [],
  recent_runs: [
    {
      id: "r1",
      case_id: "c1",
      case_name: "stripe-key-leak",
      ran_at: "2026-07-01T00:00:00Z",
      actual_output: [{ file: "src/config.ts", start_line: 10, end_line: 12 }],
      pass: true,
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      duration_ms: 1200,
      cost_usd: 0.002,
    },
    {
      id: "r2",
      case_id: "c2",
      case_name: "clean-refactor-no-flag",
      ran_at: "2026-06-30T00:00:00Z",
      actual_output: [],
      pass: false,
      recall: 0,
      precision: 0,
      citation_accuracy: 0,
      duration_ms: 900,
      cost_usd: 0.001,
    },
  ],
  alert: null,
};

const runAllMutate = vi.fn();
const runOneMutate = vi.fn();
const deleteMutate = vi.fn();

vi.mock("@/lib/hooks/evals", () => ({
  useAgentEvalCases: () => ({ data: CASES, isLoading: false }),
  useAgentEvalDashboard: () => ({ data: DASHBOARD }),
  useRunAllEvals: () => ({ mutate: runAllMutate, isPending: false }),
  useRunSingleCase: () => ({ mutate: runOneMutate, isPending: false }),
  useDeleteCase: () => ({ mutate: deleteMutate, isPending: false }),
  useCreateCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateCaseFromFinding: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { EvalsTab } from "./EvalsTab";

afterEach(() => {
  cleanup();
  runAllMutate.mockReset();
  runOneMutate.mockReset();
  deleteMutate.mockReset();
});

const AGENT: Agent = {
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
  version: 1,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ evals: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("Agent EvalsTab (T15, AC-6/AC-8)", () => {
  it("renders the case list with expectation summaries and the N/M passing count", () => {
    renderWithIntl(<EvalsTab agent={AGENT} />);
    expect(screen.getByText("stripe-key-leak")).toBeInTheDocument();
    expect(screen.getByText("clean-refactor-no-flag")).toBeInTheDocument();
    expect(screen.getByText("expected 1 finding")).toBeInTheDocument();
    expect(screen.getByText("1 / 2 passed")).toBeInTheDocument();
  });

  it('shows "empty []" for a must_not_flag case', () => {
    renderWithIntl(<EvalsTab agent={AGENT} />);
    expect(screen.getByText("empty []")).toBeInTheDocument();
  });

  it("shows the last-run status per row (passed / failed)", () => {
    renderWithIntl(<EvalsTab agent={AGENT} />);
    expect(screen.getByText("passed")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("renders the eval metric cards with current values + delta vs the previous run (AC-8)", () => {
    renderWithIntl(<EvalsTab agent={AGENT} />);
    expect(screen.getByText("RECALL")).toBeInTheDocument();
    expect(screen.getByText("PRECISION")).toBeInTheDocument();
    expect(screen.getByText("CITATION ACCURACY")).toBeInTheDocument();
    expect(screen.getByText("TRACES PASSED")).toBeInTheDocument();
    expect(
      screen.getByText((_, el) => el?.tagName === "SPAN" && el.className === "tnum" && el.textContent === "80%"),
    ).toBeInTheDocument(); // recall current
    expect(screen.getByText("1/2")).toBeInTheDocument(); // traces passed/total
    // Delta renders as a raw fraction (MetricCard applies .toFixed(2)), matching
    // the design — NOT pre-multiplied by 100. recall +0.10, precision -0.05.
    expect(screen.getByText("0.10")).toBeInTheDocument(); // recall delta (up)
    expect(screen.getByText("0.05")).toBeInTheDocument(); // precision delta (down)
  });

  it('"Run all evals" invokes the run-all mutation', () => {
    renderWithIntl(<EvalsTab agent={AGENT} />);
    fireEvent.click(screen.getByText("Run all evals"));
    expect(runAllMutate).toHaveBeenCalledWith("ag1");
  });

  it("per-row run invokes the single-case mutation", () => {
    renderWithIntl(<EvalsTab agent={AGENT} />);
    fireEvent.click(screen.getAllByLabelText("Run case")[0]!);
    expect(runOneMutate).toHaveBeenCalledWith(
      { caseId: "c1", owner: { kind: "agent", id: "ag1" } },
      expect.objectContaining({ onSettled: expect.any(Function) }),
    );
  });

  it("per-row delete confirms then invokes the delete mutation", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithIntl(<EvalsTab agent={AGENT} />);
    fireEvent.click(screen.getAllByLabelText("Delete")[0]!);
    expect(deleteMutate).toHaveBeenCalledWith({ id: "c1", owner: { kind: "agent", id: "ag1" } });
    confirmSpy.mockRestore();
  });

  it("opens the case editor modal on '+ New eval case'", () => {
    renderWithIntl(<EvalsTab agent={AGENT} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("New eval case"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
