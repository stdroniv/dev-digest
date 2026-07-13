import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import agentsMessages from "../../../../../../messages/en/agents.json";
import ciMessages from "../../../../../../messages/en/ci.json";
import { ToastProvider } from "@/lib/toast";

// Mock the data hooks so the editor renders without a network/query client.
vi.mock("../../../../../lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
}));

// The Stats/CI tabs (SPEC-05 T12) read via `@/lib/hooks/ci`; the CI tab also
// module-imports `ExportWizard`, which imports the same module (unused
// unless the wizard is actually opened, but must still resolve).
vi.mock("@/lib/hooks/ci", () => ({
  useAgentRuns: () => ({ data: [], isLoading: false }),
  useCiInstallations: () => ({ data: [], isLoading: false }),
  useExportPreview: () => ({ mutate: vi.fn(), data: undefined, isPending: false }),
  useExportInstall: () => ({ mutate: vi.fn(), data: undefined, isPending: false, error: null }),
  useExportZip: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { AgentEditor } from "./AgentEditor";

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages, ci: ciMessages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("A2 Agent Editor (smoke)", () => {
  it("renders the Config tab fields", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Save agent")).toBeInTheDocument();
  });
});

// SPEC-05 T12 — tab-bar wiring: `constants.ts` TABS + this branch must both
// resolve "stats"/"ci" (the ?tab= allow-list is `constants.ts`'s
// VALID_AGENT_TABS, covered separately by page.test.tsx).
describe("A2 Agent Editor — Stats/CI tab wiring (AC-38/42)", () => {
  it("renders the Stats tab's empty state for tab=stats", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="stats" onTab={() => {}} />);
    expect(screen.getByText("No runs yet")).toBeInTheDocument();
  });

  it("renders the CI tab's 'Not in CI yet' empty state for tab=ci", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="ci" onTab={() => {}} />);
    expect(screen.getByText("Not in CI yet")).toBeInTheDocument();
    expect(screen.getByText("Add to CI")).toBeInTheDocument();
  });

  it("shows both tab labels in the tab bar", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Stats")).toBeInTheDocument();
    expect(screen.getByText("CI")).toBeInTheDocument();
  });
});
