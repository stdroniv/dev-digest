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
  it("renders the symbol name", async () => {
    renderPanel(BLAST_DATA);
    await waitFor(() =>
      expect(screen.getByText("checkRateLimit")).toBeInTheDocument(),
    );
  });

  it("renders the symbol kind badge", async () => {
    renderPanel(BLAST_DATA);
    await waitFor(() =>
      expect(screen.getByText("function")).toBeInTheDocument(),
    );
  });

  it("renders caller file references", async () => {
    renderPanel(BLAST_DATA);
    await waitFor(() =>
      expect(screen.getByText("src/routes/auth.ts:42")).toBeInTheDocument(),
    );
    expect(screen.getByText("src/routes/api.ts:17")).toBeInTheDocument();
  });

  it("renders the header stats line containing symbol/caller counts", async () => {
    renderPanel(BLAST_DATA);
    await waitFor(() => {
      const stat = screen.getByText(/1 symbols · 2 callers/);
      expect(stat).toBeInTheDocument();
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

  it("renders plain text (no link) when indexedSha is null", async () => {
    const noSha = {
      ...BLAST_DATA,
      index: { ...BLAST_DATA.index, lastIndexedSha: null },
    };
    renderPanel(noSha);
    await waitFor(() =>
      expect(screen.getByText("src/routes/auth.ts:42")).toBeInTheDocument(),
    );
    const el = screen.getByText("src/routes/auth.ts:42");
    // Should be a span, not an anchor
    expect(el.tagName.toLowerCase()).toBe("span");
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
  it("still lists the changed symbols", async () => {
    renderPanel(SYMBOLS_NO_CALLERS);
    await waitFor(() =>
      expect(screen.getByText("buildSubject")).toBeInTheDocument(),
    );
    expect(screen.getByText("resolveTitle")).toBeInTheDocument();
  });

  it("shows the no-downstream-callers note above the tree", async () => {
    renderPanel(SYMBOLS_NO_CALLERS);
    await waitFor(() =>
      expect(
        screen.getByText(/2 changed symbol\(s\), no downstream callers found/),
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
// (e) Toggle to Graph renders svg[aria-label]
// ---------------------------------------------------------------------------
describe("BlastRadius — graph toggle", () => {
  it("renders an svg with aria-label after clicking the graph toggle", async () => {
    renderPanel(BLAST_DATA);
    // Wait for data to load
    await waitFor(() =>
      expect(screen.getByText("checkRateLimit")).toBeInTheDocument(),
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
      expect(screen.getByText("checkRateLimit")).toBeInTheDocument(),
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
// (f) Summary disclosure: stays clean when summary=null / skipped='no_key'
// ---------------------------------------------------------------------------
describe("BlastRadius — summary disclosure", () => {
  it("shows the summary button initially", async () => {
    renderPanel(BLAST_DATA);
    await waitFor(() =>
      expect(screen.getByText("checkRateLimit")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /Explain impact/i }),
    ).toBeInTheDocument();
  });

  it("hides cleanly (no error UI) when summary is null with skipped='no_key'", async () => {
    renderPanel(BLAST_DATA, { summary: null, cached: false, skipped: "no_key" });
    await waitFor(() =>
      expect(screen.getByText("checkRateLimit")).toBeInTheDocument(),
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
