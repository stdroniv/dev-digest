# Spec: Project Context  |  Spec ID: SPEC-01  |  Status: approved

**Supersedes:** none

## Problem & why
Reviewer agents today judge a pull request from the diff, the repo map, and the agent's
own system prompt and skills. They have no access to the project's **written intent** —
the PRDs, tech specs, architecture docs, and hard-won insights that define what the code
is *supposed* to do and which invariants it must uphold (e.g. "the `api/` module must not
import `db/` directly"). As a result a reviewer cannot catch a change that is locally
correct but violates a documented project rule, and it cannot cite the rule it is
enforcing.

Those documents already live in the repository (commonly under `specs/`, `docs/`, and
`insights/` folders). What is missing is a way to (a) discover them, (b) let a user
deliberately attach the relevant ones to a reviewer agent or a skill, and (c) feed their
content into the review as grounding — visibly, so the user can *see* exactly which
documents were read and what they cost in tokens, rather than guess. This closes the gap
between "the rule is written down" and "the reviewer actually applies and quotes it".

## Goals / Non-goals
**Goals**
- Discover, recursively, all Markdown (`.md`) documents in a repository clone that live
  under a configurable set of root folders (default: `specs`, `docs`, `insights`) at any
  depth, and present them with their repository-relative paths.
- Let a user manually attach discovered documents to a reviewer **agent** and, separately,
  to a **skill**, with an explicit, persisted order.
- At run time, assemble the effective set of attached documents (agent's own docs plus the
  docs of the agent's enabled skills), read their current content from disk, and inject it
  into the review prompt's existing untrusted "Project context" block.
- Make the attachment visible before and after a run: show the estimated token volume in
  the editor, and show which documents were read (and their token volume) in the run trace.
- Keep the attachment mechanism generic enough that a future feature (e.g. a separate
  spec-conformance agent) can reuse the same attach + read-at-run-time mechanism without
  redesign.

**Non-goals**  <!-- explicit boundaries — what we are deliberately NOT doing -->
- **No automatic or PR-aware selection.** Selection is manual only; a future "flash
  selector" that picks documents per PR is explicitly out of scope.
- **No document authoring, editing, uploading, creating, or deleting** from the UI in this
  version. Project Context is read + preview + attach only; the "Edit" tab, "+ Add",
  upload, and drop-zone affordances shown in the mockups are future work.
- **No "coverage" gauge and no "Used by N agents" statistic** on the Project Context
  screen.
- **No spec-conformance / merge-blocking agent** (the future L06 "bridge" that checks an
  implementation against a spec and blocks the merge). This spec only guarantees the
  attach mechanism is generic enough to support it later.
- **No hard token cap or budget-warning** on attached documents — this version measures and
  displays token volume but does not limit or warn.
- **No change to how non-Markdown files, or repo-intel's TS/JS code indexing, are handled.**
  This feature is a distinct Markdown-reading concern and does not modify or depend on the
  code indexer.

## User stories
- As a reviewer-agent author, I want to reach a repository's Project Context from the
  primary navigation whenever that repository is active, so that I can find it directly
  instead of hunting for a link buried on another page.
- As a reviewer-agent author, I want to browse the project documents that exist in a
  repository, so that I know what grounding is available to attach.
- As a reviewer-agent author, I want to attach specific documents to an agent and order
  them, so that the agent reviews changes against our written specs and invariants.
- As a skill author, I want to attach documents to a skill, so that every agent using that
  skill inherits the same grounding without re-attaching it per agent.
- As a reviewer-agent (or skill) author who reviews pull requests across several
  repositories, I want each repository to keep its own independent attachment list on the
  same agent (or skill), so that switching the active repository shows me exactly the
  documents relevant to that repository without mixing, clearing, or losing the others.
- As a reviewer-agent author, I want to see how many tokens the attached documents add
  before I run, so that I can make an informed cost decision.
- As someone reading a completed run, I want to see exactly which documents were read and
  their token volume, so that I can trust and verify the review's grounding rather than
  guess at it.
- As a reviewer, I want the review to catch and cite a change that violates a documented
  project invariant, so that written rules are actually enforced at review time.

## Acceptance criteria (EARS)

### Discovery & the Project Context screen
- **AC-1** — WHEN a user opens the Project Context screen for a cloned repository, the
  system shall list every `.md` file found recursively, at any depth, under any of the
  configured root folders in that repository's clone.
- **AC-2** — The system shall display each discovered document by its repository-relative
  path and shall show which configured root folder (e.g. `specs`, `docs`, `insights`) it
  originates from.
- **AC-3** — WHEN a user selects a discovered document, the system shall show a preview of
  that document's current content.
- **AC-4** — IF no `.md` files are found under the configured root folders, THEN the system
  shall show an empty state that explains that project documents can be added to the
  repository and read as grounding, instead of an empty or error view.
- **AC-5** — IF the repository has not been cloned yet, THEN the system shall show a state
  indicating documents cannot be listed until the repository is available, instead of an
  error.
- **AC-6** — WHEN a user triggers a refresh of the document list, the system shall re-scan
  the clone and reflect any documents added to or removed from the configured root folders
  since the last scan.
- **AC-7** — The system shall provide a filter that narrows the displayed document list by a
  user-entered search term.

### Discoverability & navigation
- **AC-33** — WHILE a repository is selected/active, the system shall present a persistent
  navigation entry point to that repository's Project Context screen alongside the
  repository's other primary navigation entries, so that the screen is discoverable without
  first opening another page.
- **AC-34** — WHEN a user activates that navigation entry point, the system shall open the
  Project Context screen for the currently active repository directly, without requiring the
  user to navigate through an intermediate page.
- **AC-35** — WHILE no repository is selected/active, the system shall not present the
  Project Context navigation entry point.

### Configurable roots
- **AC-8** — The system shall default the set of root folders to `specs`, `docs`, and
  `insights`.
- **AC-9** — WHERE a workspace has configured a custom set of root folder names, the system
  shall use that set for every repository in that workspace when discovering documents.

### Attaching documents (agent and skill)
- **AC-10** — WHEN a user opens the Context tab of the agent editor, the system shall list
  the repository's discovered documents, each with its origin-root badge, and allow the
  user to attach or detach each document.
- **AC-11** — WHEN a user opens the Context tab of the skill editor, the system shall list
  the repository's discovered documents and allow the user to attach or detach each
  document to the skill.
- **AC-12** — WHEN a user reorders attached documents, the system shall persist that order
  and preserve it across reloads.
- **AC-13** — WHEN a user attaches a document, the system shall store the document's
  repository-relative path in the agent's (or skill's) attachment list for the repository
  under which it was attached, and shall never inline the document's text into the agent's
  or skill's stored prompt/body at attach time.
- **AC-14** — WHEN a user views a document row in the Context tab, the system shall let the
  user preview that document's content without leaving the editor.
- **AC-15** — The system shall display, in the agent (or skill) Context tab, the estimated
  total token volume of the currently attached documents, and shall update it as the
  selection changes.
- **AC-16** — The system shall indicate, in the Context tab, that attached documents are
  injected into each run as an untrusted block.
- **AC-36** — The system shall provide, within the agent (or skill) Context tab's document
  list, a filter that narrows the displayed documents by a user-entered search term over
  their repository-relative paths, independently of the filter on the standalone Project
  Context screen (AC-7).
- **AC-37** — The system shall display, within the agent (or skill) Context tab, a count of
  the documents currently attached to that agent (or skill) for the active repository, and
  WHILE a filter (AC-36) is active shall also show how many of the total discovered
  documents are currently shown; this count is distinct from the estimated token volume
  (AC-15).
- **AC-38** — IF no repository is globally active when a user opens an agent (or skill)
  Context tab, THEN the system shall show a state prompting the user to select a repository
  before documents can be listed or attached, instead of an empty document list or an error.
  This state is distinct from the repository-selected-but-no-documents empty state (AC-4).

### Run-time assembly
- **AC-17** — WHEN a review run executes, the system shall compute the effective set of
  attached documents — each entity's documents taken from its attachment list for the
  reviewed pull request's repository — as the union of the agent's own attached documents
  and the attached documents of every enabled skill that agent uses.
- **AC-18** — WHEN the effective set is computed, the system shall de-duplicate documents by
  repository-relative path so that a document attached at both the agent and skill level
  appears exactly once.
- **AC-19** — WHEN the effective set is ordered, the system shall place the agent's own
  attached documents first (in their persisted order), followed by each enabled skill's
  documents (in skill order, then each skill's document order), with a de-duplicated
  document keeping its agent-level position.
- **AC-20** — WHEN a run executes with a non-empty effective set, the system shall read each
  document's current content from the reviewed pull request's own repository clone at run
  time.
- **AC-21** — WHEN document content is assembled into the prompt, the system shall place it
  in the existing `## Project context` prompt block, wrapped as untrusted data under the
  shared injection guard.
- **AC-22** — WHEN document content is assembled into the prompt, the system shall label
  each document within the block by its repository-relative path.
- **AC-23** — IF the effective set is empty, THEN the system shall assemble the prompt with
  no `## Project context` block, identical to the behaviour before any documents were
  attached.
- **AC-24** — IF an attached document's path does not exist in the reviewed pull request's
  repository clone at run time, THEN the system shall skip that document from the assembled
  prompt and record it in the run trace as attached-but-unavailable, without failing the
  run.

### Run visibility
- **AC-25** — WHEN a run completes, the system shall record in the run trace the list of
  documents that were read (by repository-relative path).
- **AC-26** — WHEN a run completes, the system shall record in the run trace the token
  volume of the documents that were read, estimated locally without any additional model
  call.
- **AC-27** — WHEN a user views a completed run trace, the system shall let the user expand
  the assembled `## Project context` block to see its literal injected content, labelled as
  untrusted.
- **AC-28** — The system shall record each read document's origin (the agent itself, or the
  specific skill it came from) so the effective set is traceable.

### Per-repository attachment lists
- **AC-29** — The system shall maintain, for each agent and each skill, an independent
  ordered attachment list per repository, such that a document attached while a given
  repository is active is recorded only under that repository's list for that agent (or
  skill) and never appears in, mixes with, or affects any other repository's list.
- **AC-30** — WHEN the globally active repository changes while an agent (or skill) Context
  tab is open, the system shall show and allow editing of only that agent's (or skill's)
  attachment list for the newly active repository, without clearing, invalidating, requiring
  confirmation for, or otherwise affecting any other repository's list; a repository the
  entity has not yet attached documents under shall present an empty list.
- **AC-31** — WHEN a review run executes, the system shall draw the agent's and each enabled
  skill's attached documents solely from their attachment lists for the reviewed pull
  request's own repository; IF an entity has no attachment list for that repository, THEN
  the system shall treat that entity as having no attached documents for the run, and the
  run shall execute normally.
- **AC-32** — The system shall apply the per-repository attachment model (AC-29, AC-30,
  AC-31) identically whether the attachment lists belong to an agent or a skill.

## Edge cases
- **No documents found** — configured roots exist but contain no `.md` → empty state
  (AC-4), not an error; attach tabs show an empty document list.
- **Repository not cloned / clone missing** → screen shows an unavailable state (AC-5);
  attaching is not possible until the clone exists.
- **Document deleted or renamed on disk after being attached** — because only the path is
  stored, the path may no longer resolve at run time → skip + surface as
  attached-but-unavailable (AC-24), never a hard failure.
- **Document edited on disk between attach and run** — content is read fresh at run time
  (AC-20), so the run always reflects the current on-disk content, not the content at
  attach time. This is intended behaviour.
- **Same document attached at both agent and skill level** → appears exactly once in the
  effective set (AC-18), at its agent-level position (AC-19).
- **Duplicate file names in different roots** (e.g. `specs/public-api.md` vs
  `docs/public-api.md`) → treated as distinct documents; disambiguated by full
  repository-relative path (AC-2, AC-13).
- **Same agent (or skill) used across several repositories** — each repository keeps its own
  independent, always-valid ordered attachment list on that agent (or skill) (AC-29);
  documents attached under one repository never appear in, mix with, or invalidate another
  repository's list.
- **User switches the globally active repository while a Context tab is open** — the tab
  switches to show and edit only the newly active repository's attachment list for that
  agent (or skill) (AC-30); nothing is cleared, invalidated, or requires confirmation,
  because each repository's list is independent and always valid.
- **Review run for a repository the agent (or skill) has never attached documents under** —
  that repository's attachment list is empty, so the run proceeds with no attached documents
  for that entity (AC-31), identical to the no-documents-attached behaviour (AC-23), never a
  hard failure. Because a run only ever reads the list keyed to the reviewed PR's own
  repository, its documents always belong to that repository by construction — there is no
  cross-repository mismatch to reconcile.
- **No repository active when a Context tab is opened** — the tab prompts the user to select
  a repository before documents can be listed or attached (AC-38), rather than showing an
  empty list or an error. This is distinct from the **repository selected but has zero
  discovered documents** case (AC-4), which shows the existing "no spec files yet" empty
  state: AC-38 covers "no repo selected at all", AC-4 covers "repo selected, no docs".
- **Large document or many attached documents** — token volume is measured and displayed
  (AC-15, AC-26); this version imposes no cap or warning (non-goal).
- **Non-TypeScript / non-code repository** — discovery is Markdown-only and independent of
  code indexing, so the feature works regardless of repository language and does not
  degrade to diff-only.
- **A disabled skill on the agent** — its attached documents are excluded from the
  effective set (AC-17 counts only enabled skills), consistent with how disabled skills are
  already excluded from the prompt.
- **Document list changes on disk while the screen is open** — a refresh (AC-6) reconciles
  the displayed list with the current clone contents.
- **No repository selected/active** — the Project Context navigation entry is not shown
  (AC-35); the entry is repo-scoped and appears only once a repository is active (AC-33).

## Cross-module interactions
<!-- Behavioural hand-offs only — what information must flow and when, not the wiring. -->
- WHEN the Project Context screen or a Context tab is opened for a repository, the system
  shall make available the set of discovered `.md` documents (their repository-relative
  paths and origin roots) sourced from that repository's clone.
- WHEN a user attaches or reorders documents, the system shall make the ordered set of
  attached document paths durable against the agent or skill under the repository active at
  attach time, so that later runs for that repository and later editor sessions with that
  repository active observe the same attachment, while other repositories' lists on the same
  entity are unaffected.
- WHEN a review run starts, the system shall make the agent's effective attached-document
  set (agent-level documents unioned with enabled-skill-level documents, each drawn from the
  attachment list keyed to the reviewed pull request's repository, de-duplicated and ordered
  per AC-18/AC-19) available to the review-assembly step.
- WHEN the review prompt is assembled, the system shall make each effective document's
  current on-disk content available to the existing untrusted `## Project context` prompt
  block, and make the read-document list, per-document origin, and estimated token volume
  available to the run trace.
- WHEN a completed run is viewed, the system shall make the list of read documents, their
  token volume, any attached-but-unavailable documents, and the literal assembled block
  available to the client for display.

## Non-functional
- **Zero new model calls** — token volume (AC-15, AC-26) is estimated locally; the feature
  adds no LLM/API round-trip solely to measure or assemble documents.
- **Determinism** — for a fixed set of attached documents with fixed on-disk content, the
  assembled `## Project context` block shall be byte-identical across runs (document
  content is read verbatim; order is deterministic per AC-19), so it does not introduce
  run-to-run drift in the prompt.
- **Non-regression** — WHEN no documents are attached, the assembled prompt and run trace
  shall be identical to the pre-feature behaviour (AC-23).
- **Trust boundary** — attached document content is foreign text and shall never be treated
  as instructions (see Untrusted inputs).
- **Per-repository isolation** — every agent's (and skill's) attachment lists are isolated
  per repository (AC-29); an editor session only ever shows and edits the list for the
  active repository (AC-30), and a run only ever reads the list keyed to the reviewed pull
  request's repository (AC-31). Documents from different repositories therefore can never
  mix into one effective set — not by an anchor or a confirmation flow, but by construction,
  and no run-time cross-repository mismatch state can arise.

## Inputs (provenance)
- Discovered `.md` document paths (recursive scan of configured roots in the clone) —
  [deterministic: filesystem scan of the repo clone]; no LLM call.
- Attached document paths (agent-level and skill-level, kept as an independent ordered list
  per repository) — [new: user-provided selection, stored as metadata]; no LLM call.
- Document content read at run time — [deterministic: read verbatim from the reviewed PR's
  repo clone]; no LLM call.
- Estimated token volume of read documents — [deterministic: local token estimation];
  reuses the existing local tokenizer capability, no LLM call.
- Configured root folder names — [new: per-workspace setting, defaulting to
  `specs`/`docs`/`insights`].
- The existing `## Project context` prompt slot, untrusted-wrapping, and injection guard —
  [reused: L02–L04]; extended to be fed from attached documents rather than left empty.
- The `specs_read` run-trace field and the prompt-assembly trace record — [reused: L02–L04
  contract, currently inert]; populated by this feature.

## Untrusted inputs
Attached document content (`.md` files from the repository clone) is **untrusted foreign
text**: it is authored in the repository and may contain adversarial or injection-style
instructions. The system shall treat this content as data to be used as reference grounding
only, never as instructions that can change the reviewer's task, role, or scope (AC-21).
It is injected into the same untrusted `## Project context` block and governed by the same
shared injection guard already used for other foreign text (diff, PR body, README). This
spec requires the behaviour (content handled as data, not instructions); it does not
prescribe the guard mechanism.

Document *paths* shown and stored are also derived from repository contents; they are
displayed as labels and used to locate files, and are likewise not executed as instructions.

## Demonstration / acceptance scenario
This end-to-end scenario is the intended proof the feature works; because a review verdict
is model-dependent (it is not deterministic on a cheap model tier — see
`docs/architecture.md`), it is validated as a **demonstration on a mid-tier model**, not as
a deterministic pass/fail unit criterion. The deterministic, always-testable guarantees are
AC-20, AC-21, AC-22, AC-25, and AC-26.

Scenario:
1. A repository contains a spec document stating an invariant (example: "the `api/` module
   must not import `db/` directly").
2. A user attaches that document to a reviewer agent via the Context tab.
3. A pull request that violates the invariant (an `api/` file importing `db/` directly) is
   reviewed by that agent on a mid-tier model.
4. Expected: the reviewer produces a finding that flags the violation and quotes/cites the
   attached spec, and the run trace shows the spec document was read (path + token volume).

Deterministically verifiable regardless of model outcome: the spec document's content
appears in the assembled `## Project context` untrusted block labelled by its path (AC-21,
AC-22), and the run trace lists it under the read documents with its token volume
(AC-25, AC-26).
