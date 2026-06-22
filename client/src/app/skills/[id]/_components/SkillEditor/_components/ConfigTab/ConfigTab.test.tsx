import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/skills.json";

const mutate = vi.fn();
const createMutate = vi.fn();
vi.mock("@/lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate, isPending: false, isSuccess: false, data: undefined }),
  useCreateSkill: () => ({ mutate: createMutate, isPending: false }),
}));
vi.mock("@/lib/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

import { ConfigTab } from "./ConfigTab";

afterEach(() => {
  cleanup();
  mutate.mockReset();
  createMutate.mockReset();
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
});
