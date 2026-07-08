# Spec: Eval Pipeline for DevDigest  |  Spec ID: SPEC-04  |  Status: approved

**Supersedes:** none

> **Canonical file.** This is the source-of-truth spec, named per the repo convention
> `SPEC-NN-<YYYY-MM-DD>-<kebab-slug>.md` (`specs/README.md`). The L06 submission checklist
> also requires the spec at the exact path `specs/eval-pipeline.md`; that path is kept as a
> thin **pointer** to this file so both the convention and the checklist are satisfied — edit
> this file, not the alias.

## Problem & why

Every change a maintainer makes to a reviewer agent — its system prompt, its model, the
skills linked to it — silently changes what that agent finds and what it stays quiet about.
Today there is no way to answer *"did that edit make the agent better or worse?"* except by
re-running reviews by hand and eyeballing the output. There is no regression protection: a
prompt tweak that improves recall on secrets can quietly start flagging clean code, and
nobody notices until a real PR gets noisy.

DevDigest already has the perfect dataset for this and is throwing it away. Every
**accept** / **dismiss** decision a maintainer made in L01–L05 is a labelled judgement:
"this finding was correct" or "this finding was noise". Turning those decisions into eval
cases means the regression harness is built from real, grounded reviewer behaviour instead
of invented test scenarios.

The Eval Pipeline makes agent quality **measurable and comparable**. A maintainer edits an
agent, runs the agent against the full case set, and sees three numbers move: **recall**
(did it still find what it should), **precision** (did it stay quiet where it should — this
is where *dismissed* cases earn their keep), and **citation_accuracy** (did its findings
survive the grounding gate). Two runs can be placed side by side — "old prompt vs new
prompt" — so a regression is a visible red delta, not a surprise in production.

Crucially, **scoring is pure code and makes zero LLM calls**. Running the agent to produce
findings uses the model; *judging* those findings against the expected output is
deterministic string/line comparison. This keeps the harness cheap, fast, and
reproducible: the same inputs always yield the same score.

## Goals / Non-goals

**Goals**
- Let a maintainer turn any real finding into an eval case with one click, with the
  expectation type derived from the decision already made on that finding: an **accepted**
  finding becomes a `must_find` case ("the agent must surface a finding at this
  file:line"); a **dismissed** finding becomes a `must_not_flag` case ("the agent must NOT
  comment on this location").
- Let a maintainer manage the set directly — author a case from scratch, rename a case,
  edit its expected output, and delete a case — with one-click-from-finding remaining the
  primary seed path.
- Let a maintainer promote the newer agent version to active straight from a run comparison,
  so a proven improvement can be adopted without leaving the eval surface.
- Freeze each case's input (the diff fragment + PR metadata the finding was born from) so
  that runs of *different agent versions* are scored against identical inputs and are
  therefore comparable.
- Run an agent against **all** cases in its set in one action and persist a run with its
  metrics, so runs accumulate into a history.
- Compute recall, precision, and citation_accuracy **entirely in code, with no model
  call**, from a deterministic match rule (a finding matches an expectation when the file
  matches and the line ranges overlap).
- Surface the metrics where the maintainer works: an **Evals** tab inside the Agent editor
  (case list + current metrics + run-all), and a dedicated **Eval Dashboard** page in the
  sidebar showing the most recently run evals across all agents.
- Let the maintainer open run history and **compare two runs side by side**, showing the
  metric deltas and the system-prompt diff between the two agent versions that produced
  them.
- Make the whole feature verifiable offline: `pnpm verify:l06` runs green with no API keys
  and no network, exercising the run path against a deterministic (mock) reviewer and
  asserting the scoring math.

**Non-goals**
- No new *judging model* — scoring never calls an LLM, and there is no LLM-as-judge.
- No change to how reviews are produced or how findings are grounded; the pipeline consumes
  the existing reviewer, it does not modify it.
- No cross-workspace or team sharing of eval sets; cases live in the workspace that owns the
  agent.
- No automated CI gating on eval metrics in this lesson (the numbers are informational; a
  maintainer decides what to do with them). Wiring evals into the CI block gate is future
  work.
- No eval cases for *skills* in this lesson — the `owner_kind` column supports `skill`, but
  the UI entry points (button, tab, dashboard) target **agents** only.

## Context / where this fits

- The `eval_cases` and `eval_runs` tables and all Zod contracts (`EvalCaseInput`,
  `EvalRunRecord`, `EvalRunResult`, `EvalDashboard`, `EvalTrendPoint`, and the base
  `EvalCase` / `EvalRun` / `EvalPerTrace`) already exist and are wired into the schema
  barrel — they are the ready-made foundation this feature builds on.
- Agent versioning already exists (`agents.version` + immutable `agent_versions` config
  snapshots). Run comparison and the prompt-diff view read from these; the "v6 → v7" labels
  in the designs are agent versions.
- A finding already records its decision (`accepted_at` / `dismissed_at`) and its location
  (`file`, `start_line`, `end_line`, `severity`, `category`, `title`). The
  "Turn into eval case" action reads these directly.

## Definitions

- **Eval case** — a frozen input (diff fragment + optional files + PR metadata) plus an
  **expected output**: a (possibly empty) list of findings the agent *should* produce for
  that input.
- **Expectation type** — derived, not stored as a separate enum:
  - `must_find` — expected output contains ≥1 finding (from an **accepted** finding).
  - `must_not_flag` — expected output is an empty list `[]` (from a **dismissed** finding);
    the agent passes by producing no finding at that location.
- **Run** — one execution of an agent against every case in its set, producing one
  persisted record per case plus an aggregate (recall / precision / citation_accuracy /
  pass count / cost). A run is attributed to the agent **version** that produced it.
- **Match** — an actual finding matches an expected finding when their `file` is equal
  (after path normalisation) **and** their `[start_line, end_line]` ranges overlap. No text
  or semantic comparison.
- **recall** — of all expected `must_find` findings across the set, the fraction that were
  matched by an actual finding.
- **precision** — of all actual findings the agent produced, the fraction that are *not*
  noise: an actual finding is noise when it matches a `must_not_flag` expectation, or when
  it matches no expected finding in a case that expected something specific. Dismissed cases
  are what make precision able to drop.
- **citation_accuracy** — of all actual findings the agent produced, the fraction that
  survived the grounding gate (cite a real file:line inside the case's input diff).

## Acceptance criteria (EARS)

**Creating a case from a finding**

- **AC-1** — When the maintainer clicks "Turn into eval case" on a finding that has been
  **accepted**, the system shall create an eval case owned by the review's agent whose
  expected output contains one finding carrying that finding's `file`, `start_line`,
  `end_line`, `severity`, `category`, and `title`, and whose input is the diff fragment /
  PR metadata the finding was reviewed against.
- **AC-2** — When the maintainer clicks "Turn into eval case" on a finding that has been
  **dismissed**, the system shall create an eval case owned by the review's agent whose
  expected output is an empty list `[]` (a `must_not_flag` case), preserving the same frozen
  input.
- **AC-3** — The "Turn into eval case" action shall complete in **one click** (no
  mandatory form) and give immediate visible confirmation; a case name shall be
  auto-derived (e.g. from the finding title) and remain editable later.
- **AC-4** — While a finding has **no** decision (neither accepted nor dismissed), the
  system shall not offer an expectation type it cannot derive: the action is either disabled
  or defaults to `must_find` only if a decision exists. (A finding with no decision yields
  no unambiguous expectation.)
- **AC-5** — The system shall prevent a finding from silently producing duplicate identical
  cases on repeated clicks (idempotent per finding, or clearly surfaced as "already added").

**Viewing the set**

- **AC-6** — The Agent editor shall present an **Evals** tab listing every eval case in the
  agent's set, each showing its name, its expectation summary ("expected N findings"), its
  severity·category (or "empty []" for `must_not_flag`), and its last-run status
  (passed / failed / never run).
- **AC-7** — The set shall contain **at least 8 cases** for the demonstrated agent, seeded
  from real accepted/dismissed findings, with **both** expectation types represented.
- **AC-8** — The Evals tab shall show the agent's current aggregate metrics (recall,
  precision, citation_accuracy, traces passed / total) and their delta vs the previous run.

**Running**

- **AC-9** — When the maintainer triggers "Run all evals" for an agent, the system shall
  execute the agent against every case in its set using each case's **frozen** input, and
  persist one run record per case plus the aggregate, attributed to the agent's current
  version.
- **AC-10** — Runs against different agent versions shall use identical case inputs, so the
  only variable between two runs is the agent configuration (prompt / model / skills).
- **AC-11** — The scoring that turns actual findings into recall / precision /
  citation_accuracy shall make **zero LLM calls** and be a pure function of (expected
  output, actual findings, input diff).
- **AC-12** — When the same agent version is run twice against the same set with a
  deterministic reviewer, the computed metrics shall be identical (reproducible).

**Metrics move with the prompt**

- **AC-13** — When the maintainer changes an agent's system prompt and runs the set again,
  the two runs' recall / precision shall be able to differ, and a **deliberately degraded**
  prompt (e.g. one that adds a noisy instruction) shall produce a **visible drop in
  precision** relative to the prior run.
- **AC-14** — The system shall make the direction of movement legible: an alert / delta
  indicator shall state which metric moved and by how much between the two most recent runs
  (e.g. "Precision dipped 2pts").

**History & comparison**

- **AC-15** — The system shall retain run history per agent and present recent runs (ran-at,
  version, recall, precision, citation, pass count, cost) newest-first.
- **AC-16** — The maintainer shall be able to select **two** runs and open a side-by-side
  comparison showing, for each of recall / precision / citation_accuracy, `old → new` with
  the delta, an acknowledged **cost** `old → new` delta alongside them (cost is a reported
  comparison value, not a headline judging metric), plus a **diff of the two runs' system
  prompts** (the agent-version snapshots that produced them). The comparison view itself is
  read-only.

**Dashboard**

- **AC-17** — A dedicated **Eval Dashboard** entry shall appear in the sidebar (SKILLS LAB
  group); opening it shall show each agent with its latest recall / precision /
  citation_accuracy and pass count, and a **Recent Eval Runs** list across all agents,
  most-recent first.
- **AC-18** — Selecting an agent from the dashboard shall open that agent's eval detail
  (metric cards, trend, recent runs) from which comparison (AC-16) is reachable.

**Robustness & verification**

- **AC-19** — Every eval route shall be schema-first (Zod `params`/`body` via the type
  provider) and reject invalid input with `422` before the handler, consistent with the rest
  of the server.
- **AC-20** — The system shall behave predictably on degraded inputs: an agent with zero
  cases, a case with an empty diff, a run where the reviewer returns no findings, and a
  `must_not_flag` case where the agent correctly stays silent shall all score without
  throwing (an empty set yields defined, not `NaN`, metrics).
- **AC-21** — `pnpm verify:l06` shall run **green with no API keys and no network**,
  exercising the run path against the mock reviewer adapter and asserting the pure scoring
  math (recall / precision / citation_accuracy on known fixtures).

**Case management (authoring / editing / deleting)**

- **AC-22** — The maintainer shall be able to author a **brand-new eval case from scratch**
  (outside the one-click-from-finding path), supplying a name, a frozen input (diff /
  optional files / PR metadata), and an expected output, and the case shall join the target
  agent's set.
- **AC-23** — When the maintainer edits a case, the system shall allow **renaming** it and
  **editing its expected-output** as JSON; while the expected output is not valid JSON, the
  system shall indicate it is invalid and prevent saving, and shall offer a **finding
  skeleton** affordance that inserts a well-formed expected-finding shape to edit.
- **AC-24** — When the maintainer deletes a case, the system shall remove it from the
  agent's set so that subsequent runs no longer score it; prior runs that already scored it
  remain in history.

**Running (added entry points)**

- **AC-25** — When the maintainer runs a **single case**, the system shall execute the agent
  against that case's frozen input and persist one per-case record exactly as a full run
  does; the agent's aggregate metrics shall still derive from the set's **latest** per-case
  records.
- **AC-26** — When the maintainer triggers **"Run all agents"** from the dashboard, the
  system shall run each agent against its own set independently; IF one agent's run fails,
  THEN the system shall still complete the remaining agents' runs and the dashboard shall
  reflect each agent's individual result (the failure isolated to that agent).

**Promotion**

- **AC-27** — When the maintainer confirms **"Promote vN"** in the run-comparison view, the
  system shall set the agent's **active version** to the **newer** of the two compared runs'
  agent versions; the comparison view itself performs no other write, and promotion is the
  only write path it exposes.
  - *Implementation note (accepted limitation):* the agent store uses **append-only
    versioning** (there is no in-place "set active version = N" primitive), so "Promote vN"
    is realised by re-applying vN's config snapshot, which produces a new active version whose
    configuration equals vN's. In the common flow (compare an older run against the current
    version, promote the current/newer one) this is a correct no-op; when promoting an *older*
    version the agent's active configuration is restored but its version *number* advances
    rather than resetting to N. Accepted for L06; a literal version-pointer reset is future work.

**Trend over history**

- **AC-28** — The dashboard and agent-detail surfaces shall present each agent's metric
  history **over its runs** (a per-agent sparkline and a per-metric trend over time), so a
  maintainer can see a metric's direction across more than the two most recent runs.

## Edge cases

- A finding is accepted, turned into a case, then later dismissed — the case keeps the
  expectation captured at creation time (cases are snapshots, not live views of the
  finding).
- A `must_find` case where the agent finds the *right* location but also emits extra
  findings — recall counts the match; precision is dented by the extras only if they are
  noise per the match rule.
- Two runs where the agent version did not change between them — comparison still works;
  the prompt diff is simply empty.
- The reviewer produces a finding citing a file:line outside the input diff — it lowers
  citation_accuracy (failed grounding) and does not count as a recall match.
- Path formatting differences (`a/src/x.ts` vs `src/x.ts`) must not cause false mismatches —
  file comparison normalises diff-header prefixes.
- Deleting a case that already appears in past runs — the case leaves the live set (no
  longer scored) but its historical per-case records remain, so old runs stay reproducible.
- Comparing two runs whose agent versions are the same — the prompt diff is empty and
  "Promote vN" is a no-op (the active version is already that version).
- An expected output edited to invalid JSON — the editor blocks the save and flags it; no
  malformed case can enter the set.

## Untrusted inputs

Each eval case freezes a real PR **diff fragment** (plus optional file snippets and PR
metadata) — attacker-influenced text. When a run executes the agent against that frozen
input, the diff and metadata shall be treated as **data, never instructions**; the pipeline
relies on the existing reviewer's guard for this and adds no new path that would let frozen
input text steer the model or the scorer. Scoring reads the input only for line/citation
comparison, never as prompt content.

## Out of scope (restated)

LLM-as-judge scoring; skill eval cases in the UI; CI metric gating; cross-workspace sharing;
editing findings from the eval surface; changing the reviewer or grounding logic.

## Deliverables (submission)

- This spec at `specs/eval-pipeline.md`.
- `pnpm verify:l06` green.
- A screenshot comparing two runs with different prompts (precision delta visible).
- A short screencast of the end-to-end scenario (create case → run → metrics → second run
  with changed prompt → compare).
