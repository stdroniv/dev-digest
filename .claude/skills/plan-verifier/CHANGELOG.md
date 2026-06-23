# Changelog

All notable changes to the **plan-verifier** skill are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); versioning is
[SemVer](https://semver.org/).

## [1.0.0] - 2026-06-24

### Added
- Initial release. Requirement-by-requirement verification of an implementation
  against its plan (`docs/plans/<slug>.md`) or a given requirements list.
- Five-step procedure: extract atomic requirements → bidirectional evidence
  tracing → confirm reachable + tested (not merely present) → classify
  (Implemented / Partial / Missing / Cannot-verify) → emit traceability matrix
  + verdict.
- Strict scope discipline: coverage only, never code quality (distinct from
  `pr-self-review` and `architecture-reviewer`).
- `references/matrix-template.md` with a fuller template and worked example.
