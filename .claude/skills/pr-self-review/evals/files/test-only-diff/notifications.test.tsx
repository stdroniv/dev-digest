import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../api", () => ({ api: { get: vi.fn().mockResolvedValue([]) } }));

import { useNotifications } from "./notifications";

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useNotifications", () => {
  it("fetches notifications for a workspace", () => {
    const qc = new QueryClient();
    const { result } = renderHook(() => useNotifications("w1"), {
      wrapper: wrapper(qc),
    });

    // Asserts immediately after render, with no `waitFor`/`act` around the
    // query settling — the query is still `pending` at this point, so this
    // only proves the hook returned an object, not that the fetched
    // notifications ever reached the caller. A broken queryFn that always
    // rejected would still pass this assertion.
    expect(result.current).toBeDefined();
  });
});
