# client — Engineering Insights

Append-only log of non-obvious, hard-won lessons for this module (`@devdigest/web`).
Managed by the `engineering-insights` skill. Add each entry under one section; keep
it actionable cold; never edit or delete existing entries.

## What Works

## What Doesn't Work

## Codebase Patterns

## Tool & Library Notes

## Recurring Errors & Fixes

- RTL `getByText(/whole string/)` fails ("Unable to find an element") when JSX interpolates siblings: `{a} tok · {formatUsd(b)}` renders THREE text nodes ("9,731", " tok · ", "$0.012"), and `getByText` matches per-node by default. Fix in the component (not the test) by collapsing to one text node with a template literal: `{`${a} tok · ${formatUsd(b)}`}`. Done for the run cost line in `RunHistory.tsx`.

## Session Notes

## Open Questions
