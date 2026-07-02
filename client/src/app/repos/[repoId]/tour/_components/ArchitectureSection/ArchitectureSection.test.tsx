import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ArchitectureContent } from "@devdigest/shared";
import tour from "../../../../../../../messages/en/tour.json";

const openOrCopyCited = vi.fn();
vi.mock("../affordances", () => ({ openOrCopyCited: (...args: unknown[]) => openOrCopyCited(...args) }));

import { ArchitectureSection } from "./ArchitectureSection";

afterEach(() => {
  cleanup();
  openOrCopyCited.mockReset();
});

const CONTENT: ArchitectureContent = {
  prose:
    "The **API** boots from `server/src/index.ts` and serves the web client.\n\nA second paragraph explains the request flow.",
  refs: ["server/src/index.ts", "client/src/app/layout.tsx"],
  diagram: {
    nodes: [
      { id: "client", label: "client/" },
      { id: "server", label: "server/" },
    ],
    edges: [{ from: "client", to: "server" }],
  },
};

function renderSection(githubUrl: string | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ tour }}>
      <ArchitectureSection content={CONTENT} githubUrl={githubUrl} />
    </NextIntlClientProvider>,
  );
}

describe("ArchitectureSection (AC-8)", () => {
  it("splits prose into separate paragraphs", () => {
    const { container } = renderSection("https://github.com/acme/repo");
    expect(container.querySelectorAll("p").length).toBe(2);
  });

  it("renders **bold** and `code` runs as formatted elements, not literal markers", () => {
    const { container } = renderSection("https://github.com/acme/repo");
    expect(container.querySelector("strong")?.textContent).toBe("API");
    expect(screen.getByText("server/src/index.ts", { selector: "code" })).toBeTruthy();
    // The raw markdown markers must not leak into the rendered text.
    expect(container.textContent).not.toContain("**");
    expect(container.textContent).not.toContain("`");
  });

  it("renders each ref as a clickable chip", () => {
    renderSection("https://github.com/acme/repo");
    expect(screen.getByRole("button", { name: "Open client/src/app/layout.tsx" })).toBeTruthy();
  });

  it("clicking a ref opens/copies it via the shared affordance with the repo's githubUrl", () => {
    renderSection("https://github.com/acme/repo");
    fireEvent.click(screen.getByRole("button", { name: "Open client/src/app/layout.tsx" }));
    expect(openOrCopyCited).toHaveBeenCalledWith("client/src/app/layout.tsx", "https://github.com/acme/repo");
  });

  it("passes a null githubUrl through unchanged", () => {
    renderSection(null);
    fireEvent.click(screen.getByRole("button", { name: "Open server/src/index.ts" }));
    expect(openOrCopyCited).toHaveBeenCalledWith("server/src/index.ts", null);
  });

  it("renders the diagram with one node per graph node", () => {
    const { container } = renderSection("https://github.com/acme/repo");
    expect(container.querySelectorAll("g[data-node-id]").length).toBe(2);
  });
});
