import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { CriticalPathsContent } from "@devdigest/shared";
import tour from "../../../../../../../messages/en/tour.json";

const openOrCopyCited = vi.fn();
vi.mock("../affordances", () => ({ openOrCopyCited: (...args: unknown[]) => openOrCopyCited(...args) }));

import { CriticalPathsSection } from "./CriticalPathsSection";

afterEach(() => {
  cleanup();
  openOrCopyCited.mockReset();
});

const CONTENT: CriticalPathsContent = {
  rows: [
    { path: "server/src/index.ts", why: "boots the API" },
    { path: "client/src/app/layout.tsx", why: "root layout" },
  ],
};

function renderSection(githubUrl: string | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ tour }}>
      <CriticalPathsSection content={CONTENT} githubUrl={githubUrl} />
    </NextIntlClientProvider>,
  );
}

describe("CriticalPathsSection (AC-9/16/17)", () => {
  it("renders each row's mono path + why", () => {
    renderSection("https://github.com/acme/repo");
    expect(screen.getByText("server/src/index.ts")).toBeTruthy();
    expect(screen.getByText("— boots the API")).toBeTruthy();
  });

  it("Open opens/copies via the shared affordance with this row's path + the repo's githubUrl", () => {
    renderSection("https://github.com/acme/repo");
    fireEvent.click(screen.getAllByText("Open")[0]!);
    expect(openOrCopyCited).toHaveBeenCalledWith("server/src/index.ts", "https://github.com/acme/repo");
  });

  it("passes a null githubUrl through unchanged", () => {
    renderSection(null);
    fireEvent.click(screen.getAllByText("Open")[1]!);
    expect(openOrCopyCited).toHaveBeenCalledWith("client/src/app/layout.tsx", null);
  });
});
