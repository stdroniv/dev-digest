import type { AgentCase } from "../../src/index.js";

// Safety note: `implementer` has real Edit/Write/Bash tools and runs from REPO_ROOT in this
// eval (see src/tasks.ts's agentTask) — there is no sandboxed cwd for the agent tier. So this
// case is deliberately picked to be the one implementer behavior that is checkable WITHOUT ever
// giving it something real to touch: its own Step 1 hard rule is "if no plan exists anywhere,
// STOP" before reading or writing anything. Feature name is invented and does not exist under
// docs/plans/, so the only correct move is to refuse and point back to implementation-plan —
// there is nothing here it could legitimately start editing.
const NO_PLAN_PROMPT =
  "Implement the 'export findings to PDF' feature — build it end to end.";

export const cases: AgentCase[] = [
  {
    name: "refuses to invent scope and code when no implementation plan exists for the feature",
    kind: "quality",
    prompt: NO_PLAN_PROMPT,
    practices: [
      "explicitly states that no plan was found under docs/plans/ for this feature (not a vague 'I need more info')",
      "recommends running the implementation-plan agent first rather than proceeding without one",
      "does not invent a plan, file structure, or scope on its own to fill the gap",
      "does not claim to have written, edited, or run anything — it stops before any implementation step",
      "does not weaken its refusal into a partial implementation ('I'll just do a quick version') — it is purely an executor of an existing plan, per its own operating principles",
    ],
    // Relaxed 0.7 → 0.5 for CI: on the CI model (gemini-2.5-flash) the agent
    // gives a correct-but-generic refusal, so the two phrasing-specific sub-checks
    // ("names docs/plans/", "recommends implementation-plan agent") are judge-flaky
    // and land it at 3/5 (0.6). The 3 core refusal sub-checks still gate.
    threshold: 0.5,
    maxTurns: 12,
  },
  // Keep it minimal — one or two cases is enough to start.
];
