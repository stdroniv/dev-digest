#!/usr/bin/env bash
#
# gate.sh — the push gate. Used by the native .git/hooks/pre-push hook.
#
# Decision:
#   * fresh PASS verdict for current HEAD          → exit 0 (allow push)
#   * fresh BLOCKED verdict for current HEAD        → exit 1 (block push)
#   * missing/stale verdict (HEAD changed)          → run the review headlessly
#     via `claude -p "/pr-self-review"`, then re-read the verdict and decide.
#
# Honest escape hatch: `git push --no-verify` skips this entirely.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
GIT_DIR="$(git rev-parse --git-dir)"
VERDICT_FILE="$GIT_DIR/pr-self-review.json"
HEAD_SHA="$(git rev-parse HEAD)"

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*" >&2; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*" >&2; }
fail() { printf '\033[1;31m✖ %s\033[0m\n' "$*" >&2; }

# Extract a "key":"value" or "key":number field from the flat verdict JSON.
field() { sed -n "s/.*\"$1\":\"\{0,1\}\([^\",}]*\)\"\{0,1\}.*/\1/p" "$VERDICT_FILE" 2>/dev/null; }

read_verdict() {
  [[ -f "$VERDICT_FILE" ]] || { echo "MISSING"; return; }
  local v head
  v="$(field verdict)"; head="$(field head)"
  if [[ "$head" != "$HEAD_SHA" ]]; then echo "STALE"; return; fi
  echo "$v"
}

decide() {
  case "$(read_verdict)" in
    PASS)    log "pr-self-review: PASS — push allowed"; exit 0 ;;
    BLOCKED) fail "pr-self-review: BLOCKED ($(field critical) critical finding(s)). Fix them, or override with: git push --no-verify"; exit 1 ;;
    *)       return 1 ;;  # MISSING / STALE / unknown → caller re-runs
  esac
}

# 1) Decide from an existing fresh verdict if we can.
if decide; then :; fi

# 2) No fresh verdict — run the review headlessly, then decide again.
if ! command -v claude >/dev/null 2>&1; then
  fail "pr-self-review: no fresh verdict for $HEAD_SHA and the \`claude\` CLI is not on PATH."
  warn "Run /pr-self-review in Claude Code first, or override with: git push --no-verify"
  exit 1
fi

log "pr-self-review: no fresh verdict — running review headlessly…"
claude -p "/pr-self-review" >&2 || warn "headless review exited non-zero; reading recorded verdict"

if decide; then :; fi

fail "pr-self-review: review did not record a verdict for $HEAD_SHA — blocking to be safe."
warn "Run /pr-self-review manually, or override with: git push --no-verify"
exit 1
