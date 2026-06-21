# Sources — REST / HTTP Communication Bibliography

Every reference cited by this skill, grouped by authority, with a one-line note on what it
backs. These are the durable primary sources behind the rules in
[`rest-best-practices.md`](rest-best-practices.md) and the checklist in `../SKILL.md`.

## IETF RFCs (rfc-editor.org / datatracker.ietf.org)

- **RFC 9110 — HTTP Semantics** — https://www.rfc-editor.org/rfc/rfc9110.html
  Methods & safe/idempotent (§9), status codes (§15, incl. 422 §15.5.21, 409 §15.5.10),
  content negotiation (§12), conditional requests / ETags (§13), auth (§11). The backbone.
- **RFC 9111 — HTTP Caching** — https://www.rfc-editor.org/rfc/rfc9111.html
  `Cache-Control`, freshness, validation, `Vary`.
- **RFC 9457 — Problem Details for HTTP APIs** — https://www.rfc-editor.org/rfc/rfc9457.html
  Standard `application/problem+json` error body. (datatracker: https://datatracker.ietf.org/doc/html/rfc9457)
- **RFC 7807 — Problem Details (obsoleted by 9457)** — https://www.rfc-editor.org/rfc/rfc7807.html
  The original; cite 9457 instead, kept for historical links.
- **RFC 6585 — Additional HTTP Status Codes** — https://www.rfc-editor.org/rfc/rfc6585.html
  Defines `429 Too Many Requests` (§4), 428, 431, 511.
- **RFC 6750 — OAuth 2.0 Bearer Token Usage** — https://www.rfc-editor.org/rfc/rfc6750.html
  `Authorization: Bearer …`, `WWW-Authenticate` challenges.
- **RFC 8594 — The Sunset HTTP Header Field** — https://www.rfc-editor.org/rfc/rfc8594.html
  Signaling resource/endpoint deprecation windows.
- **IETF draft — The Idempotency-Key HTTP Header Field** — https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/
  Standardization-in-progress of the idempotency-key pattern.

## OWASP

- **API Security Top 10 (2023)** — https://owasp.org/API-Security/editions/2023/en/0x11-t10/
  The threat checklist: BOLA, broken auth, resource consumption / rate limiting, etc.
- **API Security Project (home)** — https://owasp.org/www-project-api-security/

## Microsoft

- **REST API Guidelines (GitHub)** — https://github.com/microsoft/api-guidelines
  Naming, actions, casing, collection conventions.
- **Azure Architecture Center — Web API design best practices** — https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design
  Pragmatic overview: naming, methods, paging/filtering, versioning trade-offs.

## Google (API Improvement Proposals)

- **AIP-122 — Resource names** — https://google.aip.dev/122
  Resource-oriented naming and collection identifiers.
- **AIP-158 — List pagination** — https://google.aip.dev/158
  `page_size` / `page_token` / `next_page_token` pagination contract.

## Zalando

- **RESTful API Guidelines** — https://opensource.zalando.com/restful-api-guidelines/
  Cited rules: #113 (design to evolve), #114 (media-type versioning), #115 (no URI
  versioning), #130 (snake_case params), #137 (filter/sort query params), #159 (support
  pagination), #160 (prefer cursor over offset), #187/#189 (Deprecation/Sunset), #248
  (pagination response envelope).

## Stripe

- **Idempotent requests** — https://docs.stripe.com/api/idempotent_requests
  Canonical real-world `Idempotency-Key` design: cache-and-replay, param matching, TTL.

## MDN Web Docs

- **HTTP request methods** — https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Methods
- **HTTP response status codes** — https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status
- **HTTP Caching** — https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching
- **Content negotiation** — https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Content_negotiation
- **CORS** — https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS

## OpenAPI / community

- **OpenAPI Specification** — https://spec.openapis.org/oas/latest.html
  Contract-first / schema-as-source-of-truth standard.
- **restfulapi.net — Resource Naming** — https://restfulapi.net/resource-naming/
- **APIs You Won't Hate — A Developer's Guide to API Design-First** — https://apisyouwonthate.com/blog/a-developers-guide-to-api-design-first/
- **Harrison Cramer — Contract-First API Design** — https://harrisoncramer.me/contract-first-api-design/

---

*Maintenance note:* if a link rots, prefer replacing it with the equivalent canonical
primary source (an RFC, or the official guideline doc) rather than a secondary blog.
