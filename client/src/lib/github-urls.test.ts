import { describe, it, expect } from "vitest";
import { githubBlobUrl, githubPrFileUrl, githubPrUrl } from "./github-urls";

describe("githubPrUrl", () => {
  it("builds the PR conversation URL", () => {
    expect(githubPrUrl("acme/payments-api", 482)).toBe(
      "https://github.com/acme/payments-api/pull/482",
    );
  });
});

describe("githubBlobUrl", () => {
  it("encodes the path and appends a single-line anchor", () => {
    expect(githubBlobUrl("acme/payments-api", "abc123", "src/config.ts", 12)).toBe(
      "https://github.com/acme/payments-api/blob/abc123/src/config.ts#L12",
    );
  });
  it("appends a line range when end differs from start", () => {
    expect(githubBlobUrl("acme/payments-api", "abc123", "src/api/users.ts", 45, 52)).toBe(
      "https://github.com/acme/payments-api/blob/abc123/src/api/users.ts#L45-L52",
    );
  });
});

describe("githubPrFileUrl", () => {
  it("returns the bare /files URL when no path sha is given (graceful fallback)", () => {
    expect(githubPrFileUrl("acme/payments-api", 482, "src/config.ts", 12, 12)).toBe(
      "https://github.com/acme/payments-api/pull/482/files",
    );
  });

  it("appends a diff anchor with a single-line R-marker when a sha is given", () => {
    expect(githubPrFileUrl("acme/payments-api", 482, "src/config.ts", 12, 12, "deadbeef")).toBe(
      "https://github.com/acme/payments-api/pull/482/files#diff-deadbeefR12",
    );
  });

  it("appends an R-range when end differs from start", () => {
    expect(githubPrFileUrl("acme/payments-api", 482, "src/api/users.ts", 45, 52, "cafe")).toBe(
      "https://github.com/acme/payments-api/pull/482/files#diff-cafeR45-R52",
    );
  });

  it("targets the Files tab (not a blob view) so fork PRs resolve", () => {
    const url = githubPrFileUrl("acme/payments-api", 482, "src/config.ts", 12, 12, "abc");
    expect(url).toContain("/pull/482/files");
    expect(url).not.toContain("/blob/");
  });
});
