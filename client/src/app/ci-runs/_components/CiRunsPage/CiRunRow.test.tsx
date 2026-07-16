/**
 * CiRunRow — one CI Runs table row (AC-35: all 9 columns) + the status token
 * that keys off `run.status`, NOT the CRITICAL findings count (AC-33).
 */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { CiRun } from "@devdigest/shared";
import messages from "../../../../../messages/en/ci.json";
import { CiRunRow } from "./CiRunRow";
import { formatTimestamp } from "./helpers";

afterEach(cleanup);

function ciRun(o: Partial<CiRun>): CiRun {
  return {
    id: "run-1",
    ci_installation_id: "inst-1",
    pr_number: 101,
    pr_title: "Add rate limiting to public API endpoints",
    ran_at: "2026-07-10T14:32:00.000Z",
    status: "succeeded",
    findings_count: 1,
    findings_counts: { critical: 1, warning: 0, suggestion: 0 },
    cost_usd: 0.0123,
    github_url: "https://github.com/acme/payments-api/actions/runs/1001",
    actions_run_id: "1001",
    source: "ci",
    agent: "Security Reviewer",
    duration_s: 42,
    ...o,
  };
}

function renderRow(run: CiRun) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
      <CiRunRow run={run} last />
    </NextIntlClientProvider>,
  );
}

describe("CiRunRow — AC-35 all columns", () => {
  it("renders every column for a fully-populated run", () => {
    const run = ciRun({});
    renderRow(run);

    // Timestamp
    expect(screen.getByText(formatTimestamp(run.ran_at))).toBeInTheDocument();
    // Pull request: number + title
    expect(screen.getByText("#101")).toBeInTheDocument();
    expect(screen.getByText(run.pr_title!)).toBeInTheDocument();
    // Agent
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    // Source
    expect(screen.getByText("ci")).toBeInTheDocument();
    // Duration
    expect(screen.getByText("42s")).toBeInTheDocument();
    // Findings — per-severity chip (only CRITICAL is non-zero here)
    expect(screen.getByLabelText("1 CRITICAL")).toBeInTheDocument();
    // Cost
    expect(screen.getByText("$0.012")).toBeInTheDocument();
    // Status
    expect(screen.getByText("Succeeded")).toBeInTheDocument();
    // Trace — outbound link to github_url
    const trace = screen.getByRole("link", { name: "Trace" });
    expect(trace).toHaveAttribute("href", run.github_url);
  });

  it("shows an em dash for a null duration", () => {
    renderRow(ciRun({ duration_s: null }));
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows an em dash for a null cost", () => {
    renderRow(ciRun({ cost_usd: null }));
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows an em dash in the Findings cell when findings_counts is null", () => {
    renderRow(ciRun({ findings_counts: null }));
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows an em dash in the Findings cell when every severity count is zero", () => {
    renderRow(ciRun({ findings_counts: { critical: 0, warning: 0, suggestion: 0 } }));
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows an em dash for the Trace column when there is no github_url", () => {
    renderRow(ciRun({ github_url: null }));
    expect(screen.queryByRole("link", { name: "Trace" })).not.toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("CiRunRow — AC-33 status token keys off run.status, not the CRITICAL count", () => {
  it("shows 'Succeeded' (not 'Failed') for a succeeded run that has CRITICAL findings", () => {
    renderRow(ciRun({ status: "succeeded", findings_counts: { critical: 3, warning: 0, suggestion: 0 } }));

    expect(screen.getByText("Succeeded")).toBeInTheDocument();
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
  });

  it("shows 'Failed' for a run whose status is failed", () => {
    renderRow(ciRun({ status: "failed" }));
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });
});

describe("CiRunRow — edge statuses render distinct, non-crashing tokens", () => {
  it("renders 'Running' for an in-progress run", () => {
    renderRow(ciRun({ status: "running" }));
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("renders 'Skipped — no credentials' for a fork PR with no secrets", () => {
    renderRow(ciRun({ status: "skipped_no_credentials" }));
    expect(screen.getByText("Skipped — no credentials")).toBeInTheDocument();
  });

  it("shows an em dash in the Status cell when status is null", () => {
    renderRow(
      ciRun({
        status: null,
        // keep every other dash-able field non-dash so the only "—" is Status.
        duration_s: 10,
        cost_usd: 0.01,
        findings_counts: { critical: 0, warning: 1, suggestion: 0 },
        github_url: "https://github.com/acme/payments-api/actions/runs/1001",
      }),
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
