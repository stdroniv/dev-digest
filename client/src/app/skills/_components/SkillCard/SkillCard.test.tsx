import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";
import { SkillCard } from "./SkillCard";

afterEach(cleanup);

const SKILL: Skill = {
  id: "sk1",
  name: "secret-leakage-gate",
  description: "Detects committed secrets.",
  type: "security",
  source: "community",
  body: "# Rule",
  enabled: true,
  version: 1,
  evidence_files: null,
  tokens: 88,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("SkillCard", () => {
  it("renders the name, type badge and source label", () => {
    renderWithIntl(<SkillCard skill={SKILL} />);
    expect(screen.getByText("secret-leakage-gate")).toBeInTheDocument();
    expect(screen.getByText("security")).toBeInTheDocument();
    expect(screen.getByText("Community")).toBeInTheDocument();
  });

  it("shows a 'needs vetting' hint for a disabled skill from an untrusted source", () => {
    renderWithIntl(<SkillCard skill={{ ...SKILL, enabled: false, source: "imported_url" }} />);
    expect(screen.getByText("needs vetting")).toBeInTheDocument();
  });

  it("does not show 'needs vetting' for a disabled MANUAL skill", () => {
    renderWithIntl(<SkillCard skill={{ ...SKILL, enabled: false, source: "manual" }} />);
    expect(screen.queryByText("needs vetting")).not.toBeInTheDocument();
  });

  it("fires onToggle when the enabled switch is clicked", () => {
    const onToggle = vi.fn();
    const { container } = renderWithIntl(<SkillCard skill={SKILL} onToggle={onToggle} />);
    // Toggle renders a single button in the card header.
    fireEvent.click(container.querySelector("button")!);
    expect(onToggle).toHaveBeenCalledWith(false);
  });
});
