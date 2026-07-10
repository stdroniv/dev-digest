# Changelog

All notable changes to the `backend-onion-architecture` skill are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this skill adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). The version here is kept in sync with
`metadata.version` in `SKILL.md` and `version` in `tile.json`.

## [1.2.0] - 2026-07-05

### Added

- `evals/files/digest-schedules/*.ts` + eval `id: 1` in `evals/evals.json`: a second, larger
  fixture (routes/service/repository/helpers + a deliberately clean `github-client.ts` adapter)
  seeding subtler violations than the webhooks fixture — a cross-module reach into another
  module's repository, a domain-layer helper importing/constructing an infrastructure adapter,
  and a domain type aliased to a Drizzle row — plus a precision check (F9) that a correctly-layered
  adapter is *not* flagged. Used for higher-load, multi-run variance evaluation.
- `examples.md` #2: a second BAD/GOOD pair showing the *type-only* leak — a domain type defined via
  `InferSelectModel<typeof table>` / `$inferSelect` — alongside the existing runtime active-record
  leak, with a note distinguishing it from example #3 (a row escaping outward at runtime).

### Changed

- Sharpened the guidance so the quiet, `import type` form of Drizzle-in-the-domain is caught in
  review (a 5-run eval on the digest-schedules fixture missed it once when it was only implied by
  the abstract rule): pre-commit checklist item 1 in `SKILL.md` now explicitly names type-only
  imports and `InferSelectModel`/`$inferSelect` domain-type aliases, and
  `references/domain-layer.md` adds it as a named anti-pattern to reject.

## [1.1.0] - 2026-07-05

### Added

- `evals/evals.json` + `evals/files/webhooks/*.ts`: a self-contained eval suite (skill-creator
  format) — a synthetic "webhooks" module fixture seeding five distinct onion-architecture
  violations (route-handler DB access, business logic in a route handler, a domain rule embedded
  in the repository, raw Drizzle rows leaking outward with no DTO mapping, and a concrete adapter
  constructed outside the DI container), with `expectations` for grading. Ships with the skill so
  it can be re-evaluated after future edits without recreating test cases from scratch.

## [1.0.0] - 2026-06-21

### Added

- Initial skill enforcing strict Onion Architecture on the DevDigest backend (`server/` and
  `reviewer-core/`).
- `SKILL.md`: the inward-only dependency rule, the four-layer model
  (domain → application → infrastructure → presentation) as a quick-reference table, the
  Fastify/Drizzle/Zod/OpenAI tool→layer mapping, the composition-root note, a pre-commit
  checklist, and a versioning policy.
- `references/`: per-layer guides (`domain-layer`, `application-layer`, `infrastructure-layer`,
  `presentation-layer`), `dependency-injection` (ports/adapters + `platform/container.ts`),
  `dependency-rule` (a copy-paste `dependency-cruiser@17.4.3` config that mechanically blocks
  inner→outer and handler→DB imports and keeps `reviewer-core` pure), and `migration-from-current`
  (maps today's `routes/service/repository` layout to strict onion).
- `examples.md`: seven good-vs-bad code pairs targeted at the DevDigest stack.
- Research references preserved under `metadata.references` in `SKILL.md` (Palermo's Onion,
  Uncle Bob's Clean Architecture, Hexagonal, DDD, SOLID/DIP, Fowler on DI, Node/TS implementation
  guides, and the Fastify/Drizzle/Zod docs).
