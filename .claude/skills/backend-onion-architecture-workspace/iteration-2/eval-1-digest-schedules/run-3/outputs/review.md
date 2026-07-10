# Architecture review: `server/src/modules/digest-schedules/`

Reviewed against DevDigest's onion/clean-architecture conventions (Presentation →
Infrastructure → Application → Domain, arrows inward only, DI through the composition
root). Findings below, ordered roughly by severity, each with where the code should
actually live.

## Blocking issues

### 1. `routes.ts` queries the DB directly — presentation talking straight to Drizzle
`routes.ts:3-4` imports `drizzle-orm` and `../../db/schema.js`, and the `/preview`
handler (`routes.ts:55-58`) runs a raw `select().from(t.digestSchedules)...` inline in
the route. Presentation must never touch Drizzle directly — that's the one hard line
this skill draws first.
**Fix:** add a `previewForWorkspace(workspaceId)` method on `DigestSchedulesService`
(or the repository, mapped through the service) that returns the shaped preview DTO;
the route should call `service.previewForWorkspace(workspaceId)` and nothing else.
Drop the `drizzle-orm`/`schema` imports from `routes.ts` entirely.

### 2. `routes.ts` embeds a business rule in the presentation layer
`assertValidCronOverride` (`routes.ts:15-24`) isn't input-shape validation (that's what
`CreateScheduleBody`/Zod is for) — it encodes a scheduling policy ("cannot run more
often than every 5 minutes"). That's a domain/application rule sitting in the route
file. Also note it's currently dead: `cronOverride` is validated but never passed to
`service.createSchedule(...)`, so the validation has no effect on what gets persisted —
worth flagging to whoever owns this PR regardless of where the code ends up living.
**Fix:** move the cron-policy check into the domain/application layer (e.g. a
`CronOverride` value object or a rule the service enforces before calling the
repository), and either wire `cronOverride` through `createSchedule` or drop the field
from the request schema if it's not yet supported.

### 3. `repository.ts` owns scheduling business logic, not just data access
`computeNextRunAt`, `GRACE_WINDOW_MS`, and `MAX_CONSECUTIVE_FAILURES`
(`repository.ts:12-13, 39-47, 54-77`) decide *which schedules are eligible to run and
when* — that's a domain decision, not persistence. Per the infra-layer rule "no
business rules — repositories persist and fetch; they don't decide … workflow," this
belongs elsewhere. It also means the same eligibility rule can't be unit-tested without
a DB, and can't be reused by, say, a preview/dry-run feature.
**Fix:** move `computeNextRunAt` (and the "is this due, respecting the grace window and
failure cap" decision) into the domain layer as a pure function/entity method (e.g. on
a `DigestSchedule` entity or a `scheduling.ts` domain module). Have
`claimDueSchedules` become a thinner method that fetches candidate rows and applies the
domain decision, or better: fetch all non-exhausted schedules, hand them to a domain
function `selectDueSchedules(schedules, now)`, and only use the repository to persist
the resulting claim.

### 4. `repository.ts` never maps rows to a domain type — raw Drizzle rows leak out
Every method (`listForWorkspace`, `create`, `claimDueSchedules`, `recordRunResult`)
returns the raw `$inferSelect` row straight out of the repository. There's no
`toDomain()` boundary mapping anywhere. This is compounded by `helpers.ts` declaring
`DigestScheduleRow = InferSelectModel<typeof digestSchedules>` and treating that DB row
type as if it were the domain type — the "domain" layer is quietly just aliasing the
DB schema.
**Fix:** introduce a real `DigestSchedule` domain type/entity independent of the
Drizzle table, map rows to it inside `repository.ts` (a private `toDomain()`, per the
existing `DrizzleReviewRepository` pattern elsewhere in the codebase), and have
`helpers.ts`/`service.ts` operate on that entity instead of the raw row.

### 5. `helpers.ts` — the module's intended domain layer — imports and constructs an infrastructure adapter
`helpers.ts:3,27` imports `GithubClient` and does `new GithubClient(githubToken)`
directly inside `shouldSkipDueToRateLimit`, then performs a real network call. The file's
own doc comment says this is meant to be "pure decisions … independent of
Fastify/Drizzle," but it does the opposite: it reaches out to infrastructure and
performs I/O. This is a direct domain→infrastructure dependency, the one direction the
onion rule forbids, and it also violates the DI anti-pattern "constructing a concrete
adapter anywhere except the container."
**Fix:** `shouldSkipDueToRateLimit` shouldn't exist in this form in the domain layer at
all. Either (a) turn it into a pure domain predicate that takes an already-fetched
`RepoActivitySummary`/rate-limit signal as a parameter (no I/O, no adapter import), and
let the *service* fetch that signal via an injected `GithubClient`; or (b) if the
"try the call, catch = skip" logic is judged to be inherently an infrastructure
concern, move the whole function into the service/infrastructure layer and rename
`helpers.ts` to reflect that only `describeSchedule` remains as genuine domain logic.

### 6. `service.ts` bypasses the `GithubClient` adapter and re-implements the GitHub call inline
`service.ts:56-59` does a raw `fetch(...)` to the GitHub PRs endpoint using
`process.env.GITHUB_TOKEN` directly, duplicating what `github-client.ts` already
implements as the module's dedicated adapter. Two problems: this is infrastructure
code (raw HTTP + secret access) sitting in the application layer, and it silently
ignores `workspace.githubToken` (the value already used a few lines earlier for the
rate-limit check) in favor of a process-wide env var — likely a real bug as well as a
layering violation, since a multi-workspace/multi-token setup would query the wrong
repo's data with the wrong credentials.
**Fix:** call `GithubClient` (constructed once, via the container) to fetch PR/activity
data, passing `workspace.githubToken`. Per-CLAUDE.md convention, secrets should come
through the configured secrets/token path already threaded onto `workspace`, not
`process.env` read ad hoc inside a service method.

### 7. `service.ts` constructs its own repositories instead of resolving them from the container
`service.ts:19-20`: `new DigestSchedulesRepository(container.db)` and
`new WorkspaceRepository(container.db)` are built inline in the constructor rather than
exposed as getters on `Container` (the documented composition root pattern — see
`container.reviewRepo` for the existing convention). This makes the service untestable
without a real `Db` handle and bypasses the single place adapters are meant to be
bound/cached/overridden for tests.
**Fix:** add `digestSchedulesRepo` and reuse the existing `workspaceRepo` getter on
`Container`, and inject both into `DigestSchedulesService` via constructor params
(interfaces, not concrete classes) instead of taking the whole `Container` and
new-ing things up itself.

## Worth a mention, not blocking

### 8. `service.ts` module-level mutable `rateLimitCache`
`let rateLimitCache: Record<string, boolean> = {}` (`service.ts:12`) is process-global
mutable state shared across all requests/instances of the service, never cleared. It's
not strictly an onion-layering violation, but it undermines the testability benefit the
DI/container pattern is supposed to buy you (a fresh `DigestSchedulesService` in a test
still shares this cache), and it will silently misbehave across multiple server
instances. Consider making it instance state (constructor-injected or a field) or, if
it needs to survive across calls/instances, an explicit port (e.g. a small cache/store
interface bound in the container) rather than a bare module-level `let`.

## Correctly layered — leave as-is

- **`github-client.ts`** is a clean, correctly-placed infrastructure adapter: it's the
  only file that owns `fetch`/base-URL/token concerns for the GitHub REST call, returns
  a plain mapped `RepoActivitySummary` (never a raw `Response`), and takes no
  dependency on Drizzle, Fastify, or any inner-layer code. No changes needed here. The
  only follow-up (not a blocker) is to make sure it's actually the *single* thing that
  talks to the GitHub PRs endpoint — right now `service.ts` (#6 above) duplicates its
  job with an inline `fetch`, which is the real problem, not this file.

## Summary of moves

| Code | Currently in | Should live in |
|---|---|---|
| `/preview` DB query | `routes.ts` (presentation) | `service.ts`/`repository.ts`, returned as DTO |
| `assertValidCronOverride` | `routes.ts` (presentation) | domain/application rule |
| `computeNextRunAt` + due/failure-cap logic | `repository.ts` (infrastructure) | domain layer (pure function/entity) |
| Row→entity mapping | missing everywhere | `repository.ts` `toDomain()` boundary |
| `shouldSkipDueToRateLimit`'s GitHub call | `helpers.ts` (intended domain) | service (via injected `GithubClient`), keep only the pure predicate in domain |
| Inline GitHub `fetch` + `process.env.GITHUB_TOKEN` | `service.ts` (application) | `GithubClient` adapter, resolved from the container, using `workspace.githubToken` |
| `new DigestSchedulesRepository(...)`, `new WorkspaceRepository(...)` | `service.ts` constructor | `container.ts` getters, injected as interfaces |

**Total: 7 blocking issues, 1 non-blocking note, 1 file confirmed clean (`github-client.ts`).**
