/**
 * ReviewFocus — RTL + Vitest tests for the "Review focus — read these first" section.
 *
 * Acceptance:
 * - `status:"ready"` renders the count badge = MOCK_REVIEW_FOCUS.length and each mock
 *   item as an `<a href>` (MonoLink) with visible `path:line — reason` text (AC-4/5).
 * - `status:"not_generated"` renders the "No brief yet" heading + an enabled primary
 *   "Generate brief" button that, on click, calls `generate.mutate` (spied) and does
 *   NOT auto-POST on mount (AC-18/14).
 * - `status:"not_available"` renders the empty state with NO enabled Generate action
 *   + the intent hint (AC-25).
 * - `status:"skipped"` shows the no-model reason (AC-27).
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { WhyRiskBriefState } from "@devdigest/shared";
import whyRiskBriefMessages from "../../../../../../../../messages/en/whyRiskBrief.json";

const mutate = vi.fn();
vi.mock("@/lib/hooks/brief", () => ({
  useGenerateWhyRiskBrief: () => ({ mutate, isPending: false }),
}));

import { ReviewFocus } from "./ReviewFocus";

afterEach(() => {
  cleanup();
  mutate.mockReset();
});

const PR_ID = "pr-uuid-review-focus-1";
const REPO = "acme/payments-api";
const PR_NUMBER = 482;

const READY_STATE: WhyRiskBriefState = {
  status: "ready",
  brief: { what: "W", why: "Y", risk_level: "low", risks: [], review_focus: [] },
  stale: false,
  docs_truncated: false,
  generated_at: "2024-01-01T00:00:00Z",
};

function renderReviewFocus(state: WhyRiskBriefState | undefined, isLoading = false) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ whyRiskBrief: whyRiskBriefMessages }}>
      <ReviewFocus
        state={state}
        isLoading={isLoading}
        prId={PR_ID}
        repoFullName={REPO}
        prNumber={PR_NUMBER}
      />
    </NextIntlClientProvider>,
  );
}

describe("ReviewFocus — ready", () => {
  it("renders the count badge and each mock item as a MonoLink with path:line — reason", () => {
    renderReviewFocus(READY_STATE);
    expect(screen.getByText("3 files")).toBeInTheDocument();

    const link = screen.getByText("src/modules/billing/service.ts:128");
    const anchor = link.closest("a");
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toContain(`/pull/${PR_NUMBER}/files`);
    expect(
      screen.getByText(/Core retry logic — the change's central behavior\./),
    ).toBeInTheDocument();
  });
});

describe("ReviewFocus — not_generated", () => {
  it("renders the No brief yet empty state with an enabled primary Generate brief button", () => {
    renderReviewFocus({ status: "not_generated" });
    expect(screen.getByText("No brief yet")).toBeInTheDocument();
    expect(screen.getByText("Generate a Why+Risk brief for this PR.")).toBeInTheDocument();

    const button = screen.getByRole("button", { name: "Generate brief" });
    expect(button).not.toBeDisabled();
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.click(button);
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});

describe("ReviewFocus — not_available", () => {
  it("renders the empty state with no enabled Generate action and the intent hint", () => {
    renderReviewFocus({ status: "not_available" });
    expect(screen.getByText("No brief yet")).toBeInTheDocument();
    expect(
      screen.getByText("Compute intent first to generate a Why+Risk brief."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generate brief/i })).toBeNull();
  });
});

describe("ReviewFocus — skipped", () => {
  it("shows the no-model reason with no enabled Generate action", () => {
    renderReviewFocus({ status: "skipped", reason: "no_model" });
    expect(
      screen.getByText("Skipped — no model configured for this feature."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generate brief/i })).toBeNull();
  });
});

describe("ReviewFocus — loading", () => {
  it("renders a stable-height skeleton and no content", () => {
    renderReviewFocus(undefined, true);
    expect(screen.queryByText("No brief yet")).toBeNull();
    expect(screen.queryByText(/files$/)).toBeNull();
  });
});
