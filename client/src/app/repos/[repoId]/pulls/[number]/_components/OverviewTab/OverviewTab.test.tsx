/**
 * OverviewTab — RTL + Vitest tests for the VerdictBanner score badge wiring.
 *
 * Acceptance criteria (step 11):
 * - When latestReview has a verdict + score, "PR SCORE" and the numeric score render.
 * - When latestReview is null, neither "PR SCORE" nor the score renders.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import briefMessages from "../../../../../../../../messages/en/brief.json";
import blastMessages from "../../../../../../../../messages/en/blast.json";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import historyMessages from "../../../../../../../../messages/en/history.json";
import { OverviewTab } from "./OverviewTab";
import type { ReviewRecord } from "@devdigest/shared";

afterEach(cleanup);

const PR_ID = "pr-overview-test-1";
const REPO = "acme/payments-api";

/** Minimal ReviewRecord with verdict + score. */
const REVIEW_WITH_SCORE: ReviewRecord = {
  id: "rev-1",
  pr_id: PR_ID,
  agent_id: "agent-1",
  run_id: "run-1",
  agent_name: "Security Reviewer",
  kind: "review",
  verdict: "comment",
  summary: "Overall the PR looks acceptable.",
  score: 61,
  model: null,
  grounding: null,
  created_at: "2024-01-01T00:00:00Z",
  findings: [],
};

const EMPTY_BLAST_PAYLOAD = {
  symbols: [],
  totals: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
  impactedEndpoints: [],
  impactedCrons: [],
  index: { status: "full", degraded: false, lastIndexedSha: null },
  degraded: false,
};

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderOverview(latestReview: ReviewRecord | null) {
  global.fetch = vi.fn((url: unknown) => {
    const path = typeof url === "string" ? url : String(url);
    if (path.includes("/blast/summary")) {
      return Promise.resolve(jsonResp({ summary: null, cached: false, skipped: "no_key" }));
    }
    if (path.includes("/blast")) {
      return Promise.resolve(jsonResp(EMPTY_BLAST_PAYLOAD));
    }
    // intent, risks, and any other sub-resource → null body (cards show empty state)
    return Promise.resolve(jsonResp(null));
  }) as unknown as typeof fetch;

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{
          brief: briefMessages,
          blast: blastMessages,
          prReview: prReviewMessages,
          history: historyMessages,
        }}
      >
        <OverviewTab
          prBody={null}
          prId={PR_ID}
          repoFullName={REPO}
          latestReview={latestReview}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Case 1: latestReview with verdict + score → PR SCORE gauge renders
// ---------------------------------------------------------------------------
describe("OverviewTab — PR score badge", () => {
  it("renders 'PR SCORE' label when latestReview has a verdict", async () => {
    renderOverview(REVIEW_WITH_SCORE);
    await waitFor(() =>
      expect(screen.getByText("PR SCORE")).toBeInTheDocument(),
    );
  });

  it("renders the numeric score (61) when latestReview.score is set", async () => {
    renderOverview(REVIEW_WITH_SCORE);
    await waitFor(() =>
      // The CircularScore renders the score; there may be duplicates (gauge + label).
      expect(screen.getAllByText("61").length).toBeGreaterThanOrEqual(1),
    );
  });
});

// ---------------------------------------------------------------------------
// Case 2: latestReview === null → no PR SCORE
// ---------------------------------------------------------------------------
describe("OverviewTab — no score when latestReview is null", () => {
  it("does NOT render 'PR SCORE' when latestReview is null", async () => {
    renderOverview(null);
    // Give the component time to settle (child cards resolve their empty states)
    await waitFor(() =>
      expect(screen.queryByText("No impacted symbols found for this PR.")).toBeInTheDocument(),
    );
    expect(screen.queryByText("PR SCORE")).toBeNull();
  });
});
