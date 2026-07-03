import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FirstTasksContent } from "@devdigest/shared";
import tour from "../../../../../../../messages/en/tour.json";

const openOrCopyCited = vi.fn();
vi.mock("../affordances", () => ({ openOrCopyCited: (...args: unknown[]) => openOrCopyCited(...args) }));

import { FirstTasksSection } from "./FirstTasksSection";

afterEach(() => {
  cleanup();
  openOrCopyCited.mockReset();
});

const CONTENT_3: FirstTasksContent = {
  tasks: [
    { title: "Add a health endpoint", path: "server/src/modules/health/routes.ts", complexity: "low" },
    { title: "Wire up the retry policy", path: "server/src/adapters/llm.ts", complexity: "medium" },
    { title: "Rework the job scheduler", path: "server/src/platform/jobs.ts", complexity: "high" },
  ],
};

function renderSection(content: FirstTasksContent = CONTENT_3) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ tour }}>
      <FirstTasksSection content={content} githubUrl="https://github.com/acme/repo" />
    </NextIntlClientProvider>,
  );
}

describe("FirstTasksSection (AC-12/13/16/17)", () => {
  it("renders 2-4 cards with title, cited path, and the correct complexity badge", () => {
    renderSection();
    expect(screen.getByText("Add a health endpoint")).toBeTruthy();
    expect(screen.getByText("server/src/modules/health/routes.ts")).toBeTruthy();
    expect(screen.getByText("Low complexity")).toBeTruthy();
    expect(screen.getByText("Medium complexity")).toBeTruthy();
    expect(screen.getByText("High complexity")).toBeTruthy();
  });

  it("clicking the cited path routes through the shared open/copy affordance", () => {
    renderSection();
    fireEvent.click(screen.getByText("server/src/adapters/llm.ts"));
    expect(openOrCopyCited).toHaveBeenCalledWith("server/src/adapters/llm.ts", "https://github.com/acme/repo");
  });

  it("supports the minimum of 2 tasks", () => {
    renderSection({ tasks: CONTENT_3.tasks.slice(0, 2) });
    expect(screen.getAllByText(/complexity/i)).toHaveLength(2);
  });
});
