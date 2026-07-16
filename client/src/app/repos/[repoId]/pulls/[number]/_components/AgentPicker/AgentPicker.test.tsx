import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import multiAgent from "../../../../../../../../messages/en/multiAgent.json";
import prReview from "../../../../../../../../messages/en/prReview.json";

const h = vi.hoisted(() => ({
  push: vi.fn(),
  runMutate: vi.fn(async () => ({ runs: [{ run_id: "run-1" }] })),
  launchMutate: vi.fn(async () => ({ run_id: "ma-1", pr_id: "pr-x" })),
  onRunsStarted: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({
    data: [
      { id: "a1", name: "Security Reviewer", enabled: true },
      { id: "a2", name: "Performance Reviewer", enabled: true },
      { id: "a3", name: "Disabled One", enabled: false },
    ],
  }),
}));
vi.mock("@/lib/hooks/multi-agent", () => ({
  useAgentEstimates: () => ({
    data: {
      estimates: [
        { agent_id: "a1", agent_name: "Security Reviewer", avg_latency_ms: 3000, avg_cost_usd: 0.05, runs: 4 },
        { agent_id: "a2", agent_name: "Performance Reviewer", avg_latency_ms: null, avg_cost_usd: null, runs: 0 },
      ],
    },
  }),
  useLaunchMultiAgentRun: () => ({ mutateAsync: h.launchMutate, isPending: false }),
}));
vi.mock("@/lib/hooks/reviews", () => ({
  useRunReview: () => ({ mutateAsync: h.runMutate, isPending: false }),
}));

import { AgentPicker } from "./AgentPicker";

afterEach(() => {
  cleanup();
  h.push.mockClear();
  h.runMutate.mockClear();
  h.launchMutate.mockClear();
  h.onRunsStarted.mockClear();
});

function open() {
  render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent, prReview }}>
      <AgentPicker prId="pr-x" onRunsStarted={h.onRunsStarted} />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Run Review" }));
}

describe("AgentPicker", () => {
  it("lists every enabled agent with a guideline + checkbox, plus Select all/Clear (AC-2)", () => {
    open();
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Performance Reviewer")).toBeInTheDocument();
    expect(screen.queryByText("Disabled One")).toBeNull(); // disabled agents excluded
    expect(screen.getByText("3.0s · $0.05")).toBeInTheDocument(); // a1 has history
    expect(screen.getByText("no history")).toBeInTheDocument(); // a2 has none (AC-12)
  });

  it("disables the run action and labels it 'Select an agent' when nothing is selected (AC-3)", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Clear" })); // start all-selected → clear
    const primary = screen.getByRole("button", { name: "Select an agent" });
    expect(primary).toBeDisabled();
  });

  it("N>1 selected → launches a multi-agent run and navigates to its results page (AC-5)", async () => {
    open(); // defaults to all enabled = 2 selected
    fireEvent.click(screen.getByRole("button", { name: "Run multi-agent review (2)" }));
    await waitFor(() =>
      expect(h.launchMutate).toHaveBeenCalledWith({ prId: "pr-x", agentIds: ["a1", "a2"] }),
    );
    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/multi-agent/runs/ma-1"));
    expect(h.runMutate).not.toHaveBeenCalled(); // no inline single-agent path
  });

  it("exactly 1 selected → runs inline via useRunReview, no navigation, no multi-run (AC-4)", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(screen.getByText("Security Reviewer")); // select just a1
    fireEvent.click(screen.getByRole("button", { name: "Run Security Reviewer" }));
    await waitFor(() => expect(h.runMutate).toHaveBeenCalledWith({ prId: "pr-x", agentId: "a1" }));
    await waitFor(() => expect(h.onRunsStarted).toHaveBeenCalledWith(["run-1"]));
    expect(h.launchMutate).not.toHaveBeenCalled();
    expect(h.push).not.toHaveBeenCalled(); // stays on the PR page (AC-4)
  });
});
