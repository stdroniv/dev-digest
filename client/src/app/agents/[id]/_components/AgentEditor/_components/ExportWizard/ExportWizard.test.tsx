import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, CiExport, CiFile } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/ci.json";
import { ApiError } from "@/lib/api";

const previewMutate = vi.fn();
const previewMutateAsync = vi.fn();
const installMutate = vi.fn();
const zipMutateAsync = vi.fn();

let previewState: { data: CiExport | undefined; isPending: boolean; error: unknown };
let installState: { data: CiExport | undefined; isPending: boolean; error: unknown };
let zipState: { isPending: boolean };

vi.mock("@/lib/hooks/ci", () => ({
  useExportPreview: () => ({ mutate: previewMutate, mutateAsync: previewMutateAsync, ...previewState }),
  useExportInstall: () => ({ mutate: installMutate, ...installState }),
  useExportZip: () => ({ mutateAsync: zipMutateAsync, ...zipState }),
}));

import { ExportWizard } from "./ExportWizard";

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

// AC-2/4/5/16: manifest + per-skill file + empty memory.jsonl + bundled
// runner + slug-keyed (not fixed-name) workflow.
const PREVIEW_FILES: CiFile[] = [
  {
    path: ".devdigest/agents/security-reviewer.yaml",
    contents: "name: Security Reviewer\nslug: security-reviewer\n",
    editable: true,
  },
  {
    path: ".devdigest/skills/secret-leakage-gate.md",
    contents: "# secret-leakage-gate\nDetects hardcoded secrets.\n",
    editable: true,
  },
  {
    path: ".devdigest/skills/lethal-trifecta.md",
    contents: "# lethal-trifecta\nFlags the lethal trifecta.\n",
    editable: true,
  },
  { path: ".devdigest/memory.jsonl", contents: "", editable: true },
  { path: ".devdigest/runner.mjs", contents: "// bundled agent-runner\n", editable: true },
  {
    path: ".github/workflows/devdigest-review-security-reviewer.yml",
    contents: "name: DevDigest Review\non:\n  pull_request:\n    types: [opened, synchronize]\n",
    editable: true,
  },
];

const PREVIEW_EXPORT = {
  installation: { id: "inst1" },
  files: PREVIEW_FILES,
  pr_url: null,
} as unknown as CiExport;

function renderWizard(onClose = vi.fn()) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
      <ExportWizard agent={AGENT} onClose={onClose} />
    </NextIntlClientProvider>,
  );
}

/** Fills the repo field and clicks Continue `times` times, advancing the
 *  wizard from the Target step to `1 + times`. Continue's handler is async
 *  (it awaits the preview mutation before the first step advances), so each
 *  click is wrapped in `act` and awaited before firing the next one. */
async function continueSteps(times: number) {
  const repoInput = screen.getByPlaceholderText("acme/payments-api");
  fireEvent.change(repoInput, { target: { value: "acme/payments-api" } });
  for (let i = 0; i < times; i++) {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });
  }
}

beforeEach(() => {
  previewState = { data: PREVIEW_EXPORT, isPending: false, error: null };
  installState = { data: undefined, isPending: false, error: null };
  zipState = { isPending: false };
  previewMutateAsync.mockResolvedValue(PREVIEW_EXPORT);
});

afterEach(() => {
  cleanup();
  previewMutate.mockReset();
  previewMutateAsync.mockReset();
  installMutate.mockReset();
  zipMutateAsync.mockReset();
});

describe("ExportWizard — Target step (AC-1)", () => {
  it("shows GitHub Actions as selectable + recommended, and the other 3 targets as disabled 'coming soon'", () => {
    renderWizard();

    const ghaButton = screen.getByText("GitHub Actions").closest("button")!;
    expect(ghaButton).not.toBeDisabled();
    expect(screen.getByText("recommended")).toBeInTheDocument();

    for (const name of ["CircleCI", "Jenkins", "Generic CLI"]) {
      const button = screen.getByText(name).closest("button")!;
      expect(button).toBeDisabled();
    }
    expect(screen.getAllByText("coming soon")).toHaveLength(3);
  });

  it("requires a repo before Continue is enabled", () => {
    renderWizard();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("acme/payments-api"), {
      target: { value: "acme/payments-api" },
    });
    expect(screen.getByRole("button", { name: "Continue" })).not.toBeDisabled();
  });

  it("keeps Continue disabled and shows an inline hint for a non-owner/name repo (e.g. a pasted URL)", () => {
    renderWizard();
    const repoInput = screen.getByPlaceholderText("acme/payments-api");

    fireEvent.change(repoInput, { target: { value: "https://github.com/stdroniv/dev-digest" } });
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.getByText(/owner\/name format/i)).toBeInTheDocument();

    fireEvent.change(repoInput, { target: { value: "stdroniv/dev-digest" } });
    expect(screen.getByRole("button", { name: "Continue" })).not.toBeDisabled();
    expect(screen.queryByText(/owner\/name format/i)).not.toBeInTheDocument();
  });

  it("advances to Preview only once the preview mutation resolves", async () => {
    let resolvePreview!: (value: CiExport) => void;
    previewMutateAsync.mockReturnValueOnce(
      new Promise<CiExport>((resolve) => {
        resolvePreview = resolve;
      }),
    );
    renderWizard();
    fireEvent.change(screen.getByPlaceholderText("acme/payments-api"), {
      target: { value: "acme/payments-api" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("GitHub Actions")).toBeInTheDocument(); // still on Target — preview hasn't resolved

    await act(async () => {
      resolvePreview(PREVIEW_EXPORT);
    });

    expect(screen.queryByText("GitHub Actions")).not.toBeInTheDocument(); // moved to Preview
  });

  it("stays on Target and shows an inline error banner when the preview call fails", async () => {
    const error = new ApiError("Repository not found or not accessible", 404, "not_found");
    // The mocked hook doesn't derive `error` from a rejected `mutateAsync` the
    // way real react-query would — set both so the mock mirrors that behavior.
    previewMutateAsync.mockRejectedValueOnce(error);
    previewState.error = error;
    renderWizard();
    fireEvent.change(screen.getByPlaceholderText("acme/payments-api"), {
      target: { value: "acme/payments-api" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });

    expect(screen.getByText("GitHub Actions")).toBeInTheDocument(); // still on Target
    expect(screen.getByRole("alert")).toHaveTextContent("Repository not found or not accessible");
  });
});

describe("ExportWizard — Preview step (AC-2/3/4/16)", () => {
  it("lists exactly the committed file set, incl. the bundled runner, empty memory.jsonl, and the slug-keyed workflow", async () => {
    renderWizard();
    await continueSteps(1);

    expect(screen.getByText(".devdigest/agents/security-reviewer.yaml")).toBeInTheDocument();
    expect(screen.getByText(".devdigest/skills/secret-leakage-gate.md")).toBeInTheDocument();
    expect(screen.getByText(".devdigest/skills/lethal-trifecta.md")).toBeInTheDocument();
    expect(screen.getByText(".devdigest/memory.jsonl")).toBeInTheDocument();
    expect(screen.getByText(".devdigest/runner.mjs")).toBeInTheDocument();
    // slug-keyed, not the fixed "devdigest-review.yml" (AC-16)
    expect(
      screen.getAllByText(".github/workflows/devdigest-review-security-reviewer.yml").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(".github/workflows/devdigest-review.yml")).not.toBeInTheDocument();
  });

  it("shows the selected file's contents and an 'editable' badge", async () => {
    renderWizard();
    await continueSteps(1);

    fireEvent.click(screen.getByText(".devdigest/skills/secret-leakage-gate.md"));

    expect(screen.getByText(/Detects hardcoded secrets\./)).toBeInTheDocument();
    expect(screen.getByText("editable")).toBeInTheDocument();
  });
});

describe("ExportWizard — Configure step (AC-6/7/8)", () => {
  it("defaults opened+synchronize on, reopened off", async () => {
    renderWizard();
    await continueSteps(2);

    const opened = screen.getByText("pull_request:opened").closest("button")!;
    const synchronize = screen.getByText("pull_request:synchronize").closest("button")!;
    const reopened = screen.getByText("pull_request:reopened").closest("button")!;

    expect(opened.querySelector("svg")).not.toBeNull();
    expect(synchronize.querySelector("svg")).not.toBeNull();
    expect(reopened.querySelector("svg")).toBeNull();
  });

  it("defaults 'Post results as' to GitHub review, labelled as the only verdict-yielding choice", async () => {
    renderWizard();
    await continueSteps(2);

    const ghRadio = screen.getByRole("radio", { name: /GitHub review/i });
    expect(ghRadio).toBeChecked();
    expect(screen.getByText("yields a verdict")).toBeInTheDocument();

    const prCommentRadio = screen.getByRole("radio", { name: /PR comment/i });
    expect(prCommentRadio).not.toBeChecked();
    fireEvent.click(prCommentRadio);
    expect(prCommentRadio).toBeChecked();
    expect(ghRadio).not.toBeChecked();
  });

  it("renders the merge-block hint mentioning Fail CI on, a required status check, and no GitHub App", async () => {
    renderWizard();
    await continueSteps(2);

    expect(screen.getByText(/Fail CI on/)).toBeInTheDocument();
    expect(screen.getByText(/required status check/i)).toBeInTheDocument();
    expect(screen.getByText(/No GitHub App needed/i)).toBeInTheDocument();
  });
});

describe("ExportWizard — Install step (AC-9/10/11/12)", () => {
  it("renders both the Open-a-PR path and the zip fallback, plus the docs footer", async () => {
    renderWizard();
    await continueSteps(3);

    expect(screen.getByText("Open a PR with these files")).toBeInTheDocument();
    expect(screen.getByText(/acme\/payments-api/)).toBeInTheDocument();
    expect(screen.getByText("Copy files as a zip")).toBeInTheDocument();
    expect(screen.getByText("GitHub Action setup docs →")).toBeInTheDocument();
  });

  it("on a failed install, shows the error and keeps the zip fallback available (AC-11)", async () => {
    installState = {
      data: undefined,
      isPending: false,
      error: new ApiError("No write access to acme/payments-api", 403, "forbidden"),
    };
    renderWizard();
    await continueSteps(3);

    expect(screen.getByRole("alert")).toHaveTextContent("No write access to acme/payments-api");
    expect(screen.getByText("Copy files as a zip")).toBeInTheDocument();
  });

  it("on a 422 unresolved-skill error, names the skill (AC-12)", async () => {
    installState = {
      data: undefined,
      isPending: false,
      error: new ApiError(
        "Skill 'lethal-trifecta' could not be resolved",
        422,
        "unresolved_skill",
      ),
    };
    renderWizard();
    await continueSteps(3);

    expect(screen.getByRole("alert")).toHaveTextContent("lethal-trifecta");
  });

  it("clicking Install triggers the install mutation with the wizard's current config", async () => {
    renderWizard();
    await continueSteps(3);

    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    expect(installMutate).toHaveBeenCalledWith({
      agentId: "ag1",
      input: {
        repo: "acme/payments-api",
        target: "gha",
        post_as: "github_review",
        triggers: ["opened", "synchronize"],
        base: "main",
      },
    });
  });

  it("clicking the zip card triggers the zip download mutation", async () => {
    zipMutateAsync.mockResolvedValueOnce(new Blob(["zip-bytes"]));
    renderWizard();
    await continueSteps(3);

    fireEvent.click(screen.getByText("Copy files as a zip"));

    expect(zipMutateAsync).toHaveBeenCalledWith("ag1");
  });

  it("once a PR is open, swaps Install for Complete, locks the PR card, and closes the modal without re-installing", async () => {
    installState = {
      data: { pr_url: "https://github.com/acme/payments-api/pull/14" } as unknown as CiExport,
      isPending: false,
      error: null,
    };
    const onClose = vi.fn();
    renderWizard(onClose);
    await continueSteps(3);

    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
    const completeButton = screen.getByRole("button", { name: "Complete" });
    const prCard = screen.getByText("PR opened").closest("button")!;
    expect(prCard).toBeDisabled();

    fireEvent.click(completeButton);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(installMutate).not.toHaveBeenCalled();
  });
});
