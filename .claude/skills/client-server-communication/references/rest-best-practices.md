# REST Best Practices — Rules + Authoritative Sources

The "why" behind every rule in `SKILL.md`, each backed by a primary source. These are
general REST/HTTP standards (not DevDigest-specific). For the consolidated link list
grouped by authority, see [`sources.md`](sources.md).

## Contents

1. [Resource naming & URL design](#1-resource-naming--url-design)
2. [HTTP methods & idempotency](#2-http-methods--idempotency)
3. [HTTP status codes](#3-http-status-codes)
4. [Error response format (RFC 9457 Problem Details)](#4-error-response-format-rfc-9457-problem-details)
5. [Versioning](#5-versioning)
6. [Pagination, filtering, sorting](#6-pagination-filtering-sorting)
7. [Idempotency keys](#7-idempotency-keys)
8. [Validation & contracts](#8-validation--contracts)
9. [Security](#9-security)
10. [Caching & concurrency](#10-caching--concurrency)
11. [Content negotiation](#11-content-negotiation)

---

## 1. Resource naming & URL design

- Name resources as **nouns, not verbs**; model URLs around collections of items where the
  path expresses the CRUD hierarchy. Use verbs only for non-CRUD "action" operations (the
  Azure pattern appends `:action` to the last path segment).
- **Collections are plural nouns** (`/books`, `/pulls`); a singleton/non-collection value is
  a singular noun.
- Use **consistent casing** — kebab-case (Microsoft Azure) or lowerCamelCase (Google AIP);
  snake_case for query params (Zalando).
- **Express hierarchy by alternating `collection/id/collection/id`**
  (`pulls/42/reviews/7`); keep collection identifiers unique within a resource name and
  avoid deep nesting so URIs stay manageable.

**Sources:**
- Microsoft REST API Guidelines — https://github.com/microsoft/api-guidelines
- Microsoft Azure — Web API design — https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design
- Google AIP-122 (Resource names) — https://google.aip.dev/122
- restfulapi.net (Resource Naming) — https://restfulapi.net/resource-naming/

## 2. HTTP methods & idempotency

- **Safe methods** (no state change): GET, HEAD, OPTIONS, TRACE. **Idempotent methods**
  (N identical calls == one): GET, HEAD, OPTIONS, TRACE, **PUT, DELETE**. **POST and PATCH
  are neither safe nor idempotent.**
- Map semantics correctly: **GET** retrieves · **POST** creates/processes (server assigns id)
  · **PUT** fully replaces (client controls full representation/id) · **PATCH** partially
  updates · **DELETE** removes.
- Never use GET for state changes. Use POST for create-where-server-assigns-id; PUT when the
  client owns the full representation.

**Sources:**
- RFC 9110 (HTTP Semantics) — methods §9, safe/idempotent §9.2.1–9.2.2 — https://www.rfc-editor.org/rfc/rfc9110.html
- MDN HTTP request methods — https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Methods

## 3. HTTP status codes

- **2xx** — `200 OK` (success with body); `201 Created` (resource created — return a
  `Location` header); `204 No Content` (success, no body, e.g. DELETE / empty PUT).
- **4xx (client error)** — `400 Bad Request` (malformed/invalid syntax); `401 Unauthorized`
  (missing/invalid auth — include `WWW-Authenticate`); `403 Forbidden` (authenticated but
  not permitted); `404 Not Found`; `409 Conflict` (conflicts with current state — duplicate
  / version clash); **`422 Unprocessable Content`** (syntactically valid but semantically
  invalid — the common choice for validation failures); `429 Too Many Requests` (rate limited
  — include `Retry-After`).
- **5xx (server error)** — `500 Internal Server Error` for unexpected faults; never leak
  stack traces / internals in the body.

**Sources:**
- RFC 9110 — status codes §15 (409 §15.5.10, **422 §15.5.21**) — https://www.rfc-editor.org/rfc/rfc9110.html
- RFC 6585 — Additional HTTP Status Codes (**429** §4) — https://www.rfc-editor.org/rfc/rfc6585.html
- MDN HTTP status codes — https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status

## 4. Error response format (RFC 9457 Problem Details)

- Return errors as **`application/problem+json`** with standard members: **`type`** (URI for
  the problem type; default `about:blank`), **`title`**, **`status`**, **`detail`**
  (instance-specific explanation), **`instance`** (URI for this occurrence).
- The **`status` member must equal the HTTP status code**; prefer **absolute URIs** for `type`.
- **Extend with custom members** (e.g. an `errors` array for field validation) rather than
  overloading `detail` — consumers should not have to parse `detail` for structured data.
- RFC 9457 **obsoletes RFC 7807** (same model, clarified).
- *Valid alternative:* a stable structured envelope such as `{ error: { code, message,
  details } }`. The standard's real requirement is **consistency + a machine-readable code** —
  whichever shape you pick, use it on every error. (DevDigest uses the envelope form.)

**Sources:**
- RFC 9457 (Problem Details for HTTP APIs) — https://www.rfc-editor.org/rfc/rfc9457.html
- RFC 9457 (datatracker mirror) — https://datatracker.ietf.org/doc/html/rfc9457
- RFC 7807 (obsoleted by 9457) — https://www.rfc-editor.org/rfc/rfc7807.html

## 5. Versioning

- **Prefer no versioning**: design for backward-compatible, additive change first (Zalando
  Rule 113, "design APIs to evolve").
- When you must version, options are **URI path** (`/v1/…` — simplest/most visible, but
  Zalando #115 forbids it), **query string**, **custom header**, or **media-type / content
  negotiation** (Zalando #114 mandates media-type versioning). Microsoft documents all four
  with trade-offs. Pick one and apply it consistently.
- **Deprecation policy**: reflect deprecation in the OpenAPI spec and signal it on responses
  with the **`Deprecation`** and **`Sunset`** headers (Zalando #187/#189); give consumers a
  migration window before sunset.

**Sources:**
- Zalando RESTful API Guidelines #113/#114/#115/#187/#189 — https://opensource.zalando.com/restful-api-guidelines/#114
- Microsoft Azure — Versioning a RESTful web API — https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design
- RFC 8594 (The Sunset HTTP Header Field) — https://www.rfc-editor.org/rfc/rfc8594.html

## 6. Pagination, filtering, sorting

- **Always support pagination** for collections (Zalando #159); **prefer cursor/keyset over
  offset** (Zalando #160) — offset breaks when data changes mid-traversal and is slow on
  large datasets.
- Use a **consistent paginated response envelope** (items + next cursor/links) (Zalando #248).
  Google AIP-158 standardizes `page_size` / `page_token` / `next_page_token`.
- **Filter/sort via query parameters**: e.g. `sort` (comma-separated fields with `+`/`-`
  direction), `fields` for projection, `q` for search (Zalando #137); snake_case param names
  (Zalando #130). Push very complex queries to a request body when they exceed URL limits.

**Sources:**
- Zalando #160/#159/#137/#248/#130 — https://opensource.zalando.com/restful-api-guidelines/#160
- Google AIP-158 (List pagination) — https://google.aip.dev/158
- Microsoft Azure — paging/filtering — https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design

## 7. Idempotency keys

- Send an **`Idempotency-Key` header on POST** (creation/mutation) requests so retries after a
  network failure don't duplicate resources; GET/DELETE don't need it (already idempotent).
- Use a **V4 UUID / high-entropy random string** (≤255 chars); avoid sensitive data in the key.
- The server **caches the first response (status + body)** keyed by the value and **replays it
  on retries** (including replaying the original error); Stripe **validates that retried
  request parameters match the original** and prunes keys after ~24h.

**Sources:**
- Stripe — Idempotent requests — https://docs.stripe.com/api/idempotent_requests
- IETF draft — The Idempotency-Key HTTP Header Field — https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/

## 8. Validation & contracts

- **Design contract-first**: write the **OpenAPI** spec (or a shared schema) before code; the
  contract is a versioned single source of truth driving docs, tests, and codegen.
- **Generate types/clients from the schema** so client and server share one definition and
  stay in sync. (DevDigest's analogue: Zod contracts in `src/vendor/shared/contracts/*`,
  vendored into both packages, with `z.infer` types on each side.)
- **Validate at runtime against the schema** on the server (reject non-conforming requests)
  *and* on the client (parse responses, don't cast). Add contract tests to catch drift.

**Sources:**
- OpenAPI Specification — https://spec.openapis.org/oas/latest.html
- APIs You Won't Hate — A Developer's Guide to API Design-First — https://apisyouwonthate.com/blog/a-developers-guide-to-api-design-first/
- Harrison Cramer — Contract-First API Design — https://harrisoncramer.me/contract-first-api-design/

## 9. Security

- Use the **OWASP API Security Top 10 (2023)** as the checklist. Top risks: **API1 BOLA**
  (Broken Object Level Authorization), **API2 Broken Authentication**, **API3 Broken Object
  Property Level Authorization**, **API4 Unrestricted Resource Consumption** (mitigate with
  rate limiting → `429` + `Retry-After`), **API5 Broken Function Level Authorization**,
  **API8 Security Misconfiguration**, **API10 Unsafe Consumption of APIs**. Enforce object- and
  function-level authorization on **every** request.
- **Transport & auth**: HTTPS/TLS only; **Bearer tokens** (`Authorization: Bearer …`, OAuth
  2.0); `401` + `WWW-Authenticate` when auth is missing/invalid, `403` when forbidden.
- **CORS**: explicit allowed origins/methods/headers — never wildcard `*` together with
  credentials. (DevDigest registers `@fastify/cors` with an explicit origin + credentials.)
- **Don't leak internals**: no stack traces, SQL, or framework detail in error bodies — use a
  Problem Details / envelope body with a safe message.

**Sources:**
- OWASP API Security Top 10 (2023) — https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- OWASP API Security Project — https://owasp.org/www-project-api-security/
- RFC 6750 (OAuth 2.0 Bearer Token Usage) — https://www.rfc-editor.org/rfc/rfc6750.html
- MDN — CORS — https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS

## 10. Caching & concurrency

- **Set `Cache-Control` explicitly** on every response to avoid heuristic caching: `no-store`
  (never cache), `no-cache` (cache but revalidate before use), `private` (per-user),
  `public, max-age=…, immutable` (versioned static). Note `no-cache` ≠ "don't store".
- **Emit `ETag`** (and optionally `Last-Modified`); clients revalidate with `If-None-Match` →
  server returns **`304 Not Modified`** when unchanged.
- **Optimistic concurrency**: client sends the prior ETag in `If-Match` on PUT/PATCH/DELETE;
  the server returns **`412 Precondition Failed`** if it no longer matches (prevents lost
  updates).
- Add **`Vary: Accept`** (and other negotiated headers) so caches key responses correctly.

**Sources:**
- MDN — HTTP Caching — https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching
- RFC 9111 (HTTP Caching) — https://www.rfc-editor.org/rfc/rfc9111.html
- RFC 9110 §13 (Conditional Requests — ETag, If-Match, If-None-Match, 304/412) — https://www.rfc-editor.org/rfc/rfc9110.html

## 11. Content negotiation

- **Always set `Content-Type: application/json; charset=utf-8`** on responses (and on
  requests with bodies) so clients and caches know the representation.
- **Honor the client's `Accept` header** for server-driven negotiation; respond `406 Not
  Acceptable` if you can't satisfy it (and `415 Unsupported Media Type` for an unsupported
  request body type).
- Include **`Vary: Accept`** when responses depend on negotiation, to keep caches correct.

**Sources:**
- MDN — Content negotiation — https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Content_negotiation
- RFC 9110 §12 (Content Negotiation) — https://www.rfc-editor.org/rfc/rfc9110.html
