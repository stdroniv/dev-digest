#!/usr/bin/env bash
#
# DevDigest MCP server control — the stdio MCP server in mcp/.
#
#   ./scripts/mcp.sh start      # run the server in the foreground (debug/standalone)
#   ./scripts/mcp.sh stop       # kill any stray standalone instance
#   ./scripts/mcp.sh restart    # stop, then start
#   ./scripts/mcp.sh status     # is an instance running? is Postgres reachable?
#   ./scripts/mcp.sh doctor     # check prerequisites without starting anything
#
# NOTE: this is a STDIO server, not a daemon. In normal use your MCP client
# (Claude Code / Claude Desktop, via .mcp.json) spawns it and stops it on
# disconnect — there is no port and no persistent process. `start`/`stop` here
# manage a STANDALONE instance for debugging; `start` reads JSON-RPC on stdin
# and exits on EOF (Ctrl-D) or Ctrl-C.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MCP_DIR="$ROOT/mcp"
ENTRY="src/index.ts"
# Pattern that matches a running standalone instance (tsx entry or the launcher shim).
PROC_PATTERN="mcp/src/index.ts|devdigest-mcp.mjs"
# Default mirrors .mcp.json; override by exporting DATABASE_URL before invoking.
: "${DATABASE_URL:=postgres://devdigest:devdigest@localhost:5432/devdigest}"

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
err()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }

# Parse host:port out of DATABASE_URL for a cheap TCP reachability probe.
db_hostport() {
  local hp="${DATABASE_URL#*@}"; hp="${hp%%/*}"
  echo "${hp%%:*} ${hp##*:}"
}

db_reachable() {
  read -r host port < <(db_hostport)
  (exec 3<>"/dev/tcp/${host}/${port}") 2>/dev/null && return 0 || return 1
}

running_pids() { pgrep -f "$PROC_PATTERN" 2>/dev/null || true; }

# --- prerequisite checks -----------------------------------------------------
doctor() {
  local fail=0
  command -v node >/dev/null && ok "node: $(node -v)" || { err "node not found (need ≥ 22)"; fail=1; }

  if [ -x "$MCP_DIR/node_modules/.bin/tsx" ]; then
    ok "mcp deps installed"
  else
    err "mcp deps missing — run: cd mcp && npm install"; fail=1
  fi
  if [ -d "$ROOT/server/node_modules" ]; then
    ok "server deps installed (heavy transitive deps resolve from here)"
  else
    err "server deps missing — run: cd server && npm install"; fail=1
  fi

  if db_reachable; then
    ok "Postgres reachable at $(db_hostport | tr ' ' ':')"
  else
    err "Postgres not reachable at $(db_hostport | tr ' ' ':') — start it: docker compose up -d (then cd server && pnpm db:migrate)"; fail=1
  fi

  if [ -f "$HOME/.devdigest/secrets.json" ]; then
    ok "secrets present (~/.devdigest/secrets.json)"
  else
    warn "no ~/.devdigest/secrets.json — list/get tools work, but review_pr needs LLM + GITHUB_TOKEN keys"
  fi

  return "$fail"
}

# --- subcommands -------------------------------------------------------------
start() {
  doctor || { err "prerequisites failed — fix the above before starting"; exit 1; }
  log "starting MCP server (foreground, stdio) — Ctrl-C or Ctrl-D to stop"
  cd "$MCP_DIR"
  exec env DATABASE_URL="$DATABASE_URL" node_modules/.bin/tsx "$ENTRY"
}

stop() {
  local pids; pids="$(running_pids)"
  if [ -z "$pids" ]; then
    log "no MCP instance running"
    return 0
  fi
  warn "this also kills instances your MCP client spawned — the client will respawn on next use"
  log "stopping MCP instance(s): $(echo "$pids" | tr '\n' ' ')"
  # SIGTERM triggers the server's graceful shutdown (closes server + pg pool).
  kill $pids 2>/dev/null || true
  for _ in $(seq 1 10); do
    [ -z "$(running_pids)" ] && { ok "stopped"; return 0; }
    sleep 0.3
  done
  warn "still running — sending SIGKILL"
  kill -9 $(running_pids) 2>/dev/null || true
  ok "stopped"
}

status() {
  local pids; pids="$(running_pids)"
  if [ -n "$pids" ]; then
    ok "MCP instance(s) running — PIDs: $(echo "$pids" | tr '\n' ' ')"
    log "(includes any spawned by an MCP client; normal use needs no standalone process)"
  else
    log "no MCP instance running (normal — the MCP client spawns it on demand)"
  fi
  db_reachable && ok "Postgres reachable at $(db_hostport | tr ' ' ':')" \
              || warn "Postgres NOT reachable at $(db_hostport | tr ' ' ':')"
}

case "${1:-}" in
  start)        start ;;
  stop)         stop ;;
  restart)      stop; start ;;
  status)       status ;;
  doctor|check) doctor ;;
  -h|--help|"") sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' ;;
  *)            err "unknown command: $1"; sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
