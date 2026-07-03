import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { HowToRunContent } from "@devdigest/shared";
import tour from "../../../../../../../messages/en/tour.json";

const copyCommand = vi.fn();
vi.mock("../affordances", () => ({ copyCommand: (...args: unknown[]) => copyCommand(...args) }));

import { HowToRunSection } from "./HowToRunSection";

afterEach(() => {
  cleanup();
  copyCommand.mockReset();
});

const CONTENT: HowToRunContent = {
  steps: [
    { command: "pnpm install" },
    { command: "pnpm dev", comment: "starts the API + web" },
  ],
};

function renderSection() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ tour }}>
      <HowToRunSection content={CONTENT} />
    </NextIntlClientProvider>,
  );
}

describe("HowToRunSection (AC-10, §Untrusted inputs — copy only, never execute)", () => {
  it("renders each numbered command line, with an optional comment", () => {
    renderSection();
    expect(screen.getByText("pnpm install")).toBeTruthy();
    expect(screen.getByText("pnpm dev")).toBeTruthy();
    expect(screen.getByText("starts the API + web")).toBeTruthy();
  });

  it("the copy icon copies that line's command — never executes it", () => {
    renderSection();
    const copyButtons = screen.getAllByLabelText("Copy command");
    fireEvent.click(copyButtons[0]!);
    expect(copyCommand).toHaveBeenCalledWith("pnpm install");
    fireEvent.click(copyButtons[1]!);
    expect(copyCommand).toHaveBeenCalledWith("pnpm dev");
  });
});
