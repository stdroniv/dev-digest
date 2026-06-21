# Changelog — pr-self-review

All notable changes to this skill are documented here. The current version is recorded in
`metadata.version` in `SKILL.md`. Versioning follows [Semantic Versioning](https://semver.org/):
bump **major** for breaking gate/behavior changes, **minor** for new routing/checks,
**patch** for clarifications and fixes.

## [1.1.0] — 2026-06-21

Switched to **manual-only** mode by default.

### Changed
- The skill is now triggered solely via `/pr-self-review`. The automatic after-commit
  (`PostToolUse`) and before-push (`PreToolUse` + native `pre-push`) hooks were unwired
  from `.claude/settings.json` and `.git/hooks/`, so neither commits nor pushes are
  intercepted automatically.
- In manual mode the recorded verdict is **advisory** — the skill reports `PASS`/`BLOCKED`
  but does not by itself stop a `git push`.
- `SKILL.md` documents how to re-enable the automatic gate (re-add the two `settings.json`
  hook entries + run `scripts/install-hooks.sh`). All hook scripts are retained, just inert.

## [1.0.0] — 2026-06-21

Initial release.

### Added
- `SKILL.md` — the pre-push gate procedure: collect branch diff → route changed files to
  skills → emit severity-tagged findings → gate on CRITICAL → record verdict / block push.
- `references/routing.md` — changed-path → skill mapping (`client/**`, `server/**`,
  `reviewer-core/**`, cross-cutting) and the vendor/migrations skip list.
- `references/severity.md` — CRITICAL/WARNING/SUGGESTION rubric and the finding format,
  aligned with `findings.ts` and the `failOn = 'critical'` gate in `to-review.ts`.
- `scripts/collect-diff.sh` — branch-vs-`main` diff (+ uncommitted/staged), with fallback.
- `scripts/record-verdict.sh` — writes `.git/pr-self-review.json` for the push gates.
- `scripts/gate.sh` — native pre-push gate; reads the verdict, runs the review headlessly
  when stale, blocks on BLOCKED.
- `scripts/install-hooks.sh` — installs `.git/hooks/pre-push`.
- `../../hooks/block-git-push.sh` — Claude Code `PreToolUse` deny gate for `git push`.

### Wiring
- `.claude/settings.json` — `PostToolUse` (after `git commit`) auto-invokes the skill;
  `PreToolUse` (before `git push`) runs `block-git-push.sh` to deny on a non-PASS verdict.

### Gate semantics
- Mirrors the product: only **CRITICAL** (severity rank 3) trips the gate. The escape
  hatch (`git push --no-verify`) is always disclosed, never hidden.
