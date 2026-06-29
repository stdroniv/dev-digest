/**
 * PriorPrs — RTL + Vitest component tests.
 *
 * Acceptance criteria (plan step 14):
 * (a) Collapsed by default — no network call fires on mount and rows are absent.
 * (b) Clicking the header expands, fetches, and renders a row with the PR
 *     number, title, author, merged_at and notes, plus a GitHub link whose
 *     href is https://github.com/<repo>/pull/<number>.
 * (c) Empty `history` → the empty-state message.
 * (d) The count badge reflects `history.length` after expand.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import historyMessages from "../../../../../../../../messages/en/history.json";
import { PriorPrs } from "./PriorPrs";

afterEach(cleanup);

const PR_ID = "pr-history-test-1";
const REPO = "acme/payments-api";

/** Two prior PRs, the first overlapping two files, the second one. */
const HISTORY_DATA = {
  history: [
    {
      pr_number: 101,
      title: "Add rate limiting",
      merged_at: "2026-05-01",
      author: "alice",
      files_overlap: ["src/a.ts", "src/b.ts"],
      notes: "Touched 2 of these files",
    },
    {
      pr_number: 102,
      title: "Fix auth bug",
      merged_at: "2026-04-15",
      author: "bob",
      files_overlap: ["src/a.ts"],
      notes: "Touched 1 of these files",
    },
  ],
};

/** No prior PRs touched the files. */
const EMPTY_HISTORY = { history: [] };

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Render PriorPrs with a controlled fetch mock and return the mock so tests
 * can assert it was (or was not) called.
 */
function renderPanel(payload: unknown, repoFullName: string | null = REPO) {
  const fetchMock = vi.fn((_url?: unknown) => Promise.resolve(jsonResp(payload)));
  global.fetch = fetchMock as unknown as typeof fetch;

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ history: historyMessages }}>
        <PriorPrs prId={PR_ID} repoFullName={repoFullName} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

/** Expand the accordion by clicking its toggle header. */
function expand() {
  fireEvent.click(screen.getByRole("button", { name: /toggle prior prs/i }));
}

// ---------------------------------------------------------------------------
// (a) Collapsed by default — no fetch on mount, no rows
// ---------------------------------------------------------------------------
describe("PriorPrs — collapsed by default", () => {
  it("does not fetch on mount", () => {
    const fetchMock = renderPanel(HISTORY_DATA);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not render PR rows before expand", () => {
    renderPanel(HISTORY_DATA);
    expect(screen.queryByText("#101")).not.toBeInTheDocument();
    // Header title is still shown even while collapsed.
    expect(
      screen.getAllByText("Prior PRs touching these files").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("does not render the count badge before data has loaded", () => {
    renderPanel(HISTORY_DATA);
    // Count message is "{count}" → a bare number; none should be present yet.
    expect(screen.queryByText("2")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// (b) Expand → fetch → render a row with a working GitHub link
// ---------------------------------------------------------------------------
describe("PriorPrs — expand fetches and renders rows", () => {
  it("fetches once when expanded", async () => {
    const fetchMock = renderPanel(HISTORY_DATA);
    expand();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls.at(0)?.[0] ?? "")).toContain(
      `/pulls/${PR_ID}/prior-prs`,
    );
  });

  it("renders the PR number, title, author, merged date and notes", async () => {
    renderPanel(HISTORY_DATA);
    expand();
    await waitFor(() =>
      expect(screen.getByText("#101")).toBeInTheDocument(),
    );
    expect(screen.getByText("Add rate limiting")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("merged 2026-05-01")).toBeInTheDocument();
    expect(screen.getByText("Touched 2 of these files")).toBeInTheDocument();
    // Second PR also present.
    expect(screen.getByText("#102")).toBeInTheDocument();
  });

  it("links each row to the PR on GitHub", async () => {
    renderPanel(HISTORY_DATA);
    expand();
    await waitFor(() =>
      expect(screen.getByText("#101")).toBeInTheDocument(),
    );
    const link = screen.getByText("#101").closest("a");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe(
      `https://github.com/${REPO}/pull/101`,
    );
    expect(link!.getAttribute("target")).toBe("_blank");
    expect(link!.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders plain text (no link) when repoFullName is missing", async () => {
    renderPanel(HISTORY_DATA, null);
    expand();
    await waitFor(() =>
      expect(screen.getByText("#101")).toBeInTheDocument(),
    );
    expect(screen.getByText("#101").closest("a")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (c) Empty history → empty-state message
// ---------------------------------------------------------------------------
describe("PriorPrs — empty state", () => {
  it("shows the empty-state message when history is empty", async () => {
    renderPanel(EMPTY_HISTORY);
    expand();
    await waitFor(() =>
      expect(
        screen.getByText("No prior merged PRs touched these files."),
      ).toBeInTheDocument(),
    );
  });
});

// ---------------------------------------------------------------------------
// (d) Count badge reflects history.length after expand
// ---------------------------------------------------------------------------
describe("PriorPrs — count badge", () => {
  it("shows the count badge with history.length after expand", async () => {
    renderPanel(HISTORY_DATA);
    expand();
    // Badge text is the bare count ("{count}" message) → "2".
    await waitFor(() => expect(screen.getByText("2")).toBeInTheDocument());
  });

  it("shows a zero count badge when history is empty", async () => {
    renderPanel(EMPTY_HISTORY);
    expand();
    await waitFor(() => expect(screen.getByText("0")).toBeInTheDocument());
  });
});
