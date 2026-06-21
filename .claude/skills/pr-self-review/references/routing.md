# Routing — changed paths → skills

For each changed file, determine its **area**, then invoke every skill listed for the
areas that have at least one changed file. A file can match several areas (e.g. a changed
`client/**/*.test.tsx` is both `client/**` and a test file). Invoke each unique skill once.

## Areas

| Area / glob | Invoke these skills | Why |
|-------------|---------------------|-----|
| `client/**` | `ui-frontend-architecture`, `react-best-practices`, `next-best-practices` | Frontend placement/structure, component coding, App Router/RSC mechanics |
| `client/**/*.test.ts`, `client/**/*.test.tsx` | `react-testing-library` (in addition to the above) | Test setup, RTL queries, anti-patterns |
| `server/**` | `backend-onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns` | Layer/dependency rule, routes/plugins/validation, DB access |
| `reviewer-core/**` | `backend-onion-architecture` | Must stay pure (no DB/HTTP/FS); inward-only deps |
| **Any** changed file | `security`, `zod`, `typescript-expert` | Cross-cutting: OWASP issues, schema validation, type safety |

## Skip list (never review, never count)

- `*/src/vendor/**` — vendored shared contracts / UI primitives (CLAUDE.md "Do not touch").
- `**/migrations/**`, `**/db/migrations/**` — existing migrations are append-only and frozen.
- Lockfiles (`pnpm-lock.yaml`), generated artifacts, `*.snap`.

## Notes

- **Only touched areas.** If nothing under `server/**` changed, do not invoke the backend
  skills — keep the review focused and fast.
- **Routing is additive, judgment is not.** The skills supply the rules; you still decide
  which rules a given diff actually violates and at what severity (`references/severity.md`).
- Documentation-only changes (`*.md`, `INSIGHTS.md`) and skill/config files generally yield
  no code findings — review for accuracy/secrets via `security` only, usually `PASS`.
