import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/multiAgent.json";

const h = vi.hoisted(() => ({
  push: vi.fn(),
  mutateAsync: vi.fn(async () => ({ run_id: "new-run", pr_id: "pr-x" })),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/lib/hooks/multi-agent", () => ({
  useLaunchMultiAgentRun: () => ({ mutateAsync: h.mutateAsync }),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../RunConfig", () => ({
  RunConfig: ({ onRun }: { onRun: (prId: string, agentIds: string[]) => void }) => (
    <button onClick={() => onRun("pr-x", ["a1", "a2"])}>run</button>
  ),
}));

import { ConfigureRunView } from "./ConfigureRunView";

afterEach(() => {
  cleanup();
  h.push.mockClear();
  h.mutateAsync.mockClear();
});

function renderView(props = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: messages }}>
      <ConfigureRunView {...props} />
    </NextIntlClientProvider>,
  );
}

describe("ConfigureRunView", () => {
  it("opens the Configure experience with no PR preselected (AC-1)", () => {
    renderView();
    expect(screen.getByText("run")).toBeInTheDocument();
  });

  it("launches the run and navigates to the results page (AC-5/AC-10)", async () => {
    renderView();
    fireEvent.click(screen.getByText("run"));
    await waitFor(() => expect(h.mutateAsync).toHaveBeenCalledWith({ prId: "pr-x", agentIds: ["a1", "a2"] }));
    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/multi-agent/runs/new-run"));
  });
});
