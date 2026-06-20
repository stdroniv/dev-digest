/**
 * FindingsCounts — compact per-severity counters shared by the PR list and the
 * Agent-runs timeline. Only non-zero severities render; a null/all-zero tally is
 * a muted em dash; the whole group carries an aria-label for screen readers.
 */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/prReview.json";
import { FindingsCounts } from "./FindingsCounts";

afterEach(cleanup);

function renderCounts(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsCounts", () => {
  it("renders each non-zero severity's count and an aria-label for the group", () => {
    renderCounts(<FindingsCounts counts={{ critical: 2, warning: 1, suggestion: 3 }} />);
    expect(screen.getByLabelText("2 critical, 1 warning, 3 suggestion")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("hides severities whose count is zero", () => {
    renderCounts(<FindingsCounts counts={{ critical: 0, warning: 2, suggestion: 0 }} />);
    // The zero severities render no visible number; only the warning "2" shows.
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("renders an em dash for a null tally (never reviewed)", () => {
    renderCounts(<FindingsCounts counts={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders an em dash for an all-zero tally", () => {
    renderCounts(<FindingsCounts counts={{ critical: 0, warning: 0, suggestion: 0 }} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
