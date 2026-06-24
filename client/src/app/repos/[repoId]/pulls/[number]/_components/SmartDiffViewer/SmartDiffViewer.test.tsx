/**
 * SmartDiffViewer — RTL tests (plan steps 9-10 acceptance criteria).
 *
 * Acceptance:
 * - Boilerplate group is collapsed by default (diff lines not in DOM).
 * - Core file shows a "1 finding" badge.
 * - Clicking the badge triggers scrollIntoView for the line-12 element.
 */
import React from "react";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import briefMessages from "../../../../../../../../messages/en/brief.json";
import { SmartDiffViewer } from "./SmartDiffViewer";
import type { PrFile, SmartDiff } from "@devdigest/shared";

afterEach(cleanup);

const PR_ID = "pr-uuid-smart-diff";

// ---- Fixture data ----------------------------------------------------------

const SOURCE_FILE_PATCH =
  "@@ -10,5 +10,5 @@\n function doSomething() {\n   const x = 1;\n-  return x;\n+  return x + 1;\n }";

const SMART_DIFF: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "src/service.ts",
          additions: 1,
          deletions: 1,
          finding_annotations: [{ line: 12, severity: "warning", finding_id: "find-1" }],
          pseudocode_summary: null,
        },
      ],
    },
    {
      role: "boilerplate",
      files: [
        {
          path: "pnpm-lock.yaml",
          additions: 1,
          deletions: 1,
          finding_annotations: [],
          pseudocode_summary: null,
        },
      ],
    },
  ],
  split_suggestion: {
    too_big: false,
    total_lines: 4,
    proposed_splits: [],
  },
};

const PR_FILES: PrFile[] = [
  {
    path: "src/service.ts",
    additions: 1,
    deletions: 1,
    patch: SOURCE_FILE_PATCH,
  },
  {
    path: "pnpm-lock.yaml",
    additions: 1,
    deletions: 1,
    patch: "@@ -1,3 +1,3 @@\n lockfileVersion: '6.0'\n-foo: 1\n+foo: 2\n bar: 3",
  },
];

// ---- Helpers ---------------------------------------------------------------

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderViewer(
  prId: string | null,
  fetchImpl: () => Promise<Response>,
  onNavigateToFinding?: (findingId: string) => void,
) {
  global.fetch = vi.fn(fetchImpl) as unknown as typeof fetch;
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
        <SmartDiffViewer prId={prId} files={PR_FILES} onNavigateToFinding={onNavigateToFinding} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

// ---- Tests -----------------------------------------------------------------

describe("SmartDiffViewer — boilerplate collapsed by default", () => {
  it("does NOT render boilerplate diff content initially", async () => {
    renderViewer(PR_ID, () => Promise.resolve(jsonResp(SMART_DIFF)));

    // Wait for the data to load (core group label should appear)
    await waitFor(() => expect(screen.getByText(/Core logic/i)).toBeInTheDocument());

    // Boilerplate group label is visible (the section header)
    expect(screen.getByText(/Boilerplate/i)).toBeInTheDocument();

    // The lock file's patch diff lines must NOT be visible (collapsed)
    // "foo: 1" and "foo: 2" would appear if the boilerplate file were expanded
    expect(screen.queryByText(/foo: 1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/foo: 2/)).not.toBeInTheDocument();
  });
});

describe("SmartDiffViewer — core file with finding badge", () => {
  it("shows a '1 finding' badge for the core file", async () => {
    renderViewer(PR_ID, () => Promise.resolve(jsonResp(SMART_DIFF)));

    await waitFor(() => expect(screen.getByText(/1 finding/i)).toBeInTheDocument());
  });
});

describe("SmartDiffViewer — findings badge scroll", () => {
  let scrollSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollSpy = vi.fn();
    // Stub getElementById to return a mock element with scrollIntoView
    // The lineDomId for "src/service.ts" line 12 is "line-src_service_ts-12"
    vi.spyOn(document, "getElementById").mockImplementation((id: string) => {
      if (id === "line-src_service_ts-12") {
        return { scrollIntoView: scrollSpy } as unknown as HTMLElement;
      }
      return null;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clicking the findings badge fires scrollIntoView for line 12", async () => {
    renderViewer(PR_ID, () => Promise.resolve(jsonResp(SMART_DIFF)));

    // Wait for the badge to appear
    await waitFor(() => expect(screen.getByText(/1 finding/i)).toBeInTheDocument());

    // Click the badge — this sets open=true and queues a setTimeout(0) for scrollIntoView
    fireEvent.click(screen.getByText(/1 finding/i));

    // Await a real tick for the setTimeout(0) callback to execute
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    expect(scrollSpy).toHaveBeenCalledWith({ block: "center" });
  });
});

describe("SmartDiffViewer — per-line severity pill badge", () => {
  it("renders a 'warning' severity pill for the annotated line", async () => {
    renderViewer(PR_ID, () => Promise.resolve(jsonResp(SMART_DIFF)));

    // The core file is open by default; wait for its diff lines to render
    await waitFor(() => expect(screen.getByText(/Core logic/i)).toBeInTheDocument());

    // The per-line severity pill with the annotation label should appear
    // (Both del and add at line 12 may both render a pill since they share lineNo=12)
    const pills = screen.getAllByText(/^warning$/i);
    expect(pills.length).toBeGreaterThanOrEqual(1);
  });
});

describe("SmartDiffViewer — per-line pill click calls onNavigateToFinding", () => {
  it("clicking the severity pill calls the spy with the finding_id", async () => {
    const spy = vi.fn();
    renderViewer(PR_ID, () => Promise.resolve(jsonResp(SMART_DIFF)), spy);

    await waitFor(() => expect(screen.getByText(/Core logic/i)).toBeInTheDocument());

    // Click the first pill (the warning label rendered inside the per-line pill button)
    const pills = screen.getAllByText(/^warning$/i);
    fireEvent.click(pills[0]!);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("find-1");
  });
});
