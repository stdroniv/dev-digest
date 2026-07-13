import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentColumn, AgentColumnFinding } from "@devdigest/shared";
import messages from "../../../../../messages/en/multiAgent.json";
import { ColumnsView } from "./ColumnsView";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const finding = (over: Partial<AgentColumnFinding> = {}): AgentColumnFinding => ({
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "SQL injection risk",
  file: "src/db/query.ts",
  start_line: 42,
  ...over,
});

const column = (over: Partial<AgentColumn> = {}): AgentColumn => ({
  run_id: "run-1",
  agent_id: "agent-security",
  agent_name: "Security Reviewer",
  provider: "openai",
  model: "gpt-4.1",
  status: "done",
  verdict: "warn",
  score: 82,
  summary: "Found injection risks.",
  duration_ms: 3200,
  cost_usd: 0.04,
  findings: [finding()],
  ...over,
});

describe("ColumnsView", () => {
  it("renders one column per agent with identity, duration, cost and score (AC-19)", () => {
    const columns = [
      column({ run_id: "r-sec", agent_name: "Security Reviewer", score: 82, duration_ms: 3200, cost_usd: 0.04 }),
      column({
        run_id: "r-perf",
        agent_id: "agent-performance",
        agent_name: "Performance Optimizer",
        score: 45,
        duration_ms: 5100,
        cost_usd: 0.07,
        findings: [],
      }),
    ];
    renderWithIntl(<ColumnsView columns={columns} onViewTrace={() => {}} />);

    // identity
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Performance Optimizer")).toBeInTheDocument();
    // duration + cost (honest mock-faithful formatting)
    expect(screen.getByText("3.2s · $0.04")).toBeInTheDocument();
    expect(screen.getByText("5.1s · $0.07")).toBeInTheDocument();
    // score
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.getByText("45")).toBeInTheDocument();
    // one column per agent → one trace link each
    expect(screen.getAllByText("View trace")).toHaveLength(2);
  });

  it("lists each finding with title and file:line, plus a footer count and View trace (AC-20)", () => {
    const columns = [
      column({
        findings: [
          finding({ id: "f1", title: "SQL injection risk", file: "src/db/query.ts", start_line: 42 }),
          finding({ id: "f2", severity: "WARNING", title: "Missing rate limit", file: "src/api/route.ts", start_line: 8 }),
        ],
      }),
    ];
    renderWithIntl(<ColumnsView columns={columns} onViewTrace={() => {}} />);

    expect(screen.getByText("SQL injection risk")).toBeInTheDocument();
    expect(screen.getByText("src/db/query.ts:42")).toBeInTheDocument();
    expect(screen.getByText("Missing rate limit")).toBeInTheDocument();
    expect(screen.getByText("src/api/route.ts:8")).toBeInTheDocument();
    // footer: count + View trace link
    expect(screen.getByText("2 findings")).toBeInTheDocument();
    expect(screen.getByText("View trace")).toBeInTheDocument();
  });

  it("calls onViewTrace with the column when its trace link is clicked (AC-32)", () => {
    const onViewTrace = vi.fn();
    const col = column({ run_id: "r-sec" });
    renderWithIntl(<ColumnsView columns={[col]} onViewTrace={onViewTrace} />);

    fireEvent.click(screen.getByText("View trace"));
    expect(onViewTrace).toHaveBeenCalledTimes(1);
    expect(onViewTrace).toHaveBeenCalledWith(col);
  });

  it("renders a failed column's failed state, keeping its trace inspectable (AC-33)", () => {
    const columns = [
      column({
        run_id: "r-fail",
        agent_id: "agent-perf",
        agent_name: "Performance Optimizer",
        status: "failed",
        score: null,
        duration_ms: null,
        cost_usd: null,
        summary: null,
        findings: [],
      }),
    ];
    renderWithIntl(<ColumnsView columns={columns} onViewTrace={() => {}} />);

    expect(screen.getByTestId("agent-status-failed")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    // no score is rendered for a failed column…
    expect(screen.queryByText("82")).not.toBeInTheDocument();
    // …and the trace link is still present so the failure can be inspected
    expect(screen.getByText("View trace")).toBeInTheDocument();
  });

  it("renders a live running status in the header (AC-31)", () => {
    const columns = [
      column({ run_id: "r-run", status: "running", score: null, duration_ms: null, cost_usd: null, findings: [] }),
    ];
    renderWithIntl(<ColumnsView columns={columns} onViewTrace={() => {}} />);

    expect(screen.getByTestId("agent-status-running")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("renders a zero-findings done column with an empty body and a count of 0 (edge)", () => {
    const columns = [column({ run_id: "r-empty", findings: [] })];
    renderWithIntl(<ColumnsView columns={columns} onViewTrace={() => {}} />);

    expect(screen.getByText("No findings.")).toBeInTheDocument();
    expect(screen.getByText("0 findings")).toBeInTheDocument();
    // the score/identity still render for a done, zero-findings column
    expect(screen.getByText("82")).toBeInTheDocument();
  });

  it("links a finding's title to its card on the PR overview when findingHref is provided", () => {
    const columns = [column({ findings: [finding({ id: "f1", title: "SQL injection risk" })] })];
    renderWithIntl(
      <ColumnsView
        columns={columns}
        onViewTrace={() => {}}
        findingHref={(f) => `/repos/repo-1/pulls/29752?tab=findings#finding-${f.id}`}
      />,
    );

    const link = screen.getByRole("link", { name: /SQL injection risk/ });
    expect(link).toHaveAttribute("href", "/repos/repo-1/pulls/29752?tab=findings#finding-f1");
  });

  it("renders the finding title as plain text when findingHref is omitted", () => {
    const columns = [column({ findings: [finding({ title: "SQL injection risk" })] })];
    renderWithIntl(<ColumnsView columns={columns} onViewTrace={() => {}} />);

    expect(screen.getByText("SQL injection risk")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /SQL injection risk/ })).not.toBeInTheDocument();
  });

  it("links the file:line to GitHub when fileHref is provided, plain text otherwise", () => {
    const columns = [
      column({ findings: [finding({ file: "src/db/query.ts", start_line: 42 })] }),
    ];
    renderWithIntl(
      <ColumnsView
        columns={columns}
        onViewTrace={() => {}}
        fileHref={(f) => `https://github.com/acme/widgets/pull/29752/files#diff-abc${f.start_line}`}
      />,
    );

    const link = screen.getByRole("link", { name: "src/db/query.ts:42" });
    expect(link).toHaveAttribute("href", "https://github.com/acme/widgets/pull/29752/files#diff-abc42");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("keeps each agent's findings within its own column (AC-20 attribution)", () => {
    const columns = [
      column({
        run_id: "r-sec",
        agent_name: "Security Reviewer",
        findings: [finding({ id: "s1", title: "Secret leaked", file: "a.ts", start_line: 1 })],
      }),
      column({
        run_id: "r-perf",
        agent_id: "agent-performance",
        agent_name: "Performance Optimizer",
        findings: [finding({ id: "p1", title: "N+1 query", file: "b.ts", start_line: 2 })],
      }),
    ];
    renderWithIntl(<ColumnsView columns={columns} onViewTrace={() => {}} />);

    const secColumn = screen.getByText("Secret leaked").closest("div");
    expect(within(secColumn!.parentElement!).queryByText("N+1 query")).not.toBeInTheDocument();
    // each column reports its own singular finding count
    expect(screen.getAllByText("1 finding")).toHaveLength(2);
  });
});
