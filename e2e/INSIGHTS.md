# e2e — Engineering Insights

Append-only log of non-obvious, hard-won lessons for this module (`@devdigest/e2e`).
Managed by the `engineering-insights` skill. Add each entry under one section; keep
it actionable cold; never edit or delete existing entries.

## What Works

## What Doesn't Work

- Don't assert icon+number UI (e.g. the severity FINDINGS counters from `FindingsCounts`) with `wait --text "<digit>"` — a bare "1"/"2" matches incidental text anywhere on the page and is non-deterministic. agent-browser matches visible DOM text only (NOT `aria-label`), so the counters carry no stable text anchor. Assert instead on a stable nearby label (e.g. the PR-list `wait --text "Findings"` column header in `04-pr-findings.flow.json`) and leave the exact numeric values to the server integration + client component tests.

- `agent-browser` (verified v0.29.1) matches the **CSS-RENDERED** text, so a label styled `text-transform: uppercase` is matched in its UPPERCASE form — `wait --text "Cost"` / `"Findings"` FAIL against a header that renders as `COST` / `FINDINGS`. The vendored `SectionLabel` and the PR-list column headers use `text-transform: uppercase`, which is exactly why `02-repo-pulls-detail` (`wait --text "Cost"`) and `04-pr-findings` (`wait --text "Findings"`) fail locally on this binary version (confirmed: they fail identically on a clean `main` with the feature stashed — NOT a regression; CI may pin an older agent-browser that matched DOM text). Fix for new flows: assert on case-stable content — a `MetricCard` label (not transformed, e.g. `"Used by"`), an entity name (`"Performance Reviewer"`), a link (`"Open"`), or a lowercase donut-legend category (`"security"`) — NOT a `SectionLabel` heading. Pattern: `08-skill-stats.flow.json` deliberately avoids "Agents using this skill" / "Findings by category".

- agent-browser `wait --text` is CASE-SENSITIVE (corollary of matching rendered text): `"Cost"` does not match rendered `COST`. When in doubt about a label's casing, match a substring you can see verbatim in the running UI rather than the source-string casing.

## Codebase Patterns

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
