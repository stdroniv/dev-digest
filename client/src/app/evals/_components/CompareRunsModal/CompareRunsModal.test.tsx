import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalComparison } from "@devdigest/shared";
import evalsMessages from "../../../../../messages/en/evals.json";

const COMPARISON: EvalComparison = {
  old_run: { id: "r1", run_group_id: "rg1", agent_id: "ag1", agent_version: 2, ran_at: "2026-06-01T00:00:00Z", recall: 0.7, precision: 0.65, citation_accuracy: 0.9, traces_passed: 3, traces_total: 5, cost_usd: 0.008 },
  new_run: { id: "r2", run_group_id: "rg2", agent_id: "ag1", agent_version: 3, ran_at: "2026-07-01T00:00:00Z", recall: 0.8, precision: 0.6, citation_accuracy: 0.9, traces_passed: 4, traces_total: 5, cost_usd: 0.012 },
  recall: { old: 0.7, new: 0.8, delta: 0.1 },
  precision: { old: 0.65, new: 0.6, delta: -0.05 },
  citation_accuracy: { old: 0.9, new: 0.9, delta: 0 },
  cost_usd: { old: 0.008, new: 0.012, delta: 0.004 },
  system_prompt_diff: "-old instruction line\n+new instruction line\n context line",
  newer_version: 3,
};

const SAME_VERSION_COMPARISON: EvalComparison = {
  ...COMPARISON,
  old_run: { ...COMPARISON.old_run, agent_version: 3 },
  new_run: { ...COMPARISON.new_run, agent_version: 3 },
  system_prompt_diff: "",
  newer_version: null,
};

let compareData: EvalComparison | undefined = COMPARISON;
let compareIsPending = false;
let promoteIsPending = false;
const compareMutateSpy = vi.fn();
const promoteMutateSpy = vi.fn();

vi.mock("@/lib/hooks/evals", () => ({
  useCompareRuns: () => ({ mutate: compareMutateSpy, data: compareData, isPending: compareIsPending, isError: false }),
  usePromoteVersion: () => ({ mutate: promoteMutateSpy, isPending: promoteIsPending }),
}));

import { CompareRunsModal } from "./CompareRunsModal";

afterEach(() => {
  cleanup();
  compareMutateSpy.mockReset();
  promoteMutateSpy.mockReset();
  compareData = COMPARISON;
  compareIsPending = false;
  promoteIsPending = false;
});

function renderWithIntl(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={{ evals: evalsMessages }}>{ui}</NextIntlClientProvider>);
}

describe("CompareRunsModal (T18, AC-16/AC-27)", () => {
  it("triggers the compare mutation with the two run_group ids on mount", () => {
    renderWithIntl(
      <CompareRunsModal agentId="ag1" oldRunGroupId="rg1" newRunGroupId="rg2" onClose={vi.fn()} />,
    );
    expect(compareMutateSpy).toHaveBeenCalledWith({ old_run_group_id: "rg1", new_run_group_id: "rg2" });
  });

  it("shows a loading skeleton while the comparison is pending", () => {
    compareData = undefined;
    compareIsPending = true;
    renderWithIntl(
      <CompareRunsModal agentId="ag1" oldRunGroupId="rg1" newRunGroupId="rg2" onClose={vi.fn()} />,
    );
    expect(screen.queryByText("System prompt diff")).not.toBeInTheDocument();
  });

  it("renders per-metric old→new + delta cards including cost, and the colorized prompt diff", () => {
    renderWithIntl(
      <CompareRunsModal agentId="ag1" oldRunGroupId="rg1" newRunGroupId="rg2" onClose={vi.fn()} />,
    );
    expect(screen.getByText("RECALL")).toBeInTheDocument();
    expect(screen.getByText("PRECISION")).toBeInTheDocument();
    expect(screen.getByText("CITATION ACCURACY")).toBeInTheDocument();
    expect(screen.getByText("Cost")).toBeInTheDocument();
    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("System prompt diff")).toBeInTheDocument();
    expect(screen.getByText("-old instruction line")).toBeInTheDocument();
    expect(screen.getByText("+new instruction line")).toBeInTheDocument();
  });

  it("same-version compare yields an empty diff message and a disabled Promote", () => {
    compareData = SAME_VERSION_COMPARISON;
    renderWithIntl(
      <CompareRunsModal agentId="ag1" oldRunGroupId="rg1" newRunGroupId="rg2" onClose={vi.fn()} />,
    );
    expect(screen.getByText("No prompt differences — same version.")).toBeInTheDocument();
    const promoteBtn = screen.getByText(/Promote v/).closest("button")!;
    expect(promoteBtn).toBeDisabled();
  });

  it("Promote requires confirmation, then fires the mutation and surfaces the promoted version (AC-27)", () => {
    promoteMutateSpy.mockImplementation((_input, opts) => {
      opts?.onSuccess?.();
    });
    renderWithIntl(
      <CompareRunsModal agentId="ag1" oldRunGroupId="rg1" newRunGroupId="rg2" onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("Promote v3"));
    expect(promoteMutateSpy).not.toHaveBeenCalled();
    expect(screen.getByText("Promote v3 to active?")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Confirm"));
    expect(promoteMutateSpy).toHaveBeenCalledWith({ agentId: "ag1", version: 3 }, expect.any(Object));
    expect(screen.getByText("Promoted to v3")).toBeInTheDocument();
  });

  it("Close calls onClose", () => {
    const onClose = vi.fn();
    renderWithIntl(<CompareRunsModal agentId="ag1" oldRunGroupId="rg1" newRunGroupId="rg2" onClose={onClose} />);
    fireEvent.click(screen.getByText("Close"));
    expect(onClose).toHaveBeenCalled();
  });
});
