# Plan — Intent Layer

> Status: **awaiting approval**. Authored by the orchestrator from verified codebase
> exploration (the `planner` agent — since renamed `implementation-plan` — dropped its
> connection mid-write twice; grounding below was confirmed against the actual files).

## Goal

Before a human reads the review, show how the machine understood the PR's **intent**.

- A **cheap LLM call** classifies the PR's intent/scope into `Intent {summary, in_scope[], out_of_scope[]}`.
- **Input is deliberately lean**: PR title + body + linked-issue title/body + a list of
  changed files with **only their `@@ … @@` hunk headers** — *no diff bodies*. We log how
  many tokens that omission saved.
- The intent is **stored per-PR**, shown as an **Intent card** on the PR Overview, and
  **injected into the review agent's prompt** with a scope-discipline rule so the review
  stays on-topic.
- The classifier model is **chosen in the existing Settings → Feature Models section**
  (the "PR Review · Intent" row, which already exists), reusing the `review_intent`
  feature-model slot. The cheap model is selected **there** (see the provided screenshot,
  e.g. `deepseek/deepseek-v4-flash`); the **vendored registry default (`openai/gpt-4.1`)
  is left untouched** — no code default change, no seeded override.

## Confirmed design decisions (do not re-litigate)

1. **Schema = `{summary, in_scope[], out_of_scope[]}` only.** Reuse the existing
   `pr_intent` table and `Intent` Zod contract verbatim. **No migration, no `risk_areas`,
   no change to the contract shape.** The existing contract names the summary field
   `intent` (a string) — keep that name; the UI labels it "summary".
2. **Compute = auto-on-first-review + manual button.** Intent is computed automatically
   the first time a review runs on a PR if none is stored, and a manual **Recalculate**
   button re-computes it. A review injects the stored intent block when present.

## Verified existing scaffolding (reuse — do not rebuild)

| Concern | Location (verified) |
|---|---|
| `pr_intent` table (prId PK, `intent` text, `in_scope` jsonb[], `out_of_scope` jsonb[]) | `server/src/db/schema/reviews.ts` ~48–55 — already migrated |
| `upsertIntent` / `getIntent` repo helpers (unused today) | `server/src/modules/reviews/repository/pull.repo.ts` ~47–68 |
| `Intent` Zod contract `{intent, in_scope, out_of_scope}` | `server/src/vendor/shared/contracts/brief.ts` ~9–14 (+ client mirror `client/src/vendor/shared/contracts/brief.ts`); barrel-exported via `@devdigest/shared` |
| `review_intent` feature-model (inert, default `openai/gpt-4.1`) | `server/src/vendor/shared/contracts/platform.ts` ~52–58 (FEATURE_MODELS + FeatureModelId) |
| `resolveFeatureModel` / `getFeatureModelOverride` | `server/src/modules/settings/feature-models.ts` ~36–57 |
| Settings → Models UI (lists every feature) + client mirror | `client/src/app/settings/[section]/_components/SettingsView/_components/SettingsModels/SettingsModels.tsx`, `client/src/lib/feature-models.ts`, `client/src/lib/types.ts` |
| LLM factory `container.llm(provider)` → `LLMProvider` | `server/src/platform/container.ts` ~162–193 |
| `completeStructured<T>({model, schema, schemaName, messages, …})` → `{data, tokensIn, tokensOut, costUsd, …}` | `server/src/vendor/shared/adapters.ts` ~55–95 |
| `tokenizer.count(text)` (used for `skillsTokens`) | `server/src/platform/container.ts` (tokenizer); used in `run-executor.ts` ~205–207 |
| GitHub `getPullRequest(repo, n)` → `PrDetail` (title, body, files[].patch, `linked_issue`) | `server/src/adapters/github/octokit.ts` ~70–124; `getIssue` / `resolveLinkedIssue` (`closes\|fixes\|resolves #\d+`) ~126–135 |
| `pr_files.patch` (unified patch incl. hunk headers) | `server/src/db/schema/pulls.ts` ~36–45 |
| Diff/hunk parser | `server/src/adapters/git/diff-parser.ts` ~46–60 |
| Prompt assembly seam `assemblePrompt(parts)` (PR-description block ~107; `wrapUntrusted` ~30–34) | `reviewer-core/src/prompt.ts` ~85–141 |
| `reviewPullRequest(input: ReviewInput)` (calls `assemblePrompt` ~169 & ~199) | `reviewer-core/src/review/run.ts` ~44–150 |
| Review orchestration (calls `reviewPullRequest` ~224; token accum ~210–248; `RunTrace.stats` ~299–320) | `server/src/modules/reviews/run-executor.ts` |
| `RunLogger` (SSE + persisted log) | `server/src/platform/run-logger.ts` ~50–67 |
| Review trigger route `POST /pulls/:id/review` (schema-first) | `server/src/modules/reviews/routes.ts` ~27–44 |
| Client PR page / OverviewTab / FindingCard pattern (co-located `styles.ts`, CSS vars) | `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` + `_components/OverviewTab/`, `_components/FindingCard/` |
| Query hooks (`usePullDetail` → `["pull", prId]`; `useRunReview` mutation + `invalidateQueries`) | `client/src/lib/hooks/core.ts`, `client/src/lib/hooks/reviews.ts` |
| API client `api.get/post` | `client/src/lib/api.ts` ~65–74 |
| i18n (already has `block.intent`) | `client/messages/en/brief.json` |

**Reviewer-core resolves `@devdigest/shared` to the server's vendored copy**
(`reviewer-core/tsconfig.json` → `../server/src/vendor/shared/*`), so there is a single
vendored shared tree for server + reviewer-core, and a second for client.

---

## Steps (ordered, grouped by layer)

### A. Contracts / shared — **no shape change**
- **A1.** Confirm we reuse `Intent` as-is (no edit). The classifier returns `Intent`; the
  table and repo helpers already match. *Acceptance:* `grep` shows `Intent` unchanged; no
  new migration file added.

### B. reviewer-core (pure engine — provider injected, stays framework-free)
- **B1. New `classifyIntent`.** Add `reviewer-core/src/intent/classify.ts` exporting a pure
  `classifyIntent(input)` that takes `{ llm: LLMProvider, model: string, title, body?,
  linkedIssue?: {title, body?}, changedFiles: string }` and calls
  `llm.completeStructured<Intent>({ model, schema: Intent, schemaName: 'Intent', messages,
  maxRetries: 2, … })`, returning `{ intent: Intent, tokensIn, tokensOut, costUsd }`.
  The prompt is built here: a trusted instruction establishing the classifier's job and
  scope-discipline framing, plus the untrusted PR-derived content (title/body/issue/file
  list) wrapped with the existing `wrapUntrusted` helper. **`changedFiles` carries file
  paths + `@@ … @@` hunk-header lines only — never diff content.**
  *Acceptance:* hermetic unit test (fake `LLMProvider`) asserts the assembled prompt
  contains the file list + hunk headers and contains **no** added/removed code lines.
- **B2. Prompt injection seam.** In `reviewer-core/src/prompt.ts`: add optional
  `PromptParts.prIntent?: string`. After the PR-description section (~line 107), push:
  `## PR Intent` + a **trusted** rule line ("Review only within this stated intent. If you
  find a serious issue outside the stated scope, emit a *single* signal finding — not many.")
  + `wrapUntrusted('pr-intent', <summary + in/out-of-scope rendered as text>)`.
  *Acceptance:* unit test: when `prIntent` is set the assembled user message contains the
  rule and the `pr-intent` untrusted wrapper; when unset, nothing changes.
- **B3. Thread intent through the review.** In `reviewer-core/src/review/run.ts`: add
  optional `ReviewInput.intent?: Intent` (or a preformatted string). Format it into
  `prIntent` and pass to `assemblePrompt` at both call sites (~169, ~199).
  *Acceptance:* `pnpm typecheck` in reviewer-core; existing review tests still pass.

### C. server — input assembly, classification orchestration, persistence
- **C1. Hunk-header extractor.** Small helper (e.g.
  `server/src/modules/reviews/intent-input.ts`) that, given `PrDetail.files`, returns a
  compact text block of `path` + the `@@ … @@` lines from each `patch` (regex
  `/^@@ .* @@.*$/m`), dropping all content lines. *Acceptance:* hermetic unit test on a
  sample patch → only path + hunk-header lines remain.
- **C2. Intent service.** Add an intent-compute method (new
  `server/src/modules/reviews/intent.service.ts` or a method on the existing reviews
  service) that: (a) fetches **fresh** `PrDetail` via `github.getPullRequest` (so recompute
  reflects PR updates and pulls the linked-issue body, which is *not* stored); (b) builds
  the changed-files block via C1; (c) `resolveFeatureModel(container, workspaceId,
  'review_intent')` → `{provider, model}`; (d) `container.llm(provider)`; (e) calls
  `classifyIntent`; (f) computes **token savings** = `tokenizer.count(<all patches
  concatenated>)` − `tokenizer.count(<headers-only input>)`, logs it (see C4); (g)
  `upsertIntent(db, prId, intent)`; returns the `Intent` + savings.
  *Acceptance:* DB-backed `*.it.test.ts` — calling the service persists a row readable by
  `getIntent`.
- **C3. Routes (schema-first, fastify-type-provider-zod).** In
  `server/src/modules/reviews/routes.ts`:
  - `POST /pulls/:id/intent` → (re)compute, persist, return `Intent` (rate-limit like the
    review route, e.g. 10/min).
  - `GET /pulls/:id/intent` → `getIntent` → `Intent | null` (card read path; dedicated key
    keeps the recalc invalidation narrow).
  *Acceptance:* route typechecks; `POST` then `GET` round-trips an Intent (it.test).
- **C4. Token-savings logging.** Always log via the request/run logger
  (`intent: model=<id> tokensIn=<n> savedVsFullDiff=<n>`). When computed inside a review
  run, also add `intent_tokens` and `intent_tokens_saved` to the `RunTrace.stats` block in
  `run-executor.ts` (~299–320). *Acceptance:* log line observed; stats fields present in a
  run trace when auto-computed.
- **C5. Auto-on-first-review + injection wiring.** In
  `server/src/modules/reviews/run-executor.ts`, before assembling the review prompt:
  `getIntent(prId)`; if absent, call the C2 service once to compute+persist; then pass the
  `Intent` into `reviewPullRequest({ …, intent })` (B3). A manual recompute updates what the
  *next* review injects. *Acceptance:* it.test — first review on a PR with no intent leaves
  a persisted intent and the prompt assembly received it (assert via spy/fake LLM).

### D. client — Intent card + hooks + i18n
- **D1. Hooks.** Add `useIntent(prId)` (`useQuery`, key `["intent", prId]`,
  `api.get<Intent | null>('/pulls/'+prId+'/intent')`) and `useRecalculateIntent()`
  (`useMutation` → `api.post('/pulls/'+prId+'/intent')`, `onSuccess` →
  `invalidateQueries(["intent", prId])`). Place in `client/src/lib/hooks/core.ts` or a new
  `brief.ts`, mirroring `usePullDetail` / `useRunReview`.
- **D2. IntentCard component.** New
  `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/{IntentCard.tsx,
  styles.ts, index.ts}` mirroring `FindingCard` conventions (co-located `styles.ts`,
  `satisfies CSSProperties`, CSS vars, shared UI primitives + `Icon`). Renders: summary
  text, **IN SCOPE** list, **OUT OF SCOPE** list, and a **Recalculate** button
  (`loading={mutation.isPending}`). Empty state when no intent yet ("No intent computed —
  Recalculate"). Imports `type { Intent } from "@devdigest/shared"`.
- **D3. Mount in Overview.** Render `IntentCard` in
  `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`
  alongside the PR brief.
- **D4. i18n.** Add strings to `client/messages/en/brief.json` under the existing `intent`
  area: `summary`, `inScope`, `outOfScope`, `recalculate`, `recalculating`, `empty`.
  *Acceptance:* `pnpm typecheck` + RTL test: card renders summary/scopes, shows empty
  state, and clicking Recalculate fires the mutation.

### E. settings / model selection — **mostly already done (DECIDED)**
- **E1. No new settings UI.** `review_intent` is already in the `FeatureModelId` enum, the
  vendored registry, and the client mirror (`client/src/lib/feature-models.ts`), and the
  existing **Settings → Feature Models** panel renders every feature — so the
  "PR Review · Intent" picker already exists (confirmed against the user's screenshot). The
  only work is **backend wiring**: the intent service resolves its model via
  `resolveFeatureModel(container, workspaceId, 'review_intent')` (C2), which returns the
  user's Settings override if set, else the registry default. *Acceptance:* changing the
  model in Settings → Feature Models changes the model the intent classifier uses.
- **E2. Cheap default — DECIDED: leave the vendored default untouched.** Do **not** edit
  the vendored `platform.ts` and do **not** seed an override. The registry default stays
  `openai/gpt-4.1`; the cheap model is selected by the user in Settings → Feature Models
  (per the screenshot). *Acceptance:* no diff to `*/vendor/**`; no seed change.

### F. tests (summary — each step above lists its own acceptance check)
- reviewer-core (hermetic): `classifyIntent` prompt (no diff bodies; headers present) +
  `prompt.ts` injection.
- server (`*.it.test.ts`, testcontainers): intent service persistence, `POST`→`GET`
  round-trip, auto-on-first-review wiring + stats.
- client (RTL): `IntentCard` render / empty state / recalc mutation.

---

## Risks / open questions

1. **Cheap default model & the vendor boundary — RESOLVED.** The vendored default stays
   `openai/gpt-4.1` (untouched); the cheap model (e.g. `deepseek/deepseek-v4-flash`) is
   selected by the user in the existing **Settings → Feature Models** section. No vendored
   edit, no seeded override. *Consequence to keep in mind:* until the user picks a flash
   model in Settings, the classifier runs on the `gpt-4.1` default — i.e. "cheap" is a user
   choice in the UI, not a code default. This matches the provided screenshot.
2. **Field naming.** Contract field is `intent` (the summary string); UI labels it
   "summary". No rename (vendored contract is do-not-touch).
3. **Token-savings outside a run.** Manual-button computes have no `RunTrace`; log savings
   via the request logger and return them in the response. Only fold into `RunTrace.stats`
   on the auto-on-first-review path.
4. **Linked-issue fetch needs network + `GITHUB_TOKEN`.** Compute pulls fresh `PrDetail`
   from GitHub; handle a missing token / failed fetch gracefully (classify from
   title/body/files only). External trackers (Jira/Linear) are **out of scope** — only the
   GitHub linked issue (`closes/fixes/resolves #N`) is read.

## Anticipated changed-file set

**reviewer-core/**
- `src/intent/classify.ts` *(new)*
- `src/prompt.ts` *(PromptParts.prIntent + injection)*
- `src/review/run.ts` *(ReviewInput.intent + threading)*

**server/**
- `src/modules/reviews/intent-input.ts` *(new — hunk-header extractor)*
- `src/modules/reviews/intent.service.ts` *(new — or a method on the reviews service)*
- `src/modules/reviews/routes.ts` *(POST + GET `/pulls/:id/intent`)*
- `src/modules/reviews/run-executor.ts` *(auto-compute + inject + stats)*
- `src/modules/reviews/repository/pull.repo.ts` *(reuse/export upsertIntent/getIntent)*

**client/**
- `src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/{IntentCard.tsx,styles.ts,index.ts}` *(new)*
- `src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx` *(mount)*
- `src/lib/hooks/core.ts` (or new `brief.ts`) *(useIntent + useRecalculateIntent)*
- `messages/en/brief.json` *(intent strings)*

*(No settings UI changes — the Feature Models picker already includes "PR Review · Intent".
No seed change. No vendored-contract edit.)*

**tests** (alongside the above): reviewer-core hermetic, server `*.it.test.ts`, client RTL.

**No new migration.** **No `Intent` contract shape change.** Vendored `platform.ts` edited
only if the gate chooses Risk #1 Option B.
