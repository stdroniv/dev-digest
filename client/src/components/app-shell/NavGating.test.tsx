import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "@devdigest/ui";
import type { ShellContext } from "@devdigest/ui/shell/types";
import { activeKeyFor } from "./helpers";

function makeCtx(overrides: Partial<ShellContext>): ShellContext {
  return {
    repos: [],
    activeRepo: null,
    theme: "dark",
    onSelectRepo: () => {},
    onAddRepo: () => {},
    onRemoveRepo: () => {},
    onToggleTheme: () => {},
    onOpenCommandPalette: () => {},
    ...overrides,
  };
}

describe("Sidebar repo-scoped nav gating (AC-33/AC-34/AC-35)", () => {
  it("shows Project Context linking directly to the active repo when a repo is active", () => {
    render(<Sidebar ctx={makeCtx({ repoId: "repo-1" })} />);

    const link = screen.getByText("Project Context").closest("a");
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute("href", "/repos/repo-1/context");
  });

  it("hides Project Context (but not other repo-agnostic-safe items) when no repo is active", () => {
    render(<Sidebar ctx={makeCtx({ repoId: null })} />);

    expect(screen.queryByText("Project Context")).toBeNull();
    expect(screen.queryByText("Pull Requests")).not.toBeNull();
  });

  it("shows Onboarding Tour linking directly to the active repo's tour when a repo is active", () => {
    render(<Sidebar ctx={makeCtx({ repoId: "repo-1" })} />);

    const link = screen.getByText("Onboarding Tour").closest("a");
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute("href", "/repos/repo-1/tour");
  });

  it("hides Onboarding Tour when no repo is active", () => {
    render(<Sidebar ctx={makeCtx({ repoId: null })} />);

    expect(screen.queryByText("Onboarding Tour")).toBeNull();
  });
});

describe("Sidebar GLOBAL nav entry (SPEC-05 T9: CI Runs)", () => {
  it("shows a CI Runs item under the GLOBAL section, linking to /ci-runs, regardless of repo state", () => {
    render(<Sidebar ctx={makeCtx({ repoId: null })} />);

    expect(screen.getByText("GLOBAL")).not.toBeNull();
    const link = screen.getByText("CI Runs").closest("a");
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute("href", "/ci-runs");
  });
});

describe("activeKeyFor collision resolution (T10: /tour vs the /onboarding Add-Repo wizard)", () => {
  it("resolves a repo-scoped tour route to onboarding-tour", () => {
    expect(activeKeyFor("/repos/repo-1/tour")).toBe("onboarding-tour");
  });

  it("leaves the unrelated Add-Repo wizard route's resolution unchanged", () => {
    expect(activeKeyFor("/onboarding")).toBe("onboarding-tour");
  });
});
