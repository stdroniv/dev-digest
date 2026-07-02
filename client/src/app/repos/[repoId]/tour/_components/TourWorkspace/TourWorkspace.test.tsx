/**
 * TourWorkspace — RTL + Vitest component tests (SPEC-02 T14).
 *
 * Acceptance criteria covered:
 * (AC-4/5/6) `empty` + no job → heading + "+ Generate onboarding tour" CTA.
 * (AC-35) `unavailable` → the "cannot generate until the repo is available" state.
 * (AC-33 first-ever/empty edge case) `empty` + a terminal failed job → the empty
 *   state PLUS the job's error reason + retry — NOT the `ready` five-card layout.
 * (AC-14/15/19/22) `ready` → header, six anchors (five sections + cost), five
 *   section cards, the cost panel.
 * (AC-30) `stale:true` → "may be out of date" banner.
 * (AC-26) an active whole-tour job → the whole-tour in-progress spinner.
 * (AC-15) clicking an anchor scrolls to its section.
 */
import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { GetTourResponse, OnboardingTour, TourJob } from "@devdigest/shared";
import tour from "../../../../../../../messages/en/tour.json";
import shell from "../../../../../../../messages/en/shell.json";

const { useOnboardingTourMock, generateMutate, regenerateMutate, useSettingsMock, useProviderModelsMock } =
  vi.hoisted(() => ({
    useOnboardingTourMock: vi.fn(),
    generateMutate: vi.fn(),
    regenerateMutate: vi.fn(),
    useSettingsMock: vi.fn(),
    useProviderModelsMock: vi.fn(),
  }));

vi.mock("@/lib/hooks/onboarding", () => ({
  useOnboardingTour: useOnboardingTourMock,
  useGenerateTour: () => ({ mutate: generateMutate, isPending: false }),
  useRegenerateSection: () => ({ mutate: regenerateMutate, isPending: false }),
}));

vi.mock("@/lib/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hooks")>();
  return { ...actual, useSettings: useSettingsMock };
});

vi.mock("@/lib/hooks/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hooks/agents")>();
  return { ...actual, useProviderModels: useProviderModelsMock };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/repos/repo-1/tour",
  useSearchParams: () => new URLSearchParams(),
}));

import { TourWorkspace } from "./TourWorkspace";

afterEach(() => {
  cleanup();
  useOnboardingTourMock.mockReset();
  generateMutate.mockReset();
  regenerateMutate.mockReset();
  useSettingsMock.mockReset();
  useProviderModelsMock.mockReset();
});

const REPO_ID = "repo-1";

const READY_TOUR: OnboardingTour = {
  repoId: REPO_ID,
  generatedAt: "2026-07-01T12:00:00.000Z",
  provenance: {
    fileCount: 128,
    indexed: true,
    indexerVersion: 3,
    lastIndexedSha: "abc123",
    model: "deepseek/deepseek-v4-flash",
    githubUrl: "https://github.com/acme/repo",
  },
  sections: [
    {
      kind: "architecture",
      status: "ready",
      content: { prose: "The service is a thin API.", refs: ["server/src/index.ts"], diagram: { nodes: [], edges: [] } },
      cost: { tokensIn: 1000, tokensOut: 500 },
      error: null,
      generatedAt: "2026-07-01T12:00:00.000Z",
    },
    {
      kind: "critical_paths",
      status: "ready",
      content: { rows: [{ path: "server/src/index.ts", why: "entrypoint" }] },
      cost: { tokensIn: 800, tokensOut: 300 },
      error: null,
      generatedAt: "2026-07-01T12:00:00.000Z",
    },
    {
      kind: "how_to_run",
      status: "ready",
      content: { steps: [{ command: "pnpm dev" }] },
      cost: { tokensIn: 200, tokensOut: 100 },
      error: null,
      generatedAt: "2026-07-01T12:00:00.000Z",
    },
    {
      kind: "reading_path",
      status: "ready",
      content: { steps: [{ path: "server/src/index.ts", reason: "start here" }] },
      cost: { tokensIn: 400, tokensOut: 150 },
      error: null,
      generatedAt: "2026-07-01T12:00:00.000Z",
    },
    {
      kind: "first_tasks",
      status: "ready",
      content: { tasks: [{ title: "Add a test", path: "server/src/index.ts", complexity: "low" }] },
      cost: { tokensIn: 600, tokensOut: 250 },
      error: null,
      generatedAt: "2026-07-01T12:00:00.000Z",
    },
  ],
};

function mockResponse(overrides: Partial<GetTourResponse>): GetTourResponse {
  return { availability: "empty", tour: null, stale: false, job: null, ...overrides };
}

function renderWorkspace() {
  useSettingsMock.mockReturnValue({ data: { feature_models: {} } });
  useProviderModelsMock.mockReturnValue({ data: [] });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ tour, shell }}>
        <TourWorkspace repoId={REPO_ID} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("TourWorkspace — empty state (AC-4/5/6)", () => {
  it("shows the heading and generate CTA when there is no persisted tour and no active job", async () => {
    useOnboardingTourMock.mockReturnValue({
      data: mockResponse({ availability: "empty", job: null }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderWorkspace();

    await waitFor(() => expect(screen.getByText(tour.empty.title)).toBeInTheDocument());
    const cta = screen.getByText(tour.empty.cta);
    expect(cta).toBeInTheDocument();

    fireEvent.click(cta);
    expect(generateMutate).toHaveBeenCalledTimes(1);
  });
});

describe("TourWorkspace — unavailable state (AC-35)", () => {
  it("shows the 'cannot generate until the repo is available' state", async () => {
    useOnboardingTourMock.mockReturnValue({
      data: mockResponse({ availability: "unavailable", job: null }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderWorkspace();

    await waitFor(() => expect(screen.getByText(tour.unavailable.title)).toBeInTheDocument());
    expect(screen.getByText(tour.unavailable.body)).toBeInTheDocument();
    expect(screen.queryByText(tour.empty.title)).not.toBeInTheDocument();
  });
});

describe("TourWorkspace — first-ever generation failure (AC-33 empty edge case)", () => {
  const failedJob: TourJob = {
    id: "job-1",
    kind: "whole",
    sectionKind: null,
    status: "failed",
    error: "Generation failed for 5 of 5 sections",
    failedSectionKinds: ["architecture", "critical_paths", "how_to_run", "reading_path", "first_tasks"],
  };

  it("shows the empty state plus the job's error reason and a retry control, NOT the ready five-card layout", async () => {
    useOnboardingTourMock.mockReturnValue({
      data: mockResponse({ availability: "empty", job: failedJob }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderWorkspace();

    await waitFor(() => expect(screen.getByText(tour.empty.failedTitle)).toBeInTheDocument());
    expect(screen.getByText(failedJob.error!)).toBeInTheDocument();

    const retry = screen.getByText(tour.empty.retry);
    fireEvent.click(retry);
    expect(generateMutate).toHaveBeenCalledTimes(1);

    // Must NOT render as a ready tour of five failed cards.
    expect(screen.queryByText(tour.sections.architecture.title)).not.toBeInTheDocument();
    expect(screen.queryByText(tour.cost.title)).not.toBeInTheDocument();
  });
});

describe("TourWorkspace — ready state (AC-14/15/19/22)", () => {
  it("renders the full layout: header, six anchors, five section cards, and the cost panel", async () => {
    useOnboardingTourMock.mockReturnValue({
      data: mockResponse({ availability: "ready", tour: READY_TOUR, job: null }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderWorkspace();

    // Without a RepoProvider, activeRepo is null, so the header falls back to
    // the raw repoId — confirms the header rendered (AC-14).
    await waitFor(() => expect(screen.getAllByText(REPO_ID).length).toBeGreaterThan(0));

    // Anchor nav: five sections + a sixth "Generation cost" anchor.
    const nav = screen.getByRole("navigation", { name: tour.anchorNav.heading });
    const anchorLabels = Array.from(nav.querySelectorAll("button")).map((b) => b.textContent);
    expect(anchorLabels).toEqual([
      tour.anchorNav.architecture,
      tour.anchorNav.criticalPaths,
      tour.anchorNav.howToRun,
      tour.anchorNav.readingPath,
      tour.anchorNav.firstTasks,
      tour.anchorNav.cost,
    ]);

    // Five section cards (by title, appearing both as anchor label and card title).
    expect(screen.getAllByText(tour.sections.architecture.title).length).toBeGreaterThan(0);
    expect(screen.getAllByText(tour.sections.criticalPaths.title).length).toBeGreaterThan(0);
    expect(screen.getAllByText(tour.sections.howToRun.title).length).toBeGreaterThan(0);
    expect(screen.getAllByText(tour.sections.readingPath.title).length).toBeGreaterThan(0);
    expect(screen.getAllByText(tour.sections.firstTasks.title).length).toBeGreaterThan(0);

    // Cost panel (6th card) — its own card header, distinct from the anchor label.
    expect(screen.getAllByText(tour.cost.title).length).toBeGreaterThan(0);
  });
});

describe("TourWorkspace — ready state with a terminal whole-tour failure (AC-33)", () => {
  it("shows the whole-tour failure banner above the still-visible section cards", async () => {
    const failedWholeJob: TourJob = {
      id: "job-3",
      kind: "whole",
      sectionKind: null,
      status: "failed",
      error: "Generation failed for 3 of 5 sections",
      failedSectionKinds: ["how_to_run", "reading_path", "first_tasks"],
    };
    useOnboardingTourMock.mockReturnValue({
      data: mockResponse({ availability: "ready", tour: READY_TOUR, job: failedWholeJob }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderWorkspace();

    await waitFor(() =>
      expect(
        screen.getByText(tour.wholeFailureBanner.replace("{reason}", failedWholeJob.error!)),
      ).toBeInTheDocument(),
    );

    // The prior tour stays readable: section cards and the cost panel are
    // still present alongside the failure banner, not replaced by it.
    expect(screen.getAllByText(tour.sections.architecture.title).length).toBeGreaterThan(0);
    expect(screen.getAllByText(tour.sections.criticalPaths.title).length).toBeGreaterThan(0);
    expect(screen.getAllByText(tour.sections.howToRun.title).length).toBeGreaterThan(0);
    expect(screen.getAllByText(tour.sections.readingPath.title).length).toBeGreaterThan(0);
    expect(screen.getAllByText(tour.sections.firstTasks.title).length).toBeGreaterThan(0);
    expect(screen.getAllByText(tour.cost.title).length).toBeGreaterThan(0);
  });
});

describe("TourWorkspace — staleness (AC-30)", () => {
  it("shows the 'may be out of date' banner when stale", async () => {
    useOnboardingTourMock.mockReturnValue({
      data: mockResponse({ availability: "ready", tour: READY_TOUR, stale: true, job: null }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText(tour.stale.banner)).toBeInTheDocument());
  });
});

describe("TourWorkspace — whole-tour generation in progress (AC-26)", () => {
  it("shows the whole-tour in-progress spinner while a whole job is running", async () => {
    const runningJob: TourJob = {
      id: "job-2",
      kind: "whole",
      sectionKind: null,
      status: "running",
      error: null,
      failedSectionKinds: [],
    };
    useOnboardingTourMock.mockReturnValue({
      data: mockResponse({ availability: "empty", job: runningJob }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText(tour.empty.generatingTitle)).toBeInTheDocument());
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("TourWorkspace — anchor navigation (AC-15)", () => {
  it("clicking an anchor scrolls to its section", async () => {
    const scrollIntoView = vi.fn();
    // jsdom does not implement scrollIntoView.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.HTMLElement.prototype as any).scrollIntoView = scrollIntoView;

    useOnboardingTourMock.mockReturnValue({
      data: mockResponse({ availability: "ready", tour: READY_TOUR, job: null }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderWorkspace();

    const nav = await screen.findByRole("navigation", { name: tour.anchorNav.heading });
    const costAnchor = within(nav).getByText(tour.anchorNav.cost);
    fireEvent.click(costAnchor);

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });
});
