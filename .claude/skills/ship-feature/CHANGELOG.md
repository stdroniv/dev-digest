# Changelog

All notable changes to the **ship-feature** skill are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); versioning is
[SemVer](https://semver.org/).

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
