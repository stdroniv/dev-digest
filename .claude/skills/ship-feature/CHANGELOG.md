# Changelog

All notable changes to the **ship-feature** skill are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); versioning is
[SemVer](https://semver.org/).

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
