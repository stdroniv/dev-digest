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

const DOCS: ProjectDocument[] = [
  { path: "specs/SPEC-01.md", root: "specs", tokens: 120 },
  { path: "docs/architecture.md", root: "docs", tokens: 80 },
];
// Stable wrapper references — recreating these per-render (like a real
// `useQuery` would only do on an actual refetch) would retrigger the
// hydration effect on every render and infinite-loop the component.
const REPOS: Repo[] = [REPO];
const REPO_DOCS = { documents: DOCS, state: "ready" as const };

const setMutate = vi.fn();
let LINKS: AgentDocumentLink[] = [{ path: "specs/SPEC-01.md", order: 0 }];

vi.mock("@/lib/hooks/core", () => ({
  useRepos: () => ({ data: REPOS, isLoading: false }),
}));

vi.mock("@/lib/hooks/documents", () => ({
  useRepoDocuments: () => ({ data: REPO_DOCS, isLoading: false }),
  useAgentDocuments: () => ({ data: LINKS, isLoading: false }),
  useSetAgentDocuments: () => ({ mutate: setMutate, isPending: false }),
  useDocumentPreview: () => ({ data: undefined, isLoading: false }),
}));

import { ContextTab } from "./ContextTab";

afterEach(() => {
  cleanup();
  setMutate.mockReset();
  LINKS = [{ path: "specs/SPEC-01.md", order: 0 }];
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

  it("coalesces the Checkbox's double-fire into one mutation (no add-back)", () => {
    // The vendored Checkbox (<button> in <label>) fires onChange twice per click.
    // Without the in-flight guard the second fire re-attaches the just-detached doc.
    renderWithIntl(<ContextTab agent={AGENT} />);
    // specs/SPEC-01.md is the only linked doc; its checkbox is the first row's.
    const checkbox = screen.getAllByRole("checkbox")[0]!;
    fireEvent.click(checkbox); // genuine click → detach
    fireEvent.click(checkbox); // label's spurious re-dispatch → must be ignored

    expect(setMutate).toHaveBeenCalledTimes(1);
    expect(setMutate.mock.calls[0]![0]).toEqual([]); // removed, not re-added
  });

  it("updates the token-volume label as the attached selection changes", () => {
    renderWithIntl(<ContextTab agent={AGENT} />);
    expect(screen.getByText("120 tokens attached")).toBeInTheDocument();

    // Attach the second doc too (single click — genuine attach, not a double-fire).
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]!);

    expect(screen.getByText("200 tokens attached")).toBeInTheDocument();
    expect(setMutate).toHaveBeenCalledTimes(1);
    expect(setMutate.mock.calls[0]![0]).toEqual(["specs/SPEC-01.md", "docs/architecture.md"]);
  });

  it("produces the reordered paths array on a drag-reorder", () => {
    LINKS = [
      { path: "specs/SPEC-01.md", order: 0 },
      { path: "docs/architecture.md", order: 1 },
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
    expect(setMutate.mock.calls[0]![0]).toEqual(["docs/architecture.md", "specs/SPEC-01.md"]);
  });
});
