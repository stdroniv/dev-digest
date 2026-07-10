import type { AgentCase } from "../../src/index.js";

// Real-world shape: use the actual, already-shipped spec/plan pair from this repo's L05 work
// (specs/SPEC-02-2026-07-02-onboarding-generator.md × docs/plans/onboarding-generator.md, 36 ACs
// across 14 tasks) instead of a synthetic mini-example. This is a genuine two-document
// traceability check the agent has to do real Read/Grep work to answer, and it's a good "did the
// gate hold together on something non-trivial" regression: both documents are real, so a
// low-effort or hallucinated pass is easy to tell apart from a real one (fabricated AC/task IDs
// won't match anything Grep actually finds).
const PROMPT =
  "Check whether docs/plans/onboarding-generator.md fully covers specs/SPEC-02-2026-07-02-onboarding-generator.md. " +
  "Give me the traceability matrix and the verdict.";

export const cases: AgentCase[] = [
  {
    name: "produces a real AC-to-task traceability matrix over the actual onboarding-generator spec/plan pair",
    kind: "quality",
    prompt: PROMPT,
    practices: [
      "cites the real Spec ID (SPEC-02) and the real plan path (docs/plans/onboarding-generator.md) at the top of the report",
      "produces a per-AC row citing real AC-N ids from the spec (e.g. AC-1, AC-12, AC-20, AC-33 or similar) each classified Covered / Partial / Uncovered, not a handful of invented example rows",
      "cites real owning task ids from the plan (e.g. T1 through T14, or whichever real task ids the plan uses) as evidence for Covered rows, not vague task descriptions with no id",
      "runs the reverse/scope check and either lists an unexplained plan task or explicitly states 'no unexplained tasks' rather than omitting the scope check entirely",
      "ends with an explicit verdict line in the documented format (PLAN COVERS SPEC · IN SCOPE, or N GAPS with each gap listed)",
      "does not comment on code quality, architecture soundness, or file-path correctness — those are out of this agent's lane",
      "makes no Edit or Write — it only reports, it never modifies the spec or the plan",
    ],
    grounding: ["SPEC-02"],
    threshold: 0.7,
    maxTurns: 15,
  },
  // Keep it minimal — one or two cases is enough to start.
];
