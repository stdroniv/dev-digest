import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ProjectDocument } from "@devdigest/shared";

vi.mock("../api", () => ({ api: { get: vi.fn(), post: vi.fn() } }));

import { useDocumentAttachment, type DocumentLinkLike } from "./use-document-attachment";

afterEach(() => {
  cleanup();
});

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// STABLE module-level references only — `links`/`docs` are hydration-effect
// deps (client/INSIGHTS: a fresh array literal minted inside the renderHook
// callback on every render re-fires the effect forever and OOMs the worker).
const DOCS: ProjectDocument[] = [
  { path: "specs/a.md", root: "specs", tokens: 10 },
  { path: "docs/b.md", root: "docs", tokens: 20 },
];

const LINKS_EMPTY: DocumentLinkLike[] = [];
const LINKS_ONE_REPO_A: DocumentLinkLike[] = [{ path: "specs/a.md", order: 0, repo_id: "repo-A" }];
const LINKS_TWO_REPO_A: DocumentLinkLike[] = [
  { path: "specs/a.md", order: 0, repo_id: "repo-A" },
  { path: "docs/b.md", order: 1, repo_id: "repo-A" },
];

describe("useDocumentAttachment", () => {
  it("attaches a doc by calling setDocuments.mutate once with { paths, repoId }", () => {
    const mutate = vi.fn();
    const qc = new QueryClient();
    const { result } = renderHook(
      () =>
        useDocumentAttachment({
          id: "a1",
          repoId: "repo-A",
          docs: DOCS,
          links: LINKS_EMPTY,
          setDocuments: { mutate },
        }),
      { wrapper: wrapper(qc) },
    );

    act(() => {
      result.current.toggle("specs/a.md", true);
    });

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(
      { paths: ["specs/a.md"], repoId: "repo-A" },
      expect.anything(),
    );
  });

  it("attaches a second doc alongside an already-linked one, keeping repoId in the call", () => {
    const mutate = vi.fn();
    const qc = new QueryClient();
    const { result } = renderHook(
      () =>
        useDocumentAttachment({
          id: "a1",
          repoId: "repo-A",
          docs: DOCS,
          links: LINKS_ONE_REPO_A,
          setDocuments: { mutate },
        }),
      { wrapper: wrapper(qc) },
    );

    act(() => {
      result.current.toggle("docs/b.md", true);
    });

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(
      { paths: ["specs/a.md", "docs/b.md"], repoId: "repo-A" },
      expect.anything(),
    );
  });

  it("detach always calls setDocuments.mutate immediately with { paths, repoId } — no gating step", () => {
    const mutate = vi.fn();
    const qc = new QueryClient();
    const { result } = renderHook(
      () =>
        useDocumentAttachment({
          id: "a1",
          repoId: "repo-A",
          docs: DOCS,
          links: LINKS_ONE_REPO_A,
          setDocuments: { mutate },
        }),
      { wrapper: wrapper(qc) },
    );

    act(() => {
      result.current.toggle("specs/a.md", false);
    });

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({ paths: [], repoId: "repo-A" }, expect.anything());
  });

  it("reorder (onDrop) always calls setDocuments.mutate immediately with { paths, repoId }", () => {
    const mutate = vi.fn();
    const qc = new QueryClient();
    const { result } = renderHook(
      () =>
        useDocumentAttachment({
          id: "a1",
          repoId: "repo-A",
          docs: DOCS,
          links: LINKS_TWO_REPO_A,
          setDocuments: { mutate },
        }),
      { wrapper: wrapper(qc) },
    );

    expect(result.current.order).toEqual(["specs/a.md", "docs/b.md"]);

    act(() => {
      result.current.dragId.current = "docs/b.md";
      result.current.onDrop("specs/a.md");
    });

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(
      { paths: ["docs/b.md", "specs/a.md"], repoId: "repo-A" },
      undefined,
    );
    expect(result.current.order).toEqual(["docs/b.md", "specs/a.md"]);
  });

  it("does nothing on toggle when repoId is null (no active repo — a no-op guard, not a mutation)", () => {
    const mutate = vi.fn();
    const qc = new QueryClient();
    const { result } = renderHook(
      () =>
        useDocumentAttachment({
          id: "a1",
          repoId: null,
          docs: DOCS,
          links: LINKS_EMPTY,
          setDocuments: { mutate },
        }),
      { wrapper: wrapper(qc) },
    );

    act(() => {
      result.current.toggle("specs/a.md", true);
    });

    expect(mutate).not.toHaveBeenCalled();
  });

  it("switching repoId between renders (same hook instance) re-hydrates an independent order/attached set with no clear/confirm step", () => {
    const mutate = vi.fn();
    const qc = new QueryClient();
    const { result, rerender } = renderHook(
      ({ repoId, links }: { repoId: string; links: DocumentLinkLike[] }) =>
        useDocumentAttachment({
          id: "a1",
          repoId,
          docs: DOCS,
          links,
          setDocuments: { mutate },
        }),
      {
        wrapper: wrapper(qc),
        initialProps: { repoId: "repo-A", links: LINKS_ONE_REPO_A },
      },
    );

    expect(result.current.attached).toEqual(new Set(["specs/a.md"]));

    // Switch to a completely different, unattached repo's list.
    rerender({ repoId: "repo-B", links: LINKS_EMPTY });

    expect(result.current.attached).toEqual(new Set());
    expect(mutate).not.toHaveBeenCalled();

    act(() => {
      result.current.toggle("docs/b.md", true);
    });

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(
      { paths: ["docs/b.md"], repoId: "repo-B" },
      expect.anything(),
    );
  });

  it("no longer exposes the removed anchor/confirm-clear fields", () => {
    const mutate = vi.fn();
    const qc = new QueryClient();
    const { result } = renderHook(
      () =>
        useDocumentAttachment({
          id: "a1",
          repoId: "repo-A",
          docs: DOCS,
          links: LINKS_ONE_REPO_A,
          setDocuments: { mutate },
        }),
      { wrapper: wrapper(qc) },
    );

    expect(result.current).not.toHaveProperty("anchorRepoId");
    expect(result.current).not.toHaveProperty("pendingAttach");
    expect(result.current).not.toHaveProperty("confirmClear");
    expect(result.current).not.toHaveProperty("cancelClear");
  });
});
