/**
 * BlastGraph — RTL + Vitest component tests.
 *
 * Acceptance criteria:
 * - Renders an svg[aria-label] when callers are present.
 * - Shows the empty-graph message when symbols have no callers.
 */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import blastMessages from "../../../../../../../../messages/en/blast.json";
import { BlastGraph } from "./BlastGraph";
import type { BlastSymbolGroup } from "@/lib/types";

afterEach(cleanup);

const REPO = "acme/payments-api";
const SHA = "abc1234def5678901234567890123456789012ab";

const SYMBOLS_WITH_CALLERS: BlastSymbolGroup[] = [
  {
    file: "src/utils/rateLimit.ts",
    name: "checkRateLimit",
    kind: "function",
    callers: [
      { file: "src/routes/auth.ts", symbol: "loginHandler", line: 42, rank: 2 },
    ],
    endpoints: ["POST /auth/login"],
    crons: [],
  },
];

const SYMBOLS_NO_CALLERS: BlastSymbolGroup[] = [
  {
    file: "src/utils/rateLimit.ts",
    name: "checkRateLimit",
    kind: "function",
    callers: [],
    endpoints: [],
    crons: [],
  },
];

function renderGraph(symbols: BlastSymbolGroup[], sha: string | null = SHA) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: blastMessages }}>
      <BlastGraph symbols={symbols} repoFullName={REPO} indexedSha={sha} />
    </NextIntlClientProvider>,
  );
}

describe("BlastGraph — with callers", () => {
  it("renders an svg element with the correct aria-label", () => {
    renderGraph(SYMBOLS_WITH_CALLERS);
    const svg = document.querySelector("svg[aria-label]");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("aria-label")).toBe("Blast radius graph");
  });

  it("renders a caller node with a link to the blob URL at indexed SHA", () => {
    renderGraph(SYMBOLS_WITH_CALLERS);
    const link = document.querySelector(`a[href*="${SHA}"]`);
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toContain(
      `https://github.com/${REPO}/blob/${SHA}/src/routes/auth.ts`,
    );
  });

  it("renders a caller node without a link when indexedSha is null", () => {
    renderGraph(SYMBOLS_WITH_CALLERS, null);
    const link = document.querySelector("a[href]");
    expect(link).toBeNull();
  });
});

describe("BlastGraph — empty (no callers)", () => {
  it("shows the empty-graph message when there are no callers", () => {
    renderGraph(SYMBOLS_NO_CALLERS);
    expect(
      screen.getByText("No downstream callers to graph."),
    ).toBeInTheDocument();
  });

  it("does NOT render an svg when empty", () => {
    renderGraph(SYMBOLS_NO_CALLERS);
    const svg = document.querySelector("svg");
    expect(svg).toBeNull();
  });
});
