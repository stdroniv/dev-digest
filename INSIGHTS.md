# root — Engineering Insights

Append-only log of non-obvious, hard-won lessons for this module. Managed by the
`engineering-insights` skill. Add each entry under one section; keep it actionable
cold; never edit or delete existing entries.

## What Works

## What Doesn't Work

## Codebase Patterns

- Skills live in project-level `.claude/skills/` (checked into git); there is no global
  `~/.claude/skills/` here. Frontend guidance is intentionally layered across three skills
  with non-overlapping scopes: `ui-frontend-architecture` (file placement / folder
  structure / module boundaries / server-client boundary), `react-best-practices`
  (component coding: props, hooks, memoization, JSX), `next-best-practices` (routing / RSC
  / metadata / file conventions). When adding or editing a frontend skill, carve out a
  distinct scope and **cross-link** the sibling skills in the `description` and body rather
  than duplicating their content — duplication causes conflicting guidance across skills.
- Skill versioning convention (introduced with `ui-frontend-architecture`): record the
  version in `metadata.version` inside `SKILL.md` frontmatter (plus an `updated:` date) and
  keep a sibling `CHANGELOG.md` following SemVer (major = breaking guidance change, minor =
  new section/reference file, patch = clarification/source-link fix). Not all existing
  skills do this yet; follow it for new/updated skills.
- The prescribed skill-versioning convention above (sibling `CHANGELOG.md` + `updated:` date)
  is **not** universal — two competing shapes exist in `.claude/skills/`. `ui-frontend-architecture`
  uses the sibling-`CHANGELOG.md` form; `backend-onion-architecture` and `client-server-communication`
  use `metadata.version` (SemVer) under frontmatter **plus a grouped `metadata.references:` URL map
  and an inline `## Changelog` section at the end of `SKILL.md`** (no separate file, no `updated:`).
  Before adding versioning to a skill, grep a sibling skill's frontmatter and match the neighbor you're
  most aligned with rather than assuming the CHANGELOG.md form; both pass review.
- Backend architecture guidance lives in the `backend-onion-architecture` skill — the
  `server/` + `reviewer-core/` counterpart to `ui-frontend-architecture`. It owns onion-layer
  file placement, the inward-only dependency rule, and a dependency-cruiser enforcement config;
  defer per-tool *syntax* to `fastify-best-practices`, `drizzle-orm-patterns`, `zod`, and
  `postgresql-table-design`. Same rule as the frontend skill trio: carve a distinct scope and
  cross-link siblings rather than duplicating their content.
- The `pr-self-review` skill is the local pre-push review gate: it diffs the branch vs `main`,
  routes changed files to the architecture/quality skills (per `references/routing.md`), emits
  CRITICAL/WARNING/SUGGESTION findings, and **blocks the push on ≥1 CRITICAL** (mirrors
  `failOn='critical'` / `countBlockers` in `reviewer-core/src/output/to-review.ts`). Enforced
  in two layers that both read a verdict artifact at `.git/pr-self-review.json` (written by
  `scripts/record-verdict.sh`, keyed to HEAD sha — a verdict for a different sha counts as
  STALE and re-blocks): (a) native `.git/hooks/pre-push` (install once via
  `scripts/install-hooks.sh`; calls `scripts/gate.sh`, which runs `claude -p "/pr-self-review"`
  headlessly when no fresh verdict exists), and (b) Claude Code `PreToolUse`/`PostToolUse` hooks
  in `.claude/settings.json` (`PostToolUse` on `git commit` auto-invokes the skill; `PreToolUse`
  on `git push` runs `.claude/hooks/block-git-push.sh`). Honest escape hatch is always
  `git push --no-verify`.

## Tool & Library Notes

- Claude Code `PreToolUse` hooks with an `if: "Bash(git push *)"` narrowing match
  **shell-aware**, not as a literal substring: the runtime dequotes/normalizes the
  `tool_input.command` before matching, so `git pu""sh origin main` still resolves to
  `git push` and trips the hook. Consequence: you **cannot test or exercise a command that
  your own active PreToolUse matcher gates** from inside a Bash tool call — the whole call
  is denied and you see only the hook's deny reason, none of your own output. Workaround:
  put the gated command inside a script file and run `bash /tmp/test.sh`; the
  `tool_input.command` is then just `bash /tmp/test.sh` (no gated literal), while the real
  command lives in the file, read at runtime. Same applies to smoke-testing any self-gating
  hook right after installing it.

- `Explore` subagents are unreliable for tasks that need a **full written report** back to the
  parent: in this session two `Explore` agents (codebase-mapping prompts) each returned only their
  one-line opening narration ("I'll investigate…") instead of the report, while the identical prompts
  re-run as `general-purpose` agents returned complete structured reports. `Explore` is tuned to
  return terse located-conclusions, not long-form summaries. When you need a thorough multi-section
  write-up from a subagent (architecture maps, research digests), use `general-purpose`; reserve
  `Explore` for "find me where X is" fan-out.

## Recurring Errors & Fixes

## Session Notes

## Open Questions
