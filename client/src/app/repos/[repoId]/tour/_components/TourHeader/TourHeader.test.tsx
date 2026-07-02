import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { TourProvenance, TourSection } from "@devdigest/shared";
import tour from "../../../../../../../messages/en/tour.json";

const { useSettingsMock, useProviderModelsMock, copyShareLinkMock } = vi.hoisted(() => ({
  useSettingsMock: vi.fn(),
  useProviderModelsMock: vi.fn(),
  copyShareLinkMock: vi.fn(),
}));
vi.mock("@/lib/hooks", () => ({ useSettings: useSettingsMock }));
vi.mock("@/lib/hooks/agents", () => ({ useProviderModels: useProviderModelsMock }));
vi.mock("../affordances", () => ({ copyShareLink: copyShareLinkMock }));

import { TourHeader } from "./TourHeader";

afterEach(() => {
  cleanup();
  useSettingsMock.mockReset();
  useProviderModelsMock.mockReset();
  copyShareLinkMock.mockReset();
});

const PROVENANCE: TourProvenance = {
  fileCount: 128,
  indexed: true,
  indexerVersion: 3,
  lastIndexedSha: "abc123",
  model: "deepseek/deepseek-v4-flash",
  githubUrl: "https://github.com/acme/repo",
};

const SECTIONS: TourSection[] = [];

function renderHeader(regenerating = false, onRegenerate = vi.fn()) {
  useSettingsMock.mockReturnValue({ data: { feature_models: {} } });
  useProviderModelsMock.mockReturnValue({ data: [] });
  render(
    <NextIntlClientProvider locale="en" messages={{ tour }}>
      <TourHeader
        repoId="repo-1"
        repoName="acme/repo"
        provenance={PROVENANCE}
        generatedAt="2026-07-01T12:00:00.000Z"
        sections={SECTIONS}
        regenerating={regenerating}
        onRegenerate={onRegenerate}
      />
    </NextIntlClientProvider>,
  );
  return onRegenerate;
}

describe("TourHeader (AC-14/18/22)", () => {
  it("renders 'Onboarding for {repo}' with the repo name in mono", () => {
    renderHeader();
    const mono = screen.getByText("acme/repo");
    expect(mono.className).toContain("mono");
  });

  it("renders the provenance line from real provenance/generatedAt (never fabricated)", () => {
    renderHeader();
    expect(screen.getByText(/Generated from index of 128 files/)).toBeTruthy();
  });

  it("Regenerate triggers onRegenerate", () => {
    const onRegenerate = renderHeader();
    fireEvent.click(screen.getByText("Regenerate"));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it("Share link copies the local deep-link via the shared affordance (AC-18)", () => {
    renderHeader();
    fireEvent.click(screen.getByText("Share link"));
    expect(copyShareLinkMock).toHaveBeenCalledWith("repo-1");
  });
});
