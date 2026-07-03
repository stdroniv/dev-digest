# Spec: Why+Risk Brief (PR Brief)  |  Spec ID: SPEC-03  |  Status: approved

**Supersedes:** none

> **Revision note (design-alignment):** this spec was originally authored away from the
> project's authoritative design mockups. The implementation faithfully built the earlier
> spec, but the earlier spec diverged from the design; the design is authoritative. This
> revision realigns the WHAT/WHY with the design's two states (generated / empty) and the
> team's confirmed decisions. The brief is no longer a standalone card: its *what/why*
> feed the PR Brief header summary, its risk display defers to the pre-existing
> severity-based **Risk Areas**, and its *review-focus* becomes a standalone
> "read these first" section. The three points the design did not settle — refreshing a
> stale brief, header/verdict gating when a review exists but a brief does not, and the
> header-summary source of truth — have since been resolved by the user and are now firm
> acceptance criteria (AC-2, AC-17, AC-19).

## Problem & why

A reviewer opening a pull request today has to reconstruct the change's *intent*, its
*blast radius*, and *where to start reading* by scanning several separate signals
(intent classification, blast summary, grouped diff stats, the linked issue, and the
repo's own docs). This orientation cost is paid on every PR, before a single line of
code is read, and it is exactly the low-value work that discourages thorough review.

The Why+Risk Brief exists to make the PR Brief Overview surface orient the reviewer
faster and with more trust. Rather than adding yet another card, it weaves already-computed
signals into the surface the reviewer already looks at: a short *what/why* becomes the PR
Brief header summary, the change's risk is shown through the existing severity-based
**Risk Areas**, and a prioritized *"read these first"* focus list tells the reviewer where
to start. It is advisory context, never a new verdict or merge gate.

The brief deliberately reuses signals that already exist rather than re-deriving them,
and — mirroring the existing intent classifier — its synthesized parts (the *what/why*
and the *review-focus* list) are produced *without* reading raw diff/change bodies,
keeping cost bounded and avoiding a second, redundant pass over the code.

## Goals / Non-goals

**Goals**
- Present a single glanceable PR Brief Overview surface that composes: a header summary
  carrying the change's *what/why*, the existing severity-based **Risk Areas** as the
  risk surface, and a prioritized *review-focus* ("read these first") list.
- Make each review-focus item richer than a bare link — each item names the file, a
  specific location within it, and a short reason to read it first — and show how many
  such items there are.
- Synthesize the brief's *what/why* and *review-focus* in one structured model pass over
  ready-made artifacts (intent, blast summary, grouped diff statistics, the linked issue,
  and the repo's discovered Context docs), without ever consuming raw diff/change bodies.
- Guarantee that every file (and location) a review-focus item references is real
  (grounded against the PR's changed files and their real changed locations); silently
  discard anything that is not.
- Reuse the existing per-PR artifacts (intent, Risk Areas, blast radius, prior PRs) for
  display rather than re-deriving them, and present references as always-visible clickable
  links.
- Behave predictably and never throw when an input is missing or degraded (no model
  configured, intent not yet computed, blast degraded to diff-only, no linked issue, no
  Context docs, or an over-large Context-doc set).
- Let a reviewer generate the brief on demand from a single unified empty state, read the
  cached result, and be told when the cached brief may be out of date.
- Treat all foreign repo/PR/issue/doc text as data, never as instructions.

**Non-goals**
- **Not** a merge/review gate or verdict — the surface is advisory orientation only and
  never contributes to whether a PR passes review.
- **Not** a standalone "Why+Risk Brief" card, "HIGH RISK" badge block, or separate
  what/why/risks card — that card is removed; the content is woven into the PR Brief
  surface's existing regions.
- **Not** its own risks list and **not** its own overall risk level — the risk surface is
  the pre-existing severity-based **Risk Areas** (a separate artifact). The brief neither
  generates nor renders a risks list of its own.
- **Not** a modification of the composite brief's *data or generation* (the unrelated
  `{intent, blast, risks, history}` artifact); this feature composes those artifacts for
  display and adjusts how Risk-Areas references are *presented*, but does not change how
  they are produced.
- **Not** a re-derivation of its inputs: it does not re-index the repo or recompute
  intent, blast, or smart-diff — it consumes them as they already stand.
- **Not** a reader of raw diff/change bodies or full file contents.
- **Not** an interactive/chat surface, and **not** auto-generated on page load.
- **Not** a surface with an in-place regenerate control — the only generation affordance
  is the unified empty state's "Generate brief" action (see AC-17 and the open question on
  refreshing a stale brief).

## User stories

- As a reviewer, I want a one-glance summary of what a PR does and why in the PR Brief
  header, so that I can orient myself before reading any code.
- As a reviewer, I want the change's risk shown through the existing severity-tinted Risk
  Areas, so that I can gauge which areas need scrutiny without a second, redundant risk
  surface.
- As a reviewer, I want a prioritized "read these first" list where each item tells me the
  file, the exact location, and why it matters, so that I start reading in the
  highest-value order rather than alphabetically or arbitrarily.
- As a reviewer, I want every file/location reference to be an always-visible clickable
  link, so that I can jump straight to the code without hunting for a hidden control.
- As a reviewer, I want to generate the brief on demand from a clear empty state, so that
  I decide when to spend the model call.
- As a reviewer, I want to be told when a cached brief may be out of date or when its
  inputs were missing/truncated, so that I know how far to trust it.

## Acceptance criteria (EARS)

### Content & shape of the brief
- **AC-1** — WHEN a brief is generated for a PR, the system shall produce a brief
  containing exactly: a short *what* line, a *why/intent* statement, and a *review-focus*
  ("read these first") list — and shall not include an overall risk level or a risks list
  of its own.
- **AC-2** — WHEN a brief is ready, the system shall surface its *what/why* as the PR
  Brief header's summary prose, rather than as a separate card; and WHERE both a brief and
  a completed review's own summary exist, the brief's *what/why* shall take precedence and
  replace the review summary as the header summary. WHILE no brief exists, the header shall
  show the review's own summary (AC-19).
- **AC-3** — The system shall not display the reviewing agent's name anywhere in the PR
  Brief header.
- **AC-4** — The system shall represent each review-focus item with three parts: the
  referenced file, a specific location within that file (a line or line range), and a
  short reason to read it first.
- **AC-5** — WHEN the review-focus list is rendered, the system shall display a visible
  count of its items.
- **AC-6** — The system shall synthesize the brief's *what/why* and *review-focus* from a
  single structured model pass over only these inputs — intent, blast summary, grouped diff
  statistics, the linked issue, and the repo's discovered Context docs — and shall not
  include raw diff or change-body code lines in that pass.

### Risk surface (reused artifact, not generated here)
- **AC-7** — The system shall use the pre-existing severity-based **Risk Areas** as the PR
  Brief's risk surface, and the Why+Risk Brief shall neither generate nor render its own
  risks list or overall risk level.
- **AC-8** — The system shall present each Risk Area's file reference as an always-visible
  clickable link to the referenced file at its location (`path:line`), not gated behind a
  hover or click reveal.

### Review-focus ordering
- **AC-9** — WHEN the review-focus list is produced, the system shall order it by reviewer
  priority — core-group changes and higher blast-impact files first — and shall not order
  it alphabetically or by filename.

### Grounding of review-focus references
- **AC-10** — The system shall treat a review-focus item's file reference as grounded only
  when it corresponds to a file changed in the PR, and its location as grounded only when
  it corresponds to a real changed location within that file.
- **AC-11** — IF a review-focus item's file reference or its location is not grounded,
  THEN the system shall remove that item from the brief before returning it.
- **AC-12** — IF every model-proposed review-focus item is ungrounded, THEN the system
  shall return the brief with an empty review-focus list rather than fabricated or dead
  links.

### Generation, caching, and read path (on-demand)
- **AC-13** — WHEN a reviewer requests generation of a PR's brief, the system shall compute
  the brief and replace any previously cached brief for that PR.
- **AC-14** — WHEN a reviewer reads a PR's brief, the system shall return the cached brief
  without recomputing it.
- **AC-15** — IF no brief has yet been generated for a PR, THEN the system shall, on a read
  request, return an explicit "not generated" state rather than generating one.
- **AC-16** — The system shall not generate a brief automatically on page load or on read;
  generation shall occur only in response to an explicit reviewer request.
- **AC-17** — The system shall offer the brief-generation affordance only from the unified
  empty state, and shall present no in-place regenerate or refresh control on the PR Brief
  surface once a brief is cached — a stale brief is displayed with its may-be-out-of-date
  indication (AC-21) but is not self-serviceable from this surface.
- **AC-18** — WHEN a reviewer triggers "Generate brief" from the empty state, the system
  shall generate the Why+Risk brief only and shall not initiate a full review run.

### Unified empty state & surface gating
- **AC-19** — WHILE no brief has been generated for a PR, the system shall gate only the
  brief-dependent content of the PR Brief surface, not the whole surface. Specifically it
  shall: (a) render a single unified "No brief yet" empty state — a document icon, a "No
  brief yet" heading, a subtitle inviting generation, and one primary "Generate brief"
  action — in place of the review-focus ("read these first") section; (b) fall the header
  summary prose back to the completed review's own summary (AC-2); and (c) continue to
  render the review-derived header (verdict, findings/blockers count, PR-score, cost/tokens)
  whenever a completed review exists, together with the non-brief regions (intent, the
  severity-based Risk Areas, blast radius, prior PRs), which render on their own terms
  independent of the brief.
- **AC-20** — WHEN a brief is ready, the system shall render the full PR Brief composition:
  the header with the brief's *what/why* as its summary prose, the intent, the
  severity-based Risk Areas, the blast radius, the prior PRs, and the review-focus section.

### Staleness
- **AC-21** — WHILE a cached brief exists and at least one of its inputs (intent, blast, or
  smart-diff) has changed since the brief was generated, WHEN the reviewer reads the brief,
  the system shall serve the cached brief together with an indication that it may be out of
  date.
- **AC-22** — The system shall never recompute a cached brief automatically in response to
  its inputs changing (regeneration is always reviewer-initiated).

### Degraded & missing inputs
- **AC-23** — The system shall treat intent as the only mandatory input for a brief; all
  other inputs (blast, smart-diff, linked issue, Context docs) are optional enrichers.
- **AC-24** — IF intent has not been computed for a PR, THEN the system shall refuse to
  generate a brief and, on a read request, shall return a "not available yet" state rather
  than inventing content.
- **AC-25** — WHILE intent has not been computed for a PR, the unified empty state shall
  present its "Generate brief" action as unavailable, rather than allowing a generation
  request that would be refused.
- **AC-26** — WHERE intent is available but one or more optional inputs are missing or
  degraded, the system shall generate a partial brief from the inputs that are available
  and shall reduce the affected sections (e.g. review-focus) accordingly rather than
  fabricating content.
- **AC-27** — IF no LLM provider is configured, THEN the system shall return a "skipped: no
  model configured" state instead of erroring, and the unified empty state shall show that
  reason.
- **AC-28** — WHERE the PR has no resolvable linked issue (e.g. offline, no token, or no
  issue reference), the system shall generate the brief without it and shall not treat its
  absence as a failure.
- **AC-29** — WHERE the repository indexes as diff-only (blast degraded, e.g. a non-TS
  repo), the system shall still produce a brief, with blast-derived review-focus ordering
  reduced to what the available signals support.

### Context-doc budget
- **AC-30** — IF the combined Context docs for a PR's repo exceed the brief's prompt
  budget, THEN the system shall include a bounded selection chosen by a deterministic,
  documented ordering, such that the same PR and repo state yield the same selection.
- **AC-31** — WHEN the Context-doc set is truncated to fit the budget, the system shall
  indicate to the reviewer that the doc context was incomplete.

### Untrusted input isolation
- **AC-32** — The system shall present all foreign text it reads (PR body, linked-issue
  title/body, repo Context docs, and any blast/intent/diff-derived text) to the model as
  untrusted data isolated from instructions, and shall never act on instructions embedded
  in that text.

### Distinct artifact
- **AC-33** — The system shall store and serve the Why+Risk Brief (its *what/why* and
  *review-focus*) as an artifact distinct from the pre-existing composite brief
  scaffolding, and generating or regenerating it shall not modify the composite artifact's
  data or generation.

### Non-functional
- **AC-34 (cost/determinism)** — The system shall generate a brief using at most one model
  round-trip per generation request.
- **AC-35 (rate limiting)** — The system shall limit brief generation to at most 10
  requests per minute (consistent with other model round-trip endpoints), rejecting excess
  generation requests rather than issuing further model calls.
- **AC-36 (advisory tier)** — Because the surface is advisory and never gates a merge, the
  system shall not require a high/deterministic model tier for it; it may run on a cheaper
  tier, and reproducibility of prose is not a correctness requirement (grounding of
  review-focus references per AC-10–AC-12 still is).

## Edge cases

- **Never generated:** a read before any generation returns "not generated"; the
  review-focus region shows the unified "No brief yet → Generate brief" empty state and the
  header summary prose falls back to the review's own summary, while the review-derived
  header and the non-brief regions (intent, Risk Areas, blast, prior PRs) still render on
  their own terms (AC-15, AC-19).
- **Review completed but no brief:** the verdict/findings/PR-score header renders from the
  completed review with the review's own summary; only the summary prose and the
  review-focus section wait on the brief (AC-2, AC-19).
- **Intent absent:** generation is refused; the empty state's "Generate brief" action is
  unavailable; a read returns "not available yet" (AC-24, AC-25).
- **No model configured:** generation returns "skipped: no model configured", not an error;
  the empty state shows the reason (AC-27).
- **No linked issue** (offline / no token / no `#N` in PR body): brief is produced without
  issue context (AC-28).
- **Diff-only / non-TS repo** (blast degraded): brief still produced; blast-derived
  review-focus ordering reduced to available signals (AC-29).
- **Zero Context docs:** brief produced without doc context; nothing to truncate.
- **Very many / very large Context docs:** bounded, deterministically ordered selection;
  reviewer told context was truncated (AC-30, AC-31).
- **Review-focus item with grounded file but ungrounded location:** the item is dropped
  (AC-11) — a bare-file item without a real location is never shown.
- **All review-focus items ungrounded:** every dead item is dropped, so the brief may
  return with an empty review-focus list rather than fabricated or dead links (AC-11,
  AC-12); the surface still renders (header summary + reused Risk Areas remain).
- **Stale cache:** an input changed since generation → cached brief served with a
  may-be-stale indication; no automatic recompute (AC-21, AC-22). There is no in-place
  regenerate or refresh control (AC-17): staleness is displayed but not self-serviceable
  from this surface.
- **Concurrent generation:** two generation requests for the same PR resolve to a single
  cached brief; the later-completing generation is the one retained (last write wins).

## Cross-module interactions

Behavioural hand-offs only (not wiring):

- WHEN a brief is generated, the system shall make the PR's intent, blast summary, grouped
  diff statistics, resolved linked issue (when present), and discovered Context docs
  available to the single synthesis pass — as the *only* content it consumes.
- WHEN grounding review-focus references, the system shall have the PR's set of changed
  files and their real changed locations available, so that each item's file and location
  can be validated against them (AC-10).
- WHEN a brief is ready, the system shall make its *what/why* available to the PR Brief
  header for display as the summary prose (AC-2).
- WHEN a brief is ready, the system shall make the ordered review-focus list — each item's
  file, location, reason, plus the item count — available to the review-focus section
  (AC-4, AC-5, AC-9).
- The PR Brief surface shall present the pre-existing severity-based Risk Areas (a separate
  artifact) as its risk surface, with always-visible clickable references (AC-7, AC-8);
  reading or displaying Risk Areas shall not alter that artifact's data.
- WHEN determining staleness, the system shall be able to tell whether the PR's intent,
  blast, or smart-diff has changed since the cached brief was generated (AC-21).
- WHEN a brief's read state is "not generated", "not available", or "skipped", the system
  shall make that state available to the PR Brief surface so the review-focus region renders
  the unified empty state with the corresponding reason, while the review-derived header and
  non-brief regions render independently (AC-19, AC-24, AC-27).
- WHEN a completed review exists, the system shall make its verdict, findings/blockers
  count, PR-score, cost/tokens, and its own summary available to the PR Brief header
  independent of whether a brief has been generated; WHERE a brief is also present, the
  brief's *what/why* shall replace the review's summary as the header prose (AC-2, AC-19).

## Non-functional

Captured as measurable criteria above: at most one model round-trip per generation
(AC-34); generation rate-limited to ≤10 requests/minute (AC-35); no high/deterministic
model tier required, but review-focus grounding is mandatory (AC-36).

## Inputs (provenance)

- **Intent** (what/why source, mandatory) — [reused: L03] — the stored per-PR intent
  classification; no new derivation.
- **Blast summary** (review-focus ordering) — [reused: L04] — the existing compact,
  prompt-ready blast form (symbols, callers, impacted endpoints/crons, totals).
- **Grouped diff statistics** (core/wiring/boilerplate groups + split suggestion) —
  [reused: L03] — statistics only, no code bodies.
- **Linked issue** (optional context) — [reused] — resolved live from GitHub; absent when
  offline / no token / no issue reference.
- **Context docs** (repo `.md` docs under the Context Folder roots) — [deterministic:
  repo-intel] — the discovered doc set, read fresh from the repo clone; bounded selection
  when over budget.
- **Changed-file set + real changed locations** (grounding oracle) — [reused /
  deterministic: repo-intel] — used to validate each review-focus item's file *and*
  location, not sent as prose.
- **Risk Areas** (risk surface, display-only) — [reused: composite `pr_brief` risks
  artifact] — the pre-existing severity-based risks; consumed for display, never
  regenerated by this feature.
- **The synthesis itself** (the *what/why* and each review-focus item's reason) —
  [new: 1 LLM call] — one structured pass; the only new model cost this feature adds.

## Untrusted inputs

The brief reads several classes of foreign, potentially attacker-influenced text and must
treat every one as **data, never instructions** (AC-32):

- the PR body / title,
- the linked issue's title and body,
- the repository's Context docs (`.md` files under the Context Folder roots),
- any intent/blast/diff-derived text that itself originated from repo or PR content.

None of this text may alter, override, or add to the model's instructions; it is synthesis
material only. (The change-body / raw diff is deliberately *not* an input at all — AC-6.)
