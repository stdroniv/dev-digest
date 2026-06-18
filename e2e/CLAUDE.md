# e2e — `@devdigest/e2e`

Deterministic browser flows for the web app, driven by Vercel **agent-browser**
(Rust + CDP). **No Playwright, no LLM, no API key.**

## Commands

`pnpm test` (`tsx run.ts`) · `pnpm exec ../scripts/e2e.sh` (hermetic: empty
Postgres + seed + API + web, then run flows) · `pnpm typecheck`.

## Conventions (non-obvious)

- **A flow is a JSON file** `specs/NN-name.flow.json` — a list of agent-browser
  commands run in order against one shared browser session by `run.ts`. Not a test
  framework.
- **Assertions are the wait commands.** `wait --text` / `wait --url` exit non-zero
  (failing the flow) if the condition never holds; optional `assert.stdoutIncludes`
  adds a substring check. `{BASE}` → `E2E_BASE_URL` (default `http://localhost:3000`).
- **Deterministic locators only** (`--url`, `--text`, `find role|text|label`).
  Never use the AI `chat` command — runs must stay stable and key-free.
- **Flows target read-only seeded data** (`acme/payments-api`, PR #482, seeded
  agents) so nothing triggers a model call.
- **Precondition: a freshly-seeded DB with only the demo repo** — flow `02` follows
  the home redirect to the *first* repo. `e2e-web.yml` guarantees this in CI.

## Read when…

- **how a flow runs / the spec format** → `README.md`.
- **the test/CI strategy across packages** → `../TESTING.md`.
- **specs / new flows** → `specs/`. **Hard-won gotchas** → `INSIGHTS.md`.
