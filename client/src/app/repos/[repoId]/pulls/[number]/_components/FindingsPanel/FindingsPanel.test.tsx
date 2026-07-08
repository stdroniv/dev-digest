import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import evalsMessages from "../../../../../../../../messages/en/evals.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

// FindingCard (rendered by FindingsPanel) uses the eval-case mutation hook
// (T14, "Turn into eval case"); mock it so this suite doesn't need a
// QueryClientProvider just to satisfy that nested hook.
vi.mock("../../../../../../../lib/hooks/evals", () => ({
  useCreateCaseFromFinding: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(cleanup);

function finding(over: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    severity: "CRITICAL",
    category: "security",
    title: over.id,
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "Because.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  };
}

const FINDINGS: FindingRecord[] = [
  finding({ id: "f1", severity: "CRITICAL", title: "Hardcoded secret" }),
];

const MIXED: FindingRecord[] = [
  finding({ id: "c1", severity: "CRITICAL", title: "Hardcoded secret" }),
  finding({ id: "w1", severity: "WARNING", title: "Slow query" }),
  finding({ id: "s1", severity: "SUGGESTION", title: "Rename variable" }),
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages, evals: evalsMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });
});

describe("FindingsPanel severity filter", () => {
  it("renders a chip per severity with its count", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    expect(screen.getByLabelText("Show only Critical (1)")).toBeInTheDocument();
    expect(screen.getByLabelText("Show only Warning (1)")).toBeInTheDocument();
    expect(screen.getByLabelText("Show only Suggestion (1)")).toBeInTheDocument();
  });

  it("filters the list to one severity on click, and restores on a second click", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    const critical = screen.getByLabelText("Show only Critical (1)");

    // All three visible initially.
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("Slow query")).toBeInTheDocument();
    expect(screen.getByText("Rename variable")).toBeInTheDocument();

    // Click CRITICAL → only the critical finding remains.
    fireEvent.click(critical);
    expect(critical).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.queryByText("Slow query")).not.toBeInTheDocument();
    expect(screen.queryByText("Rename variable")).not.toBeInTheDocument();

    // Click CRITICAL again → filter clears, all three back.
    fireEvent.click(critical);
    expect(critical).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Slow query")).toBeInTheDocument();
    expect(screen.getByText("Rename variable")).toBeInTheDocument();
  });

  it("disables a severity chip with a zero count", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByLabelText("Show only Warning (0)")).toBeDisabled();
    expect(screen.getByLabelText("Show only Critical (1)")).toBeEnabled();
  });
});
