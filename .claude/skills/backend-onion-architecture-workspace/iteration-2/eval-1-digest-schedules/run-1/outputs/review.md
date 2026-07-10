# Architecture review — server/src/modules/digest-schedules/

Reviewed against DevDigest's onion/clean architecture conventions (Presentation →
Infrastructure → Application → Domain, dependencies point inward only). Overall: the module
has the right *file names* (repository/service/routes/helpers) but the dependency direction
breaks in several places, and there's meaningful business logic sitting in the wrong layer.
One file (`github-client.ts`) is genuinely clean and should not be touched.

## Issues (8)

### 1. `repository.ts` — scheduling business rules embedded in the infrastructure layer
`computeNextRunAt` (day-rollover handling, the `GRACE_WINDOW_MS` fudge factor) and the
`MAX_CONSECUTIVE_FAILURES` eligibility cutoff in `claimDueSchedules` are domain decisions
("what does it mean for a schedule to be due, and when do we stop retrying a broken one"),
not data-access. A repository should do queries/mutations only.

**Move to:** a domain/application concept, e.g. a pure function or small domain service
(`isScheduleDue(schedule, now)`, `hasExceededFailureBudget(schedule)`) that `service.ts` calls
after `repository.ts` returns plain rows. The repository then just does
`select ... where consecutiveFailures < N` if you want to keep the DB-side filter, but the
"is it due right now" math belongs outside infrastructure.

### 2. `repository.ts` — `recordRunResult` never increments failures (functional bug riding on #1)
`consecutiveFailures: ok ? 0 : undefined` sets the column to `undefined` (Drizzle no-op) on
failure, so a failing schedule's failure count never advances and `MAX_CONSECUTIVE_FAILURES`
can never trigger. Worth fixing alongside #1 since the increment logic is the same kind of rule
that shouldn't live half-implemented in the repository.

### 3. `service.ts` — repositories constructed by hand instead of via the composition root
```ts
constructor(private container: Container) {
  this.repo = new DigestSchedulesRepository(container.db);
  this.workspaceRepo = new WorkspaceRepository(container.db);
}
```
`container.ts` is supposed to be the single place concrete implementations get bound.
Constructing repos inline here means the service can't be unit-tested with `ContainerOverrides`
without also standing up a real `Db`, and it duplicates wiring logic outside the composition root.

**Move to:** bind `digestSchedulesRepo` / `workspaceRepo` on `Container` (or pass them into the
service's constructor) and have `service.ts` consume `container.digestSchedulesRepo` etc.,
matching how other modules resolve dependencies.

### 4. `service.ts` — raw `fetch` to the GitHub API + direct `process.env.GITHUB_TOKEN` read, bypassing the existing adapter
```ts
const res = await fetch(`https://api.github.com/repos/${workspace.repoOwner}/${workspace.repoName}/pulls?state=open`,
  { headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } });
```
This duplicates `github-client.ts` (which already exists as the intended adapter for exactly
this call) and pulls an infrastructure concern (HTTP client, secret access) directly into the
application layer. It also uses the *global* `GITHUB_TOKEN` env var instead of the
per-workspace `workspace.githubToken` already used two lines earlier for the rate-limit check —
so this is inconsistent as well as misplaced.

**Move to:** inject a `GithubClient`/`GithubActivityPort` via the container
(`container.github(workspace.githubToken)` or similar) and call `.getRepoActivity(...)` /
whatever method is needed. No `fetch` or `process.env` should appear in `service.ts`.

### 5. `service.ts` — module-level mutable `rateLimitCache` global
```ts
let rateLimitCache: Record<string, boolean> = {};
```
This is shared mutable state at module scope: it leaks across requests/tests, can't be reset
or swapped via `ContainerOverrides`, and isn't owned by anyone in the composition root.

**Move to:** either instance state on the service (still not ideal for a singleton-per-request
service, but scoped correctly) or a small cache/port bound through the container, so tests can
inject a fresh one.

### 6. `routes.ts` — `preview` endpoint runs raw Drizzle queries in the route handler
```ts
const rows = await app.container.db.select().from(t.digestSchedules)
  .where(eq(t.digestSchedules.workspaceId, workspaceId));
```
Presentation must never touch the DB directly — this skips the repository and service
entirely and puts a Drizzle import in the routes file.

**Move to:** add `service.previewSchedules(workspaceId)` (application layer), which calls
`repository.listForWorkspace` and maps to the preview DTO; the route just calls the service
and returns the result. Drop the `drizzle-orm` and `../../db/schema.js` imports from
`routes.ts` entirely.

### 7. `routes.ts` — `assertValidCronOverride` encodes a business rule at the presentation edge
The 5-field cron parsing and the "no more than every 5 minutes" cadence rule is a
domain/application invariant about what a valid schedule is, not a wire-shape check. Zod's job
here should stop at "is this a string"; the semantic validation belongs deeper so it's
enforced no matter which entry point creates a schedule (API, a future CLI/worker, etc.),
and so it's unit-testable without spinning up Fastify.

**Move to:** `helpers.ts` (domain) or `service.createSchedule` (application), invoked from the
route; the route only maps the thrown error to an HTTP 400 response.

### 8. `helpers.ts` — the intended domain layer imports/instantiates an infrastructure adapter and does I/O
```ts
import { GithubClient } from './github-client.js';
...
const client = new GithubClient(githubToken);
await client.getRepoActivity(owner, repo);
```
The file's own doc comment says it's "intended as the module's domain layer... independent of
Fastify/Drizzle" — but it directly imports and constructs a concrete infrastructure class and
performs a live network call. Domain code must not import adapters or do I/O; it should depend
only on a port (interface) that an outer layer implements.

Also: `export type DigestScheduleRow = InferSelectModel<typeof digestSchedules>` couples this
"domain" type directly to the Drizzle table definition (`../../db/schema.js`), so the domain
layer's type is defined in terms of the infrastructure schema rather than the other way around.

**Move to:**
- Define a domain port, e.g. `interface RepoActivityChecker { isRateLimited(owner, repo): Promise<boolean> }`, in `helpers.ts` or a `ports.ts` alongside it.
- Bind `GithubClient` as the implementation in `container.ts`, and have `service.ts` inject the port into whatever calls `shouldSkipDueToRateLimit` (or fold that check into the service, calling the injected port directly, and drop the standalone I/O-performing helper).
- Replace `DigestScheduleRow` (a raw Drizzle-inferred row) with a plain domain type (`DigestSchedule`), and do the row→entity mapping in `repository.ts`, not by re-exporting the DB row shape as if it were the domain model.

## Correctly layered — leave as-is

**`github-client.ts`** is a clean infrastructure adapter and doesn't need to change: it only
knows about `fetch`, the base URL, and the token; it returns a plain `RepoActivitySummary` DTO
rather than a raw `Response`; and it has no business logic. The only architectural follow-up
here isn't a change to this file — it's making sure the *rest of the module* goes through it
(via a container-bound port, see #4 and #8) instead of re-implementing its logic or bypassing
it with ad hoc `fetch` calls.

## Summary

The module's file-naming convention (repository/service/routes/helpers) is right, but three
recurring problems show up across it: (a) business/domain rules embedded in infrastructure or
presentation code instead of a domain/application layer, (b) the application layer reaching
past its adapters to do raw HTTP/env-var access that an adapter already exists for, and (c) DI
being done ad hoc (`new Repo(...)`, `new GithubClient(...)`) instead of through
`container.ts`. None of these require a rewrite — each has a narrow, mechanical fix — but they
should land before merge since they set the pattern other W2 modules will copy.
