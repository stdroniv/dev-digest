---
name: ship-feature
description: "Run the full DevDigest feature-delivery pipeline end-to-end by orchestrating the project's subagents. Use whenever the user invokes `/ship-feature`, or asks to 'ship a feature', 'build this end to end', 'run the full agent pipeline', 'take this from plan to merge-ready', or hands over a sizable feature request they want implemented with planning + tests + review (not just a quick edit). It sequences researcher → planner (with a human approval gate on the plan) → implementer → test-writer, then runs architecture-reviewer + security-reviewer + plan-verifier in parallel, loops blocking findings back to the implementer until the change is clean, and optionally finishes with doc-writer. Use it even when the user just describes a substantial feature and wants it done 'properly' — orchestrating the agents in the right order, in parallel where safe, with the approval gate and the review loop, is the whole value. For a one-line quick fix a single agent is enough; this is for multi-step features worth the full pipeline."
allowed-tools: Task, Read, Grep, Glob, Bash
metadata:
  version: 1.0.0
  tags: pipeline, orchestration, subagents, feature-delivery, planner, implementer, reviewers, definition-of-done
  updated: 2026-06-24
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

Serialise stages 1–4 (each needs the previous one's output); **parallelise the three
reviewers** (independent and read-only). Run the whole thing top to bottom; don't skip
the approval gate or the review loop.

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

Once approved, spawn `implementer` with the plan path (e.g. *"Execute
docs/plans/<slug>.md"*). It writes the code and self-verifies with
typecheck / lint / test / build. If it reports the plan is structurally wrong, stop and
take that back to the user / planner — don't push it to guess.

## Step 4 — test-writer

Spawn `test-writer` to add behavior-focused tests for the change and **run** them. It
pastes real test output; capture that as evidence for the review stage.

## Step 5 — review, in parallel

First compute the change set once so every reviewer shares one ground truth:

```sh
git diff --name-only $(git merge-base main HEAD)..HEAD
```

Then, **in a single message, spawn all three reviewers concurrently** (multiple `Task`
calls at once). Give each the plan path, the diff base (`main`), and the changed-file
list in its prompt — `architecture-reviewer` has **no Bash**, so it relies on the list
you pass:

- **architecture-reviewer** — design, layering, dependency direction, boundaries.
- **security-reviewer** — OWASP Top 10 + LLM lethal-trifecta over the diff.
- **plan-verifier** — completeness *and* scope vs `docs/plans/<slug>.md`.

They have non-overlapping lanes by design; don't merge their roles.

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

**Convergence guard — don't loop forever.** Stop the loop and surface to the user when
any of these happens: reviews come back clean; a round produces **no new code changes**
(the implementer disputes a finding or can't act on it); or you reach **3 rounds**. A
disputed finding is a human decision, not an infinite loop.

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
- **Parallel only where independent.** The three reviewers don't depend on each other,
  so one message with three `Task` calls is ~3× faster than serial. Everything before
  them is a dependency chain — keep it serial.
- **Respect the approval gate.** Never jump from plan to code without the user's go —
  it's the one place a wrong direction is cheap to correct.
- **Honour each agent's read-only contract.** The reviewers never edit; only the
  implementer (and test-writer) write. If a reviewer "suggests a rewrite", that's a
  direction for the implementer, not a patch to apply yourself.

## What this skill is NOT for

A quick fix, a rename, a one-file tweak, or a docs-only change — those don't need a
plan, tests, and three reviewers. Use the single relevant agent (or just do it). This
pipeline earns its overhead on multi-step features where planning and independent
review actually de-risk the change.
