/* RunConfig.test.tsx — Configure-run component tests (SPEC-05, T14).
   Covers AC-6 (two steps), AC-7 (stale PRs absent + the PR picker is
   searchable/filterable), AC-8 (gate + disabled run + title), AC-9 (card
   fields + select-all/clear-all), AC-12 (no-history shown + excluded from the
   summed estimate), AC-13 (total = sum), and the run-bar label transitions
   (0 → "Select agents"/disabled; 1 → "Run 1 agent";
   N → "Run multi-agent review (N)"). Real i18n messages + real agent-visuals;
   the data hooks are mocked. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/multiAgent.json";

const h = vi.hoisted(() => ({
  agents: [
    { id: "ag-sec", name: "Security Reviewer", description: "Flags vulnerabilities.", enabled: true },
    { id: "ag-perf", name: "Performance Auditor", description: "Finds slow paths.", enabled: true },
    { id: "ag-new", name: "Fresh Agent", description: "Brand new.", enabled: true },
    { id: "ag-off", name: "Disabled One", description: "Off.", enabled: false },
  ],
  estimates: [
    { agent_id: "ag-sec", agent_name: "Security Reviewer", avg_latency_ms: 4000, avg_cost_usd: 0.02, runs: 3 },
    { agent_id: "ag-perf", agent_name: "Performance Auditor", avg_latency_ms: 6000, avg_cost_usd: 0.03, runs: 2 },
    { agent_id: "ag-new", agent_name: "Fresh Agent", avg_latency_ms: null, avg_cost_usd: null, runs: 0 },
  ],
  prs: [
    { id: "pr-482", number: 482, title: "Add rate limiting to public API endpoints", status: "needs_review" },
    { id: "pr-500", number: 500, title: "Refactor auth", status: "reviewed" },
    { id: "pr-99", number: 99, title: "Old stale PR", status: "stale" },
  ],
}));

vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => ({ data: h.agents }) }));
vi.mock("@/lib/hooks/multi-agent", () => ({
  useAgentEstimates: () => ({ data: { estimates: h.estimates } }),
}));
vi.mock("./usePrOptions", () => ({ usePrOptions: () => ({ prs: h.prs, isLoading: false }) }));

import { RunConfig } from "./RunConfig";

afterEach(cleanup);

function renderRunConfig(props: Partial<React.ComponentProps<typeof RunConfig>> = {}) {
  const onRun = props.onRun ?? vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: messages }}>
      <RunConfig onRun={onRun} {...props} />
    </NextIntlClientProvider>
  );
  return { onRun };
}

/** Predicate matcher — tolerant of the middot glyph / whitespace normalisation. */
const has = (...parts: string[]) => (content: string) => parts.every((p) => content.includes(p));

describe("RunConfig", () => {
  it("AC-6: presents a two-step flow (pull request, then agents)", () => {
    renderRunConfig();
    expect(screen.getByText("Pull request")).toBeInTheDocument();
    expect(screen.getByText("Agents to run")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("AC-7: the PR picker lists only non-stale PRs", () => {
    renderRunConfig();
    // Open the step-1 picker.
    fireEvent.click(screen.getByText("Select a pull request…"));
    expect(screen.getByText(has("#482", "Add rate limiting"))).toBeInTheDocument();
    expect(screen.getByText(has("#500", "Refactor auth"))).toBeInTheDocument();
    // The stale PR (#99) must not be offered.
    expect(screen.queryByText(has("Old stale PR"))).toBeNull();
    expect(screen.queryByText(has("#99"))).toBeNull();
  });

  it("the PR picker is searchable — filters by number and by title", () => {
    renderRunConfig();
    fireEvent.click(screen.getByText("Select a pull request…"));
    const search = screen.getByPlaceholderText("Select a pull request…");

    // Filter by title text.
    fireEvent.change(search, { target: { value: "auth" } });
    expect(screen.getByText(has("#500", "Refactor auth"))).toBeInTheDocument();
    expect(screen.queryByText(has("#482", "Add rate limiting"))).toBeNull();

    // Filter by PR number.
    fireEvent.change(search, { target: { value: "482" } });
    expect(screen.getByText(has("#482", "Add rate limiting"))).toBeInTheDocument();
    expect(screen.queryByText(has("#500", "Refactor auth"))).toBeNull();

    // No matches → an explicit empty state, not a blank list.
    fireEvent.change(search, { target: { value: "no-such-pr" } });
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("picking a filtered PR selects it and closes the picker", () => {
    renderRunConfig();
    fireEvent.click(screen.getByText("Select a pull request…"));
    fireEvent.change(screen.getByPlaceholderText("Select a pull request…"), {
      target: { value: "482" },
    });
    fireEvent.click(screen.getByText(has("#482", "Add rate limiting")));

    // The trigger now reflects the selection, and step 2 unlocks.
    expect(screen.getByText(has("#482", "Add rate limiting"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Security Reviewer/ })).toBeInTheDocument();
  });

  it("AC-8: with no PR chosen, gates step 2 behind the empty state and disables run", () => {
    renderRunConfig();
    expect(screen.getByText("Pick a pull request first")).toBeInTheDocument();
    expect(
      screen.getByText("Choose which PR to review above, then select the agents to run on it.")
    ).toBeInTheDocument();
    const runBtn = screen.getByRole("button", { name: "Select agents" });
    expect(runBtn).toBeDisabled();
    // No agent cards while gated.
    expect(screen.queryByRole("button", { name: /Security Reviewer/ })).toBeNull();
  });

  it("AC-9: with a PR chosen, lists an enabled-agent card (name, summary, guideline) + select/clear all", () => {
    renderRunConfig({ preselectedPr: "pr-482" });

    // One card per ENABLED agent; the disabled agent is absent.
    expect(screen.getByRole("button", { name: /Security Reviewer/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Performance Auditor/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Disabled One/ })).toBeNull();

    // Card fields: name + short summary + time/cost guideline.
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Flags vulnerabilities.")).toBeInTheDocument();
    expect(screen.getByText("4.0s · $0.02")).toBeInTheDocument();

    // Select all → Clear all.
    const selectAll = screen.getByRole("button", { name: "Select all" });
    fireEvent.click(selectAll);
    expect(screen.getByRole("button", { name: "Clear all" })).toBeInTheDocument();
    // Now all enabled cards are selected (aria-pressed).
    expect(screen.getByRole("button", { name: /Security Reviewer/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("AC-11/12: a no-history agent shows 'no history' and is excluded from the summed estimate", () => {
    renderRunConfig({ preselectedPr: "pr-482" });

    // The estimate-less agent renders "no history"…
    expect(screen.getByText("no history")).toBeInTheDocument();

    // …and selecting it alongside a with-history agent leaves the summed time/
    // cost equal to just the with-history agent's (4.0s · $0.02), while the
    // agent count still reflects the 2 selected agents.
    fireEvent.click(screen.getByRole("button", { name: /Security Reviewer/ }));
    fireEvent.click(screen.getByRole("button", { name: /Fresh Agent/ }));
    expect(screen.getByText(has("≈", "4.0s", "$0.02", "2 agents"))).toBeInTheDocument();
  });

  it("AC-13: the total estimate is the SUM of the selected agents' time and cost", () => {
    renderRunConfig({ preselectedPr: "pr-482" });
    fireEvent.click(screen.getByRole("button", { name: /Security Reviewer/ })); // 4.0s · $0.02
    fireEvent.click(screen.getByRole("button", { name: /Performance Auditor/ })); // 6.0s · $0.03
    // Sum: 10.0s · $0.05 (never Math.max / never "parallel").
    expect(screen.getByText(has("≈", "10.0s", "$0.05", "2 agents"))).toBeInTheDocument();
  });

  it("run-bar label transitions 0 → 1 → N (Configure-page logic)", () => {
    renderRunConfig({ preselectedPr: "pr-482" });

    // 0 selected → "Select agents", disabled.
    const zero = screen.getByRole("button", { name: "Select agents" });
    expect(zero).toBeDisabled();

    // 1 selected → "Run 1 agent", enabled.
    fireEvent.click(screen.getByRole("button", { name: /Security Reviewer/ }));
    const one = screen.getByRole("button", { name: "Run 1 agent" });
    expect(one).toBeEnabled();

    // N>1 selected → "Run multi-agent review (N)".
    fireEvent.click(screen.getByRole("button", { name: /Performance Auditor/ }));
    expect(screen.getByRole("button", { name: "Run multi-agent review (2)" })).toBeInTheDocument();
  });

  it("AC-17 + raise: preselection seeds state and onRun(prId, agentIds) fires on activate", () => {
    const onRun = vi.fn();
    renderRunConfig({ preselectedPr: "pr-482", preselectedAgents: ["ag-sec"], onRun });

    // Preselected agent is reflected as pressed.
    expect(screen.getByRole("button", { name: /Security Reviewer/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    fireEvent.click(screen.getByRole("button", { name: "Run 1 agent" }));
    expect(onRun).toHaveBeenCalledWith("pr-482", ["ag-sec"]);
  });
});
