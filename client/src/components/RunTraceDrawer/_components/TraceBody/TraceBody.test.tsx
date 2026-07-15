import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "../../../../../messages/en/runs.json";

import { TraceBody } from "./TraceBody";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">{ui}</div>
    </NextIntlClientProvider>,
  );
}

const BASE: Omit<
  RunTrace,
  | "specs_read"
  | "documents_read"
  | "documents_unavailable"
  | "documents_repo_excluded"
  | "prompt_assembly"
  | "stats"
> = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  tool_calls: [],
  raw_output: '{"verdict":"request_changes"}',
  memory_pulled: [],
  log: [],
};

describe("TraceBody — project-context trace fields (T14)", () => {
  it("renders read-doc paths, origin, token badge, unavailable note, and an expandable untrusted specs block", () => {
    const trace: RunTrace = {
      ...BASE,
      stats: {
        duration_ms: 8200,
        tokens_in: 12000,
        tokens_out: 1500,
        findings: 0,
        grounding: "2/2 passed",
        cost_usd: 0.06,
        specs_tokens: 340,
      },
      prompt_assembly: {
        system: "You are a reviewer.",
        skills: null,
        memory: null,
        specs: '<untrusted source="specs/invariants.md">Never bypass the rate limiter.</untrusted>',
        user: "Review PR #482",
      },
      specs_read: ["specs/invariants.md", "docs/architecture.md"],
      documents_read: [
        { path: "specs/invariants.md", tokens: 210, origin: { type: "agent" } },
        {
          path: "docs/architecture.md",
          tokens: 130,
          origin: { type: "skill", skill_id: "sk_1", skill_name: "Security Reviewer" },
        },
      ],
      documents_unavailable: ["specs/removed.md"],
      // AC-31 — a whole skill-level attached set excluded for a repo mismatch,
      // coexisting with the per-document `documents_unavailable` case above.
      documents_repo_excluded: [
        {
          origin: { type: "skill", skill_id: "sk_2", skill_name: "Naming Convention" },
          paths: ["specs/other-repo-a.md", "specs/other-repo-b.md"],
        },
      ],
    };

    renderWithIntl(<TraceBody trace={trace} findings={[]} />);

    // specs_read row still renders raw paths as mono chips (unchanged behavior);
    // documents_read renders the SAME path again alongside origin — 2 occurrences.
    expect(screen.getAllByText("specs/invariants.md")).toHaveLength(2);
    expect(screen.getAllByText("docs/architecture.md")).toHaveLength(2);

    // documents_read renders richer origin info.
    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();

    // documents_unavailable renders as a distinct note, not silently absent.
    expect(screen.getByText("Attached but unavailable")).toBeInTheDocument();
    expect(screen.getByText("specs/removed.md")).toBeInTheDocument();

    // documents_repo_excluded renders as a SECOND, visually/textually DISTINCT
    // block (different label from "Attached but unavailable") — never merged
    // into the same list, and never lists the individual excluded paths (they
    // were never resolved), only the origin + count.
    expect(screen.getByText("Excluded — different repository")).toBeInTheDocument();
    expect(screen.getByText("Naming Convention")).toBeInTheDocument();
    expect(screen.getByText("2 documents")).toBeInTheDocument();
    expect(screen.queryByText("specs/other-repo-a.md")).not.toBeInTheDocument();

    // Prompt assembly section defaults to collapsed — open it to reach the specs block.
    fireEvent.click(screen.getByText("Prompt assembly"));

    // token-volume badge on the specs PromptBlock, sourced from stats.specs_tokens.
    expect(screen.getByText("+340 tokens")).toBeInTheDocument();

    // the specs PromptBlock is expandable and shows the literal untrusted content.
    const specsLabel = screen.getByText("Project context — untrusted (dynamic)");
    const promptRow = specsLabel.closest("div")?.parentElement as HTMLElement;
    expect(within(promptRow).queryByText(/Never bypass the rate limiter/)).not.toBeInTheDocument();
    fireEvent.click(specsLabel);
    expect(within(promptRow).getByText(/Never bypass the rate limiter/)).toBeInTheDocument();
  });

  it("renders empty/legacy documents_read and documents_unavailable without error", () => {
    const trace: RunTrace = {
      ...BASE,
      stats: {
        duration_ms: 8200,
        tokens_in: 12000,
        tokens_out: 1500,
        findings: 0,
        grounding: "2/2 passed",
        cost_usd: 0.06,
      },
      prompt_assembly: {
        system: "You are a reviewer.",
        skills: null,
        memory: null,
        specs: null,
        user: "Review PR #482",
      },
      specs_read: [],
      documents_read: [],
      documents_unavailable: [],
      documents_repo_excluded: [],
    };

    renderWithIntl(<TraceBody trace={trace} findings={[]} />);

    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("none")).toBeInTheDocument();
    expect(screen.queryByText("Documents read")).not.toBeInTheDocument();
    expect(screen.queryByText("Attached but unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("Excluded — different repository")).not.toBeInTheDocument();
    expect(screen.queryByText("Project context — untrusted (dynamic)")).not.toBeInTheDocument();
  });

  it("renders without error when documents_repo_excluded is entirely MISSING from the trace object (older/legacy trace, relying on the client-side ?? [] guard)", () => {
    // Cast past the compile-time-required field to prove the RUNTIME guard in
    // TraceBody (not just the server-side Zod default) tolerates a genuinely
    // absent key — e.g. a trace persisted before this migration and read back
    // without ever being re-parsed through the current RunTrace schema.
    const legacyTrace = {
      ...BASE,
      stats: {
        duration_ms: 1000,
        tokens_in: 100,
        tokens_out: 50,
        findings: 0,
        grounding: "1/1 passed",
        cost_usd: 0.01,
      },
      prompt_assembly: {
        system: "You are a reviewer.",
        skills: null,
        memory: null,
        specs: null,
        user: "Review PR #1",
      },
      specs_read: [],
      documents_read: [],
      documents_unavailable: [],
      // documents_repo_excluded intentionally OMITTED.
    } as unknown as RunTrace;

    expect(() => renderWithIntl(<TraceBody trace={legacyTrace} findings={[]} />)).not.toThrow();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.queryByText("Excluded — different repository")).not.toBeInTheDocument();
  });
});
