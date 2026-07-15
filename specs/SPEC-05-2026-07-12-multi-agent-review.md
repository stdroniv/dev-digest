# Spec: Multi-Agent Review  |  Spec ID: SPEC-05  |  Status: approved

**Supersedes:** none

## Problem & why
DevDigest can already run several review agents on a single PR — each in its own context,
with failure isolation — but there is no way for a user to *choose* which agents to run,
to *preview* what a run will cost or take before launching it, or to *compare* the agents'
findings afterwards. Today the only affordance is a "one agent or all" dropdown, results
are not grouped, and there is no cost/time signal before launch. As teams add more review
agents (security, performance, architecture, mentor, customer-facing, …), users need to
(a) fan out a curated set of agents on demand, (b) understand the cost/time trade-off up
front, and (c) read the results in a way that makes duplicates and disagreements obvious
rather than confusing. This matters because the value of multiple agents is lost if their
overlapping and conflicting findings can't be reconciled, and because launching many
model runs without a cost preview is a trust and budget risk.

## Goals / Non-goals
**Goals**
- Let a user pick a set of enabled agents to run on a PR, from a lightweight picker on the
  PR page (replacing the current "one or all" dropdown) and from a dedicated Configure run
  page.
- Show a per-agent and total time/cost estimate *before* launch, grounded in past runs — a
  new pre-launch mechanic the product does not have today.
- Persist a multi-agent run as a group that ties together the individual per-agent runs it
  launched, so it can be retrieved and re-rendered later.
- Present the results on a dedicated Multi-Agent Review page with two switchable views:
  a per-agent **Columns** view and a per-agent **Tabs + detail** view.
- Group findings across agents by the same code location ("Where agents disagree"), showing
  each agent's verdict — including "did not flag" — and a "Show only conflicts" toggle, so
  duplicates read as one place and disagreements become visible.
- Keep each finding's producing-agent attribution in the persisted data, as raw material for
  a later Per-Agent Stats screen.
- In the Tabs + detail view, let the user act on a finding: Accept, Dismiss, Learn (persist a
  Memory record seeded from the finding), and Turn into eval case (seed a "must find" eval
  case from the finding).
- Show live per-agent status in the results while a run is in progress, and link to each
  agent's run trace, reusing the existing live-log/replay and trace surfaces.

**Non-goals**  <!-- explicit boundaries — what we are deliberately NOT doing -->
- **Compose Review** (the curate-findings-before-publishing drawer) — explicitly out; it is a
  separate feature and is not touched here.
- Changing how reviews execute: the parallel-capable run route, the run-executor, the
  agent-runner, and `ci/` are reused as-is and are **out of bounds** to modify. In
  particular, execution is sequential per agent and this feature does not change that.
- A dedicated **Per-Agent Stats** screen — only the raw attribution/grouping data is captured
  now; the screen itself is future work.
- **Semantic / "essence" similarity** matching of findings — v1 groups by file + line-range
  overlap only; cross-title/semantic similarity is deferred to a later spec.
- Injecting a grouped multi-agent-run entry into the PR page's normal reviews/history list —
  the grouped view lives only on the Multi-Agent Review page for v1.
- Any new outbound LLM call of this feature's own — the agent reviews reuse existing engine
  calls; grouping and estimates are deterministic.

## User stories
- As a reviewer, I want to pick a specific set of agents to run on a PR, so that I fan out
  exactly the perspectives I care about instead of "one or all".
- As a reviewer, I want to see the estimated time and cost of a run before I launch it, so
  that I can weigh the value against the budget.
- As a reviewer, I want to compare each agent's findings side by side, so that I can judge
  which perspective caught what.
- As a reviewer, I want overlapping findings on the same line collapsed into one place that
  shows each agent's take (including who stayed silent), so that duplicates stop being noise
  and genuine disagreements stand out.
- As a reviewer, I want to Accept or Dismiss a finding, teach the system from it (Learn), or
  turn it into an eval case, so that a review produces durable improvements, not just a
  one-off read.
- As a reviewer, I want to watch each agent's progress live and open its trace, so that I can
  see what a slow or failing agent is doing.
- As a reviewer, I want to reopen a finished multi-agent run later, so that I can revisit the
  comparison without re-running it.

## Screens & states
The design defines the following surfaces. Exact user-facing copy is pinned here; where the
mock's copy promises "parallel"/"fan-out", it must be revised to honest wording (execution is
sequential — see Non-functional). Pixel layout, colours, and component choice are HOW and are
left to the plan.

**1. Agent picker on the PR page** (replaces the current "one or all" dropdown)
- States: closed; open with a selection; open with nothing selected.
- Copy: header "Pick agents to run"; per-agent row = agent name + a time/cost guideline;
  "Select all" / "Clear"; footer "Configure agents…".
- Run action label by selection count: 0 → "Select an agent" (disabled); 1 → "Run <agent
  name>"; N>1 → "Run multi-agent review (N)".

**2. Configure run page** (breadcrumb: Multi-Agent Review › Configure run)
- Title "Run a Multi-Agent Review"; subtitle revised to not claim parallelism (e.g. "Pick a
  pull request and choose which agents to run — compare their findings side by side.").
- Step 1 "Pull request": a picker with placeholder "Select a pull request…" listing only
  eligible (non-stale) PRs.
- Step 2 "Agents to run": gated until a PR is chosen.
  - *No PR selected*: empty state titled "Pick a pull request first", body "Choose which PR to
    review above, then select the agents to run on it." Step 2 label is de-emphasised; run
    action disabled.
  - *PR selected*: one selectable card per enabled agent showing name, a short summary, and a
    time/cost guideline from past runs; "Select all" / "Clear all".
- Run bar: action label by count — N>1 → "Run multi-agent review (N)"; 1 → "Run 1 agent"; 0 →
  "Select agents" (disabled). Estimate shown when a PR and ≥1 agent are chosen, honest wording:
  "≈ <sum>s · $<sum> · N agents" (no "parallel fan-out").

**3. Multi-Agent Review results page**
- *No agents selected*: empty state titled "No agents selected", body "Pick at least one agent
  to fan out this review. Configure the run to choose agents.", CTA "Configure run".
- *Populated*: header with a "Configure run" affordance, title "Multi-Agent Review", a
  "N selected agents" label (no "· parallel"), and a **Columns / Tabs** view switch (default
  Columns). A meta row shows the PR number + title and "N agents · <sum>s total · $<sum>"
  (honest total time = sum; no "parallel"/"fan-out" claim).
- *In progress / running*: per-agent headers show live status (running → done/failed);
  per-agent duration/cost/score populate as each agent completes.

**3a. Columns view** — one column per agent: header = agent identity + "<dur>s · $<cost>" +
score; body = that agent's findings (severity + title + file:line each); footer = "View trace"
link + "N findings". Followed by the "Where agents disagree" section (only when ≥2 agents ran).

**3b. Tabs + detail view** — one tab per agent (name + score); detail panel = agent identity +
summary + "View trace" + "<dur>s · $<cost>", then finding cards. A finding's detail shows its
confidence and suggested fix and offers **Accept / Dismiss / Learn / Turn into eval case**.
Followed by the "Where agents disagree" section (only when ≥2 agents ran).

**3c. "Where agents disagree" section** — label "Where agents disagree" + a "Show only
conflicts" toggle. Each row = a code location (file:line + title); for every agent that
reviewed the PR, a verdict pill (uppercase severity) or "did not flag" (muted), plus that
agent's note.

**Coverage note:** every design surface above maps to an AC below, except the picker's
"Configure agents…" destination (see [NEEDS CLARIFICATION]) and Compose Review (Non-goal).

## Acceptance criteria (EARS)

### Navigation & entry points
- **AC-1** — The system shall provide a top-level navigation entry "Multi-Agent Review" that
  opens the Configure run experience with no pull request pre-selected.
- **AC-2** — The system shall present, on the PR page, an agent picker (replacing the prior
  "one or all" run dropdown) that lists every enabled agent in the workspace, each with a
  time/cost guideline and a checkbox to include it, plus "Select all" and "Clear" affordances.

### Launch flow from the PR-page picker
- **AC-3** — WHILE no agent is selected in the PR-page picker, the system shall disable the run
  action and label it "Select an agent".
- **AC-4** — WHEN exactly one agent is selected in the PR-page picker and the run action is
  activated, the system shall label the action "Run <agent name>" and run that single agent as
  an inline single-agent review on the PR page, without creating a multi-agent run.
- **AC-5** — WHEN more than one agent is selected in the PR-page picker and the run action is
  activated, the system shall label the action "Run multi-agent review (N)" (N = count of
  selected agents), launch a multi-agent run for that PR over the selected set, and navigate to
  the Multi-Agent Review results page with the PR and selected set reflected.

### Configure run page
- **AC-6** — The Configure run page shall present a two-step flow: step 1 selects a pull
  request and step 2 selects agents.
- **AC-7** — The Configure run page's pull-request picker shall list only eligible (non-stale)
  pull requests.
- **AC-8** — WHILE no pull request is selected on the Configure run page, the system shall gate
  the agent step behind an empty state titled "Pick a pull request first" and disable the run
  action.
- **AC-9** — WHEN a pull request is selected on the Configure run page, the system shall enable
  the agent step and list every enabled agent as a selectable card showing the agent name, a
  short summary, and its time/cost guideline, with "Select all" and "Clear all" affordances.
- **AC-10** — WHEN at least one agent is selected on the Configure run page and the run action
  is activated, the system shall launch a multi-agent run for the selected PR over the selected
  agents and navigate to the results page; a single-agent selection produces a valid multi-agent
  run with no "Where agents disagree" section (see AC-26).

### Pre-launch estimate (new mechanic)
- **AC-11** — WHERE a selected agent has at least one recent completed run in the workspace,
  the system shall show that agent's estimated time and cost as the mean of its recent completed
  runs.
- **AC-12** — IF a selected agent has no completed-run history, THEN the system shall show "no
  history" in place of a time/cost estimate for that agent and exclude it from the total
  estimate.
- **AC-13** — WHEN a pull request and one or more agents are selected, the system shall display
  a total pre-launch estimate whose time is the sum of the selected agents' estimated times and
  whose cost is the sum of their estimated costs.
- **AC-14** — The system shall not describe a multi-agent run as parallel in the estimate or
  anywhere in this feature's copy (execution is sequential).

### Results page — shell, totals, and view switch
- **AC-15** — The results page shall show the reviewed PR's number and title, the count of
  agents in the run, a total time equal to the sum of the agents' durations, and a total cost
  equal to the sum of their costs.
- **AC-16** — The results page shall provide a switch between a Columns view and a Tabs view,
  defaulting to Columns.
- **AC-17** — The results page shall provide a "Configure run" affordance that returns to the
  Configure run experience with the current PR and agent selection preserved.
- **AC-18** — IF the results page is opened with no agents in the run, THEN the system shall
  show an empty state titled "No agents selected" with a "Configure run" call to action.

### Columns view
- **AC-19** — WHILE in Columns view, the system shall render one column per agent in the run,
  each column header showing the agent's identity, its duration, its cost, and its score.
- **AC-20** — WHILE in Columns view, each agent column shall list that agent's findings — each
  showing severity, title, and file:line — and a footer with a "View trace" link and the
  finding count.

### Tabs + detail view and finding actions
- **AC-21** — WHILE in Tabs view, the system shall present one tab per agent (showing name and
  score) and a detail panel for the selected agent containing its score, summary, duration,
  cost, a "View trace" link, and its findings.
- **AC-22** — WHILE viewing a finding in the Tabs detail panel, the system shall show the
  finding's confidence and suggested fix and offer four actions: Accept, Dismiss, Learn, and
  Turn into eval case.
- **AC-23** — WHEN the user activates Accept or Dismiss on a finding, the system shall persist
  that finding's disposition and reflect the new disposition in the view.
- **AC-24** — WHEN the user activates "Turn into eval case" on a finding, the system shall
  create a durable "must find" eval case seeded from that finding and confirm the outcome to the
  user.
- **AC-25** — WHEN the user activates "Learn" on a finding, the system shall create a durable
  memory record seeded from that finding, attributable to the finding and its producing agent,
  and confirm the outcome to the user.

### "Where agents disagree" grouping
- **AC-26** — WHERE at least two agents reviewed the PR, the system shall present a "Where
  agents disagree" section that groups findings by code location — same file with overlapping
  inclusive line ranges — derived from the run's persisted findings.
- **AC-27** — For each grouped location, the system shall show every agent that reviewed the PR
  and, for each, either its verdict/severity at that location or "did not flag".
- **AC-28** — The "Where agents disagree" section shall provide a "Show only conflicts" toggle
  that, WHEN on, hides locations where all reviewing agents agreed, leaving only conflicts.
- **AC-29** — The system shall treat a location as a conflict when at least one reviewing agent
  flagged it and at least one other reviewing agent did not, OR when reviewing agents assigned
  divergent severities to it.
- **AC-30** — IF fewer than two agents reviewed the PR, THEN the system shall not show the
  "Where agents disagree" section.

### Live status, trace, and failure isolation
- **AC-31** — WHILE a multi-agent run is in progress, the system shall show each agent's live
  status (running, done, or failed) in its column/tab header and update it without a manual
  refresh as the agent progresses.
- **AC-32** — The system shall offer a per-agent "View trace" affordance that opens that agent's
  run trace / live log.
- **AC-33** — IF one agent's run fails, THEN the system shall mark that agent's column/tab as
  failed and continue to present the other agents' results, without failing the whole
  multi-agent run.
- **AC-34** — IF every agent in a multi-agent run fails, THEN the system shall present the run
  as failed while still allowing each agent's trace to be inspected.

### Persistence, revisiting, and grouping
- **AC-35** — WHEN a multi-agent run is launched, the system shall produce exactly one agent run
  per selected agent, each associated with the one multi-agent run, and shall persist each
  finding's producing-agent attribution.
- **AC-36** — WHEN a multi-agent run completes, the system shall persist the run so that it can
  later be retrieved and re-rendered — including per-agent status, score, duration, cost,
  findings, totals, and the disagreement grouping.
- **AC-37** — WHEN the user opens a previously completed multi-agent run, the system shall
  render it from the persisted data in both Columns and Tabs views.
- **AC-38** — The individual agent runs within a multi-agent run shall also appear in the PR's
  normal per-agent run history.
- **AC-39** — The system shall not add a grouped multi-agent-run entry to the PR page's reviews
  list.

## Edge cases
- **Agent with no run history** — no mean is available: show "no history" for that agent and
  exclude it from the total estimate (AC-12); the agent is still selectable and runnable.
- **Single-agent (degenerate) multi-run** — launching one agent from the Configure run page
  produces a valid run rendered with one column/tab and no "Where agents disagree" section
  (AC-10, AC-30).
- **Agent produces zero findings** — its column/tab renders with an empty findings area and a
  finding count of 0; it still contributes duration/cost/score and still appears in the
  disagreement grouping as "did not flag" at every location.
- **One agent fails, others succeed** — the failed agent's column/tab shows a failed state with
  its trace still openable; other agents' results and the disagreement grouping over the
  successful agents are shown (AC-33). A failed agent contributes no findings to the grouping.
- **All agents fail** — the run is presented as failed but each agent's trace remains
  inspectable (AC-34); no findings and no disagreement section.
- **Second run launched while one is in progress on the same PR** — the system creates and
  displays a new, independent multi-agent run rather than blocking or reusing the in-progress
  one; both remain retrievable.
- **Stale PRs** — excluded from the Configure run PR picker (AC-7).
- **Non-TS/JS repository** — the underlying reviews degrade to diff-only (an existing engine
  behaviour, out of bounds here); agents still run and the page renders whatever findings
  result. The disagreement grouping (file + line-range overlap) still applies to those findings.
- **Revisiting a run whose findings' dispositions changed** — because the disagreement grouping
  is derived from persisted findings (AC-26), a reopened run reflects the findings as persisted
  at view time, not a stale stored copy.

## Cross-module interactions
Behavioural hand-offs only — what information or decision must flow, and when. The wiring is
the plan's job.
- WHEN a run is launched from the picker or Configure run page, the system shall convey the
  **selected set** of agents (not merely "one" or "all") to the run capability, and shall
  associate the resulting per-agent runs with one multi-agent run grouping (AC-35).
- WHILE a multi-agent run is in progress, the system shall make each agent's **live status and
  progress** available to the results page as they change, reusing the existing live-log/replay
  stream, so headers update without a manual refresh (AC-31).
- WHEN the results page needs a per-agent trace, the system shall make that agent's **run trace
  / live log** available via the existing trace surface (AC-32).
- WHEN the Configure run page needs a per-agent estimate, the system shall make each agent's
  **aggregated past-run statistics** (recent-run mean latency and cost, and run count)
  available to the picker (AC-11, AC-12).
- WHEN a multi-agent run completes, the system shall make the **grouped run** — per-agent
  status/score/duration/cost/findings, totals, and the disagreement grouping — available to the
  client for both live display and later retrieval (AC-36, AC-37).
- WHEN the user activates "Turn into eval case", the system shall make the finding available to
  the **eval capability** to seed a "must find" case (AC-24).
- WHEN the user activates "Learn", the system shall make the finding available to the **memory
  capability** to persist a durable, attributable memory record (AC-25).
- The individual per-agent runs shall remain visible in the PR's normal run history, while the
  grouped view is confined to the Multi-Agent Review page (AC-38, AC-39).

## Non-functional
- **Honest cost/time signal.** Because execution is sequential and the engine is out of bounds,
  every time figure this feature shows — the pre-launch estimate and the results-page total —
  shall be the **sum** of the selected agents' per-agent times, and no copy shall claim
  parallelism or "fan-out". A user must never be shown a wall-clock number the product cannot
  achieve.
- **Estimate provenance.** Per-agent estimates shall be reproducible from the agent's persisted
  past-run history (deterministic aggregate), with no LLM call.
- **No added model cost.** This feature shall introduce no new outbound LLM call of its own; the
  agent reviews reuse existing per-agent engine calls, and grouping/estimates/actions are
  deterministic.
- **Determinism of grouping.** Given the same set of persisted findings, the disagreement
  grouping and the conflict classification shall be reproducible (derived from file paths and
  numeric line ranges, not from a model).
- **Live update latency.** In-progress per-agent status shall update in the results view without
  a manual page refresh (reusing the existing streaming surface).

## Inputs (provenance)
- Selected agent set — **[user input]** from the PR-page picker or the Configure run page.
- Selected pull request — **[user input]** (Configure run) or the current PR (PR-page picker).
- Per-agent findings, verdict/severity, score, duration, cost, summary, and status —
  **[reused: existing per-agent review runs produced by the run-executor]**; this feature reads
  and groups them, it does not compute them.
- Per-agent pre-launch time/cost estimate — **[deterministic: repo-intel-style aggregation of
  the agent's past runs]**; mean of recent completed runs, no LLM.
- Cross-agent disagreement grouping & conflict classification — **[deterministic: file +
  inclusive line-range overlap match over persisted findings]**; no LLM, no semantic matching in
  v1.
- Live per-agent status and per-agent run trace — **[reused: existing live-log/replay stream and
  trace surface]**.
- Eval case seeded from a finding — **[reused: existing "create eval case from finding" path]**.
- Memory record seeded from a finding — **[new: minimal memory-write path]**; deterministic
  (seeded from finding text, no LLM).

## Untrusted inputs
This feature reads and displays foreign, attacker-influenceable text: PR title/body, file
paths, and agent-produced finding titles, notes, summaries, and suggested fixes (which are
themselves derived from the PR diff). All of it shall be handled as **data, never as
instructions**:
- Finding/PR text rendered in columns, tabs, and the disagreement section is display data only;
  the feature performs no instruction-following over it.
- Grouping matches on file paths and numeric line ranges only — never on model interpretation of
  the text.
- A "Learn" action persists a memory record seeded from foreign-derived finding text; that
  stored record shall be marked/treated as **data** so that a future review which reads Memory
  does not execute it as instructions. (This feature adds no LLM call itself, so it has no
  prompt-injection surface of its own; the obligation is to persist the record as data, not to
  define the downstream guard — that is the consuming feature's concern.)

## Resolved decisions
- The PR-page picker's "Configure agents…" footer link routes to the existing agent-management
  surface (the `/agents` screen). Confirmed by the coordinator.
