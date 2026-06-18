---
name: engineering-insights
description: Record a hard-won engineering insight into the right module's INSIGHTS.md. Use proactively the moment you discover something non-obvious during a session — an approach that works, a dead-end/antipattern, a codebase convention, a tool/library quirk, a recurring error and its fix, or an open question. Also good as a wrap-up after meaningful problem-solving or debugging. Triggers on "note this", "remember this for later", or "that's a gotcha". Do NOT use for trivial changes (typo fixes, renames, formatting, config tweaks).
---

# Engineering Insights

Capture hard-won knowledge so the next session in this module doesn't re-discover it.
See `examples.md` for good vs bad entries.

When you learn something non-obvious in a module, append it to that module's INSIGHTS.md.

1. **Target the file** by where the work happened: root `INSIGHTS.md`, else `server/`, `client/`, `reviewer-core/`, or `e2e/INSIGHTS.md` (repo-intel → `server/INSIGHTS.md`). Spanned several? Write to each.
2. **Read it first.** If a related entry already exists, extend it instead of adding a near-duplicate.
3. **Pick one section**, creating the header if absent: **What Works**, **What Doesn't Work** (the most valuable — don't skip it), **Codebase Patterns**, **Tool & Library Notes**, **Recurring Errors & Fixes**, **Session Notes** (date with `### YYYY-MM-DD`), **Open Questions**.
4. **Quality gate** — write only if it passes all three: (a) *actionable cold* — another agent acts on it with zero context; (b) *non-obvious* — not learnable from 5 minutes of reading the code; (c) *not already in the file*. Name the file/symbol, the exact failure, and the fix. Good: "`Promise.all()` in the ingest pipeline times out past 30 items — use `Promise.allSettled()` in batches of 10." Bad: "be careful with async."
5. **Append only** — add `- ` bullets; never edit, reorder, or delete existing entries. If nothing passes the gate, write nothing.
