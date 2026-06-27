/**
 * RisksCard — RTL tests.
 *
 * Acceptance:
 * - Renders severity badge, title, explanation, and file ref when risks are present.
 * - Shows empty state when the server returns null (no risks computed yet).
 * - Shows empty state when the server returns an empty risks array.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import briefMessages from "../../../../../../../../messages/en/brief.json";
import { RisksCard } from "./RisksCard";

afterEach(cleanup);

const PR_ID = "pr-uuid-risks-1";

/** A minimal Risk fixture matching the shared `Risks` contract. */
const RISKS = {
  risks: [
    {
      kind: "security",
      title: "SQL injection in user query",
      explanation:
        "User input is concatenated directly into the SQL query without sanitization.",
      severity: "high",
      file_refs: ["src/db/queries.ts"],
    },
  ],
};

/** Wrap with both providers needed by RisksCard. */
function renderCard(prId: string | null, fetchImpl: () => Promise<Response>) {
  global.fetch = vi.fn(fetchImpl) as unknown as typeof fetch;
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
        <RisksCard prId={prId} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("RisksCard — with risks data", () => {
  it("renders the risk title", async () => {
    renderCard(PR_ID, () => Promise.resolve(jsonResp(RISKS)));
    await waitFor(() =>
      expect(
        screen.getByText("SQL injection in user query"),
      ).toBeInTheDocument(),
    );
  });

  it("renders the risk explanation", async () => {
    renderCard(PR_ID, () => Promise.resolve(jsonResp(RISKS)));
    await waitFor(() =>
      expect(
        screen.getByText(
          "User input is concatenated directly into the SQL query without sanitization.",
        ),
      ).toBeInTheDocument(),
    );
  });

  it("renders the severity label for a high-severity risk", async () => {
    renderCard(PR_ID, () => Promise.resolve(jsonResp(RISKS)));
    await waitFor(() =>
      expect(screen.getByText("High")).toBeInTheDocument(),
    );
  });

  it("renders the file reference chip", async () => {
    renderCard(PR_ID, () => Promise.resolve(jsonResp(RISKS)));
    await waitFor(() =>
      expect(screen.getByText("src/db/queries.ts")).toBeInTheDocument(),
    );
  });
});

describe("RisksCard — empty state (null response)", () => {
  it("shows the noRisks empty state when the server returns null", async () => {
    renderCard(PR_ID, () => Promise.resolve(jsonResp(null)));
    await waitFor(() =>
      expect(
        screen.getByText("No notable risks flagged."),
      ).toBeInTheDocument(),
    );
  });
});

describe("RisksCard — empty state (empty risks array)", () => {
  it("shows the noRisks empty state when the risks array is empty", async () => {
    renderCard(PR_ID, () => Promise.resolve(jsonResp({ risks: [] })));
    await waitFor(() =>
      expect(
        screen.getByText("No notable risks flagged."),
      ).toBeInTheDocument(),
    );
  });
});
