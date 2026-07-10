import type { AgentCase } from "../../src/index.js";

// Real-world shape: point the agent at a spec that genuinely exists and was genuinely
// approved in this repo (specs/SPEC-02-2026-07-02-onboarding-generator.md, status: approved) —
// rather than a synthetic fixture — and check that its Step 1 response is actually GROUNDED in
// that document: it restates the real AC IDs (not paraphrased-and-renumbered ones), it does not
// re-litigate WHAT/WHY the spec already settled, and it asks only HOW-level questions the spec
// deliberately left open (e.g. the spec never says whether generation runs over SSE or a polled
// background job). We point at the path rather than inlining the spec so the case also proves
// the agent actually opens and reads the file rather than answering from the file name alone.
const SPEC_PLAN_PROMPT = `Read specs/SPEC-02-2026-07-02-onboarding-generator.md (an approved spec in this repo) ` +
  `and start planning its implementation.`;

export const cases: AgentCase[] = [
  {
    name: "grounds Step 1 in a real approved spec instead of re-opening its settled WHAT/WHY",
    kind: "quality",
    prompt: SPEC_PLAN_PROMPT,
    practices: [
      "the response is the agent's Step 1 Clarification response (Requirements as understood / Clarifying questions / Execution mode / Recommendations) — it does not jump straight to writing docs/plans/*.md before the user answers",
      "restates the requirements citing real SPEC-02 acceptance criteria by their actual AC-N ids (e.g. AC-1, AC-7, AC-19, AC-31 or similar — not invented renumbered ids), showing it actually read the spec rather than answering from the filename",
      "does NOT re-ask WHAT/WHY-level questions the spec already settled (e.g. does not ask whether the tour should have five sections, or whether cost should be shown — those are already answered in the spec) — questions are HOW-level only (e.g. transport/mechanism for showing generation progress, job queuing approach, or another technical gap the spec deliberately left open)",
      "asks the user to choose an execution mode (multi-agent parallel vs single-agent) and gives a recommendation with a reason",
      "does not invent or write a specification, and does not claim to have written any file yet",
    ],
    threshold: 0.7,
    maxTurns: 8,
  },
  // Keep it minimal — one or two cases is enough to start.
];
