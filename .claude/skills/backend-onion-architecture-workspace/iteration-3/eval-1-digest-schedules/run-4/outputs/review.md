# Architecture Review — `server/src/modules/digest-schedules/`

Reviewed against DevDigest's onion/clean layering: **Presentation → Infrastructure → Application → Domain**, dependencies inward only, no Drizzle/Fastify/HTTP in inner layers, repository interfaces owned by the domain with Drizzle implementations in infrastructure, rows mapped to entities, adapters wired through the composition root (`platform/container.ts`).

Verdict: **do not merge as-is.** One file (`github-client.ts`) is correctly layered and should be left alone. The other four each cross a layer boundary. The most serious problem is that the module has no real domain layer — the domain rules (what "due" means, the failure-cap invariant, the cron policy) are scattered across the repository, the routes, and a `helpers.ts` that both binds to the DB row shape *and* makes network calls while calling itself the domain.

---

## `github-client.ts` — CORRECT, leave it alone

This is the one file that is already properly layered. It's a thin infrastructure adapter: it is the only place that knows about `fetch`, the base URL, and the token; it throws on non-2xx; and it returns a plain domain-shaped DTO (`RepoActivitySummary`) rather than a `Response` or raw JSON. This is exactly what an infrastructure adapter should look like. Do not churn it.

The only follow-up (not a blocker, and not a change to this file's internals): its interface should be promoted to a **port** and the client **bound in `platform/container.ts`**, so services receive it via `container.github` instead of `new`-ing it. See the `helpers.ts` and `service.ts` findings below — both bypass this adapter, which is the real waste.

---

## `helpers.ts` — MISLABELED DOMAIN; two violations

The header calls this "the module's domain layer … independent of Fastify/Drizzle." It is neither independent nor pure.

1. **Type-only import binding the core to the DB row shape** (checklist rule 1). `DigestScheduleRow = InferSelectModel<typeof digestSchedules>` ties every "domain" function to the Drizzle table definition. A type alias is erased at runtime so dependency-cruiser may not catch it, but it still couples the domain to the schema. Define an independent `DigestSchedule` domain entity (id, workspaceId, hourLocal, timezone, consecutiveFailures, lastRunAt) with no `drizzle-orm` import, and have the repository `toDomain()`-map onto it. `describeSchedule` should then take that entity.

2. **The domain is doing network I/O.** `shouldSkipDueToRateLimit` constructs `new GithubClient(githubToken)` and awaits an HTTP round-trip. A domain function must not instantiate an infrastructure adapter or perform I/O. **Where it belongs:** the orchestration ("check rate limit, then decide to skip") is an **application** concern and belongs in the service, using an injected `github` port — not a hand-rolled client. The pure part (the *decision* given an activity summary) can stay in the domain as a synchronous predicate.

`describeSchedule` is fine as a pure domain function once it operates on a real entity instead of a Drizzle row.

---

## `repository.ts` — infrastructure, but stuffed with domain logic

The Drizzle/`db` imports are correct here (infrastructure is the right home for them). Two problems:

3. **Business rules living in the repository.** `computeNextRunAt` (day-rollover, timezone math), the `GRACE_WINDOW_MS` match window, and the `MAX_CONSECUTIVE_FAILURES` skip filter are **domain decisions**, not data access. `claimDueSchedules` currently *decides* what "due" means and *filters in application memory* after a `select()`. The scheduling policy (is this schedule due? has it exceeded the failure cap?) belongs in the **domain** (an entity method / domain service); the repository should only fetch candidate rows and persist the claim. As written the repo is both the query layer and the rules engine.

4. **Raw Drizzle rows returned outward** (checklist rule 3). `listForWorkspace`, `create`, `claimDueSchedules`, and `recordRunResult` all return `t.digestSchedules.$inferSelect` rows straight to the service. Add a `toDomain()` mapper and return domain entities so the DB shape never leaks past infrastructure.

5. **Correctness bug that confirms the misplacement.** `recordRunResult(scheduleId, ok)` sets `consecutiveFailures: ok ? 0 : undefined` — on failure it writes `undefined` (a no-op), so the counter **never increments** and `MAX_CONSECUTIVE_FAILURES` can never trip. This is precisely the kind of invariant that gets dropped when it's expressed as an ad-hoc `.set()` in a repository instead of as a method on a `DigestSchedule` entity (`recordFailure()` / `recordSuccess()`). Fold the invariant into the entity; the repo just persists the result.

---

## `service.ts` — application layer reaching into infrastructure

This file has the most boundary crossings.

6. **Constructs its own repositories and reaches into `container.db`.** `new DigestSchedulesRepository(container.db)` and `new WorkspaceRepository(container.db)` bypass the composition root. The application layer should receive repositories as **ports from the container** (`container.digestScheduleRepo`, `container.workspaceRepo`), not `new` concrete classes and hand them a raw DB handle. This also makes the service untestable via `ContainerOverrides`/mocks.

7. **Direct `fetch` to the GitHub API inside the service** (lines 56–60) — an infrastructure/external-API concern in the application layer. Worse, `github-client.ts` already exists as the correct adapter for exactly this and is being ignored. Route this through the injected `github` port.

8. **Secret read in the application layer, and inconsistent with itself.** `process.env.GITHUB_TOKEN` is read directly here, while the rate-limit path a few lines up uses `workspace.githubToken`. Secrets belong behind an adapter (per project convention they live in `~/.devdigest/secrets.json`, not env/`AppConfig`), and the token source must be singular. This is both a layering and a correctness/security smell.

9. **Module-level mutable global state.** `let rateLimitCache: Record<string, boolean> = {}` is shared across every service instance and every request, never reset, and unmockable. Even setting layering aside this is a bug (a workspace that hits the limit once is cached as limited forever, for the process lifetime). State like this must be an injected dependency, not a module global.

10. **`sendDigestEmail` stub is a delivery-adapter concern.** Delivery (email/webhook) is infrastructure and should sit behind a port injected via the container, not be a private method on the application service.

Net: after the fixes, this service should read as pure orchestration — pull due entities from a repo port, ask the domain whether to skip, call the `github` and `delivery` ports, and persist results via the repo — with **zero** `fetch`, `process.env`, `new Repository`, or `container.db`.

---

## `routes.ts` — presentation, but two leaks

The `POST` body validation via `fastify-type-provider-zod` (`schema: { body: CreateScheduleBody }`) is the right, schema-first approach. Two issues:

11. **Presentation talks directly to Drizzle** (checklist rule 2). The `/preview` handler runs `app.container.db.select().from(t.digestSchedules)…` inline. A route must never touch the DB. Push this into `service.previewSchedules(workspaceId)` backed by the repository. (`t` / `drizzle-orm` should not be imported by `routes.ts` at all.)

12. **Domain validation living in the route.** `assertValidCronOverride` encodes real business policy — 5-field cron shape and the "no more often than every 5 minutes" minimum-interval rule. That's a **domain invariant**, not edge validation. Move it into the domain (a `CronExpression` value object or a domain validator); the route should only be doing structural Zod validation and mapping domain errors to HTTP status codes. (Note also the `minute !== '*' && Number(minute) < 5` check misreads the minute field — another rule that will be easier to get right and test once it lives in the domain.)

Minor: `req.params as { workspaceId: string }` and `req.body as z.infer<…>` are hand-casts; declare `params` as a Zod schema too so the type provider gives you validated, typed params instead of `as` assertions.

---

## Summary of where things should move

- **New domain layer** (no Drizzle/HTTP imports): a `DigestSchedule` entity owning `isDueAt(now)` (the grace-window + rollover logic from the repo), `recordSuccess()`/`recordFailure()` (fixing the counter bug and the failure cap), and a `CronExpression` value object (the cron/min-interval rules from routes). `describeSchedule` moves here and takes the entity.
- **Application (`service.ts`)**: pure orchestration over injected ports; no `fetch`, no `process.env`, no `new Repository`, no `container.db`, no module-global cache.
- **Infrastructure (`repository.ts`)**: candidate fetch + persist only, returning mapped domain entities via `toDomain()`. `github-client.ts` stays as-is but gets promoted to a port and **bound in `platform/container.ts`**, alongside a new delivery adapter.
- **Presentation (`routes.ts`)**: Zod boundary validation (params + body) and HTTP error mapping only; delete the direct `db` query and the cron-policy logic.
- **`github-client.ts`**: correctly layered — no changes to its internals.
