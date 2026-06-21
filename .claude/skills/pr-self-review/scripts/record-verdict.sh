#!/usr/bin/env bash
#
# record-verdict.sh <PASS|BLOCKED> <critical_count>
#
# Persist the latest self-review verdict for the current HEAD so the push gates
# (the native pre-push hook and the Claude Code PreToolUse hook) can read it
# without re-running the review. Written inside .git so it is never committed.

set -euo pipefail

VERDICT="${1:?usage: record-verdict.sh <PASS|BLOCKED> <critical_count>}"
CRITICAL="${2:?usage: record-verdict.sh <PASS|BLOCKED> <critical_count>}"

case "$VERDICT" in
  PASS|BLOCKED) ;;
  *) echo "verdict must be PASS or BLOCKED, got: $VERDICT" >&2; exit 2 ;;
esac

GIT_DIR="$(git rev-parse --git-dir)"
HEAD_SHA="$(git rev-parse HEAD 2>/dev/null || echo 'unknown')"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
OUT="$GIT_DIR/pr-self-review.json"

printf '{"verdict":"%s","critical":%s,"head":"%s","ts":"%s"}\n' \
  "$VERDICT" "$CRITICAL" "$HEAD_SHA" "$TS" > "$OUT"

printf '\033[1;36m▸ recorded %s (%s critical) for %s → %s\033[0m\n' \
  "$VERDICT" "$CRITICAL" "${HEAD_SHA:0:9}" "$OUT"
