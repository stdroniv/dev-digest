/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunSummary, FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { RunHistory } from "./RunHistory";

afterEach(cleanup);

function finding(o: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    severity: "WARNING",
    category: "perf",
    title: o.id,
    file: "src/api/users.ts",
    start_line: 45,
    end_line: 52,
    rationale: "r",
    suggestion: null,
    confidence: 0.86,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "rev",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

function run(o: Partial<RunSummary>): RunSummary {
  return {
    run_id: "run-1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 50,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    cost_usd: null,
    findings_counts: null,
    ...o,
  };
}

function renderRuns(runs: RunSummary[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunHistory runs={runs} onOpenTrace={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("RunHistory — outcome badge", () => {
  it("a done run WITH blockers reads 'rejected' (never green 'done') + shows the score ring", () => {
    renderRuns([run({ status: "done", findings_count: 5, blockers: 5, score: 0 })]);
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument(); // CircularScore renders the number
    expect(screen.getByText(/5 blockers/)).toBeInTheDocument();
  });

  it("a clean done run reads 'approved'", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95 })]);
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("a done run with non-blocking findings reads 'reviewed'", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 0, score: 72 })]);
    expect(screen.getByText("reviewed")).toBeInTheDocument();
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
  });

  it("a failed run reads 'error'", () => {
    renderRuns([run({ status: "failed", error: "boom", score: null, blockers: null })]);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("a running run reads 'running'", () => {
    renderRuns([run({ status: "running", score: null, blockers: null })]);
    expect(screen.getByText("running")).toBeInTheDocument();
  });

  it("a settled run shows its token + cost line", () => {
    renderRuns([
      run({ status: "done", tokens_in: 9119, tokens_out: 612, score: 61, blockers: 1, cost_usd: 0.0123 }),
    ]);
    expect(screen.getByText(/9,731 tok · \$0\.012/)).toBeInTheDocument();
  });

  it("omits the cost line when cost is null", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95, cost_usd: null })]);
    expect(screen.queryByText(/tok ·/)).not.toBeInTheDocument();
  });
});

describe("RunHistory — findings counters", () => {
  it("shows the run's per-severity counters (+ blockers suffix)", () => {
    renderRuns([
      run({
        status: "done",
        findings_count: 3,
        blockers: 2,
        score: 40,
        findings_counts: { critical: 2, warning: 1, suggestion: 0 },
      }),
    ]);
    expect(screen.getByLabelText("2 critical, 1 warning, 0 suggestion")).toBeInTheDocument();
    expect(screen.getByText(/2 blockers/)).toBeInTheDocument();
  });

  it("falls back to an em dash when the run has no findings_counts", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95, findings_counts: null })]);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("RunHistory — findings hover popover", () => {
  it("reveals the run's findings (with 'in this run' header) on hover over the counters", () => {
    const r = run({
      run_id: "run-x",
      status: "done",
      findings_count: 2,
      blockers: 1,
      score: 40,
      findings_counts: { critical: 0, warning: 1, suggestion: 1 },
    });
    const findingsByRun = new Map<string, FindingRecord[]>([
      ["run-x", [finding({ id: "N+1 query in user list endpoint", severity: "WARNING" })]],
    ]);
    render(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <RunHistory runs={[r]} findingsByRun={findingsByRun} onOpenTrace={() => {}} />
      </NextIntlClientProvider>,
    );
    // Closed initially.
    expect(screen.queryByText("2 findings in this run")).not.toBeInTheDocument();
    // The counters group is wrapped by the hover card div that carries the handler.
    const counters = screen.getByLabelText("0 critical, 1 warning, 1 suggestion");
    fireEvent.mouseEnter(counters.parentElement!);
    expect(screen.getByText("2 findings in this run")).toBeInTheDocument();
    expect(screen.getByText("N+1 query in user list endpoint")).toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts:45-52")).toBeInTheDocument();
  });

  it("dismisses the popover on page scroll (so the fixed card never detaches)", () => {
    const r = run({
      run_id: "run-x",
      status: "done",
      findings_count: 2,
      blockers: 1,
      score: 40,
      findings_counts: { critical: 0, warning: 1, suggestion: 1 },
    });
    const findingsByRun = new Map<string, FindingRecord[]>([
      ["run-x", [finding({ id: "N+1 query in user list endpoint" })]],
    ]);
    render(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <RunHistory runs={[r]} findingsByRun={findingsByRun} onOpenTrace={() => {}} />
      </NextIntlClientProvider>,
    );
    fireEvent.mouseEnter(screen.getByLabelText("0 critical, 1 warning, 1 suggestion").parentElement!);
    expect(screen.getByText("2 findings in this run")).toBeInTheDocument();
    fireEvent.scroll(window);
    expect(screen.queryByText("2 findings in this run")).not.toBeInTheDocument();
  });
});
