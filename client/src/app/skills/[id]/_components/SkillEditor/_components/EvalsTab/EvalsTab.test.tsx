import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCase, EvalDashboard, Skill } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/evals.json";

// Mirrors the agent EvalsTab.test.tsx fixtures (T15/T17) — same case shapes,
// skill-owned instead of agent-owned.
const CASES: EvalCase[] = [
  {
    id: "c1",
    owner_kind: "skill",
    owner_id: "sk1",
    name: "stripe-key-must-find",
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
    owner_kind: "skill",
    owner_id: "sk1",
    name: "placeholder-key-must-not-flag",
    input_diff: "--- a/src/config.ts\n+++ b/src/config.ts",
    input_files: null,
    input_meta: null,
    expected_output: [],
    notes: null,
  },
];

const DASHBOARD: EvalDashboard = {
  owner_kind: "skill",
  owner_id: "sk1",
  cases_total: 2,
  current: { recall: 0.8, precision: 0.6, citation_accuracy: 0.9, traces_passed: 1, traces_total: 2, cost_usd: 0.01 },
  delta: { recall: 0.1, precision: -0.05, citation_accuracy: 0 },
  trend: [],
  recent_runs: [
    {
      id: "r1",
      case_id: "c1",
      case_name: "stripe-key-must-find",
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
      case_name: "placeholder-key-must-not-flag",
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

// Mutable so the "empty set" describe block below can swap in a zero-case
// fixture without a second `vi.mock` factory (hoisting rules mean only ONE
// `vi.mock("@/lib/hooks/evals", ...)` factory can exist per file).
let casesFixture: EvalCase[] = CASES;
let dashboardFixture: EvalDashboard = DASHBOARD;

vi.mock("@/lib/hooks/evals", () => ({
  useSkillEvalCases: () => ({ data: casesFixture, isLoading: false }),
  useSkillEvalDashboard: () => ({ data: dashboardFixture }),
  useRunAllSkillEvals: () => ({ mutate: runAllMutate, isPending: false }),
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
  casesFixture = CASES;
  dashboardFixture = DASHBOARD;
});

const SKILL: Skill = {
  id: "sk1",
  name: "secret-leakage-gate",
  description: "Detects hardcoded secrets in a diff.",
  type: "security",
  source: "manual",
  body: "# Secret Leakage Gate",
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

describe("Skill EvalsTab (T15/T17, R-G1-1..5)", () => {
  it("renders the case list with expectation summaries and the N/M passing count", () => {
    renderWithIntl(<EvalsTab skill={SKILL} />);
    expect(screen.getByText("stripe-key-must-find")).toBeInTheDocument();
    expect(screen.getByText("placeholder-key-must-not-flag")).toBeInTheDocument();
    expect(screen.getByText("expected 1 finding")).toBeInTheDocument();
    expect(screen.getByText("1 / 2 passed")).toBeInTheDocument();
  });

  it('shows "empty []" for a must_not_flag case', () => {
    renderWithIntl(<EvalsTab skill={SKILL} />);
    expect(screen.getByText("empty []")).toBeInTheDocument();
  });

  it("shows the last-run status per row (passed / failed)", () => {
    renderWithIntl(<EvalsTab skill={SKILL} />);
    expect(screen.getByText("passed")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("renders the eval metric cards with current values + delta vs the previous run (R-G1-5)", () => {
    renderWithIntl(<EvalsTab skill={SKILL} />);
    expect(screen.getByText("RECALL")).toBeInTheDocument();
    expect(screen.getByText("PRECISION")).toBeInTheDocument();
    expect(screen.getByText("CITATION ACCURACY")).toBeInTheDocument();
    expect(screen.getByText("TRACES PASSED")).toBeInTheDocument();
    expect(
      screen.getByText((_, el) => el?.tagName === "SPAN" && el.className === "tnum" && el.textContent === "80%"),
    ).toBeInTheDocument(); // recall current
    expect(screen.getByText("1/2")).toBeInTheDocument(); // traces passed/total
  });

  it('"Run all evals" invokes the skill run-all mutation, disabled when there are no cases', () => {
    renderWithIntl(<EvalsTab skill={SKILL} />);
    const button = screen.getByText("Run all evals").closest("button")!;
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(runAllMutate).toHaveBeenCalledWith("sk1");
  });

  it("per-row run invokes the single-case mutation with a SKILL owner", () => {
    renderWithIntl(<EvalsTab skill={SKILL} />);
    fireEvent.click(screen.getAllByLabelText("Run case")[0]!);
    expect(runOneMutate).toHaveBeenCalledWith(
      { caseId: "c1", owner: { kind: "skill", id: "sk1" } },
      expect.objectContaining({ onSettled: expect.any(Function) }),
    );
  });

  it("per-row delete confirms then invokes the delete mutation with a SKILL owner", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithIntl(<EvalsTab skill={SKILL} />);
    fireEvent.click(screen.getAllByLabelText("Delete")[0]!);
    expect(deleteMutate).toHaveBeenCalledWith({ id: "c1", owner: { kind: "skill", id: "sk1" } });
    confirmSpy.mockRestore();
  });

  it("opens the case editor modal on '+ New eval case'", () => {
    renderWithIntl(<EvalsTab skill={SKILL} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("New eval case"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it('does NOT render "View full dashboard →" (A3 — the cross-owner dashboard stays agent-only)', () => {
    renderWithIntl(<EvalsTab skill={SKILL} />);
    expect(screen.queryByText("View full dashboard →")).not.toBeInTheDocument();
  });
});

describe("Skill EvalsTab — disabled skill (security fix, mirrors run-executor.ts enabled filter)", () => {
  it('"Run all evals" and every per-case "Run" control are disabled with an explanatory tooltip when the skill is disabled', () => {
    const disabledSkill: Skill = { ...SKILL, enabled: false };
    renderWithIntl(<EvalsTab skill={disabledSkill} />);

    const runAllButton = screen.getByText("Run all evals").closest("button")!;
    expect(runAllButton).toBeDisabled();
    expect(runAllButton).toHaveAttribute("title", "This skill is disabled — enable it first to run evals.");
    fireEvent.click(runAllButton);
    expect(runAllMutate).not.toHaveBeenCalled();

    const runButtons = screen.getAllByLabelText("This skill is disabled — enable it first to run evals.");
    expect(runButtons).toHaveLength(CASES.length);
    fireEvent.click(runButtons[0]!);
    expect(runOneMutate).not.toHaveBeenCalled();
  });
});

describe("Skill EvalsTab — empty set (R-G1-7)", () => {
  it('"Run all evals" is disabled and the empty state renders when the skill has zero cases', () => {
    casesFixture = [];
    dashboardFixture = {
      ...DASHBOARD,
      cases_total: 0,
      current: { ...DASHBOARD.current, traces_total: 0, traces_passed: 0 },
    };
    renderWithIntl(<EvalsTab skill={SKILL} />);
    expect(screen.getByText("Run all evals").closest("button")).toBeDisabled();
    // The empty-cases affordance replaces the row list, with SKILL-specific
    // copy (not the agent tab's "this agent's expected findings" wording).
    expect(
      screen.getByText("No eval cases yet. Create one to assert this skill's expected findings on a sample diff."),
    ).toBeInTheDocument();
  });
});
