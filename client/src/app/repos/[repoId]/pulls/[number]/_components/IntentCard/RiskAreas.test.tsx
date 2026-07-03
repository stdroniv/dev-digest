/**
 * RiskAreas — RTL + Vitest tests for the co-located section component.
 *
 * Acceptance:
 * - Risk titles are always visible.
 * - `file_refs` render as always-visible clickable links (anchors with an
 *   href) — no click required (AC-8).
 * - The `explanation` is reachable as the title element's title/aria-label
 *   (hover affordance), not hidden behind a click reveal.
 * - When `repoFullName` is missing, refs render as inert mono text.
 * - null / empty-array responses render nothing (component returns null).
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import briefMessages from "../../../../../../../../messages/en/brief.json";
import { RiskAreas } from "./RiskAreas";

afterEach(cleanup);

const PR_ID = "pr-uuid-risk-areas-1";
const REPO = "acme/payments-api";
const PR_NUMBER = 482;

/** Minimal Risks fixture matching the shared `Risks` contract. */
const RISKS = {
  risks: [
    {
      kind: "security",
      title: "SQL injection in user query",
      explanation:
        "User input is concatenated directly into the SQL query without sanitization.",
      severity: "high",
      file_refs: ["src/db/queries.ts:42"],
    },
  ],
};

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderRiskAreas(
  risksBody: unknown,
  props: { repoFullName: string | null | undefined; prNumber: number } = {
    repoFullName: REPO,
    prNumber: PR_NUMBER,
  },
) {
  global.fetch = vi.fn((_url?: unknown) => {
    return Promise.resolve(jsonResp(risksBody));
  }) as unknown as typeof fetch;

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
        <RiskAreas prId={PR_ID} repoFullName={props.repoFullName} prNumber={props.prNumber} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Risk titles always visible
// ---------------------------------------------------------------------------
describe("RiskAreas — titles always visible", () => {
  it("renders the risk title with no click", async () => {
    renderRiskAreas(RISKS);
    await waitFor(() =>
      expect(screen.getByText("SQL injection in user query")).toBeInTheDocument(),
    );
  });
});

// ---------------------------------------------------------------------------
// file_refs render as always-visible clickable links (AC-8)
// ---------------------------------------------------------------------------
describe("RiskAreas — always-visible clickable file_refs", () => {
  it("renders the ref as an anchor with a non-empty href containing /pull/{n}/files, with no click", async () => {
    renderRiskAreas(RISKS);
    const link = await waitFor(() => screen.getByText("src/db/queries.ts:42"));
    expect(link.closest("a")).not.toBeNull();
    const href = link.closest("a")?.getAttribute("href") ?? "";
    expect(href).toContain(`/pull/${PR_NUMBER}/files`);
  });

  it("has no aria-expanded toggle button (no click-accordion)", async () => {
    renderRiskAreas(RISKS);
    await waitFor(() =>
      expect(screen.getByText("SQL injection in user query")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /SQL injection/i })).toBeNull();
    expect(document.querySelector("[aria-expanded]")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Explanation is a hover tooltip (title/aria-label), not hidden until click
// ---------------------------------------------------------------------------
describe("RiskAreas — explanation is a hover tooltip", () => {
  it("exposes the explanation via the title element's title/aria-label", async () => {
    renderRiskAreas(RISKS);
    const titleEl = await waitFor(() =>
      screen.getByText("SQL injection in user query").parentElement,
    );
    expect(titleEl).toHaveAttribute(
      "title",
      "User input is concatenated directly into the SQL query without sanitization.",
    );
    expect(titleEl).toHaveAttribute(
      "aria-label",
      "User input is concatenated directly into the SQL query without sanitization.",
    );
  });
});

// ---------------------------------------------------------------------------
// repoFullName absent → inert text, no href
// ---------------------------------------------------------------------------
describe("RiskAreas — repo-absent fallback", () => {
  it("renders the ref as inert text (no href) when repoFullName is null", async () => {
    renderRiskAreas(RISKS, { repoFullName: null, prNumber: PR_NUMBER });
    const ref = await waitFor(() => screen.getByText("src/db/queries.ts:42"));
    expect(ref.closest("a")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Null response → component renders nothing
// ---------------------------------------------------------------------------
describe("RiskAreas — null response", () => {
  it("renders nothing when the server returns null", async () => {
    renderRiskAreas(null);
    // waitFor flushes the pending query state update inside act() so the
    // absence assertion is checked after the component has settled.
    await waitFor(() =>
      expect(screen.queryByText("Risk Areas")).toBeNull(),
    );
  });
});

// ---------------------------------------------------------------------------
// Empty array response → component renders nothing
// ---------------------------------------------------------------------------
describe("RiskAreas — empty risks array", () => {
  it("renders nothing when the risks array is empty", async () => {
    renderRiskAreas({ risks: [] });
    await waitFor(() =>
      expect(screen.queryByText("Risk Areas")).toBeNull(),
    );
  });
});
