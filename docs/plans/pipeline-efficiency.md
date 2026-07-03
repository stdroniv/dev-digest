# Plan — ship-feature pipeline efficiency improvements

> **Status: superseded / landed.** The cost-discipline guidance below shipped in
> ship-feature **v1.1.0** (see `CHANGELOG.md`) and the incremental-write instruction
> now lives in the planning agent. **Naming note:** the `planner` agent named
> throughout was later renamed to **`implementation-plan`**
> (`.claude/agents/implementation-plan.md`). Historical telemetry below is preserved
> **as-recorded** — at the time of the Intent Layer run the agent was named `planner`,
> so those references are intentionally *not* rewritten.
>
> _Original scope: `.claude/` tooling only (skill + agent definitions). No application
> code, migrations, or tests affected._

## Why (grounded in the Intent Layer run's actual telemetry)

Parsed from the per-agent transcripts of the Intent Layer build (10 sub-agent
invocations, 907 assistant turns, **66.0M raw tokens**):

- **Cache-read = 93% of all tokens (61.6M).** This is each agent's context
  re-billed on *every* turn, so cost scales with **conversation length × live
  context size**, not with code produced. The `subagent_tokens` shown in a result
  is only *output* (202K total) — it hides ~99% of real consumption.
- **Model tiering already exists and works** (correcting an earlier mis-analysis):
  explorers ran on **Haiku**, `implementer`/`test-writer`/`plan-verifier` on
  **Sonnet**, `planner`/`architecture-reviewer`/`security-reviewer` on **Opus**
  (verified from the `model` field in each transcript; agent `model:` frontmatter
  already nearly matches the "recommended split"). **So model tier is NOT the open
  lever** — conversation length, wasted work, and orchestration churn are.
- **Biggest concrete waste:** `planner` dropped its connection twice and produced
  nothing usable (~8.6M raw, ~26 min, on Opus); the plan was ultimately written
  inline from the exploration output.
- **Cache-read concentrates in the long-running agents:** `implementer` 288 turns
  (28.7M), `test-writer` 112 turns (10.1M), `plan-verifier` 98 turns across two
  rounds (5.5M). Re-validation often re-did full work (`plan-verifier` rebuilt its
  entire 15-row matrix; `security-reviewer`, given a scoped re-check, used 4 turns).
- **Main-session churn:** the stop-hook "session incomplete" loop re-invoked the
  **main** session (Opus, large context) ~15× while waiting, plus avoidable
  progress-polling — none of it in the sub-agent totals but real, expensive cost.

## Corrected lever priority (what this plan targets)

1. **Eliminate wasted agent runs** (the planner double-drop). Highest ROI.
2. **Shrink cache-read** by keeping agent conversations short and contexts lean
   (split big implementations, front-load exact files, scope re-validation).
3. **Cut main-session orchestration churn** (no polling; fewer re-entries).
4. **Lean exploration** (lower priority — already on cheap Haiku).
5. **Model tier**: already aligned; the only candidate change is `plan-verifier`
   (see Risk #1) — and it leans *against* the efficiency goal.

---

## Changes (ordered)

### 1. `SKILL.md` — add a "Cost & robustness discipline" section
Add a new section to `.claude/skills/ship-feature/SKILL.md` codifying these
orchestrator rules (they are guidance the main session must follow — soft, not
engine-enforced, like the planner's "write only to docs/plans" rule):

- **One-retry-then-DIY for dropped agents.** If a long single-shot agent (esp.
  `planner`) drops its connection, resume it **at most once**; if it drops again,
  the orchestrator writes the artifact directly from already-gathered context
  rather than burning a third resume. *(Directly prevents the ~8.6M/26-min waste.)*
- **Split large implementations by layer.** When a feature spans **>1 package**
  (`reviewer-core` / `server` / `client`) or **roughly >15 files**, spawn focused
  per-layer `implementer` tasks (or sequential focused calls) instead of one
  mega-run — cache-read grows super-linearly with turn count, so three ~100-turn
  agents ≪ one ~300-turn agent. Below the threshold, keep a single run (splitting
  re-pays base-context load per agent + handoff cost).
- **Keep agent contexts lean.** Hand each agent the **exact file list / paths**
  (the orchestrator already computes the changed-file set) so it spends turns
  acting, not discovering. Tell `implementer`/`test-writer` to run the heaviest
  verification (full suites) as a **final** step and not re-dump large tool output
  mid-run — every dumped log is re-billed on all subsequent turns.
- **Scope re-validation tightly.** On loop-back, re-run reviewers with "confirm
  **only** these findings on these changed files," never a full re-review. Cite
  the contrast: scoped `security-reviewer` re-check = 4 turns; unscoped
  `plan-verifier` re-check rebuilt the whole matrix = far more.
- **Lean exploration.** Prefer **1–2 broader explorers** (or pass a shared file
  list to avoid each re-reading the same files) over many overlapping ones.
  Lower priority — explorers run on Haiku.
- **Don't poll background agents.** Completion notifications fire automatically;
  avoid repeated status-checking Bash calls and minimise main-session re-entries
  (the orchestrator's own context is the most expensive to re-bill).
- **Model overrides.** Per-agent `model:` is already set; the orchestrator should
  override via the `Task` `model` param **only** to escalate `implementer` to
  `opus` when the plan flags genuinely hard/ambiguous work (default stays Sonnet).

*Acceptance:* the section is present and the skill's frontmatter still parses (the
harness echoes the skill `description` in the available-skills `system-reminder` —
a free YAML-validity check on reload).

### 2. `agents/planner.md` — incremental-write robustness
Add an instruction to the planner body: **write the plan to its `docs/plans/<slug>.md`
file incrementally** — create the file with a skeleton/outline early and fill
sections, rather than composing the entire document in one final write — so a
mid-generation connection drop leaves a partial artifact to resume from instead of
nothing. *(Addresses the observed double-drop root cause.)*
*Acceptance:* structural frontmatter still valid; body instruction present. (Cannot
runtime-test — see Risk #2.)

### 3. `agents/plan-verifier.md` — model — **DECIDED: keep `sonnet` (no change)**
Resolved at the approval gate: leave `plan-verifier` on `sonnet`. It performed
correctly there (caught the B1 gap) and was a top-3 consumer, so keeping it Sonnet is
the cheaper, efficiency-aligned choice. **No edit to this file.**

### 4. Frontmatter audit — confirm the rest is already aligned (no-op)
State explicitly (no edits): `planner`/`architecture-reviewer`/`security-reviewer` =
`opus`; `implementer`/`test-writer`/`doc-writer`/`researcher` = `sonnet`; explorers =
Haiku (built-in `Explore` default). These already match the recommended split — no
changes needed. This audit is a deliverable, not a code change.

### 5. `agents/README.md` — short model-rationale + cost-discipline note (optional)
Add a brief note documenting the per-agent model tiers and cross-linking the new
SKILL.md "Cost & robustness discipline" section, so the rationale is discoverable.
Skip if we want to keep the change minimal.

### 6. Versioning
Bump `.claude/skills/ship-feature/SKILL.md` `metadata.version` **1.0.0 → 1.1.0** and
`updated:` to today; add a `## [1.1.0]` entry to the sibling `CHANGELOG.md` (the
skill already follows Keep-a-Changelog + SemVer) summarising the new discipline
section. Minor bump = new section/guidance, no breaking change.

---

## Risks / open questions

1. **`plan-verifier` model — RESOLVED: stays Sonnet.** Decided at the gate (cheaper
   and it performed correctly on Sonnet). No change to the agent.
2. **Agent edits can't be validated this session.** New/edited `.claude/agents/*.md`
   load only at **session restart** (per `agents/README.md` + root `INSIGHTS.md`), so
   acceptance for agent changes is **structural frontmatter review only**, not a live
   run. The SKILL.md change *can* be validated on reload via the description echo.
3. **"Split by layer" is a heuristic, not a law.** Over-splitting small features
   wastes base-context reloads + handoffs. The threshold (>1 package / ~>15 files)
   must stay in the guidance so the orchestrator doesn't over-fragment.
4. **Guidance ≠ enforcement.** These are rules the orchestrator must *choose* to
   follow; nothing in the engine enforces them. They reduce expected cost, not
   guarantee it.

## Anticipated changed-file set
- `.claude/skills/ship-feature/SKILL.md` — new "Cost & robustness discipline" section + version/`updated` bump
- `.claude/skills/ship-feature/CHANGELOG.md` — `[1.1.0]` entry
- `.claude/agents/planner.md` — incremental-write robustness instruction
- `.claude/agents/plan-verifier.md` — `model` change *(only if Risk #1 resolves to Opus)*
- `.claude/agents/README.md` — model-rationale / cost-discipline note *(optional)*

**No application code, tests, or migrations touched.** No `node_modules` / build
involvement, so no typecheck/test run applies; validation is frontmatter parse +
the skill description echo on reload.
