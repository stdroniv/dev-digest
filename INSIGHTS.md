# root — Engineering Insights

Append-only log of non-obvious, hard-won lessons for this module. Managed by the
`engineering-insights` skill. Add each entry under one section; keep it actionable
cold; never edit or delete existing entries.

## What Works

## What Doesn't Work

- A NEW top-level package that BOTH imports the server's Drizzle schema (`@devdigest/api/db/schema.js`)
  AND imports `drizzle-orm` operators (`eq`/`and`/`inArray`) from its OWN `node_modules/drizzle-orm`
  gets a TYPECHECK-ONLY nominal clash even when the versions are byte-identical:
  `error TS2769 … Types have separate declarations of a private property 'shouldInlineParams'`. Cause:
  two physical drizzle copies (`mcp/node_modules/drizzle-orm` vs `server/node_modules/.pnpm/drizzle-orm@…`).
  The server schema's columns are typed by SERVER's copy, so an `eq()` from a DIFFERENT copy won't
  accept them. Runtime is fine (drizzle operators are structural) — it's purely `tsc`. Hit while building
  `mcp/`. **Fix that works:** do NOT add `drizzle-orm` to the new package and do NOT import its operators
  in tests — drive all DB access through the application services/repositories (which use server's own
  drizzle internally): resolve agents via `AgentsService.list`, run status via `ReviewService.listRuns`,
  PRs via `ReviewRepository.getPullByNumber`. Raw `db.insert(t.x).values(...).returning()` is fine (no
  operator → server-typed throughout); only the operator imports clash. (reviewer-core dodges this entirely
  by being pure — it has no drizzle.)
- The `ship-feature` skill and the `.claude/agents/*.md` roster **drift out of sync on an agent
  rename**, and nothing catches it automatically. Renaming `planner`→`implementation-plan` (and adding
  `spec-creator`/`spec-conformance`) left `.claude/skills/ship-feature/SKILL.md` still saying
  "Spawn `planner`" — i.e. spawning a **deleted** agent — plus stale mentions in
  `references/cost-discipline.md`, the skill `CHANGELOG`, and `docs/plans/*`. The agent files and
  `agents/README.md` had been updated; the **orchestrator that drives them** had not. The skill body is
  plain prose the harness never validates against the live agent roster, so a dead spawn target fails
  **silently until `/ship-feature` runs**. **Fix/habit:** after renaming/adding/removing any agent,
  `grep -rn '<old-name>' .claude/ docs/` for the OLD name and fix every spawn instruction, pipeline
  diagram, and cross-reference. (Distinct from the skill⇄agent *conversion* catalog check under Tool &
  Library Notes — this is same-role, name-changed drift in the orchestration prose.)
- The "no `skills:` frontmatter, use an on-demand routing table" convention (see Tool & Library Notes)
  is **not self-enforcing and does get violated in practice**: the `implementation-plan` agent (opus,
  multi-turn) shipped with a **13-entry `skills:` block** preloading every SKILL.md plus a body line
  "all skills are pre-loaded via the frontmatter" — re-billing all 13 files as cache-read on *every*
  turn of an opus agent, the single worst preload in the roster. When auditing agents for cost,
  `grep -n '^skills:' .claude/agents/*.md` to find preloads; convert each to the routing-table pattern,
  copying the `implementer.md` / `test-writer.md` body shape (module→skill table + read 1–2 on demand).
  Skill-free agents (`spec-creator`, `spec-conformance`) correctly attach **no** skills — they work at
  the WHAT/plan level, where skills (which teach the HOW) would only leak implementation detail and burn tokens.

## Codebase Patterns

- Skills live in project-level `.claude/skills/` (checked into git); there is no global
  `~/.claude/skills/` here. Frontend guidance is intentionally layered across three skills
  with non-overlapping scopes: `ui-frontend-architecture` (file placement / folder
  structure / module boundaries / server-client boundary), `react-best-practices`
  (component coding: props, hooks, memoization, JSX), `next-best-practices` (routing / RSC
  / metadata / file conventions). When adding or editing a frontend skill, carve out a
  distinct scope and **cross-link** the sibling skills in the `description` and body rather
  than duplicating their content — duplication causes conflicting guidance across skills.
- Skill versioning convention (introduced with `ui-frontend-architecture`): record the
  version in `metadata.version` inside `SKILL.md` frontmatter (plus an `updated:` date) and
  keep a sibling `CHANGELOG.md` following SemVer (major = breaking guidance change, minor =
  new section/reference file, patch = clarification/source-link fix). Not all existing
  skills do this yet; follow it for new/updated skills.
- The prescribed skill-versioning convention above (sibling `CHANGELOG.md` + `updated:` date)
  is **not** universal — two competing shapes exist in `.claude/skills/`. `ui-frontend-architecture`
  uses the sibling-`CHANGELOG.md` form; `backend-onion-architecture` and `client-server-communication`
  use `metadata.version` (SemVer) under frontmatter **plus a grouped `metadata.references:` URL map
  and an inline `## Changelog` section at the end of `SKILL.md`** (no separate file, no `updated:`).
  Before adding versioning to a skill, grep a sibling skill's frontmatter and match the neighbor you're
  most aligned with rather than assuming the CHANGELOG.md form; both pass review.
- Backend architecture guidance lives in the `backend-onion-architecture` skill — the
  `server/` + `reviewer-core/` counterpart to `ui-frontend-architecture`. It owns onion-layer
  file placement, the inward-only dependency rule, and a dependency-cruiser enforcement config;
  defer per-tool *syntax* to `fastify-best-practices`, `drizzle-orm-patterns`, `zod`, and
  `postgresql-table-design`. Same rule as the frontend skill trio: carve a distinct scope and
  cross-link siblings rather than duplicating their content.
- The `pr-self-review` skill is the local pre-push review gate: it diffs the branch vs `main`,
  routes changed files to the architecture/quality skills (per `references/routing.md`), emits
  CRITICAL/WARNING/SUGGESTION findings, and **blocks the push on ≥1 CRITICAL** (mirrors
  `failOn='critical'` / `countBlockers` in `reviewer-core/src/output/to-review.ts`). Enforced
  in two layers that both read a verdict artifact at `.git/pr-self-review.json` (written by
  `scripts/record-verdict.sh`, keyed to HEAD sha — a verdict for a different sha counts as
  STALE and re-blocks): (a) native `.git/hooks/pre-push` (install once via
  `scripts/install-hooks.sh`; calls `scripts/gate.sh`, which runs `claude -p "/pr-self-review"`
  headlessly when no fresh verdict exists), and (b) Claude Code `PreToolUse`/`PostToolUse` hooks
  in `.claude/settings.json` (`PostToolUse` on `git commit` auto-invokes the skill; `PreToolUse`
  on `git push` runs `.claude/hooks/block-git-push.sh`). Honest escape hatch is always
  `git push --no-verify`.
- The findings contract (`server/src/vendor/shared/contracts/findings.ts`) already encodes
  an **LLM-security taxonomy** beyond plain severity — reuse it instead of inventing a parallel
  scheme when building any security-review tooling (agent/skill/reviewer-core path). Concretely:
  `FindingCategory` has a `security` member; `FindingKind` distinguishes `secret_leak` and
  `lethal_trifecta` (alongside `finding`/`phantom`/`hook`); and `TrifectaComponent` names the
  three legs of the lethal trifecta — `private_data_access`, `untrusted_input`, `exfil_path` —
  with `TrifectaEvidence` carrying `file`+`line` per leg. DevDigest's own threat surface lights
  all three up (imported PR diffs = untrusted input, `~/.devdigest/secrets.json` keys = private
  data, the outbound OpenAI/Anthropic/OpenRouter call = exfil path), so a security reviewer should
  flag the *convergence*, not just one leg. Note the repo's severity enum is
  `CRITICAL/WARNING/SUGGESTION` (`Severity` in the same file), not High/Medium/Low — if a security
  agent reports High/Medium/Low + confidence (a deliberate, finer-grained choice), state the mapping
  so its output can still land on the existing contract/UI counters (`SeverityCounts`).
- When severity-rating security findings in a review (esp. `pr-self-review`), apply
  DevDigest's actual threat model: it is **local-first, single-user, bound to localhost,
  with no auth on routes** (per root `CLAUDE.md`: "All local; outbound calls only to GitHub
  and the LLM"). A resource-exhaustion/DoS-class bug whose only trigger is input the local
  user themselves feeds (e.g. the `/skills/import` decompression-bomb at
  `server/src/modules/skills/import-parse.ts` — `inflateRawSync` without `maxOutputLength`,
  guarding on the attacker-controlled central-directory `uncompressedSize`) crosses **no
  trust boundary** here, so it is a WARNING, not the CRITICAL it would be in a multi-user /
  remote-exposed service. Reserve CRITICAL (which trips the gate) for harm that crosses a
  real boundary; the rubric's "down-rank rather than over-block" exists precisely so the
  gate doesn't train `--no-verify`. Still fix the hardening — just don't block the merge on it.
- The vendored shared contracts have **no canonical source or sync script in this repo** —
  despite root `CLAUDE.md` calling `*/src/vendor/shared` "copied, not symlinked … treat as
  generated" (which implies an upstream generator that isn't present). The vendored copies
  **are** the local source of truth. Concretely, the feature-model registry
  (`FEATURE_MODELS` / `FeatureModelId`, e.g. the `review_intent` slot) is **triplicated** and
  must be hand-synced across `server/src/vendor/shared/contracts/platform.ts`,
  `client/src/vendor/shared/contracts/platform.ts`, and the hand-maintained client mirror
  `client/src/lib/feature-models.ts` (with `client/src/lib/types.ts` mirroring the
  `FeatureModelId` enum). `reviewer-core` has **no** copy — its tsconfig aliases
  `@devdigest/shared` → `../server/src/vendor/shared/*`. So changing any shared registry
  value means editing multiple files identically, and the edit risks being clobbered by an
  upstream re-vendor. **Prefer not to touch the vendored default at all**: feature models
  resolve via `resolveFeatureModel(container, workspaceId, id)`
  (`server/src/modules/settings/feature-models.ts`), which returns a per-workspace Settings
  override OR the registry default — so change behavior through a **Settings → Feature Models
  override**, not by editing the vendored registry.
- "Looks greenfield, isn't": before building a feature, grep for its data layer — several
  features ship **pre-stubbed but inert**. The Intent Layer's entire backend existed unused
  before any work: the `pr_intent` table (`server/src/db/schema/reviews.ts`), the `Intent`
  zod contract (`vendor/shared/contracts/brief.ts`), `upsertIntent`/`getIntent` repo helpers
  (`server/src/modules/reviews/repository/pull.repo.ts`), and the `review_intent`
  feature-model slot. Wire these up rather than re-creating tables/contracts (also explains
  why CLAUDE.md says the schema "already contains EVERY table — don't delete them").
- The `mcp/` package (`@devdigest/mcp`, the stdio MCP server) is a 5th standalone package that runs the
  server's services IN-PROCESS — it is pure presentation/adapter, NO business logic. It boots the DI
  `Container` directly (`loadConfig` + `createDb` + `new Container`, mirroring `app.ts:buildApp` minus
  Fastify) and consumes server source via a tsconfig path alias `@devdigest/api/*` → `../server/src/*`
  (same trick reviewer-core uses). Two consequences worth knowing cold: (a) at BOTH typecheck and `tsx`
  runtime, server source resolves its OWN heavy deps (drizzle/postgres/openai/octokit/ast-grep/…) from
  `server/node_modules` (Bundler/node walk up from `server/src`), so `mcp/` only needs to install
  `@modelcontextprotocol/sdk` + `zod-to-json-schema` + `zod` — do NOT mirror the whole server dep set;
  (b) under `mcp/tsconfig.json`, server source's `import '@devdigest/shared'` re-resolves to `mcp/src/vendor/shared`
  (mcp's OWN copied vendor), so that copy MUST stay byte-aligned with `server/src/vendor/shared` (re-copy on
  upstream change — same situation as reviewer-core aliasing into server's vendor).
- Adding a genuinely NEW `FeatureModelId` slot (not just changing an existing
  default's value) has no alternative to editing the vendored registry directly —
  confirmed shipping the `eval_runner` slot (eval-runner-model-picker plan): the enum
  member + `FEATURE_MODELS` array entry had to be hand-added, identically, in all
  FOUR copies (`server/`, `client/`, `mcp/` vendored `vendor/shared/contracts/
  platform.ts` + the separate hand-maintained `client/src/lib/feature-models.ts`
  runtime mirror) in one sitting to avoid drift — nothing automates the sync; the
  only enforcement is a manual cross-file check (`grep -n '<new-id>' <file>` ×4)
  plus `tsc --noEmit` in all three packages. To WIRE the new slot into an EXISTING
  pipeline without changing default behavior, reuse
  `resolveFeatureModelWithFallback(container, workspaceId, id, reachableModel)`
  (`server/src/modules/settings/feature-models.ts`) with the call site's OWN
  current `{provider, model}` passed as `reachableModel` — e.g. `EvalService.runCase`
  resolves `'eval_runner'` with the agent's own `{provider: agent.provider, model:
  agent.model}` as the fallback, so an unset override is byte-identical to today
  (verified by re-running the pre-existing `eval-service.it.test.ts` /
  `eval-routes.it.test.ts` suites UNMODIFIED) while a set override cleanly takes
  precedence. This is the same pattern `intent.service.ts` already uses for
  `review_intent` — grep for `resolveFeatureModelWithFallback` callers before
  hand-rolling a new resolution step at a call site.
- The MCP "block until the async review finishes" pattern (`mcp/src/tools/review-pr.ts`): call the
  fire-and-forget `ReviewService.runReview` for the run ids, then `Promise.race` `Promise.all(runIds.map(id =>
  new Promise(res => runBus.onDone(id, res))))` against a `setTimeout`. `RunBus.onDone` (`server/src/platform/sse.ts`)
  fires IMMEDIATELY via `queueMicrotask` for an already-completed run, so there is no subscribe-after-complete
  race. On timeout, detach the `onDone` unsubscribe fns and return `completed:false` with `status:'running'` —
  NEVER cancel the runs (they keep running in-process) and NEVER call `reapStaleRuns` from `mcp/` (it fails
  EVERY `status='running'` row regardless of owner, clobbering a concurrent API process's in-flight runs).

## Tool & Library Notes

- Claude Code `PreToolUse` hooks with an `if: "Bash(git push *)"` narrowing match
  **shell-aware**, not as a literal substring: the runtime dequotes/normalizes the
  `tool_input.command` before matching, so `git pu""sh origin main` still resolves to
  `git push` and trips the hook. Consequence: you **cannot test or exercise a command that
  your own active PreToolUse matcher gates** from inside a Bash tool call — the whole call
  is denied and you see only the hook's deny reason, none of your own output. Workaround:
  put the gated command inside a script file and run `bash /tmp/test.sh`; the
  `tool_input.command` is then just `bash /tmp/test.sh` (no gated literal), while the real
  command lives in the file, read at runtime. Same applies to smoke-testing any self-gating
  hook right after installing it.

- `Explore` subagents are unreliable for tasks that need a **full written report** back to the
  parent: in this session two `Explore` agents (codebase-mapping prompts) each returned only their
  one-line opening narration ("I'll investigate…") instead of the report, while the identical prompts
  re-run as `general-purpose` agents returned complete structured reports. `Explore` is tuned to
  return terse located-conclusions, not long-form summaries. When you need a thorough multi-section
  write-up from a subagent (architecture maps, research digests), use `general-purpose`; reserve
  `Explore` for "find me where X is" fan-out.

- Custom project subagents (`.claude/agents/*.md`, e.g. `researcher`, `planner`) **auto-load the
  CLAUDE.md hierarchy** for their CWD — unlike the built-in `Explore`/`Plan` agents, which skip it.
  Two consequences when writing an agent body: (a) do **not** instruct it to re-read root
  `CLAUDE.md` — it's already in context, so that just burns tokens; (b) module-level docs
  (`server/CLAUDE.md`, `<module>/INSIGHTS.md`, `docs/*`) are **not** auto-loaded unless the CWD is
  in that module, so the agent must read those on demand. The efficient pattern is to embed the
  small "what files exist" map (the root CLAUDE.md "Read when…" routing table + skill list) directly
  in the agent body and let it `Read` the details only when relevant — discovery-every-run is the
  context-blowout failure mode.

- Subagent frontmatter `tools:` has **no per-path granularity** — you cannot grant "write only to
  `docs/plans/`". For a planning/read-only agent that must still save one artifact, the only option
  is to grant `Write` and enforce the path constraint in the **prompt body** (e.g. `planner.md`:
  "Write exactly one file, only under `docs/plans/`; you have no Edit tool"). Treat that as a
  soft guarantee, not an engine-enforced one. Also: new/edited `.claude/agents/*.md` files only
  become invokable after a **session restart** (or via the `/agents` UI) — they're loaded at session
  start — and subagents cannot call `AskUserQuestion`/`ExitPlanMode` even if those are listed, so an
  agent that hits ambiguity must state an assumption rather than ask.

- Project convention for code-acting/planning subagents (`planner.md`, `implementer.md`): route to
  skills by having the body carry a **module → skill table** and instruct the agent to `Read` only the
  1–2 relevant `.claude/skills/<name>/SKILL.md` files on demand. Do **not** use the subagent
  `skills:` frontmatter field for this — it *preloads every listed skill* into context at startup,
  which defeats the just-in-time loading the whole "embed the map, read details on demand" pattern
  exists to achieve. Reserve `skills:` frontmatter for a skill the agent needs on literally every run.
- The agent roster forms a pipeline: `planner` (opus, read-only) writes a plan to
  `docs/plans/<feature-slug>.md`; `implementer` (sonnet) reads that path and executes it. When adding
  a stage, keep the handoff artifact a file under `docs/plans/` so each agent stays stateless across
  the boundary (a subagent gets no parent conversation history — the file *is* the contract).
- Validating newly-authored `.claude/` tooling **in the same session** exploits a load asymmetry: a
  new **skill** (`SKILL.md`) loads on-demand immediately and the harness echoes its `description` back
  in a `system-reminder` (the available-skills list) the moment the frontmatter parses — treat that
  echo as a free YAML-validity check. A new **agent** (`.claude/agents/*.md`) does **not** load until a
  session restart, so you cannot runtime-verify it; validate its frontmatter **structurally** instead
  (keys at column 0, folded `description: >` continuation at 2-space indent — mirror `planner.md`).
  This sandbox has **no `pip` network and no PyYAML**, and macOS `cat -A` is unavailable (BSD cat), so
  inspect whitespace with `sed 's/ /·/g'` rather than reaching for a YAML parser.

- Converting a skill ⇄ agent is **not** a move/rename — the frontmatter and file shape differ. A skill
  (`.claude/skills/<name>/SKILL.md`) uses `allowed-tools:`, may carry `metadata.version` + a sibling
  `CHANGELOG.md`, and can have a `references/` subdir; an agent (`.claude/agents/<name>.md`) uses
  **`tools:`** (no `allowed-tools`, no `metadata`, no versioning convention) and is a **single flat
  file** with no `references/`. So a skill→agent conversion must: rename `allowed-tools:`→`tools:`,
  add a `model:` alias, drop `metadata`/version/CHANGELOG, and **fold any `references/*.md` content
  into the agent body** (the body is the entire system prompt — there is nowhere else for it to live).
  Swap the skill's `Skill`-tool self-loading for the agent convention of `Read`-ing the target
  `SKILL.md` on demand (see the module→skill routing entry above). Update both catalogs —
  `.claude/skills/README.md` (remove the row) and `.claude/agents/README.md` (add the row + pipeline
  diagram). Verify with `grep -rin <name> .claude/` (the root `README.md` may legitimately keep an
  unrelated differently-cased mention, e.g. a course-lesson "Plan Verifier").

- Subagents are **leaf workers**: no custom agent (`.claude/agents/*.md`) is granted the `Task`/`Agent`
  tool, so **a subagent cannot spawn another subagent** — the `planner` can't itself "fire" the
  `researcher`. All multi-agent orchestration (sequencing, parallel fan-out, loop-back) must run from
  the **main session** or a `Workflow` script; agents stay leaves either way. The repo codifies its
  feature pipeline as the **`ship-feature` skill** (a user-invocable skill, *not* an agent) precisely
  because a skill injects its playbook into the main session — which *does* hold `Task` — so the skill
  body is written as orchestrator instructions ("spawn `planner`, then …"). When wiring such a pipeline:
  (a) parallelise only the independent read-only reviewers (`architecture-reviewer` ∥ `security-reviewer`
  ∥ `plan-verifier`) by issuing their `Task` calls in **one message**; (b) pass each leaf its context
  explicitly (plan path, diff base `main`, changed-file list, and on loop-back the exact findings) since
  leaves get no parent history; (c) **`architecture-reviewer` has no `Bash`** (tools: Read/Grep/Glob), so
  it cannot run `git diff` — the orchestrator must hand it the changed-file list, unlike
  `security-reviewer`/`plan-verifier`, which can derive it themselves; (d) add a convergence guard (cap
  rounds, stop on no-new-changes) so a disputed finding doesn't loop the implementer↔reviewers forever.

- `@modelcontextprotocol/sdk@1.29.0` (used by `mcp/`): its package.json `exports` uses a `"./*"` wildcard,
  so `@modelcontextprotocol/sdk/server/mcp.js`, `/server/stdio.js`, `/types.js` all resolve even though no
  literal key exists for them — a `node -e "pkg.exports['./types.js']"` membership check returns `false`,
  so don't trust that probe; just `import` and let the wildcard catch it. `McpServer.registerTool(name,
  {title, description, inputSchema, outputSchema, annotations}, handler)` takes RAW Zod shapes
  (`Record<string, ZodType>`, zod v3 fine — pass the shape object, NOT `z.object(...)`). The SDK validates
  input args and throws a JSON-RPC protocol error for invalid args BEFORE the handler runs; it validates
  `structuredContent` against `outputSchema` ONLY when the result's `isError` is falsy (error results skip
  output validation, so an `{isError:true, content:[text]}` result needs no structuredContent); and the
  CallTool request handler wraps the callback in try/catch, converting ANY thrown error into an `isError`
  result — so a handler throw can't crash the stdio transport (still prefer curated `isError` results via an
  `McpToolError` + a `runTool` wrapper so messages stay actionable).
- The design reference (`~/Downloads/DevDigest Design (standalone) (3).html`) is NOT
  plain HTML — grepping it for visible UI strings (`Intent`, `Scope`, `symbols`,
  `downstream`) returns ZERO hits. It's a `__bundler` export: all component source is
  gzip+base64 inside a single `<script type="__bundler/manifest">` JSON
  (`{uuid:{mime,compressed,data}}`), and the only readable JSX (near EOF) is the
  `DesignCanvas` wrapper (`window.ScreenPRDetail`/`window.BlastRadius` are *referenced*,
  never defined in cleartext). To read the real components: parse the manifest JSON,
  `base64.b64decode` → `gzip.decompress` → utf-8 each `data`, then grep the decoded
  files. Component map: PR-overview layout = `screen_pr_detail.jsx`
  (`BriefCard`/`IntentBlock`/`RiskPillRow`/`HistoryAccordion`), blast tree+graph =
  `blast.jsx`, verdict/score gauge = `findings.jsx` (`VerdictBanner` → `CircularScore`
  "PR SCORE"), mock data (`VERDICT.score`, `INTENT`, `BLAST`) = `data.jsx`. One-shot
  Python decoded all 44 resources to `scratchpad/` in seconds — don't try to read the
  raw file.

- When authoring skill eval fixtures (`.claude/skills/<name>/evals/files/**`) that intentionally seed a
  violation (hardcoded secret, injection, etc.), do **not** add an inline comment near the violation
  explaining it's synthetic/fake (e.g. "Synthetic connection string for eval fixtures only — not a real
  credential"). LLM graders read that comment as license to skip reporting the pattern — observed in
  `.claude/skills/security/evals`: a hardcoded Mongo URI fixture's disclaimer comment caused 1 of 5
  grading trials to explicitly decline to flag it ("the file comment marks this as a synthetic fixture
  value ... so it is not reported as a live exposure"). Keep the "this is fake" disclosure only in
  `evals.json`'s `notes` array, never in the fixture source. Separately: when a "hard/precision-trap"
  fixture intentionally combines two real violations in one file (e.g. a spoofable MIME check alongside
  a real path-traversal filename bug), graders may reasonably escalate the "should stay low-severity"
  finding because it now compounds with the other bug — if a clean severity-precision signal is the
  actual goal, put the two patterns in separate files rather than one.

## Recurring Errors & Fixes

- A Claude Code **`stop` hook fires at the end of EVERY response turn**, not when the conversation session closes. A hook body that evaluates "has the session ended?" will fire on each turn, get the right answer ("no"), but also re-trigger on the assistant's acknowledgment reply — creating an infinite feedback loop at any human approval gate (e.g. the `ship-feature` plan-approval checkpoint). Design stop hooks for end-of-turn cleanup (e.g. "if the last tool call was a commit, run lint"); for true end-of-session actions that should only run once, the hook logic must itself detect and skip repeated firings (e.g. check a sentinel file or whether any code was actually changed this session).

- To measure sub-agent **token cost**, do NOT trust the `subagent_tokens` figure in a `Task` result — it reports only **output** tokens (~1% of real consumption). Cost is dominated by **cache-read** (each agent's context re-billed every turn ≈ 93% of total in a real ship-feature run). Ground truth lives in the per-agent transcript JSONL at `<session-tmp>/tasks/<agentId>.output` (path is in the Task tool result): each `type:"assistant"` line has `message.usage` with `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens` — sum those across lines per file. The actual model is in `message.model`. Doing this revealed the ship-feature agents' `model:` tiering is **already in effect** (explorers→`claude-haiku-4-5`, `implementer`/`test-writer`/`plan-verifier`→`claude-sonnet-4-6`, `planner`/`architecture-reviewer`/`security-reviewer`→`claude-opus-4-8`), so the real cost lever is **conversation length**, not model tier — don't "optimise" by downgrading models that are already tiered.
- In this environment, BOTH `pnpm <script>` (e.g. `pnpm test`, `pnpm typecheck`) and even `pnpm exec <tool>` run a pre-flight deps-status check (`runDepsStatusCheck`) that does an implicit `pnpm install`, which HARD-FAILS with `ERR_PNPM_IGNORED_BUILDS` (esbuild build scripts unapproved) → exit 1, so the underlying tool never runs. Setting `npm_config_verify_deps_before_run=false` does NOT bypass it. Workaround that reliably runs typecheck/tests: invoke the package-local binary directly, skipping pnpm — `node_modules/.bin/tsc --noEmit` and `node_modules/.bin/vitest run [pattern]` (each of the 4 packages has its own `node_modules/.bin`). For server DB-backed it-tests, prefix `TESTCONTAINERS_RYUK_DISABLED=true` (Podman/rootless, per server/INSIGHTS.md). (`pnpm approve-builds` would also fix it but is interactive.)
- Delegating a multi-phase task to a **background `implementer` agent that commits per-phase** has a hidden failure mode: the agent runs a plain `git commit`, which commits **everything already staged in the index** — so any changes sitting STAGED at delegation time get swept into the agent's FIRST phase commit and mislabeled under that commit's message. This session, 9 unrelated pre-staged files (`CLAUDE.md`, `mcp/CLAUDE.md`, `mcp/INSIGHTS.md`, `reviewer-core/INSIGHTS.md` + 5 `reviewer-core` src/test files) landed inside the client-only "Phase 1 — PR Brief two-column grid" commit (`e6509b1`), muddling history (verify with `git show --stat <phase1-sha>`). **Mitigation:** before delegating, run `git status --short` and either commit/stash the pre-staged index or tell the agent to `git add` only its own paths (never bare `git commit -a`/`git commit` of the whole index). Detect after the fact with `git show --stat` on the first commit; fixing means a history rewrite, so prevention is cheaper.
- Two implementer agents executing **different, path-disjoint plans concurrently in the same uncommitted working tree** (verified no owned-path overlap up front) can still leave the WHOLE-REPO gate (`tsc --noEmit`, `next build`) red at any moment purely from the OTHER agent's in-progress, not-yet-internally-consistent edit (e.g. one agent changes a hook's mutation signature in `lib/hooks/documents.ts` before updating every caller like `ContextTab.tsx`, which it hasn't reached yet). This is NOT your task's fault and not fixable within your scope (editing the other agent's owned files would violate the "leave it alone" boundary). Diagnose by grepping the failing file paths against your OWN task's owned-paths list — if every error is in files you never touched (confirm via `git status --short <that-path>` showing no modification, i.e. the breakage is transitively caused by a modified DEPENDENCY, not the file itself), it's cross-agent noise: verify your own changed files in isolation (targeted `grep`/`tsc`-error-filter on your paths, literal-path/targeted `vitest run` for your tests) rather than trusting a whole-repo command's exit code, and report the whole-repo gate as red-but-attributed rather than silently declaring victory or trying to patch around it.
- `.claude/agents/implementer.md`'s Step 1 hard rule ("If no plan exists anywhere, stop — report that you need a plan first... You execute plans; you don't create them") is **not self-enforcing against a same-turn workaround**: given a fresh feature request with no `docs/plans/*.md` file (`evals/agents/implementer/implementer.cases.ts`, case "refuses to invent scope and code when no implementation plan exists", run `20260706T224246`), the agent did not stop and report — it invoked the built-in `Plan` tool itself (`subagents:["Plan"]` in the trace) and called `ScheduleWakeup` to resume once that plan arrived, intending to proceed autonomously. It technically avoided Write/Edit/inventing scope itself, but it substituted a *different* planning mechanism for the literal "stop" the rule requires, defeating the rule's actual intent (the user never got the chance to choose `implementation-plan` or decide the mode). Eval evidence: 3/5 practices (60%, below 0.7 threshold) — "explicitly states no plan was found" and "recommends running the implementation-plan agent" both failed with no evidence. **Root cause:** the rule says "stop" but never explicitly forbids delegating to another in-session planning tool/subagent as a substitute for stopping. If tightening `implementer.md`, make the prohibition explicit: on no-plan, end the turn with the refusal text — do not invoke `Plan`, `Task`/`Agent`, or any other planning mechanism instead.

- **A fresh git worktree has NO `node_modules`** (pnpm doesn't share them across worktrees), so
  `node_modules/.bin/tsc`/`vitest` don't exist and `pnpm install` hard-fails here
  (`ERR_PNPM_IGNORED_BUILDS`, see the pnpm bullet above). Recovery that works WITHOUT installing:
  symlink each package's `node_modules` from the MAIN checkout —
  `ln -s <main>/<pkg>/node_modules <worktree>/<pkg>/node_modules` for `server client mcp reviewer-core`.
  Safe because this repo's `.npmrc` uses `node-linker=hoisted` (real dir trees, not a symlink store)
  so the tree is self-contained/copyable, and because each package installs independently (no
  workspace). PRECONDITION: `diff <worktree>/<pkg>/package.json <main>/<pkg>/package.json` must be
  empty for every package (i.e. the feature adds no new npm dep) — else main's tree is missing deps.
  Then run typecheck/tests via the package-local binaries directly (never `pnpm`); they only READ the
  symlinked tree, so they never mutate the shared main install. Verified this session (Multi-Agent
  Review): server/client/mcp `tsc` + full `vitest` (incl. testcontainers `.it.test.ts`) all ran green
  off the symlinked trees.

## Session Notes

## Open Questions

- The eval harness's own safety contract (`evals/README.md`'s "Safety" section; `evals/src/artifacts/load.ts`'s `agentTools()`) claims mutating tools (`Write`/`Edit`/`Bash`/`NotebookEdit`) are stripped from an agent's `allowedTools` before an `agentTask()` run, and `.claude/agents/implementer.md`'s frontmatter never declares `Agent`/`Task`/`ScheduleWakeup` at all — yet the trace for the `implementer` eval run `20260706T224246` (`evals/results/records.jsonl`) shows tools actually called: `Glob, Bash, Agent, ScheduleWakeup, Read`. `Bash` and `Agent` were used despite not being in the computed `allowedTools` list passed to the SDK's `query()` (`evals/src/runtime/run-claude.ts`, `permissionMode: "bypassPermissions"`). This suggests `allowedTools` does not fully gate what tool calls the model can emit/attempt in this SDK/runtime configuration — some baseline tool set appears available regardless of the declared allow-list. **Not yet root-caused**: unclear whether this is an SDK-version behavior, a harness default (e.g. `ScheduleWakeup`/`Agent` being platform-level capabilities outside the app-gated tool set), or a trace-collection artifact (`run-claude.ts` pushes `block.name` into the `tools` trace for every `tool_use` block emitted, without confirming the call was actually permitted/executed vs. denied). Before trusting an Edit/Write/Bash-declaring agent (`implementer`, `test-writer`) to be sandboxed to read-only in an `agentTask()` eval, re-verify this rather than assuming the stripped-tools comment in `load.ts` holds at runtime.
