# Changelog

All notable changes to the `backend-onion-architecture` skill are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this skill adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). The version here is kept in sync with
`metadata.version` in `SKILL.md` and `version` in `tile.json`.

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
