# Changelog

All notable changes to the **workflow-retro** skill are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); versioning is
[SemVer](https://semver.org/).

## [0.1.0] - 2026-07-01

### Added
- **Initial release.** A manual, read-only retrospective for a finished
  multi-agent run (`/ship-feature`, the spec → plan → implement chain, a
  `Workflow()` fan-out, or any sub-agent batch). Acts as an analyst: reconstructs
  cost/process/qualitative metrics, recommends concrete change, prints a
  fixed-format chat report, and appends **one** trend row to
  `docs/retros/ledger.md` — never re-runs the workflow, never edits code or
  agent/skill definitions.
- **Deep-mode journal parser** (`scripts/analyze_journals.py`, stdlib-only,
  read-only): globs the flat `subagents/agent-*.jsonl` journals, aggregates
  tokens / cache splits / tool calls / spans per agent and total, and computes
  cache-hit %, parallelism, nested-agent count, and max depth. Prices are never
  hard-coded — pass `--prices` and confirm rates via the `claude-api` skill.
- **Nested-agent undercount guard** — parent `<usage>` blocks exclude children's
  tokens (a "1 agent / 75k" run was really 5 agents); the skill and the script
  both call this out and steer toward `deep` mode when spawn-capable agents ran.
- **One-file-write discipline** — the ledger row is the only unprompted write;
  any loop-back edit happens only after the user accepts a recommendation.
- **Explicit anti-auto-trigger clause** — must never be wired to a
  `Stop`/`SubagentStop`/`PreToolUse` hook or `settings.json`.

### Adapted from the upstream `workflow-retro` design
- **Versioning re-homed to this repo's convention** — dropped the upstream
  `tile.json` semver; version now lives in the SKILL.md frontmatter
  (`metadata.version`) alongside this `CHANGELOG.md`, matching `ship-feature`.
- **`allowed-tools` declared** (`Read, Grep, Glob, Bash, Edit, Write`), matching
  the repo's other workflow skill.
- **Heavy content split into `references/retro-formats.md`** to keep the hot path
  lean, mirroring `ship-feature/references/cost-discipline.md`; the two skills now
  cross-reference each other (this one *measures* whether a run followed the cost
  discipline the other *prescribes*).
- Wired explicitly to this repo's agents (`spec-creator`, `implementation-plan`,
  `implementer`, reviewers) and its `docs/retros/`, `docs/plans/`, `INSIGHTS.md`
  conventions.

### Improvements over the upstream design (best-practice research)
- **4Ls reflection frame** (Liked / Learned / Lacked / Longed-for) — the format
  fit for solo-dev + AI reflection — replaces the looser "well / hard / wasteful"
  section, with a documented Mad/Sad/Glad fallback for rough runs.
- **Blameless, systems-focused framing** (Google SRE) made explicit: every finding
  must name a fixable artifact, never a verdict on the model.
- **Recommendations hard-capped at 1–3, SMART + owned** — the strongest lever
  against action items that go nowhere / retro fatigue.
- **Four-signal recommendation taxonomy** (Fowler: context / instruction /
  workflow / failure) tags each rec with *which living artifact* to change.
- **Loop-back routing** — accepted recs are routed to their owning artifact
  (a `ship-feature` step, an agent brief, or `INSIGHTS.md` via
  `engineering-insights`), so improvements land where the next run will load them.
- **Carry-forward check** — each retro reads the previous ledger row and reports
  whether its top recommendation was actually applied, so the ledger drives change
  instead of accumulating ignored advice.
