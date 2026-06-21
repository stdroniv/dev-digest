# Migration: today's layout → strict onion

The backend is already *layered*, just not *strict onion*. This doc maps what exists to the target
and lists the concrete gaps to close. Treat the first `dependency-cruiser` run
([dependency-rule.md](dependency-rule.md)) as the migration backlog.

## Mapping table

| Onion layer | Today | Status |
|-------------|-------|--------|
| **Domain** | `reviewer-core/src/*` (pure); no domain types in `server/` modules yet | ⚠️ partial — pure core exists, but `server/` has no entities/value-objects/ports |
| **Application** | `server/src/modules/*/service.ts` | ⚠️ partial — orchestrates, but depends on the whole `Container` and returns rows/DTOs inconsistently |
| **Infrastructure** | `server/src/modules/*/repository.ts`, `server/src/adapters/*`, `server/src/db/*` | ✅ mostly compliant — Drizzle/SDKs already isolated; ports in `@devdigest/shared` |
| **Presentation** | `server/src/modules/*/routes.ts`, `app.ts` | ✅ mostly compliant — schema-first Fastify, thin handlers |
| **Composition root** | `server/src/platform/container.ts` | ✅ compliant — single root, lazy adapters, test overrides |

## Already compliant (keep doing this)

- **Ports/adapters with a single composition root** — `platform/container.ts` binds concrete
  adapters to port interfaces declared in `@devdigest/shared`. This is textbook DIP.
- **`reviewer-core` purity** — no DB/HTTP/FS; side effects via injected `LLMProvider`.
- **Schema-first thin handlers** — Zod at the boundary via `fastify-type-provider-zod`.
- **Tenancy scoping** in repositories.

## Gaps to close (in priority order)

1. **Introduce a domain layer in `server/`.** Add entities + value objects with invariants
   (`Review`, `Finding`, `Severity`) and **repository interfaces** (`IReviewRepository`) owned by
   the domain. Today repositories are concrete-only with no inner interface.
2. **Map rows → entities → DTOs.** Repositories return domain entities via a private `toDomain()`;
   use-cases return Result DTOs. Stop passing `$inferSelect` rows outward.
3. **Tighten service dependencies.** Inject the specific repository/port interfaces a use-case
   needs instead of the whole `Container`, so dependencies are explicit and mockable.
4. **Add the dependency-cruiser config** and run it in each package's check step to lock the rule.

## Suggested target folder shape (per package)

Two valid options — pick one and keep the dependency-cruiser rules aligned:

- **Layer-first** (closest to canonical onion):
  `src/domain/<aggregate>/`, `src/application/<use-case>/`, `src/infrastructure/<adapter|repo>/`,
  `src/presentation/<module>/`.
- **Module-first, layer-within** (closest to today, lower churn):
  `src/modules/<feature>/{domain,application,infrastructure,presentation}.ts|/`, keeping the
  existing `routes.ts`/`service.ts`/`repository.ts` names as the presentation/application/
  infrastructure files and adding a `domain/` folder.

Either way the **dependency direction is identical** and the cruiser rules enforce it.

## Do it incrementally

Migrate one module at a time (start with `reviews` — it already has the richest logic). For each:
extract entities/value-objects, declare the repository interface in the domain, make the existing
`repository.ts` implement it, have the service return DTOs, then enable the cruiser rules for that
path. Nothing forces a big-bang rewrite — the rule and the structure can tighten module by module.

> **Scope note:** authoring this skill does **not** refactor any backend code. The migration above
> is follow-up work; the skill provides the target, the rules, and the examples.
