# Spec: Onboarding Generator  |  Spec ID: SPEC-02  |  Status: approved

**Supersedes:** none

## Problem & why
A newcomer who imports an unfamiliar repository (typically open source) faces a cold start:
they must reconstruct, by hand, what the service is, how a request flows through it, which
files actually matter, how to get it running locally, in what order to read the code, and
where it is safe to make a first contribution. That reconstruction is slow, error-prone,
and repeated by every new contributor.

DevDigest already indexes a repository deterministically (symbols, import graph, ranked
repo map for TS/JS) and knows how to estimate token cost locally (SPEC-01). What is missing
is a way to turn that knowledge — plus a small amount of LLM synthesis — into a single,
guided **onboarding tour** the user can generate on demand: a five-section walkthrough
(architecture overview, critical paths, how to run locally, guided reading path, first
tasks) that gets a newcomer productive fast, while showing exactly what the generation cost
in tokens and dollars so the user makes an informed decision. The tour is advisory
newcomer guidance, not an authoritative artifact, and it must work for any imported
repository — degrading gracefully when the repo's language is not one DevDigest indexes.

## Goals / Non-goals
**Goals**
- Provide a repo-scoped "Onboarding Tour" screen, reachable from a persistent navigation
  entry while a repository is active, that lets a user **generate on demand** a guided tour
  of that repository.
- Before generation, present an empty state that explains what the tour does and its rough
  cost/time, and offers a single control to generate it.
- Generate a five-section tour: (1) Architecture overview — prose with inline code
  references and a small architecture diagram; (2) Critical paths — a ranked list of the
  most important files, each with a one-line "why it matters" and an open affordance;
  (3) How to run locally — an ordered list of copyable shell command steps; (4) Guided
  reading path — an ordered list of files, each with a short "why read this / in this order"
  note; (5) First tasks — 2–4 LLM-suggested, repo-grounded starter tasks, each a card with a
  title, a cited real repository-relative path, and a Low/Medium/High complexity badge.
- Persist the latest generated tour per repository (per-section content, per-section cost,
  and a generated-at timestamp) so it survives sessions and app restarts and can show a real
  "last refreshed" time.
- Let the user regenerate the whole tour **or** any single section independently; a
  regenerate replaces the affected content and recomputes cost.
- Show a dedicated, collapsible "Generation cost" breakdown listing each of the five
  sections with its own cost and a total row, expressed as both token count and an estimated
  dollar amount, with the total also reflected near the tour header.
- Work for **any** imported repository, degrading gracefully: ground the tour in the full
  deterministic index for TS/JS repositories, and fall back to README, file tree, and
  language heuristics for repositories DevDigest does not index — every imported repository
  can still produce a tour.
- Offer, on each cited file (critical-path rows and first-task cards), an affordance to open
  that file on the imported repository's GitHub in a new tab, falling back to copying the
  path when no GitHub URL is available.
- Provide a "Share link" control that copies a stable local deep-link to this repository's
  tour to the clipboard.

**Non-goals**  <!-- explicit boundaries — what we are deliberately NOT doing -->
- **No automatic generation on import.** The tour is generated only when the user asks; the
  previously-considered auto-generate-on-first-import behaviour is explicitly removed.
- **No GitHub Issues integration for First tasks.** Starter tasks are LLM-suggested and
  repo-grounded; there is no round-trip to GitHub issues, no issue creation, and no
  good-first-issue import.
- **No user editing of the generated tour text.** The tour is read + regenerate only; the
  user cannot hand-edit section prose, commands, paths, or task cards in this version.
- **No multi-user or external sharing infrastructure.** "Share link" is a local
  clipboard deep-link only — no external hosting, no authentication, no export/download, no
  server-rendered public page.
- **No in-app file viewer.** Opening a cited file targets GitHub (or copies the path); this
  spec does not add an in-product source-code browser.
- **No token cap, budget limit, or spend warning.** The feature measures and displays cost;
  it does not cap, throttle, or warn against it.
- **No use of the tour as an authoritative or gating artifact.** Its content (complexity
  badges, "critical" ranking, suggested tasks) is advisory guidance; nothing downstream
  treats it as ground truth or gates any decision on it.
- **No token-by-token streaming.** In-progress generation is shown with a spinner (whole
  tour or per card), not a live-typing stream.

## User stories
- As a newcomer to an imported repository, I want to reach an Onboarding Tour from the
  primary navigation whenever that repository is active, so that I can start orienting myself
  without hunting for a link.
- As a newcomer, I want to see, before I spend anything, what the tour will produce and
  roughly what it will cost and how long it takes, so that I can decide whether to generate
  it.
- As a newcomer, I want to generate a guided tour on demand that tells me what the service
  is, how requests flow, which files matter, how to run it locally, what to read in what
  order, and where to make a first contribution, so that I become productive quickly.
- As a newcomer, I want each cited file to be openable on GitHub (or its path copyable), so
  that I can jump straight to the code the tour is pointing me at.
- As a cost-conscious user, I want a per-section and total cost breakdown in both tokens and
  dollars, so that I can see exactly what generation cost and where.
- As a user whose first generation was incomplete or out of date in one area, I want to
  regenerate a single section without redoing the whole tour, so that I only pay for what I
  need to refresh.
- As a returning user, I want my generated tour to still be there after I restart the app,
  with a truthful "last refreshed" time, so that I don't have to regenerate it every session.
- As a user working in a non-TypeScript repository, I want the tour to still generate
  (even if less precise), so that the feature is useful regardless of the repository's
  language.
- As a user who re-synced the repository, I want to be told my existing tour may be out of
  date and be offered a regenerate, rather than have it silently discarded or auto-rebuilt,
  so that I stay in control of when I spend tokens.
- As a user, I want to copy a local link to this repository's tour, so that I can return to
  it directly later.

## Acceptance criteria (EARS)

### Navigation & discoverability
- **AC-1** — WHILE a repository is selected/active, the system shall present a persistent
  "Onboarding Tour" navigation entry for that repository alongside its other primary
  workspace navigation entries.
- **AC-2** — WHILE no repository is selected/active, the system shall not present the
  Onboarding Tour navigation entry.
- **AC-3** — WHEN a user activates the Onboarding Tour navigation entry, the system shall
  open the Onboarding Tour screen for the currently active repository directly.

### Empty state (before generation)
- **AC-4** — WHILE the active repository has no persisted tour, the system shall show an
  empty state containing a heading, an explanatory body describing what the tour produces
  and its rough cost and time, and a single control to generate the tour.
- **AC-5** — The explanatory body's stated cost and time shall be presented as a rough
  pre-estimate, distinct from the actual measured cost shown after generation (AC-20).
- **AC-6** — WHEN a user activates the generate control, the system shall begin generating a
  tour for the active repository.

### Generation & content
- **AC-7** — WHEN a tour is generated, the system shall produce exactly five sections:
  Architecture overview, Critical paths, How to run locally, Guided reading path, and First
  tasks.
- **AC-8** — WHEN the Architecture overview section is generated, the system shall produce
  prose describing what the service is and how requests flow, including inline references to
  real repository paths and a small architecture diagram.
- **AC-9** — WHEN the Critical paths section is generated, the system shall produce a ranked
  list of the repository's most important files, each item citing a real
  repository-relative path with a one-line explanation of why it matters.
- **AC-10** — WHEN the How to run locally section is generated, the system shall produce an
  ordered list of shell command steps, each individually copyable.
- **AC-11** — WHEN the Guided reading path section is generated, the system shall produce an
  ordered list of real repository files, each with a short note on why to read it and why in
  that order.
- **AC-12** — WHEN the First tasks section is generated, the system shall produce between 2
  and 4 starter-task cards, each with a title, a cited real repository-relative path, and a
  complexity badge of Low, Medium, or High.
- **AC-13** — The system shall derive First tasks from the repository's own content and shall
  not create, import, or round-trip to GitHub Issues.

### Generated state & layout
- **AC-14** — WHILE the active repository has a persisted tour, the system shall show a header
  naming the repository, a provenance line stating the number of files the tour was
  generated from and a "last refreshed" time derived from the tour's generated-at timestamp,
  an anchor navigation listing the five sections, and the five sections rendered as
  collapsible cards.
- **AC-15** — WHEN a user activates a section's anchor navigation entry, the system shall
  reveal and scroll to that section.
- **AC-16** — WHEN a user activates the open affordance on a critical-path row or a
  first-task card, the system shall open that file on the imported repository's GitHub in a
  new browser tab.
- **AC-17** — IF no GitHub URL is available for the active repository, THEN the system shall
  fall back to copying the cited file's repository-relative path instead of opening GitHub.
- **AC-18** — WHEN a user activates the Share link control, the system shall copy a stable
  local deep-link to the active repository's tour to the clipboard, without contacting any
  external service.

### Cost breakdown
- **AC-19** — WHILE a tour exists, the system shall provide a collapsible generation-cost
  breakdown listing each of the five sections with its own cost and a total row.
- **AC-20** — The system shall express each section's cost and the total as an actual
  measured token count and, when the active model's pricing is known, an estimated dollar
  amount clearly marked as approximate.
- **AC-21** — IF the active model's pricing is unknown, THEN the system shall show the cost
  as tokens only with a short note that no pricing is available for the model, instead of a
  dollar figure.
- **AC-22** — The system shall also reflect the total generation cost near the tour header.

### Regeneration
- **AC-23** — WHEN a user regenerates the whole tour, the system shall replace all five
  sections' content, recompute every section's cost and the total, and update the "last
  refreshed" time.
- **AC-24** — WHEN a user regenerates a single section, the system shall replace only that
  section's content and cost, recompute the total row, and leave the other four sections'
  content and cost unchanged.
- **AC-25** — WHEN any regeneration completes, the system shall persist the updated content,
  per-section cost, and generated-at timestamp so the change survives app restarts.

### In-progress behaviour
- **AC-26** — WHILE a whole-tour generation is in progress, the system shall show a
  whole-tour progress indicator.
- **AC-27** — WHILE a single-section regeneration is in progress, the system shall show a
  progress indicator on that section's card while the other sections remain readable.
- **AC-28** — IF a user navigates away while a generation is in progress, THEN the system
  shall continue that generation and shall show the completed or updated tour when the user
  returns.

### Persistence & staleness
- **AC-29** — The system shall persist the latest generated tour per repository — per-section
  content, per-section cost, and a generated-at timestamp — such that it survives sessions
  and app restarts until regenerated.
- **AC-30** — IF the active repository has been re-synced or its index has changed since the
  persisted tour was generated, THEN the system shall show a "may be out of date" indicator
  with an option to regenerate, without auto-regenerating or discarding the existing tour.

### Repository language scope
- **AC-31** — WHERE the active repository is one DevDigest indexes (TS/JS), the system shall
  ground the generated tour in the repository's full deterministic index.
- **AC-32** — WHERE the active repository is one DevDigest does not index, the system shall
  still generate a tour, grounding it in the repository's README, file tree, and language
  heuristics rather than failing.

### Failure handling
- **AC-33** — IF a whole-tour generation fails, THEN the system shall show the failure with
  a reason and leave any previously persisted tour intact and readable, instead of
  destroying it or showing a raw error.
- **AC-34** — IF a single-section regeneration fails, THEN the system shall keep that
  section's previous content and cost, and surface the failure for that section only,
  without affecting the other sections or the total.
- **AC-35** — IF the repository is not yet cloned or indexed when generation is requested,
  THEN the system shall show a state indicating the tour cannot be generated until the
  repository is available, instead of an error.

### Non-authoritative framing
- **AC-36** — The system shall present the tour as advisory newcomer guidance, and no
  downstream feature or decision shall treat the tour's content (complexity badges,
  "critical" ranking, or suggested tasks) as authoritative ground truth.

## Edge cases
- **No repository active** — the Onboarding Tour nav entry is not shown (AC-2); the screen is
  repo-scoped and appears only once a repository is active (AC-1).
- **Repository not cloned / not yet indexed at generate time** — generation is refused with a
  clear "not available yet" state (AC-35), not an error.
- **Non-TS/JS repository** — the tour still generates from README + file tree + language
  heuristics (AC-32); it may be less precise but never degrades to "cannot generate".
- **Repository with no README and little to ground on** — the tour still generates from
  whatever is available (file tree, language heuristics); a section with insufficient
  grounding may contain fewer items (First tasks may yield the floor of 2 per AC-12, and
  other ordered lists may be short) rather than fabricating content.
- **Model pricing unknown** — cost is shown as tokens only with a "no pricing" note
  (AC-21); tokens are always available (AC-20).
- **Provider/model changed between generation and viewing** — the persisted per-section
  token counts remain the actual measured cost of the generation that produced them; the
  dollar estimate is only meaningful for the pricing in effect and is marked approximate
  (AC-20).
- **Repository re-synced / index changed after a tour exists** — existing tour is kept and
  flagged "may be out of date" with a regenerate option (AC-30); never auto-regenerated,
  never silently discarded.
- **Whole-tour regenerate requested while a section regenerate is running (or vice versa)** —
  each generation is independent; a whole-tour regenerate supersedes and replaces all
  sections (AC-23), and a per-section regenerate affects only its own section (AC-24). The
  system must not leave a section showing content from a superseded generation.
- **User navigates away mid-generation** — generation continues and the finished result is
  shown on return (AC-28).
- **Whole-tour generation fails** — any previously persisted tour stays intact and readable
  (AC-33); a first-ever generation that fails leaves the empty state with a failure reason.
- **Single-section regeneration fails** — that section keeps its prior content and cost and
  shows a section-scoped failure; the other four sections and the total are unaffected
  (AC-34).
- **A cited file no longer exists on GitHub / no GitHub remote configured** — the open
  affordance falls back to copying the repository-relative path (AC-17).
- **First run vs subsequent runs** — before any generation, the screen shows the empty state
  with the rough pre-estimate (AC-4, AC-5); after generation, the actual measured cost is
  shown (AC-20), and the two must not appear to contradict.
- **Very large repository (high indexed file count)** — the provenance line reflects the
  count the tour was generated from (AC-14); this version imposes no cap or budget warning on
  generation cost (non-goal).

## Cross-module interactions
<!-- Behavioural hand-offs only — what information must flow and when, not the wiring. -->
- WHEN a tour is generated for a TS/JS repository, the system shall make the repository's
  deterministic index (symbols, import graph, ranked repo map) available to the generation
  step as grounding.
- WHEN a tour is generated for a repository DevDigest does not index, the system shall make
  the repository's README, file tree, and language-heuristic signals available to the
  generation step as grounding in place of the index.
- WHEN a tour (or a single section) is generated, the system shall make the generated
  content and its actual measured token cost available for persistence and for display in the
  cost breakdown.
- WHEN a tour is persisted, the system shall make its per-section content, per-section cost,
  and generated-at timestamp durable against the repository, so that later sessions and app
  restarts observe the same tour and a truthful "last refreshed" time.
- WHEN the active repository has been re-synced or its index has changed since the persisted
  tour was generated, the system shall make that staleness signal available to the client so
  it can show the "may be out of date" indicator.
- WHEN the tour is displayed, the system shall make each cited file's repository-relative
  path and (when available) the repository's GitHub URL available to the client so it can
  offer the open-on-GitHub or copy-path affordance.
- WHEN the cost breakdown is displayed, the system shall make the active model's pricing
  availability known to the client so it can show a dollar estimate or fall back to
  tokens-only.

## Non-functional
- **Cost transparency** — every generation's cost shall be shown as an actual measured token
  count per section and in total (AC-19, AC-20); token counts are estimated locally without
  an additional model call solely to measure them, reusing the local token-estimation
  approach established in SPEC-01.
- **Non-determinism acknowledged** — because tour content is produced by LLM synthesis, it
  is not guaranteed to be reproducible run-to-run and is framed as advisory (AC-36); nothing
  downstream may gate a decision on it.
- **Persistence durability** — a persisted tour shall survive app restarts (AC-29); the
  displayed "last refreshed" time shall reflect the real generated-at timestamp, not a
  session-relative or fabricated value.
- **Local-first trust framing** — consistent with DevDigest being a single-user localhost
  app, "Share link" produces only a local clipboard deep-link (AC-18) and requires no
  authentication, external hosting, or network egress beyond the existing GitHub and LLM
  calls; opening a cited file targets the imported repository's public GitHub in a new tab
  (AC-16).
- **Graceful degradation, not failure** — an unindexed repository must still yield a tour
  (AC-32); "cannot index this language" is never surfaced as an error state.

## Inputs (provenance)
- Deterministic repository index — symbols, import graph, ranked repo map (TS/JS only) —
  [deterministic: repo-intel]; no LLM call, reproducible; grounds the tour per AC-31.
- README, file tree, and language-heuristic signals (fallback grounding for non-indexed
  repositories) — [deterministic: filesystem scan of the repo clone]; no LLM call; grounds
  the tour per AC-32.
- Repository GitHub URL (for the open-on-GitHub affordance) — [reused: existing repo import
  metadata]; no LLM call.
- Generated tour content for all five sections — [new: LLM call(s) — one whole-tour
  generation, or a per-section regeneration]; this is the feature's model-cost source and is
  non-deterministic.
- Actual measured token cost per section and total — [deterministic: local token estimation
  over the generation's inputs/outputs]; reuses the SPEC-01 local-tokenizer approach, no
  extra LLM call to measure.
- Active model pricing (to derive the dollar estimate) — [reused: provider/model
  configuration]; when unknown, the feature falls back to tokens-only (AC-21).
- Persisted tour (per-section content, per-section cost, generated-at timestamp) —
  [new: durable per-repository artifact produced by this feature].
- Repository re-sync / index-change signal (to drive the staleness indicator) —
  [reused: existing repo import/index lifecycle].

## Untrusted inputs
All repository-derived content fed into the generation step — README text, file contents,
code comments, symbol names, and file paths — is **untrusted foreign text**: it is authored
in the imported (often third-party) repository and may contain adversarial or injection-style
instructions. The system shall treat this content as data used only as grounding for
generating the tour, never as instructions that can change the generator's task, role, or
scope. This mirrors the trust boundary established in SPEC-01. This spec requires the
behaviour (repository content handled as data, not instructions); it does not prescribe the
guard mechanism.

The generated tour's own text (section prose, cited paths, suggested commands, task titles)
is likewise not authoritative: cited paths are used to build open/copy affordances and
suggested commands are presented for the user to run at their discretion — the system shall
not auto-execute any command from the tour, and shall present the tour as advisory guidance
(AC-36).
