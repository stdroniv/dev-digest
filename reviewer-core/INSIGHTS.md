# reviewer-core — Engineering Insights

Append-only log of non-obvious, hard-won lessons for this module
(`@devdigest/reviewer-core`). Managed by the `engineering-insights` skill. Add each
entry under one section; keep it actionable cold; never edit or delete existing entries.

## What Works

## What Doesn't Work

## Codebase Patterns

- The `skills` prompt slot (`assemblePrompt` in `src/prompt.ts`) is TRUSTED content: skill bodies are joined with `\n\n` under `## Skills / rules` and are deliberately NOT `wrapUntrusted()`-fenced (unlike the diff, PR body, repo-map, specs). The trust boundary is enforced upstream — the server's run-executor injects only `enabled` skills, and imported/community skills are created `enabled:false` until a human vets them. So if you add a new skill-like slot, decide trust explicitly: vetted house rules → plain; anything author/third-party-controlled → `wrapUntrusted`.

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
