import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCase, FindingRecord } from "@devdigest/shared";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import evalsMessages from "../../../../../../../../messages/en/evals.json";

const createCaseMutate = vi.fn();
let createCaseIsPending = false;
vi.mock("@/lib/hooks/evals", () => ({
  useCreateCaseFromFinding: () => ({
    mutate: createCaseMutate,
    isPending: createCaseIsPending,
  }),
}));

import { FindingCard } from "./FindingCard";

afterEach(() => {
  cleanup();
  createCaseMutate.mockReset();
  createCaseIsPending = false;
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

describe("FindingCard — Turn into eval case (AC-1..AC-5)", () => {
  it("is disabled for a finding with no decision (AC-4)", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={() => {}} />);
    expect(screen.getByText("Turn into eval case").closest("button")).toBeDisabled();
    expect(createCaseMutate).not.toHaveBeenCalled();
  });

  it("is enabled and fires the mutation exactly once for an accepted finding (AC-1)", () => {
    const accepted: FindingRecord = { ...FINDING, accepted_at: "2026-01-01T00:00:00Z" };
    renderWithIntl(<FindingCard f={accepted} defaultExpanded onAction={() => {}} />);
    const button = screen.getByText("Turn into eval case").closest("button")!;
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(createCaseMutate).toHaveBeenCalledTimes(1);
    expect(createCaseMutate).toHaveBeenCalledWith("f1", expect.any(Object));
  });

  it("is enabled for a dismissed finding (AC-2)", () => {
    const dismissed: FindingRecord = { ...FINDING, dismissed_at: "2026-01-01T00:00:00Z" };
    renderWithIntl(<FindingCard f={dismissed} defaultExpanded onAction={() => {}} />);
    expect(screen.getByText("Turn into eval case").closest("button")).not.toBeDisabled();
  });

  it("shows an immediate 'Added' confirmation and guards repeat clicks (AC-3, AC-5)", () => {
    const accepted: FindingRecord = { ...FINDING, accepted_at: "2026-01-01T00:00:00Z" };
    const created: EvalCase = {
      id: "case-1",
      owner_kind: "agent",
      owner_id: "ag1",
      name: "Hardcoded Stripe secret key",
      input_diff: "",
      input_files: null,
      input_meta: null,
      expected_output: [],
      notes: null,
    };
    createCaseMutate.mockImplementation(
      (
        _id: string,
        opts: { onSuccess?: (data: { case: EvalCase; already_added: boolean }) => void },
      ) => {
        opts.onSuccess?.({ case: created, already_added: false });
      },
    );
    renderWithIntl(<FindingCard f={accepted} defaultExpanded onAction={() => {}} />);
    const button = screen.getByText("Turn into eval case").closest("button")!;
    fireEvent.click(button);
    expect(createCaseMutate).toHaveBeenCalledTimes(1);

    // Freshly created this click → "Added" (a real cross-session `already_added:
    // false` signal from the server, not a client-only guess).
    const addedButton = screen.getByText("Added").closest("button")!;
    fireEvent.click(addedButton);
    expect(createCaseMutate).toHaveBeenCalledTimes(1);
  });

  it("shows 'Already added' when the server reports the case already existed (AC-5)", () => {
    const accepted: FindingRecord = { ...FINDING, accepted_at: "2026-01-01T00:00:00Z" };
    const existing: EvalCase = {
      id: "case-1",
      owner_kind: "agent",
      owner_id: "ag1",
      name: "Hardcoded Stripe secret key",
      input_diff: "",
      input_files: null,
      input_meta: null,
      expected_output: [],
      notes: null,
    };
    createCaseMutate.mockImplementation(
      (
        _id: string,
        opts: { onSuccess?: (data: { case: EvalCase; already_added: boolean }) => void },
      ) => {
        opts.onSuccess?.({ case: existing, already_added: true });
      },
    );
    renderWithIntl(<FindingCard f={accepted} defaultExpanded onAction={() => {}} />);
    fireEvent.click(screen.getByText("Turn into eval case").closest("button")!);
    expect(screen.getByText("Already added")).toBeInTheDocument();
  });
});
