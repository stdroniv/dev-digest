import { describe, it, expect } from "vitest";
import { formatUsd } from "./cost";

describe("formatUsd — adaptive precision", () => {
  it("renders an em dash for null/undefined", () => {
    expect(formatUsd(null)).toBe("—");
    expect(formatUsd(undefined)).toBe("—");
  });

  it("uses 2 decimals at or above $1", () => {
    expect(formatUsd(12.345)).toBe("$12.35");
    expect(formatUsd(1)).toBe("$1.00");
  });

  it("uses 3 decimals for cents ($0.01–$0.99)", () => {
    expect(formatUsd(0.014)).toBe("$0.014");
    expect(formatUsd(0.06)).toBe("$0.060");
  });

  it("uses 4 decimals for sub-cent amounts", () => {
    expect(formatUsd(0.0013)).toBe("$0.0013");
    expect(formatUsd(0)).toBe("$0.0000");
  });
});
