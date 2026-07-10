# Architecture review — `server/src/modules/digest-schedules/`

Reviewed against DevDigest's Onion/Clean layering: **Presentation → Infrastructure → Application → Domain**, dependencies inward-only, no Drizzle/Fastify/SDK/`fetch` in inner layers, repositories map rows→entities and never leak Drizzle rows, external APIs sit behind ports wired in `platform/container.ts`.

Verdict: **do not merge as-is.** Four of the five files have layering violations; one (`github-client.ts`) is already correctly layered and should be left alone. The core structural problem is that the module's *domain rules* (when a schedule is due, the grace window, the max-failure cutoff, failure counting) are scattered across the repository and route, while *infrastructure concerns* (`fetch`, `process.env`, `new GithubClient()`) have leaked inward into the service and the "domain" helpers.

---

## `github-client.ts` — CORRECTLY LAYERED, leave it alone

This is a clean infrastructure adapter and needs **no churn**:

- It is the single place that knows `fetch`, the base URL, and the token.
- It returns a plain `RepoActivitySummary` DTO, never a `Response` or raw JSON outward.
- No Drizzle, no Fastify, no domain rules baked in.

One follow-up (not a change to this file): it should be **bound in `platform/container.ts` behind a port** (e.g. `GithubActivityPort`) and injected, rather than being `new`'d directly by `helpers.ts`/`service.ts`. The file itself is fine; the *wiring* around it is the problem (see below).

---

## `helpers.ts` — MISLABELED "domain"; contains two hard violations

The header calls this "the module's domain layer … independent of Fastify/Drizzle," but it is neither pure nor independent.

1. **Drizzle leaks into the domain via a type-only import** (checklist item 1).
   ```ts
   import type { InferSelectModel } from 'drizzle-orm';
   import type { digestSchedules } from '../../db/schema.js';
   export type DigestScheduleRow = InferSelectModel<typeof digestSchedules>;
   ```
   Even though `import type` is erased at runtime (so dependency-cruiser may not flag it), `DigestScheduleRow` binds the domain to the DB row shape. **Where it should live:** define an *independent* domain entity (e.g. `DigestSchedule` with `hourLocal`, `timezone`, `consecutiveFailures`, etc.) owned by the domain, and have the repository `toDomain()`-map rows onto it. `describeSchedule` should take that entity, not a Drizzle-derived type.

2. **The domain helper performs network I/O and constructs an adapter** — the most serious inward-pointing dependency in the module.
   ```ts
   export async function shouldSkipDueToRateLimit(githubToken, owner, repo) {
     const client = new GithubClient(githubToken);   // domain → infrastructure
     try { await client.getRepoActivity(owner, repo); return false; }
     catch { return true; }
   }
   ```
   A domain function must be pure and know nothing about `GithubClient`, HTTP, or tokens. This function reaches *outward* into infrastructure and does live network calls. **Where it should live:** the GitHub call belongs in the infrastructure adapter (already in `github-client.ts`), invoked via a port from the **application service**. The genuine *decision* ("skip if rate-limited") is a one-line domain predicate over an already-fetched `RepoActivitySummary`; keep only that pure predicate here, and have the service do the fetching through the injected port and pass the result in.

   `describeSchedule` itself is fine pure logic — keep it, just re-type it off the domain entity instead of `DigestScheduleRow`.

---

## `repository.ts` — infrastructure that both leaks rows AND hides domain logic

Correct instincts (Drizzle is confined here, the transactional claim/update is legitimately infra), but two layering problems:

1. **Domain rules are buried inside the repository.** `computeNextRunAt`, the `GRACE_WINDOW_MS` match window, and the `MAX_CONSECUTIVE_FAILURES` cutoff are *business decisions* about eligibility — not data access.
   ```ts
   private computeNextRunAt(hourLocal, timezone, now) { ... }   // domain
   const due = all.filter((s) => Math.abs(...) <= GRACE_WINDOW_MS); // domain
   .where(lt(t.digestSchedules.consecutiveFailures, MAX_CONSECUTIVE_FAILURES)); // domain constant
   ```
   **Where it should live:** the "is this schedule due?" / next-run computation and both constants belong in the **domain** (a `DigestSchedule` entity method or a pure domain service). The repository should *load* candidate rows and *persist* the claim inside a transaction; the eligibility filter should be the domain deciding, not the repo.

2. **Raw Drizzle rows are returned outward** (checklist item 3). `listForWorkspace`, `create`, `claimDueSchedules`, and `recordRunResult` all return `.select()`/`.returning()` rows with no `toDomain()` mapping, so the DB shape propagates up through the service and out of the module. Add a `toDomain()` mapper and return the domain entity.

3. Minor but worth flagging for the entity refactor: `recordRunResult` sets `consecutiveFailures: ok ? 0 : undefined`, so a failure never increments the counter — the `MAX_CONSECUTIVE_FAILURES` guard can never trip. This is exactly the kind of invariant that should be owned by a domain entity method (`schedule.recordFailure()`), not expressed as an ad-hoc `undefined` in an infra `.set()` (anemic-domain, checklist item 4).

---

## `service.ts` — application layer doing infrastructure's job

This is the layer that should *orchestrate* domain + ports, but instead it reaches directly into infrastructure four times:

1. **Concrete repositories constructed in the service, bypassing the container** (checklist item 5).
   ```ts
   this.repo = new DigestSchedulesRepository(container.db);
   this.workspaceRepo = new WorkspaceRepository(container.db);
   ```
   The service should receive repositories/ports as abstractions resolved from the composition root, not `new` concrete classes off `container.db`. (It also reaches across into another module's concrete `WorkspaceRepository` — that should be a port too.)

2. **Direct `fetch` to GitHub inside the application layer.**
   ```ts
   const res = await fetch(`https://api.github.com/.../pulls?state=open`, { headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } });
   ```
   External-API access must sit behind a port and live in infrastructure. **Where it should live:** call the injected GitHub adapter (`github-client.ts`, wrapped as a port) — the same one `shouldSkipDueToRateLimit` should be using. Right now the module talks to GitHub *two different ways* (the adapter, and this raw fetch), which is the tell.

3. **Secret read straight from `process.env.GITHUB_TOKEN`** in the app layer — and inconsistent with the `workspace.githubToken` used a few lines above. Secret/config access belongs in the infrastructure adapter (per project convention secrets come from `~/.devdigest/secrets.json`, not `process.env` scattered in a service).

4. **Module-level mutable singleton state.**
   ```ts
   let rateLimitCache: Record<string, boolean> = {};
   ```
   Hidden, unbounded, never-reset global mutable state in the application layer — not injected, not testable, and it permanently pins a workspace as rate-limited for the process lifetime. If a cross-run cache is genuinely needed, model it as an injected port; otherwise drop it.

**Where the service should net out:** resolve repo + GitHub port + workspace port from the container; for each due schedule, fetch activity through the port, ask the *domain* predicate whether to skip, call domain entity methods for success/failure counting, and persist via the repo. No `fetch`, no `process.env`, no `new Repository(...)`, no module-global cache.

---

## `routes.ts` — presentation leaking into infrastructure + misplaced validation

1. **A route handler queries the DB directly with Drizzle** (checklist item 2) — the clearest presentation-layer violation.
   ```ts
   const rows = await app.container.db.select().from(t.digestSchedules).where(eq(...));
   ```
   The `/preview` endpoint imports `drizzle-orm` and the schema into the route file and hand-rolls a query. **Where it should live:** a `previewSchedules(workspaceId)` method on the service backed by a repository read; the route just calls it and shapes the DTO.

2. **Business/format validation lives in the route as a hand-thrown `Error`.** `assertValidCronOverride` throws a plain `Error`, which surfaces as an unhandled 500 rather than a 400. Boundary validation belongs in the **Zod schema** (`cronOverride: z.string().refine(...)`) so `fastify-type-provider-zod` rejects it at the edge with a proper 400; any deeper "min interval" rule that is truly a domain invariant belongs in the domain. Note also `cronOverride` is validated but then **never passed to `createSchedule`** — it's silently dropped, so today the whole block is dead effort.

3. **Not schema-first for params** (per CLAUDE.md "Routes are schema-first … never hand-roll casts"). The handlers use `req.params as { workspaceId: string }` and `req.body as z.infer<...>` casts instead of declaring Zod `params` and letting the type provider infer. Declare `params`/`body` schemas and drop the `as` casts.

---

## Summary of where things should move

| Concern (today) | Current (wrong) home | Correct layer / home |
|---|---|---|
| `computeNextRunAt`, grace window, max-failure cutoff | `repository.ts` (infra) | Domain entity / pure domain service |
| Failure counting (`recordRunResult` `undefined` trick) | `repository.ts` `.set()` | Domain entity method (`recordFailure`/`recordSuccess`) |
| `DigestScheduleRow = InferSelectModel<…>` | `helpers.ts` ("domain") | Independent domain entity; repo `toDomain()`-maps |
| `shouldSkipDueToRateLimit` doing `new GithubClient()` + HTTP | `helpers.ts` ("domain") | Fetch via injected port in service; keep only pure predicate in domain |
| Raw Drizzle rows returned | `repository.ts` | Map to domain entity before returning |
| `new DigestSchedulesRepository/WorkspaceRepository` | `service.ts` | Inject ports from `platform/container.ts` |
| Direct `fetch` + `process.env.GITHUB_TOKEN` | `service.ts` | Infrastructure GitHub adapter behind a port |
| `rateLimitCache` module global | `service.ts` | Injected cache port, or remove |
| `/preview` direct Drizzle query | `routes.ts` | Service + repository read |
| `assertValidCronOverride` throwing `Error` | `routes.ts` | Zod `.refine` at boundary (400); domain for true invariants |
| `req.params/body as …` casts | `routes.ts` | Schema-first Zod `params`/`body` + inferred types |

**Leave untouched:** `github-client.ts` (already a correct infrastructure adapter — just register it in the container behind a port).

**Distinct issues flagged: 11** (plus the correctly-layered `github-client.ts` called out to avoid needless churn).
