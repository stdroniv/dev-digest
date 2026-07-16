import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Conflict } from "@devdigest/shared";
import multiAgentMessages from "../../../../../messages/en/multiAgent.json";
import { ConflictsSection } from "./ConflictsSection";

afterEach(cleanup);

// --- fixtures ---------------------------------------------------------------
// A genuine conflict: two agents flagged the same location with DIVERGENT
// severities (AC-29 divergent-severity branch).
const DIVERGENT: Conflict = {
  file: "src/auth.ts",
  line: 10,
  title: "SQL injection risk",
  is_conflict: true,
  takes: [
    { agent_id: "sec", persona: "Security", verdict: "CRITICAL", note: "Unsanitized input reaches the query" },
    { agent_id: "men", persona: "Mentor", verdict: "SUGGESTION", note: "Consider parameterizing" },
  ],
};

// A genuine conflict: one agent flagged, another reviewed but did NOT flag
// (AC-29 flagged-vs-'ignored' branch).
const FLAGGED_VS_SILENT: Conflict = {
  file: "src/db.ts",
  line: 20,
  title: "Missing null check",
  is_conflict: true,
  takes: [
    { agent_id: "sec", persona: "Security", verdict: "WARNING", note: "Possible NPE on empty result" },
    { agent_id: "men", persona: "Mentor", verdict: "ignored", note: "" },
  ],
};

// An agreement: every reviewing agent flagged it at the SAME severity — not a
// conflict, hidden when the toggle is on.
const AGREEMENT: Conflict = {
  file: "src/util.ts",
  line: 30,
  title: "Unclear variable name",
  is_conflict: false,
  takes: [
    { agent_id: "sec", persona: "Security", verdict: "SUGGESTION", note: "Rename `x`" },
    { agent_id: "men", persona: "Mentor", verdict: "SUGGESTION", note: "Rename `x`" },
  ],
};

function renderSection(props: { conflicts: Conflict[]; reviewedAgentCount: number }) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: multiAgentMessages }}>
      <ConflictsSection {...props} />
    </NextIntlClientProvider>,
  );
}

const card = (container: HTMLElement, fileLine: string) =>
  container.querySelector<HTMLElement>(`[data-conflict="${fileLine}"]`);

describe("ConflictsSection — reviewed-set gate (AC-30 / AC-34)", () => {
  it("renders nothing when fewer than two agents reviewed (1 reviewed)", () => {
    const { container } = renderSection({ conflicts: [DIVERGENT], reviewedAgentCount: 1 });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Where agents disagree")).not.toBeInTheDocument();
  });

  it("renders nothing for an all-failed run (0 reviewed)", () => {
    const { container } = renderSection({ conflicts: [], reviewedAgentCount: 0 });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the section once at least two agents reviewed", () => {
    renderSection({ conflicts: [DIVERGENT], reviewedAgentCount: 2 });
    expect(screen.getByText("Where agents disagree")).toBeInTheDocument();
  });
});

describe("ConflictsSection — default render (AC-26 / AC-27)", () => {
  it("shows one row per grouped location and every take's verdict or 'did not flag'", () => {
    const { container } = renderSection({
      conflicts: [DIVERGENT, FLAGGED_VS_SILENT, AGREEMENT],
      reviewedAgentCount: 2,
    });

    // AC-26 — a row per grouped location (agreements AND conflicts, toggle off).
    expect(card(container, "src/auth.ts:10")).toBeTruthy();
    expect(card(container, "src/db.ts:20")).toBeTruthy();
    expect(card(container, "src/util.ts:30")).toBeTruthy();
    expect(screen.getByText("SQL injection risk")).toBeInTheDocument();
    expect(screen.getByText("Missing null check")).toBeInTheDocument();
    expect(screen.getByText("Unclear variable name")).toBeInTheDocument();

    // AC-27 — divergent conflict: both flagging agents show an uppercase severity.
    const divergent = within(card(container, "src/auth.ts:10")!);
    expect(divergent.getByText("Security")).toBeInTheDocument();
    expect(divergent.getByText("Mentor")).toBeInTheDocument();
    expect(divergent.getByText("CRITICAL")).toBeInTheDocument();
    expect(divergent.getByText("SUGGESTION")).toBeInTheDocument();
    expect(divergent.getByText("Unsanitized input reaches the query")).toBeInTheDocument();

    // AC-27 — flagged-vs-silent: the reviewing agent that stayed silent shows a
    // muted "did not flag" (verdict === 'ignored'), the other shows its severity.
    const silent = within(card(container, "src/db.ts:20")!);
    expect(silent.getByText("WARNING")).toBeInTheDocument();
    expect(silent.getByText("did not flag")).toBeInTheDocument();
  });
});

describe("ConflictsSection — 'Show only conflicts' toggle (AC-28)", () => {
  it("hides agreement-only locations, keeping divergent and flagged-vs-silent conflicts", () => {
    const { container } = renderSection({
      conflicts: [DIVERGENT, FLAGGED_VS_SILENT, AGREEMENT],
      reviewedAgentCount: 2,
    });

    // toggle off → agreement visible.
    expect(card(container, "src/util.ts:30")).toBeTruthy();

    fireEvent.click(screen.getByRole("switch"));

    // toggle on → genuine conflicts stay, the full agreement is hidden.
    expect(card(container, "src/auth.ts:10")).toBeTruthy();
    expect(card(container, "src/db.ts:20")).toBeTruthy();
    expect(card(container, "src/util.ts:30")).toBeNull();
  });

  it("shows a shown/total count that drops when an agreement is filtered out", () => {
    renderSection({ conflicts: [DIVERGENT, FLAGGED_VS_SILENT, AGREEMENT], reviewedAgentCount: 2 });

    expect(screen.getByText("3 of 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch"));

    expect(screen.getByText("2 of 3")).toBeInTheDocument();
  });

  it("keeps the count at N of N when every row is a genuine conflict — the toggle's only visible feedback in that (common) case", () => {
    // No AGREEMENT row — the realistic case (AC-29's classification rarely produces
    // an agreement across independent agents), where toggling hides nothing.
    renderSection({ conflicts: [DIVERGENT, FLAGGED_VS_SILENT], reviewedAgentCount: 2 });

    expect(screen.getByText("2 of 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch"));

    expect(screen.getByText("2 of 2")).toBeInTheDocument();
  });

  it("shows the empty message when the toggle is on and only agreements remain", () => {
    renderSection({ conflicts: [AGREEMENT], reviewedAgentCount: 2 });

    // agreement is visible with the toggle off …
    expect(screen.getByText("Unclear variable name")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch"));

    // … and once filtered out, the empty state stands in for it.
    expect(screen.queryByText("Unclear variable name")).not.toBeInTheDocument();
    expect(
      screen.getByText("No conflicts — the agents agree on every flagged location."),
    ).toBeInTheDocument();
  });
});
