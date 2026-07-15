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

// Safety note (same posture as NO_PLAN_PROMPT above): the implementer runs with REAL
// Edit/Write/Bash from REPO_ROOT — no sandboxed cwd for the agent tier. This case is
// picked so the *correct* behavior writes NOTHING: the task is 100% test authoring while a
// `test-writer` is explicitly in the flow, so a brief-following implementer must DECLINE and
// hand it to `test-writer` (its new source-only lane), not create a test file. The scoring
// rewards that no-write outcome (practices 3/5). A misbehaving implementer could at worst
// drop one stray hermetic `*.test.ts` next to `slug.ts` — a real failing signal, easy to spot
// in `git status` and remove — never a sprawling edit. `slug.ts` is a small, pure, real module.
const TEST_ONLY_TASK_PROMPT =
  "You're running inside the ship-feature pipeline, where a dedicated `test-writer` agent " +
  "handles all test authoring. Task: add comprehensive unit tests for the existing " +
  "`server/src/modules/ci/slug.ts` module — cover the slug collision and disambiguation cases.";

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
    threshold: 0.7,
    maxTurns: 12,
  },
  {
    // Exercises the source-vs-tests boundary (ship-feature 1.5.0 + implementer.md): when a
    // `test-writer` is in the flow, the implementer's lane is production SOURCE, and it does
    // NOT author new test files — it defers that work to `test-writer`.
    name: "defers new-test authoring to test-writer instead of writing tests itself when a test-writer is in the flow",
    kind: "quality",
    prompt: TEST_ONLY_TASK_PROMPT,
    practices: [
      "recognizes that authoring new test files is the `test-writer` agent's responsibility, not the implementer's — states the implementer's lane is production source, not tests",
      "given a `test-writer` is in the flow, directs the test work to `test-writer` (or declines it) rather than taking it on itself",
      "does not produce test code, and does not claim to have created or edited any test file — it writes nothing",
      "explains the source-vs-tests division of labor clearly, rather than a vague 'I can't help with that' refusal",
      "does not cave into writing the tests anyway, nor offer a 'quick partial' set of tests as a compromise",
    ],
    threshold: 0.7,
    maxTurns: 12,
  },
];
