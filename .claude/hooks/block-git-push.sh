#!/usr/bin/env bash
#
# block-git-push.sh — Claude Code PreToolUse hook (matcher: Bash, if: git push).
#
# Denies the `git push` tool call when the latest pr-self-review verdict for the
# current HEAD is BLOCKED, MISSING, or STALE. Allows the push only on a fresh PASS.
# Reads the hook payload on stdin; the bash command is at .tool_input.command.

set -euo pipefail

PAYLOAD="$(cat)"

# Extract the command (jq if present, else a portable sed fallback).
if command -v jq >/dev/null 2>&1; then
  CMD="$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.command // empty')"
else
  CMD="$(printf '%s' "$PAYLOAD" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p' | head -1)"
fi

# Only gate real pushes; let everything else through.
case "$CMD" in
  *git*push*) ;;
  *) exit 0 ;;
esac
# A dry run never reaches the remote — don't block it.
case "$CMD" in *--dry-run*) exit 0 ;; esac

deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$1"
  exit 0
}

GIT_DIR="$(git rev-parse --git-dir 2>/dev/null || echo .git)"
VERDICT_FILE="$GIT_DIR/pr-self-review.json"
HEAD_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
field() { sed -n "s/.*\"$1\":\"\{0,1\}\([^\",}]*\)\"\{0,1\}.*/\1/p" "$VERDICT_FILE" 2>/dev/null; }

[[ -f "$VERDICT_FILE" ]] || deny "pr-self-review has not run for this branch. Invoke /pr-self-review first; the push is blocked until it records a PASS."

VERDICT="$(field verdict)"; HEAD_RECORDED="$(field head)"; CRIT="$(field critical)"

[[ "$HEAD_RECORDED" == "$HEAD_SHA" ]] || deny "The pr-self-review verdict is stale (new commits since the last review). Re-run /pr-self-review before pushing."

case "$VERDICT" in
  PASS)    exit 0 ;;  # fresh pass → allow the push
  BLOCKED) deny "pr-self-review found ${CRIT} CRITICAL finding(s). Fix them and re-run /pr-self-review, or override deliberately with: git push --no-verify" ;;
  *)       deny "pr-self-review verdict is unknown for this HEAD. Re-run /pr-self-review before pushing." ;;
esac
