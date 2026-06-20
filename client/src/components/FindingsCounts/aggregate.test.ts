/**
 * aggregateLatestPerAgent — the popover's finding list must mirror the server's
 * PR-list counters: latest review PER agent (kind 'review' only), unioned, and
 * sorted by severity then confidence, with dismissed findings kept.
 */
import { describe, it, expect } from "vitest";
import type { ReviewRecord, FindingRecord } from "@devdigest/shared";
import { aggregateLatestPerAgent } from "./aggregate";

function finding(o: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    severity: "WARNING",
    category: "bug",
    title: o.id,
    file: "src/x.ts",
    start_line: 1,
    end_line: 1,
    rationale: "r",
    suggestion: null,
    confidence: 0.5,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "rev",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

function review(o: Partial<ReviewRecord> & { id: string }): ReviewRecord {
  return {
    pr_id: "pr1",
    agent_id: "a1",
    run_id: "run1",
    agent_name: "Security",
    kind: "review",
    verdict: "comment",
    summary: "",
    score: 70,
    model: "gpt-4.1",
    grounding: null,
    created_at: "2026-06-10T00:00:00Z",
    findings: [],
    ...o,
  };
}

describe("aggregateLatestPerAgent", () => {
  it("keeps only the latest review per agent and unions their findings", () => {
    const out = aggregateLatestPerAgent([
      review({ id: "A-old", agent_id: "a1", created_at: "2026-06-10T00:00:00Z", findings: [finding({ id: "old", severity: "CRITICAL" })] }),
      review({ id: "A-new", agent_id: "a1", created_at: "2026-06-12T00:00:00Z", findings: [finding({ id: "newCrit", severity: "CRITICAL" }), finding({ id: "newWarn", severity: "WARNING" })] }),
      review({ id: "B", agent_id: "a2", created_at: "2026-06-11T00:00:00Z", findings: [finding({ id: "bSugg", severity: "SUGGESTION" })] }),
    ]);
    // A-old excluded; union = A-new (2) + B (1).
    expect(out.map((f) => f.id)).toEqual(["newCrit", "newWarn", "bSugg"]);
  });

  it("sorts by severity rank then by confidence (desc)", () => {
    const out = aggregateLatestPerAgent([
      review({
        id: "r",
        findings: [
          finding({ id: "warnLow", severity: "WARNING", confidence: 0.4 }),
          finding({ id: "crit", severity: "CRITICAL", confidence: 0.6 }),
          finding({ id: "warnHigh", severity: "WARNING", confidence: 0.9 }),
          finding({ id: "sugg", severity: "SUGGESTION", confidence: 0.99 }),
        ],
      }),
    ]);
    expect(out.map((f) => f.id)).toEqual(["crit", "warnHigh", "warnLow", "sugg"]);
  });

  it("ignores 'summary' reviews (only kind 'review' feeds the counters)", () => {
    const out = aggregateLatestPerAgent([
      review({ id: "sum", kind: "summary", findings: [finding({ id: "ignored", severity: "CRITICAL" })] }),
      review({ id: "rev", kind: "review", findings: [finding({ id: "kept" })] }),
    ]);
    expect(out.map((f) => f.id)).toEqual(["kept"]);
  });

  it("counts dismissed findings (matches the badge total)", () => {
    const out = aggregateLatestPerAgent([
      review({ id: "r", findings: [finding({ id: "dismissed", dismissed_at: "2026-06-12T00:00:00Z" })] }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("returns [] for no reviews", () => {
    expect(aggregateLatestPerAgent([])).toEqual([]);
  });
});
