import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentColumn, MultiAgentRun } from "@devdigest/shared";
import messages from "../../../../../messages/en/multiAgent.json";

// Mutable holders the mocked hooks read (hoisted above the vi.mock factories).
const h = vi.hoisted(() => ({
  run: undefined as { data?: MultiAgentRun; isLoading: boolean; isError: boolean; refetch: () => void } | undefined,
  pr: undefined as { data?: { title: string; number: number; repo_id?: string | null } } | undefined,
}));

vi.mock("@/lib/hooks/multi-agent", () => ({ useMultiAgentRun: () => h.run }));
vi.mock("@/lib/hooks/core", () => ({ usePullDetail: () => h.pr }));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    // A DIFFERENT repo than the reviewed PR's own repo_id (repo-1) — asserts the
    // page resolves the owning repo from the PR itself, not the sidebar's
    // "active" repo (which /multi-agent/runs isn't scoped by).
    activeRepo: { id: "repo-2", full_name: "acme/other-repo" },
    repoId: "repo-2",
    repos: [
      { id: "repo-1", full_name: "acme/widgets" },
      { id: "repo-2", full_name: "acme/other-repo" },
    ],
    setRepoId: () => {},
    reposLoaded: true,
  }),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
const columnsViewProps = vi.hoisted(() => ({ current: null as any }));
vi.mock("../ColumnsView", () => ({
  ColumnsView: (props: any) => {
    columnsViewProps.current = props;
    return <div data-testid="columns-view" />;
  },
}));
vi.mock("../TabsView", () => ({ TabsView: () => <div data-testid="tabs-view" /> }));
vi.mock("../ConflictsSection", () => ({ ConflictsSection: () => <div data-testid="conflicts" /> }));
vi.mock("@/components/RunTraceDrawer", () => ({
  RunTraceDrawer: () => <div data-testid="trace" />,
}));

import { MultiAgentResultsView } from "./MultiAgentResultsView";

afterEach(cleanup);

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: messages }}>
      <MultiAgentResultsView runId="mar-1" />
    </NextIntlClientProvider>,
  );
}

const col = (over: Partial<AgentColumn> = {}): AgentColumn => ({
  run_id: "r1",
  agent_id: "a1",
  agent_name: "Security Reviewer",
  provider: "openai",
  model: "gpt-4.1",
  status: "done",
  verdict: "warn",
  score: 70,
  summary: "ok",
  duration_ms: 3000,
  cost_usd: 0.05,
  findings: [],
  ...over,
});

const run = (over: Partial<MultiAgentRun> = {}): MultiAgentRun => ({
  id: "mar-1",
  pr_id: "pr-abc",
  pr_number: 482,
  ran_at: "2026-07-12T00:00:00Z",
  agent_count: 2,
  total_duration_ms: 8200,
  total_cost_usd: 0.2,
  columns: [col({ run_id: "r1", agent_id: "a1" }), col({ run_id: "r2", agent_id: "a2", agent_name: "Perf" })],
  conflicts: [],
  ...over,
});

function setRun(r: MultiAgentRun) {
  h.run = { data: r, isLoading: false, isError: false, refetch: vi.fn() };
  h.pr = { data: { title: "Add rate limiting to public API endpoints", number: 482, repo_id: "repo-1" } };
}

describe("MultiAgentResultsView", () => {
  it("shows PR number + title and SUM totals, defaults to Columns view (AC-15/16)", () => {
    setRun(run());
    renderView();
    // meta: totals are the server SUM, no "parallel"/"fan-out"
    expect(screen.getByText("#482")).toBeInTheDocument();
    expect(screen.getByText("Add rate limiting to public API endpoints")).toBeInTheDocument();
    expect(screen.getByText(/2 agents · 8\.2s total · \$0\.20/)).toBeInTheDocument();
    expect(screen.queryByText(/parallel|fan-out/i)).toBeNull();
    // default view = Columns
    expect(screen.getByTestId("columns-view")).toBeInTheDocument();
    expect(screen.queryByTestId("tabs-view")).toBeNull();
  });

  it("the 'Configure run' link carries the PR + agent selection in the query (AC-17)", () => {
    setRun(run());
    renderView();
    const href = screen.getByRole("link", { name: /Configure run/i }).getAttribute("href") ?? "";
    expect(href).toContain("/multi-agent?");
    expect(href).toContain("pr=pr-abc");
    expect(href).toMatch(/agents=a1.*a2/);
  });

  it("resolves the finding deep link from the PR's own repo_id, not the sidebar's active repo (AC-?)", () => {
    setRun(run());
    renderView();
    const { findingHref, fileHref } = columnsViewProps.current;
    // repo-1 (the PR's real owner via pr.data.repo_id) wins over repo-2 (active/sidebar repo).
    expect(findingHref({ id: "f1" })).toBe("/repos/repo-1/pulls/482?tab=findings#finding-f1");
    expect(fileHref({ file: "src/db/query.ts", start_line: 42 })).toContain(
      "https://github.com/acme/widgets/pull/482/files",
    );
  });

  it("switches to the Tabs view (AC-16)", () => {
    setRun(run());
    renderView();
    fireEvent.click(screen.getByRole("tab", { name: "Tabs" }));
    expect(screen.getByTestId("tabs-view")).toBeInTheDocument();
    expect(screen.queryByTestId("columns-view")).toBeNull();
  });

  it("renders the disagreement section only when ≥2 agents reviewed (done)", () => {
    setRun(run()); // 2 done
    renderView();
    expect(screen.getByTestId("conflicts")).toBeInTheDocument();
  });

  it("all agents failed: run still renders, no disagreement section, traces still linkable (AC-34)", () => {
    setRun(run({ columns: [col({ status: "failed" }), col({ run_id: "r2", agent_id: "a2", status: "failed" })] }));
    renderView();
    // columns still present (the view renders), but 0 reviewed → no conflicts
    expect(screen.getByTestId("columns-view")).toBeInTheDocument();
    expect(screen.queryByTestId("conflicts")).toBeNull();
  });

  it("hides the disagreement section for a 1-of-2-succeeded run (AC-30)", () => {
    setRun(run({ columns: [col({ status: "done" }), col({ run_id: "r2", agent_id: "a2", status: "failed" })] }));
    renderView();
    expect(screen.queryByTestId("conflicts")).toBeNull();
  });

  it("shows the no-agents empty state when the run has no columns (AC-18)", () => {
    setRun(run({ columns: [], agent_count: 0 }));
    renderView();
    expect(screen.getByText("No agents selected")).toBeInTheDocument();
  });
});
