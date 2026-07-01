---
name: workflow-retro
description: "Post-mortem / retrospective for a multi-agent run in DevDigest. Run it AFTER a workflow finishes — `/ship-feature`, the spec → plan → implement chain, a `Workflow()` fan-out, or any batch of sub-agents — to turn how the run actually went into concrete change. Use whenever the user invokes `/workflow-retro`, or asks to 'retro this run', 'analyze that multi-agent run', 'how did that workflow go', 'what did that pipeline cost', 'why was that run slow/expensive', or wants lessons captured from a just-finished agent run. It reconstructs cost & resource metrics (tokens, cache-hit %, tool calls, durations, agent count *including nested*, launch order, parallelism), reflects on the run with a 4Ls lens (Liked/Learned/Lacked/Longed-for) under a blameless systems framing, and ends with 1–3 SMART, owned recommendations — each tagged by which living artifact to change (a CLAUDE.md/INSIGHTS.md, an agent brief, a ship-feature step, or a bug fix). Outputs a fixed-format report to chat and appends one trend row to docs/retros/ledger.md. Manual only — it is a read-only analyst: it never re-runs the workflow, never edits product code or agent/skill definitions, and must never be wired to a hook. Use it even when the user only says a run 'felt' slow, wasteful, or confusing — quantifying that and routing it to a fix is the whole point."
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
metadata:
  version: 0.1.0
  tags: retrospective, post-mortem, multi-agent, cost-analysis, tokens, cache-efficiency, ship-feature, 4Ls, blameless, continuous-improvement, ledger
  updated: 2026-07-01
---

# Workflow Retro — retrospective for a multi-agent run

Hand me a finished multi-agent run and I tell you what it cost, where it
struggled, what it wasted, and exactly what to change next time — then log a
trend row so runs can be compared over time.

**You are the analyst, running in the main session.** You reconstruct metrics and
*recommend* changes; **you do not re-run the workflow and you do not edit agent /
skill definitions or product code.** Your only file writes are the one ledger row
(below) and — *only when the user accepts a recommendation* — the loop-back edit in
Step 6.

## Manual only — never automatic

This skill runs **only when explicitly invoked** (`/workflow-retro` or a phrase
like "retro this run"). There is **no hook and there must never be one**: do not
wire it to a `Stop` / `SubagentStop` / `PreToolUse` event, do not chain it at the
end of another skill or workflow, and do not register it in `settings.json`.
A retro forced after every run is exactly the ceremony that breeds retro fatigue
and low-signal noise — the value is in running it deliberately, on a run worth
reflecting on. If you ever see it auto-triggering, that is a bug — stop and tell
the user.

## Blameless, systems-focused framing (read this first)

Frame the whole retro the way Google's SRE postmortem culture frames an incident:
**assume good intent and indict the system, not the agent.** A rough run is never
"the `implementer` screwed up." It is *what context was missing, what instruction
was ambiguous, what check was absent* that let the problem through. This is not
politeness for its own sake — it keeps every finding pointed at a **fixable
artifact** (a doc, a brief, a step, a check) instead of an unfalsifiable judgment
about a model. If a finding can't be phrased as "change X so the next run does Y,"
it isn't done yet.

## Count nested sub-agents (do not undercount)

The single easiest way to get the numbers wrong. A parent agent's in-context
`<usage>` block reports **only the parent's own tokens, not its children's**. One
observed run looked like "1 agent / ~75k" but was really **5 agents** — a
`spec-creator` plus 4 nested `researcher`s — at a far higher true total. In this
repo the upstream authoring agents (`spec-creator`, `implementation-plan`) *can*
delegate read-only lookups to `researcher` / `Explore`, so this is a live risk on
any `/ship-feature` run.

Journals are stored **flat** under `subagents/`, so a glob of `agent-*.jsonl`
already catches every agent at every depth; each journal has a sibling
`.meta.json` with `agentType`, `description`, and `spawnDepth` (1 = top-level,
>1 = nested). **Whenever the run used an agent that can spawn sub-agents — or you
are simply not sure — prefer `deep` mode, or at minimum state in the report that
the in-context totals exclude nested agents.**

## Inputs (args)

All optional, parsed from the invocation text (plain-text tokens, no schema):

| Token | Meaning | Default |
|-------|---------|---------|
| `label:<slug>` | Name for this retro | derived from the run / date |
| `deep` | Parse on-disk JSONL journals for exact metrics | off (in-context) |
| `session:<id>` | Which session transcript to analyse in deep mode | current session |
| `scope:last` / `scope:session` | Just the last batch, or every agent in the session | `last` |
| `no-ledger` | Print the report only, skip the ledger row | off |

If it's ambiguous **which** run to review (several batches ran this session),
**ask before analysing — do not silently pick.**

## Data sources — prefer the cheap one

1. **In-context (default, zero file reads).** Read the `Agent`/`Task` result
   `<usage>` blocks, the `<task-notification>`s (they carry `total_tokens` /
   `duration_ms`), the launch order and parallel-vs-serial dispatch, and the
   agents' final reports — all already in this conversation.
2. **Deep (`deep` flag).** Parse the JSONL journals with the bundled helper:
   ```sh
   python3 .claude/skills/workflow-retro/scripts/analyze_journals.py \
     "~/.claude/projects/<project-slug>/<session-id>/subagents/agent-*.jsonl" --json
   ```
   For this repo `<project-slug>` is `-Users-dronmac-Projects-personal-dev-digest`.
   The main-session journal is `~/.claude/projects/<project-slug>/<session-id>.jsonl`.
   Pass `--prices prices.json` (substring-keyed per-model rates) to get $ — and
   **do not hard-code prices; confirm current per-model rates via the `claude-api`
   skill first**, they go stale.

Use deep mode when the run had nested agents, when you need exact cache-creation
vs cache-read splits, or when the in-context view is incomplete (a backgrounded
agent whose full usage never surfaced). Otherwise the in-context view is enough.

## What to measure

Three buckets. **Mark anything unavailable as `n/a` rather than guessing — a
fabricated metric is worse than a missing one.**

- **Cost & resources.** Tokens (input / output / cache-read / cache-creation) per
  agent and total; **cache-hit % = cache-read ÷ total input-side tokens**; tool
  calls; wall-clock and **parallelism factor (Σ agent spans ÷ wall-clock)**;
  critical path (the agent that dominated wall-clock); cost ($, only with verified
  prices) and cost-per-useful-output ($/finding, $/spec, $/fixed-task).
- **Process & effectiveness.** Agent count **including nested** — report depth-1
  vs nested separately (e.g. "5 agents: 1 top-level + 4 nested"); launch order and
  parallelism map; clarifying round-trips per agent (many = an underspecified
  brief); rework / retries / re-spawns; delegation correctness and scope drift;
  failure taxonomy (terminal API errors, tool denials, blocked-on-human).
- **Qualitative — reflect with the 4Ls lens.** For a solo-dev + AI-agent workflow
  the 4Ls frame beats a team ceremony format: **Liked** (what worked, worth
  repeating), **Learned** (new facts about the codebase, the agents, the domain),
  **Lacked** (missing context / tests / docs / tooling that caused friction),
  **Longed for** (what you wish existed next time — a check, a doc, a guardrail).
  Note especially **duplicated information** (the same file re-read by several
  agents → a candidate shared pre-read) and **what was missed** (gaps caught only
  after the fact). The detailed format catalog and when to fall back to
  Mad/Sad/Glad live in **[`references/retro-formats.md`](references/retro-formats.md)**.

## Method

1. **Scope the run.** Identify which batch to analyse (ask if ambiguous). State
   the mode (multi-agent vs single) and the data source you'll use.
2. **Carry-forward check.** Read the **last row** of `docs/retros/ledger.md` (if it
   exists) and note whether its "top recommendation" was actually applied. An
   action item that keeps reappearing unactioned is itself the finding — surface
   it. This is what stops the ledger from becoming a graveyard of ignored advice.
3. **Collect metrics** (in-context, or `deep` via the script).
4. **Analyse** — quantitative (the three buckets) then qualitative (4Ls), under the
   blameless framing above.
5. **Recommend — 1–3 items, no more.** A long wishlist kills follow-through; cap it
   hard and pick the highest-leverage changes. Each recommendation must be **SMART
   and owned** (a concrete target, a concrete change, a stated effect, and a named
   home — even if the "owner" is "edit `ship-feature/SKILL.md` today"), and tagged
   with **which kind of gap** it fixes so its home is obvious:

   | Signal (gap) | Fix lives in | Example |
   |--------------|--------------|---------|
   | **context** | a `CLAUDE.md` / module `INSIGHTS.md` | 3 agents each re-read `docs/architecture.md` (~4k×3) → pre-read once and pass the digest, or record the key facts in `INSIGHTS.md`. |
   | **instruction** | the agent's `.md` brief | `implementer` for T-3 needed 2 clarifying round-trips on owned paths → add sibling tasks' owned paths to its dispatch brief. |
   | **workflow** | a `ship-feature` step | review agents ran serially but have disjoint inputs → dispatch them in one message (Step 7 already says this — reinforce it). |
   | **failure** | a bug fix / a check | a tool denial blocked the run for N turns → add the missing allow-rule or a pre-flight probe. |

   See `references/retro-formats.md` for the full taxonomy (Fowler's four signals)
   and more worked recommendation examples (cache ordering, merge/split agents).
6. **Output + one ledger row** (next section). Then **offer — never perform
   unasked — the loop-back**: if the user accepts a recommendation, apply it to its
   owning artifact. A *durable code lesson* is out of scope here — route it to the
   **`engineering-insights`** skill (that owns `INSIGHTS.md`); this skill owns the
   *run/process* and the ledger.

## Output format

Print this exact template to chat:

```
## Workflow Retro — <label>
**Run:** <what ran> · <N> agents (<d1> top-level + <nested> nested) · mode <multi|single> · data: <in-context | deep>

### Metrics
| agent | role | in | out | cache-read | hit% | tools | span | cost |
| ...   | ...  | .. | ..  | ...        | ..   | ...   | ...  | ...  |
**Totals:** <in→out tok> · cache hit <%> · wall <s> · parallelism <x>
**Launch order:** A → (B ‖ C) → D    **Critical path:** <agent> (<…>s)

### 4Ls
- **Liked:** …
- **Learned:** …
- **Lacked:** …
- **Longed for:** …

### Recommendations (1–3, SMART + owned)
1. [context|instruction|workflow|failure] <target> — <change> → <effect>. Owner: <artifact>.

### Carry-forward
<last retro's top rec — applied? / still open?>

### Ledger
<the row appended below, or "skipped (no-ledger)">
```

Any metric you couldn't obtain is `n/a`, never a guess.

## Ledger — the one file write

Append **exactly one row** to `docs/retros/ledger.md` (create it with this header
if missing) unless `no-ledger` was passed. This is the durable, longitudinal
output — it's what lets you compare runs and run the carry-forward check next time.

```
| date | label | agents (top+nested) | in→out tok | cache hit | wall | parallelism | cost | top recommendation |
|------|-------|---------------------|------------|-----------|------|-------------|------|--------------------|
```

Use the current date (from the environment). One row per invocation — never
rewrite prior rows.

## When you cannot proceed

If no multi-agent run is identifiable in context, or `deep` journals can't be
located, **say so plainly and offer the in-context retro instead.** A clear
"nothing to retro / journals not found — here's the in-context view" is a valid
result; a fabricated metric is not. If the run was trivially small and clean,
say the retro isn't worth a ledger row and stop — don't manufacture findings to
justify the ceremony.

## Relationship to other skills

- **`ship-feature`** *builds* a feature by orchestrating the pipeline; **this skill
  reflects on how that build ran.** Think of it as the retro step you invoke after
  `/ship-feature` finishes. Its findings often feed back into `ship-feature`'s
  steps or the agent briefs — see the recommendation taxonomy.
- **`ship-feature/references/cost-discipline.md`** is the prescriptive companion:
  it says *what to do* to keep a run cheap (split by layer, lean context, don't
  resume reviewers, ~93% of tokens are cache-read). This skill *measures whether a
  run followed it* — read it when a recommendation touches cost, and cite it.
- **`engineering-insights`** captures durable, per-module *technical* lessons in
  `INSIGHTS.md` (code-focused). `workflow-retro` is about the **run / process**,
  and its durable output is the `docs/retros/ledger.md` trend log. When a retro
  surfaces a code lesson, hand it to `engineering-insights`; keep process lessons here.
