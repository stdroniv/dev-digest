import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, CiInstallation } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/ci.json";

const updateMutate = vi.fn();

let installationsState: { data: CiInstallation[]; isLoading: boolean };

vi.mock("@/lib/hooks/ci", () => ({
  useCiInstallations: () => installationsState,
  // ExportWizard (mounted when the wizard opens) reads these from the same module.
  useExportPreview: () => ({ mutate: vi.fn(), data: undefined, isPending: false }),
  useExportInstall: () => ({ mutate: vi.fn(), data: undefined, isPending: false, error: null }),
  useExportZip: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: updateMutate, isPending: false }),
}));

import { CiTab } from "./CiTab";

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

const INSTALLATIONS: CiInstallation[] = [
  {
    id: "inst1",
    agent_id: "ag1",
    repo: "acme/payments-api",
    target_type: "gha",
    target: "gha",
    installed_at: "2026-07-01T00:00:00.000Z",
    workflow_version: 2,
    status: "succeeded",
    last_run_at: new Date(Date.now() - 4 * 60_000).toISOString(),
    update_available: false,
  },
  {
    id: "inst2",
    agent_id: "ag1",
    repo: "acme/billing-worker",
    target_type: "gha",
    target: "gha",
    installed_at: "2026-07-01T00:00:00.000Z",
    workflow_version: 1,
    status: "succeeded",
    last_run_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    update_available: true,
  },
];

function renderTab(agent: Agent = AGENT) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
      <CiTab agent={agent} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  installationsState = { data: [], isLoading: false };
});

afterEach(() => {
  cleanup();
  updateMutate.mockReset();
});

describe("CiTab — empty state (AC-38)", () => {
  it("shows 'Not in CI yet' with an 'Add to CI' CTA that opens the Export Wizard", () => {
    renderTab();

    expect(screen.getByText("Not in CI yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Deploy this agent to run automatically on every pull request in a repo's CI pipeline.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Add to CI"));

    expect(screen.getByText("Export to CI")).toBeInTheDocument();
  });
});

describe("CiTab — exported state (AC-39/40/21)", () => {
  beforeEach(() => {
    installationsState = { data: INSTALLATIONS, isLoading: false };
  });

  it("shows the CI deployment header and the active-repo count", () => {
    renderTab();
    expect(screen.getByText("CI deployment")).toBeInTheDocument();
    expect(screen.getByText("Active in 2 repos")).toBeInTheDocument();
  });

  it("renders the 3-way Fail CI on control with the agent's current value pressed", () => {
    renderTab();
    const critical = screen.getByRole("button", { name: "Critical" });
    const warning = screen.getByRole("button", { name: "Warning +" });
    const never = screen.getByRole("button", { name: "Never" });

    expect(critical).toHaveAttribute("aria-pressed", "true");
    expect(warning).toHaveAttribute("aria-pressed", "false");
    expect(never).toHaveAttribute("aria-pressed", "false");
  });

  it("persists a Fail CI on change via useUpdateAgent", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Warning +" }));

    expect(updateMutate).toHaveBeenCalledWith({
      id: "ag1",
      patch: { ci_fail_on: "warning" },
    });
  });

  it("renders one row per installation, with an 'update available' indicator only on the drifted repo", () => {
    renderTab();

    expect(screen.getByText("acme/payments-api")).toBeInTheDocument();
    expect(screen.getByText("acme/billing-worker")).toBeInTheDocument();
    expect(screen.getAllByText("GitHub Actions").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();

    expect(screen.getAllByText("Update available")).toHaveLength(1);
  });

  it("'Add to CI' and 'Add repository' both open the Export Wizard", () => {
    renderTab();
    fireEvent.click(screen.getByText("Add repository"));
    expect(screen.getByText("Export to CI")).toBeInTheDocument();
  });

  it("'Update CI config' opens the Export Wizard (AC-39)", () => {
    renderTab();
    fireEvent.click(screen.getByText("Update CI config"));
    expect(screen.getByText("Export to CI")).toBeInTheDocument();
  });
});
