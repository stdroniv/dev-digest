/**
 * IntentCard — RTL tests (plan D2/D4 acceptance criteria).
 *
 * Acceptance:
 * - Renders summary + in/out-of-scope when intent is present.
 * - Shows empty state when no intent is stored.
 * - Clicking Recalculate fires the mutation.
 *
 * P3 note: IntentCard now mounts RiskAreas (→ useRisks → GET /pulls/:id/risks).
 * All fetch mocks branch by URL so /risks → null and /intent → fixture, preventing
 * the intent fixture from being fed to useRisks (shape mismatch).
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import briefMessages from "../../../../../../../../messages/en/brief.json";
import { IntentCard } from "./IntentCard";

afterEach(cleanup);

const PR_ID = "pr-uuid-1234";
const REPO = "acme/payments-api";
const PR_NUMBER = 482;

const INTENT = {
  intent: "Add rate limiting to public API endpoints.",
  in_scope: ["Rate limiting on /api routes", "Redis-backed counter"],
  out_of_scope: ["Auth changes", "Database schema migration"],
};

function jsonRespFor(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Build a URL-branching fetch mock: /risks → null (no chips), /intent → intentBody.
 * IntentCard now also mounts RiskAreas (→ useRisks → GET /pulls/:id/risks), so the
 * mock must dispatch by URL to avoid feeding the intent fixture to useRisks.
 */
function buildFetchMock(intentBody: unknown): (_url?: unknown) => Promise<Response> {
  return (_url?: unknown) => {
    const path = typeof _url === "string" ? _url : String(_url ?? "");
    if (path.includes("/risks")) return Promise.resolve(jsonRespFor(null));
    return Promise.resolve(jsonRespFor(intentBody));
  };
}

/** Wrap with both providers needed by IntentCard. */
function renderCard(prId: string | null, fetchImpl: (_url?: unknown) => Promise<Response>) {
  global.fetch = vi.fn(fetchImpl) as unknown as typeof fetch;
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
        <IntentCard prId={prId} repoFullName={REPO} prNumber={PR_NUMBER} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("IntentCard — with intent data", () => {
  it("renders the summary text", async () => {
    renderCard(PR_ID, buildFetchMock(INTENT));
    await waitFor(() =>
      // Substring regex — robust to the curly-quote wrapper added by Phase 5a
      expect(screen.getByText(/Add rate limiting to public API endpoints\./)).toBeInTheDocument(),
    );
  });

  it("renders in-scope items", async () => {
    renderCard(PR_ID, buildFetchMock(INTENT));
    await waitFor(() => {
      expect(screen.getByText("Rate limiting on /api routes")).toBeInTheDocument();
      expect(screen.getByText("Redis-backed counter")).toBeInTheDocument();
    });
  });

  it("renders out-of-scope items", async () => {
    renderCard(PR_ID, buildFetchMock(INTENT));
    await waitFor(() => {
      expect(screen.getByText("Auth changes")).toBeInTheDocument();
      expect(screen.getByText("Database schema migration")).toBeInTheDocument();
    });
  });

  it("shows the Recalculate button", async () => {
    renderCard(PR_ID, buildFetchMock(INTENT));
    await waitFor(() =>
      expect(screen.getByText("Recalculate")).toBeInTheDocument(),
    );
  });
});

describe("IntentCard — empty state (no intent)", () => {
  it("shows the empty state message when intent is null", async () => {
    renderCard(PR_ID, buildFetchMock(null));
    await waitFor(() =>
      expect(
        screen.getByText(/No intent computed/i),
      ).toBeInTheDocument(),
    );
  });

  it("shows the Recalculate button in empty state", async () => {
    renderCard(PR_ID, buildFetchMock(null));
    await waitFor(() =>
      expect(screen.getByText("Recalculate")).toBeInTheDocument(),
    );
  });
});

describe("IntentCard — recalculate mutation", () => {
  it("clicking Recalculate fires a POST mutation", async () => {
    let intentCallCount = 0;
    renderCard(PR_ID, (_url?: unknown) => {
      const path = typeof _url === "string" ? _url : String(_url ?? "");
      if (path.includes("/risks")) return Promise.resolve(jsonRespFor(null));
      // intent calls: first GET → null, POST recalculate → INTENT
      intentCallCount++;
      if (intentCallCount === 1) return Promise.resolve(jsonRespFor(null));
      return Promise.resolve(jsonRespFor(INTENT));
    });

    // Wait for empty state
    await waitFor(() => screen.getByText("Recalculate"));

    // Click the button
    fireEvent.click(screen.getByText("Recalculate"));

    // A POST to /pulls/<id>/intent should have been made
    await waitFor(() => expect(intentCallCount).toBeGreaterThan(1));
  });
});
