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
import whyRiskBriefMessages from "../../../../../../../../messages/en/whyRiskBrief.json";
import { OverviewTab } from "./OverviewTab";
import type { ReviewRecord, RunSummary } from "@devdigest/shared";

afterEach(cleanup);

const PR_ID = "pr-overview-test-1";
const REPO = "acme/payments-api";
const PR_NUMBER = 482;

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

function renderOverview(latestReview: ReviewRecord | null, latestRun: RunSummary | null = null) {
  global.fetch = vi.fn((url: unknown) => {
    const path = typeof url === "string" ? url : String(url);
    if (path.includes("/blast/summary")) {
      return Promise.resolve(jsonResp({ summary: null, cached: false, skipped: "no_key" }));
    }
    if (path.includes("/blast")) {
      return Promise.resolve(jsonResp(EMPTY_BLAST_PAYLOAD));
    }
    if (path.includes("/why-risk-brief")) {
      return Promise.resolve(jsonResp({ status: "not_generated" }));
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
          whyRiskBrief: whyRiskBriefMessages,
        }}
      >
        <OverviewTab
          prBody={null}
          prId={PR_ID}
          repoFullName={REPO}
          latestReview={latestReview}
          latestRun={latestRun}
          prNumber={PR_NUMBER}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Case 1: latestReview with verdict + score → PR SCORE gauge renders
// ---------------------------------------------------------------------------
describe("OverviewTab — PR score badge", () => {
  it("renders the 'PR Brief' section label", async () => {
    renderOverview(REVIEW_WITH_SCORE);
    await waitFor(() =>
      expect(screen.getByText("PR Brief")).toBeInTheDocument(),
    );
  });

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
// Case 1b: latestRun supplies cost/token totals → rendered under the score
// ---------------------------------------------------------------------------
describe("OverviewTab — cost/token stats under the score", () => {
  const RUN: RunSummary = {
    run_id: "run-1",
    agent_id: "agent-1",
    agent_name: "Security Reviewer",
    provider: "openai",
    model: "gpt-4.1",
    status: "done",
    error: null,
    duration_ms: 4200,
    tokens_in: 8200,
    tokens_out: 1300,
    findings_count: 6,
    grounding: null,
    ran_at: "2024-01-01T00:00:00Z",
    score: 61,
    blockers: 2,
    cost_usd: 0.014,
    findings_counts: null,
    source: "local",
  };

  it("renders the run's cost and token flow under the PR score", async () => {
    renderOverview(REVIEW_WITH_SCORE, RUN);
    await waitFor(() => expect(screen.getByText("$0.014")).toBeInTheDocument());
    expect(screen.getByText("8.2K→1.3K")).toBeInTheDocument();
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

// ---------------------------------------------------------------------------
// Case 3: with a review present + brief not_generated, the header falls back
// to the review's own summary (AC-2 fallback) and the ReviewFocus slot shows
// the unified "No brief yet" empty state (AC-19).
// ---------------------------------------------------------------------------
describe("OverviewTab — brief not_generated: header fallback + empty state", () => {
  it("shows the review's own summary in the header and the No-brief-yet empty state", async () => {
    renderOverview(REVIEW_WITH_SCORE);
    await waitFor(() =>
      expect(screen.getByText("Overall the PR looks acceptable.")).toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.getByText("No brief yet")).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Case 4: a ready brief that is stale + docs_truncated renders the brief
// what/why as the header prose plus the stale badge and docs-truncated note
// (AC-2/AC-21/AC-31).
// ---------------------------------------------------------------------------
describe("OverviewTab — ready brief: header what/why + stale + docs-truncated", () => {
  function renderOverviewWithReadyBrief(latestReview: ReviewRecord | null) {
    global.fetch = vi.fn((url: unknown) => {
      const path = typeof url === "string" ? url : String(url);
      if (path.includes("/blast/summary")) {
        return Promise.resolve(jsonResp({ summary: null, cached: false, skipped: "no_key" }));
      }
      if (path.includes("/blast")) {
        return Promise.resolve(jsonResp(EMPTY_BLAST_PAYLOAD));
      }
      if (path.includes("/why-risk-brief")) {
        return Promise.resolve(
          jsonResp({
            status: "ready",
            brief: {
              what: "Adds rate limiting to public endpoints.",
              why: "Prevents abuse of the checkout API.",
              risk_level: "low",
              risks: [],
              review_focus: [],
            },
            stale: true,
            docs_truncated: true,
            generated_at: "2024-01-01T00:00:00Z",
          }),
        );
      }
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
            whyRiskBrief: whyRiskBriefMessages,
          }}
        >
          <OverviewTab
            prBody={null}
            prId={PR_ID}
            repoFullName={REPO}
            latestReview={latestReview}
            latestRun={null}
            prNumber={PR_NUMBER}
          />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
  }

  it("renders the brief what/why, the stale badge, and the docs-truncated note", async () => {
    renderOverviewWithReadyBrief(REVIEW_WITH_SCORE);
    await waitFor(() =>
      expect(screen.getByText("Adds rate limiting to public endpoints.")).toBeInTheDocument(),
    );
    expect(screen.getByText("Prevents abuse of the checkout API.")).toBeInTheDocument();
    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(
      screen.getByText("Some context docs were left out of this brief (over budget)."),
    ).toBeInTheDocument();
    // The review's own summary is replaced, not shown alongside the brief.
    expect(screen.queryByText("Overall the PR looks acceptable.")).toBeNull();
  });
});
