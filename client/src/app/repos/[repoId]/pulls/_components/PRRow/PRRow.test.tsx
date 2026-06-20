/**
 * PRRow — the COST cell shows the PR's total run cost (formatted), and falls
 * back to an em dash when the PR has no runs yet (cost_usd null).
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrMeta } from "@/lib/types";
import messages from "../../../../../../../messages/en/prReview.json";
import { PRRow } from "./PRRow";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

afterEach(cleanup);

function pr(o: Partial<PrMeta>): PrMeta {
  return {
    id: "pr-1",
    number: 482,
    title: "Add rate limiting to public API endpoints",
    author: "marisa.koch",
    branch: "feat/rate-limit-public",
    base: "main",
    head_sha: "a1b2c3",
    additions: 247,
    deletions: 38,
    files_count: 9,
    status: "needs_review",
    opened_at: null,
    updated_at: "2026-06-18T09:00:00.000Z",
    score: 61,
    cost_usd: null,
    // Non-empty by default so the findings cell renders counters (not a dash) —
    // keeps the single "—" the cost tests assert unambiguous.
    findings_counts: { critical: 2, warning: 2, suggestion: 1 },
    ...o,
  };
}

function renderRow(meta: PrMeta) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <PRRow pr={meta} repoId="repo-1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("PRRow — cost cell", () => {
  it("renders the formatted total cost when present", () => {
    renderRow(pr({ cost_usd: 0.0123 }));
    expect(screen.getByText("$0.012")).toBeInTheDocument();
  });

  it("renders an em dash when the PR has no runs (cost null)", () => {
    renderRow(pr({ cost_usd: null }));
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("PRRow — findings cell", () => {
  it("renders the per-severity counters when the PR has findings", () => {
    renderRow(pr({ findings_counts: { critical: 2, warning: 2, suggestion: 1 } }));
    expect(screen.getByLabelText("2 critical, 2 warning, 1 suggestion")).toBeInTheDocument();
  });

  it("renders an em dash when the PR has no findings_counts (never reviewed)", () => {
    // cost present (non-dash) so the only "—" on the row is the findings cell.
    renderRow(pr({ findings_counts: null, cost_usd: 0.01 }));
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
