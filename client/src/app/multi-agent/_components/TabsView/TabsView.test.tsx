import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentColumn, ReviewRecord } from "@devdigest/shared";
import multiAgentMessages from "../../../../../messages/en/multiAgent.json";
import { TabsView } from "./TabsView";

// ---- hook + toast mocks (no QueryClient / fetch — hooks are mocked) ----
let reviewsData: ReviewRecord[] = [];
const findingActionMutate = vi.fn();
const learnMutate = vi.fn();
const evalCaseMutate = vi.fn();
const notifySuccess = vi.fn();
const notifyInfo = vi.fn();
const notifyError = vi.fn();
const findingActionState = { isPending: false };

vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: () => ({ data: reviewsData }),
  useFindingAction: () => ({ mutate: findingActionMutate, isPending: findingActionState.isPending }),
}));
vi.mock("@/lib/hooks/multi-agent", () => ({
  useLearnFinding: () => ({ mutate: learnMutate, isPending: false }),
}));
vi.mock("@/lib/hooks/evals", () => ({
  useCreateCaseFromFinding: () => ({ mutate: evalCaseMutate, isPending: false }),
}));
vi.mock("@/lib/toast", () => ({
  notify: {
    success: (m: string) => notifySuccess(m),
    info: (m: string) => notifyInfo(m),
    error: (m: string) => notifyError(m),
    toast: vi.fn(),
  },
}));

// ---- fixtures ----
const PR_ID = "pr-1";

/** A done column with a lean finding, plus the full persisted finding it maps
 *  to (confidence + suggestion) in `reviewsData`. */
function makeColumns(): AgentColumn[] {
  return [
    {
      run_id: "ar-sec",
      agent_id: "ag-sec",
      agent_name: "Security Reviewer",
      provider: "openai",
      model: "gpt-4o",
      status: "done",
      verdict: "request_changes",
      score: 42, // < 50 → crit tint
      summary: "Found a hardcoded secret.",
      duration_ms: 4200,
      cost_usd: 0.08,
      findings: [
        {
          id: "f-sec-1",
          severity: "CRITICAL",
          category: "security",
          title: "Hardcoded Stripe secret key",
          file: "src/config.ts",
          start_line: 11,
          kind: "finding",
        },
      ],
    },
    {
      run_id: "ar-perf",
      agent_id: "ag-perf",
      agent_name: "Performance Reviewer",
      provider: "openai",
      model: "gpt-4o",
      status: "done",
      verdict: "approve",
      score: 88, // >= 75 → ok tint
      summary: "Minor allocation in a hot path.",
      duration_ms: 3100,
      cost_usd: 0.05,
      findings: [
        {
          id: "f-perf-1",
          severity: "WARNING",
          category: "perf",
          title: "Unbounded array copy",
          file: "src/list.ts",
          start_line: 40,
          kind: "finding",
        },
      ],
    },
  ];
}

function reviewsFixture(): ReviewRecord[] {
  const base = {
    review_id: "rev-1",
    accepted_at: null,
    dismissed_at: null,
    end_line: 11,
    rationale: "A live Stripe key is committed in source.",
    kind: "finding" as const,
    trifecta_components: null,
    evidence: null,
  };
  return [
    {
      id: "rev-1",
      pr_id: PR_ID,
      agent_id: "ag-sec",
      run_id: "ar-sec",
      agent_name: "Security Reviewer",
      kind: "review",
      verdict: "request_changes",
      summary: "Found a hardcoded secret.",
      score: 42,
      model: "gpt-4o",
      created_at: "2026-07-12T00:00:00.000Z",
      findings: [
        {
          ...base,
          id: "f-sec-1",
          severity: "CRITICAL",
          category: "security",
          title: "Hardcoded Stripe secret key",
          file: "src/config.ts",
          start_line: 11,
          confidence: 0.95,
          suggestion: "Move the key to an environment variable.",
        },
      ],
    },
    {
      id: "rev-2",
      pr_id: PR_ID,
      agent_id: "ag-perf",
      run_id: "ar-perf",
      agent_name: "Performance Reviewer",
      kind: "review",
      verdict: "approve",
      summary: "Minor allocation in a hot path.",
      score: 88,
      model: "gpt-4o",
      created_at: "2026-07-12T00:00:00.000Z",
      findings: [
        {
          ...base,
          id: "f-perf-1",
          severity: "WARNING",
          category: "perf",
          title: "Unbounded array copy",
          file: "src/list.ts",
          start_line: 40,
          end_line: 40,
          rationale: "Copies the whole array per iteration.",
          confidence: 0.7,
          suggestion: "Hoist the copy out of the loop.",
        },
      ],
    },
  ];
}

function renderTabs(columns = makeColumns(), onViewTrace = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: multiAgentMessages }}>
      <TabsView columns={columns} prId={PR_ID} onViewTrace={onViewTrace} />
    </NextIntlClientProvider>,
  );
  return { onViewTrace };
}

beforeEach(() => {
  reviewsData = reviewsFixture();
  findingActionState.isPending = false;
  findingActionMutate.mockImplementation((_vars, opts) => opts?.onSuccess?.({ finding: {} }));
  learnMutate.mockImplementation((_id, opts) => opts?.onSuccess?.({ memory_id: "mem-1" }));
  evalCaseMutate.mockImplementation((_vars, opts) => opts?.onSuccess?.({ case: {}, already_added: false }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// AC-21 — one tab per agent + detail panel fields
// ---------------------------------------------------------------------------
describe("TabsView — tabs + detail panel (AC-21)", () => {
  it("renders one tab per agent (name + score) and defaults to the first agent's detail", () => {
    renderTabs();

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveTextContent("Security Reviewer");
    expect(tabs[0]).toHaveTextContent("42");
    expect(tabs[1]).toHaveTextContent("Performance Reviewer");
    expect(tabs[1]).toHaveTextContent("88");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");

    // detail panel shows the first agent's summary, duration·cost, and trace link
    expect(screen.getByText("Found a hardcoded secret.")).toBeInTheDocument();
    expect(screen.getByText("4.2s · $0.08")).toBeInTheDocument();
    expect(screen.getByText("View trace")).toBeInTheDocument();
  });

  it("switches the detail panel when another tab is selected", () => {
    renderTabs();
    // first agent's finding is shown; the other agent's is not
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
    expect(screen.queryByText("Unbounded array copy")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Performance Reviewer"));

    expect(screen.getByText("Minor allocation in a hot path.")).toBeInTheDocument();
    expect(screen.getByText("3.1s · $0.05")).toBeInTheDocument();
    expect(screen.getByText("Unbounded array copy")).toBeInTheDocument();
    expect(screen.queryByText("Hardcoded Stripe secret key")).not.toBeInTheDocument();
  });

  it("opens the selected agent's trace via onViewTrace(column) (AC-32)", () => {
    const { onViewTrace } = renderTabs();
    fireEvent.click(screen.getByText("View trace"));
    expect(onViewTrace).toHaveBeenCalledTimes(1);
    expect(onViewTrace.mock.calls[0]![0]).toMatchObject({ run_id: "ar-sec", agent_id: "ag-sec" });
  });
});

// ---------------------------------------------------------------------------
// AC-22 — finding detail: confidence + suggested fix + all four actions
// ---------------------------------------------------------------------------
describe("TabsView — finding card content + actions (AC-22)", () => {
  it("shows confidence, suggested fix, and the four actions from the enrichment lookup", () => {
    renderTabs();
    const card = screen.getByText("Hardcoded Stripe secret key").closest("[data-finding-id]") as HTMLElement;
    expect(card).toBeTruthy();
    const scoped = within(card);

    // enriched from usePrReviews: confidence (95%) + suggested fix
    expect(scoped.getByText("Confidence")).toBeInTheDocument();
    expect(scoped.getByText("95% conf")).toBeInTheDocument();
    expect(scoped.getByText("Suggested fix")).toBeInTheDocument();

    // all four actions present
    expect(scoped.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(scoped.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    expect(scoped.getByRole("button", { name: "Learn" })).toBeInTheDocument();
    expect(scoped.getByRole("button", { name: "Turn into eval case" })).toBeInTheDocument();
  });

  it("hides the confidence/fix rows when the enrichment lookup misses (graceful fallback)", () => {
    reviewsData = []; // no detail matches → rows degrade away, actions remain
    renderTabs();
    expect(screen.queryByText("Confidence")).not.toBeInTheDocument();
    expect(screen.queryByText("Suggested fix")).not.toBeInTheDocument();
    // the finding + its actions still render off the lean column data
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn into eval case" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-23 — Accept/Dismiss persist + reflect
// ---------------------------------------------------------------------------
describe("TabsView — Accept / Dismiss (AC-23)", () => {
  it("Accept calls useFindingAction('accept') and reflects the disposition (aria-pressed)", () => {
    renderTabs();
    const accept = screen.getByRole("button", { name: "Accept" });
    expect(accept).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(accept);

    expect(findingActionMutate).toHaveBeenCalledTimes(1);
    expect(findingActionMutate.mock.calls[0]![0]).toEqual({
      findingId: "f-sec-1",
      action: "accept",
      prId: PR_ID,
    });
    // onSuccess flips local disposition → reflected in the view
    expect(screen.getByRole("button", { name: "Accept" })).toHaveAttribute("aria-pressed", "true");
  });

  it("Dismiss calls useFindingAction('dismiss') and reflects the disposition", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(findingActionMutate.mock.calls[0]![0]).toEqual({
      findingId: "f-sec-1",
      action: "dismiss",
      prId: PR_ID,
    });
    expect(screen.getByRole("button", { name: "Dismiss" })).toHaveAttribute("aria-pressed", "true");
  });

  it("reflects a disposition already persisted in the enriched detail", () => {
    reviewsData = reviewsFixture();
    reviewsData[0]!.findings[0]!.accepted_at = "2026-07-12T00:00:00.000Z";
    renderTabs();
    expect(screen.getByRole("button", { name: "Accept" })).toHaveAttribute("aria-pressed", "true");
  });
});

// ---------------------------------------------------------------------------
// AC-24 — Turn into eval case (+ no-decision path)
// ---------------------------------------------------------------------------
describe("TabsView — Turn into eval case (AC-24)", () => {
  it("no prior decision → shows the helpful no-decision message and does NOT call the endpoint", () => {
    renderTabs(); // fixture finding has no accepted_at/dismissed_at
    fireEvent.click(screen.getByRole("button", { name: "Turn into eval case" }));

    expect(evalCaseMutate).not.toHaveBeenCalled();
    expect(notifyInfo).toHaveBeenCalledWith(
      "Accept or dismiss this finding first, then turn it into an eval case.",
    );
  });

  it("after a decision → calls useCreateCaseFromFinding({findingId}) and confirms", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    fireEvent.click(screen.getByRole("button", { name: "Turn into eval case" }));

    expect(evalCaseMutate).toHaveBeenCalledTimes(1);
    expect(evalCaseMutate.mock.calls[0]![0]).toEqual({ findingId: "f-sec-1" });
    expect(notifySuccess).toHaveBeenCalledWith("Turned into an eval case.");
  });

  it("maps a server no-decision error to the helpful message (defense-in-depth)", async () => {
    const { ApiError } = await import("@/lib/api");
    reviewsData = reviewsFixture();
    reviewsData[0]!.findings[0]!.accepted_at = "2026-07-12T00:00:00.000Z"; // gate passes
    evalCaseMutate.mockImplementation((_vars, opts) =>
      opts?.onError?.(new ApiError("no decision", 422, "no_decision")),
    );
    renderTabs();

    fireEvent.click(screen.getByRole("button", { name: "Turn into eval case" }));
    expect(evalCaseMutate).toHaveBeenCalledTimes(1);
    expect(notifyInfo).toHaveBeenCalledWith(
      "Accept or dismiss this finding first, then turn it into an eval case.",
    );
  });
});

// ---------------------------------------------------------------------------
// AC-25 — Learn
// ---------------------------------------------------------------------------
describe("TabsView — Learn (AC-25)", () => {
  it("Learn calls useLearnFinding(findingId) and confirms", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Learn" }));
    expect(learnMutate).toHaveBeenCalledTimes(1);
    expect(learnMutate.mock.calls[0]![0]).toBe("f-sec-1");
    expect(notifySuccess).toHaveBeenCalledWith("Learned from this finding.");
  });
});
