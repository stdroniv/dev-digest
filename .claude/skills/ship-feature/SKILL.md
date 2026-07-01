---
name: ship-feature
description: "Run the full DevDigest feature-delivery pipeline end-to-end by orchestrating the project's subagents. Use whenever the user invokes `/ship-feature`, or asks to 'ship a feature', 'build this end to end', 'run the full agent pipeline', 'take this from plan to merge-ready', or hands over a sizable feature request they want implemented with planning + tests + review (not just a quick edit). It sequences researcher → planner (with a human approval gate on the plan) → implementer → test-writer, then runs architecture-reviewer + security-reviewer + plan-verifier in parallel, loops blocking findings back to the implementer until the change is clean, and optionally finishes with doc-writer. Use it even when the user just describes a substantial feature and wants it done 'properly' — orchestrating the agents in the right order, in parallel where safe, with the approval gate and the review loop, is the whole value. For a one-line quick fix a single agent is enough; this is for multi-step features worth the full pipeline."
allowed-tools: Task, Read, Grep, Glob, Bash
metadata:
  version: 1.3.0
  tags: pipeline, orchestration, subagents, feature-delivery, planner, implementer, reviewers, definition-of-done
  updated: 2026-06-28
---

# Ship Feature — pipeline orchestrator

Drive a feature from request to merge-ready by orchestrating DevDigest's subagents
(see `.claude/agents/README.md`). **You — the main session — are the orchestrator.**
The agents are **leaf workers**: none of them holds the `Task` tool, so none can spawn
another. Every sequencing, fan-out, and loop-back decision happens here, in you. You
spawn each agent with the `Task` tool, read what it returns, and decide the next step.

Because a subagent gets **no parent conversation history**, you must hand each one the
context it needs *in its prompt*: the plan path, the diff base (`main`), the changed-file
list, and — when looping back — the exact findings to fix. The plan file
(`docs/plans/<slug>.md`) is the durable contract that ties the stages together.

## Pipeline at a glance

```
researcher? → planner → [APPROVAL] → implementer → test-writer
   → ‖ architecture-reviewer ‖ security-reviewer ‖ plan-verifier ‖
   → blocking findings? ─yes→ implementer → re-review (loop)
                        └no→ doc-writer? → report
```

Serialise stages 1–4 (each needs the previous one's output); **parallelise the
reviewers** (independent and read-only). Run the whole thing top to bottom; don't skip
the approval gate or the review loop.

## The two rules that actually change outcomes

Most of this pipeline is what a careful engineer would do anyway — scope-check, plan,
approval gate, parallel review. These two calls are the easy-to-miss ones that quietly
go wrong without a checklist. If you remember nothing else, remember these:

1. **A non-blocking finding is a note, never a loop-back.** Once you've judged a finding
   non-blocking (Step 6's table), do *not* hand it to the implementer "while we're here."
   That re-opens a clean change and turns a `WARNING` into churn — scope creep disguised
   as efficiency. Record it in the report and move on.
2. **Converge deliberately; adjudicate a dispute once, then escalate.** The review loop
   must terminate (Step 6). When the implementer *disputes* a finding rather than failing
   to fix it, don't re-loop it and don't silently drop it — have the *owning reviewer*
   adjudicate the rebuttal exactly once, then stop and let the human decide if it stands.

## Step 0 — Capture the request and scope-check

Take the feature request from the user's `/ship-feature` argument or their message. If
it's too vague to plan (no clear outcome, or several plausible interpretations), ask
1–3 clarifying questions with `AskUserQuestion` **before** planning — a plan built on a
guess wastes the whole pipeline. If the request is actually a one-line fix, say so and
offer to just do it directly rather than spinning up the pipeline.

## Step 1 — researcher (optional)

If the feature hinges on something you don't already know (how an existing subsystem
works, a library's behavior, an API contract), spawn `researcher` for a targeted
lookup and feed its answer into the plan. Prefix the ask with `[code]` or `[web]` to
force the search type. **Skip this** when the planner's own reading will clearly
suffice — don't pad the pipeline.

## Step 2 — planner, then STOP at the approval gate

Spawn `planner` with the (clarified) request. It writes an ordered, verifiable plan to
`docs/plans/<slug>.md` and returns the path.

**This is a hard human checkpoint.** Present the plan path and a short summary to the
user and **wait for their approval**. Do not implement anything until they say go —
they may want to cut scope, reorder, or correct an assumption. Approval here is what
makes the rest of the pipeline safe to run with less supervision.

## Step 3 — implementer

**Pre-flight for greenfield / new-dependency work.** Before committing a long implementer
run, do a ~30-second reachability check on anything the plan *assumes* but hasn't proven:
can the new dependency actually install, is Docker up if the tests need it, does the
external API authenticate? A cheap probe up front beats discovering a hard blocker 30
minutes into an expensive run. Skip it when the change only touches code and tooling
already present in the repo.

Once approved, spawn `implementer` with the plan path (e.g. *"Execute
docs/plans/<slug>.md"*). It writes the code and self-verifies with
typecheck / lint / test / build. If it reports the plan is structurally wrong, stop and
take that back to the user / planner — don't push it to guess.

## Step 4 — test-writer

Spawn `test-writer` to add behavior-focused tests for the change and **run** them. It
pastes real test output; capture that as evidence for the review stage.

**When the implementer already wrote comprehensive, passing tests** (it self-verifies in
Step 3), you may fold this stage away to save a full agent run — but only if you make
plan-verifier's coverage check (Step 5) a standing instruction, so an *independent*
"is anything untested?" pass still happens. Folding without that backstop means the
implementer graded its own homework.

## Step 5 — review, in parallel

First compute the change set once so every reviewer shares one ground truth:

```sh
git diff --name-only $(git merge-base main HEAD)..HEAD
```

Then **fan the reviewers out in parallel — in a single message** (multiple `Task` calls
at once). Give each the plan path, the diff base (`main`), and the changed-file list in
its prompt — `architecture-reviewer` has **no Bash**, so it relies on the list you pass.

**Right-size the set to the diff — don't reflexively spawn all three.** Each pass costs
a full agent run, and a strong orchestrator already prunes; make that pruning explicit
and safe rather than leaving it to chance:

- **plan-verifier — always.** It's your completeness + scope gate *and* the standing
  coverage backstop. Tell it to default to **blocking completeness** — missing
  tools/requirements, unhonored locked decisions, scope creep — rather than an
  exhaustive requirement-by-requirement matrix; the full matrix is the parallel
  long-pole (it ran 2–3× the other reviewers on a real run), so reserve it for an
  explicit deep pass. And always ask it to **assess test coverage and name any untested
  critical path** — this is what makes folding `test-writer` (Step 4) safe.
- **architecture-reviewer — when the diff changes structure**: new modules, moved
  boundaries, dependency direction, cross-layer wiring. Skip it for a localized change
  that touches no seams — say so in one line.
- **security-reviewer — mandatory whenever the diff touches a real attack surface**:
  auth, routes/endpoints, secrets, the LLM prompt path (lethal trifecta), file/path
  access, DB queries or migrations, or any outbound call. **Otherwise you may skip it
  with a one-line justification** — e.g. a pure client-side render/filter over
  already-fetched data crosses no trust boundary — and do the trivial input/allowlist
  check yourself. **When in doubt, run it:** a missed `High` costs far more than one
  reviewer pass.

The reviewers you run have non-overlapping lanes by design; don't merge their roles.

## Step 6 — gate and loop-back

Collect the three reports and decide what is **blocking**:

| Reviewer | Blocking | Not blocking (note, don't loop) |
|----------|----------|----------------------------------|
| architecture-reviewer | any `CRITICAL` | `WARNING` / `SUGGESTION` |
| security-reviewer | any **High** | **Medium/Low** — judge against the threat model* |
| plan-verifier | any **Missing**, or **substantive out-of-scope** change, or a `GAP` verdict | **Partial** — judge; **incidental** out-of-scope |

\* DevDigest is local-first, single-user, localhost, no route auth (root `CLAUDE.md`).
A bug only the local user can trigger usually crosses no trust boundary — down-rank it
rather than blocking. Reserve blocking for harm that crosses a real boundary.

If there are **no blocking findings**, go to step 7. Otherwise:

1. Consolidate the blocking findings into one clear list (`file:line` + what to change).
2. Spawn `implementer` again with **only** that list as its task.
3. Re-run **only the affected reviewers** (e.g. if only security flagged, re-run
   security + plan-verifier for scope; skip architecture if untouched).
4. Repeat.

**Convergence guard — don't loop forever.** End the loop when reviews come back clean or
you reach **3 rounds**. The tricky case is a **disputed finding** — the implementer
argues a finding is wrong (e.g. *"that path isn't reachable"*) and makes no code change.
Don't re-loop the implementer (you'll get the same dispute or a coerced, pointless edit)
and don't silently drop it. **Adjudicate it once:**

1. Re-check **only that finding** with the reviewer that **owns** it — reachability is
   `security-reviewer`'s lane, a boundary question is `architecture-reviewer`'s. Spawn a
   **fresh, minimal** agent (never *resuming* one — that re-bills its whole transcript,
   see cost discipline) and hand it the implementer's **exact rebuttal as new evidence**.
   Ask it to either **uphold** (refuting the argument point by point) or **drop** the
   finding.
2. **Dropped →** the change is clean; converge to Step 7/8, noting the adjudication.
   **Upheld →** stop and surface it to the user as a decision: the finding (`file:line`,
   severity), the implementer's rebuttal, the reviewer's counter, and your recommendation
   under the threat model.

This single adjudication is a cheap scoped re-check, **not** an implementer round, so it's
worth doing even at the round cap — it can resolve the dispute without bothering the human.
But adjudicate **at most once per finding**, and never open a **fourth** implementer round:
a finding that survives one adjudication — or any finding still open at the **3-round
implementer cap** — is a human call, not another loop.

## Step 7 — doc-writer (optional)

If the change introduces something worth documenting — a new module, a public API, an
architectural decision, or a user-facing flow — spawn `doc-writer` to produce the doc
in the right place (README / ADR / architecture doc). Skip it for internal-only or
trivial changes; when unsure, ask the user.

## Step 8 — final report

Summarise the run so the outcome is reviewable:

- **Plan:** `docs/plans/<slug>.md` (one-line scope).
- **Implemented:** what landed; typecheck/lint/build status.
- **Tests:** what was added + the real pass/fail output.
- **Reviews:** each reviewer's rollup verdict, and how many loop rounds it took.
- **Docs:** what `doc-writer` wrote, if anything.
- **Verdict:** merge-ready, or the open items the user must decide.

## Orchestration rules (why these matter)

- **Pass context explicitly.** Leaf agents can't see this conversation. Every `Task`
  prompt must carry the plan path, the diff base, the changed-file list, and (on
  loop-back) the precise findings. Vague delegation produces vague work.
- **Parallel only where independent.** The reviewers you run don't depend on each other,
  so one message with all their `Task` calls is far faster than serial. Everything before
  them is a dependency chain — keep it serial.
- **Respect the approval gate.** Never jump from plan to code without the user's go —
  it's the one place a wrong direction is cheap to correct.
- **Honour each agent's read-only contract.** The reviewers never edit; only the
  implementer (and test-writer) write. If a reviewer "suggests a rewrite", that's a
  direction for the implementer, not a patch to apply yourself.

## Cost & robustness discipline (keep the pipeline cheap)

A real run's telemetry showed **cache-read is ~93% of all tokens** — each agent's context
re-bills on *every* turn — so cost scales with **conversation length × context size**, not
model tier (tiers are already set per agent). Optimise for *fewer, shorter, leaner* agent
turns and *zero wasted runs*. The four rules that matter most:

- **Split a big implementation by layer** when it spans **>1 package** or **~15+ files**;
  keep a single run below that threshold.
- **One-retry-then-DIY** on a dropped single-shot agent (esp. `planner`) — resume once,
  then write the artifact yourself rather than burning a third resume.
- **Scope every re-verify** to the specific findings/files, with a **fresh, minimal**
  agent — never by *resuming* a reviewer (that re-bills its entire transcript). If you
  already hold the evidence (e.g. pasted green test output), skip the agent entirely.
- **Run verification foreground**; background a sub-agent only when there's parallel work
  to overlap, and never *poll* one — completion notifications fire automatically.

The full rationale plus the rest of the rules (lean per-agent context, exploration,
model escalation, and *why* each holds — with the token figures from the real run) lives
in **[`references/cost-discipline.md`](references/cost-discipline.md)**. Read it before a
large, multi-package, or loop-heavy run.

## What this skill is NOT for

A quick fix, a rename, a one-file tweak, or a docs-only change — those don't need a
plan, tests, and three reviewers. Use the single relevant agent (or just do it). This
pipeline earns its overhead on multi-step features where planning and independent
review actually de-risk the change.
