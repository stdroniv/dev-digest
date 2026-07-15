# Changelog

All notable changes to the **ship-feature** skill are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); versioning is
[SemVer](https://semver.org/).

## [1.5.0] - 2026-07-13

### Changed
- **`test-writer` is now a firm stage — the fold-away option is removed (reverses 1.2.0).**
  Step 6 no longer lets you skip `test-writer` "when the implementer already wrote
  comprehensive tests." The implementer is now scoped to **source only**: it writes
  production code and self-verifies by *running* typecheck / lint / build and the
  **existing** tests; `test-writer` is the pipeline's sole author of **new** test files.
  Every implementer prompt must say so (leaf agents get no history). The only skip case is
  a change that genuinely needs no new tests (docs/config/trivial), and `plan-verifier`'s
  coverage check still backstops it.
- **Loop-back routes by lane (Step 8).** A missing-tests / untested-critical-path finding
  goes to `test-writer`, not the implementer; source/behavior fixes stay with the
  implementer.
- **Orchestration rule made explicit:** the two writers have non-overlapping lanes —
  implementer = source, test-writer = tests.

### Rationale
- Real session telemetry showed the 1.2.0 fold backfired: the **implementer was 33% of
  spend while `test-writer` was 1%** — i.e. test authoring had migrated into the
  implementer. Because cost scales with *conversation length × context size* (cache-read is
  ~93% of tokens), writing tests inside the implementer's large, already-loaded context
  re-bills that whole context per turn and costs **more** than a fresh, lean `test-writer`,
  not less. The 1.2.0 "save an agent run" optimization was a false economy; separating the
  lanes is both cheaper and keeps the implementer from grading its own homework. Paired with
  matching edits to `.claude/agents/implementer.md` (source-only scope).

## [1.4.0] - 2026-07-01

### Added
- **Spec stage.** The pipeline now opens with `spec-creator` (Step 2) and a **spec
  approval gate** — the WHAT/WHY is agreed as `specs/SPEC-NN-<date>-<slug>.md` (EARS
  ACs) before any planning. Skippable only when the request is already a crisp, written
  spec.
- **`spec-conformance` gate (Step 4).** A fast, read-only `sonnet` **plan⊨spec** check
  over the spec + plan *documents* (no code): every AC maps to an owning task, every task
  traces back to an AC. Runs at the plan approval gate so the human approves a plan
  already checked for spec coverage; gaps loop back to `implementation-plan`. It is the
  pre-code mirror of `plan-verifier` (which stays the post-code **code-vs-plan** gate).
- **Multi-agent implementer fan-out (Step 5).** When the plan's execution mode is
  multi-agent, fan out one `implementer` per non-overlapping `Owned paths` group in
  dependency order (`reviewer-core` → `server` → `client`), threading each layer's real
  contract into the next agent's prompt. Below the >1-package / ~15-file threshold, one
  implementer.

### Changed
- **Renamed `planner` → `implementation-plan`** throughout (the agent was renamed in
  `.claude/agents/`); every spawn instruction, the diagram, the cost-discipline
  reference, and prose shorthand updated. **The old skill spawned a now-deleted agent.**
- **Two clarify gates are now sequenced.** `spec-creator` settles WHAT; `implementation-plan`
  asks HOW only. A planner question the spec already answers is resolved from the spec,
  never bounced back to the user — no double-questioning.
- **Don't also run `/pr-self-review` inside the pipeline** — it routes files to the same
  skills the Step-7 reviewer agents apply; running both double-bills the review.
- Step numbering shifted (spec + conformance inserted): review is now Step 7, gate/loop-back
  Step 8, doc-writer Step 9, report Step 10; all internal cross-references updated.

### Rationale
- The agent layer had moved to a spec-first flow (`spec-creator` + renamed
  `implementation-plan`) and the README was updated to match, but this skill still drove
  the old `researcher → planner` pipeline and would have spawned a deleted agent. This
  release re-syncs the orchestrator with the agents, and adds the `spec-conformance` gate
  that closes the previously-unowned "does the plan cover the spec?" check at the cheapest
  point — before the implementer runs.

## [1.3.0] - 2026-06-28

### Added
- "The two rules that actually change outcomes" callout near the top, foregrounding the
  two decisions an eval showed actually move behavior: (1) a non-blocking finding is a
  note, never a loop-back; (2) converge deliberately — adjudicate a dispute once, then
  escalate.
- `references/cost-discipline.md` — the full cost rationale + token figures, linked from
  a lean four-rule summary in `SKILL.md`.

### Changed
- **Step 5 reviewers are now right-sized, not always-three.** `plan-verifier` always
  runs; `architecture-reviewer` runs on structural diffs; `security-reviewer` is
  *mandatory* on any real attack surface (auth, routes, secrets, LLM prompt path,
  file/path access, DB/migrations, outbound calls) but may be skipped with a one-line
  justification on a pure no-boundary change. Codifies the right-sizing a strong
  orchestrator already does, while keeping security mandatory where it counts.
- **Step 6 convergence guard now adjudicates a disputed finding once, then escalates.**
  On a dispute (no code change), re-check only that finding with the *owning* reviewer
  (fresh, minimal agent, handed the rebuttal as evidence); drop → converge, uphold or
  3-round cap → escalate to the human. Replaces the previous immediate hard stop.

### Rationale
- Derived from a 6-scenario decision-fidelity eval (with-skill vs no-skill, Opus
  orchestrator). The skill scored 22/22 vs the baseline's 19/22, but the gap lived in
  only two decisions; these edits sharpen those two, bless the reviewer right-sizing both
  arms already did, and move the densest reference material out of the hot path.

## [1.2.0] - 2026-06-27

### Added
- Pre-flight reachability gate before greenfield / new-dependency `implementer` runs
  (can the dep install? is Docker up? does the external API authenticate?).

### Changed
- `test-writer` (Step 4) may be folded when the implementer already wrote comprehensive
  passing tests — but only with `plan-verifier`'s coverage check as a standing backstop,
  so an independent "is anything untested?" pass still happens.
- `plan-verifier` defaults to **blocking completeness** (not the exhaustive
  requirement-by-requirement matrix, which was the parallel long-pole) and carries a
  standing test-coverage instruction.
- Don't background a verification the pipeline only waits on (serial-step backgrounding
  deadlocks the Stop hook and re-bills orchestrator context); never run a scoped re-check
  by *resuming* a reviewer (resume re-bills the whole transcript — spawn a fresh minimal
  agent or verify inline).

## [1.1.0] - 2026-06-24

### Added
- "Cost & robustness discipline" section, derived from a real run's telemetry
  (cache-read was ~93% of tokens — cost scales with conversation length × context,
  not model tier). Codifies: one-retry-then-DIY on a dropped agent (`planner`);
  split a big implementation by layer above a >1-package / ~15-file threshold;
  keep agent contexts lean (exact file lists, heavy verification as a final step);
  scope re-validation to specific findings/files; consolidate exploration; don't
  poll background agents; escalate `implementer` to Opus only on flagged-hard work.

## [1.0.0] - 2026-06-24

### Added
- Initial release. Orchestrates the DevDigest feature-delivery pipeline end-to-end
  from the main session, which spawns the project subagents via the `Task` tool
  (subagents are leaves and cannot spawn each other).
- Pipeline: optional `researcher` → `planner` (with a hard human approval gate on the
  plan) → `implementer` → `test-writer` → parallel `architecture-reviewer` +
  `security-reviewer` + `plan-verifier` → blocking-findings loop-back to `implementer`
  (3-round / no-new-changes convergence guard) → optional `doc-writer` → report.
- Per-reviewer blocking criteria (architecture `CRITICAL`, security `High`,
  plan-verifier `Missing` / substantive out-of-scope), tuned to DevDigest's
  local-first, single-user threat model.
- Guidance on passing explicit context to stateless leaf agents (plan path, diff base,
  changed-file list, findings) and on parallelising only the independent review stage.
