/**
 * FindingsPopover — the hover card listing a PR's findings. Header shows the
 * authoritative total; each row shows severity + title + category + file:line +
 * confidence + a plain-text rationale preview (markdown stripped, clamped).
 */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../messages/en/prReview.json";
import { FindingsPopover } from "./FindingsPopover";

afterEach(cleanup);

function finding(o: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    severity: "CRITICAL",
    category: "security",
    title: o.id,
    file: "src/config.ts",
    start_line: 12,
    end_line: 12,
    rationale: "plain rationale",
    suggestion: null,
    confidence: 0.98,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "rev",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

function renderPopover(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPopover", () => {
  it("renders the total header and a row per finding (title, file:line, confidence)", () => {
    renderPopover(
      <FindingsPopover
        total={2}
        findings={[
          finding({ id: "Hardcoded Stripe secret key in commit", file: "src/config.ts", start_line: 12, end_line: 12, confidence: 0.98 }),
          finding({ id: "N+1 query in user list endpoint", severity: "WARNING", category: "perf", file: "src/api/users.ts", start_line: 45, end_line: 52, confidence: 0.86 }),
        ]}
      />,
    );
    expect(screen.getByText("2 findings")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded Stripe secret key in commit")).toBeInTheDocument();
    expect(screen.getByText("src/config.ts:12")).toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts:45-52")).toBeInTheDocument();
    expect(screen.getByText("98% conf")).toBeInTheDocument();
  });

  it("strips markdown from the rationale preview", () => {
    renderPopover(
      <FindingsPopover total={1} findings={[finding({ id: "f", rationale: "A **live** `sk_live_` key is committed." })]} />,
    );
    expect(screen.getByText("A live sk_live_ key is committed.")).toBeInTheDocument();
  });

  it("uses a custom headerLabel when provided (Agent-runs 'in this run' variant)", () => {
    renderPopover(
      <FindingsPopover total={2} headerLabel="2 findings in this run" findings={[finding({ id: "f" })]} />,
    );
    expect(screen.getByText("2 findings in this run")).toBeInTheDocument();
    expect(screen.queryByText("2 findings")).not.toBeInTheDocument();
  });

  it("shows a loading line while details are still fetching", () => {
    renderPopover(<FindingsPopover total={3} findings={[]} loading />);
    expect(screen.getByText("Loading findings…")).toBeInTheDocument();
  });

  it("caps the visible rows and shows a '+N more' note", () => {
    const many = Array.from({ length: 9 }, (_, i) => finding({ id: `f${i}` }));
    renderPopover(<FindingsPopover total={9} findings={many} />);
    expect(screen.getByText("f0")).toBeInTheDocument();
    expect(screen.queryByText("f6")).not.toBeInTheDocument();
    expect(screen.getByText("+3 more")).toBeInTheDocument();
  });

  it("links the file:line to the PR Files view and the title to the in-app finding", () => {
    renderPopover(
      <FindingsPopover
        total={1}
        findings={[finding({ id: "Hardcoded key", file: "src/config.ts", start_line: 12, end_line: 12 })]}
        findingHref={(f) => `/repos/r1/pulls/482?tab=findings#finding-${f.id}`}
        fileHref={(f) => `https://github.com/acme/payments-api/pull/482/files#diff-abcR${f.start_line}`}
      />,
    );
    const fileLink = screen.getByText("src/config.ts:12").closest("a");
    expect(fileLink).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/pull/482/files#diff-abcR12",
    );
    expect(fileLink).toHaveAttribute("target", "_blank");

    const titleLink = screen.getByText("Hardcoded key").closest("a");
    expect(titleLink).toHaveAttribute("href", "/repos/r1/pulls/482?tab=findings#finding-Hardcoded key");
  });

  it("renders file:line as plain text (no link) when no builders are passed", () => {
    renderPopover(<FindingsPopover total={1} findings={[finding({ id: "f", file: "src/config.ts", start_line: 12, end_line: 12 })]} />);
    expect(screen.getByText("src/config.ts:12").closest("a")).toBeNull();
  });
});
