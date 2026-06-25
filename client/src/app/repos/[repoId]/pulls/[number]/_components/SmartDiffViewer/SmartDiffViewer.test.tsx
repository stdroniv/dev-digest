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
  return renderViewerWith(prId, PR_FILES, fetchImpl, onNavigateToFinding);
}

function renderViewerWith(
  prId: string | null,
  files: PrFile[],
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
        <SmartDiffViewer prId={prId} files={files} onNavigateToFinding={onNavigateToFinding} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

// ---- Additional fixtures for bug-regression tests --------------------------

/** Bug 1: file has annotations but the PR file has no patch (null). */
const SMART_DIFF_NO_PATCH: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "src/no-patch.ts",
          additions: 5,
          deletions: 2,
          finding_annotations: [{ line: 3, severity: "warning", finding_id: "phantom-1" }],
          pseudocode_summary: null,
        },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 7, proposed_splits: [] },
};

/** PR_FILES entry with no patch for the no-patch file. */
const PR_FILES_NO_PATCH: PrFile[] = [
  { path: "src/no-patch.ts", additions: 5, deletions: 2, patch: null },
];

/** Bug 2: annotation covers a range (lines 11–13) in SOURCE_FILE_PATCH. */
const SMART_DIFF_RANGE: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "src/service.ts",
          additions: 1,
          deletions: 1,
          finding_annotations: [{ line: 11, end_line: 13, severity: "warning", finding_id: "range-1" }],
          pseudocode_summary: null,
        },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 2, proposed_splits: [] },
};

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

// ---- Additional fixtures for edge-case tests --------------------------------

/** Test: end_line equals line — only the single annotated line should be highlighted. */
const SMART_DIFF_SINGLE_LINE: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "src/service.ts",
          additions: 1,
          deletions: 1,
          // Critical severity → renders as "blocker" pill
          finding_annotations: [{ line: 12, end_line: 12, severity: "critical", finding_id: "single-1" }],
          pseudocode_summary: null,
        },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 2, proposed_splits: [] },
};

/** Test: end_line extends far beyond the patch boundary. */
const SMART_DIFF_END_BEYOND: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "src/service.ts",
          additions: 1,
          deletions: 1,
          finding_annotations: [{ line: 12, end_line: 99, severity: "warning", finding_id: "beyond-1" }],
          pseudocode_summary: null,
        },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 2, proposed_splits: [] },
};

/** Test: two annotations whose line ranges fully overlap. */
const SMART_DIFF_OVERLAP: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "src/service.ts",
          additions: 1,
          deletions: 1,
          finding_annotations: [
            { line: 11, end_line: 13, severity: "critical", finding_id: "overlap-crit" },
            { line: 11, end_line: 13, severity: "warning", finding_id: "overlap-warn" },
          ],
          pseudocode_summary: null,
        },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 2, proposed_splits: [] },
};

/** Test: annotation at a line far outside SOURCE_FILE_PATCH (lines 10-13). */
const SMART_DIFF_FAR_ANNOTATION: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "src/service.ts",
          additions: 1,
          deletions: 1,
          finding_annotations: [{ line: 99, severity: "critical", finding_id: "far-1" }],
          pseudocode_summary: null,
        },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 2, proposed_splits: [] },
};

// ---- Bug regression tests --------------------------------------------------

describe("SmartDiffViewer — Bug 1: no phantom badge when patch is null", () => {
  it("does NOT render the findings badge when the file has no patch", async () => {
    renderViewerWith(PR_ID, PR_FILES_NO_PATCH, () => Promise.resolve(jsonResp(SMART_DIFF_NO_PATCH)));

    // Wait for groups to load
    await waitFor(() => expect(screen.getByText(/Core logic/i)).toBeInTheDocument());

    // Badge must not appear: no patch → no rendered lines → annotation not visible
    expect(screen.queryByText(/finding/i)).not.toBeInTheDocument();
    // No severity pill either
    expect(screen.queryByText(/^warning$/i)).not.toBeInTheDocument();
  });
});

describe("SmartDiffViewer — Bug 2: full range highlighted, badge only on first line", () => {
  it("renders the badge pill only on the first line of a multi-line annotation", async () => {
    renderViewerWith(PR_ID, [{ path: "src/service.ts", additions: 1, deletions: 1, patch: SOURCE_FILE_PATCH }], () =>
      Promise.resolve(jsonResp(SMART_DIFF_RANGE)),
    );

    // Wait for the core group and diff to render
    await waitFor(() => expect(screen.getByText(/Core logic/i)).toBeInTheDocument());

    // Annotation covers lines 11–13. SOURCE_FILE_PATCH has line 11 as a single context
    // line → exactly 1 warning badge pill rendered (only the start line gets the badge).
    const pills = screen.getAllByText(/^warning$/i);
    expect(pills).toHaveLength(1);
  });
});

// ---- Edge-case tests -------------------------------------------------------

describe("SmartDiffViewer — single-line annotation (end_line === line)", () => {
  it("shows 1 finding badge and renders pills only for the annotated line", async () => {
    renderViewerWith(
      PR_ID,
      [{ path: "src/service.ts", additions: 1, deletions: 1, patch: SOURCE_FILE_PATCH }],
      () => Promise.resolve(jsonResp(SMART_DIFF_SINGLE_LINE)),
    );

    await waitFor(() => expect(screen.getByText(/1 finding/i)).toBeInTheDocument());

    // Critical severity → "blocker" label in the i18n messages.
    // The del and add rows at line 12 both resolve to lineNo=12, which is the annotation's
    // start line → badgeAnnotationsByLine has line 12 → both rows get a pill. 2 total.
    const pills = screen.getAllByText(/^blocker$/i);
    expect(pills).toHaveLength(2);

    // Lines outside [12, 12] must not get a pill
    expect(screen.queryByText(/^warning$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^suggestion$/i)).not.toBeInTheDocument();
  });
});

describe("SmartDiffViewer — annotation end_line extends beyond the patch boundary", () => {
  it("shows badge only on the start line even when end_line is beyond the patch", async () => {
    renderViewerWith(
      PR_ID,
      [{ path: "src/service.ts", additions: 1, deletions: 1, patch: SOURCE_FILE_PATCH }],
      () => Promise.resolve(jsonResp(SMART_DIFF_END_BEYOND)),
    );

    await waitFor(() => expect(screen.getByText(/1 finding/i)).toBeInTheDocument());

    // Annotation range is [12, 99]. badgeAnnotationsByLine only registers line 12.
    // The del and add rows both resolve to lineNo=12 → exactly 2 warning pills.
    const pills = screen.getAllByText(/^warning$/i);
    expect(pills).toHaveLength(2);
  });
});

describe("SmartDiffViewer — multiple overlapping findings on the same line range", () => {
  it("shows 2 findings badge and a single badge pill on the shared start line", async () => {
    renderViewerWith(
      PR_ID,
      [{ path: "src/service.ts", additions: 1, deletions: 1, patch: SOURCE_FILE_PATCH }],
      () => Promise.resolve(jsonResp(SMART_DIFF_OVERLAP)),
    );

    // 2 visible annotations → "2 findings"
    await waitFor(() => expect(screen.getByText(/2 findings/i)).toBeInTheDocument());

    // Both annotations share start line 11 (a context line, appears once in DOM).
    // badgeAnnotationsByLine maps 11 → [critical, warning]; topBadgeAnnotation = critical.
    // → exactly 1 "blocker" pill at line 11.
    const pills = screen.getAllByText(/^blocker$/i);
    expect(pills).toHaveLength(1);

    // No warning pill — critical wins
    expect(screen.queryByText(/^warning$/i)).not.toBeInTheDocument();
  });
});

describe("SmartDiffViewer — prFile present but patch is empty string", () => {
  it("does not show badge or pills when the patch is an empty string", async () => {
    // Empty patch → parsePatch('') returns [] → no rendered lines →
    // visibleAnnotations is empty even though the SmartDiff has an annotation.
    renderViewerWith(
      PR_ID,
      [{ path: "src/service.ts", additions: 1, deletions: 1, patch: "" }],
      () => Promise.resolve(jsonResp(SMART_DIFF)),
    );

    await waitFor(() => expect(screen.getByText(/Core logic/i)).toBeInTheDocument());

    expect(screen.queryByText(/finding/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^warning$/i)).not.toBeInTheDocument();
  });
});

describe("SmartDiffViewer — valid patch but zero matching annotations", () => {
  it("does not show badge when the annotation line is not in the rendered patch", async () => {
    // SOURCE_FILE_PATCH renders lines 10-13; annotation is at line 99.
    // renderedLineNos does not include 99 → visibleAnnotations is empty → no badge.
    renderViewerWith(
      PR_ID,
      [{ path: "src/service.ts", additions: 1, deletions: 1, patch: SOURCE_FILE_PATCH }],
      () => Promise.resolve(jsonResp(SMART_DIFF_FAR_ANNOTATION)),
    );

    await waitFor(() => expect(screen.getByText(/Core logic/i)).toBeInTheDocument());

    expect(screen.queryByText(/finding/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^blocker$/i)).not.toBeInTheDocument();
  });
});
