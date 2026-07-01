/**
 * ContextWorkspace — RTL + Vitest component tests (SPEC-01 T11).
 *
 * Acceptance criteria covered:
 * (AC-1/2) discovered docs render by repo-relative path with an origin-root badge.
 * (AC-3) selecting a doc shows a preview of its content.
 * (AC-4) `state: 'empty'` shows the explanatory empty-docs copy, not a bare/error view.
 * (AC-5) `state: 'not_cloned'` shows the explanatory not-cloned copy, not a generic error.
 * (AC-7) the search filter narrows the displayed list.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import contextMessages from "../../../../../../../messages/en/context.json";
import shellMessages from "../../../../../../../messages/en/shell.json";
import { ContextWorkspace } from "./ContextWorkspace";

// ---------------------------------------------------------------------------
// next/navigation mock — a tiny controllable store so router.push-driven
// query-param changes can be observed after an explicit rerender() (the real
// App Router re-renders on navigation; RTL needs a manual nudge here).
// ---------------------------------------------------------------------------
const pushMock = vi.fn();
let mockQuery = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (url: string, opts?: unknown) => {
      pushMock(url, opts);
      const qIdx = url.indexOf("?");
      mockQuery = qIdx >= 0 ? url.slice(qIdx + 1) : "";
    },
    replace: vi.fn(),
  }),
  usePathname: () => "/repos/repo-1/context",
  useSearchParams: () => new URLSearchParams(mockQuery),
}));

afterEach(() => {
  cleanup();
  pushMock.mockClear();
  mockQuery = "";
});

const REPO_ID = "repo-1";

const DOCS = [
  { path: "specs/SPEC-01-project-context.md", root: "specs", tokens: 120 },
  { path: "docs/guide.md", root: "docs", tokens: 80 },
];

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch(listResponse: unknown, contentByPath: Record<string, string> = {}) {
  global.fetch = vi.fn((url: unknown) => {
    const path = typeof url === "string" ? url : String(url);
    if (path.includes("/documents/content")) {
      const u = new URL(path);
      const docPath = u.searchParams.get("path") ?? "";
      const content = contentByPath[docPath];
      if (content === undefined) {
        return Promise.resolve(jsonResp({ error: { message: "not found" } }, 404));
      }
      return Promise.resolve(jsonResp({ path: docPath, content }));
    }
    return Promise.resolve(jsonResp(listResponse));
  }) as unknown as typeof fetch;
}

function renderWorkspace() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ context: contextMessages, shell: shellMessages }}>
        <ContextWorkspace repoId={REPO_ID} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("ContextWorkspace — ready state with documents", () => {
  it("renders discovered docs by path with an origin-root badge", async () => {
    mockFetch({ documents: DOCS, state: "ready" });
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByText("specs/SPEC-01-project-context.md")).toBeInTheDocument(),
    );
    expect(screen.getByText("docs/guide.md")).toBeInTheDocument();
    // origin-root badges
    expect(screen.getByText("specs")).toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
  });

  it("narrows the list via the search filter (AC-7)", async () => {
    mockFetch({ documents: DOCS, state: "ready" });
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByText("specs/SPEC-01-project-context.md")).toBeInTheDocument(),
    );

    const input = screen.getByPlaceholderText(contextMessages.page.searchPlaceholder);
    fireEvent.change(input, { target: { value: "guide" } });

    expect(screen.getByText("docs/guide.md")).toBeInTheDocument();
    expect(screen.queryByText("specs/SPEC-01-project-context.md")).not.toBeInTheDocument();
  });

  it("selecting a doc shows its preview (AC-3)", async () => {
    mockFetch({ documents: DOCS, state: "ready" }, { "docs/guide.md": "# Guide\n\nHello grounding." });
    const { rerender } = renderWorkspace();
    await waitFor(() =>
      expect(screen.getByText("docs/guide.md")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("docs/guide.md"));
    expect(pushMock).toHaveBeenCalledWith(
      expect.stringContaining("doc=docs%2Fguide.md"),
      { scroll: false },
    );

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <NextIntlClientProvider locale="en" messages={{ context: contextMessages, shell: shellMessages }}>
          <ContextWorkspace repoId={REPO_ID} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText(/Hello grounding\./)).toBeInTheDocument(),
    );
  });
});

describe("ContextWorkspace — empty state (AC-4)", () => {
  it("shows the explanatory empty-docs copy, not a bare/error view", async () => {
    mockFetch({ documents: [], state: "empty" });
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByText(contextMessages.empty.title)).toBeInTheDocument(),
    );
    expect(screen.getByText(contextMessages.empty.body)).toBeInTheDocument();
  });
});

describe("ContextWorkspace — not-cloned state (AC-5)", () => {
  it("shows the explanatory not-cloned copy, not a generic error", async () => {
    mockFetch({ documents: [], state: "not_cloned" });
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByText(contextMessages.notCloned.title)).toBeInTheDocument(),
    );
    expect(screen.getByText(contextMessages.notCloned.body)).toBeInTheDocument();
    expect(screen.queryByText(contextMessages.empty.title)).not.toBeInTheDocument();
  });
});
