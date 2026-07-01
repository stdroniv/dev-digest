import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ProjectDocument, Repo, Skill, SkillDocumentLink } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/skills.json";

const mutate = vi.fn();
const createMutate = vi.fn();
const deleteMutate = vi.fn();
const push = vi.fn();
vi.mock("@/lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate, isPending: false, isSuccess: false, data: undefined }),
  useCreateSkill: () => ({ mutate: createMutate, isPending: false }),
  useDeleteSkill: () => ({ mutate: deleteMutate, isPending: false }),
}));
vi.mock("@/lib/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

// --- Project context "Documents" section mocks (T13) -----------------------
const REPOS: Repo[] = [
  {
    id: "r1",
    workspace_id: "w1",
    owner: "acme",
    name: "widgets",
    full_name: "acme/widgets",
    default_branch: "main",
    clone_path: "/tmp/acme-widgets",
    last_polled_at: null,
    created_by: null,
  },
];
const DOCS: ProjectDocument[] = [
  { path: "specs/SPEC-01.md", root: "specs", tokens: 120 },
  { path: "docs/architecture.md", root: "docs", tokens: 80 },
];
const DOC_LINKS: SkillDocumentLink[] = [{ path: "specs/SPEC-01.md", order: 0 }];

const setDocsMutate = vi.fn();
vi.mock("@/lib/hooks/core", () => ({
  useRepos: () => ({ data: REPOS, isLoading: false }),
}));
vi.mock("@/lib/hooks/documents", () => ({
  useRepoDocuments: () => ({ data: { documents: DOCS, state: "ready" }, isLoading: false }),
  useSkillDocuments: () => ({ data: DOC_LINKS, isLoading: false }),
  useSetSkillDocuments: () => ({ mutate: setDocsMutate, isPending: false }),
  useDocumentPreview: () => ({
    data: { path: "docs/architecture.md", content: "Architecture doc preview content." },
    isLoading: false,
  }),
}));

import { ConfigTab } from "./ConfigTab";

afterEach(() => {
  cleanup();
  mutate.mockReset();
  createMutate.mockReset();
  deleteMutate.mockReset();
  push.mockReset();
  setDocsMutate.mockReset();
});

const SKILL: Skill = {
  id: "sk1",
  name: "pr-quality-rubric",
  description: "Rubric for PR quality.",
  type: "rubric",
  source: "manual",
  body: "# PR Quality Rubric\nEvaluate the PR.",
  enabled: true,
  version: 5,
  evidence_files: null,
  tokens: 166,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("Skill ConfigTab", () => {
  it("renders the name, version and the live token-count badge", () => {
    renderWithIntl(<ConfigTab skill={SKILL} />);
    expect(screen.getByDisplayValue("pr-quality-rubric")).toBeInTheDocument();
    expect(screen.getByText("166 tokens")).toBeInTheDocument();
    expect(screen.getByText("v5")).toBeInTheDocument();
  });

  it("shows a Draft badge instead of a version for an unsaved (v0) skill", () => {
    renderWithIntl(<ConfigTab skill={{ ...SKILL, version: 0 }} />);
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.queryByText("v0")).not.toBeInTheDocument();
  });

  it("disables Save until a field changes, then patches only what changed", () => {
    renderWithIntl(<ConfigTab skill={SKILL} />);
    const saveBtn = screen.getByText("Save").closest("button")!;
    expect(saveBtn).toBeDisabled();

    fireEvent.change(screen.getByDisplayValue("pr-quality-rubric"), {
      target: { value: "renamed-rubric" },
    });
    expect(saveBtn).toBeEnabled();

    fireEvent.click(saveBtn);
    expect(mutate).toHaveBeenCalledTimes(1);
    // Only the edited field is sent — the unchanged body is omitted so it does
    // not spuriously bump (or fail to bump) the server-side version.
    expect(mutate.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ id: "sk1", patch: { name: "renamed-rubric" } }),
    );
  });

  it("includes the body in the patch when the body changes", () => {
    renderWithIntl(<ConfigTab skill={SKILL} />);
    fireEvent.change(screen.getByDisplayValue(/Evaluate the PR\./), {
      target: { value: "# PR Quality Rubric\nEvaluate it thoroughly." },
    });
    fireEvent.click(screen.getByText("Save"));
    expect(mutate.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        patch: { body: "# PR Quality Rubric\nEvaluate it thoroughly." },
      }),
    );
  });

  it("does not render the delete control in create mode", () => {
    renderWithIntl(
      <ConfigTab
        create={{ defaultName: "new-skill", defaultBody: "# New skill", onCreated: vi.fn(), onCancel: vi.fn() }}
      />,
    );
    expect(screen.queryByText("Delete skill")).not.toBeInTheDocument();
  });

  it("opens a confirmation modal and Cancel closes it without deleting", () => {
    renderWithIntl(<ConfigTab skill={SKILL} />);
    fireEvent.click(screen.getByText("Delete skill"));
    // Modal is up (title shown), nothing deleted yet.
    expect(screen.getByText("Delete this skill?")).toBeInTheDocument();
    expect(deleteMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText("Delete this skill?")).not.toBeInTheDocument();
    expect(deleteMutate).not.toHaveBeenCalled();
  });

  it("confirming the modal deletes the skill, then toasts and routes to /skills", () => {
    renderWithIntl(<ConfigTab skill={SKILL} />);
    fireEvent.click(screen.getByText("Delete skill"));
    // The modal's confirm button (distinct from the trigger label "Delete skill").
    fireEvent.click(screen.getByText("Delete"));

    expect(deleteMutate).toHaveBeenCalledTimes(1);
    expect(deleteMutate.mock.calls[0]![0]).toBe("sk1");

    // Drive the success path the component passes to mutate.
    deleteMutate.mock.calls[0]![1].onSuccess();
    expect(push).toHaveBeenCalledWith("/skills");
  });

  it("in create mode persists nothing until Save, then POSTs the new skill", () => {
    const onCreated = vi.fn();
    renderWithIntl(
      <ConfigTab
        create={{
          defaultName: "new-skill 2",
          defaultBody: "# New skill",
          onCreated,
          onCancel: vi.fn(),
        }}
      />,
    );
    // Seeded with the unique default name and a Draft badge; no create call yet.
    expect(screen.getByDisplayValue("new-skill 2")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(createMutate).not.toHaveBeenCalled();

    // Save is enabled immediately (name + body present) and creates the skill.
    fireEvent.click(screen.getByText("Save").closest("button")!);
    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ name: "new-skill 2", body: "# New skill", type: "custom" }),
    );
  });

  describe("Project context to use (documents section)", () => {
    it("lists discovered docs with origin badges and the initial token volume", () => {
      renderWithIntl(<ConfigTab skill={SKILL} />);
      expect(screen.getByText("Project context to use")).toBeInTheDocument();
      expect(screen.getByText("specs/SPEC-01.md")).toBeInTheDocument();
      expect(screen.getByText("docs/architecture.md")).toBeInTheDocument();
      expect(screen.getByText("specs")).toBeInTheDocument(); // origin-root badge
      expect(screen.getByText("docs")).toBeInTheDocument(); // origin-root badge
      // Only "specs/SPEC-01.md" (120 tokens) is linked initially.
      expect(screen.getByText("120 tokens attached")).toBeInTheDocument();
      // The untrusted note is rendered.
      expect(
        screen.getByText(/injected into every run of this skill's agents as an untrusted/),
      ).toBeInTheDocument();
    });

    it("shows the in-row preview content when the preview toggle is clicked", () => {
      renderWithIntl(<ConfigTab skill={SKILL} />);
      fireEvent.click(screen.getByLabelText("Preview: docs/architecture.md"));
      expect(screen.getByText("Architecture doc preview content.")).toBeInTheDocument();
    });

    it("attaching a document persists via its OWN mutation and updates the token volume — WITHOUT touching the skill body PATCH", () => {
      renderWithIntl(<ConfigTab skill={SKILL} />);

      // Row order is [specs/SPEC-01.md (linked), docs/architecture.md (unlinked)];
      // its checkbox is the second role="checkbox".
      const checkbox = screen.getAllByRole("checkbox")[1]!;
      fireEvent.click(checkbox);

      expect(setDocsMutate).toHaveBeenCalledTimes(1);
      expect(setDocsMutate.mock.calls[0]![0]).toEqual(["specs/SPEC-01.md", "docs/architecture.md"]);
      expect(screen.getByText("200 tokens attached")).toBeInTheDocument();

      // Attaching a document must NEVER trigger the skill's body-only PATCH
      // mutation nor bump its version (client/INSIGHTS body-only versioning).
      expect(mutate).not.toHaveBeenCalled();
      // Save stays disabled — the Config form's own isDirty is untouched.
      expect(screen.getByText("Save").closest("button")).toBeDisabled();
    });

    it("coalesces the Checkbox's double-fire into one documents mutation (no add-back)", () => {
      renderWithIntl(<ConfigTab skill={SKILL} />);
      // "specs/SPEC-01.md" is the only linked doc; its checkbox is first.
      const checkbox = screen.getAllByRole("checkbox")[0]!;
      fireEvent.click(checkbox); // genuine click → detach
      fireEvent.click(checkbox); // label's spurious re-dispatch → must be ignored

      expect(setDocsMutate).toHaveBeenCalledTimes(1);
      expect(setDocsMutate.mock.calls[0]![0]).toEqual([]); // removed, not re-added
      expect(mutate).not.toHaveBeenCalled();
    });
  });
});
