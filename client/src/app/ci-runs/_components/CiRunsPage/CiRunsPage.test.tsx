/**
 * CiRunsPage — RTL + Vitest tests (SPEC-05 T11).
 *
 * Acceptance criteria covered:
 * (AC-36) each FilterBar control (date range, agent, repo, status, source)
 *   narrows the rendered list.
 * (AC-37) an empty `useCiRuns` result shows the "No CI runs yet" empty state
 *   + "Set up CI for an agent" CTA.
 * (AC-34) the Refresh button drives the reconcile mutation, which also fires
 *   once on mount.
 * Bonus: the error state (ApiError message + Retry → refetch).
 *
 * `useAgents`/`useRepos`/`useCiRuns`/`useReconcileCiRuns` are the only
 * `@/lib/hooks` entry points `CiRunsPage` calls — mocking the whole module
 * means no QueryClientProvider is needed (nothing here hits real React
 * Query internals).
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, CiRun, Repo } from "@devdigest/shared";
import type { CiRunsFilters } from "@/lib/hooks";
import messages from "../../../../../messages/en/ci.json";

const { useAgentsMock, useReposMock, useCiRunsMock, reconcileMutate, pushMock } = vi.hoisted(() => ({
  useAgentsMock: vi.fn(),
  useReposMock: vi.fn(),
  useCiRunsMock: vi.fn(),
  reconcileMutate: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("@/lib/hooks", () => ({
  useAgents: useAgentsMock,
  useRepos: useReposMock,
  useCiRuns: useCiRunsMock,
  useReconcileCiRuns: () => ({ mutate: reconcileMutate, isPending: false }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

import { CiRunsPage } from "./CiRunsPage";

afterEach(() => {
  cleanup();
  useAgentsMock.mockReset();
  useReposMock.mockReset();
  useCiRunsMock.mockReset();
  reconcileMutate.mockReset();
  pushMock.mockReset();
});

function agent(o: Partial<Agent>): Agent {
  return {
    id: "ag-1",
    name: "Security Reviewer",
    description: "",
    provider: "openrouter",
    model: "some/model",
    system_prompt: "",
    output_schema: null,
    enabled: true,
    version: 1,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    ...o,
  };
}

function repo(o: Partial<Repo>): Repo {
  return {
    id: "repo-1",
    workspace_id: "ws-1",
    owner: "acme",
    name: "payments-api",
    full_name: "acme/payments-api",
    default_branch: "main",
    clone_path: null,
    last_polled_at: null,
    created_by: null,
    ...o,
  };
}

function ciRun(o: Partial<CiRun>): CiRun {
  return {
    id: "run-1",
    ci_installation_id: "inst-1",
    pr_number: 101,
    pr_title: "Add rate limiting",
    ran_at: "2026-07-10T14:00:00.000Z",
    status: "succeeded",
    findings_count: 1,
    findings_counts: { critical: 1, warning: 0, suggestion: 0 },
    cost_usd: 0.02,
    github_url: "https://github.com/acme/payments-api/actions/runs/1",
    actions_run_id: "1",
    source: "ci",
    agent: "Security Reviewer",
    duration_s: 12,
    ...o,
  };
}

const AGENTS: Agent[] = [
  agent({ id: "ag-security", name: "Security Reviewer" }),
  agent({ id: "ag-style", name: "Style Bot" }),
];

const REPOS: Repo[] = [
  repo({ id: "repo-1", full_name: "acme/payments-api" }),
  repo({ id: "repo-2", full_name: "acme/web-app" }),
];

const RUN_RATE_LIMIT = ciRun({
  id: "run-1",
  pr_number: 101,
  pr_title: "Add rate limiting",
  agent: "Security Reviewer",
  status: "succeeded",
  source: "ci",
});
const RUN_CSS_REFACTOR = ciRun({
  id: "run-2",
  pr_number: 202,
  pr_title: "Refactor CSS modules",
  agent: "Style Bot",
  status: "failed",
  source: "local",
});
const RUN_BUMP_DEPS = ciRun({
  id: "run-3",
  pr_number: 303,
  pr_title: "Bump dependencies",
  agent: "Security Reviewer",
  status: "running",
  source: "ci",
});
const RUN_OLD = ciRun({
  id: "run-old",
  pr_number: 404,
  pr_title: "Old PR from last month",
  agent: "Security Reviewer",
  status: "succeeded",
  source: "ci",
});

const RUNS = [RUN_RATE_LIMIT, RUN_CSS_REFACTOR, RUN_BUMP_DEPS, RUN_OLD];

// Simulates the server-side narrowing `useCiRuns(filters)` would perform —
// keeps the test independent of the real Date.now()-derived `since` value by
// only checking whether a lower bound was requested at all (RUN_OLD is the
// one run outside the default 7-day window).
const REPO_BY_RUN_ID: Record<string, string> = {
  "run-1": "acme/payments-api",
  "run-2": "acme/web-app",
  "run-3": "acme/payments-api",
  "run-old": "acme/payments-api",
};

function filterRuns(filters: CiRunsFilters): CiRun[] {
  let list = RUNS;
  if (filters.since) list = list.filter((r) => r.id !== "run-old");
  if (filters.agent_id) {
    const name = AGENTS.find((a) => a.id === filters.agent_id)?.name;
    list = list.filter((r) => r.agent === name);
  }
  if (filters.repo) list = list.filter((r) => REPO_BY_RUN_ID[r.id] === filters.repo);
  if (filters.status) list = list.filter((r) => r.status === filters.status);
  if (filters.source) list = list.filter((r) => r.source === filters.source);
  return list;
}

function renderPage() {
  useAgentsMock.mockReturnValue({ data: AGENTS });
  useReposMock.mockReturnValue({ data: REPOS });
  useCiRunsMock.mockImplementation((filters: CiRunsFilters) => ({
    data: filterRuns(filters),
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }));

  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
      <CiRunsPage />
    </NextIntlClientProvider>,
  );
}

/** The 5 `<select>`s in FilterBar's fixed order: date range, agent, repo,
 *  status, source. */
function select(index: number): HTMLSelectElement {
  const el = screen.getAllByRole("combobox")[index];
  if (!el) throw new Error(`expected a <select> at index ${index}`);
  return el as HTMLSelectElement;
}

describe("CiRunsPage — AC-36 filters narrow the rendered list", () => {
  it("default (last 7 days) excludes a run outside the window", () => {
    renderPage();
    expect(screen.getByText("Add rate limiting")).toBeInTheDocument();
    expect(screen.queryByText("Old PR from last month")).not.toBeInTheDocument();
  });

  it("date range: switching to 'All time' reveals the older run", () => {
    renderPage();
    fireEvent.change(select(0), { target: { value: "all" } });
    expect(screen.getByText("Old PR from last month")).toBeInTheDocument();
  });

  it("agent: narrows the list to the selected agent's runs", () => {
    renderPage();
    fireEvent.change(select(1), { target: { value: "ag-style" } });

    expect(screen.getByText("Refactor CSS modules")).toBeInTheDocument();
    expect(screen.queryByText("Add rate limiting")).not.toBeInTheDocument();
    expect(screen.queryByText("Bump dependencies")).not.toBeInTheDocument();
  });

  it("repo: narrows the list to the selected repo's runs", () => {
    renderPage();
    fireEvent.change(select(2), { target: { value: "acme/web-app" } });

    expect(screen.getByText("Refactor CSS modules")).toBeInTheDocument();
    expect(screen.queryByText("Add rate limiting")).not.toBeInTheDocument();
  });

  it("status: narrows the list to the selected status", () => {
    renderPage();
    fireEvent.change(select(3), { target: { value: "running" } });

    expect(screen.getByText("Bump dependencies")).toBeInTheDocument();
    expect(screen.queryByText("Add rate limiting")).not.toBeInTheDocument();
    expect(screen.queryByText("Refactor CSS modules")).not.toBeInTheDocument();
  });

  it("source: narrows the list to the selected source", () => {
    renderPage();
    fireEvent.change(select(4), { target: { value: "local" } });

    expect(screen.getByText("Refactor CSS modules")).toBeInTheDocument();
    expect(screen.queryByText("Add rate limiting")).not.toBeInTheDocument();
    expect(screen.queryByText("Bump dependencies")).not.toBeInTheDocument();
  });
});

describe("CiRunsPage — AC-37 empty state", () => {
  it("shows 'No CI runs yet' + the 'Set up CI for an agent' CTA when there are no runs", () => {
    useAgentsMock.mockReturnValue({ data: AGENTS });
    useReposMock.mockReturnValue({ data: REPOS });
    useCiRunsMock.mockReturnValue({ data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() });

    render(
      <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
        <CiRunsPage />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText("No CI runs yet")).toBeInTheDocument();
    const cta = screen.getByText("Set up CI for an agent");
    expect(cta).toBeInTheDocument();

    fireEvent.click(cta);
    expect(pushMock).toHaveBeenCalledWith("/agents");
  });
});

describe("CiRunsPage — AC-34 reconcile", () => {
  it("fires the reconcile mutation once on mount", () => {
    renderPage();
    expect(reconcileMutate).toHaveBeenCalledTimes(1);
  });

  it("the Refresh button invokes the reconcile mutation", () => {
    renderPage();
    // one call already fired on mount — isolate the click's own call.
    reconcileMutate.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(reconcileMutate).toHaveBeenCalledTimes(1);
  });
});

describe("CiRunsPage — filters identity stability (regression)", () => {
  // Regression guard: `since`/`filters` were previously computed inline in
  // the render body, so each render produced a NEW object (millisecond-
  // precision `since`), making the `useCiRuns(filters)` React Query key
  // change on every render — including the re-render the query's own
  // fetch/settle triggers — causing an unbounded refetch loop that
  // exhausted the server's global rate limiter (see e2e/INSIGHTS.md).
  // `since`/`filters` must now be memoized so their references stay stable
  // across renders when no filter input actually changed.
  it("passes a referentially-stable `filters` object (and `since`) to useCiRuns across re-renders", () => {
    const { rerender } = renderPage();

    expect(useCiRunsMock.mock.calls.length).toBeGreaterThan(0);
    const firstCall = useCiRunsMock.mock.calls[0];
    if (!firstCall) throw new Error("expected useCiRuns to have been called");
    const firstFilters = firstCall[0] as CiRunsFilters;

    // Force a second render pass of the same tree (no filter input changed)
    // — mirrors the settle-triggered re-render that exposed the bug.
    rerender(
      <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
        <CiRunsPage />
      </NextIntlClientProvider>,
    );

    expect(useCiRunsMock.mock.calls.length).toBeGreaterThan(1);
    const lastCall = useCiRunsMock.mock.calls[useCiRunsMock.mock.calls.length - 1];
    if (!lastCall) throw new Error("expected a second useCiRuns call after rerender");
    const lastFilters = lastCall[0] as CiRunsFilters;

    expect(lastFilters).toBe(firstFilters);
    expect(lastFilters.since).toBe(firstFilters.since);
  });
});

describe("CiRunsPage — error state", () => {
  it("shows the error body and retries via refetch", () => {
    useAgentsMock.mockReturnValue({ data: AGENTS });
    useReposMock.mockReturnValue({ data: REPOS });
    const refetch = vi.fn();
    useCiRunsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("network down"),
      refetch,
    });

    render(
      <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
        <CiRunsPage />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText("Couldn't load CI runs")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
