# Architecture review — `server/src/modules/webhooks/` (pre-merge)

Reviewed against the `backend-onion-architecture` skill (strict onion / clean architecture,
inward-only dependency rule: Presentation → Infrastructure → Application → Domain).

Overall: this module repeats — and in a couple of places worsens — the known gaps documented in
`migration-from-current.md` (no domain layer, rows leaking outward, services depending on the
whole `Container`). It also introduces two violations that the existing, more mature modules don't
have: a route handler that talks to Drizzle directly, and an application service that owns a
concrete SDK client and constructs its own repository. None of this is a nitpick — each item below
is called out explicitly as an anti-pattern in the skill's reference docs. I'd block the merge on
items 1, 2, and 4 at minimum; the rest should be filed as follow-up but are worth flagging now
since this is new code (cheaper to fix before it has callers).

---

## 1. Route handler queries Drizzle directly — `routes.ts`, `POST /workspaces/:workspaceId/webhooks`

**Location:** `routes.ts` lines 3, 21–24, 30–33 (`import { eq } from 'drizzle-orm'`, `import * as t
from '../../db/schema.js'`, then `app.container.db.select()...` and `app.container.db.insert()...`
inside the handler).

**Why it's a problem:** This is presentation-layer code importing infrastructure directly — the
exact anti-pattern in `examples.md` #1 ("Route handler hitting the DB directly") and the hard rule
in `references/presentation-layer.md`: *"No DB / Drizzle in a handler. A route must go through an
application service; it never runs a query."* It's also the one rule the project's
dependency-cruiser config (`handlers-never-touch-the-db` in `references/dependency-rule.md`) is
specifically written to hard-block. Beyond layering, the duplicate-URL check here
(`existing.some((e) => e.url === url)`) is a business rule (uniqueness invariant), and it's sitting
in the transport layer instead of the domain/application layer.

**Where it should live:** The whole "create endpoint" flow belongs in `WebhooksService` (or a new
`CreateWebhookEndpoint` use-case) as `service.createEndpoint(cmd)`, which:
- checks the uniqueness invariant (ideally as a domain rule enforced via the repository/entity,
  e.g. `IWebhooksRepository.findByUrl` + a domain check, or a DB unique constraint surfaced as a
  typed conflict), and
- calls `WebhooksRepository.save(...)` (repository, infrastructure) to persist.

The route should shrink to: validate body → `service.createEndpoint({ workspaceId, url, secret })`
→ map the 409/201 outcome to HTTP status → return a DTO (see #8 below for what it should return).

---

## 2. Services/repositories constructed inside route registration and inside the service, instead of the composition root

**Location:** `routes.ts` line 13 (`const service = new WebhooksService(app.container);`) and
`service.ts` lines 16–18 (`constructor(private container: Container) { this.repo = new
WebhooksRepository(container.db); }`).

**Why it's a problem:** `references/dependency-injection.md` is explicit: *"`server/src/platform/
container.ts` is the one place concrete classes are constructed and bound to ports... Constructing
a concrete adapter... anywhere except the container"* is listed as an anti-pattern. Here two
concrete classes (`WebhooksService`, `WebhooksRepository`) are being `new`'d outside the container
— once at route-registration time, once inside the service's own constructor. This means: no
single composition root for this module, no way to swap in a mock repository via
`ContainerOverrides` for testing without patching the class itself, and a hidden dependency
(`WebhooksService` secretly knows how to build its own repository) instead of an explicit,
injected one.

**Where it should live:** `platform/container.ts` should grow:
```ts
get webhooksRepo(): WebhooksRepository { return (this._webhooksRepo ??= new WebhooksRepository(this.db)); }
get webhooksService(): WebhooksService { return (this._webhooksService ??= new WebhooksService(this.webhooksRepo, /* llm port */, /* http port */)); }
```
`routes.ts` then resolves `app.container.webhooksService` at registration (like the good example in
`references/presentation-layer.md`), and `WebhooksService`'s constructor takes the repository (and
other ports, see #4/#5) as explicit parameters — not the whole `Container`.

---

## 3. Route handler hand-rolls param/body extraction instead of schema-first Zod

**Location:** `routes.ts` lines 18–19 (`const { workspaceId } = req.params as { workspaceId: string
};`, `const { url, secret } = req.body as z.infer<typeof CreateEndpointBody>;`) and line 40
(`const { workspaceId } = req.params as { workspaceId: string; endpointId: string };` — note this
destructure doesn't even define an `endpointId` param schema for the retry route, and `endpointId`
itself is never read/used anywhere in the handler despite being in the URL).

**Why it's a problem:** Root `CLAUDE.md` and `references/presentation-layer.md` both call this out
as a project convention: *"Routes are schema-first: declare Zod params/body via
fastify-type-provider-zod; never hand-roll `Schema.parse(req.body)`"* (or, as here, an unchecked
`as` cast, which is worse — it doesn't even validate at runtime). `workspaceId` and `endpointId`
are never Zod-validated as path params in either route.

**Where it should live:** Declare `params: WorkspaceIdParams` (and `WorkspaceIdWithEndpointParams`
for the retry route) alongside `body: CreateEndpointBody` in each route's `schema`, registered via
`app.withTypeProvider<ZodTypeProvider>()`, so `req.params`/`req.body` are typed and validated before
the handler runs — no casts.

---

## 4. Application service owns a concrete OpenAI client instead of depending on an `LLMProvider` port

**Location:** `service.ts` lines 1, 11 (`import OpenAI from 'openai'`, `const openai = new
OpenAI({ apiKey: process.env.OPENAI_API_KEY })` at module scope) and the `summarize` method
(lines 36–47) calling `openai.chat.completions.create(...)` directly.

**Why it's a problem:** This is the clearest violation in the module. `references/application-
layer.md` and the tool→layer mapping in `SKILL.md` are unambiguous: *"OpenAI / Anthropic /
OpenRouter SDKs — infrastructure adapters behind ports (`LLMProvider`, `Embedder`), injected via
the container; never imported by a service directly."* `service.ts` is the application layer
(`server/src/modules/*/service.ts` per the layer table) and it directly imports and instantiates
the `openai` package. It also reads `process.env.OPENAI_API_KEY` directly, bypassing the project's
secrets convention (`~/.devdigest/secrets.json` via a `SecretsProvider`, per root `CLAUDE.md`) and
the container's existing `await container.llm('openai')` resolution path described in
`references/dependency-injection.md`.

**Where it should live:** `WebhooksService` should depend on the existing `LLMProvider` port
(constructor-injected, e.g. `constructor(private repo: IWebhooksRepository, private llm:
LLMProvider) {}`), resolved by the container via `container.llm('openai')` (or whichever provider
is configured) and bound in `container.ts` — exactly like the good example in
`references/dependency-injection.md`. No `new OpenAI(...)` and no `process.env` read should appear
in `service.ts` at all.

---

## 5. Raw outbound `fetch()` to arbitrary URLs sitting in the application layer

**Location:** `service.ts` lines 27–31, inside `notifyReviewComplete`
(`const res = await fetch(endpoint.url, { method: 'POST', ... })`).

**Why it's a problem:** Same class of issue as #4: an application service is directly performing
IO against an external system (an arbitrary webhook URL) rather than going through an injected
port. `references/application-layer.md` says a use-case should "orchestrate" — decide *which*
operations run — not itself hold the HTTP client. Today this is a bare `fetch`, but as soon as this
needs auth headers, request signing (the `secret` field already stored on the endpoint suggests
HMAC signing is intended), retries, or timeouts, that logic will accrete directly in the service.

**Where it should live:** Introduce a small port, e.g. `WebhookSender` (`send(endpoint,
payload): Promise<{ statusCode: number }>`), implemented by a concrete adapter under
`server/src/adapters/*` (this is exactly the `GitClient`/`GitHubClient` pattern already used for
other outbound calls), bound in `container.ts`, and injected into `WebhooksService`. The service
then calls `this.sender.send(endpoint, { reviewId, summary })` and never imports `fetch` concerns
itself (aside from the adapter, which is allowed to).

---

## 6. Business rule (retry eligibility / backoff / dead-lettering) implemented inside the repository

**Location:** `repository.ts`, `claimDueRetries` (lines 42–73), specifically the `due` filter (lines
54–59): checking `attempt >= MAX_ATTEMPTS`, computing `BASE_BACKOFF_MS * 2 ** (attempt - 1)`, and
deciding whether a delivery is "due" or "dead" — plus the module-level constants `MAX_ATTEMPTS`,
`BASE_BACKOFF_MS` (lines 10–11) that encode this policy.

**Why it's a problem:** `references/infrastructure-layer.md` hard rule: *"No business rules.
Repositories persist and fetch; they don't decide blocker thresholds or workflow. Logic like that
belongs on the entity or in a use-case."* Retry-eligibility and backoff computation is exactly this
kind of workflow decision — it's a domain invariant about a `WebhookDelivery`, not a data-access
concern. As written, this logic can't be unit-tested without a live/mock DB (it's buried in a
method that also issues a DB query and opens a transaction), and if a second caller ever needs the
same "is this delivery due" logic (e.g. a background sweep job), it will either duplicate the
formula or have to route through this same DB-coupled method.

**Where it should live:** Introduce a domain entity `WebhookDelivery` (in a new `domain/` folder for
this module, per `references/domain-layer.md` and the "module-first, layer-within" shape in
`references/migration-from-current.md`) with the invariant on it: `isDue(now: Date): boolean`,
`isDead(): boolean`, `nextBackoffMs(): number`. `claimDueRetries` in the repository then becomes a
plain fetch (`findRetryCandidates(workspaceId)` → map rows to `WebhookDelivery[]` entities) and a
plain persistence op (`bumpAttempt(id)`); the *decision* of which candidates are due moves to
`WebhooksService` (or a small domain service), which asks each entity `isDue(new Date())` before
telling the repository to bump it.

---

## 7. Repository returns raw Drizzle rows outward instead of mapping to domain entities/DTOs

**Location:** `repository.ts` — `listEndpoints` (line 16), `recordDelivery` (returns `row` at line
33), `claimDueRetries` (returns `d`, a `webhook_deliveries.$inferSelect` row, at line 72). These
rows then flow untransformed through `service.ts` (`endpoints` used directly at line 26,
`due.length` at line 50/retryDueDeliveries) and all the way out to the client in `routes.ts` line 35
(`return reply.code(201).send(row)`).

**Why it's a problem:** `references/infrastructure-layer.md`: *"Map at the boundary... never
return a raw row outward. A leaked `$inferSelect` row couples every caller to the DB schema"* — and
`examples.md` #3 calls this out by name ("Leaking a Drizzle row outward"). Concretely here it means
the HTTP response shape for `POST /webhooks` is whatever columns happen to exist on
`webhook_endpoints` — including, notably, the `secret` column, which now round-trips back to the
client that just set it (a correctness/security smell riding on top of the architecture problem).

**Where it should live:** `repository.ts` should map rows to entities/plain objects via a private
`toDomain()` (per the good example in `references/infrastructure-layer.md`), and `service.ts`
should map its own return values to explicit Result DTOs (e.g. `WebhookEndpointDto { id, url,
createdAt }` — deliberately omitting `secret`) before returning them, per
`references/application-layer.md` ("Map outward... so infrastructure shapes never leak past this
layer"). `routes.ts` then returns that DTO, never the row.

---

## 8. No domain layer for the module at all

**Location:** module-wide — there is no `domain/` (or `webhooks.entities.ts` /
`webhooks.repository.ts`-as-interface) anywhere in the three files; `WebhooksRepository` is a
concrete class with no owning interface/port.

**Why it's a problem:** This mirrors gap #1 in `references/migration-from-current.md` ("no
domain types in `server/` modules yet"), which is an accepted, tracked gap for *existing* modules —
but this is a **new** module being added now, so it's reasonable to ask it to start closer to
target rather than copy the gap forward. Concretely: `WebhooksService` in `service.ts` depends on
the concrete `WebhooksRepository` class (`import { WebhooksRepository } from './repository.js'`),
not an interface, so it can't be unit-tested with a mock repository the way
`references/dependency-injection.md` describes ("Because services depend on interfaces, the mock
is a trivial object that satisfies the port").

**Where it should live:** Add `domain/webhook-endpoint.ts` / `domain/webhook-delivery.ts` (entities
with the invariants from #6) and `domain/webhooks.repository.ts` declaring
`IWebhooksRepository` (the interface, owned by the domain); have `repository.ts`'s
`WebhooksRepository` `implements IWebhooksRepository`; have `WebhooksService` depend on the
interface type, not the concrete class.

---

## 9. Minor / scope note (flagging, not architectural)

`routes.ts`'s retry handler destructures `endpointId` from `req.params` but never uses it —
`retryDueDeliveries` only takes `workspaceId` and retries *all* due deliveries workspace-wide,
ignoring the specific `:endpointId` in the URL. Not an onion-layering issue, but worth a second look
before merge since the route's own path implies per-endpoint scoping.

---

## Summary of "where it should actually live"

| Code currently in... | Should move to... |
|---|---|
| DB query + uniqueness check in `routes.ts` handler | `WebhooksService.createEndpoint()` (application) + `WebhooksRepository` (infrastructure) |
| `new WebhooksService(...)`, `new WebhooksRepository(...)` outside the container | `platform/container.ts` (composition root) |
| Hand-rolled `req.params as`/`req.body as` casts | Zod `params`/`body` schema declared on the route (`fastify-type-provider-zod`) |
| `new OpenAI(...)` + `process.env.OPENAI_API_KEY` in `service.ts` | An `LLMProvider` port, adapter under `server/src/adapters/*`, bound in the container |
| `fetch(endpoint.url, ...)` in `service.ts` | A `WebhookSender` port + adapter, bound in the container |
| Retry-eligibility / backoff math in `repository.ts` | A `WebhookDelivery` domain entity (`isDue`, `isDead`, `nextBackoffMs`) |
| Raw Drizzle rows returned from `repository.ts` and re-sent by `routes.ts` | `toDomain()` mapping in the repository + Result DTOs mapped in `service.ts` |
| No domain/port at all for `WebhooksRepository` | `domain/webhooks.repository.ts` (`IWebhooksRepository` interface) implemented by the concrete class |
