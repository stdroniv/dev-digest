import type { AgentCase } from "../../src/index.js";

// Real-world shape: a genuine, verifiable [code] lookup against this repo — not a synthetic
// question. groundFindings() is a real, documented gate (reviewer-core/CLAUDE.md: "Grounding is
// the mandatory gate ... a finding that doesn't cite a real diff line is dropped"), so a correct
// answer has one right file and a checkable claim. A fabricated or vague path:line means the
// agent didn't actually read the code.
const CODE_PROMPT =
  "[code] Where is the grounding gate that drops hallucinated-location findings enforced in " +
  "reviewer-core, and what exact rule decides whether a finding survives?";

export const cases: AgentCase[] = [
  {
    name: "answers a real code lookup with a verifiable path:line citation in the strict template",
    kind: "quality",
    prompt: CODE_PROMPT,
    practices: [
      "identifies reviewer-core/src/grounding.ts as the file implementing the gate, citing groundFindings (or buildLineIndex) with a real path:line, not a vague file reference",
      "states the actual rule: a finding is kept only if its line range intersects a real hunk for the same file in the diff (or, for the full-file scanner kinds like secret_leak/lethal_trifecta/phantom/hook, only that the file itself is present in the diff) — not a generic 'it validates findings' restatement",
      "follows the exact CODE template: an Answer line, an Evidence section with ≥1 path:line bullet, an Edge cases line, and a Confidence line — no extra prose outside the template",
      "does not perform any edit, write, or web search — this is a [code] request answered read-only from this repository",
    ],
    grounding: ["grounding.ts"],
    threshold: 0.7,
    maxTurns: 6,
  },
  // Keep it minimal — one or two cases is enough to start.
];
