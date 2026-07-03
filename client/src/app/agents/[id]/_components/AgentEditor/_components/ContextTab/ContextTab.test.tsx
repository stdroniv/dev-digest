import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentDocumentLink, ProjectDocument, Repo } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/agents.json";

const REPO: Repo = {
  id: "r1",
  workspace_id: "w1",
  owner: "acme",
  name: "payments-api",
  full_name: "acme/payments-api",
  default_branch: "main",
  clone_path: "/clones/r1",
  last_polled_at: null,
  created_by: null,
};
const REPO_2: Repo = {
  id: "r2",
  workspace_id: "w1",
  owner: "acme",
  name: "other-repo",
  full_name: "acme/other-repo",
  default_branch: "main",
  clone_path: "/clones/r2",
  last_polled_at: null,
  created_by: null,
};

const DOCS: ProjectDocument[] = [
  { path: "specs/SPEC-01.md", root: "specs", tokens: 120 },
  { path: "docs/architecture.md", root: "docs", tokens: 80 },
];
const REPO_DOCS_READY = { documents: DOCS, state: "ready" as const };
const REPO_DOCS_EMPTY = { documents: [] as ProjectDocument[], state: "empty" as const };

const setMutate = vi.fn();

// Module-level, per-repo stable link arrays — the hydration effect in
// `useDocumentAttachment` depends on the `links` reference, so returning a
// fresh array literal per render (even per repo) would infinite-loop the
// component (client/INSIGHTS.md).
const LINKS_R1: AgentDocumentLink[] = [{ path: "specs/SPEC-01.md", order: 0, repo_id: "r1" }];
const LINKS_R2: AgentDocumentLink[] = [];
let linksByRepo: Record<string, AgentDocumentLink[]> = { r1: LINKS_R1, r2: LINKS_R2 };

// Mutable "active repo" the mocked `useActiveRepo()` reads — tests reassign
// this then call RTL's `rerender` to simulate switching the global nav repo
// (client/INSIGHTS.md "master/detail selection lives outside props" pattern).
let activeRepo: Repo | null = REPO;
let repoDocsOverride: { documents: ProjectDocument[]; state: "ready" | "not_cloned" | "empty" } | null =
  null;

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo,
    repoId: activeRepo?.id ?? null,
    repos: [REPO, REPO_2],
    setRepoId: () => {},
    reposLoaded: true,
  }),
}));

vi.mock("@/lib/hooks/documents", () => ({
  useRepoDocuments: () => ({ data: repoDocsOverride ?? REPO_DOCS_READY, isLoading: false }),
  useAgentDocuments: (_id: string, repoId: string | null) => ({
    data: repoId ? linksByRepo[repoId] : undefined,
    isLoading: false,
  }),
  useSetAgentDocuments: () => ({ mutate: setMutate, isPending: false }),
  useDocumentPreview: () => ({ data: undefined, isLoading: false }),
}));

import { ContextTab } from "./ContextTab";

afterEach(() => {
  cleanup();
  setMutate.mockReset();
  linksByRepo = { r1: [{ path: "specs/SPEC-01.md", order: 0, repo_id: "r1" }], r2: [] };
  activeRepo = REPO;
  repoDocsOverride = null;
});

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "x",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("Agent ContextTab", () => {
  it("lists the repo's documents with an origin-root badge and the summed token volume", () => {
    renderWithIntl(<ContextTab agent={AGENT} />);
    expect(screen.getByText("specs/SPEC-01.md")).toBeInTheDocument();
    expect(screen.getByText("docs/architecture.md")).toBeInTheDocument();
    expect(screen.getByText("specs")).toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
    // Only specs/SPEC-01.md (120 tok) is attached initially.
    expect(screen.getByText("120 tokens attached")).toBeInTheDocument();
  });

  it("renders the untrusted-block note", () => {
    renderWithIntl(<ContextTab agent={AGENT} />);
    expect(screen.getByRole("note")).toHaveTextContent(/untrusted/i);
  });

  it("has no repo dropdown and no repo-mismatch confirm modal", () => {
    renderWithIntl(<ContextTab agent={AGENT} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("coalesces the Checkbox's double-fire into one mutation (no add-back)", () => {
    // The vendored Checkbox (<button> in <label>) fires onChange twice per click.
    // Without the in-flight guard the second fire re-attaches the just-detached doc.
    renderWithIntl(<ContextTab agent={AGENT} />);
    // specs/SPEC-01.md is the only linked doc; its checkbox is the first row's.
    const checkbox = screen.getAllByRole("checkbox")[0]!;
    fireEvent.click(checkbox); // genuine click → detach
    fireEvent.click(checkbox); // label's spurious re-dispatch → must be ignored

    expect(setMutate).toHaveBeenCalledTimes(1);
    expect(setMutate.mock.calls[0]![0]).toEqual({ paths: [], repoId: "r1" }); // removed, not re-added
  });

  it("updates the token-volume label as the attached selection changes", () => {
    renderWithIntl(<ContextTab agent={AGENT} />);
    expect(screen.getByText("120 tokens attached")).toBeInTheDocument();

    // Attach the second doc too (single click — genuine attach, not a double-fire).
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]!);

    expect(screen.getByText("200 tokens attached")).toBeInTheDocument();
    expect(setMutate).toHaveBeenCalledTimes(1);
    expect(setMutate.mock.calls[0]![0]).toEqual({
      paths: ["specs/SPEC-01.md", "docs/architecture.md"],
      repoId: "r1",
    });
  });

  it("produces the reordered paths array on a drag-reorder, always including repoId", () => {
    linksByRepo.r1 = [
      { path: "specs/SPEC-01.md", order: 0, repo_id: "r1" },
      { path: "docs/architecture.md", order: 1, repo_id: "r1" },
    ];
    renderWithIntl(<ContextTab agent={AGENT} />);

    const rows = screen.getAllByRole("checkbox").map((cb) => cb.closest("div[draggable]")!);
    const [firstRow, secondRow] = rows;

    // Drag the second row (docs/architecture.md) and drop it onto the first
    // row (specs/SPEC-01.md) — it should move ahead of it.
    fireEvent.dragStart(secondRow!);
    fireEvent.dragOver(firstRow!);
    fireEvent.drop(firstRow!);

    expect(setMutate).toHaveBeenCalledTimes(1);
    expect(setMutate.mock.calls[0]![0]).toEqual({
      paths: ["docs/architecture.md", "specs/SPEC-01.md"],
      repoId: "r1",
    });
  });

  describe("per-repository independence (no anchor/confirm-clear)", () => {
    it("switching the globally active repo shows the OTHER repo's independent attached list with no clear/confirm step", () => {
      linksByRepo.r1 = [{ path: "specs/SPEC-01.md", order: 0, repo_id: "r1" }];
      linksByRepo.r2 = [{ path: "docs/architecture.md", order: 0, repo_id: "r2" }];

      const { rerender } = renderWithIntl(<ContextTab agent={AGENT} />);
      // repo r1: only specs/SPEC-01.md attached.
      expect(screen.getAllByRole("checkbox")[0]).toBeChecked();
      expect(screen.getAllByRole("checkbox")[1]).not.toBeChecked();

      // Switch the globally active repo (no dialog, no gating).
      activeRepo = REPO_2;
      rerender(
        <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
          <ContextTab agent={AGENT} />
        </NextIntlClientProvider>,
      );

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(setMutate).not.toHaveBeenCalled();
      // repo r2: only docs/architecture.md attached — an INDEPENDENT list
      // (attached docs sort first, so the attached one is now row 0).
      const specsCheckbox = screen
        .getByText("specs/SPEC-01.md")
        .closest("div[draggable]")!
        .querySelector('[role="checkbox"]')!;
      const architectureCheckbox = screen
        .getByText("docs/architecture.md")
        .closest("div[draggable]")!
        .querySelector('[role="checkbox"]')!;
      expect(specsCheckbox).not.toBeChecked();
      expect(architectureCheckbox).toBeChecked();
    });

    it("attaching a doc while browsing the new repo mutates immediately with that repo's id (no clear-first step)", () => {
      linksByRepo.r1 = [{ path: "specs/SPEC-01.md", order: 0, repo_id: "r1" }];
      linksByRepo.r2 = [];

      const { rerender } = renderWithIntl(<ContextTab agent={AGENT} />);
      activeRepo = REPO_2;
      rerender(
        <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
          <ContextTab agent={AGENT} />
        </NextIntlClientProvider>,
      );

      const checkboxes = screen.getAllByRole("checkbox");
      fireEvent.click(checkboxes[0]!); // attach specs/SPEC-01.md under repo r2

      expect(setMutate).toHaveBeenCalledTimes(1);
      expect(setMutate.mock.calls[0]![0]).toEqual({
        paths: ["specs/SPEC-01.md"],
        repoId: "r2",
      });
    });
  });

  describe("AC-38 — no active repo", () => {
    it("renders the select-a-repository prompt when there is no active repo", () => {
      activeRepo = null;
      renderWithIntl(<ContextTab agent={AGENT} />);

      expect(screen.getByText(messages.context.selectRepoTitle)).toBeInTheDocument();
      expect(screen.getByText(messages.context.selectRepoBody)).toBeInTheDocument();
      // Distinct from the AC-4 "repo selected, zero docs" empty state.
      expect(screen.queryByText(messages.context.emptyTitle)).not.toBeInTheDocument();
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    });

    it("renders the distinct AC-4 empty state (not the AC-38 prompt) when a repo is active but has zero docs", () => {
      repoDocsOverride = REPO_DOCS_EMPTY;
      linksByRepo.r1 = [];
      renderWithIntl(<ContextTab agent={AGENT} />);

      expect(screen.getByText(messages.context.emptyTitle)).toBeInTheDocument();
      expect(screen.queryByText(messages.context.selectRepoTitle)).not.toBeInTheDocument();
    });
  });

  describe("AC-36 / AC-37 — filter and counts", () => {
    it("always shows the attached count, independent of the filter", () => {
      renderWithIntl(<ContextTab agent={AGENT} />);
      expect(screen.getByText("1 attached")).toBeInTheDocument();
    });

    it("narrows the visible rows by case-insensitive path substring", () => {
      renderWithIntl(<ContextTab agent={AGENT} />);
      expect(screen.getByText("specs/SPEC-01.md")).toBeInTheDocument();
      expect(screen.getByText("docs/architecture.md")).toBeInTheDocument();

      fireEvent.change(screen.getByPlaceholderText(messages.context.filterPlaceholder), {
        target: { value: "arch" },
      });

      expect(screen.queryByText("specs/SPEC-01.md")).not.toBeInTheDocument();
      expect(screen.getByText("docs/architecture.md")).toBeInTheDocument();
    });

    it("shows the 'N of M shown' badge only while filtering, matching the visible row count", () => {
      renderWithIntl(<ContextTab agent={AGENT} />);
      expect(screen.queryByText(/of 2 shown/)).not.toBeInTheDocument();

      fireEvent.change(screen.getByPlaceholderText(messages.context.filterPlaceholder), {
        target: { value: "arch" },
      });

      expect(screen.getByText("1 of 2 shown")).toBeInTheDocument();
    });
  });
});
