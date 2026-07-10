# Backend architecture review — `server/src/modules/digest-schedules/`

Reviewed against DevDigest's onion/clean-architecture conventions (dependency
rule: Presentation → Infrastructure → Application → Domain; inner layers never
import `drizzle-orm`/`fastify`/`zod`/SDKs; repositories map rows→entities;
adapters live behind ports wired in `platform/container.ts`).

Verdict: **do not merge as-is.** One file (`github-client.ts`) is essentially
correct and should not be churned. The other four each cross a layer boundary,
and the two most serious violations (a route running Drizzle directly, and a
"domain" helper doing network I/O) are the kind the dependency-cruiser rule is
meant to hard-block.

---

## `github-client.ts` — correctly layered, leave it alone

This is the model file. It is a proper **infrastructure adapter**: the only
place that knows about `fetch`, the base URL, and the bearer token; it returns a
plain `RepoActivitySummary`, never a `Response` or raw JSON. Dependency
direction is clean.

The only additive (non-churn) follow-up — do NOT rewrite the body — is to give
it a **port** so inner layers depend on an interface, not this concrete class:

- Declare `GithubClient`'s contract as an interface (a domain/application-owned
  port, e.g. alongside the other `@devdigest/shared` ports like `GitHubClient`),
  and have this class `implements` it.
- Construct it once in `platform/container.ts` and inject it, instead of letting
  callers `new` it (see `helpers.ts` below, which currently does exactly that).

Everything else here stays.

---

## `repository.ts` — right layer, but it's carrying domain logic and leaking rows

The file is correctly the **only** place importing `drizzle-orm`, and it is the
right home for `listForWorkspace`/`create`/the `claim`/`record` persistence. But
it does two things a repository must not:

1. **Business rules living in the repository.** `computeNextRunAt` (day-rollover,
   grace window), the `GRACE_WINDOW_MS`/`MAX_CONSECUTIVE_FAILURES` constants, the
   "is this schedule due right now?" filter, and "skip schedules that failed N
   times in a row" are all **domain decisions** about eligibility, not data
   access. Per the infrastructure rules, repositories "persist and fetch; they
   don't decide … workflow."
   - **Where it belongs:** a domain entity/value-object (e.g. a `DigestSchedule`
     entity that owns `nextRunAt(now)` and `isEligible(now)`), or a domain
     service. The repository should fetch candidate rows and let the domain
     decide due-ness. `helpers.ts` is the intended domain home — move
     `computeNextRunAt` and the eligibility predicate there (as pure functions on
     a domain entity, not on a DB row).

2. **Raw Drizzle rows escape the repository.** Every method returns
   `typeof digestSchedules.$inferSelect` untouched (no `toDomain()` mapping),
   coupling the service, routes, and `helpers.ts` to the DB column shape — the
   leaky-abstraction anti-pattern the skill calls out explicitly.
   - **Where it belongs:** add a private `toDomain(row)` mapper and return a
     domain `DigestSchedule` entity from every method.

3. **No port.** There is no `IDigestScheduleRepository` interface; the class is
   concrete. The domain should own the interface and this class should
   `implements` it, so the application layer depends on the port, not the class.

Minor correctness note (not architectural): `recordRunResult` sets
`consecutiveFailures: ok ? 0 : undefined` — on failure it never increments, so
`MAX_CONSECUTIVE_FAILURES` can never be reached. This is a symptom of the
failure-count rule being scattered instead of owned by a domain entity.

---

## `service.ts` — this is the biggest offender; it reaches through every layer

Intended as the **application** layer (pure orchestration over injected ports),
but it violates the dependency rule in five ways:

1. **Constructs its own repositories.** `new DigestSchedulesRepository(container.db)`
   and `new WorkspaceRepository(container.db)` build concrete infrastructure
   inside the service. Adapters/repos must be constructed **only in the
   container** and injected.
   - **Fix location:** bind both repos in `platform/container.ts`; inject the
     **interfaces** via the constructor.

2. **Depends on the whole `Container`.** It takes `container` and pulls `.db` off
   it. A use-case should list exactly the ports it needs
   (`IDigestScheduleRepository`, `IWorkspaceRepository`, a `GithubClient` port,
   an email/delivery port) as constructor params — explicit and mockable.

3. **Direct HTTP + infrastructure in the application layer.** The inline
   `fetch('https://api.github.com/...')` + `res.json()` is an infrastructure
   call sitting in the service — and it *duplicates* `github-client.ts`, which
   already exists to do exactly this.
   - **Where it belongs:** call the injected `GithubClient` adapter (the correct
     file above). Delete the inline fetch.

4. **Secret access in the application layer.** `process.env.GITHUB_TOKEN` reads a
   secret directly. Secrets belong behind a `SecretsProvider` adapter resolved
   from the container (CLAUDE.md: secrets live in `~/.devdigest/secrets.json`,
   never pulled ad hoc). It's also inconsistent — `shouldSkipDueToRateLimit`
   uses `workspace.githubToken`, this path uses the env var.

5. **Module-level mutable global state.** `let rateLimitCache = {}` is shared
   process-wide, not injected, and defeats unit testing (state leaks across
   runs/tests). If a rate-limit cache is needed it should be a small injected
   port/adapter (or at minimum instance state), not a module singleton.

`sendDigestEmail` (stubbed) is also a delivery side-effect that should be an
injected port/adapter, not a private method reaching out to a delivery system.

---

## `routes.ts` — presentation layer running queries and business rules

Two clear violations plus a project-convention miss:

1. **DB/Drizzle in a route handler.** The `/preview` handler runs
   `app.container.db.select().from(t.digestSchedules)...` directly. This is the
   exact rule the dependency-cruiser config hard-blocks: a handler must never
   touch the DB.
   - **Where it belongs:** add a `previewSchedules(workspaceId)` method on the
     service, backed by the repository; the handler calls the service and returns
     the DTO. Drop the `drizzle-orm` and `db/schema` imports from this file.

2. **Business logic in the route.** `assertValidCronOverride` parses a cron
   expression and enforces the "no more often than every 5 minutes" rule inside
   the handler. That's a **domain invariant**, not HTTP concern.
   - **Where it belongs:** a domain value-object (e.g. `CronExpression`) whose
     constructor enforces the rule, or a Zod `.refine()` for pure shape checks at
     the boundary. As written it also throws a plain `Error`, which surfaces as a
     500 instead of a 422 — another reason to move shape-validation into the Zod
     schema and the interval invariant into the domain.

3. **Not schema-first (convention miss).** Handlers cast `req.params as {...}`
   and `req.body as z.infer<...>` instead of using
   `withTypeProvider<ZodTypeProvider>()` with declared `params`/`body` schemas.
   CLAUDE.md is explicit: routes are schema-first; never hand-roll casts. The GET
   routes declare no `params` schema at all.

Constructing the service with `new DigestSchedulesService(app.container)` at
registration is tolerable, but once the service takes injected ports it should be
resolved from the container (`app.container.digestSchedulesService`) like the
other module services.

---

## `helpers.ts` — labelled "domain," but it is not pure and it imports the DB shape

The file's own comment says it's "the module's domain layer … independent of
Fastify/Drizzle." It currently is neither pure nor Drizzle-free:

1. **Type-only import of the Drizzle row.** `InferSelectModel<typeof
   digestSchedules>` binds the domain type to the DB schema — checklist item #1.
   Even though the alias is erased at runtime (so depcruise may miss it), it
   couples the core to the DB column shape.
   - **Fix:** declare an **independent** `DigestSchedule` domain entity/type here
     and have the repository `toDomain()`-map onto it. `describeSchedule` should
     take the domain entity, not a row.

2. **Network I/O in the domain.** `shouldSkipDueToRateLimit` does
   `new GithubClient(githubToken)` and awaits a live GitHub call. A domain
   function must be pure and side-effect-free, and it must not construct an
   infrastructure adapter.
   - **Where it belongs:** this is an **application/use-case** concern. Move it
     into `service.ts`, depending on the injected `GithubClient` **port**. The
     domain can own the *decision* ("skip if rate-limited") as a pure predicate,
     but the act of calling GitHub belongs in the application layer over an
     injected adapter.

`describeSchedule` is otherwise fine pure logic — it just needs to operate on the
domain entity instead of a DB row.

---

## Summary of where things should move

| Concern (today) | Current file / layer | Belongs in |
|---|---|---|
| `computeNextRunAt`, due-ness & failure-cap rules | `repository.ts` (infra) | Domain entity / service (`helpers.ts` area) |
| Raw `$inferSelect` rows returned | `repository.ts` (infra) | Add `toDomain()` → return domain entity |
| Missing `IDigestScheduleRepository` port | — | Domain owns the interface; repo `implements` it |
| `new …Repository(container.db)` in service | `service.ts` (app) | Construct in `platform/container.ts`, inject ports |
| Inline GitHub `fetch` + `res.json()` | `service.ts` (app) | Reuse `github-client.ts` adapter via injected port |
| `process.env.GITHUB_TOKEN` | `service.ts` (app) | `SecretsProvider` adapter via container |
| Module-global `rateLimitCache` | `service.ts` (app) | Injected cache port / instance state |
| `/preview` Drizzle query | `routes.ts` (presentation) | Service method + repository |
| `assertValidCronOverride` invariant | `routes.ts` (presentation) | Domain value-object (or Zod `.refine` for shape) |
| `req.params/body` casts | `routes.ts` (presentation) | Schema-first `withTypeProvider<ZodTypeProvider>()` |
| `InferSelectModel` type import | `helpers.ts` (domain) | Independent domain entity type |
| `shouldSkipDueToRateLimit` network call | `helpers.ts` (domain) | Application service over `GithubClient` port |
| `github-client.ts` | infra adapter | **Correct — keep as-is** (only add a port + container wiring) |
