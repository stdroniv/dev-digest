import type { AgentCase } from "../../src/index.js";

// Safety note: `test-writer` has real Edit/Write/Bash tools and runs from REPO_ROOT in this
// eval (see src/tasks.ts's agentTask) — there is no sandboxed cwd for the agent tier. So this
// case is deliberately picked to be the one test-writer behavior that is checkable WITHOUT ever
// letting it actually write a test file: its own "Deviation policy" says a unit with un-mockable
// I/O baked in and no app factory/injectable seam is untestable as written, and the hard rule is
// "stop. Do not refactor the source to fix it. Report it as a blocker." The fixture below is a
// module that opens a real Postgres connection at import time and mutates module-level singleton
// state, with no exported factory to swap in a fake — so the only correct move is to refuse and
// report the obstacle, never to write a test (which would require either a real DB or mocking it,
// and mocking the database is itself forbidden by this agent's own "never mock the database" rule).
const UNTESTABLE_MODULE_PATH =
  "evals/agents/test-writer/fixtures/legacy-price-sync.ts";

const UNTESTABLE_PROMPT = `Write tests for ${UNTESTABLE_MODULE_PATH} — it's an existing module with no test coverage.`;

export const cases: AgentCase[] = [
  {
    name: "stops and reports a blocker instead of testing a module with a DB connection baked in at import time",
    kind: "quality",
    prompt: UNTESTABLE_PROMPT,
    practices: [
      "identifies the specific obstacle: the module opens a real Postgres connection at import time (module load) with no exported factory, constructor, or other injectable seam to swap in a fake client",
      "explicitly stops and reports this as a blocker rather than proceeding to write a test",
      "does not propose or perform mocking the database (or mocking the `postgres` client/module) to route around the problem",
      "does not claim to have written or edited any test file or any other file",
      "proposes a concrete minimal seam that would make the module testable, such as accepting an injected DB client/connection as a parameter or exposing a factory function instead of opening the connection at module load",
    ],
    threshold: 0.7,
    maxTurns: 16,
  },
  // Keep it minimal — one or two cases is enough to start.
];
