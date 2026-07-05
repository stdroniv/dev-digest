# Architecture review — `server/src/modules/digest-schedules/`

Reviewed against DevDigest's onion/clean-architecture conventions (Presentation → Infrastructure
→ Application → Domain, dependencies point inward only). Findings below, ordered roughly by
severity, each with the concrete file:line and where the code should actually live.

## Blocking issues

### 1. `routes.ts` queries the DB directly — presentation touching infrastructure

`routes.ts:3-4` imports `drizzle-orm` and the raw schema (`import { eq } from 'drizzle-orm'`,
`import * as t from '../../db/schema.js'`), and the `/preview` handler (`routes.ts:52-66`) runs a
`app.container.db.select().from(t.digestSchedules).where(...)` straight in the route handler.

This is the clearest violation in the set: Presentation must never touch Drizzle/the DB directly,
it must go through a service → repository. Move this query into
`DigestSchedulesRepository` (e.g. `previewForWorkspace(workspaceId)`), have
`DigestSchedulesService` call it and shape the `{ id, nextRunLocal }` projection, and have the
route just call `service.previewSchedules(workspaceId)` and reply with the DTO. Also drop the
`drizzle-orm`/schema imports from `routes.ts` entirely — presentation code should never import
either.

### 2. `routes.ts` embeds a business rule in the handler

`assertValidCronOverride` (`routes.ts:15-24`) is a domain rule — "a 5-field cron expression" and
"schedules cannot run more often than every 5 minutes" are invariants about what a valid digest
schedule *is*, not HTTP boundary concerns. Right now it lives in the presentation layer, throws a
bare `Error` (bypassing the app's Zod-boundary error shape), and — worth flagging as a functional
bug on top of the architectural one — its result is discarded: `cronOverride` is validated but
never passed into `service.createSchedule(...)`, so the validation has no effect on what gets
persisted.

Move the rule itself into the domain (e.g. a `CronOverride` value object or a pure
`validateCronOverride()` in a domain module) or at minimum into `DigestSchedulesService`, and have
`createSchedule` actually accept and persist/act on `cronOverride`. `routes.ts` should be limited
to Zod-parsing the body and delegating.

### 3. `service.ts` bypasses the composition root and re-implements an adapter that already exists

`service.ts:56-59` hand-rolls a `fetch` call straight to `https://api.github.com/...pulls`,
reading `process.env.GITHUB_TOKEN` directly inside the application layer. This is a double
violation:

- Application code must not talk to an external API or read secrets directly — that's an
  infrastructure/adapter concern reached through a port.
- DevDigest **already has** a `GitHubClient` port (`server/src/vendor/shared/adapters.ts`) with an
  `OctokitGitHubClient` implementation bound as `container.github` in the composition root
  (`server/src/platform/container.ts`). This module ignores that and reinvents a second,
  parallel, ad-hoc GitHub client via raw `fetch` in both `service.ts` and `github-client.ts`.

Fix: delete the inline `fetch` in `service.ts` and route through `container.github` (or, if the
existing `GitHubClient` port doesn't cover "list PRs opened in the last N hours" cheaply, extend
that shared port rather than growing a second one). Do not read `process.env.GITHUB_TOKEN`
outside the composition root / secrets provider.

### 4. `service.ts` constructs repositories itself instead of receiving them from the container

`service.ts:18-21` does `new DigestSchedulesRepository(container.db)` and
`new WorkspaceRepository(container.db)` inside the service constructor. The container is supposed
to be the single composition root — services should receive already-bound repositories/ports
(`container.digestSchedulesRepo`, `container.workspaceRepo`, etc.), not reach into `container.db`
and instantiate infrastructure classes themselves. As written, every consumer of
`DigestSchedulesService` re-wires the DB dependency by hand, and the repository can't be swapped
for a test double via `ContainerOverrides` the way every other module's tests do.

Bind `DigestSchedulesRepository` (and reuse the existing `WorkspaceRepository` binding) in
`container.ts`, and have `DigestSchedulesService` take them as constructor params.

### 5. `service.ts` holds cross-request mutable state at module scope

`service.ts:12` — `let rateLimitCache: Record<string, boolean> = {}` — is a module-level mutable
global inside the application layer. Beyond the general anti-pattern (this never resets, leaks
across requests/tests, and isn't safe with more than one process), it's infra-shaped state
(a cache) parked in a layer that's supposed to be a pure orchestrator. If a rate-limit cache is
needed, it belongs behind a small port (e.g. injected via the container, backed by an in-memory or
Redis adapter later) — not a bare module-level `let`.

### 6. Repository owns scheduling business rules, not just data access

`repository.ts:12-13` (`GRACE_WINDOW_MS`, `MAX_CONSECUTIVE_FAILURES`) and the
`computeNextRunAt`/`claimDueSchedules` logic (`repository.ts:33-77`) encode real domain rules —
"a schedule is due within a 10-minute grace window," "a schedule that has failed 3 times in a row
is no longer eligible." Infrastructure's job is data access + mapping, not deciding *what counts
as due*. Today this logic can't be unit-tested without a live `Db`, and it can't be reused if a
second entry point ever needs the same "is this schedule due" question.

Extract `computeNextRunAt` and the "eligible" predicate into a pure domain function (e.g.
`isScheduleDue(schedule, now)` next to `describeSchedule` — see finding 7 on where that file
should actually live), have `repository.ts` fetch all non-exhausted schedules
(`listEligible()`), and have the service/domain layer filter+claim using the pure predicate. The
repository should be left with only `listForWorkspace`, `create`, `recordRunResult`, and a plain
`listEligible()`/`updateLastRunAt()`.

### 7. `helpers.ts` is documented as the domain layer but isn't pure

The file's own header comment says it's "the module's domain layer... independent of
Fastify/Drizzle" — but:

- `helpers.ts:1-2` imports `InferSelectModel` and the `digestSchedules` Drizzle table directly, so
  the domain's core type (`DigestScheduleRow`) *is* a Drizzle-inferred type. If the table shape
  changes, the domain type changes with it — there's no `toDomain()` mapping boundary at all.
  Define a real `DigestSchedule` domain type independent of the table, and have the repository map
  `t.digestSchedules.$inferSelect` rows onto it before handing anything to the service.
- `shouldSkipDueToRateLimit` (`helpers.ts:22-34`) constructs a `GithubClient` and performs a
  network call. That's I/O through a concrete infrastructure class, not a pure decision — it
  cannot live in a domain file under this skill's rules ("domain must not import an adapter, must
  do no I/O").

Split this file: keep `describeSchedule` (and, per finding 6, an added `isScheduleDue`/eligibility
predicate) as the actual pure domain logic, rename/relocate them so the "domain" label is accurate
(no Drizzle import). Move `shouldSkipDueToRateLimit` into `DigestSchedulesService` (or an
application-layer helper), where it can call `container.github` (see finding 3) instead of
constructing its own client.

## Non-blocking but worth a follow-up

### 8. Repository returns raw Drizzle rows all the way to the HTTP response

`repository.ts` returns whatever `.select()`/`.returning()` gives back, and `service.ts:23-26`
spreads that row (`{ ...s, description: ... }`) straight into the response the route sends. No
`toDomain()`/DTO mapping exists anywhere in this module, so a raw DB row (including any column you
wouldn't want on the wire, e.g. internal bookkeeping fields) is what actually reaches the client
today. Not urgent to block the merge on, but once findings 6–7 introduce a real `DigestSchedule`
domain type, map to it in the repository and build the response DTO in the service, rather than
re-spreading rows.

### 9. Route params read via manual `as` casts instead of a declared Zod schema

`routes.ts:30`, `38`, `53` — `req.params as { workspaceId: string }` — bypasses this repo's
"routes are schema-first" convention (declare `params` via `fastify-type-provider-zod`, never
hand-cast). `CreateScheduleBody` does this correctly for the POST body; add an equivalent params
schema (e.g. `WorkspaceIdParams`) and use it on all three routes instead of the cast.

## Already correctly layered — do not churn

- **`github-client.ts`** is a clean example of an infrastructure adapter: it's the only file that
  knows about `fetch`/base URLs/the raw GitHub response shape, it takes its token as a constructor
  argument rather than reading `process.env` itself, and it returns a plain
  `RepoActivitySummary` DTO rather than a `Response`/raw JSON. Leave it as-is structurally — the
  only actionable point tied to it is finding 3 (it duplicates the existing `GitHubClient` port
  rather than being wired through the container), which is a wiring/duplication problem, not a
  problem with this file's own layering.
- **`repository.ts`**'s plain CRUD methods (`listForWorkspace`, `create`, `recordRunResult`) are
  correctly infrastructure-only: they only touch Drizzle, take primitives in, and don't reach
  outward into Fastify or the network. Only the scheduling-rule methods (finding 6) need to move;
  the file itself is in the right place and shouldn't be relocated wholesale.
- **`routes.ts`**'s `CreateScheduleBody` Zod schema and the POST/GET-list handlers (aside from
  findings 1, 2, 9) follow the schema-first, thin-handler pattern correctly — the handlers parse,
  delegate to the service, and return what the service gives them.

## Summary

Nothing here is a small nit — findings 1–7 are real dependency-direction and layer-purity
violations (presentation hitting the DB directly, application doing raw network I/O and secret
reads, a "domain" file that isn't pure, and business rules embedded in infrastructure and
presentation) and should be fixed before merge. Findings 8–9 are reasonable fast-follows. The
GitHub adapter file is solid and the plain CRUD half of the repository is fine as-is — resist the
urge to rewrite either of those wholesale; the fix here is extraction and re-wiring, not a full
rewrite of the module.
