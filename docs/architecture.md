# Architecture — the review pipeline

The single deeper reference for *how a review happens end to end*. CLAUDE.md files
link here instead of duplicating it. Package-level diagrams live in each
package's README; this doc is the cross-package flow.

## End to end

1. **Add a repo** — `server` (`modules/repos`) `git clone`s it into
   `DEVDIGEST_CLONE_DIR` and `repo-intel` indexes it (symbols + import graph →
   ranked **repo map**). The repo shows an **Indexed** badge.
2. **Import PRs** — `modules/pulls` pulls open PRs from GitHub (diff, commits,
   body, linked issue) via the GitHub adapter.
3. **Run a review** — `POST /pulls/:id/review` → `modules/reviews/run-executor.ts`
   loads the diff, gathers context (repo map + caller signatures when indexed and
   enabled), and calls `reviewPullRequest()` in `reviewer-core`.
4. **Engine** (`reviewer-core`): `assemblePrompt()` (+ `INJECTION_GUARD`,
   `wrapUntrusted()`) → injected `LLMProvider` → structured output
   (Zod→JSON Schema, parse-with-repair) → **`groundFindings()`** drops any finding
   not citing a real diff line → score recomputed from survivors.
5. **Persist** — findings (severity + grounded location), verdict, score, and run
   trace are stored via Drizzle; the client streams run progress over SSE.

```mermaid
flowchart LR
  CLONE["git clone"] --> INTEL["repo-intel<br/>symbols + graph → repo map"]
  GH["GitHub PR diff"] --> RUN["run-executor.ts"]
  INTEL --> RUN
  RUN --> ENGINE["reviewer-core<br/>prompt → LLM → grounding gate"]
  ENGINE --> DB[("Postgres<br/>findings · runs")]
  DB -->|"SSE"| WEB["client"]
```

## Trust & determinism (the two load-bearing ideas)

- **Grounding gate** — the model cannot hallucinate a location; uncited findings are
  dropped and the score is derived mechanically, not trusted from the model. Note this
  gate is *asymmetric*: it removes false positives but cannot recover a finding the
  model lazily failed to emit — that gap is covered by the re-sample guard below.
- **Injection defense** — a single trusted rule (`INJECTION_GUARD`) treats all
  untrusted content (diff, PR body, README, comments) as data, never instructions.
  No keyword denylists.
- **Determinism** — `temperature: 0` is *not* reproducible on OpenRouter on its own:
  the engine sends a fixed `seed` (`REVIEW_SEED`) and, on OpenRouter, pins upstream
  routing (`provider: { allow_fallbacks: false, require_parameters: true }`) so the
  same model id stops drifting across hosts/quantizations between runs.
- **False-negative guard** — a single-pass review that returns 0 findings is
  re-sampled (`resampleOnEmpty`, perturbed temperature + offset seed) and merged
  worst-verdict/union, so one lazy "approve" draw can't silently pass a buggy PR.
- **Model tier** — do **not** gate merges (`ciFailOn != 'never'`) on a cheap
  `flash/mini/nano/free` tier: those under-report and emit lazy short completions
  (the failure the guard exists to catch). Prefer a mid-tier model for the verdict;
  the runner logs a warning when a flash-tier model is used as a gate.

## Where to go deeper

- API surface & DI → [`../server/README.md`](../server/README.md)
- Engine internals & public API → [`../reviewer-core/README.md`](../reviewer-core/README.md)
- The indexer → [`../server/src/modules/repo-intel/README.md`](../server/src/modules/repo-intel/README.md)
- Agent prompts → [`agent-prompts/README.md`](agent-prompts/README.md)
- Testing & CI → [`../TESTING.md`](../TESTING.md)
