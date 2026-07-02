import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { TourSection } from "@devdigest/shared";
import tour from "../../../../../../../messages/en/tour.json";

const regenerateMutate = vi.fn();
vi.mock("@/lib/hooks/onboarding", () => ({
  useRegenerateSection: () => ({ mutate: regenerateMutate, isPending: false }),
}));

import { SectionCard } from "./SectionCard";

afterEach(() => {
  cleanup();
  regenerateMutate.mockReset();
});

function renderCard(section: TourSection, children: React.ReactNode = <div>content-body</div>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ tour }}>
      <SectionCard kind={section.kind} icon="Layers" title="Architecture overview" section={section} repoId="repo-1">
        {children}
      </SectionCard>
    </NextIntlClientProvider>,
  );
}

const READY_SECTION: TourSection = {
  kind: "architecture",
  status: "ready",
  content: { prose: "p", refs: [], diagram: { nodes: [], edges: [] } },
  cost: { tokensIn: 10, tokensOut: 5 },
  error: null,
  generatedAt: "2026-07-01T00:00:00.000Z",
};

describe("SectionCard", () => {
  it("renders the title and content when ready", () => {
    renderCard(READY_SECTION);
    expect(screen.getByText("Architecture overview")).toBeTruthy();
    expect(screen.getByText("content-body")).toBeTruthy();
  });

  it("collapses/expands on chevron click", () => {
    renderCard(READY_SECTION);
    expect(screen.getByText("content-body")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Collapse"));
    expect(screen.queryByText("content-body")).toBeNull();
    fireEvent.click(screen.getByLabelText("Expand"));
    expect(screen.getByText("content-body")).toBeTruthy();
  });

  it("triggers per-section regenerate scoped to its own kind", () => {
    renderCard(READY_SECTION);
    fireEvent.click(screen.getByLabelText("Regenerate section"));
    expect(regenerateMutate).toHaveBeenCalledWith("architecture");
    expect(regenerateMutate).toHaveBeenCalledTimes(1);
  });

  it("shows a spinner while generating, while its content stays readable", () => {
    renderCard({ ...READY_SECTION, status: "generating" });
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("content-body")).toBeTruthy();
  });

  it("shows a section-scoped failure banner without hiding prior content", () => {
    renderCard({ ...READY_SECTION, status: "failed", error: "LLM timed out" });
    expect(screen.getByRole("alert").textContent).toContain("LLM timed out");
    expect(screen.getByText("content-body")).toBeTruthy();
  });

  it("retry from the failure banner also targets only this section's kind", () => {
    renderCard({ ...READY_SECTION, status: "failed", error: "boom" });
    fireEvent.click(screen.getByText("Retry"));
    expect(regenerateMutate).toHaveBeenCalledWith("architecture");
  });
});
