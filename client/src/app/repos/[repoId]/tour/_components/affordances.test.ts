import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { success } = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock("@/lib/toast", () => ({
  notify: { success, error: vi.fn(), info: vi.fn() },
}));

import { openOrCopyCited, copyCommand, copyShareLink } from "./affordances";

describe("affordances (SPEC-02 AC-16/17/18, §Untrusted inputs)", () => {
  let writeText: ReturnType<typeof vi.fn>;
  let openSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);
    success.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("openOrCopyCited", () => {
    it("opens {githubUrl}/blob/HEAD/{path} in a new tab with rel=noopener,noreferrer when a GitHub URL exists (AC-16)", () => {
      openOrCopyCited("src/index.ts", "https://github.com/acme/repo");

      expect(openSpy).toHaveBeenCalledWith(
        "https://github.com/acme/repo/blob/HEAD/src/index.ts",
        "_blank",
        "noopener,noreferrer",
      );
      expect(writeText).not.toHaveBeenCalled();
    });

    it("falls back to copying the path when no GitHub URL is available (AC-17)", async () => {
      openOrCopyCited("src/index.ts", null);

      expect(openSpy).not.toHaveBeenCalled();
      expect(writeText).toHaveBeenCalledWith("src/index.ts");
    });
  });

  describe("copyCommand", () => {
    it("copies the command text — never executes it", () => {
      copyCommand("pnpm dev");

      expect(writeText).toHaveBeenCalledWith("pnpm dev");
      expect(openSpy).not.toHaveBeenCalled();
    });
  });

  describe("copyShareLink", () => {
    it("copies a local deep-link with no network call (AC-18)", () => {
      copyShareLink("repo-1");

      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/repos/repo-1/tour`);
    });
  });
});
