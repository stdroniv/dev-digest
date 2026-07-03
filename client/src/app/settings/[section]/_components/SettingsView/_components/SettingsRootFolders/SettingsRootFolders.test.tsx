import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/settings.json";

const apiGet = vi.fn();
const apiPut = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    put: (...args: unknown[]) => apiPut(...args),
  },
}));

import { SettingsRootFolders } from "./SettingsRootFolders";

afterEach(() => {
  cleanup();
  apiGet.mockReset();
  apiPut.mockReset();
});

function renderPanel() {
  const qc = new QueryClient();
  return render(
    <NextIntlClientProvider locale="en" messages={{ settings: messages }}>
      <QueryClientProvider client={qc}>
        <SettingsRootFolders />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

describe("SettingsRootFolders", () => {
  it("shows the specs/docs/insights default when root_folders is unset", async () => {
    apiGet.mockResolvedValueOnce({});
    renderPanel();

    await waitFor(() => expect(screen.getByText("specs")).toBeInTheDocument());
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("insights")).toBeInTheDocument();
  });

  it("renders a saved custom override instead of the default", async () => {
    apiGet.mockResolvedValueOnce({ root_folders: ["adr", "runbooks"] });
    renderPanel();

    await waitFor(() => expect(screen.getByText("adr")).toBeInTheDocument());
    expect(screen.getByText("runbooks")).toBeInTheDocument();
    expect(screen.queryByText("specs")).not.toBeInTheDocument();
  });

  it("adding and removing a root, then Save, PUTs the edited root_folders list", async () => {
    apiGet.mockResolvedValueOnce({ root_folders: ["specs", "docs", "insights"] });
    apiPut.mockResolvedValueOnce({ root_folders: ["specs", "docs", "adr"] });
    renderPanel();

    await waitFor(() => expect(screen.getByText("insights")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("e.g. adr"), { target: { value: "adr" } });
    fireEvent.click(screen.getByText("Add"));
    await waitFor(() => expect(screen.getByText("adr")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Remove insights"));
    await waitFor(() => expect(screen.queryByText("insights")).not.toBeInTheDocument());

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(apiPut).toHaveBeenCalledWith("/settings", { root_folders: ["specs", "docs", "adr"] }),
    );
  });

  it("Reset restores and persists the specs/docs/insights default", async () => {
    apiGet.mockResolvedValueOnce({ root_folders: ["custom-a", "custom-b"] });
    apiPut.mockResolvedValueOnce({ root_folders: ["specs", "docs", "insights"] });
    renderPanel();

    await waitFor(() => expect(screen.getByText("custom-a")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Reset to default"));

    await waitFor(() =>
      expect(apiPut).toHaveBeenCalledWith("/settings", {
        root_folders: ["specs", "docs", "insights"],
      }),
    );
    expect(screen.getByText("specs")).toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("insights")).toBeInTheDocument();
  });
});
