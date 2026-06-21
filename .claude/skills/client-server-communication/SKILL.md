---
name: client-server-communication
description: "REST API communication contract between a backend and a frontend — the wire boundary itself, not the framework internals. Use whenever defining or changing an HTTP endpoint's request/response shape, choosing a status code, designing an error response, sharing types/contracts across the client↔server boundary, building or reviewing a typed fetch client or data-fetching hooks, or adding streaming (SSE/WebSocket). Covers resource naming, HTTP methods & idempotency, status codes (201/204/400/401/403/404/409/422/429/500), error formats (RFC 9457 problem+json and structured envelopes), versioning, pagination, validation/contracts, auth, caching/ETags, and content negotiation — grounded in RFCs and the Microsoft/Google/Zalando/OWASP/Stripe guidelines. Trigger terms: REST, REST API, API contract, request/response, status code, HTTP error, error response, fetch client, API client, endpoint design, client-server, frontend-backend communication, backend to frontend, SSE, idempotency, ETag, pagination, content negotiation. For Fastify plugin internals use fastify-best-practices; for React/hook coding use react-best-practices; for where files live use ui-frontend-architecture / backend-onion-architecture."
metadata:
  version: 1.0.0
  tags: rest, api, http, client-server, contract, status-codes, error-handling, sse, idempotency, validation, zod, fetch, tanstack-query
  references:
    rfcs:
      - https://www.rfc-editor.org/rfc/rfc9110.html
      - https://www.rfc-editor.org/rfc/rfc9111.html
      - https://www.rfc-editor.org/rfc/rfc9457.html
      - https://www.rfc-editor.org/rfc/rfc6585.html
      - https://www.rfc-editor.org/rfc/rfc6750.html
      - https://www.rfc-editor.org/rfc/rfc8594.html
    guidelines:
      - https://github.com/microsoft/api-guidelines
      - https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design
      - https://google.aip.dev/122
      - https://opensource.zalando.com/restful-api-guidelines/
      - https://owasp.org/API-Security/editions/2023/en/0x11-t10/
      - https://docs.stripe.com/api/idempotent_requests
---

# Client ↔ Server Communication

The **wire boundary**: the HTTP contract two codebases agree on so a request leaves the
client and a predictable response comes back. This skill owns the *shape of what crosses
the wire* — URLs, methods, status codes, error bodies, the shared type/schema, the typed
fetch client + data hooks, and streaming. It is deliberately narrow.

The rules here are **general-purpose REST best practices** drawn from the RFCs and the
major industry guidelines (Microsoft, Google AIP, Zalando, OWASP, Stripe). The code
snippets are **DevDigest examples** — illustrations of the rules in a real stack, not the
rules themselves. Where DevDigest makes a deliberate local choice (e.g. its own error
envelope), it is called out as one valid option among the standards.

## When to use

- Adding or changing an HTTP endpoint's **request or response shape**.
- Choosing a **status code** or designing an **error response body**.
- **Sharing types/contracts** across the client↔server boundary (schema-first, codegen).
- Building or reviewing a **fetch client / API wrapper / data-fetching hooks**.
- Adding **streaming** (SSE / WebSocket) or deciding poll-vs-push.
- Reviewing pagination, versioning, idempotency, caching, auth headers, CORS, or
  content negotiation on an API.

## When NOT to use (defer to a sibling skill)

- **Fastify plugin wiring, hooks, serialization internals** → `fastify-best-practices`.
- **React component / hook coding patterns** (memoization, effects, JSX) → `react-best-practices`.
- **Next.js routing / RSC / metadata mechanics** → `next-best-practices`.
- **Where a file or module should live** → `ui-frontend-architecture`, `backend-onion-architecture`.
- **Deep Zod schema authoring** → `zod`. **Auth/vuln review depth** → `security`.

## The boundary mental model

```
client                          wire                          server
──────                       (the contract)                  ──────
build request  ──►  METHOD /resource  +  body (schema) ──►  validate → reject (4xx) or handle
parse response ◄──  STATUS  +  body (schema | error envelope) ◄──  serialize a typed result
```

The contract is the **shared schema**, not the framework. Both sides validate against it:
the server rejects malformed input *before* business logic; the client parses the response
*before* trusting it. One schema, two enforcement points. When the schema is the single
source of truth, the boundary can't silently drift.

## Core rules (the everyday checklist)

Each line is the rule; the deep "why" + the authoritative source is in
[`references/rest-best-practices.md`](references/rest-best-practices.md). The full URL
bibliography is in [`references/sources.md`](references/sources.md).

1. **Resource naming** — model URLs as **plural nouns** in a hierarchy
   (`/pulls/:id/reviews`), not verbs (`/getReviews`). Verbs only for true non-CRUD actions.
2. **Methods & idempotency** — `GET` reads (safe), `POST` creates (not idempotent), `PUT`
   replaces (idempotent), `PATCH` partially updates, `DELETE` removes (idempotent). Never
   mutate state on `GET`. Make retried writes safe with an idempotency key (rule 8).
   *Updating a resource:* use `PATCH` when the client sends only the changed fields, `PUT`
   when it always sends the full representation — prefer `PATCH` for form/config edits.
3. **Status codes** — succeed precisely: `200` (body), `201` + `Location` (created),
   `204` (no body). Fail precisely: `400` malformed syntax vs **`422` semantically-invalid
   input**, `401` (who are you — add `WWW-Authenticate`) vs `403` (not allowed), `404`,
   `409` conflict, `429` + `Retry-After` (rate limited), `500` for unexpected faults — and
   **never leak stack traces / SQL in a 5xx body**.
4. **Error responses — pick ONE shape and hold it everywhere.** Two valid choices:
   the standard **RFC 9457 `application/problem+json`** (`type/title/status/detail/instance`),
   or a **structured envelope** like `{ error: { code, message, details } }`. Consistency is
   what lets the client branch on a stable machine-readable `code` instead of string-matching.
5. **Validate at BOTH ends, from one schema** — server rejects bad input before the handler;
   client **parses** the response (`Schema.parse(json)`), it doesn't cast (`as T`). A cast is
   a lie the compiler believes; a parse is a check the runtime enforces.
6. **Versioning** — design additive/backward-compatible first so you don't need a version.
   When you must, choose one strategy (URI `/v1`, header, or media-type) and signal removal
   with `Deprecation` + `Sunset` headers.
7. **Pagination / filtering / sorting** — always paginate collections; **prefer cursor/keyset
   over offset** (offset breaks and slows as data shifts). Filter/sort via query params.
8. **Idempotency keys** — accept an `Idempotency-Key` header on retryable `POST`s; cache the
   first response and replay it, so a network retry can't double-create.
9. **Caching & concurrency** — set `Cache-Control` explicitly; emit `ETag` and honor
   `If-None-Match` (→ `304`); use `If-Match` for optimistic concurrency (→ `412` on stale write).
10. **Content negotiation** — send `Content-Type: application/json; charset=utf-8`; honor
    `Accept`; add `Vary: Accept` when responses depend on it.
11. **Security at the boundary** — HTTPS only; `Authorization: Bearer …`; explicit CORS
    origins (no `*` with credentials); rate-limit (→ `429`); authorize every object/operation
    (OWASP API Top 10 — BOLA is #1). Don't echo internals in errors.

## Good vs bad examples

Tight ❌/✅ pairs. The ✅ side mirrors how DevDigest already does it
(`server/src/app.ts`, `server/src/platform/errors.ts`, `client/src/lib/api.ts`,
`client/src/lib/hooks/reviews.ts`); the rule it teaches is general.

### 1. Status code for invalid input

```jsonc
// ❌ Bad — masks failure as success; client can't tell apart from a real result
HTTP/1.1 200 OK
{ "ok": false, "reason": "agentId is required" }

// ✅ Good — semantically-invalid input is 422 with the error envelope
HTTP/1.1 422 Unprocessable Content
{ "error": { "code": "validation_error", "message": "Request validation failed",
             "details": [ { "path": ["agentId"], "message": "Required" } ] } }
```
*Why:* a `2xx` tells caches, clients, and retries "this worked." Validation failures are
client errors — `400` for malformed syntax, `422` for syntactically-valid-but-wrong input.

### 2. URL design

```
❌  POST /getPullReviews        { "pullId": "42" }     // verb + entity-in-body
✅  GET  /pulls/42/reviews                              // noun hierarchy, id in the path
```
*Why:* resources are nouns; the method is the verb. Hierarchical noun URLs are cacheable,
guessable, and uniform.

### 3. One error shape, always

```jsonc
// ❌ Bad — three different shapes from three handlers; the client must guess
"agent not found"
{ "message": "rate limited" }
{ "error": "boom", "status": 500 }

// ✅ Good — every error, every route, the same envelope (or always problem+json)
{ "error": { "code": "not_found",    "message": "Review not found" } }
{ "error": { "code": "rate_limited", "message": "Too many requests" } }
```
*Why:* a stable `code` lets the client branch on `err.code === "not_found"` instead of
fragile string matching. DevDigest centralizes this in one `setErrorHandler`
(`server/src/app.ts`) over an `AppError` taxonomy (`server/src/platform/errors.ts`).

### 4. Never leak internals in a 5xx

```jsonc
// ❌ Bad — hands an attacker your stack, ORM, and table names
HTTP/1.1 500 { "error": "QueryError: null value in column \"workspace_id\"\n at Pg.query (/app/node_modules/...)" }

// ✅ Good — generic message to the client, full detail to the server log
HTTP/1.1 500 { "error": { "code": "internal_error", "message": "Internal error" } }
```
*Why:* error bodies are read by clients *and* attackers. Log the detail server-side; return
a safe message. DevDigest does exactly this on response-serialization failures (`app.ts`).

### 5. Parse the response, don't cast it

```ts
// ❌ Bad — a cast the compiler trusts but nothing checks; a contract drift ships silently
const review = (await res.json()) as ReviewRecord;

// ✅ Good — one schema gives you BOTH the static type and the runtime check
import { ReviewRecord } from "@devdigest/shared";  // z.infer type comes from the same schema
const review: z.infer<typeof ReviewRecord> = ReviewRecord.parse(await res.json());
```
*Why:* `as` is an assertion, not a check — if the server's shape changed, you get an
undefined-explodes-three-renders-later bug. `parse()` fails loudly at the seam. Derive the
type from the schema (`z.infer`) instead of hand-copying a parallel `interface` on each side
— that's how the two ends silently drift. The shared schemas live in `*/src/vendor/shared/
contracts/*` (vendored into both packages). *Note:* DevDigest's `api.ts` currently casts
`as T`; validating responses is the upgrade this rule recommends.

### 6. All data access through the client + hooks layer

```tsx
// ❌ Bad — raw fetch in a component: no error normalization, no caching, no base URL
function Panel() {
  const [d, setD] = useState();
  useEffect(() => { fetch("/pulls/42/reviews").then(r => r.json()).then(setD); }, []);
}

// ✅ Good — a typed hook over the one fetch client (api.ts), with cache + error taxonomy
export function usePrReviews(prId: string) {
  return useQuery({
    queryKey: ["reviews", prId],
    queryFn: () => api.get<ReviewRecord[]>(`/pulls/${prId}/reviews`),
    enabled: !!prId,
  });
}
```
*Why:* one fetch client centralizes base URL, headers, `204` handling, and error → `ApiError`
normalization; hooks add caching and invalidation. Scattered `fetch`es re-solve all of that,
badly. (DevDigest rule: data access only through `src/lib/hooks/*` → `src/lib/api.ts`.)

### 7. Idempotent retryable writes

```http
❌  POST /pulls/42/review            → network blip → client retries → TWO duplicate review runs
✅  POST /pulls/42/review
    Idempotency-Key: 7b3f…-uuid      → server caches the first result, replays it on retry → ONE run
```
*Why:* `POST` isn't idempotent, but networks fail mid-flight. An idempotency key makes the
*operation* safe to retry without the server doing the work twice (Stripe's pattern).

### 8. Live updates: push, don't busy-poll

```ts
// ❌ Bad — hammers the API every 500ms; wasteful, laggy, no backpressure
//        (illustrative endpoint — DevDigest derives status from the event stream, not a /status route)
setInterval(() => api.get(`/runs/${id}/status`), 500);

// ✅ Good — server-push over SSE; one long-lived connection, events as they happen
const es = new EventSource(`${API_BASE}/runs/${id}/events`);
es.onmessage = (e) => append(JSON.parse(e.data));
```
*Why:* for server-driven progress (log/event streams), SSE pushes updates with far less load
and lower latency than polling. DevDigest streams run events this way (`useRunEvents` +
`fastify-sse-v2`, replay-buffer-first so a late subscriber still sees earlier events).
*Tradeoff:* SSE is one-way server→client and text-only; reach for WebSocket only when you
need bidirectional or binary.

## Related skills

- [[fastify-best-practices]] — server framework mechanics (plugins, hooks, serialization).
- [[react-best-practices]] — client component & hook coding patterns.
- [[next-best-practices]] — App Router, server/client boundary, route handlers.
- [[ui-frontend-architecture]] / [[backend-onion-architecture]] — where code lives.
- [[zod]] — authoring the shared schemas. [[security]] — deeper auth/vuln review.

## Changelog

Version this skill with semver in the frontmatter (`metadata.version`).
**patch** = wording/link fixes · **minor** = new rule or example · **major** = restructure.

### 1.0.0 — 2026-06-21
- Initial skill: REST wire-boundary best practices (11 rules), 8 good/bad examples grounded
  in DevDigest code, plus `references/rest-best-practices.md` and `references/sources.md`
  with the full authoritative source bibliography.
