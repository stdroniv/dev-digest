import { describe, it, expect } from "vitest";
import type { FindingRecord } from "@devdigest/shared";
import { countBySeverity, visibleFindings } from "./helpers";

function f(over: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    severity: "WARNING",
    category: "bug",
    title: over.id,
    file: "src/x.ts",
    start_line: 1,
    end_line: 1,
    rationale: "",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  };
}

const FINDINGS: FindingRecord[] = [
  f({ id: "c1", severity: "CRITICAL", confidence: 0.95 }),
  f({ id: "w1", severity: "WARNING", confidence: 0.5 }),
  f({ id: "w2", severity: "WARNING", confidence: 0.8 }),
  f({ id: "s1", severity: "SUGGESTION", confidence: 0.9 }),
];

describe("countBySeverity", () => {
  it("tallies each filterable severity", () => {
    expect(countBySeverity(FINDINGS)).toEqual({ CRITICAL: 1, WARNING: 2, SUGGESTION: 1 });
  });

  it("returns all-zero for an empty list", () => {
    expect(countBySeverity([])).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
  });
});

describe("visibleFindings", () => {
  it("keeps only the selected severity when a filter is set", () => {
    const ids = visibleFindings(FINDINGS, false, "WARNING").map((x) => x.id);
    expect(ids.sort()).toEqual(["w1", "w2"]);
  });

  it("returns all findings (severity-sorted) when no filter is set", () => {
    const ids = visibleFindings(FINDINGS, false, null).map((x) => x.id);
    expect(ids[0]).toBe("c1"); // CRITICAL first
    expect(ids).toHaveLength(4);
  });

  it("composes hide-low with the severity filter", () => {
    // w1 is below the 0.65 threshold, so hide-low drops it.
    const ids = visibleFindings(FINDINGS, true, "WARNING").map((x) => x.id);
    expect(ids).toEqual(["w2"]);
  });
});
