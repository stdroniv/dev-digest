import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCase } from "@devdigest/shared";
import type { FindingEvalCasePreview } from "@/lib/hooks/evals";
import messages from "../../../../messages/en/evals.json";

const createMutateAsync = vi.fn().mockResolvedValue({ id: "new-case" } as EvalCase);
const updateMutateAsync = vi.fn().mockResolvedValue({} as EvalCase);
const deleteMutate = vi.fn();
const runMutate = vi.fn();
const createFromFindingMutateAsync = vi.fn();

vi.mock("@/lib/hooks/evals", () => ({
  useCreateCase: () => ({ mutateAsync: createMutateAsync, isPending: false }),
  useUpdateCase: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
  useDeleteCase: () => ({ mutate: deleteMutate, isPending: false }),
  useRunSingleCase: () => ({ mutate: runMutate, isPending: false }),
  useCreateCaseFromFinding: () => ({ mutateAsync: createFromFindingMutateAsync, isPending: false }),
}));

import { CaseEditorModal } from "./CaseEditorModal";

afterEach(() => {
  cleanup();
  createMutateAsync.mockClear();
  updateMutateAsync.mockClear();
  deleteMutate.mockReset();
  runMutate.mockReset();
  createFromFindingMutateAsync.mockReset();
});

const EXISTING_CASE: EvalCase = {
  id: "c1",
  owner_kind: "agent",
  owner_id: "ag1",
  name: "stripe-key-leak",
  input_diff: "--- a/src/config.ts\n+++ b/src/config.ts",
  input_files: null,
  input_meta: null,
  expected_output: [{ file: "src/config.ts", start_line: 10, end_line: 12, severity: "CRITICAL", category: "security" }],
  notes: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ evals: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("CaseEditorModal (T16, AC-22/AC-23/AC-24)", () => {
  it("shows the 'valid JSON' indicator by default and enables Save", () => {
    renderWithIntl(
      <CaseEditorModal mode="new" owner={{ kind: "agent", id: "ag1" }} evalCase={null} lastRun={null} onClose={() => {}} />,
    );
    expect(screen.getByText("valid JSON")).toBeInTheDocument();
    expect(screen.getByText("Save").closest("button")).not.toBeDisabled();
  });

  it("blocks Save and flags invalid JSON in the expected-output editor (AC-23)", () => {
    renderWithIntl(
      <CaseEditorModal mode="edit" owner={{ kind: "agent", id: "ag1" }} evalCase={EXISTING_CASE} lastRun={null} onClose={() => {}} />,
    );
    const textarea = screen.getByDisplayValue(/CRITICAL/);
    fireEvent.change(textarea, { target: { value: "{ not valid json" } });

    expect(screen.getByText("invalid JSON")).toBeInTheDocument();
    expect(screen.getByText("Save").closest("button")).toBeDisabled();
  });

  it("the finding-skeleton button inserts a well-formed expected-finding shape", () => {
    renderWithIntl(
      <CaseEditorModal mode="new" owner={{ kind: "agent", id: "ag1" }} evalCase={null} lastRun={null} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText("Finding skeleton"));

    // The expected-output editor is the 16-row textarea (the frozen-input side uses 12 rows).
    const expectedTextarea = document.querySelector("textarea[rows='16']") as HTMLTextAreaElement;
    expect(expectedTextarea.value).toContain("src/example.ts");
    expect(expectedTextarea.value).toContain("Describe the expected finding");
    expect(screen.getByText("valid JSON")).toBeInTheDocument();
  });

  it("author-from-scratch (AC-22): Save calls create with the supplied name/diff/expected-output", async () => {
    const onClose = vi.fn();
    renderWithIntl(
      <CaseEditorModal mode="new" owner={{ kind: "agent", id: "ag1" }} evalCase={null} lastRun={null} onClose={onClose} />,
    );

    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), { target: { value: "my-new-case" } });
    fireEvent.click(screen.getByText("Save"));

    await vi.waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1));
    expect(createMutateAsync.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ owner: { kind: "agent", id: "ag1" }, name: "my-new-case", expected_output: [] }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("edit mode (AC-23): Save calls update with the rename + expected-output patch", async () => {
    const onClose = vi.fn();
    renderWithIntl(
      <CaseEditorModal mode="edit" owner={{ kind: "agent", id: "ag1" }} evalCase={EXISTING_CASE} lastRun={null} onClose={onClose} />,
    );

    const nameInput = screen.getByDisplayValue("stripe-key-leak");
    fireEvent.change(nameInput, { target: { value: "renamed-case" } });
    fireEvent.click(screen.getByText("Save"));

    await vi.waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    expect(updateMutateAsync.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        id: "c1",
        owner: { kind: "agent", id: "ag1" },
        patch: expect.objectContaining({ name: "renamed-case" }),
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("delete confirms then fires the delete mutation (AC-24)", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onClose = vi.fn();
    renderWithIntl(
      <CaseEditorModal mode="edit" owner={{ kind: "agent", id: "ag1" }} evalCase={EXISTING_CASE} lastRun={null} onClose={onClose} />,
    );

    fireEvent.click(screen.getByText("Delete"));

    expect(deleteMutate).toHaveBeenCalledWith(
      { id: "c1", owner: { kind: "agent", id: "ag1" } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    confirmSpy.mockRestore();
  });

  it("renders the read-only frozen diff in edit mode (no editable textarea for input)", () => {
    renderWithIntl(
      <CaseEditorModal mode="edit" owner={{ kind: "agent", id: "ag1" }} evalCase={EXISTING_CASE} lastRun={null} onClose={() => {}} />,
    );
    // The frozen diff is shown in a read-only <pre>, not an editable <textarea>.
    const pre = document.querySelector("pre");
    expect(pre?.textContent).toContain("src/config.ts");
    expect(document.querySelector("textarea[rows='12']")).not.toBeInTheDocument();
  });

  it('shows the "Last run passed" status strip when a last-run record exists', () => {
    renderWithIntl(
      <CaseEditorModal
        mode="edit"
        owner={{ kind: "agent", id: "ag1" }}
        evalCase={EXISTING_CASE}
        lastRun={{
          id: "r1",
          case_id: "c1",
          case_name: "stripe-key-leak",
          ran_at: "2026-07-01T00:00:00Z",
          actual_output: [{ file: "src/config.ts", start_line: 10, end_line: 12 }],
          pass: true,
          recall: 1,
          precision: 1,
          citation_accuracy: 1,
          duration_ms: 1200,
          cost_usd: 0.002,
        }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Last run passed")).toBeInTheDocument();
  });
});

const SEED_DRAFT: FindingEvalCasePreview = {
  name: "From finding: Hardcoded Stripe secret key",
  input_diff: "--- a/src/config.ts\n+++ b/src/config.ts\n@@ -10,0 +10,1 @@\n+  const key = 'sk_live_x';",
  input_meta: { source_finding_id: "f1", pr_title: "Add rate limiting", pr_number: 482, pr_body: null },
  expected_output: [
    { file: "src/config.ts", start_line: 10, end_line: 10, severity: "CRITICAL", category: "security" },
  ],
  owner_id: "ag1",
  already_added: false,
};

describe("CaseEditorModal — seeded mode (T5/T7, Gap 2 R-G2-1/2/3)", () => {
  it("pre-fills name + expected-output from the draft and shows the frozen diff read-only", () => {
    renderWithIntl(
      <CaseEditorModal
        mode="seeded"
        owner={{ kind: "agent", id: "ag1" }}
        evalCase={null}
        lastRun={null}
        seed={{ findingId: "f1", draft: SEED_DRAFT }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByDisplayValue("From finding: Hardcoded Stripe secret key")).toBeInTheDocument();
    // Frozen diff is read-only — a <pre>, not an editable 12-row <textarea>.
    const pre = document.querySelector("pre");
    expect(pre?.textContent).toContain("sk_live_x");
    expect(document.querySelector("textarea[rows='12']")).not.toBeInTheDocument();
    // Expected-output stays editable (16-row textarea) and pre-filled.
    const expectedTextarea = document.querySelector("textarea[rows='16']") as HTMLTextAreaElement;
    expect(expectedTextarea.value).toContain("CRITICAL");
  });

  it("Save is blocked while the edited expected-output JSON is invalid (AC-23 parity)", () => {
    renderWithIntl(
      <CaseEditorModal
        mode="seeded"
        owner={{ kind: "agent", id: "ag1" }}
        evalCase={null}
        lastRun={null}
        seed={{ findingId: "f1", draft: SEED_DRAFT }}
        onClose={() => {}}
      />,
    );
    const expectedTextarea = document.querySelector("textarea[rows='16']") as HTMLTextAreaElement;
    fireEvent.change(expectedTextarea, { target: { value: "{ not valid json" } });
    expect(screen.getByText("invalid JSON")).toBeInTheDocument();
    expect(screen.getByText("Save").closest("button")).toBeDisabled();
    expect(createFromFindingMutateAsync).not.toHaveBeenCalled();
  });

  it("Save invokes the finding-route mutation (useCreateCaseFromFinding), not useCreateCase, with the edited name/expected_output", async () => {
    createFromFindingMutateAsync.mockResolvedValueOnce({
      case: { id: "new-case-from-finding" } as EvalCase,
      already_added: false,
    });
    const onClose = vi.fn();
    renderWithIntl(
      <CaseEditorModal
        mode="seeded"
        owner={{ kind: "agent", id: "ag1" }}
        evalCase={null}
        lastRun={null}
        seed={{ findingId: "f1", draft: SEED_DRAFT }}
        onClose={onClose}
      />,
    );

    fireEvent.change(screen.getByDisplayValue("From finding: Hardcoded Stripe secret key"), {
      target: { value: "renamed-seeded-case" },
    });
    fireEvent.click(screen.getByText("Save"));

    await vi.waitFor(() => expect(createFromFindingMutateAsync).toHaveBeenCalledTimes(1));
    expect(createFromFindingMutateAsync.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        findingId: "f1",
        name: "renamed-seeded-case",
        expected_output: SEED_DRAFT.expected_output,
      }),
    );
    expect(createMutateAsync).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
