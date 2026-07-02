import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import tour from "../../../../../../../messages/en/tour.json";

import { AnchorNav } from "./AnchorNav";

afterEach(cleanup);

const ITEMS = [
  { id: "tour-section-architecture", label: "Architecture overview" },
  { id: "tour-section-critical_paths", label: "Critical paths" },
  { id: "tour-section-how_to_run", label: "How to run locally" },
  { id: "tour-section-reading_path", label: "Guided reading path" },
  { id: "tour-section-first_tasks", label: "First tasks" },
  { id: "tour-section-cost", label: "Generation cost" },
];

function renderNav(activeId: string, onNavigate = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ tour }}>
      <AnchorNav items={ITEMS} activeId={activeId} onNavigate={onNavigate} />
    </NextIntlClientProvider>,
  );
  return onNavigate;
}

describe("AnchorNav (AC-14/15/19)", () => {
  it("renders the five sections in order plus a sixth Generation cost anchor", () => {
    renderNav(ITEMS[0]!.id);
    const labels = screen.getAllByRole("button").map((b) => b.textContent);
    expect(labels).toEqual([
      "Architecture overview",
      "Critical paths",
      "How to run locally",
      "Guided reading path",
      "First tasks",
      "Generation cost",
    ]);
  });

  it("highlights the active anchor", () => {
    renderNav("tour-section-critical_paths");
    expect(screen.getByText("Critical paths").getAttribute("aria-current")).toBe("true");
    expect(screen.getByText("Architecture overview").getAttribute("aria-current")).toBeNull();
  });

  it("clicking an anchor calls onNavigate with its id", () => {
    const onNavigate = renderNav(ITEMS[0]!.id);
    fireEvent.click(screen.getByText("Generation cost"));
    expect(onNavigate).toHaveBeenCalledWith("tour-section-cost");
  });
});
