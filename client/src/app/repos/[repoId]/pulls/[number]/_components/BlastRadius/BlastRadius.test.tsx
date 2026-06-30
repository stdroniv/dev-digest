/**
 * BlastRadius — RTL + Vitest component tests.
 *
 * Acceptance criteria:
 * (a) Tree renders grouped symbol → callers → endpoint/cron badges with
 *     correct header counts.
 * (b) A caller link href is the blob URL at the indexed SHA with #L{line}.
 * (c) Empty state when totals.symbols === 0.
 * (d) Degraded badge when index.degraded === true.
 * (e) Toggle to Graph renders an svg[aria-label].
 * (f) Summary disclosure stays empty/clean when summary={null, skipped:'no_key'}.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import blastMessages from "../../../../../../../../messages/en/blast.json";
import { BlastRadius } from "./BlastRadius";

afterEach(cleanup);

const PR_ID = "pr-blast-test-1";
const REPO = "acme/payments-api";
const INDEXED_SHA = "abc1234def5678901234567890123456789012ab";

/** Minimal blast response with one symbol, two callers, one endpoint. */
const BLAST_DATA = {
  symbols: [
    {
      file: "src/utils/rateLimit.ts",
      name: "checkRateLimit",
      kind: "function",
      callers: [
        { file: "src/routes/auth.ts", symbol: "loginHandler", line: 42, rank: 2 },
        { file: "src/routes/api.ts", symbol: "apiHandler", line: 17, rank: 1 },
      ],
      endpoints: ["POST /auth/login"],
      crons: [],
    },
  ],
  totals: { symbols: 1, callers: 2, endpoints: 1, crons: 0 },
  impactedEndpoints: ["POST /auth/login"],
  impactedCrons: [],
  index: {
    status: "full" as const,
    degraded: false,
    lastIndexedSha: INDEXED_SHA,
  },
  degraded: false,
  resolution: { limited: false },
};

/** Empty blast response — no symbols. */
const EMPTY_BLAST = {
  symbols: [],
  totals: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
  impactedEndpoints: [],
  impactedCrons: [],
  index: {
    status: "full" as const,
    degraded: false,
    lastIndexedSha: INDEXED_SHA,
  },
  degraded: false,
  resolution: { limited: false },
};

/** Changed symbols present, but no resolved downstream callers. */
const SYMBOLS_NO_CALLERS = {
  symbols: [
    {
      file: "src/email/subject.ts",
      name: "buildSubject",
      kind: "function",
      callers: [],
      endpoints: [],
      crons: [],
    },
    {
      file: "src/email/subject.ts",
      name: "resolveTitle",
      kind: "function",
      callers: [],
      endpoints: [],
      crons: [],
    },
  ],
  totals: { symbols: 2, callers: 0, endpoints: 0, crons: 0 },
  impactedEndpoints: [],
  impactedCrons: [],
  index: {
    status: "full" as const,
    degraded: false,
    lastIndexedSha: INDEXED_SHA,
  },
  degraded: false,
};

/** Degraded blast response. */
const DEGRADED_BLAST = {
  ...BLAST_DATA,
  degraded: true,
  index: { ...BLAST_DATA.index, degraded: true },
};

/** Partial-index response — index.status "partial", degraded false, symbols present, no callers. */
const PARTIAL_BLAST = {
  symbols: [
    {
      file: "src/services/mailer.ts",
      name: "sendWelcomeEmail",
      kind: "function",
      callers: [],
      endpoints: [],
      crons: [],
    },
  ],
  totals: { symbols: 1, callers: 0, endpoints: 0, crons: 0 },
  impactedEndpoints: [],
  impactedCrons: [],
  index: {
    status: "partial" as const,
    degraded: false,
    lastIndexedSha: INDEXED_SHA,
  },
  degraded: false,
};

/** Symbol with an endpoint but zero callers — validates badge renders independent of caller list. */
const ENDPOINT_NO_CALLERS = {
  symbols: [
    {
      file: "src/routes/webhook.ts",
      name: "handleWebhook",
      kind: "function",
      callers: [],
      endpoints: ["POST /x"],
      crons: [],
    },
  ],
  totals: { symbols: 1, callers: 0, endpoints: 1, crons: 0 },
  impactedEndpoints: ["POST /x"],
  impactedCrons: [],
  index: {
    status: "full" as const,
    degraded: false,
    lastIndexedSha: INDEXED_SHA,
  },
  degraded: false,
};

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Render BlastRadius with a controlled fetch mock.
 * `blastFetch` is called for /blast, `summaryFetch` for /blast/summary.
 */
function renderPanel(
  blastPayload: unknown,
  summaryPayload: unknown = { summary: null, cached: false, skipped: "no_key" },
) {
  global.fetch = vi.fn((url: unknown) => {
    const path = typeof url === "string" ? url : String(url);
    if (path.includes("/blast/summary")) {
      return Promise.resolve(jsonResp(summaryPayload));
    }
    return Promise.resolve(jsonResp(blastPayload));
  }) as unknown as typeof fetch;

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ blast: blastMessages }}>
        <BlastRadius prId={PR_ID} repoFullName={REPO} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// (a) Tree renders grouped symbol + callers + header counts
// ---------------------------------------------------------------------------
describe("BlastRadius — tree view with data", () => {
  // Step 10: symbol name now includes "()" for function kind (P3.7 displayName)
  it("renders the symbol name", async () => {
    renderPanel(BLAST_DATA);
    await waitFor(() =>
      expect(screen.getByText("checkRateLimit()")).toBeInTheDocument(),
    );
  });

  // Step 10: kind label dropped (design has none) — assert Code chip renders instead
  it("renders the symbol as a code chip without a kind label", async () => {
    renderPanel(BLAST_DATA);
    await waitFor(() => {
      // Code chip shows function name with parens
      expect(screen.getByText("checkRateLimit()")).toBeInTheDocument();
      // Kind label ("function") is dropped
      expect(screen.queryByText("function")).not.toBeInTheDocument();
    });
  });

  it("renders caller file references", async () => {
    renderPanel(BLAST_DATA);
    await waitFor(() =>
      expect(screen.getByText("src/routes/auth.ts:42")).toBeInTheDocument(),
    );
    expect(screen.getByText("src/routes/api.ts:17")).toBeInTheDocument();
  });

  // Step 10: stat row is now segmented — query each stat item individually.
  // getNodeText reads only DIRECT text nodes so parent containers (which only
  // contain child elements) return "" and do not trigger multiple-match errors.
  it("renders the header stats line containing symbol/caller counts", async () => {
    renderPanel(BLAST_DATA);
    await waitFor(() => {
      expect(screen.getByText(/1 symbols/)).toBeInTheDocument();
      // "2 callers" also appears in the per-symbol count badge → use getAllByText
      expect(screen.getAllByText(/2 callers/).length).toBeGreaterThanOrEqual(1);
    });
  });
});

// ---------------------------------------------------------------------------
// (b) Caller link href = blob URL at indexed SHA with #L{line}
// ---------------------------------------------------------------------------
describe("BlastRadius — caller link URLs", () => {
  it("caller link href is a GitHub blob URL at the indexed SHA", async () => {
    renderPanel(BLAST_DATA);
    await waitFor(() =>
      expect(screen.getByText("src/routes/auth.ts:42")).toBeInTheDocument(),
    );
    const link = screen.getByText("src/routes/auth.ts:42").closest("a");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe(
      `https://github.com/${REPO}/blob/${INDEXED_SHA}/src/routes/auth.ts#L42`,
    );
    expect(link!.getAttribute("target")).toBe("_blank");
  });

  it("second caller link has the correct href", async () => {
    renderPanel(BLAST_DATA);
    await waitFor(() =>
      expect(screen.getByText("src/routes/api.ts:17")).toBeInTheDocument(),
    );
    const link = screen.getByText("src/routes/api.ts:17").closest("a");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe(
      `https://github.com/${REPO}/blob/${INDEXED_SHA}/src/routes/api.ts#L17`,
    );
  });

  it("falls back to a HEAD blob link when indexedSha is null", async () => {
    const noSha = {
      ...BLAST_DATA,
      index: { ...BLAST_DATA.index, lastIndexedSha: null },
    };
    renderPanel(noSha);
    await waitFor(() =>
      expect(screen.getByText("src/routes/auth.ts:42")).toBeInTheDocument(),
    );
    // Still a working link (so the caller is clickable), pinned to HEAD since
    // the index recorded no SHA. Line numbers may drift; clickability wins.
    const link = screen.getByText("src/routes/auth.ts:42").closest("a");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe(
      `https://github.com/${REPO}/blob/HEAD/src/routes/auth.ts#L42`,
    );
  });
});

// ---------------------------------------------------------------------------
// (c) Empty state when totals.symbols === 0
// ---------------------------------------------------------------------------
describe("BlastRadius — empty state", () => {
  it("shows the no-impacted-symbols message when symbols === 0", async () => {
    renderPanel(EMPTY_BLAST);
    await waitFor(() =>
      expect(
        screen.getByText(/No impacted symbols found for this PR/),
      ).toBeInTheDocument(),
    );
  });
});

// ---------------------------------------------------------------------------
// (c2) Symbols present but no callers — list the symbols, do NOT collapse to
//      the empty state (regression: the old `!hasCallers` guard hid them).
// ---------------------------------------------------------------------------
describe("BlastRadius — symbols with no downstream callers", () => {
  // Step 10: symbol names now include "()" for function kind (P3.7 displayName)
  it("still lists the changed symbols", async () => {
    renderPanel(SYMBOLS_NO_CALLERS);
    await waitFor(() =>
      expect(screen.getByText("buildSubject()")).toBeInTheDocument(),
    );
    expect(screen.getByText("resolveTitle()")).toBeInTheDocument();
  });

  it("shows the no-downstream-callers note above the tree", async () => {
    renderPanel(SYMBOLS_NO_CALLERS);
    await waitFor(() =>
      expect(
        screen.getByText(/2 changed symbol\(s\) with no in-repo callers/),
      ).toBeInTheDocument(),
    );
  });
});

// ---------------------------------------------------------------------------
// (d) Degraded badge
// ---------------------------------------------------------------------------
describe("BlastRadius — degraded state", () => {
  it("shows the degraded badge when index.degraded is true", async () => {
    renderPanel(DEGRADED_BLAST);
    await waitFor(() =>
      expect(
        screen.getByText(/Index degraded — results may be incomplete/),
      ).toBeInTheDocument(),
    );
  });
});

// ---------------------------------------------------------------------------
// (P2) Partial-index badge — honest signal when index is incomplete
// ---------------------------------------------------------------------------
describe("BlastRadius — partial index state", () => {
  it("shows the partial badge when index.status is partial", async () => {
    renderPanel(PARTIAL_BLAST);
    await waitFor(() =>
      expect(
        screen.getByText(/Index incomplete — caller data may be missing/),
      ).toBeInTheDocument(),
    );
  });

  it("still renders the symbol tree when index is partial (panel not blank)", async () => {
    renderPanel(PARTIAL_BLAST);
    await waitFor(() =>
      expect(screen.getByText("sendWelcomeEmail()")).toBeInTheDocument(),
    );
  });
});

// ---------------------------------------------------------------------------
// (e) Toggle to Graph renders svg[aria-label]
// ---------------------------------------------------------------------------
describe("BlastRadius — graph toggle", () => {
  it("renders an svg with aria-label after clicking the graph toggle", async () => {
    renderPanel(BLAST_DATA);
    // Wait for data to load
    await waitFor(() =>
      expect(screen.getByText("checkRateLimit()")).toBeInTheDocument(),
    );
    const graphBtn = screen.getByRole("button", { name: /graph/i });
    fireEvent.click(graphBtn);
    await waitFor(() => {
      const svg = document.querySelector("svg[aria-label]");
      expect(svg).not.toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// (P1) Endpoint/cron badges rendered once per symbol (not per caller)
// ---------------------------------------------------------------------------
describe("BlastRadius — endpoint/cron badges per symbol", () => {
  it("endpoint badge appears exactly once even with multiple callers (P1.1)", async () => {
    renderPanel(BLAST_DATA); // 1 endpoint "POST /auth/login", 2 callers
    await waitFor(() =>
      expect(screen.getByText("checkRateLimit()")).toBeInTheDocument(),
    );
    // getAllByText throws if nothing found; length 1 asserts no duplication per caller
    const badges = screen.getAllByText("POST /auth/login");
    expect(badges).toHaveLength(1);
  });

  it("endpoint badge still renders when callers list is empty (P1.1 zero-caller case)", async () => {
    renderPanel(ENDPOINT_NO_CALLERS);
    await waitFor(() =>
      expect(screen.getByText("POST /x")).toBeInTheDocument(),
    );
  });
});

// ---------------------------------------------------------------------------
// (P3) Per-symbol caller count badge + chevron collapse (Step 7)
// ---------------------------------------------------------------------------
describe("BlastRadius — per-symbol caller count and chevron collapse", () => {
  // Step 10: "2 callers" appears in BOTH the stat row item AND the per-symbol
  // count badge — use getAllByText to avoid single-match assertion failure.
  it("renders the per-symbol caller count badge", async () => {
    renderPanel(BLAST_DATA); // symbol has 2 callers
    await waitFor(() =>
      expect(screen.getByText("checkRateLimit()")).toBeInTheDocument(),
    );
    // Stat row item "2 callers" + per-symbol badge "2 callers" → at least 2
    const callerCounts = screen.getAllByText("2 callers");
    expect(callerCounts.length).toBeGreaterThanOrEqual(2);
  });

  it("clicking the chevron collapses the callers list", async () => {
    renderPanel(BLAST_DATA);
    // First symbol is defaultOpen=true so callers are visible
    await waitFor(() =>
      expect(screen.getByText("src/routes/auth.ts:42")).toBeInTheDocument(),
    );
    // Click the chevron button to collapse
    const chevron = screen.getByRole("button", {
      name: /Toggle callers for checkRateLimit/,
    });
    fireEvent.click(chevron);
    // Caller text disappears from DOM
    await waitFor(() =>
      expect(
        screen.queryByText("src/routes/auth.ts:42"),
      ).not.toBeInTheDocument(),
    );
  });
});

// ---------------------------------------------------------------------------
// (P4) Limited-resolution note — distinct informational note (Tier 4)
// ---------------------------------------------------------------------------
describe("BlastRadius — limited resolution note", () => {
  /** Symbols present, healthy index, but limited cross-file resolution. */
  const LIMITED_RESOLUTION_BLAST = {
    ...BLAST_DATA,
    resolution: { limited: true, reason: "sparse_cross_file" },
  };

  /** Control: same data but resolution is healthy (limited: false). */
  const HEALTHY_RESOLUTION_BLAST = {
    ...BLAST_DATA,
    resolution: { limited: false },
  };

  it("renders the limited-resolution note when resolution.limited is true", async () => {
    renderPanel(LIMITED_RESOLUTION_BLAST);
    await waitFor(() =>
      expect(
        screen.getByText(/Cross-file resolution is limited for this repo/),
      ).toBeInTheDocument(),
    );
  });

  it("symbols still render when resolution.limited is true (panel not collapsed)", async () => {
    renderPanel(LIMITED_RESOLUTION_BLAST);
    await waitFor(() =>
      expect(screen.getByText("checkRateLimit()")).toBeInTheDocument(),
    );
  });

  it("degraded badge does NOT render when only resolution.limited is true", async () => {
    renderPanel(LIMITED_RESOLUTION_BLAST);
    await waitFor(() =>
      expect(
        screen.getByText(/Cross-file resolution is limited for this repo/),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByText(/Index degraded — results may be incomplete/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Index incomplete — caller data may be missing/),
    ).not.toBeInTheDocument();
  });

  it("does NOT render the limited-resolution note when resolution.limited is false", async () => {
    renderPanel(HEALTHY_RESOLUTION_BLAST);
    await waitFor(() =>
      expect(screen.getByText("checkRateLimit()")).toBeInTheDocument(),
    );
    expect(
      screen.queryByText(/Cross-file resolution is limited for this repo/),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// (f) Summary disclosure: stays clean when summary=null / skipped='no_key'
// ---------------------------------------------------------------------------
describe("BlastRadius — summary disclosure", () => {
  it("shows the summary button initially", async () => {
    renderPanel(BLAST_DATA);
    await waitFor(() =>
      expect(screen.getByText("checkRateLimit()")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /Explain impact/i }),
    ).toBeInTheDocument();
  });

  it("hides cleanly (no error UI) when summary is null with skipped='no_key'", async () => {
    renderPanel(BLAST_DATA, { summary: null, cached: false, skipped: "no_key" });
    await waitFor(() =>
      expect(screen.getByText("checkRateLimit()")).toBeInTheDocument(),
    );
    const summaryBtn = screen.getByRole("button", { name: /Explain impact/i });
    fireEvent.click(summaryBtn);

    // Wait for summary fetch to settle (skipped → nothing rendered)
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /Explain impact/i }),
      ).not.toBeInTheDocument(),
    );
    // No error text should appear
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/No summary available/i)).not.toBeInTheDocument();
  });
});
