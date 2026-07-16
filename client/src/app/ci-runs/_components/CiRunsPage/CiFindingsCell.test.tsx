/**
 * CiFindingsCell — the CI Runs table's per-severity FINDINGS chips (AC-35).
 * Only non-zero severities render a chip; a null/all-zero tally shows "—".
 */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CiFindingsCell } from "./CiFindingsCell";

afterEach(cleanup);

describe("CiFindingsCell", () => {
  it("renders a chip per non-zero severity with its count in the accessible label", () => {
    render(<CiFindingsCell counts={{ critical: 2, warning: 1, suggestion: 3 }} />);

    expect(screen.getByLabelText("2 CRITICAL")).toBeInTheDocument();
    expect(screen.getByLabelText("1 WARNING")).toBeInTheDocument();
    expect(screen.getByLabelText("3 SUGGESTION")).toBeInTheDocument();
  });

  it("omits a chip for a severity whose count is zero", () => {
    render(<CiFindingsCell counts={{ critical: 0, warning: 4, suggestion: 0 }} />);

    expect(screen.getByLabelText("4 WARNING")).toBeInTheDocument();
    expect(screen.queryByLabelText(/CRITICAL/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/SUGGESTION/)).not.toBeInTheDocument();
  });

  it("shows an em dash when the counts are null (never reviewed in CI)", () => {
    render(<CiFindingsCell counts={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows an em dash when every severity count is zero", () => {
    render(<CiFindingsCell counts={{ critical: 0, warning: 0, suggestion: 0 }} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
