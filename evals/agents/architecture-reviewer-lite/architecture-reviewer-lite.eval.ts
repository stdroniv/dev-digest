import { describeAgent, runAgentCases } from "../../src/index.js";
// Deliberately reuses the strict variant's cases — same fixture, same practices, same
// threshold. Only the injected agent artifact differs (architecture-reviewer-lite has the
// "cite the specific documented rule per finding" hard rule removed). That is what makes this
// pair a controlled A/B rather than two unrelated evals: pnpm eval:repeat both with labels and
// pnpm eval:delta them to see exactly which practice moved.
import { cases } from "../architecture-reviewer/architecture-reviewer.cases.js";

// The lite variant is the RELAXED control side of the A/B: it has the "cite the
// specific documented rule per finding" hard rule removed, so it deterministically
// scores lower on the rule-citation sub-checks (observed 2/6–4/6 on CI's
// gemini-2.5-flash) and would fail the strict variant's 1.0 gate. We do NOT lower
// the shared cases' thresholds (the strict architecture-reviewer must keep gating
// at 1.0) — instead we relax the bar for THIS control run only, so CI stays green
// while the A/B delta (which practice moved) is still what's being measured.
const relaxedCases = cases.map((c) => ({ ...c, threshold: 0.2 }));

describeAgent("architecture-reviewer-lite", () => runAgentCases("architecture-reviewer-lite", relaxedCases));
