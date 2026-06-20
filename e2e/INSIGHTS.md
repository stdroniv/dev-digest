# e2e — Engineering Insights

Append-only log of non-obvious, hard-won lessons for this module (`@devdigest/e2e`).
Managed by the `engineering-insights` skill. Add each entry under one section; keep
it actionable cold; never edit or delete existing entries.

## What Works

## What Doesn't Work

- Don't assert icon+number UI (e.g. the severity FINDINGS counters from `FindingsCounts`) with `wait --text "<digit>"` — a bare "1"/"2" matches incidental text anywhere on the page and is non-deterministic. agent-browser matches visible DOM text only (NOT `aria-label`), so the counters carry no stable text anchor. Assert instead on a stable nearby label (e.g. the PR-list `wait --text "Findings"` column header in `04-pr-findings.flow.json`) and leave the exact numeric values to the server integration + client component tests.

## Codebase Patterns

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
