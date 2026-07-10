import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCase, FindingRecord } from "@devdigest/shared";
import type { FindingEvalCasePreview } from "@/lib/hooks/evals";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import evalsMessages from "../../../../../../../../messages/en/evals.json";

// Gap 2 (T6/T7): "Turn into eval case" now opens a seeded `CaseEditorModal`
// instead of directly saving. The modal is rendered for real (not mocked), so
// this file's `@/lib/hooks/evals` mock must cover every hook the modal itself
// calls, not just the preview hook FindingCard calls directly.
let previewData: FindingEvalCasePreview | undefined;
const previewHookMock = vi.fn((_findingId: string, enabled: boolean) => ({
  data: enabled ? previewData : undefined,
}));
const createFromFindingMutateAsync = vi.fn();
const createMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();
const deleteMutate = vi.fn();
const runMutate = vi.fn();

vi.mock("@/lib/hooks/evals", () => ({
  useFindingEvalCasePreview: (findingId: string, enabled: boolean) => previewHookMock(findingId, enabled),
  useCreateCaseFromFinding: () => ({ mutateAsync: createFromFindingMutateAsync, isPending: false }),
  useCreateCase: () => ({ mutateAsync: createMutateAsync, isPending: false }),
  useUpdateCase: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
  useDeleteCase: () => ({ mutate: deleteMutate, isPending: false }),
  useRunSingleCase: () => ({ mutate: runMutate, isPending: false }),
}));

import { FindingCard } from "./FindingCard";

afterEach(() => {
  cleanup();
  previewData = undefined;
  previewHookMock.mockClear();
  createFromFindingMutateAsync.mockReset();
  createMutateAsync.mockReset();
  updateMutateAsync.mockReset();
  deleteMutate.mockReset();
  runMutate.mockReset();
});

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

const SEED_PREVIEW: FindingEvalCasePreview = {
  name: "From finding: Hardcoded Stripe secret key",
  input_diff: "--- a/src/config.ts\n+++ b/src/config.ts\n@@ -10,0 +11,1 @@\n+  const key = 'sk_live_x';",
  input_meta: { source_finding_id: "f1", pr_title: "Add rate limiting", pr_number: 482, pr_body: null },
  expected_output: [
    { file: "src/config.ts", start_line: 11, end_line: 11, severity: "CRITICAL", category: "security" },
  ],
  owner_id: "ag1",
  already_added: false,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ prReview: prReviewMessages, evals: evalsMessages }}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("links file:line to the PR Files view (not a blob URL) when repo + PR number are given", () => {
    renderWithIntl(
      <FindingCard f={FINDING} defaultExpanded repoFullName="acme/payments-api" prNumber={482} pathSha="abc" />,
    );
    const link = screen.getByText("src/config.ts:11").closest("a");
    expect(link).toHaveAttribute("href", "https://github.com/acme/payments-api/pull/482/files#diff-abcR11");
    expect(link?.getAttribute("href")).not.toContain("/blob/");
  });

  it("falls back to the bare /files URL before the path sha resolves", () => {
    renderWithIntl(
      <FindingCard f={FINDING} defaultExpanded repoFullName="acme/payments-api" prNumber={482} />,
    );
    expect(screen.getByText("src/config.ts:11").closest("a")).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/pull/482/files",
    );
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });
});

describe("FindingCard — Turn into eval case opens a seeded modal (Gap 2, R-G2-1..5)", () => {
  it("is disabled for a finding with no decision (AC-4/R-G2-5) — clicking never opens the modal", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={() => {}} />);
    const button = screen.getByText("Turn into eval case").closest("button")!;
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is enabled for an accepted finding and opens the pre-filled seeded modal (AC-1, R-G2-1/3)", () => {
    previewData = SEED_PREVIEW;
    const accepted: FindingRecord = { ...FINDING, accepted_at: "2026-01-01T00:00:00Z" };
    renderWithIntl(<FindingCard f={accepted} defaultExpanded onAction={() => {}} />);
    const button = screen.getByText("Turn into eval case").closest("button")!;
    expect(button).not.toBeDisabled();
    fireEvent.click(button);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // pre-filled from the mocked preview draft
    expect(screen.getByDisplayValue(SEED_PREVIEW.name)).toBeInTheDocument();
    // the frozen diff is read-only in seeded mode — a <pre>, not an editable textarea
    const pre = document.querySelector("pre");
    expect(pre?.textContent).toContain("sk_live_x");
    expect(document.querySelector("textarea[rows='12']")).not.toBeInTheDocument();
  });

  it("is enabled for a dismissed finding (AC-2)", () => {
    previewData = { ...SEED_PREVIEW, expected_output: [] };
    const dismissed: FindingRecord = { ...FINDING, dismissed_at: "2026-01-01T00:00:00Z" };
    renderWithIntl(<FindingCard f={dismissed} defaultExpanded onAction={() => {}} />);
    expect(screen.getByText("Turn into eval case").closest("button")).not.toBeDisabled();
  });

  it("Save invokes the finding-route mutation (useCreateCaseFromFinding) with the edited name/expected_output (A2)", async () => {
    createFromFindingMutateAsync.mockResolvedValueOnce({
      case: { id: "new-case", name: "renamed-by-user" } as EvalCase,
      already_added: false,
    });
    previewData = SEED_PREVIEW;
    const accepted: FindingRecord = { ...FINDING, accepted_at: "2026-01-01T00:00:00Z" };
    renderWithIntl(<FindingCard f={accepted} defaultExpanded onAction={() => {}} />);
    fireEvent.click(screen.getByText("Turn into eval case").closest("button")!);

    fireEvent.change(screen.getByDisplayValue(SEED_PREVIEW.name), {
      target: { value: "renamed-by-user" },
    });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(createFromFindingMutateAsync).toHaveBeenCalledTimes(1));
    expect(createFromFindingMutateAsync.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        findingId: "f1",
        name: "renamed-by-user",
        expected_output: SEED_PREVIEW.expected_output,
      }),
    );
    expect(createMutateAsync).not.toHaveBeenCalled();
  });

  it("already_added: shows 'Already added' and opens the EXISTING case in edit mode, not a duplicate seeded draft (AC-5, R-G2-4)", () => {
    const existing: EvalCase = {
      id: "case-1",
      owner_kind: "agent",
      owner_id: "ag1",
      name: "Hardcoded Stripe secret key",
      input_diff: SEED_PREVIEW.input_diff,
      input_files: null,
      input_meta: SEED_PREVIEW.input_meta,
      expected_output: SEED_PREVIEW.expected_output,
      notes: null,
    };
    previewData = { ...SEED_PREVIEW, already_added: true, existing_case: existing };
    const accepted: FindingRecord = { ...FINDING, accepted_at: "2026-01-01T00:00:00Z" };
    renderWithIntl(<FindingCard f={accepted} defaultExpanded onAction={() => {}} />);
    fireEvent.click(screen.getByText("Turn into eval case").closest("button")!);

    expect(screen.getByText("Already added")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Edit-mode title names the EXISTING case — proves it opened that case,
    // not a fresh seeded draft.
    expect(screen.getByText(`Eval case · ${existing.name}`)).toBeInTheDocument();
  });
});
