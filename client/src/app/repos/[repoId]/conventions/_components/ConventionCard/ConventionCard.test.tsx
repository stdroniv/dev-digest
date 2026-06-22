import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate } from "@devdigest/shared";
import { ConventionCard } from "./ConventionCard";
import conventionsMessages from "../../../../../../../messages/en/conventions.json";

afterEach(cleanup);

const candidate: ConventionCandidate = {
  id: "c1",
  repo_id: "r1",
  run_id: "run1",
  category: "Error handling",
  rule: "Always use async/await instead of .then() chains",
  evidence_path: "src/api/users.ts",
  evidence_snippet: "const user = await db.users.find(id);",
  evidence_start_line: 23,
  evidence_end_line: 31,
  confidence: 0.91,
  status: "pending",
  created_at: "2026-01-01T00:00:00.000Z",
};

function renderCard(over: Partial<ConventionCandidate> = {}, handlers = {}) {
  const props = {
    candidate: { ...candidate, ...over },
    repoFullName: "acme/payments-api",
    repoRef: "main",
    onAccept: vi.fn(),
    onReject: vi.fn(),
    onEdit: vi.fn(),
    ...handlers,
  };
  render(
    <NextIntlClientProvider locale="en" messages={{ conventions: conventionsMessages }}>
      <div data-theme="dark">
        <ConventionCard {...props} />
      </div>
    </NextIntlClientProvider>,
  );
  return props;
}

describe("ConventionCard", () => {
  it("renders rule, confidence %, and snippet", () => {
    renderCard();
    expect(screen.getByText(candidate.rule)).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
    expect(screen.getByText(candidate.evidence_snippet!)).toBeInTheDocument();
  });

  it("links evidence to the real code on GitHub (blob URL with line range)", () => {
    renderCard();
    const link = screen.getByText("src/api/users.ts:23-31").closest("a");
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/main/src/api/users.ts#L23-L31",
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("fires onAccept / onReject", () => {
    const props = renderCard();
    fireEvent.click(screen.getByText("Accept"));
    expect(props.onAccept).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText("Reject"));
    expect(props.onReject).toHaveBeenCalledOnce();
  });

  it("shows the accepted state", () => {
    renderCard({ status: "accepted" });
    expect(screen.getByText("Accepted")).toBeInTheDocument();
  });

  it("edit mode saves category + rule", () => {
    const props = renderCard();
    fireEvent.click(screen.getByText("Edit"));
    const rule = screen.getByPlaceholderText("Rule") as HTMLTextAreaElement;
    fireEvent.change(rule, { target: { value: "New edited rule" } });
    fireEvent.click(screen.getByText("Save"));
    expect(props.onEdit).toHaveBeenCalledWith({
      category: "Error handling",
      rule: "New edited rule",
    });
  });
});
