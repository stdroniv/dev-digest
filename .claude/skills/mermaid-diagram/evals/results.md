# mermaid-diagram eval results (2026-07-05, 5 trials/eval; updated 2026-07-06 with fixes + spot-checks)

Overall pass rate: **0.89** (16/18 expectation-scores averaged; 18 total expectations) from the original 2026-07-05 run. Both flagged issues (SKILL_GAP, FIXTURE_ISSUE) below have since been fixed and spot-checked with 2-trial reruns — see per-eval notes.

## Eval 0 — pr-review-flow-straightforward (all 5/5)

| Exp | Check | Pass rate | Diagnosis |
|---|---|---|---|
| F1 | mermaid fence + valid type keyword | 1.0 | PASS |
| F2 | all 5 named steps as distinct nodes | 1.0 | PASS |
| F3 | edges in stated order | 1.0 | PASS |
| F4 | valid syntax, no dangling refs | 1.0 | PASS |
| F5 | defensible diagram type (flowchart) | 1.0 | PASS |

## Eval 1 — pr-review-lifecycle-state-machine (fixed fixture, 2-trial spot-check)

**(fixed)** Replaces the old `llm-retry-backoff-ambiguous-type` case, which was a **FIXTURE_ISSUE**: every trial converged on `sequenceDiagram` with correct `loop`/`alt`/`break`, because the scenario matched a pattern SKILL.md documents directly — it never actually discriminated. New scenario: a review lifecycle (pending → running → succeeded|failed|cancelled) driven by events, with no actor-to-actor call sequence, which should pull the model toward `stateDiagram-v2` per the Decision Guide rather than a flowchart/sequenceDiagram default.

| Exp | Check | Pass rate (n=2 spot-check) | Diagnosis |
|---|---|---|---|
| G1 | declares `stateDiagram-v2`, not flowchart/sequence | 1.0 | PASS |
| G2 | explicit `[*] --> pending` initial transition | 1.0 | PASS |
| G3 | all 5 states distinct; running has 3 outgoing transitions | 1.0 | PASS |
| G4 | transitions out of running labeled with event | 1.0 | PASS |
| G5 | valid stateDiagram-v2 syntax | 1.0 | PASS |

Only a 2-trial spot-check was run (fresh fixture, not a full 5-trial rerun). Both trials correctly chose `stateDiagram-v2` and produced valid syntax.

## Eval 2 — indexing-pipeline-syntax-edge-cases

| Exp | Check | Pass rate | Diagnosis |
|---|---|---|---|
| F1 | flowchart TD/LR declared | 1.0 | PASS |
| F2 | all 12 stages as distinct nodes | 1.0 | PASS |
| F3 | pipe label (`Filter \| dedupe files`) safely quoted | 0.2 → **fixed** | SKILL_GAP (fixed) |
| F4 | parenthesized labels safely quoted | 0.6 → **fixed** | SKILL_GAP (fixed) |
| F5 | self-loop on Validate index | 1.0 | PASS |
| F6 | cycle back to Walk file tree | 1.0 | PASS |
| F7 | quote-containing error label safely escaped | 0.2 → **fixed** | SKILL_GAP (fixed) |
| F8 | overall bracket/quote balance | 1.0 | PASS |

**Spot-check (2 fresh trials on the original eval-2 prompt, after the SKILL.md fix):** both trials produced `["Filter \| dedupe files"]`, `["Detect language (TS/JS only)"]`, `["Parse file (ast-grep)"]`, and `"Error: #quot;invalid schema#quot;"` — all valid per Mermaid's grammar (verified against Mermaid's official docs, not assumed). F3/F4/F7 pass in both spot-check trials.

## Skill gaps found (2, both same root cause) — fixed

1. **No escaping/quoting guidance** — SKILL.md documented node-shape delimiters (`[]`, `()`, `{}`) but never explained what to do when a label needs to *contain* a reserved character (`|`, `(`, `"`). Effect: 4/5 trials dodged the pipe character by rewording the label instead of quoting it; 2/5 used invalid backslash-escaping (`\"`) for embedded quotes, which is not part of Mermaid's grammar and would likely fail to render.
   **Fix:** added an "Escaping & Quoting Special Characters in Labels" section to SKILL.md (Flowcharts section) documenting: (1) wrap the label in double quotes to neutralize reserved characters — never reword to dodge them; (2) a literal double quote inside an already-quoted label must use the `#quot;` HTML entity (not `\"`, not `&quot;`) — verified against Mermaid's official docs (mermaid.js.org/syntax/flowchart.html) before writing.
2. Corollary: no worked example anywhere in `examples.md`/SKILL.md of a label containing a reserved character — fixed by including worked examples for the pipe, parens, and embedded-quote cases directly in the new section.

## Fixture issues found (1) — fixed

1. Eval 1's ambiguous-type scenario didn't actually produce disagreement across trials — it was a well-covered pattern, so it under-delivered as a "hard case". **Fix:** replaced with `pr-review-lifecycle-state-machine`, a scenario where a state diagram is clearly the better fit (event-triggered status transitions, no actor call sequence). 2-trial spot-check confirms the model now correctly reaches for `stateDiagram-v2`.
