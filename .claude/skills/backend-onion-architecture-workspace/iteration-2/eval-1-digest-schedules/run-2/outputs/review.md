# Architecture review — `server/src/modules/digest-schedules/`

Reviewed against DevDigest's onion/clean-architecture convention (Presentation →
Infrastructure → Application → Domain, dependencies point inward only). Verdict: **not
ready to merge as-is** — several files cross layer boundaries. Findings below, worst first,
with a concrete "move it here instead" for each, followed by the one file that needs no
changes.

## Findings

### 1. `routes.ts` — `/preview` endpoint talks to Drizzle directly (Presentation → Infrastructure violation)
```ts
const rows = await app.container.db
  .select()
  .from(t.digestSchedules)
  .where(eq(t.digestSchedules.workspaceId, workspaceId));
```
This is a route handler doing raw DB access — the exact thing the dependency rule forbids
("presentation MUST NOT import the DB / Drizzle directly"). It also means this one read path
has no service/repository test seam and silently diverges from `listForWorkspace`.

**Where it belongs:** add a `previewNextRuns(workspaceId)` method on `DigestSchedulesService`
that calls a (possibly new) repository method, returning a mapped DTO. The route should shrink
to `service.previewNextRuns(workspaceId)` → `reply.send(...)`. Drop the `drizzle-orm` and
`../../db/schema.js` imports from `routes.ts` entirely.

### 2. `routes.ts` — cron business rule implemented and enforced in the presentation layer
```ts
function assertValidCronOverride(cron: string) { ... throw new Error(...) }
```
Deciding what counts as a valid cron override and the "no more often than every 5 minutes"
policy is a business rule, not a boundary concern — Zod's job at the edge is shape validation,
not domain policy. As written it also throws a bare `Error`, which Fastify will turn into an
unhandled 500 instead of a mapped 400, and it bypasses the schema-first convention entirely
(this file already imports `z` for `CreateScheduleBody` but hand-rolls a second, un-typed
validation path next to it).

**Where it belongs:** move the rule into the application/domain layer — e.g. a
`parseCronOverride`/`assertValidCronOverride` pure function in `helpers.ts` (real domain logic,
no I/O) called from `DigestSchedulesService.createSchedule`, which throws a typed domain error
the route (or a shared error mapper) translates to 400. If you want edge-level rejection too,
express it as a Zod `.refine()` on `CreateScheduleBody` instead of an ad hoc regex + `throw`.

### 3. `routes.ts` — params read via type cast instead of a Zod schema
```ts
const { workspaceId } = req.params as { workspaceId: string };
```
Repeated in all three handlers. Not an onion-layer violation per se, but it's the same
schema-first convention this codebase enforces for bodies (`fastify-type-provider-zod`) — the
cast gives no runtime validation, so a malformed `workspaceId` reaches the service unchecked.

**Where it belongs:** declare a `params: z.object({ workspaceId: z.string().uuid() })` schema
(or whatever ID shape this app uses) alongside `CreateScheduleBody` and let the type provider
infer it, same pattern already used for the POST body.

### 4. `service.ts` — bypasses the composition root, constructs repositories with `new`
```ts
constructor(private container: Container) {
  this.repo = new DigestSchedulesRepository(container.db);
  this.workspaceRepo = new WorkspaceRepository(container.db);
}
```
`container.ts` is supposed to be the single composition root; services should receive already-
bound dependencies from it, not hand-build them from `container.db`. This also means this
service can't have its repositories swapped via `ContainerOverrides` in tests the way the rest
of the app does.

**Where it belongs:** bind `digestSchedulesRepo` / (reuse the existing) `workspaceRepo` in
`platform/container.ts` and inject them into `DigestSchedulesService`'s constructor (or resolve
them off `container` without re-instantiating): `container.digestSchedulesRepo`,
`container.workspaceRepo`.

### 5. `service.ts` — GitHub call is inlined with `fetch` + `process.env`, duplicating `github-client.ts`
```ts
const res = await fetch(
  `https://api.github.com/repos/${workspace.repoOwner}/${workspace.repoName}/pulls?state=open`,
  { headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } },
);
```
This is infrastructure (raw HTTP client + secret access) leaking straight into the application
layer, and it duplicates the adapter that already exists for this in `github-client.ts` — now
there are two different code paths hitting the GitHub pulls API with two different token
sources (`workspace.githubToken` in `helpers.ts` vs. `process.env.GITHUB_TOKEN` here). Reading
`process.env.GITHUB_TOKEN` directly also sidesteps this repo's secrets convention (secrets live
in `~/.devdigest/secrets.json`, surfaced through the container/config, not read ad hoc from
`process.env` in a service).

**Where it belongs:** call the existing `GithubClient` (via the container, see #7) instead of
`fetch` — `container.github.getRepoActivity(...)` or a dedicated "list open pulls" method added
to `GithubClient`. Delete the inline `fetch` and the `process.env` read from `service.ts`.

### 6. `service.ts` — module-level mutable global cache
```ts
let rateLimitCache: Record<string, boolean> = {};
```
Shared mutable state at module scope isn't a layering violation, but it's worth flagging in the
same pass: it leaks across requests/instances, never expires, and makes the service hard to
unit test in isolation (state persists between test cases unless manually reset).

**Where it belongs:** make it an instance field on `DigestSchedulesService`, or better, push it
behind a small cache port bound in the container so it can be swapped/cleared in tests.

### 7. `helpers.ts` — labeled "domain layer" but performs network I/O through an infrastructure adapter
```ts
/** ... Intended as the module's domain layer: pure decisions ... independent of Fastify/Drizzle. */
...
import { GithubClient } from './github-client.js';
export async function shouldSkipDueToRateLimit(...) {
  const client = new GithubClient(githubToken);
  await client.getRepoActivity(owner, repo);
  ...
}
```
`describeSchedule` is genuinely pure domain logic and belongs here. `shouldSkipDueToRateLimit`
is not — it imports an infrastructure adapter and makes a network call, which is exactly what
the domain layer must never do ("MUST NOT import ... any adapter").  It's also instantiating
`GithubClient` directly with `new` instead of going through the container.

**Where it belongs:** move `shouldSkipDueToRateLimit` out of `helpers.ts` into
`DigestSchedulesService` (application layer), where it can call an injected `GithubClient`/port.
Keep `helpers.ts` limited to genuinely pure, I/O-free functions like `describeSchedule` (and the
cron rule from #2).

### 8. `helpers.ts` — domain type derived from the Drizzle-inferred row type
```ts
export type DigestScheduleRow = InferSelectModel<typeof digestSchedules>;
```
This inverts the dependency: the "domain" type is defined in terms of the infrastructure schema
instead of the other way around. If the table shape changes, the domain type changes with it
with no mapping seam in between — and it's consistent with finding #10 (repository returning
raw rows rather than a domain entity).

**Where it belongs:** define an independent `DigestSchedule` domain type (or entity) here that
doesn't import from `db/schema.js`, and have `repository.ts` map rows onto it (`toDomain()`),
per finding #10.

### 9. `repository.ts` — returns raw Drizzle rows from every method
`listForWorkspace`, `create`, `claimDueSchedules`, and `recordRunResult` all return `db` rows
(or `row` from `.returning()`) straight to the caller with no mapping step. Per this project's
convention, a repository should map `typeof table.$inferSelect` rows to a domain entity/DTO
before returning outward — right now `service.ts` and eventually the route are working with raw
persistence rows, so any future schema change ripples straight through to the application layer.

**Where it belongs:** add a `toDomain(row)` mapper in `repository.ts` (or import the domain type
from a corrected `helpers.ts`, see #8) and have each method return the mapped entity/array of
entities instead of the raw row.

### 10. `repository.ts` — `computeNextRunAt` is domain business logic sitting in infrastructure
```ts
private computeNextRunAt(hourLocal: number, timezone: string, now: Date) { ... }
```
Working out "is this schedule due, accounting for timezone and day rollover" is a pure
computation with zero DB dependency — it's a business rule about scheduling, not data access. It
currently lives as a private method on the repository, which means it can't be unit-tested
without spinning up the repository/DB, and it's not reusable from anywhere else that needs the
same "when does this schedule next fire" answer (e.g. the `/preview` endpoint in finding #1 is
crying out for exactly this function).

**Where it belongs:** move `computeNextRunAt` into `helpers.ts` as a pure, exported function
(taking a domain `DigestSchedule`, not a raw row, per #8). `repository.ts` then only fetches
candidate rows from the DB and filters/updates using that imported pure function — DB access
and eligibility logic become separately testable.

## What's already correct — leave it alone

**`github-client.ts` is correctly layered as-is.** It's a clean infrastructure adapter: no
Fastify, no Zod, no Drizzle; it owns `fetch`, the base URL, and the token; it returns a plain
`RepoActivitySummary` DTO rather than a `Response`, exactly per convention. The only change
needed anywhere near it is *upstream* — get the rest of the module (service.ts, helpers.ts) to
actually go through it via the container instead of bypassing it (`new GithubClient(...)` in
`helpers.ts`) or reimplementing it inline (`fetch` in `service.ts`). Don't touch this file.

## Summary table

| File | Verdict | Action |
|---|---|---|
| `github-client.ts` | Correct — no changes | none |
| `repository.ts` | Violations | map rows → domain entity; extract `computeNextRunAt` to `helpers.ts` |
| `service.ts` | Violations | get repos from container, not `new`; call `GithubClient` via container instead of inline `fetch`/`process.env`; make cache instance-scoped |
| `routes.ts` | Violations | remove direct Drizzle query from `/preview`; move cron validation to application/domain; validate params with Zod |
| `helpers.ts` | Violations | drop `shouldSkipDueToRateLimit` (network I/O) to `service.ts`; define an independent domain type instead of `InferSelectModel` |

10 distinct issues flagged across 4 files; 1 file (`github-client.ts`) confirmed correctly
layered and should not be churned.
