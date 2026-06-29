/**
 * RiskAreas — RTL + Vitest tests for the co-located chip component.
 *
 * Acceptance:
 * - Chips render the risk titles.
 * - The explanation is NOT in the DOM until expanded.
 * - fireEvent.click on a chip reveals the explanation and file_refs.
 * - fireEvent.mouseEnter on a chip reveals the explanation (hover path).
 * - The chip carries aria-expanded="false" initially and "true" after click.
 * - null / empty-array responses render nothing (component returns null).
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import briefMessages from "../../../../../../../../messages/en/brief.json";
import { RiskAreas } from "./RiskAreas";

afterEach(cleanup);

const PR_ID = "pr-uuid-risk-areas-1";

/** Minimal Risks fixture matching the shared `Risks` contract. */
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

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderRiskAreas(risksBody: unknown) {
  global.fetch = vi.fn((_url?: unknown) => {
    return Promise.resolve(jsonResp(risksBody));
  }) as unknown as typeof fetch;

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
        <RiskAreas prId={PR_ID} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Chips render risk titles
// ---------------------------------------------------------------------------
describe("RiskAreas — chips render titles", () => {
  it("renders the chip button with the risk title", async () => {
    renderRiskAreas(RISKS);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /SQL injection in user query/i }),
      ).toBeInTheDocument(),
    );
  });
});

// ---------------------------------------------------------------------------
// Explanation hidden until expanded
// ---------------------------------------------------------------------------
describe("RiskAreas — explanation hidden until expanded", () => {
  it("does NOT show the explanation before clicking the chip", async () => {
    renderRiskAreas(RISKS);
    // Wait for chip to appear
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /SQL injection/i }),
      ).toBeInTheDocument(),
    );
    // Explanation must be absent (not expanded)
    expect(
      screen.queryByText(/concatenated directly/),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Click reveals explanation + file_refs
// ---------------------------------------------------------------------------
describe("RiskAreas — click to expand", () => {
  it("clicking the chip reveals the explanation and file_refs", async () => {
    renderRiskAreas(RISKS);
    const chip = await waitFor(() =>
      screen.getByRole("button", { name: /SQL injection/i }),
    );

    fireEvent.click(chip);

    await waitFor(() =>
      expect(
        screen.getByText(
          "User input is concatenated directly into the SQL query without sanitization.",
        ),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("src/db/queries.ts")).toBeInTheDocument();
  });

  it("chip aria-expanded is false initially and true after click", async () => {
    renderRiskAreas(RISKS);
    const chip = await waitFor(() =>
      screen.getByRole("button", { name: /SQL injection/i }),
    );

    expect(chip).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-expanded", "true");
  });
});

// ---------------------------------------------------------------------------
// Hover reveals explanation
// ---------------------------------------------------------------------------
describe("RiskAreas — hover to reveal", () => {
  it("mouseEnter on the chip reveals the explanation", async () => {
    renderRiskAreas(RISKS);
    const chip = await waitFor(() =>
      screen.getByRole("button", { name: /SQL injection/i }),
    );

    fireEvent.mouseEnter(chip);

    await waitFor(() =>
      expect(
        screen.getByText(
          "User input is concatenated directly into the SQL query without sanitization.",
        ),
      ).toBeInTheDocument(),
    );
  });
});

// ---------------------------------------------------------------------------
// Null response → component renders nothing
// ---------------------------------------------------------------------------
describe("RiskAreas — null response", () => {
  it("renders nothing when the server returns null", async () => {
    renderRiskAreas(null);
    // Give time for the query to settle
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(screen.queryByText("Risk Areas")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Empty array response → component renders nothing
// ---------------------------------------------------------------------------
describe("RiskAreas — empty risks array", () => {
  it("renders nothing when the risks array is empty", async () => {
    renderRiskAreas({ risks: [] });
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(screen.queryByText("Risk Areas")).toBeNull();
  });
});
