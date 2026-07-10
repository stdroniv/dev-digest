# Architecture review — `server/src/modules/digest-schedules/`

Reviewed against DevDigest's Onion/Clean layering: **Presentation → Infrastructure → Application → Domain**, dependencies inward only; no Drizzle/Fastify/SDK/HTTP in inner layers; repositories map rows→entities; external I/O behind ports bound in the container.

Verdict: **do not merge as-is.** One file (`github-client.ts`) is correctly layered and should be left alone. The other four have layering violations — the most serious are direct DB access from the route, a global external-API call + mutable cache in the service, and a "domain" `helpers.ts` that imports Drizzle types and does network I/O.

---

## `github-client.ts` — CORRECT, do not churn

This is the exemplar of a well-placed **infrastructure adapter**. It is the only place that knows about `fetch`, the base URL, and the token; it returns a plain domain-shaped value (`RepoActivitySummary`), never a `Response`; and it imports nothing from Fastify, Drizzle, or an inner layer. Leave the file as written.

One follow-up that is *not* about this file: it should be exposed as a **port** (e.g. `GithubActivityPort`) and bound in `platform/container.ts`, so callers receive it injected rather than `new`-ing it. See the `helpers.ts`/`service.ts` findings below — the fix lives there, not here.

---

## `helpers.ts` — mislabeled as domain; two violations

The header says "the module's domain layer: pure decisions … independent of Fastify/Drizzle." It is neither pure nor Drizzle-independent.

1. **Domain file imports Drizzle + the DB schema (Rule 1).**
   ```ts
   import type { InferSelectModel } from 'drizzle-orm';
   import type { digestSchedules } from '../../db/schema.js';
   export type DigestScheduleRow = InferSelectModel<typeof digestSchedules>;
   ```
   This is exactly the flagged anti-pattern: a type-only import that binds the core to the DB row shape. `depcruise` may miss it (types erase at runtime), but it couples the domain to Drizzle. **Where it should live:** define an independent `DigestSchedule` **domain entity** (plain interface/class in the module's domain, no `InferSelectModel`). `describeSchedule` then takes that entity. `describeSchedule` itself is legitimately pure domain logic — keep it, just re-point it at the domain type.

2. **`shouldSkipDueToRateLimit` does network I/O and constructs an adapter — not domain.**
   ```ts
   const client = new GithubClient(githubToken);
   await client.getRepoActivity(owner, repo);
   ```
   A domain file must not `new` an infrastructure adapter or make HTTP calls. This is **application orchestration**, not a domain decision. **Where it should live:** the *decision* ("skip when rate-limited") can be a pure domain predicate, but the *fetching* must move to the application service calling an injected `GithubActivityPort` (the interface `github-client.ts` implements). The service asks the port for activity and applies the pure rule; the domain never touches `GithubClient`.

---

## `repository.ts` — right layer, but leaks rows and hides domain logic

Correctly placed in **infrastructure** (Drizzle behind a class). Problems:

3. **Returns raw Drizzle rows outward (Rule 3).** Every method (`listForWorkspace`, `create`, `claimDueSchedules`, `recordRunResult`) returns `typeof table.$inferSelect` rows straight to the service. Add a `toDomain()` mapper and return the `DigestSchedule` **domain entity**, so the DB shape never escapes infrastructure.

4. **Domain logic embedded in the repository.** `computeNextRunAt` (day-rollover, grace window) and the `claimDueSchedules` filter — "which schedules are *due*", plus the `MAX_CONSECUTIVE_FAILURES` skip and `GRACE_WINDOW_MS` — are business rules, not persistence. **Where they should live:** the "is this schedule due at `now`?" / "is it circuit-broken?" decision belongs in the **domain** (entity method or domain service). The repository should only *fetch candidate rows and persist the claim*; it applies the domain predicate rather than owning it.

5. **Latent invariant bug worth flagging in review** (architectural symptom of the anemic model): `recordRunResult(scheduleId, ok)` sets `consecutiveFailures: ok ? 0 : undefined` — on failure it writes `undefined`, so the counter never increments and `MAX_CONSECUTIVE_FAILURES` is never reached. The failure-counting invariant has no owner. Fold it into the domain entity (`recordFailure()` / `recordSuccess()`), then persist the entity's new count.

---

## `service.ts` — application layer doing infrastructure's job

6. **Constructs its own repositories and reaches into `container.db` (DI / composition-root violation).**
   ```ts
   this.repo = new DigestSchedulesRepository(container.db);
   this.workspaceRepo = new WorkspaceRepository(container.db);
   ```
   The application layer is binding concrete infrastructure and touching the raw DB handle. Repositories should be **resolved from the container** as ports (`container.digestScheduleRepo`, `container.workspaceRepo`), never `new`-ed here. Bind them in `platform/container.ts`; the service receives abstractions.

7. **Direct `fetch` to the GitHub API inside the service** (lines 56-60). External I/O must go through a port/adapter — and one already exists (`GithubClient` / a `GithubActivityPort`). The service duplicates the call the adapter is meant to own. **Where it should live:** call the injected port; delete the inline `fetch`.

8. **Reads a secret directly: `process.env.GITHUB_TOKEN`.** Per project convention secrets come from the secrets adapter / injected config, not `process.env` in a service. (It's also inconsistent with the token being *passed* to `GithubClient` elsewhere.) Route it through the injected adapter.

9. **Module-level mutable global `rateLimitCache`.** Shared mutable state at module scope in the application layer — not injected, not per-request, leaks across instances and tests, and can't be reset. Move rate-limit state behind an injected collaborator (cache/port) or make it instance state with a defined lifecycle.

The *orchestration shape* of `runDueSchedules`/`listForWorkspace` is appropriately an application service — the fix is to make it depend on **ports** (repos, github activity, mailer) instead of doing the I/O itself.

---

## `routes.ts` — presentation reaching past the service

10. **Route handler queries the DB directly (Rule 2) — most serious issue here.** The `/preview` handler:
    ```ts
    const rows = await app.container.db.select().from(t.digestSchedules).where(...);
    ```
    Presentation must never touch Drizzle/`container.db`. **Where it should live:** add a `service.previewForWorkspace(workspaceId)` that goes through the repository; the handler just calls it and shapes the DTO.

11. **Business invariant validated in the route: `assertValidCronOverride`.** The "cannot run more often than every 5 minutes" rule is a **domain invariant**, not edge validation. Structural shape-checking (5 fields, field chars) can stay as Zod at the boundary, but the min-interval rule belongs in the **domain/application** so it's enforced regardless of entry point. (Note it also throws a bare `Error`, which won't map to a 400 without an error mapper.)

12. **Not schema-first (project convention).** The GET handlers cast `req.params as { workspaceId: string }` instead of declaring Zod `params` via `fastify-type-provider-zod`; the POST casts `req.body` even though it declared a body schema. Declare `params`/`body` schemas and let the type provider infer them — no hand-rolled casts.

Minor: `new DigestSchedulesService(app.container)` at plugin scope is tolerable, but prefer resolving the service from the container for consistency with the DI root.

---

## Summary of where things should move

| Concern | Currently in | Belongs in |
|---|---|---|
| `DigestSchedule` entity + `describeSchedule` type | `helpers.ts` (Drizzle-typed) | Domain, independent type |
| "is due" / grace-window / circuit-breaker rules | `repository.ts` + `helpers.ts` | Domain (entity/service) |
| Rate-limit *fetch* (`shouldSkipDueToRateLimit`, inline `fetch`) | `helpers.ts` + `service.ts` | Infrastructure adapter behind `GithubActivityPort`, called by the service |
| Secret access (`process.env.GITHUB_TOKEN`) | `service.ts` | Injected secrets/config adapter |
| Repo construction / `container.db` use | `service.ts` | Container-resolved ports |
| Row→entity mapping | (missing) | `repository.ts` `toDomain()` |
| `/preview` DB query | `routes.ts` | Service + repository |
| Cron min-interval invariant | `routes.ts` | Domain/application |
| GitHub REST adapter | `github-client.ts` | **Already correct — leave it** |
