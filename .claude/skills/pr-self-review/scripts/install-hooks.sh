#!/usr/bin/env bash
#
# install-hooks.sh — install the native git pre-push gate (run once per clone).
#
# Writes .git/hooks/pre-push to call this skill's gate.sh. The Claude Code
# PostToolUse/PreToolUse hooks live in .claude/settings.json (committed) and need
# no install step. Idempotent: re-running overwrites our managed hook only.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
HOOKS_DIR="$(git rev-parse --git-path hooks)"
PRE_PUSH="$HOOKS_DIR/pre-push"
GATE_REL=".claude/skills/pr-self-review/scripts/gate.sh"

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

mkdir -p "$HOOKS_DIR"

if [[ -f "$PRE_PUSH" ]] && ! grep -q 'pr-self-review' "$PRE_PUSH"; then
  warn "An existing .git/hooks/pre-push was found; backing it up to pre-push.bak"
  cp "$PRE_PUSH" "$PRE_PUSH.bak"
fi

cat > "$PRE_PUSH" <<EOF
#!/usr/bin/env bash
# Managed by pr-self-review (install-hooks.sh). Blocks push on CRITICAL findings.
# Override a single push with: git push --no-verify
set -euo pipefail
ROOT="\$(git rev-parse --show-toplevel)"
exec bash "\$ROOT/$GATE_REL"
EOF

chmod +x "$PRE_PUSH"
log "Installed pre-push gate → $PRE_PUSH"
log "It calls $GATE_REL on every \`git push\` (override: git push --no-verify)."
