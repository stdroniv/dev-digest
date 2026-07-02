import React from "react";
import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { ReadingPathContent } from "@devdigest/shared";

import { ReadingPathSection } from "./ReadingPathSection";

afterEach(cleanup);

const CONTENT: ReadingPathContent = {
  steps: [
    { path: "README.md", reason: "start with the project overview" },
    { path: "server/src/index.ts", reason: "then the API entrypoint" },
  ],
};

describe("ReadingPathSection (AC-11)", () => {
  it("renders each numbered step's mono path on line 1 and muted reason on line 2", () => {
    render(<ReadingPathSection content={CONTENT} />);
    expect(screen.getByText("README.md")).toBeTruthy();
    expect(screen.getByText("start with the project overview")).toBeTruthy();
    expect(screen.getByText("server/src/index.ts")).toBeTruthy();
    expect(screen.getByText("then the API entrypoint")).toBeTruthy();
  });
});
