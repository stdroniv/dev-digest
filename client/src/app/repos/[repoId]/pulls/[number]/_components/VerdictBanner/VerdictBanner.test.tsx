import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";
import whyRiskBriefMessages from "../../../../../../../../messages/en/whyRiskBrief.json";
import { VerdictBanner } from "./VerdictBanner";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ prReview: messages, whyRiskBrief: whyRiskBriefMessages }}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("VerdictBanner (smoke)", () => {
  it("shows verdict label + score + finding/blocker counts", () => {
    renderWithIntl(
      <VerdictBanner
        verdict="request_changes"
        summary="Hardcoded secret introduced."
        score={42}
        findingsCount={1}
        blockers={1}
        agentName="Security Reviewer"
      />,
    );
    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText(/1 findings · 1 blockers/)).toBeInTheDocument();
  });

  it("renders cost + token stats under the score when provided", () => {
    renderWithIntl(
      <VerdictBanner
        verdict="request_changes"
        summary={null}
        score={61}
        findingsCount={6}
        blockers={2}
        costUsd={0.014}
        tokensIn={8200}
        tokensOut={1300}
      />,
    );
    expect(screen.getByText("$0.014")).toBeInTheDocument();
    expect(screen.getByText("8.2K→1.3K")).toBeInTheDocument();
  });

  it("omits the cost/token line when neither is provided", () => {
    renderWithIntl(
      <VerdictBanner
        verdict="approve"
        summary={null}
        score={90}
        findingsCount={0}
        blockers={0}
      />,
    );
    expect(screen.queryByText(/→/)).toBeNull();
    expect(screen.queryByText(/^\$/)).toBeNull();
  });

  it("with brief present: renders what/why and does NOT render the review summary (AC-2)", () => {
    renderWithIntl(
      <VerdictBanner
        verdict="comment"
        summary="OLD"
        score={50}
        findingsCount={0}
        blockers={0}
        brief={{ what: "W", why: "Y", stale: false, docsTruncated: false }}
      />,
    );
    expect(screen.getByText("W")).toBeInTheDocument();
    expect(screen.getByText("Y")).toBeInTheDocument();
    expect(screen.queryByText("OLD")).toBeNull();
  });

  it("with brief.stale=true: renders the stale badge (AC-21)", () => {
    renderWithIntl(
      <VerdictBanner
        verdict="comment"
        summary={null}
        score={50}
        findingsCount={0}
        blockers={0}
        brief={{ what: "W", why: "Y", stale: true, docsTruncated: false }}
      />,
    );
    expect(screen.getByText("Stale")).toBeInTheDocument();
  });

  it("with brief.docsTruncated=true: renders the docs-truncated note (AC-31)", () => {
    renderWithIntl(
      <VerdictBanner
        verdict="comment"
        summary={null}
        score={50}
        findingsCount={0}
        blockers={0}
        brief={{ what: "W", why: "Y", stale: false, docsTruncated: true }}
      />,
    );
    expect(
      screen.getByText("Some context docs were left out of this brief (over budget)."),
    ).toBeInTheDocument();
  });

  it("with no brief: falls back to the review's own summary", () => {
    renderWithIntl(
      <VerdictBanner
        verdict="comment"
        summary="OLD"
        score={50}
        findingsCount={0}
        blockers={0}
      />,
    );
    expect(screen.getByText("OLD")).toBeInTheDocument();
  });

  it("with a ready brief + onRegenerate: renders the regenerate button and calls it on click", () => {
    const onRegenerate = vi.fn();
    renderWithIntl(
      <VerdictBanner
        verdict="comment"
        summary={null}
        score={50}
        findingsCount={0}
        blockers={0}
        brief={{ what: "W", why: "Y", stale: false, docsTruncated: false }}
        onRegenerate={onRegenerate}
      />,
    );
    const btn = screen.getByRole("button", { name: "Regenerate brief" });
    fireEvent.click(btn);
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it("does NOT render the regenerate button when there is no brief (only-when-ready)", () => {
    renderWithIntl(
      <VerdictBanner
        verdict="comment"
        summary="OLD"
        score={50}
        findingsCount={0}
        blockers={0}
        onRegenerate={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /Regenerate/i })).toBeNull();
  });

  it("while regenerating: the button is disabled and shows the regenerating label", () => {
    const onRegenerate = vi.fn();
    renderWithIntl(
      <VerdictBanner
        verdict="comment"
        summary={null}
        score={50}
        findingsCount={0}
        blockers={0}
        brief={{ what: "W", why: "Y", stale: false, docsTruncated: false }}
        onRegenerate={onRegenerate}
        regenerating
      />,
    );
    const btn = screen.getByRole("button", { name: "Regenerating…" });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onRegenerate).not.toHaveBeenCalled();
  });
});
