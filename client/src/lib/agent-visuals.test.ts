import { describe, it, expect } from "vitest";
import { agentVisual } from "./agent-visuals";

const VALID_COMBOS = [
  { color: "#ef4444", icon: "Shield" },
  { color: "#f59e0b", icon: "Zap" },
  { color: "#3b82f6", icon: "Lightbulb" },
  { color: "#8b5cf6", icon: "Users" },
  { color: "#10b981", icon: "Boxes" },
];

function expectValidVisual(visual: { color: string; icon: string }) {
  expect(VALID_COMBOS).toContainEqual(visual);
}

// The 5 built-in agents seeded by server/src/db/seed.ts.
const SEEDED_AGENTS = [
  { id: "agent-general-1", name: "General Reviewer" },
  { id: "agent-security-1", name: "Security Reviewer" },
  { id: "agent-performance-1", name: "Performance Reviewer" },
  { id: "agent-test-quality-1", name: "Test Quality Reviewer" },
  { id: "agent-api-contract-1", name: "API Contract Reviewer" },
];

describe("agentVisual", () => {
  it("returns a valid, stable palette entry for every seeded agent", () => {
    for (const agent of SEEDED_AGENTS) {
      const first = agentVisual(agent);
      const second = agentVisual(agent);
      expectValidVisual(first);
      expect(second).toEqual(first);
    }
  });

  it("keyword-matches Security to Shield/#ef4444 regardless of id", () => {
    expect(agentVisual({ id: "id-a", name: "Security Reviewer" })).toEqual({
      color: "#ef4444",
      icon: "Shield",
    });
    expect(agentVisual({ id: "id-b", name: "Security Reviewer" })).toEqual({
      color: "#ef4444",
      icon: "Shield",
    });
  });

  it("keyword-matches Performance to Zap/#f59e0b regardless of id", () => {
    expect(agentVisual({ id: "any-id", name: "Performance Reviewer" })).toEqual({
      color: "#f59e0b",
      icon: "Zap",
    });
  });

  it("keyword-matches are case-insensitive", () => {
    expect(agentVisual({ id: "x", name: "SECURITY reviewer" })).toEqual({
      color: "#ef4444",
      icon: "Shield",
    });
  });

  it("keyword-matches mentor/customer/architecture personas from the design palette", () => {
    expect(agentVisual({ id: "x", name: "Mentor Reviewer" })).toEqual({
      color: "#3b82f6",
      icon: "Lightbulb",
    });
    expect(agentVisual({ id: "x", name: "Customer-Facing Reviewer" })).toEqual({
      color: "#8b5cf6",
      icon: "Users",
    });
    expect(agentVisual({ id: "x", name: "Architecture Reviewer" })).toEqual({
      color: "#10b981",
      icon: "Boxes",
    });
  });

  it("falls back to a stable hash-of-id mapping for an agent name matching no keyword", () => {
    const agent = { id: "c9f1b2e4-arbitrary-uuid", name: "General Reviewer" };
    const first = agentVisual(agent);
    expectValidVisual(first);
    // Deterministic: same id + name always resolves to the same visual.
    expect(agentVisual(agent)).toEqual(first);
    expect(agentVisual({ ...agent })).toEqual(first);
  });

  it("hash fallback depends on id, not just name — two different ids with the same non-keyword name may resolve differently, but each is individually stable", () => {
    const a = agentVisual({ id: "aaaaaaaa", name: "Custom Reviewer" });
    const b = agentVisual({ id: "zzzzzzzz", name: "Custom Reviewer" });
    expectValidVisual(a);
    expectValidVisual(b);
    // Re-querying each yields the exact same result it got the first time.
    expect(agentVisual({ id: "aaaaaaaa", name: "Custom Reviewer" })).toEqual(a);
    expect(agentVisual({ id: "zzzzzzzz", name: "Custom Reviewer" })).toEqual(b);
  });
});
