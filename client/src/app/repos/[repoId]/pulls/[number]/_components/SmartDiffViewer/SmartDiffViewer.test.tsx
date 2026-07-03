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
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
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

/** Test: three findings all sharing start line 11 → MultiFindingBadge. */
const SMART_DIFF_MULTI: SmartDiff = {
  groups: [{ role: "core", files: [{
    path: "src/service.ts", additions: 1, deletions: 1,
    finding_annotations: [
      { line: 11, severity: "suggestion", finding_id: "multi-sugg" },
      { line: 11, end_line: 13, severity: "critical", finding_id: "multi-crit" },
      { line: 11, severity: "warning", finding_id: "multi-warn" },
    ],
    pseudocode_summary: null,
  }]}],
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
  it("shows a count badge for 2 findings on line 11 and lists them in the popover", async () => {
    const spy = vi.fn();
    renderViewerWith(
      PR_ID,
      [{ path: "src/service.ts", additions: 1, deletions: 1, patch: SOURCE_FILE_PATCH }],
      () => Promise.resolve(jsonResp(SMART_DIFF_OVERLAP)),
      spy,
    );

    // Wait for data to load
    await waitFor(() => expect(screen.getByText(/Core logic/i)).toBeInTheDocument());

    // Per-line count badge — not the file-level "2 findings" chip
    const countBadge = screen.getByRole("button", { name: /2 findings on line 11/i });
    expect(countBadge).toBeInTheDocument();

    // No single severity pill visible before opening the popover
    expect(screen.queryByText(/^blocker$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^warning$/i)).not.toBeInTheDocument();

    // Open the popover
    fireEvent.click(countBadge);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();

    // Both rows visible: critical → "blocker", warning → "warning"
    expect(within(dialog).getByText(/^blocker$/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/^warning$/i)).toBeInTheDocument();

    // Both annotations share the same range 11–13
    const rangeLabels = within(dialog).getAllByText(/lines 11/i);
    expect(rangeLabels.length).toBeGreaterThanOrEqual(1);

    // Click the blocker row → spy called with the critical finding_id
    fireEvent.click(within(dialog).getByRole("button", { name: /blocker/i }));
    expect(spy).toHaveBeenCalledWith("overlap-crit");

    // Popover closes after navigating
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

// ---- MultiFindingBadge tests ------------------------------------------------

describe("SmartDiffViewer — count badge renders when ≥2 findings on the same line", () => {
  it("shows a count badge and no single severity pill for 3 findings on line 11", async () => {
    renderViewerWith(
      PR_ID,
      [{ path: "src/service.ts", additions: 1, deletions: 1, patch: SOURCE_FILE_PATCH }],
      () => Promise.resolve(jsonResp(SMART_DIFF_MULTI)),
    );

    await waitFor(() => expect(screen.getByText(/Core logic/i)).toBeInTheDocument());

    // Count badge is present (line 11 is a context line — appears once)
    expect(screen.getByRole("button", { name: /3 findings on line 11/i })).toBeInTheDocument();

    // No single-severity pill (the count badge replaced it)
    expect(screen.queryByText(/^blocker$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^warning$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^suggestion$/i)).not.toBeInTheDocument();
  });
});

describe("SmartDiffViewer — popover opens and lists sorted rows with correct ranges", () => {
  it("lists severity-sorted rows with line/range labels", async () => {
    renderViewerWith(
      PR_ID,
      [{ path: "src/service.ts", additions: 1, deletions: 1, patch: SOURCE_FILE_PATCH }],
      () => Promise.resolve(jsonResp(SMART_DIFF_MULTI)),
    );

    await waitFor(() => expect(screen.getByText(/Core logic/i)).toBeInTheDocument());

    const countBadge = screen.getByRole("button", { name: /3 findings on line 11/i });
    fireEvent.click(countBadge);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();

    // All three severity labels present (critical → "blocker")
    expect(within(dialog).getByText(/^blocker$/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/^warning$/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/^suggestion$/i)).toBeInTheDocument();

    // Critical has range 11–13
    expect(within(dialog).getByText(/lines 11/i)).toBeInTheDocument();
    // Warning and suggestion are single-line → "line 11"
    const singleLineLabels = within(dialog).getAllByText(/^line 11$/i);
    expect(singleLineLabels).toHaveLength(2);

    // Sort order: blocker (critical) → warning → suggestion
    const rows = within(dialog).getAllByRole("button");
    expect(rows[0]!.textContent).toMatch(/blocker/i);
    expect(rows[1]!.textContent).toMatch(/warning/i);
    expect(rows[2]!.textContent).toMatch(/suggestion/i);
  });
});

describe("SmartDiffViewer — each popover row navigates to its own finding_id", () => {
  it("clicking a row calls onNavigateToFinding with the correct id and closes the popover", async () => {
    const spy = vi.fn();
    renderViewerWith(
      PR_ID,
      [{ path: "src/service.ts", additions: 1, deletions: 1, patch: SOURCE_FILE_PATCH }],
      () => Promise.resolve(jsonResp(SMART_DIFF_MULTI)),
      spy,
    );

    await waitFor(() => expect(screen.getByText(/Core logic/i)).toBeInTheDocument());

    // Open popover and click the blocker (critical) row
    fireEvent.click(screen.getByRole("button", { name: /3 findings on line 11/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /blocker/i }));

    expect(spy).toHaveBeenCalledWith("multi-crit");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Re-open and click the warning row
    fireEvent.click(screen.getByRole("button", { name: /3 findings on line 11/i }));
    const dialog2 = screen.getByRole("dialog");
    fireEvent.click(within(dialog2).getByRole("button", { name: /warning/i }));

    expect(spy).toHaveBeenCalledWith("multi-warn");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("SmartDiffViewer — popover closes on outside click and Esc", () => {
  it("closes the popover when clicking outside", async () => {
    renderViewerWith(
      PR_ID,
      [{ path: "src/service.ts", additions: 1, deletions: 1, patch: SOURCE_FILE_PATCH }],
      () => Promise.resolve(jsonResp(SMART_DIFF_MULTI)),
    );

    await waitFor(() => expect(screen.getByText(/Core logic/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /3 findings on line 11/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the popover on Esc key", async () => {
    renderViewerWith(
      PR_ID,
      [{ path: "src/service.ts", additions: 1, deletions: 1, patch: SOURCE_FILE_PATCH }],
      () => Promise.resolve(jsonResp(SMART_DIFF_MULTI)),
    );

    await waitFor(() => expect(screen.getByText(/Core logic/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /3 findings on line 11/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("SmartDiffViewer — single-finding lines unchanged (regression)", () => {
  it("does not render a count badge or popover for a single finding", async () => {
    renderViewer(PR_ID, () => Promise.resolve(jsonResp(SMART_DIFF)));

    await waitFor(() => expect(screen.getByText(/Core logic/i)).toBeInTheDocument());

    // No count badge
    expect(screen.queryByRole("button", { name: /findings on line/i })).not.toBeInTheDocument();
    // No dialog
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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

// ---- New fixtures for additional coverage ----------------------------------

/** Empty groups response — triggers the "no changed files" empty state. */
const SMART_DIFF_EMPTY: SmartDiff = {
  groups: [],
  split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
};

/** Split-too-big flag set — triggers the split suggestion banner. */
const SMART_DIFF_SPLIT_TOO_BIG: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "src/service.ts",
          additions: 1,
          deletions: 1,
          finding_annotations: [],
          pseudocode_summary: null,
        },
      ],
    },
  ],
  split_suggestion: { too_big: true, total_lines: 200, proposed_splits: [] },
};

// ---- hideHeader prop -------------------------------------------------------

describe("SmartDiffViewer — hideHeader prop controls SectionLabel visibility", () => {
  it("renders the 'Smart Diff' section label when hideHeader is not set", async () => {
    renderViewer(PR_ID, () => Promise.resolve(jsonResp(SMART_DIFF)));
    await waitFor(() => expect(screen.getByText(/Core logic/i)).toBeInTheDocument());
    // SectionLabel renders its children text into a <span>
    expect(screen.getByText("Smart Diff")).toBeInTheDocument();
  });

  it("does not render the 'Smart Diff' section label when hideHeader is true", async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResp(SMART_DIFF))) as unknown as typeof fetch;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
          <SmartDiffViewer prId={PR_ID} files={PR_FILES} hideHeader={true} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText(/Core logic/i)).toBeInTheDocument());
    expect(screen.queryByText("Smart Diff")).not.toBeInTheDocument();
  });
});

// ---- Empty state -----------------------------------------------------------

describe("SmartDiffViewer — empty state when API returns no groups", () => {
  it("renders the empty-state message when groups array is empty", async () => {
    renderViewer(PR_ID, () => Promise.resolve(jsonResp(SMART_DIFF_EMPTY)));
    await waitFor(() =>
      expect(screen.getByText("No changed files to show.")).toBeInTheDocument(),
    );
    // No group labels or file paths should be present
    expect(screen.queryByText(/Core logic/i)).not.toBeInTheDocument();
  });
});

// ---- Split suggestion banner -----------------------------------------------

describe("SmartDiffViewer — split suggestion banner", () => {
  it("shows the split suggestion banner when split_suggestion.too_big is true", async () => {
    renderViewer(PR_ID, () => Promise.resolve(jsonResp(SMART_DIFF_SPLIT_TOO_BIG)));
    await waitFor(() => expect(screen.getByText(/Core logic/i)).toBeInTheDocument());
    expect(screen.getByText(/this PR is large/i)).toBeInTheDocument();
  });

  it("does not show the split suggestion banner when too_big is false", async () => {
    renderViewer(PR_ID, () => Promise.resolve(jsonResp(SMART_DIFF)));
    await waitFor(() => expect(screen.getByText(/Core logic/i)).toBeInTheDocument());
    expect(screen.queryByText(/this PR is large/i)).not.toBeInTheDocument();
  });
});

// ---- "No diff available." fallback text ------------------------------------

describe("SmartDiffViewer — open file card with null patch shows fallback", () => {
  it("renders 'No diff available.' in the file body when the patch is null", async () => {
    // SMART_DIFF_NO_PATCH has a core file whose matching PR file has patch: null.
    // parsePatch(null) returns [] → the open file body renders the fallback text.
    renderViewerWith(PR_ID, PR_FILES_NO_PATCH, () => Promise.resolve(jsonResp(SMART_DIFF_NO_PATCH)));
    await waitFor(() => expect(screen.getByText(/Core logic/i)).toBeInTheDocument());
    expect(screen.getByText("No diff available.")).toBeInTheDocument();
  });
});

// ---- Click inside popover keeps it open ------------------------------------

describe("SmartDiffViewer — click inside popover does not close it", () => {
  it("keeps the popover open when a mousedown fires inside the dialog", async () => {
    renderViewerWith(
      PR_ID,
      [{ path: "src/service.ts", additions: 1, deletions: 1, patch: SOURCE_FILE_PATCH }],
      () => Promise.resolve(jsonResp(SMART_DIFF_MULTI)),
    );
    await waitFor(() => expect(screen.getByText(/Core logic/i)).toBeInTheDocument());

    // Open the popover
    fireEvent.click(screen.getByRole("button", { name: /3 findings on line 11/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();

    // mousedown on the dialog element itself (inside wrapRef) — must NOT close the popover
    fireEvent.mouseDown(dialog);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

// ---- aria-expanded reflects open/closed state ------------------------------

describe("SmartDiffViewer — MultiFindingBadge aria-expanded attribute", () => {
  it("reflects aria-expanded=false when closed and aria-expanded=true when open", async () => {
    renderViewerWith(
      PR_ID,
      [{ path: "src/service.ts", additions: 1, deletions: 1, patch: SOURCE_FILE_PATCH }],
      () => Promise.resolve(jsonResp(SMART_DIFF_MULTI)),
    );
    await waitFor(() => expect(screen.getByText(/Core logic/i)).toBeInTheDocument());

    const countBadge = screen.getByRole("button", { name: /3 findings on line 11/i });

    // Initially closed
    expect(countBadge).toHaveAttribute("aria-expanded", "false");

    // Open the popover
    fireEvent.click(countBadge);
    expect(countBadge).toHaveAttribute("aria-expanded", "true");

    // Close with Esc — attribute resets
    fireEvent.keyDown(document, { key: "Escape" });
    expect(countBadge).toHaveAttribute("aria-expanded", "false");
  });
});

// ---- File card accordion toggle --------------------------------------------

describe("SmartDiffViewer — file card accordion toggle", () => {
  it("collapses an open core file card when its header is clicked", async () => {
    renderViewer(PR_ID, () => Promise.resolve(jsonResp(SMART_DIFF)));
    await waitFor(() => expect(screen.getByText(/Core logic/i)).toBeInTheDocument());

    // Core file is open by default — warning pills are visible
    expect(screen.getAllByText(/^warning$/i).length).toBeGreaterThanOrEqual(1);

    // Click the file path span inside the header to collapse the file card
    fireEvent.click(screen.getByText("src/service.ts"));

    // After collapse the diff lines (and their pills) are removed from the DOM
    expect(screen.queryByText(/^warning$/i)).not.toBeInTheDocument();
  });

  it("re-expands a collapsed file card when the header is clicked again", async () => {
    renderViewer(PR_ID, () => Promise.resolve(jsonResp(SMART_DIFF)));
    await waitFor(() => expect(screen.getByText(/Core logic/i)).toBeInTheDocument());

    const filePath = screen.getByText("src/service.ts");

    // Collapse then re-expand
    fireEvent.click(filePath);
    expect(screen.queryByText(/^warning$/i)).not.toBeInTheDocument();

    fireEvent.click(filePath);
    expect(screen.getAllByText(/^warning$/i).length).toBeGreaterThanOrEqual(1);
  });
});

// ---- FileSummary ("What this does" per-file AI summary) --------------------

/**
 * Builds a fetch mock that branches on URL AND method — needed here because
 * GET /pulls/:id/file-summary and POST /pulls/:id/file-summary hit the SAME
 * path with different response bodies (GET = cached state, POST = generate).
 */
function fileSummaryFetch(opts: {
  getSummary?: unknown;
  postSummary?: unknown;
}) {
  return (url: unknown, init?: RequestInit) => {
    const path = typeof url === "string" ? url : String(url);
    if (path.includes("/smart-diff")) return Promise.resolve(jsonResp(SMART_DIFF));
    if (path.includes("/file-summary")) {
      const method = init?.method ?? "GET";
      if (method === "POST") {
        return Promise.resolve(jsonResp(opts.postSummary ?? { status: "ready", summary: "Adds one to x.", stale: false }));
      }
      return Promise.resolve(jsonResp(opts.getSummary ?? { status: "not_generated" }));
    }
    return Promise.resolve(jsonResp(null));
  };
}

function renderViewerWithFetch(fetchImpl: (url: unknown, init?: RequestInit) => Promise<Response>) {
  global.fetch = vi.fn(fetchImpl) as unknown as typeof fetch;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
        <SmartDiffViewer prId={PR_ID} files={PR_FILES} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("SmartDiffViewer — FileSummary button visibility (core-group gating)", () => {
  it("shows the 'summary' button on a core file but not on a boilerplate file", async () => {
    renderViewerWithFetch(fileSummaryFetch({}));
    await waitFor(() => expect(screen.getByText(/Core logic/i)).toBeInTheDocument());

    // One summary button (for the single core file "src/service.ts")
    expect(screen.getAllByText("summary")).toHaveLength(1);

    // Boilerplate group is collapsed by default and its file ("pnpm-lock.yaml")
    // never renders a summary button regardless of open/closed state.
    expect(screen.getByText(/Boilerplate/i)).toBeInTheDocument();
  });
});

describe("SmartDiffViewer — FileSummary does not auto-fetch on mount", () => {
  it("issues no /file-summary request until the summary button is clicked", async () => {
    const fetchMock = vi.fn(fileSummaryFetch({}));
    global.fetch = fetchMock as unknown as typeof fetch;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
          <SmartDiffViewer prId={PR_ID} files={PR_FILES} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText(/Core logic/i)).toBeInTheDocument());
    expect(screen.getByText("summary")).toBeInTheDocument();

    const fileSummaryCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/file-summary"));
    expect(fileSummaryCalls).toHaveLength(0);
  });
});

describe("SmartDiffViewer — clicking summary on a not_generated core file generates and renders it", () => {
  it("fires the POST and renders 'What this does: <summary>' from the ready response", async () => {
    renderViewerWithFetch(
      fileSummaryFetch({
        getSummary: { status: "not_generated" },
        postSummary: { status: "ready", summary: "Adds one to x.", stale: false },
      }),
    );

    await waitFor(() => expect(screen.getByText(/Core logic/i)).toBeInTheDocument());

    fireEvent.click(screen.getByText("summary"));

    await waitFor(() => expect(screen.getByText(/Adds one to x\./)).toBeInTheDocument());
    expect(screen.getByText("What this does:")).toBeInTheDocument();
  });
});

describe("SmartDiffViewer — FileSummary collapses without refetching", () => {
  it("clicking summary again collapses the line without issuing another request", async () => {
    const fetchMock = vi.fn(
      fileSummaryFetch({
        getSummary: { status: "ready", summary: "Adds one to x.", stale: false },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
          <SmartDiffViewer prId={PR_ID} files={PR_FILES} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText(/Core logic/i)).toBeInTheDocument());

    fireEvent.click(screen.getByText("summary"));
    await waitFor(() => expect(screen.getByText(/Adds one to x\./)).toBeInTheDocument());

    const callsAfterOpen = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/file-summary")).length;

    fireEvent.click(screen.getByText("summary"));
    expect(screen.queryByText(/Adds one to x\./)).not.toBeInTheDocument();

    const callsAfterCollapse = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/file-summary")).length;
    expect(callsAfterCollapse).toBe(callsAfterOpen);
  });
});

describe("SmartDiffViewer — FileSummary 'no model configured' hint", () => {
  it("renders the no-model hint when the summary state is skipped/no_model", async () => {
    renderViewerWithFetch(
      fileSummaryFetch({ getSummary: { status: "skipped", reason: "no_model" } }),
    );

    await waitFor(() => expect(screen.getByText(/Core logic/i)).toBeInTheDocument());

    fireEvent.click(screen.getByText("summary"));

    await waitFor(() => expect(screen.getByText("No model configured")).toBeInTheDocument());
  });
});
