# Changelog — ui-frontend-architecture

All notable changes to this skill are documented here. The current version is recorded in
`metadata.version` in `SKILL.md`. Versioning follows [Semantic Versioning](https://semver.org/):
bump **major** for breaking guidance changes, **minor** for new sections/references,
**patch** for clarifications and source/link fixes.

## [1.0.0] — 2026-06-21

Initial release.

### Added
- `SKILL.md` — router/index with six core principles and a "where does this go?" decision table.
- `references/folder-structure.md` — feature-based vs layer-based, the bulletproof-react
  `src/` layout, the `shared → features → app` dependency rule, scaling model, naming
  conventions, when to split a component / extract a hook, container/presentational status.
- `references/placement.md` — placement of constants, `lib/` vs `utils/`, types, hooks, and
  the pure-function vs hook vs service triage for business logic, plus the promotion strategy.
- `references/nextjs-architecture.md` — App Router organization strategies, private
  `_folders`, the server/client boundary (leaf `"use client"`, donut/`children`, deep
  providers), data-fetching placement, and the server-only Data Access Layer + env rules.
- `references/imports-and-boundaries.md` — `@/*` path aliases, barrel-file policy, feature
  isolation and `import/no-restricted-paths` enforcement.
- `references/this-repo.md` — mapping the generic standard onto DevDigest's `client/`
  (route-colocated `_components`, named exports, `styles.ts`, the `lib/hooks → lib/api` layer).
- `examples.md` — ten good-vs-bad pairs across all topics.

### Scope
- Architecture / file-placement layer only; cross-links `react-best-practices` (component
  coding) and `next-best-practices` (routing/RSC mechanics) instead of duplicating them.
