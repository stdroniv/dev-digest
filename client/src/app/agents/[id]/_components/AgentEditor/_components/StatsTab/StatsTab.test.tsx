import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, RunSummary } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/agents.json";

let runsState: { data: RunSummary[] | undefined; isLoading: boolean };

vi.mock("@/lib/hooks/ci", () => ({
  useAgentRuns: () => runsState,
}));

import { StatsTab } from "./StatsTab";

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

const RUNS: RunSummary[] = [
  {
    run_id: "run1",
    agent_id: "ag1",
    agent_name: "Security Reviewer",
    provider: "openai",
    model: "gpt-4.1",
    status: "done",
    error: null,
    duration_ms: 4200,
    tokens_in: 9000,
    tokens_out: 700,
    findings_count: 3,
    grounding: null,
    ran_at: "2026-07-01T09:14:00.000Z",
    score: 82,
    blockers: 0,
    cost_usd: 0.06,
    findings_counts: { critical: 0, warning: 2, suggestion: 1 },
    source: "local",
  },
  {
    run_id: "run2",
    agent_id: "ag1",
    agent_name: "Security Reviewer",
    provider: "openai",
    model: "gpt-4.1",
    status: "done",
    error: null,
    duration_ms: 5100,
    tokens_in: 8000,
    tokens_out: 600,
    findings_count: 5,
    grounding: null,
    ran_at: "2026-05-31T18:30:00.000Z",
    score: 70,
    blockers: 1,
    cost_usd: 0.09,
    findings_counts: { critical: 1, warning: 3, suggestion: 1 },
    source: "ci",
  },
];

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <StatsTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("StatsTab — empty state", () => {
  it("shows 'No runs yet' when the agent has no runs", () => {
    runsState = { data: [], isLoading: false };
    renderTab();
    expect(screen.getByText("No runs yet")).toBeInTheDocument();
  });
});

describe("StatsTab — run history (AC-42)", () => {
  it("renders a run row per run, incl. tokens/cost/findings and a CI Source badge for the CI-sourced run", () => {
    runsState = { data: RUNS, isLoading: false };
    renderTab();

    expect(screen.getByText("Timestamp")).toBeInTheDocument();
    expect(screen.getByText("Tokens")).toBeInTheDocument();
    expect(screen.getByText("Cost")).toBeInTheDocument();
    expect(screen.getByText("Findings")).toBeInTheDocument();
    expect(screen.getByText("Source")).toBeInTheDocument();

    // local run (formatUsd uses 3 decimals in the sub-$1 range: "$0.060")
    expect(screen.getByText("9,700")).toBeInTheDocument();
    expect(screen.getByText("$0.060")).toBeInTheDocument();
    expect(screen.getByText("local")).toBeInTheDocument();

    // CI-sourced run — the Source column badges it "CI"
    expect(screen.getByText("8,600")).toBeInTheDocument();
    expect(screen.getByText("$0.090")).toBeInTheDocument();
    expect(screen.getByText("CI")).toBeInTheDocument();

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });
});
