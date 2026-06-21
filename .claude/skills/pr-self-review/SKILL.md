---
name: pr-self-review
description: "Self-review the current branch's changes against DevDigest's own skill knowledge and flag any CRITICAL finding that should block a merge. Currently MANUAL-ONLY — invoke it as `/pr-self-review`; the automatic after-commit / before-push hooks are installed but disabled (see 'When this runs'). Use this whenever you have committed or are about to push branch work, want a pre-push review, ask to 'review my changes', 'self-review', 'check before pushing', or 'will this pass review?'. It diffs the whole branch vs `main`, routes each changed file to the matching architecture/quality skills (ui-frontend-architecture, react-best-practices, next-best-practices, backend-onion-architecture, security, etc.), emits severity-tagged findings (CRITICAL/WARNING/SUGGESTION), and reports BLOCKED on ≥1 CRITICAL — the local proxy for 'block merge'."
allowed-tools: Read, Grep, Glob, Bash, Skill
metadata:
  version: 1.1.0
  tags: pr-review, self-review, pre-push, git-hook, code-review, gate, findings, severity, ci, merge-block
  updated: 2026-06-21
---

# PR Self-Review

A self-review **gate**: review everything on the current branch using DevDigest's own
accumulated skill knowledge, classify problems by severity, and report **BLOCKED when
any CRITICAL finding exists**. A BLOCKED verdict is the local proxy for "block the
merge" — the change should not reach the remote (and therefore the PR/merge) until the
CRITICALs are fixed or explicitly overridden.

> **Mode: manual-only (current).** Run `/pr-self-review` yourself. The automatic
> after-commit trigger and the before-push enforcement are built but **switched off**
> (see "When this runs" for how to re-enable). In this mode the skill *reports* a
> verdict; it does not by itself stop a `git commit` or `git push`.

This skill reuses the repo's existing review vocabulary and gate semantics on purpose,
so a self-review reads the same as a DevDigest product review:
- Severity enum — `server/src/vendor/shared/contracts/findings.ts` (`CRITICAL | WARNING | SUGGESTION`).
- Gate semantics — `reviewer-core/src/output/to-review.ts` (`failOn = 'critical'`,
  `countBlockers`, `gateTriggered`); CRITICAL = rank 3, the gate minimum.

## When this runs

- **Manually (current mode)** — run `/pr-self-review` anytime; no commit/push needed.
  This is the only active trigger right now.
- **Automatically after a commit** *(disabled)* — a `PostToolUse` hook can invoke this
  skill once a `git commit` succeeds.
- **Strictly before a push** *(disabled)* — enforcement via a native `.git/hooks/pre-push`
  hook (catches pushes from any terminal) plus a `PreToolUse` hook that denies the
  `git push` tool call inside Claude Code; both read the verdict this skill records.

### Re-enabling the automatic gate

The hook scripts are kept ready; wiring them back on takes two steps:
1. Add the `PostToolUse` (`Bash` / `if: "Bash(git commit *)"`) and `PreToolUse`
   (`Bash` / `if: "Bash(git push *)"` → `.claude/hooks/block-git-push.sh`) entries to
   `.claude/settings.json`.
2. Install the native gate: `bash .claude/skills/pr-self-review/scripts/install-hooks.sh`.

## Procedure

Run these steps in order. Do not skip the gate.

### 1. Collect the changes

```sh
bash .claude/skills/pr-self-review/scripts/collect-diff.sh
```

It prints the base it diffed against, a `name-status` list of changed files (committed
branch work vs `main` **plus** any uncommitted/staged work), and the unified diff. If
there is no base branch / detached HEAD, it falls back to working-tree + staged changes.
**If the changed-file list is empty, print `PASS ✅ (no changes)` and stop** — record a
passing verdict (step 5) so the push isn't blocked.

### 2. Route changed files to skills

Read `references/routing.md` and, for each **area** that has at least one changed file,
invoke the matching skills with the `Skill` tool. Only invoke a skill when its area is
actually touched — no noise. Summary of the routing (full table in `references/routing.md`):

- `client/**` → `ui-frontend-architecture`, `react-best-practices`, `next-best-practices`;
  test files (`*.test.ts(x)`) also → `react-testing-library`.
- `server/**`, `reviewer-core/**` → `backend-onion-architecture`, `fastify-best-practices`,
  `drizzle-orm-patterns`.
- **Any** changed file (cross-cutting) → `security`, `zod`, `typescript-expert`.
- **Skip** `*/src/vendor/**` and existing `**/migrations/**` files (CLAUDE.md "Do not touch").

### 3. Evaluate and emit findings

Apply the loaded skills' rules to the changed lines. For every issue, emit one finding in
the shape and vocabulary of `Finding` (`findings.ts`) — see `references/severity.md` for
the rubric and exact format:

| field | value |
|-------|-------|
| `severity` | `CRITICAL` \| `WARNING` \| `SUGGESTION` |
| `category` | `bug` \| `security` \| `perf` \| `style` \| `test` |
| `file`, `start_line`, `end_line` | location in the diff |
| `title` | one-line summary |
| `rationale` | why it's a problem (cite the skill rule) |
| `suggestion` | the fix (optional) |

Ground every finding on a real changed line. If you can't point at a changed line, drop it.

### 4. Gate

Mirror `countBlockers(findings, 'critical')`: count findings whose severity is `CRITICAL`.
That count is `blockers`. Print the rollup exactly like the product's `composeBody`:

```
**<N> findings** · <c> critical · <w> warning · <s> suggestion
```

followed by the findings list, emoji-tagged 🔴 CRITICAL / 🟡 WARNING / 🔵 SUGGESTION.

### 5. Verdict and record

Print the verdict, then record it for the current HEAD (this also primes the gate for
when the automatic hooks are re-enabled):

```sh
bash .claude/skills/pr-self-review/scripts/record-verdict.sh <PASS|BLOCKED> <critical_count>
```

- **0 CRITICAL → `PASS ✅`** — record `PASS 0`.
- **≥1 CRITICAL → `BLOCKED 🔴`** — record `BLOCKED <n>`. Print the critical findings and
  state clearly that the change should not be pushed/merged until they're fixed.

In manual-only mode this verdict is **advisory** — the skill does not itself stop a
`git push`. If you have re-enabled the automatic gate, a `BLOCKED` verdict refuses the
push, and the honest escape hatch is `git push --no-verify` (skips the native hook).
Never hide that.

## First-time setup (only when re-enabling the automatic gate)

Manual `/pr-self-review` needs no setup. To turn the automatic before-push gate back on,
install the native hook once per clone (and add the `settings.json` entries — see
"Re-enabling the automatic gate" above):

```sh
bash .claude/skills/pr-self-review/scripts/install-hooks.sh
```
