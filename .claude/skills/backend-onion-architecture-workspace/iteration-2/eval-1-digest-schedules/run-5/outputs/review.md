# Architecture review: server/src/modules/digest-schedules/

Reviewed against DevDigest's onion-architecture convention (Presentation → Infrastructure →
Application → Domain, arrows point inward only). Findings below, ordered roughly by severity.
One file needs no changes at all — see the bottom.

## 1. `routes.ts` queries the DB directly in the `/preview` handler (presentation touching infrastructure)

`routes.ts:52-66` — the `GET /workspaces/:workspaceId/digest-schedules/preview` handler imports
`drizzle-orm` and `../../db/schema.js` and runs `app.container.db.select().from(t.digestSchedules)...`
directly in the route body. This is exactly the case the skill's pre-commit checklist calls out
("Does a route handler touch the DB / Drizzle? → push it into a service + repository"). Presentation
must go through a service/DTO, never Drizzle directly.

**Fix:** add a method (e.g. `previewForWorkspace(workspaceId)`) to `DigestSchedulesService` that
delegates to the repository and returns a plain DTO; drop the `drizzle-orm`/schema imports from
`routes.ts` entirely.

Bonus: the ad-hoc `nextRunLocal: \`${r.hourLocal}:00 ${r.timezone}\`` string duplicates
`describeSchedule()` in `helpers.ts` — another symptom of the logic living in the wrong layer.

## 2. `routes.ts` embeds a business rule in the handler (`assertValidCronOverride`)

`routes.ts:13-24` — the 5-field cron regex check is boundary syntax validation (fine as a Zod
refinement), but the embedded rule *"schedules cannot run more often than every 5 minutes"*
(line 21-23) is a domain/business invariant, not a request-shape concern. Right now it lives in the
presentation layer as a hand-thrown `Error`, bypassing the schema-first + structured-error
convention entirely.

**Fix:** keep basic shape validation (5 fields, allowed characters) as a Zod `.refine()` on
`CreateScheduleBody`. Move the "no more than every 5 minutes" rule into the domain/application
layer (e.g. a `validateCronOverride` domain function called from `DigestSchedulesService.createSchedule`),
so it's enforced regardless of caller and testable without spinning up Fastify.

Also note: `req.params as { workspaceId: string }` is a hand-cast, not a validated Zod `params`
schema — inconsistent with the "routes are schema-first" convention used for the body.

## 3. `service.ts` constructs repositories itself instead of receiving them from the composition root

`service.ts:18-21` — the constructor does `new DigestSchedulesRepository(container.db)` and
`new WorkspaceRepository(container.db)` inline. Per the DI convention, `platform/container.ts` is
the single composition root; services should receive already-bound repositories/ports
(`container.digestSchedulesRepo`, `container.workspaceRepo`), not `new` them ad hoc. As written,
this service can't be tested with `ContainerOverrides`/mocks the way the rest of the codebase is.

**Fix:** bind `DigestSchedulesRepository` and reuse `WorkspaceRepository` in `container.ts`, and
have `DigestSchedulesService` take them as constructor params (or off `container`) rather than
instantiating concrete classes.

## 4. `service.ts` bypasses its own adapter and hand-rolls a second GitHub client

`service.ts:56-59` — inside `runDueSchedules`, the service calls `fetch('https://api.github.com/...')`
directly and reads `process.env.GITHUB_TOKEN` itself, duplicating exactly what `github-client.ts`
already does correctly. This:
- Constructs infrastructure behavior (HTTP calls, base URLs) outside any adapter/port, inside the
  application layer.
- Reads a secret via `process.env` directly instead of going through the existing secrets/adapter
  path — the repo's own convention (`CLAUDE.md`) says LLM/GitHub secrets are managed centrally, not
  read ad hoc.
- Makes the already-existing `GithubClient` adapter partially dead code / a second source of truth
  for "how do we call the GitHub PRs endpoint."

**Fix:** inject `GithubClient` (or a `GitHubPort` interface it implements) via the container, and
call `client.getRepoActivity(...)` (or a new method returning open PRs) instead of a raw `fetch`.
`shouldSkipDueToRateLimit` already shows the right pattern of using `GithubClient` — reuse it, don't
parallel-implement it.

## 5. `service.ts` holds infra-shaped mutable global state in the application layer

`service.ts:12` — `let rateLimitCache: Record<string, boolean> = {}` is module-level, unbounded,
process-lifetime mutable state, read/written from `runDueSchedules`. This is a caching concern
(infrastructure), not something an application-layer use-case should own directly as a bare module
global — it's unscoped per request/instance, never evicted, and invisible to DI/testing overrides.

**Fix:** if a rate-limit cache is genuinely needed, push it behind a small port (e.g.
`RateLimitCache`) bound in the container (in-memory adapter today, swappable for Redis later), and
inject it into the service instead of a free-floating module variable.

## 6. `helpers.ts` is documented as the domain layer but performs I/O and imports an adapter

`helpers.ts:3,22-34` — the file's own docstring says it's "intended as the module's domain layer:
pure decisions... independent of Fastify/Drizzle," but `shouldSkipDueToRateLimit` imports
`GithubClient` (an infrastructure adapter), constructs one (`new GithubClient(githubToken)`), and
makes a live network call. That's an application-layer orchestration wearing a domain-layer label —
domain code must not import adapters or perform side effects at all, pure or otherwise.

**Fix:** split the file. Keep `describeSchedule` (pure, no imports beyond types) as genuine domain
logic. Move `shouldSkipDueToRateLimit` into `service.ts` (or a dedicated application-layer function)
that takes an already-injected `GithubClient`/port as a parameter rather than constructing one
inline. Rename the remaining pure file if useful (e.g. keep `helpers.ts` for domain-only rules, put
the orchestration in the service).

## 7. `repository.ts` embeds a scheduling business rule and returns raw Drizzle rows outward

- `repository.ts:39-47` (`computeNextRunAt`) — "what's the next local run time, accounting for
  day-rollover and a grace window" is a domain rule (schedule eligibility), not a data-access
  concern, yet it lives as a private method on the repository, and `GRACE_WINDOW_MS` /
  `MAX_CONSECUTIVE_FAILURES` (lines 12-13) are business constants sitting in the infrastructure file.
- `listForWorkspace`, `create`, `claimDueSchedules`, and `recordRunResult` all return raw
  `typeof digestSchedules.$inferSelect` rows straight out of Drizzle (no `toDomain()`/DTO mapping),
  and those rows flow all the way out through `service.ts` into the HTTP response in `routes.ts`.
  The skill's checklist explicitly flags this: "Does a repository return a Drizzle row outward? →
  add a mapper."

**Fix:** move `computeNextRunAt`/eligibility math (and the two constants) into the domain layer as
a pure function (e.g. `isScheduleDue(schedule, now)` in a domain module), have the repository fetch
candidate rows and hand them to that function (or have the service do the filtering after a plain
`listAll()`/`listActive()` repository call). Add a `toDomain()` mapper in the repository so
`DigestSchedule` entities/DTOs — not raw rows — are what `service.ts` and `routes.ts` ever see.
Also: there's no repository *interface* (port) here at all — the domain should own a
`DigestScheduleRepository` interface and `repository.ts` should implement it, so it can be swapped
via `ContainerOverrides` in tests like other repos in the codebase.

## What's already correct — leave it alone

**`github-client.ts` is correctly layered; do not churn it.** It's a clean infrastructure adapter:
no business logic, no direct callers reaching past it, returns a plain mapped
`RepoActivitySummary` rather than a raw `Response`, and the constructor takes its token as a
parameter rather than reading `process.env` itself. This is the pattern the rest of the module
should be pulled toward (see finding #4) — it's the good example already sitting in the codebase, not
a defect.

The CRUD portions of `repository.ts` (`listForWorkspace`, `create`) are also fine as data-access —
only the eligibility-computation piece (`computeNextRunAt`) and the missing row→entity mapping need
to move, not the whole file.

## Summary

7 distinct architecture issues:
1. `routes.ts` — direct Drizzle query in a route handler (`/preview`).
2. `routes.ts` — business rule (max frequency) embedded in the handler instead of domain/service.
3. `service.ts` — repositories constructed with `new` instead of via the composition root/container.
4. `service.ts` — duplicate hand-rolled GitHub `fetch`/env-var access bypassing the existing `GithubClient` adapter.
5. `service.ts` — module-level mutable cache (infra concern) living as a bare global in the application layer.
6. `helpers.ts` — claims to be the domain layer but imports an adapter and performs network I/O.
7. `repository.ts` — scheduling eligibility logic (`computeNextRunAt` + constants) misplaced in infrastructure, and raw Drizzle rows returned outward with no entity/DTO mapping, plus no repository interface/port.

Correctly layered, no changes needed: `github-client.ts`, and the CRUD (non-eligibility) methods of `repository.ts`.
