import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/skills.json";

const mutate = vi.fn();
vi.mock("@/lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate, isPending: false, isSuccess: false, data: undefined }),
}));
vi.mock("@/lib/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

import { ConfigTab } from "./ConfigTab";

afterEach(() => {
  cleanup();
  mutate.mockReset();
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

  it("saves the current form via the update mutation", () => {
    renderWithIntl(<ConfigTab skill={SKILL} />);
    fireEvent.click(screen.getByText("Save"));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toMatchObject({
      id: "sk1",
      patch: { name: "pr-quality-rubric", type: "rubric", enabled: true },
    });
  });
});
