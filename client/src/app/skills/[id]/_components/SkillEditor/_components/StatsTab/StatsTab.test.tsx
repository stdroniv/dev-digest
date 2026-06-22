import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillStats } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/skills.json";

const useSkillStats = vi.fn();
vi.mock("@/lib/hooks/skills", () => ({
  useSkillStats: (...args: unknown[]) => useSkillStats(...args),
}));
// next/link needs no router context in jsdom — render a plain anchor.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement("a", { href, ...rest }, children),
}));

import { StatsTab } from "./StatsTab";

afterEach(() => {
  cleanup();
  useSkillStats.mockReset();
});

const SKILL = { id: "sk1", name: "pr-quality-rubric" } as Skill;

const STATS: SkillStats = {
  skill_id: "sk1",
  window_days: 30,
  used_by: {
    count: 3,
    agents: [
      { id: "ag1", name: "Security Reviewer" },
      { id: "ag2", name: "Performance Reviewer" },
      { id: "ag3", name: "Custom Mentor" },
    ],
  },
  pull_frequency_pct: 71,
  accept_rate_pct: 74,
  findings_30d: 96,
  findings_by_category: [
    { category: "security", count: 52 },
    { category: "bug", count: 20 },
    { category: "perf", count: 16 },
    { category: "style", count: 12 },
  ],
};

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <StatsTab skill={SKILL} />
    </NextIntlClientProvider>,
  );
}

describe("Skill StatsTab", () => {
  it("renders the four KPIs with their values", () => {
    useSkillStats.mockReturnValue({ data: STATS, isLoading: false, isError: false, refetch: vi.fn() });
    renderTab();

    expect(screen.getByText("Used by")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Pull frequency")).toBeInTheDocument();
    expect(screen.getByText("71")).toBeInTheDocument();
    expect(screen.getByText("Accept rate")).toBeInTheDocument();
    // "74" renders twice for accept rate: the big value and the ring-gauge dial.
    expect(screen.getAllByText("74")).toHaveLength(2);
    expect(screen.getByText("Findings (30D)")).toBeInTheDocument();
    expect(screen.getByText("96")).toBeInTheDocument();
  });

  it("lists each agent with a link to open it", () => {
    useSkillStats.mockReturnValue({ data: STATS, isLoading: false, isError: false, refetch: vi.fn() });
    renderTab();

    expect(screen.getByText("Agents using this skill")).toBeInTheDocument();
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Performance Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Custom Mentor")).toBeInTheDocument();

    const opens = screen.getAllByText("Open");
    expect(opens).toHaveLength(3);
    // The first agent's row links to its agent editor.
    const row = screen.getByText("Security Reviewer").closest("a")!;
    expect(row).toHaveAttribute("href", "/agents/ag1?tab=config");
  });

  it("renders the findings-by-category breakdown", () => {
    useSkillStats.mockReturnValue({ data: STATS, isLoading: false, isError: false, refetch: vi.fn() });
    renderTab();

    expect(screen.getByText("Findings by category")).toBeInTheDocument();
    // Each category surfaces in the donut legend (unique on this page).
    expect(screen.getByText("security")).toBeInTheDocument();
    expect(screen.getByText("bug")).toBeInTheDocument();
    expect(screen.getByText("perf")).toBeInTheDocument();
    expect(screen.getByText("style")).toBeInTheDocument();
  });

  it("shows a loading state before data arrives", () => {
    useSkillStats.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    renderTab();
    expect(screen.queryByText("Used by")).not.toBeInTheDocument();
  });

  it("shows an error state when the request fails", () => {
    useSkillStats.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() });
    renderTab();
    expect(screen.getByText("Couldn't load stats")).toBeInTheDocument();
  });

  it("shows empty states when the skill has no agents or findings", () => {
    const empty: SkillStats = {
      ...STATS,
      used_by: { count: 0, agents: [] },
      findings_30d: 0,
      findings_by_category: [],
    };
    useSkillStats.mockReturnValue({ data: empty, isLoading: false, isError: false, refetch: vi.fn() });
    renderTab();

    expect(screen.getByText("No agents yet")).toBeInTheDocument();
    expect(screen.getByText("No findings in the last 30 days")).toBeInTheDocument();
  });
});
