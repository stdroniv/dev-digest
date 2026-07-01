# Retro formats & the recommendation taxonomy — full rationale

> Pulled out of `SKILL.md` to keep the hot path lean. Read this when you want the
> reasoning behind the 4Ls default, when a run was rough enough that the format
> choice matters, or when you're classifying a recommendation and want the full
> four-signal taxonomy with examples.

## Why 4Ls is the default (and not Start/Stop/Continue or Sailboat)

Most retrospective formats are **group facilitation tools** — Start/Stop/Continue,
Sailboat, and the like assume ≥3 people dot-voting in a room. A `workflow-retro`
has an audience of one developer plus a set of stateless agents, so those formats
add ceremony without the group dynamics that justify them.

**4Ls (Liked / Learned / Lacked / Longed-for)** is the format repeatedly
recommended for *personal* and *milestone / end-of-phase* reflection, which is
exactly what a finished pipeline run is:

- **Liked** — what worked well and is worth repeating. (Names the good defaults so
  you don't "fix" them.)
- **Learned** — new facts surfaced this run: about the codebase, about how an agent
  behaves, about the domain. (This is where a durable lesson for
  `engineering-insights` often hides.)
- **Lacked** — what was missing that caused friction: context, tests, docs, tooling,
  an allow-rule. (Maps most directly to a `context` or `failure` recommendation.)
- **Longed for** — what you wish existed next time: a guardrail, a pre-read, a check.
  (Maps most directly to a `workflow` or `instruction` recommendation.)

### When to fall back to Mad/Sad/Glad

After a genuinely **rough, high-friction run** — loops, repeated clarifications, a
run that burned tokens going nowhere — the emotional signal (what was *frustrating*
vs merely suboptimal) carries information that a dry 4Ls can flatten. In that case
run **Mad / Sad / Glad** instead: Mad = actively wasteful/blocking, Sad =
disappointing but tolerable, Glad = worked. Then translate each "Mad" into a
blameless systems finding (see below). Skip Sailboat and Start/Stop/Continue
entirely — they buy nothing for one dev + one agent.

## Blameless framing, concretely

Google's SRE postmortem culture: **assume good intent, focus on systemic /
contributing causes, not individuals.** Translated to agents:

- ❌ "The `implementer` ignored the plan and touched files it shouldn't have."
- ✅ "The `implementer`'s brief listed the plan path but not the sibling tasks'
  owned paths, so it had no way to know those files were off-limits — add them to
  the dispatch brief."

The test: **every finding must name a fixable artifact.** If it reads as a verdict
on the model rather than an instruction to change a doc/brief/step/check, rewrite
it. This is what keeps the retro generative (per DORA's Westrum "generative
culture") instead of a blame log nobody wants to re-read.

## The four-signal recommendation taxonomy (Fowler)

Every recommendation classifies the *gap* it closes, which tells you exactly which
living artifact to edit. Tag each recommendation with one:

| Signal | The gap | Fix lives in | Worked example |
|--------|---------|--------------|----------------|
| **context** | The agent lacked information it needed and had to rediscover it. | a `CLAUDE.md`, a module `INSIGHTS.md`, or a shared pre-read passed in the prompt | "3 agents each read `docs/architecture.md` (~4k tokens ×3 = ~12k re-billed). Pre-read it once in the orchestrator and pass a 400-token digest, or record the two facts they needed in the module `INSIGHTS.md`. Saves ~8k tokens/run." |
| **instruction** | The brief/prompt was ambiguous, so the agent asked or guessed. | the agent's `.md` brief in `.claude/agents/`, or the spawn prompt template | "`implementer` for T-3 needed 2 clarifying round-trips on owned paths. Add the sibling tasks' owned paths to its dispatch brief (each round-trip re-bills the orchestrator's context)." |
| **workflow** | The *sequence* was wrong — serial where it could parallelise, a step missing or misordered. | a `ship-feature` step | "The three reviewers ran serially but have disjoint read-only inputs. `ship-feature` Step 7 already says dispatch them in one message — the run didn't; reinforce or the orchestrator missed it." · "Cache hit ratio was 38% because the dynamic block was injected before the stable prefix — reorder so the stable prefix caches." |
| **failure** | Something broke: a tool denial, a terminal API error, a dropped agent. | a bug fix, an allow-rule, or a pre-flight probe | "A tool denial on `pnpm db:migrate` blocked the run for 3 turns. Add the allow-rule, or add a pre-flight reachability probe (see `cost-discipline.md`)." |

### Topology recommendations (which bucket?)

- **Merge** two agents that always run back-to-back on the same files, or **split**
  one agent doing two unrelated jobs → `workflow`.
- **Concurrency** changes (serial → parallel dispatch) → `workflow`.
- **Cache ordering** (stable prefix first so it's cached across turns) → `workflow`.
- **Model right-sizing** (an agent on Opus doing mechanical edits Sonnet handles) →
  `workflow` (it's a pipeline-tuning decision), and cross-check
  `cost-discipline.md`'s "escalate model only on purpose."

## Turning recommendations into action (and avoiding the graveyard)

- **Cap at 1–3.** The consistent finding across the retro literature: long action
  lists don't get done. Pick the highest-leverage changes and drop the rest.
- **SMART + owned.** Vague items ("communicate better", "be more careful") never
  happen. Every item has a concrete change and a named home artifact.
- **Place it where it will be seen again.** The whole point of routing each rec to a
  living artifact (a brief the next run loads, a `ship-feature` step, `INSIGHTS.md`)
  is that the improvement is *automatically in context next time* — not a bullet in
  a report nobody reopens. This is the "living infrastructure" idea: each correction
  is a signal that a priming doc was incomplete.
- **Carry-forward, don't re-list.** The Step 2 carry-forward check reads the last
  ledger row's top recommendation and asks "did this get applied?" A rec that keeps
  reappearing unactioned is a stronger finding than any single-run metric — surface
  *that* rather than silently re-recommending it.

## Avoiding retro fatigue

Fatigue sets in when the ceremony stops producing visible change. Guard against it:

- **Skip low-signal runs.** A trivial, clean, single-agent run doesn't need a retro
  or a ledger row. Say so and stop.
- **Vary depth, not frequency.** Most runs get the fast in-context retro; reserve
  `deep` mode and a fuller write-up for a genuinely surprising or expensive run.
- **Never force output.** If there's nothing worth writing, "clean run, nothing to
  change" is a valid, honest result — manufacturing findings to justify the ceremony
  is exactly what erodes trust in it.
