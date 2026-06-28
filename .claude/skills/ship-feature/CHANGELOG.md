# Changelog

All notable changes to the **ship-feature** skill are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); versioning is
[SemVer](https://semver.org/).

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
