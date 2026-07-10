# Design reference — Eval Pipeline screens

**Status:** design source of truth · **Feature:** SPEC-04 (Eval Pipeline) ·
**Extracted from:** `DevDigest Design (standalone).html` (compiled prototype).

> This is a **distilled, greppable** transcription of the design mockup so specs and plans
> can reference exact layout, copy, colour tokens, and states instead of eyeballing a
> screenshot. Screenshots show one state of one screen; this file pins **all** of them.
> When the design and this file disagree, re-extract (see [Re-extracting](#re-extracting)).
>
> **Scope note:** the design also contains `skill-evals` (Skill Editor · Evals). SPEC-04
> deliberately makes skill eval cases a **non-goal** — that cut is intentional, not a miss.

## How to consume this (spec-creator / implementation-plan)

- **spec-creator** — every screen below → an acceptance criterion or an explicit non-goal;
  copy the exact user-facing strings into the spec's *Screens & states* section.
- **implementation-plan** — anchor each task to a **screen id** here (`eval-dashboard`,
  not "design 2"); put the layout structure, colour token, copy, number format, and each
  empty/loading/error state into the task's Acceptance. Plan the demo data the populated
  states imply (run history, a precision regression).

## Design tokens (dark theme)

| Token | Value | Used for |
|-------|-------|----------|
| `--accent` | `#3b82f6` | **Recall** metric, primary buttons, selection |
| `--ok` | `#10b981` | **Precision** metric, "passing" badge, added diff |
| `--warn` | `#f59e0b` | **Citation** metric, regression alert, warn badge |
| `--crit` | `#ef4444` | failed status, removed-diff strike |
| `--code-add` | `rgba(16,185,129,.10)` | added prompt-diff token background |
| `--code-del` | `rgba(239,68,68,.10)` | removed prompt-diff token background |
| `--accent-text` | `#93bbfc` | run **version** labels (`v7`) |
| `--bg-elevated` `#1c1c1c` · `--bg-surface` `#141414` · `--bg-hover` `#242424` | | surfaces |
| `--border` `#2a2a2a` · `--border-strong` `#3a3a3a` | | borders |
| `--text-primary` `#ededed` · `--text-secondary` · `--text-muted` `#8a8a92` | | text |

**Metric colour convention (invariant across every eval surface):**
Recall → `--accent` (blue) · Precision → `--ok` (green) · Citation → `--warn` (amber).

## Full artboard inventory

Eval-relevant (bold = covered by SPEC-04):
**`eval-dashboard`** · **`agent-evals`** (Agent Editor · Evals tab) · **`eval-compare`**
(compare modal open) · **`evalcase`** (Eval Case Editor) · **`evalcase-seeded`** (seeded
from a dismissed finding) · `skill-evals` *(non-goal)* · `agent-stats` · `agent-ci`.

Other screens in the file (context only): `pr-overview`, `pr-runs`, `pr-files`, `dashboard`,
`memory`, `trace-hist`/`trace-live`/`trace-prompt`, `agent-config`/`-skills`/`-context`,
`agents-empty`, `skill-*`, `ma-cols`/`ma-tabs`, `agent-perf`, `ci-runs`, `set-auto`/`-int`,
`tour`, `context`, `conventions`, `conformance`, `blast-tree`/`blast-graph`, empty states.

---

## Screen: `eval-dashboard` — overview (component `AgentEvalOverview`)

**Layout: a vertical list of agent ROWS** (`flexDirection: column, gap: 8`) — **not** a card
grid. Max width 980, centered.

- **Header:** h1 "Eval Dashboard" · subtitle "Regression harness across all reviewer agents
  · pick an agent to see its runs" · right: primary sm button `Play` **"Run all agents"**.
- **Section label** (icon `Cpu`): "Agents".
- **Each agent row** (a full-width `button`, hover → `--bg-hover` + `--border-strong`):
  - 34×34 `--accent-bg` tile w/ `Cpu` icon.
  - **Agent name** (14.5px, 700) + **model badge** (mono 10.5px, bordered) — e.g. `gpt-4.1`.
  - Sub-line (muted 11.5px): `Last run {version} · {ran_at} · {passed}/{total} pass`, or
    **"No eval runs yet"** when empty.
  - **Recall Sparkline** (w60 h24, `--accent`) — only when ≥1 run.
  - Three **coloured** Mini metrics: `RECALL`/`PREC`/`CITE` → value `Math.round(v*100)+"%"`
    in accent/ok/warn; **"—"** when no runs.
  - `ChevronRight` (muted) at the row end.
- **Section label** (icon `History`): "Recent eval runs · all agents" → a table, columns
  `Agent · Ran at · Version · Recall · Precision · Citation · Pass` (metrics as `MiniBar`),
  newest 6 rows, each clickable → opens that agent.

## Screen: agent detail (component `ScreenEval`, opened from a row)

Max width 980. Back button `‹ All agents`.

- **Header:** h1 `{agent.name}` + mono model badge · subtitle "Regression harness · {N} run(s)
  on the 20-trace gold set". Right cluster: agent **Dropdown** (`Cpu` trigger, switches agent)
  · **`30 days`** ghost button (`Calendar` icon) · primary **"Run eval"** (`Play`).
- **Regression alert** (only when `precision delta < 0`): amber box (`--warn` border,
  `--warn-bg`), `AlertTriangle` + bold "Precision dipped {N}pts" + " on {version} — a new
  false positive slipped in. Recall and citation both up."
- **Three `MetricCard`s** (RECALL/PRECISION/CITATION ACCURACY): big `Math.round(v*100)`+`%`;
  **delta = the raw fraction** (e.g. `0.04`), rendered by MetricCard as `Math.abs(delta)`
  `.toFixed(2)` with ↑/↓/– icon; inline Sparkline in each (accent/ok/warn).
- **"Metric trend" card** (`SectionLabel` icon `TrendingUp`) + legend swatches Recall/Precision/
  Citation → multi-series `LineChart` (w900 h200).
- **"Recent runs"** (`SectionLabel` icon `History`) + "Select two runs to compare" / "{n}
  selected" + `Compare` button (`GitCompare`, primary only when exactly 2 selected).
  - Table cols: `☐ · Ran at · Version · Recall · Precision · Citation · Pass · Cost`.
    Metrics are `MiniBar`s; version in `--accent-text`; cost `"$"+cost.toFixed(2)`.
    Row-click toggles a max-2 selection (a checkbox fills `--accent`).

## Screen: `eval-compare` — compare modal (component `RunCompare`)

Opened by selecting two runs → Compare. **`Modal width: 960`**.

- **Title** "Compare runs · {aVer} → {bVer}" (a = older, b = newer) · **subtitle** "Old prompt
  vs new — metric deltas and prompt diff on the 20-trace gold set".
- **Footer:** ghost "Close" + **primary "Promote {bVer}"** with **`GitBranch`** icon (no
  confirm step in the design).
- **Four `CompareMetric` tiles:** Recall/Precision/Citation (`pct`) + **Cost** (not pct) —
  each shows `old → new` + delta.
- **"System prompt diff"** (`SectionLabel` icon `FileText`) + legend swatches:
  `--code-del` "{aVer} (old)" · `--code-add` "{bVer} (new)".
- **Token-level diff** (`diffTokens`): added tokens on `--code-add`, removed on `--code-del`
  with **line-through** (`--crit`), context in `--text-secondary`. Mono, `--code-bg` panel.

## Screen: `agent-evals` — Agent Editor › Evals tab (component `EvalsTab`)

Rendered inside `ScreenAgents`, whose editor has **6 tabs**: `Config · Skills · Context ·
Evals · Stats · CI`. Left rail: "Agents" + **"Add Agent"** dropdown (Create from scratch +
templates) + **"Search agents…"** + per-agent `AgentCard`s. Header: agent name + **"Run
Review"** dropdown.

Evals tab body (max width 720):
- `SectionLabel` (icon `Gauge`) "Eval metrics" · right `MonoLink` **"View full dashboard →"**.
- **`EvalMetricStrip`** — RECALL / PRECISION / CITATION ACCURACY / **Traces passed** tiles
  (traces shows `passed/total`; others `Math.round(v*100)+"%"`).
- Muted note (icon `Code`): "Scoring is mechanical — a finding counts when file matches and
  line ranges overlap. No model call in the scorer."
- Row: h2 "Eval cases" · Badge **"{pass} / {ran} passing"** (ok when all pass, else warn) ·
  Badge "{total} cases" (muted) · "Run all evals" (secondary) · "New eval case" (primary).
- **`EvalCaseRow` per case:** leading status icon (pass = check `--ok`, fail = x `--crit`,
  never-run = hollow dot) · mono slug **name** · result line **"expected N finding(s), got M
  · {duration} · ${cost}"** · expected badge (severity·category, or "assert empty").

### Eval-case fixture data (the demo set — 9 cases, both types)

| slug | type | from | status | result | expected |
|------|------|------|--------|--------|----------|
| `stripe-key-leak` | must_find | accepted | pass | expected 1, got 1 | CRITICAL · security |
| `ssrf-webhook` | must_find | accepted | pass | expected 1, got 1 | CRITICAL · security |
| `missing-retry-after` | must_find | accepted | **fail** | expected 1, got 0 | WARNING · bug |
| `n-plus-1-users-query` | must_find | accepted | pass | expected 1, got 1 | WARNING · perf |
| `lethal-trifecta-callback` | must_find | accepted | pass | expected 1, got 1 | CRITICAL · security |
| `no-unused-import-warning` | must_not_flag | dismissed | pass | expected 0, got 0 | assert empty |
| `no-raw-body-parser-flag` | must_not_flag | dismissed | **fail** | expected 0, got 1 | assert empty |
| `clean-refactor-no-flags` | must_not_flag | dismissed | pass | expected 0, got 0 | assert empty |
| `service-role-in-client` | must_find | accepted | **never** | never run | CRITICAL · security |

## Screens: `evalcase` / `evalcase-seeded` — Eval Case Editor (component `EvalCaseEditor`)

Modal for authoring/editing a case: name, frozen input (diff + PR meta), expected-output JSON
with live validation + a "finding skeleton" affordance. `evalcase-seeded` opens pre-filled
from a **dismissed** finding as a `must_not_flag` case (seed `{direction:"negative",
name:"no-unused-import-warning", file:"src/api/users.ts", line:3}`).

---

## Behaviour rules encoded in the design data (turn into ACs / edge cases)

- **Trend / sparkline** needs **≥2 runs**; a single point must render *without* a sparkline
  (dividing `i/(len-1)` by zero yields `NaN`). The demo ships **10 runs across 3 agents**.
- **Regression alert** fires *only* when precision delta < 0.
- **Recent runs / recent eval runs** are **newest-first**.
- **Deltas** are raw fractions rendered to 2 dp (`0.04`), **never** pre-multiplied by 100.
- **Compare** requires exactly two selected runs; older is `a`, newer is `b`; Promote targets `b`.

## Known build deviations (as of 2026-07-08)

The current implementation diverges from the above in: dashboard uses a **card grid** (design
= row list); metric values render **gray** (design = accent/ok/warn); metric-card delta was
**pre-multiplied** → `4.00` (fixed to `0.04`); single-point sparkline threw **NaN** (fixed);
compare modal is 720-wide with an ArrowUp+confirm Promote (design = 960, `GitBranch`, direct)
and a line-level plain-text diff (design = token-level, coloured swatches); no `30 days`
filter; no "Scoring is mechanical" note; the seed creates **cases but zero runs** (design
ships run history). Metric colours, rows layout, seed runs, and the compare-modal polish
remain open.

## Re-extracting

The design ships as a compiled bundle (`window.__resources` = a UUID→`{mime,compressed,data}`
map; each `data` is **gzip + base64**). To recover the readable source:

```js
const map = JSON.parse(<line containing window.__resources>);
for (const v of Object.values(map))
  if (/javascript|babel/.test(v.mime))
    console.log(zlib.gunzipSync(Buffer.from(v.data, "base64")).toString());
```

The eval screens live in module `screen_eval.jsx` (`ScreenEval`, `AgentEvalOverview`,
`RunCompare`, `CompareMetric`), the agent editor in `screen_agents.jsx` (`EvalsTab`,
`EvalCaseRow`), and the mock data in `EVAL` / `EVAL_CASES` / `AGENTS`.
