# backend-onion-architecture v1.2.0 — eval 1 (digest-schedules), 5-run re-check

Same fixture and prompt as iteration-2, run against the **sharpened** skill (checklist #1 +
domain-layer anti-pattern + examples.md type-only pair). Graded against F1–F9.

## Per-run scoring

| Expectation | Run 1 | Run 2 | Run 3 | Run 4 | Run 5 |
|---|---|---|---|---|---|
| F1 — routes.ts `/preview` direct DB query | ✅ | ✅ | ✅ | ✅ | ✅ |
| F2 — cron-override business rule in route handler | ✅ | ✅ | ✅ | ✅ | ✅ |
| F3 — helpers.ts `InferSelectModel`/Drizzle-coupled "domain" type | ✅ | ✅ | ✅ | ✅ | ✅ |
| F4 — helpers.ts constructs/calls `GithubClient` from domain | ✅ | ✅ | ✅ | ✅ | ✅ |
| F5 — service.ts constructs `WorkspaceRepository` directly (cross-module) | ✅* | ✅* | ✅* | ✅* | ✅ |
| F6 — service.ts raw `fetch`/`process.env` bypassing `GithubClient` | ✅ | ✅ | ✅ | ✅ | ✅ |
| F7 — module-level mutable `rateLimitCache` | ✅ | ✅ | ✅ | ✅ | ✅ |
| F8 — repository.ts scheduling rules + unmapped raw rows | ✅ | ✅ | ✅ | ✅ | ✅ |
| F9 — precision: no false complaint about `github-client.ts` | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Score** | **9/9** | **9/9** | **9/9** | **9/9** | **9/9** |

\* Runs 1–4 caught F5 as a DI/composition-root violation; Runs 3 and 5 *additionally* named the
cross-module reach explicitly ("reaches across into another module's concrete `WorkspaceRepository`
— that should be a port too"). Run 5 in particular now flags it as a distinct MEDIUM finding citing
the cross-module pattern directly. All 5 pass.

## Before / after

| | iteration-2 (v1.1.0) | iteration-3 (v1.2.0) |
|---|---|---|
| F3 catch rate | 4/5 | **5/5** |
| Mean score | 8.8/9 (97.8%) | **9.0/9 (100%)** |
| Perfect runs | 4/5 | **5/5** |

## What the fix did

- **F3 → 5/5.** Every run now flags the `InferSelectModel` domain-type alias *by name*, and 4 of
  the 5 quote the skill's own new language almost verbatim — "a type alias is erased at runtime so
  dependency-cruiser/`depcruise` may miss it, but it still couples the core to the DB shape." That
  phrase comes straight from the sharpened checklist #1, so the cue is doing exactly the intended
  work: it converted a violation the model previously had to *derive* into one it now *recognizes*.
- **No regressions.** All 8 previously-deterministic expectations stayed 5/5, and F9 precision held
  — no run wrongly flagged `github-client.ts` (every run explicitly praised it as the exemplar
  adapter). The extra guidance didn't cause over-flagging.
- **Side benefit — F5 framing improved.** The cross-module `WorkspaceRepository` reach, which in
  iteration-2 was uniformly folded into generic DI-hygiene language, is now called out explicitly as
  a cross-module/port violation in 2 of 5 runs. Not something the edit directly targeted, but the
  sharper "name the specific smell" tone appears to have carried over.
- **Richer reviews overall.** Distinct-issue counts rose (iteration-2 ~7–10 → iteration-3 ~10–12)
  because runs now also surface the latent `recordRunResult` failure-counter bug and the dropped
  `cronOverride` as symptoms of the anemic-domain problem — a sign the domain-layer guidance is
  landing, not just the one checklist line.

## Bottom line

The sharpening closed the only soft spot: **F3 went 4/5 → 5/5 and the fixture now scores a clean
9/9 across all five independent runs (100%, zero variance)**, with no precision regression on the
clean decoy file. The gap was a real (if small) skill gap — an abstract rule with no recognizable
cue — and adding the named cue fixed it.
