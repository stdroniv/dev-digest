# Architecture review — `server/src/modules/webhooks/` (repository.ts, service.ts, routes.ts)

Reviewed against the house conventions visible in `server/CLAUDE.md` and the sibling
`agents` module (adapters-behind-DI-container, schema-first routes, service owns
business logic, routes are thin, repository is pure data access).

## Findings

### 1. Routes hand-roll a DB query and bypass the repository/service entirely
**Where:** `routes.ts`, `POST /workspaces/:workspaceId/webhooks` handler, lines 21-33.

```ts
const existing = await app.container.db
  .select()
  .from(t.webhookEndpoints)
  .where(eq(t.webhookEndpoints.workspaceId, workspaceId));
...
const [row] = await app.container.db
  .insert(t.webhookEndpoints)
  .values({ workspaceId, url, secret: secret ?? null })
  .returning();
```

This is the most serious violation. The presentation layer (route handler) is doing
direct Drizzle access — selecting from `t.webhookEndpoints` and inserting into it —
instead of delegating to `WebhooksService`/`WebhooksRepository`. That means:
- Business logic ("an endpoint URL must be unique per workspace" — the 409 check) is
  implemented in the routes file, not the service, so it can't be reused or unit
  tested independently of Fastify.
- The route file imports `drizzle-orm` and `../../db/schema.js` directly, which the
  `agents` sibling module never does — its routes only import `./service.js` and
  shared schema/context helpers, never `db/schema.ts` or `drizzle-orm` symbols.
- It duplicates persistence responsibility that the `WebhooksRepository` class exists
  for, leaving that repository without a `createEndpoint`/`registerEndpoint` method
  at all — the one thing you'd expect a "webhook endpoints" repository to own.

**Where it should live:** Add `WebhooksRepository.findEndpointByUrl` (or
`countByUrl`)/`createEndpoint` methods in `repository.ts`, and a
`WebhooksService.registerEndpoint(workspaceId, url, secret)` method in `service.ts`
that performs the duplicate check and calls the repo insert, returning a DTO. The
route handler should shrink to: validate body (already done via Zod) → call
`service.registerEndpoint(...)` → map the result to a 201/409 response — mirroring
how `agents/routes.ts` never touches `db` or `schema.ts` directly and just orchestrates
`AgentsService` calls plus request/response shaping.

### 2. Route reads `t` (db schema) and `eq` from `drizzle-orm` — infrastructure leaking into presentation
**Where:** `routes.ts`, lines 3-4 (`import { eq } from 'drizzle-orm'; import * as t from '../../db/schema.js';`).

Same root cause as #1, called out separately because it's a layering/dependency-
direction problem independent of the specific bug: the presentation layer must not
import Drizzle or the schema module at all. Compare `agents/routes.ts`, which only
imports Zod, shared contract types, `_shared` helpers, and `./service.js` — no
`drizzle-orm`, no `db/schema.js`.

**Where it should live:** Remove these imports from `routes.ts` entirely once finding
#1 is fixed; only `repository.ts` should import `drizzle-orm` operators and
`db/schema.ts`.

### 3. Outbound webhook delivery (`fetch`) lives in the service — arguably fine, but there's no adapter/port and no failure handling for the call itself
**Where:** `service.ts`, `notifyReviewComplete`, lines 26-33.

```ts
const res = await fetch(endpoint.url, { ... });
await this.repo.recordDelivery(endpoint.id, { reviewId, summary }, res.status);
```

`server/CLAUDE.md` states: *"Adapters behind a DI container... never call externals
directly in a service."* This module calls raw `fetch()` directly against an
externally-configured, user-supplied URL from inside the service, with no adapter
boundary, no timeout, and no try/catch — a network failure (DNS error, connection
refused, timeout) will throw inside `notifyReviewComplete` and is not converted into a
delivery record at all (contrast with a non-2xx response, which the code does handle
via `recordDelivery`). That's an inconsistency: some failure modes are recorded as
`webhook_deliveries` rows, others crash the caller (`repos/reviews` module's completion
flow, whatever calls `notifyReviewComplete`) and never get retried by
`claimDueRetries` because no row was ever written.

**Where it should live:** Introduce a small `WebhookDeliveryAdapter`/port (e.g.
`src/adapters/webhook-delivery/` or similar, following the existing `llm · github ·
git · astgrep · tokenizer · secrets` adapter pattern) that wraps `fetch` with a
timeout and normalizes both HTTP-status failures and thrown network errors into a
single result type. The service then calls the adapter and always records a delivery
row (with a synthetic status like `0` or `-1` for network failures) rather than
letting the exception propagate.

### 4. Direct `OpenAI` client construction and module-level singleton in the service — should go through the LLM adapter/container
**Where:** `service.ts`, lines 1, 11, 36-47.

```ts
import OpenAI from 'openai';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
...
private async summarize(...) {
  const completion = await openai.chat.completions.create({ model: 'gpt-4o-mini', ... });
  ...
}
```

Two separate problems here:
- **Direct `process.env.OPENAI_API_KEY` read + module-level client construction**
  violates the documented convention: *"Config... marks every secret optional — the
  server boots with no keys. Secrets resolve only through `LocalSecretsProvider`,
  never `AppConfig`"* (and never a bare `process.env` read either). Because the
  `OpenAI` client is instantiated at module load time, importing `service.ts` with no
  key configured either throws or silently creates a client that will fail at call
  time in a way that's invisible until a webhook fires — compare `agents/service.ts`,
  which resolves its LLM client lazily and per-call via `this.container.llm(provider)`
  inside `listModels`, with a graceful `catch { return [] }` fallback.
- **Hard-coded provider/model** (`openai`, `'gpt-4o-mining'`-style literal `gpt-4o-mini`)
  bypasses the multi-provider abstraction (`Provider` = OpenAI/Anthropic/OpenRouter)
  that the rest of the codebase uses, and calling the OpenAI SDK directly from a
  service is exactly the "never call externals directly in a service" case the house
  convention calls out.

**Where it should live:** Replace the module-level `openai` client and `summarize`
with a call through `this.container.llm(provider)` (the same adapter every other
module uses for LLM calls), configured via an agent/config record or a fixed default
provider resolved from `AppConfig`/`LocalSecretsProvider` — not a raw
`process.env.OPENAI_API_KEY` read. If webhooks specifically always want OpenAI's
`gpt-4o-mini` regardless of workspace-configured provider, that choice belongs in
config, not hard-coded in the service body, and construction must happen per-call
(or lazily, memoized) through the container rather than at import time.

### 5. Retry-window/backoff policy (business rule) implemented in the repository
**Where:** `repository.ts`, `claimDueRetries`, lines 36-73, plus the `MAX_ATTEMPTS` /
`BASE_BACKOFF_MS` constants at the top of the file.

```ts
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 2_000;
...
const due = candidates.filter(({ webhook_deliveries: d }) => {
  if (d.attempt >= MAX_ATTEMPTS) return false;
  const backoff = BASE_BACKOFF_MS * 2 ** (d.attempt - 1);
  const dueAt = new Date(d.createdAt).getTime() + backoff;
  return dueAt <= Date.now();
});
```

This is domain/business logic — "what counts as due for retry," the exponential
backoff formula, the max-attempts cutoff — sitting inside the repository, which per
the onion/clean split should be pure data access (fetch rows, run the write). Right
now the repository does a broad SQL fetch (`statusCode < 200` across *all* deliveries
for the workspace, not just recent/undelivered ones) and then filters/decides in
JS/TS, mixing "get data" with "decide what the data means." Consequences:
- The retry policy can't be unit-tested without a real (or mocked) `Db`/Drizzle
  instance, since it's entangled with the query.
- If the backoff rule ever needs to change (e.g., jitter, different max attempts per
  workspace plan), you have to edit the data-access class, not the service.
- It also silently re-derives "due" purely in-memory after loading every failed
  delivery row for the workspace — a scalability smell independent of layering.

**Where it should live:** Repository should expose something narrower, e.g.
`listFailedDeliveries(workspaceId)` (or push more filtering into SQL — attempt count,
recency — since Drizzle can express `lt`/`gte` comparisons instead of loading
everything into memory) and a `bumpAttempt(deliveryId)` / `bumpAttempts(ids)` write.
The `MAX_ATTEMPTS`/`BASE_BACKOFF_MS` constants and the "is this due" / "is this dead"
decision belong in `WebhooksService.retryDueDeliveries` (or a small pure helper
function next to the service), which calls the narrower repository methods. That
also matches the existing pattern in `agents/service.ts`, where all
workspace-scoping and business decisions (e.g. "return undefined if the agent isn't
in this workspace" in `listVersions`/`setSkills`/`setDocuments`) live in the service,
and the repository methods are simple CRUD (`getById`, `insert`, `update`,
`deleteById`).

### 6. `routes.ts` retry endpoint accepts `:endpointId` in the URL but never uses or validates it
**Where:** `routes.ts`, lines 39-43.

```ts
app.post('/workspaces/:workspaceId/webhooks/:endpointId/retry', async (req, reply) => {
  const { workspaceId } = req.params as { workspaceId: string; endpointId: string };
  const due = await service.retryDueDeliveries(workspaceId);
  return reply.send({ retried: due.length });
});
```

Not strictly a layering issue, but worth flagging alongside the others since it's in
the same handler style problem area: the route is typed/path-shaped as
per-endpoint retry (`:endpointId`) but the service call is workspace-wide
(`retryDueDeliveries(workspaceId)`), and there's no Zod `params` schema at all on this
route (unlike every route in `agents/routes.ts`, which validates `params` via
`IdParams`/custom schemas per the "schema-first routes" convention — "reject invalid
input with 422 before the handler. No hand-rolled parsing."). Here `req.params` is
just cast with `as`, so a malformed `workspaceId`/`endpointId` reaches the handler
unchecked.

**Where it should live:** Add a Zod `params` schema (e.g. `z.object({ workspaceId:
z.string().uuid(), endpointId: z.string().uuid() })`) declared via
`fastify-type-provider-zod`, and either thread `endpointId` into
`WebhooksService.retryDueDeliveries` so the route's contract matches its behavior, or
change the route path to be workspace-scoped only (`/workspaces/:workspaceId/webhooks/retry`)
if per-endpoint retry was never intended — either way the current mismatch between
URL shape and actual scope should be resolved in the service, not left implicit in
the route.

## Summary of layer misplacements

| Code | Currently in | Belongs in |
|---|---|---|
| Duplicate-URL check + endpoint insert (routes.ts:21-35) | routes.ts (presentation) | service.ts (+ repository.ts for the actual query/insert) |
| `drizzle-orm`/`db/schema.ts` imports (routes.ts:3-4) | routes.ts | repository.ts only |
| Raw `fetch()` to endpoint URL (service.ts:27-31) | service.ts (business logic layer) | a new adapter/port under `src/adapters/`, injected via the container |
| `OpenAI` client + `process.env.OPENAI_API_KEY` (service.ts:1,11) | service.ts, module scope | resolved per-call via `container.llm(provider)`, key via `LocalSecretsProvider` |
| Retry/backoff decision logic (repository.ts:36-73) | repository.ts (data-access layer) | service.ts (or a pure helper), with repository reduced to narrower query + write methods |
| Missing params validation on retry route (routes.ts:39-43) | (absent) | Zod `params` schema in routes.ts, consistent scope with service.ts |
