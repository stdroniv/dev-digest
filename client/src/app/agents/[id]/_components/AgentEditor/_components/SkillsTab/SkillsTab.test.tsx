import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentSkillLink, Skill } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/agents.json";

const SKILLS: Skill[] = [
  { id: "s1", name: "secret-leakage-gate", description: "secrets", type: "security", source: "community", body: "x", enabled: true, version: 1, evidence_files: null },
  { id: "s2", name: "no-then-chains", description: "async", type: "convention", source: "extracted", body: "x", enabled: true, version: 1, evidence_files: null },
  { id: "s3", name: "test-coverage-nudge", description: "tests", type: "custom", source: "manual", body: "x", enabled: false, version: 1, evidence_files: null },
];
const LINKS: AgentSkillLink[] = [{ agent_id: "ag1", skill_id: "s1", order: 0 }];

const setMutate = vi.fn();
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS, isLoading: false }),
  useAgentSkillLinks: () => ({ data: LINKS, isLoading: false }),
  useSetAgentSkills: () => ({ mutate: setMutate, isPending: false }),
}));

import { SkillsTab } from "./SkillsTab";

afterEach(() => {
  cleanup();
  setMutate.mockReset();
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

describe("Agent SkillsTab", () => {
  it("lists all skills and shows the linked-count badge", () => {
    renderWithIntl(<SkillsTab agent={AGENT} />);
    expect(screen.getByText("secret-leakage-gate")).toBeInTheDocument();
    expect(screen.getByText("no-then-chains")).toBeInTheDocument();
    expect(screen.getByText("test-coverage-nudge")).toBeInTheDocument();
    // 1 of 3 attached
    expect(screen.getByText("1 of 3 enabled")).toBeInTheDocument();
  });

  it("renders a 'disabled' marker for a disabled skill", () => {
    renderWithIntl(<SkillsTab agent={AGENT} />);
    expect(screen.getByText("disabled")).toBeInTheDocument();
  });

  it("coalesces the Checkbox's double-fire into one mutation (no add-back)", () => {
    // The vendored Checkbox (<button> in <label>) fires onChange twice per click.
    // Without the in-flight guard the second fire re-adds the just-removed skill.
    // mutate never calls onSettled here, so the guard stays set across both fires.
    renderWithIntl(<SkillsTab agent={AGENT} />);
    // s1 is the only linked skill; its checkbox is the first role="checkbox".
    const checkbox = screen.getAllByRole("checkbox")[0]!;
    fireEvent.click(checkbox); // genuine click → disable s1
    fireEvent.click(checkbox); // label's spurious re-dispatch → must be ignored

    expect(setMutate).toHaveBeenCalledTimes(1);
    expect(setMutate.mock.calls[0]![0]).toEqual([]); // s1 removed, not re-added
  });
});
