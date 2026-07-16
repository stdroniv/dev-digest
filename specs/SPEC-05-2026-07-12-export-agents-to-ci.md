# Spec: Export Review Agents to CI  |  Spec ID: SPEC-05  |  Status: approved

**Supersedes:** none

## Problem & why

A review agent that only runs on its author's machine is invisible to the team. It has
to be triggered by hand, it reviews only the PRs its author happens to look at, and its
judgement never becomes a shared, enforceable gate. The moment DevDigest becomes a *team*
tool rather than a personal one is the moment a debugged agent starts running
**automatically** on every pull request in a real repository — where everyone sees its
findings and a blocker can actually stop a bad merge.

The hard part is trust and fidelity. A "debugged agent" is a specific configuration — a
model, a system prompt, the skills linked to it, and its gate policy — that a maintainer
tuned locally until it behaved. Exporting it must run the **byte-identical** behaviour in
CI, not a drifted re-implementation: *one artifact, two environments*. So the agent
serializes to a manifest governed by a single schema that **both** the studio (which
writes it) and the CI runner (which reads it) validate — one contract, two consumers — and
the CI runner executes the **same review engine**, grounding gate included, that runs
locally.

CI is also where the security stakes are highest. In CI the agent reads an **untrusted PR
diff** and can **write to a public PR** — the "lethal trifecta" (untrusted input + a
capability to act + a secret) is fully present. So the exported deployment must be
minimal-by-construction and auditable: least-privilege permissions, secrets that never
reach fork PRs, comment text treated as data, and a workflow a human can read line by line
with nothing hidden behind a marketplace action.

Finally, the studio is local and the CI runner is not, so results cannot be pushed inward.
The studio instead **pulls** each CI run's result artifact and digests it back into the
existing run model, so automated CI reviews accumulate alongside local runs in one place —
turning "the agent ran somewhere in CI" into visible, filterable history.

## Goals / Non-goals

**Goals**
- Let a maintainer export a debugged agent to a repo's CI through a guided wizard, so it
  reviews every pull request automatically without being triggered by hand.
- Deliver the export as a **single reviewable pull request** — the CI configuration lands
  like any other code change, reviewed before it takes effect, never pushed to the default
  branch directly.
- Run the **same review engine in CI as locally**, grounding gate included: collect the PR
  diff, produce grounded structured findings, post them to the PR, and emit a result
  artifact — *one artifact, two environments*.
- Serialize the agent to a manifest governed by **one shared schema** validated by both the
  studio (writer) and the runner (reader), so the two never drift.
- Enable **merge-blocking without a GitHub App**: a finding at or above a chosen severity
  makes the CI check exit non-zero, which — paired with a repository required status check —
  blocks the merge.
- Support **multiple agents deployed to one repo**, each independent, and make re-export to
  an already-installed repo **idempotent** (update in place, never duplicate).
- Flow CI results back into the studio by **pulling** each run's result artifact and
  digesting its aggregates into the existing run model, surfaced on a dedicated **CI Runs**
  page and on each agent's **CI** tab.
- Preserve DevDigest's security spine as observable guarantees: least-privilege workflow
  permissions, secrets sourced from CI (never embedded), no secrets to fork PRs, comment
  text handled as data, and a fully human-readable/editable workflow with no external
  marketplace action.

**Non-goals**  <!-- explicit boundaries — what we are deliberately NOT doing -->
- **CircleCI, Jenkins, and Generic CLI are shown but disabled** ("coming soon"). Only
  GitHub Actions produces a functional export; the other targets are non-selectable
  placeholders this feature does not implement.
- **No GitHub App and no external/marketplace action.** The runner is bundled into the same
  PR; any `uses: devdigest/…@v1`-style line in a mock is only a placeholder and is editable.
- **The wizard does not create or validate the repository's API-key secret.** Adding
  `OPENROUTER_API_KEY` (and relying on the CI-provided `GITHUB_TOKEN`) under the repo's
  secrets is a documented **manual** step, out of scope for the wizard.
- **The wizard does not configure branch protection / required status checks.** Turning the
  non-zero exit into an actual merge block is a documented manual repository setting.
- **No memory accrual.** The exported `.devdigest/memory.jsonl` ships **empty**; populating
  it belongs to later deployment-zone work.
- **No inbound push from CI to the studio.** The studio is local; results are always
  **pulled** from GitHub Actions, never received.
- **No local per-finding trace for CI runs.** Ingest lands **aggregates** only (counts,
  cost, duration); per-finding detail lives on the GitHub PR and the Actions job, reachable
  by an outbound link.
- **The multi-run service and the PR feed are untouched.** Ingest reuses the **existing run
  model** (agent runs tagged `source='ci'`) plus the CI run record; no parallel run model is
  invented.
- **No automatic cleanup of a committed workflow.** Deleting or disabling an exported agent
  in the studio does **not** remove the workflow already committed to the repo; the repo is
  only modified again through a new export PR. This orphaned-workflow case is a known
  limitation, not a bug to fix here.

## User stories

- As a maintainer, I want to deploy a debugged agent to my repo's CI in a few guided steps,
  so every pull request gets an automatic grounded review without me running it by hand.
- As a maintainer, I want the CI setup to arrive as a normal pull request I can review, so I
  trust exactly what will run before it takes effect.
- As a maintainer, I want a blocker-severity finding to stop a merge, so risky changes
  can't land unreviewed — and I want that without installing a GitHub App.
- As a maintainer, I want automated CI reviews to show up in the studio next to local runs,
  so I have one place to see an agent's review history, cost, and findings over time.
- As a maintainer, I want to deploy several specialized agents to the same repository, so
  each concern (e.g. security vs. style) reviews independently and their configs don't
  clobber each other.
- As a security-conscious maintainer, I want to read every line of what gets committed and
  be certain secrets never reach fork PRs, so I can trust the deployment is minimal and
  auditable.
- As a maintainer who later tweaks an agent, I want the studio to tell me when a repo is
  running an older config than the agent's current one, so I can push a targeted update
  instead of guessing.

## Screens & states

Three surfaces come from the approved design. Exact user-facing copy is pinned here so it
can't drift in the build; pixel layout, component choice, and colour tokens are out of
scope (HOW).

### N12 — Export Wizard (modal, opened from an agent's CI tab)

Title **"Export to CI"**, subtitle **"Run <Agent> automatically on pull requests"**.
A four-step stepper: **Target → Preview → Configure → Install**.

- **Target** — pick a destination.
  - **GitHub Actions** — "Runs on `pull_request` events", badge **"recommended"** —
    *selectable* (the only functional target).
  - **CircleCI** ("config.yml job"), **Jenkins** ("Pipeline stage"), **Generic CLI**
    ("`devdigest review --pr`") — shown but **disabled** ("coming soon"), non-selectable.
- **Preview** — a **"FILES TO CREATE"** file tree of everything that will be committed;
  selecting a file shows its contents, marked with an **"editable"** badge (the workflow
  especially). The committed set is: the agent manifest `.devdigest/agents/<slug>.yaml`,
  each linked skill `.devdigest/skills/<slug>.md`, the **empty** `.devdigest/memory.jsonl`,
  the bundled agent-runner file(s) under `.devdigest/`, and the generated workflow
  `.github/workflows/devdigest-review-<slug>.yml`.
- **Configure**
  - **Trigger** chips: `pull_request:opened` and `pull_request:synchronize` **on by
    default**, `pull_request:reopened` optional.
  - **"Post results as"** radio: **"GitHub review"** (badge "recommended" — the only option
    that yields a verdict), **"PR comment"**, **"None (exit code only)"**.
  - Merge-block hint: *"To block merges: set **Fail CI on** (CI tab) so the run exits
    non-zero, then add a **required status check** in the repo's GitHub branch protection.
    No GitHub App needed."*
- **Install**
  - Primary (recommended): **"Open a PR with these files"** — *"DevDigest opens a PR in
    `<owner/repo>` titled 'Add DevDigest CI review' with the generated files."*
  - Degraded: **"Copy files as a zip"** — "add them manually".
  - Footer: *"Need help? See the GitHub Action setup docs →"*.
  - Navigation: **Back** / **Continue** across steps; final action **Install**.

### N13 — CI Runs page (top-level nav item "CI Runs", GLOBAL section)

- Header **"CI Runs"** / subtitle **"Agent reviews executed inside CI · not local runs"**.
- An **auto-refresh indicator** ("auto-refresh on") and a **Refresh** button.
- Filters: **date range** ("Last 7 days"), **agent** ("All agents"), **repo**
  ("All repos"), **status** ("All statuses"), **source** ("All sources").
- Table columns: **Timestamp**, **Pull request** (`#num` + title), **Agent**, **Source**,
  **Duration**, **Findings** (CRITICAL / WARNING / SUGGESTION counts, "—" when none),
  **Cost**, **Status**, and a **Trace** link out to the GitHub Actions job.
- Status values (three only): **"Succeeded"**, **"No findings"**, **"Failed"**.
- **Empty state**: **"No CI runs yet"** / *"Once you export an agent to CI, every automated
  review shows up here."* / CTA **"Set up CI for an agent"**.

### Agent CI tab (on the agent editor, alongside Config / Skills / Context / Evals / Stats)

- **Not-yet-exported (empty) state**: **"Not in CI yet"** / *"Deploy this agent to run
  automatically on every pull request in a repo's CI pipeline."* / CTA **"Add to CI"** →
  opens the wizard.
- **Exported state**: header **"CI deployment"** + badge **"Active in N repos"**; buttons
  **"Update CI config"** and **"Add to CI"**.
  - A **"Fail CI on"** segmented control — **Critical** / **Warning +** / **Never** — with
    copy *"Exit non-zero when a finding at or above this severity lands. Pair with a required
    status check to block merges."*
  - One row per repo installation: repo name, target ("GitHub Actions"), **status**,
    **workflow version**, **last-run** relative time, and an **"update available"** drift
    indicator when the installed version lags the agent's current config.
  - **"Add repository"** affordance, plus this agent's CI run history.
- CI runs for this agent also appear in the agent's existing **Stats** run history, tagged
  **source = CI**.

Every screen/state above maps to an acceptance criterion below, or to a Non-goal (the
disabled CircleCI/Jenkins/CLI targets; memory accrual; local per-finding trace).

## Acceptance criteria (EARS)

Each criterion is one testable EARS statement.

**Export wizard — Target & Preview**

- **AC-1** — WHILE the Export wizard is open, the system shall present GitHub Actions as a
  selectable target badged "recommended", and CircleCI, Jenkins, and Generic CLI as visible
  but non-selectable ("coming soon") targets.
- **AC-2** — WHEN the maintainer reaches the Preview step, the system shall list exactly the
  files that will be committed — the agent manifest at `.devdigest/agents/<slug>.yaml`, one
  file per linked skill at `.devdigest/skills/<slug>.md`, the empty `.devdigest/memory.jsonl`,
  the bundled agent-runner file(s), and the generated workflow at
  `.github/workflows/devdigest-review-<slug>.yml`.
- **AC-3** — WHEN the maintainer selects a file in the Preview tree, the system shall show
  that file's full contents and mark it editable, so the maintainer can inspect and adjust
  it before installing.
- **AC-4** — The system shall include the bundled agent-runner as a committed file in the
  Preview tree and the resulting PR, and shall reference no external or marketplace action
  in the workflow (the runner ships in the same PR).
- **AC-5** — The exported `.devdigest/memory.jsonl` shall be empty on export.

**Export wizard — Configure**

- **AC-6** — WHEN the maintainer reaches the Configure step, the system shall default the
  triggers to `pull_request:opened` and `pull_request:synchronize`, and offer
  `pull_request:reopened` as an optional addition.
- **AC-7** — The system shall offer three "Post results as" choices — GitHub review
  (default), PR comment, None (exit code only) — and shall label GitHub review as the only
  choice that yields a review verdict.
- **AC-8** — The Configure step shall display guidance stating that blocking a merge
  requires setting "Fail CI on" and adding a repository required status check, and that no
  GitHub App is needed.

**Export wizard — Install (open a PR / zip)**

- **AC-9** — WHEN the maintainer confirms "Open a PR with these files", the system shall
  make a single atomic commit of all generated files onto a `devdigest/ci` branch and open a
  pull request titled "Add DevDigest CI review", without committing anything to the default
  branch directly.
- **AC-10** — WHERE the "Copy files as a zip" path is chosen, the system shall provide the
  same generated file set for manual installation.
- **AC-11** — IF opening the PR fails (e.g. no write access, or the CI token cannot create a
  PR), THEN the system shall report the failure and offer the zip path as a fallback,
  without leaving a partial or half-committed export.
- **AC-12** — IF a skill linked to the agent cannot be resolved at export time, THEN the
  system shall block the export and name the unresolved skill, so no manifest referencing a
  skill absent from the bundle is ever committed.

**Manifest — one contract, two consumers**

- **AC-13** — The system shall serialize the agent (name, provider, model, system prompt,
  linked skill slugs, strategy, and "Fail CI on" policy) into the manifest, and shall
  validate that manifest against the same schema the CI runner uses to read it.
- **AC-14** — IF the manifest fails validation against the shared schema, THEN the system
  shall refuse to export rather than commit an invalid manifest.

**Idempotency, slugs & multiple agents per repo**

- **AC-15** — The system shall derive each agent's slug from its name and make it unique
  within the workspace, appending a disambiguating suffix when two agents would otherwise
  produce the same slug.
- **AC-16** — WHEN a maintainer exports two different agents to the same repository, the
  system shall give each its own manifest (`.devdigest/agents/<slug>.yaml`) and its own
  workflow (`.github/workflows/devdigest-review-<slug>.yml`), so neither overwrites the
  other and both run independently.
- **AC-17** — WHEN a maintainer re-exports an agent to a repository it is already installed
  in, the system shall update the existing installation in place — reusing the same
  `devdigest/ci` branch and existing open PR — and shall not create a duplicate installation
  or a second PR.

**CI runner — reviewing a PR**

- **AC-18** — WHEN a pull request event fires one of the configured triggers, the runner
  shall collect that PR's diff, run the same review engine used locally (including the
  grounding gate), and produce grounded structured findings comparable to a local run of the
  same diff.
- **AC-19** — The runner shall post its results according to the chosen "Post results as"
  option: a GitHub review carrying a verdict, a PR comment, or nothing (exit code only).
- **AC-20** — WHEN the runner finishes a review, it shall write a `devdigest-result.json`
  result artifact carrying the run's aggregate findings count, per-severity breakdown, cost,
  duration, agent identity, and PR number.

**Merge gating without a GitHub App**

- **AC-21** — The "Fail CI on" control shall offer exactly three levels — Critical,
  Warning+, and Never — governing the severity at or above which the run exits non-zero.
- **AC-22** — WHILE "Fail CI on" is set to Critical, WHEN a review produces a CRITICAL
  finding, the runner shall post a REQUEST_CHANGES verdict and exit non-zero, so that a
  repository required status check blocks the merge — with no GitHub App involved.
- **AC-23** — WHILE "Fail CI on" is set to Never, the system shall always exit zero
  regardless of finding severity, so the review never blocks a merge.
- **AC-24** — WHERE "Post results as" is None and "Fail CI on" is Critical, the system shall
  post nothing to the PR yet still exit non-zero on a CRITICAL finding, so the check can
  block a merge without any visible PR comment or review.

**Security guarantees (core WHY)**

- **AC-25** — The generated workflow shall request only `contents: read` and
  `pull-requests: write` permissions, and no broader scope.
- **AC-26** — The system shall reference the API key only via a CI secret
  (e.g. `${{ secrets.OPENROUTER_API_KEY }}`) and the CI-provided `GITHUB_TOKEN`, and shall
  never embed a key in the workflow or the manifest.
- **AC-27** — IF a review runs on a pull request from a fork (or the API-key secret is
  otherwise unavailable), THEN the runner shall never access or expose the secret, shall
  post nothing, shall record the run as "skipped — no credentials", and shall not block the
  merge.
- **AC-28** — The runner shall treat the PR diff, PR title/body, and any comment/issue text
  as data, never as instructions, and shall not trigger any action from the content of PR or
  issue comments.
- **AC-29** — The system shall generate a workflow whose every line is human-readable and
  editable, with no hidden or external marketplace action, so a maintainer can read and
  explain exactly what will run.

**Ingest — pulling results back into the studio**

- **AC-30** — WHEN the studio reconciles CI runs, it shall pull the `devdigest-result.json`
  artifact and the Actions run metadata and digest their aggregates into the existing run
  model (an agent run tagged `source='ci'`) plus a CI run record, without reconstructing a
  local per-finding trace.
- **AC-31** — The system shall validate a pulled result artifact against the shared schema
  before ingest; IF the artifact is present but schema-invalid, THEN the system shall record
  the run as Failed with a note and shall not fabricate findings or cost from it.
- **AC-32** — IF an Actions run produced no artifact (the job failed or errored before
  upload), THEN the system shall record the run as Failed and shall not fabricate findings
  or cost; WHILE an Actions run is still in progress, the system shall show it as running.
- **AC-33** — WHEN a CI run both executed successfully and produced one or more blocker
  findings (a REQUEST_CHANGES verdict), the system shall present it as **Succeeded** while
  conveying the blocked-merge state through its verdict and CRITICAL count — reserving
  **Failed** for runs where the runner itself failed to produce a review.
- **AC-34** — WHEN the studio reconciles CI runs, it shall bound the work to a recent window
  (the last N runs / last 7 days per installed repo) and shall do so on page view and on
  manual Refresh.

**CI Runs page**

- **AC-35** — The CI Runs page shall list ingested CI runs with Timestamp, Pull request,
  Agent, Source, Duration, Findings (CRITICAL / WARNING / SUGGESTION counts), Cost, Status,
  and an outbound Trace link to the GitHub Actions job.
- **AC-36** — The CI Runs page shall let the maintainer filter runs by date range, agent,
  repo, status, and source.
- **AC-37** — WHILE no CI runs have been ingested, the CI Runs page shall show the empty
  state "No CI runs yet" with the CTA "Set up CI for an agent".

**Agent CI tab**

- **AC-38** — WHILE an agent has no CI installations, its CI tab shall show the "Not in CI
  yet" empty state with an "Add to CI" CTA that opens the Export wizard.
- **AC-39** — WHILE an agent has one or more CI installations, its CI tab shall show "CI
  deployment", an "Active in N repos" count, an "Update CI config" and "Add to CI" action,
  the "Fail CI on" segmented control, and one row per repo showing repo name, target,
  status, workflow version, and last-run relative time.
- **AC-40** — WHEN the maintainer changes an agent's configuration after export and a repo's
  installed workflow version lags the agent's current config, the CI tab shall show that
  repo as "update available", so "Update CI config" is a targeted action.
- **AC-41** — WHEN a maintainer re-exports or updates an installation's configuration, the
  system shall increase that installation's workflow version, so a repo running an older
  config is distinguishable from one running the current config.
- **AC-42** — The system shall present each ingested CI run in the owning agent's existing
  Stats run history tagged source = CI, in addition to the CI Runs page.

## Edge cases

- **Fork PR / no secret** — the review runs without any credential: it accesses no secret,
  posts nothing, is recorded as "skipped — no credentials", and does not block the merge
  (AC-27). This must be visually distinct from both a clean pass and a runner failure.
- **Intentional merge-block vs. runner failure** — a run that found a CRITICAL and exited
  non-zero on purpose (to block the merge) is Succeeded-with-blockers, not Failed; Failed is
  only for the runner failing to produce a review (AC-33). Both are "red" in GitHub Actions
  but mean opposite things.
- **Re-export after editing the agent** — updating an already-installed repo reuses the same
  branch/PR/installation and bumps the workflow version rather than creating duplicates
  (AC-17, AC-41).
- **Two agents, same repo** — each has its own slug-keyed manifest and workflow and runs
  independently; neither overwrites the other (AC-16).
- **Slug collision** — two agents whose names would slugify identically get a disambiguating
  suffix so their manifests and workflows never collide (AC-15).
- **Unresolvable linked skill at export** — export is blocked and the skill is named; nothing
  is committed (AC-12).
- **Open-PR failure** — reported, with the zip path offered as a fallback and no partial
  commit left behind (AC-11).
- **`devdigest/ci` branch already exists** from a prior export — treated as the idempotent
  update path (reuse/refresh), not an error (AC-17).
- **Actions run still in progress** — surfaced as running until an artifact is available; no
  findings/cost are shown yet (AC-32).
- **Missing artifact (job failed early)** — recorded as Failed with no fabricated
  findings/cost (AC-32).
- **Schema-invalid artifact** — recorded as Failed with a note; no findings/cost invented
  (AC-31).
- **Post-as = None with a blocker** — nothing appears on the PR, yet the check still exits
  non-zero and can block the merge (AC-24).
- **Orphaned workflow** — deleting or disabling an exported agent in the studio leaves the
  committed workflow running in the repo; the studio no longer tracks that installation and
  does not auto-remove the file (known limitation, per Non-goals).
- **Repo secret absent but PR is same-repo (not a fork)** — the runner still has no key, so
  it follows the same "skipped — no credentials" path (AC-27); adding the secret is the
  documented manual step.
- **Empty diff / no findings** — a run that executes cleanly and produces zero findings is
  shown with the "No findings" status, not Failed.

## Cross-module interactions

Behavioural hand-offs only — what information or decision must flow, and when. Not the
wiring.

- **Studio → GitHub (export)** — WHEN the maintainer installs an export, the system shall
  make the generated file set available to the repository as a single atomic commit on a
  `devdigest/ci` branch and an opened pull request (AC-9). Re-export against an
  already-installed repo shall reuse the existing branch and open PR (AC-17).
- **Studio manifest ⇄ CI runner** — the agent's serialized configuration shall be made
  available to the runner as a manifest validated by the **same** schema on both ends, so the
  runner executes the exact configuration the studio produced (AC-13).
- **CI runner → GitHub PR** — WHEN a review completes, the runner shall make its findings
  available on the PR per the chosen post-as option and its verdict/exit-code available to
  the CI check per the "Fail CI on" policy (AC-19, AC-22).
- **CI runner → result artifact** — WHEN a review completes, the runner shall make the run's
  aggregate outcome available as a `devdigest-result.json` artifact for the studio to pull
  later (AC-20).
- **GitHub Actions → studio (ingest)** — WHEN the studio reconciles, it shall pull each
  recent run's artifact and Actions metadata and make its aggregates available in the
  existing run model (`source='ci'`) and the CI run record, then surface them on the CI Runs
  page and the agent's CI tab and Stats history (AC-30, AC-35, AC-42).
- **Agent config → CI tab drift** — WHEN an agent's configuration changes after export, the
  system shall make the difference between a repo's installed workflow version and the
  agent's current config visible as an "update available" state (AC-40).

## Non-functional

- **Least privilege** — the generated workflow requests no permission beyond
  `contents: read` and `pull-requests: write` (AC-25); any additional scope is a defect.
- **No secret exposure** — no code path makes the API key available to a fork PR, and no key
  is ever written into the manifest, the workflow, or the committed bundle (AC-26, AC-27).
- **Fidelity** — a CI review of a given diff produces findings comparable to a local run of
  the same diff with the same agent configuration (AC-18); "comparable" means the same
  engine and grounding gate, not a byte-identical LLM transcript (the model tier is not
  deterministic).
- **Auditability** — the entire committed bundle, workflow included, is human-readable with
  no external action; a reviewer can read every line in the export PR (AC-29).
- **Bounded ingest** — reconciliation touches only a recent window (last N runs / last 7
  days per installed repo) so the studio never scans unbounded Actions history (AC-34).
- **Idempotence** — repeated exports to the same repo converge on one installation, one
  branch, one open PR (AC-17); running the wizard twice is safe.

## Inputs (provenance)

- Agent configuration (name, model, provider, system prompt, linked skill slugs, strategy,
  "Fail CI on" policy) — [reused: existing agent config from prior lessons] — read to build
  the manifest; no new computation.
- Linked skill bodies bundled into `.devdigest/skills/<slug>.md` — [reused: existing skill
  content] — copied verbatim into the bundle.
- Generated CI bundle (manifest, workflow, empty memory.jsonl, bundled runner) — [deterministic:
  serialized from agent config] — no LLM call; reproducible from the same agent + options.
- CI review findings produced by the runner on a PR — [new: 1+ LLM call(s) per PR review,
  executed in GitHub Actions, not in the studio] — the same engine/grounding as a local run;
  the cost is incurred in CI, not by the studio.
- `devdigest-result.json` artifact + Actions run metadata pulled on ingest — [reused: produced
  by the CI runner] — the ingest itself makes no LLM call (deterministic digest of aggregates).
- CI installations and CI run records — [reused: DB tables already provisioned] — filled by
  export and ingest respectively.

## Untrusted inputs

This feature reads foreign, attacker-influenceable text in two places and must treat all of
it as **data, never instructions**:

- **The PR diff, PR title/body, and any PR/issue comment text** read by the CI runner — a
  fork contributor fully controls these. The runner shall handle them as review input only
  (relying on the existing engine's guard) and shall not trigger any action from the content
  of PR or issue comments (AC-28). Fork PRs additionally receive no secret (AC-27), so the
  most exposed case also runs without a credential.
- **The `devdigest-result.json` artifact** pulled from GitHub Actions on ingest — although
  produced by our own runner, it originates from an environment influenced by the PR. The
  studio shall validate it against the shared schema before ingest and treat it as data;
  a schema-invalid artifact is recorded as Failed with a note and never drives fabricated
  findings, cost, or actions (AC-31).
