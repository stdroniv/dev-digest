# Architecture review — `server/src/modules/digest-schedules/`

Reviewed against DevDigest's strict Onion rule: **source dependencies point inward only**
(Presentation → Infrastructure → Application → Domain), and **no Drizzle / Fastify / SDK / raw
`fetch` / `process.env` secrets in inner layers**. Findings are ordered by severity. Each says
where the code should actually live.

## Verdict: do not merge as-is

The module is roughly the right *shape* (routes / service / repository / helpers / a github
adapter), but the layer boundaries are crossed in several places. The worst offenders are the
route reaching into the DB, the service doing raw GitHub `fetch` with a `process.env` secret, and
"domain" logic scattered across the repository and helpers while the `helpers.ts` "domain" file
actually depends on Drizzle types and does I/O. One file — `github-client.ts` — is already
correctly layered and should be kept essentially as-is (just relocated).

---

## CRITICAL — Presentation reaches into the database (`routes.ts`)

```ts
// routes.ts
import { eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
...
const rows = await app.container.db.select().from(t.digestSchedules)...  // in the /preview handler
```

The `/preview` handler imports `drizzle-orm` and `db/schema` and runs a Drizzle query directly in
the route. Presentation **must not** import Drizzle or touch the DB (dependency-rule + pre-commit
checklist #2). It also duplicates the exact query already in `repository.listForWorkspace`.

**Where it should live:** move the query into the repository (reuse `listForWorkspace`), compute
the preview shape in `DigestSchedulesService`, and have the handler call `service.previewSchedules(workspaceId)`.
Delete both the `drizzle-orm` and `db/schema` imports from `routes.ts`.

## CRITICAL — Application layer does its own HTTP + reads a secret from `process.env` (`service.ts`)

```ts
// service.ts, runDueSchedules()
const res = await fetch(
  `https://api.github.com/repos/${workspace.repoOwner}/${workspace.repoName}/pulls?state=open`,
  { headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } },
);
const pulls = await res.json();
```

Three violations in one block:

1. **Raw `fetch` to an external API in the service.** External-API calls are *infrastructure*
   (an adapter behind a port), never inline in a use-case. There is already a `GitHubClient` port
   in `@devdigest/shared` with an `OctokitGitHubClient` adapter bound in `container.ts`, plus this
   module's own `github-client.ts`. The service should call an injected client, not `fetch`.
2. **Secret pulled from `process.env.GITHUB_TOKEN`.** Per project convention secrets come from the
   `SecretsProvider` (`~/.devdigest/secrets.json`), resolved through the container — never
   `process.env`, and never in an application service. (Note it's also inconsistent with the
   `workspace.githubToken` used two lines above.)
3. **`res.json()` typed as `unknown` and passed straight to `sendDigestEmail`** — no mapping to a
   domain shape; the untyped GitHub payload leaks through the app layer.

**Where it should live:** the fetch + response-shaping belongs in the GitHub adapter
(`github-client.ts` / `adapters/github/*`), returning a typed summary. The service should depend on
that port (injected via the container) and orchestrate only.

## HIGH — Domain/business rules live in Infrastructure (`repository.ts`)

`repository.ts` is meant to be pure data access, but it owns the module's core scheduling policy:

- `GRACE_WINDOW_MS` and `MAX_CONSECUTIVE_FAILURES` constants (domain policy),
- `computeNextRunAt()` — timezone/day-rollover scheduling logic (a pure domain decision),
- the in-memory `due` filter in `claimDueSchedules()` — "is this schedule due right now" is a
  domain rule, computed *after* pulling all rows.

"Which schedules are due" and "skip after N consecutive failures" are **domain** invariants, not
SQL concerns. Embedding them in the repository is the anemic-domain / logic-in-infra anti-pattern
(checklist #4) and makes them untestable without a DB.

**Where it should live:** a domain entity/value-object (e.g. `DigestSchedule` with an `isDueAt(now)`
method and a `NextRunAt` value object) plus the two constants as domain policy. The repository
should only fetch candidate rows and persist claims — the "is due" decision moves to the domain and
is invoked by the service.

## HIGH — Repository returns raw Drizzle rows outward; no `toDomain()` mapping (`repository.ts`)

Every method returns `$inferSelect` rows (`.select()`, `.returning()` results) directly, and those
rows flow through the service and out of the routes unchanged (checklist #3). The domain/DTO
boundary is never crossed, which is exactly what couples the whole stack to the DB column shape.

**Where it should live:** add a private `toDomain()` in the repository mapping rows → a domain
entity; have the service return a Result DTO. Nothing outside infrastructure should see a Drizzle
row.

## HIGH — The "domain" file depends on Drizzle and performs I/O (`helpers.ts`)

`helpers.ts` advertises itself as "the module's domain layer … independent of Fastify/Drizzle", but:

```ts
import type { InferSelectModel } from 'drizzle-orm';
import type { digestSchedules } from '../../db/schema.js';
export type DigestScheduleRow = InferSelectModel<typeof digestSchedules>;
```

- It imports a **Drizzle type** and binds its domain type to the DB table shape. Even as
  `import type` this is checklist item #1 — a type alias is erased at runtime so depcruise may miss
  it, but it still ties the core to the DB schema. Declare an **independent** domain entity instead.
- `shouldSkipDueToRateLimit()` **constructs a `GithubClient` and does network I/O** inside the
  "domain" file. That makes it infrastructure, not domain — pure domain code performs no HTTP.

**Where it should live:** split this file. `describeSchedule()` is genuinely pure and belongs in the
**domain** (retyped onto the domain entity, not `InferSelectModel`). `shouldSkipDueToRateLimit()` is
an orchestration over a github port — it belongs in the **application/service** layer and should
receive an injected client, not `new GithubClient(...)`.

## MEDIUM — Service depends on the whole `Container` and hand-constructs repositories (`service.ts`)

```ts
constructor(private container: Container) {
  this.repo = new DigestSchedulesRepository(container.db);
  this.workspaceRepo = new WorkspaceRepository(container.db);
}
```

- Injecting the entire `Container` hides the real dependencies and works against
  migration-gap #3 (inject the specific ports a use-case needs).
- `new WorkspaceRepository(container.db)` **reaches into another module** to build its repository.
  Cross-module repositories are meant to be constructed once in the composition root and exposed as
  `container.workspaceRepo` (that's the documented pattern for `agentsRepo` / `reviewRepo`), not
  `new`-ed up ad hoc here.

**Where it should live:** bind `DigestSchedulesRepository` (and reuse the shared workspace repo) in
`platform/container.ts`; inject those interfaces into the service.

## MEDIUM — Business rule + weak error mapping in the route (`routes.ts`)

`assertValidCronOverride()` encodes a real domain rule ("schedules cannot run more often than every
5 minutes", 5-field cron validity) and lives in the presentation file, throwing a plain `Error`.
Domain invariants don't belong in a handler, and a bare `throw new Error(...)` won't map to a clean
`400`.

**Where it should live:** a domain value-object (e.g. `CronOverride`) or a domain validation
function that raises a typed domain error the presentation layer maps to `400`. The Zod body schema
staying at the boundary is correct — it's the *semantic* cron rule that must move inward.

## LOW — Not schema-first for params; manual casts (`routes.ts`)

Handlers use `req.params as { workspaceId: string }` and `req.body as z.infer<...>` instead of
declaring Zod `params`/`body` via `fastify-type-provider-zod` (project convention: never hand-cast
at the boundary). The POST declares a body schema but the GETs cast params by hand.

**Where it should live:** same file — declare a `params` Zod schema so the types come from the type
provider, no casts.

## LOW — Module-level mutable global state (`service.ts`)

```ts
let rateLimitCache: Record<string, boolean> = {};
```

A file-scoped mutable cache is shared across every service instance and leaks between tests; it also
never expires (a workspace marked rate-limited stays limited for the process lifetime). Not strictly
a layering issue, but it undermines the DI/testability the onion setup is built for. Prefer
instance state or an injected cache abstraction.

---

## Correctly layered — keep, don't churn

- **`github-client.ts` — this file is right.** It's a clean infrastructure adapter: the only place
  that knows about `fetch`, the base URL, and the token; it returns a plain `RepoActivitySummary`
  DTO (never a `Response`), and imports nothing from Fastify/Drizzle/domain. Its internals are fine
  as written. The only change is *placement/wiring*: it should live under `server/src/adapters/github/`
  and be reconciled with the existing `GitHubClient` port in `@devdigest/shared` (implement that
  port and be bound in `container.ts`) rather than be `new`-ed up inside `helpers.ts`. Don't rewrite
  its logic.
- **The Zod `CreateScheduleBody` boundary schema in `routes.ts`** is the correct use of Zod at the
  edge — keep it (just move the semantic cron rule inward and add a params schema).

## Summary of where things should move

| Code | Today (wrong) | Should live in |
|------|---------------|----------------|
| `/preview` DB query | `routes.ts` (presentation) | repository + service |
| GitHub `fetch` + `process.env` token | `service.ts` (application) | github adapter behind a port, injected |
| `computeNextRunAt`, `is-due` filter, policy constants | `repository.ts` (infra) | domain entity/value-object |
| row→entity mapping | missing | repository `toDomain()` |
| `DigestScheduleRow = InferSelectModel<…>` | `helpers.ts` ("domain") | independent domain entity |
| `shouldSkipDueToRateLimit` (does I/O) | `helpers.ts` ("domain") | application/service, injected client |
| cron semantic rule (`assertValidCronOverride`) | `routes.ts` | domain value-object + typed error |
| repository construction / cross-module repo | `service.ts` (`new …`) | `platform/container.ts` |
| `github-client.ts` | correct internals, wrong home | `server/src/adapters/github/`, bound in container |
