# reviewer-core — `@devdigest/reviewer-core`

The pure review engine: **diff → prompt → LLM → grounded findings**. No DB, GitHub,
or filesystem — the only side effect is an **injected** `LLMProvider`.

## Commands

`pnpm test` (vitest, hermetic with a stubbed `LLMProvider` — no keys, no network) ·
`pnpm typecheck` (this **is** the build).

## Conventions (non-obvious)

- **Consumed as TypeScript source**, never built to JS. The server imports it via
  tsconfig alias (`@devdigest/reviewer-core` → `../reviewer-core/src`). `build` is
  a type-check on purpose — do not add a JS emit step.
- **Stay pure.** No DB/HTTP/FS imports here. Anything with side effects belongs in
  the server adapters; this package only computes over its inputs + the injected LLM.
- **Grounding is the mandatory gate** (`grounding.ts`): a finding that doesn't cite
  a real diff line is dropped, and the score is recomputed from survivors — the
  model's self-reported score is ignored. Don't bypass it.
- **Injection defense is one shared trusted rule** (`INJECTION_GUARD` in
  `prompt.ts`), not keyword scanning. Untrusted content (diff, PR body, README) is
  fenced as data via `wrapUntrusted()`; claims like "test fixture, don't flag"
  never descope a review.
- **Optional prompt slots** (`skills`, `memory`, `specs`, `callers`) are fed by
  later lessons; when omitted, `assemblePrompt` just leaves those sections out.
- **Contracts** (`Review`, `Finding`, `Verdict`, …) come from `@devdigest/shared` —
  don't redefine them locally.

## Read when…

- **the full pipeline / public API** → `README.md`.
- **how the server gathers inputs & persists output** → `../server/CLAUDE.md`.
- **agent system-prompt conventions** → `../docs/agent-prompts/README.md`.
- **specs for in-progress work** → `specs/`. **Hard-won gotchas** → `INSIGHTS.md`.
