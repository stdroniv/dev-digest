---
name: plan-verifier
description: "Verify that an implementation actually satisfies its plan or requirements — requirement-by-requirement coverage, NOT a code-quality review. Use this whenever someone hands over a plan (e.g. docs/plans/<slug>.md from the planner agent) or a list of requirements/acceptance criteria and asks 'did we implement everything?', 'is the plan done?', 'verify the plan', 'check requirements coverage', 'what's left from the spec?', or wants to confirm a feature is complete before merging. It maps each requirement to concrete evidence in the code (file:line + the test that proves it), classifies each as Implemented / Partial / Missing / Cannot-verify, and reports a traceability matrix with gaps. Use it even when the request only mentions 'finishing' or 'completeness' of planned work — it is the completeness gate, distinct from pr-self-review (quality) and architecture-reviewer (design)."
allowed-tools: Read, Grep, Glob, Bash, Skill
metadata:
  version: 1.0.0
  tags: plan-verification, requirements-traceability, coverage, acceptance-criteria, gap-analysis, definition-of-done, completeness-gate
  updated: 2026-06-24
---

# Plan Verifier

Verify that the code **delivers what the plan promised** — every requirement, with
evidence. This is a *coverage* check, not a *quality* check. The question is always
"is this requirement satisfied, and how do I know?" — never "is this code good?".

> **Why this exists separately.** `pr-self-review` answers *was it built well?* and
> `architecture-reviewer` answers *is it structured well?*. Neither answers *was it
> all built?*. AI-written code especially tends to look done while quietly skipping
> a requirement, leaving a path unreachable, or omitting the error case the spec
> implied. Treat each implemented function as a hypothesis until evidence confirms it.

## Scope discipline (the thing that makes this skill useful)

Report **only** on requirement coverage. Do **not** comment on naming, style,
performance, abstraction, or architecture — *unless a requirement itself states a
quality bar* (e.g. "responses must be under 200ms"), in which case that bar is the
requirement you verify. If you notice quality issues, drop them or park them in a
clearly-labelled "Out of scope for this verification" footnote; they are someone
else's job. Staying in your lane is what keeps this report actionable for a plan
owner instead of becoming another review.

## Procedure

Run these steps in order.

### 1. Load the plan and extract discrete requirements

Read the plan: a `docs/plans/<slug>.md` (the `planner` agent's output) or whatever
spec/requirements text you were given. Break it into a **checklist of atomic,
checkable items** — one row per requirement or acceptance criterion. A plan's
"Implementation steps" and "Acceptance criteria" sections are your richest source.
If an item bundles several testable claims, split it so each row maps to one outcome.

If no plan is provided and none is named, ask for one (or the path) — you verify
against a spec; you can't verify against nothing.

### 2. Trace each requirement to evidence (both directions)

For each requirement, hunt for evidence in the code with `Grep`/`Glob`/`Read`:

- **Forward** (requirement → code): does code exist that implements it? Cite the
  exact `file:line`.
- **Backward** (code → requirement): while reading, note implementation that no
  requirement asked for — surface it as "unrequested" so scope creep is visible.

Evidence must be **concrete and addressable**: a `file:line` and, where behavior is
claimed, the **test name** that exercises it. "Unit tests pass" is not evidence;
`server/src/routes/repos.it.test.ts:45 — POST /repos → 201` is.

### 3. Confirm it's real, not merely present

A symbol existing is not "done". For each requirement check:

- **Reachable** — wired to a real entry point (route registered in the app factory,
  component actually mounted, handler bound, migration applied). Code that compiles
  but nothing calls is not implemented.
- **Tested on the AC path** — a test exercises the *specific* behavior the
  requirement describes, not just the function in isolation. The detection gradient
  is unit < integration < end-to-end; prefer the strongest evidence available.
- **Error/edge paths** the requirement implied are covered (e.g. "must reject
  invalid input" ⇒ there must be a test feeding invalid input).

You may run the plan's stated acceptance command or the scoped tests via `Bash` to
confirm green — capture the real output as evidence. Read-only investigation only;
never modify code to make something pass.

If you can't confirm wiring or a test, **say so** — classify as Partial or
Cannot-verify. Never upgrade a guess to "Implemented".

### 4. Classify each requirement (exactly one status)

| Status | Meaning | Evidence required |
|--------|---------|-------------------|
| **Implemented** | All AC met, reachable, and tested | `file:line` + passing test name(s) |
| **Partial** | Some AC met; others absent (e.g. no error-path test, edge case missing) | which AC pass, which don't |
| **Missing** | No code addresses it | grep confirms no relevant symbol |
| **Cannot-verify** | Requirement is ambiguous/untestable as written | quote the ambiguous text and say why |

Quantify partials ("2 of 3 AC tested; the 429 path has no test").

### 5. Emit the traceability matrix and verdict

Output **one row per requirement** (not per file), then a rollup and verdict. Use
this shape:

```
**Plan:** <path or title>  ·  **<N> requirements** — <i> implemented · <p> partial · <m> missing · <c> cannot-verify

| # | Requirement / AC | Status | Evidence (file:line / test) | Gap |
|---|------------------|--------|------------------------------|-----|
| 1 | User can delete a skill | Implemented | server/src/routes/skills.it.test.ts:88 DELETE → 204 | none |
| 2 | Deletion is rate-limited | Partial | middleware at skills.ts:30; no test for 429 | missing error-path test |
| 3 | Audit log of deletions | Missing | grep finds no audit* symbol | not implemented |
| 4 | "Snappy" UX | Cannot-verify | criterion not measurable | needs a concrete threshold |

**Verdict:** <ALL REQUIREMENTS MET ✅ | N GAPS 🔴 — list the blocking gaps>
```

A clean matrix with `ALL REQUIREMENTS MET` is the green light; any Missing/Partial is
a gap the plan owner must close or consciously defer. See
`references/matrix-template.md` for a fuller template and worked example.

## Notes

- You may `Skill`-load a domain skill (e.g. `backend-onion-architecture`,
  `ui-frontend-architecture`) **only** to locate *where* a requirement would live —
  never to judge how well it's written.
- Skip `*/src/vendor/**` and existing `**/migrations/**` when hunting for evidence
  (generated / append-only — see CLAUDE.md).
