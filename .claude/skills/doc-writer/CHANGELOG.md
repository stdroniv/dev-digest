# Changelog

All notable changes to the **doc-writer** skill are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); versioning is
[SemVer](https://semver.org/).

## [1.0.0] - 2026-06-24

### Added
- Initial release. Turns code, implementation plans, or raw notes into
  well-structured documentation placed correctly in the repo.
- Seven-step procedure: identify input → pick Diátaxis type (tutorial / how-to /
  reference / explanation / ADR / architecture doc) → pick location (docs/,
  module README/CLAUDE.md, docs/adr/) → ground in source → write in docs-as-code
  style → add Mermaid diagrams only where warranted (via `mermaid-diagram` skill)
  → link from the nearest index → report.
- `references/diataxis.md` with the mode decision tree, ADR format, location
  rules, diagram-selection guidance, and worked examples.
- Boundaries: defers `INSIGHTS.md` to `engineering-insights`; never edits an
  accepted ADR (supersede instead); never touches vendored code or migrations.
