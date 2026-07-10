import type { AgentCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

// Real-world shape: a user pastes a rough whiteboard sketch + scattered notes (not a spec,
// not a mock file) for a feature that doesn't exist anywhere in this repo yet. The point of
// this case is NOT "can it write EARS ACs" (that's covered by the template itself) — it's
// whether the agent actually METABOLIZES the pasted design (the ledger columns, the "last 5
// runs" toggle, the open CSV-export question) into its analysis, rather than producing a
// generic "cost tracking feature" response that ignores what the user gave it.
const DESIGN_PROMPT = `Spec this for me: ${fx("design-note.md")}`;

export const cases: AgentCase[] = [
  {
    name: "picks up a pasted design sketch and reflects its specifics in the clarification response",
    kind: "quality",
    prompt: DESIGN_PROMPT,
    practices: [
      "the response is Step 1 of the agent's workflow — a Clarification response (Understood request / Requirements / Design analysis / Blocking questions), not a written spec file — because the user has not yet answered any questions",
      "explicitly reflects specifics FROM THE PASTED DESIGN rather than a generic 'cost tracking' restatement — e.g. references the per-run ledger (model used, tokens, dollar cost, pass/fail) and/or the 'compare against last 5 runs' averaging toggle",
      "surfaces the design's own open question as a blocking question or a [NEEDS CLARIFICATION]-bound item: whether failed runs count toward the last-5-runs average",
      "surfaces the undecided CSV-export idea as a blocking question or explicitly scopes it as a non-goal for this first version, rather than silently deciding it either way",
      "states at least one non-goal distinguishing this from a budget/spend-cap feature, matching the user's own note that they don't want this to become a spend-cap",
      "contains no implementation detail — no file paths, function/table names, frameworks, or API route shapes",
    ],
    grounding: ["ledger"],
    threshold: 0.7,
    maxTurns: 6,
  },
  // Keep it minimal — one or two cases is enough to start.
];
