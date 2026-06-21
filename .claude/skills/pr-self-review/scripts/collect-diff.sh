#!/usr/bin/env bash
#
# collect-diff.sh — gather everything a PR self-review should look at.
#
# Prints, in order:
#   1. the base it diffed against,
#   2. a name-status list of changed files (committed branch work vs base
#      PLUS uncommitted + staged work), deduped,
#   3. the unified diff for the same range.
#
# Scope: the whole current branch vs `main` (a true PR self-review). Falls back
# to working-tree + staged changes when there is no base (detached HEAD / on main
# with nothing merged yet).

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

# --- resolve the base to diff against ----------------------------------------
# Prefer the merge-base with origin/main, then local main; if HEAD *is* that
# base (on main / nothing ahead), there is no committed range — use working tree.
BASE=""
for ref in origin/main main; do
  if git rev-parse --verify --quiet "$ref" >/dev/null; then
    if mb="$(git merge-base HEAD "$ref" 2>/dev/null)"; then
      BASE="$mb"
      BASE_REF="$ref"
      break
    fi
  fi
done

HEAD_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo '(no HEAD)')"

if [[ -n "$BASE" && "$(git rev-parse HEAD)" != "$BASE" ]]; then
  log "Base: $BASE_REF (merge-base ${BASE:0:9}) … HEAD ($HEAD_SHA) + uncommitted"
  RANGE_DESC="$BASE..HEAD"
else
  warn "No base ahead of HEAD — reviewing working tree + staged changes only"
  BASE=""
  RANGE_DESC="working tree + index"
fi

# --- changed files (committed range ∪ unstaged ∪ staged), deduped ------------
log "Changed files ($RANGE_DESC):"
{
  if [[ -n "$BASE" ]]; then git diff --name-status "$BASE"...HEAD; fi
  git diff --name-status                 # unstaged
  git diff --name-status --cached        # staged
} | sort -u

# --- unified diff ------------------------------------------------------------
echo
log "Unified diff:"
if [[ -n "$BASE" ]]; then
  git diff "$BASE"...HEAD
fi
git diff            # unstaged
git diff --cached   # staged
