#!/usr/bin/env bash
# Forge Daemon Control Script
# Usage: bash scripts/forge/daemon-ctl.sh {start|stop|status|logs|restart}

set -euo pipefail

# ── Paths ─────────────────────────────────────────────────────────────────────
FORGE_HOME="${HOME}/.forge"
DAEMON_PID_PATH="${FORGE_HOME}/daemon.pid"
DAEMON_LOG_PATH="${FORGE_HOME}/daemon.log"
DAEMON_SCRIPT="scripts/forge/daemon.ts"

# ── Colors ────────────────────────────────────────────────────────────────────
dim() { echo -e "\x1b[2m$*\x1b[0m"; }
yellow() { echo -e "\x1b[33m$*\x1b[0m"; }
green() { echo -e "\x1b[32m$*\x1b[0m"; }
red() { echo -e "\x1b[31m$*\x1b[0m"; }

# ── Helpers ───────────────────────────────────────────────────────────────────
get_pid() {
  if [[ -f "$DAEMON_PID_PATH" ]]; then
    cat "$DAEMON_PID_PATH"
  else
    echo ""
  fi
}

is_running() {
  local pid="$1"
  [[ -n "$pid" ]] && ps -p "$pid" > /dev/null 2>&1
}

# ── Commands ──────────────────────────────────────────────────────────────────
start_daemon() {
  local pid
  pid="$(get_pid)"

  if [[ -n "$pid" ]] && is_running "$pid"; then
    red "✗ daemon already running (PID $pid)"
    exit 1
  fi

  # Clean up stale PID file
  if [[ -n "$pid" ]] && ! is_running "$pid"; then
    yellow "→ found stale PID file ($pid), cleaning up..."
    rm -f "$DAEMON_PID_PATH"
  fi

  # Ensure forge home exists
  mkdir -p "$FORGE_HOME"

  # Start daemon detached
  yellow "→ starting daemon..."
  # shellcheck disable=SC2024
  nohup npx tsx "$DAEMON_SCRIPT" > "$DAEMON_LOG_PATH" 2>&1 &
  local daemon_pid=$!

  # Disown the process so it survives shell exit
  disown

  # Wait a moment for daemon to initialize and write PID file
  sleep 2

  # Verify it's running
  if is_running "$daemon_pid"; then
    green "✓ daemon started (PID $daemon_pid)"
    dim "  log: $DAEMON_LOG_PATH"
    exit 0
  else
    red "✗ daemon failed to start (check $DAEMON_LOG_PATH)"
    exit 1
  fi
}

stop_daemon() {
  local pid
  pid="$(get_pid)"

  if [[ -z "$pid" ]] || ! is_running "$pid"; then
    red "✗ daemon not running"
    exit 2
  fi

  yellow "→ stopping daemon (PID $pid)... SIGTERM sent"
  kill -TERM "$pid"

  # Wait up to 10s for graceful shutdown
  local waited=0
  dim "  waiting up to 10s..."
  while is_running "$pid" && [[ $waited -lt 10 ]]; do
    sleep 1
    ((waited++))
  done

  if is_running "$pid"; then
    yellow "  → still running after 10s, sending SIGKILL"
    kill -KILL "$pid" 2>/dev/null || true
    sleep 1
  fi

  if ! is_running "$pid"; then
    # Clean PID file
    rm -f "$DAEMON_PID_PATH"
    green "✓ daemon stopped"
    exit 0
  else
    red "✗ failed to stop daemon (PID $pid)"
    exit 3
  fi
}

show_status() {
  local pid
  pid="$(get_pid)"

  if [[ -z "$pid" ]]; then
    red "✗ daemon not running"
    dim "  (no PID file at $DAEMON_PID_PATH)"
    exit 2
  fi

  if ! is_running "$pid"; then
    red "✗ daemon not running"
    yellow "  PID file points to $pid but process not running (stale)"
    exit 2
  fi

  # Running — show details
  green "✓ daemon running (PID $pid)"

  # Get uptime
  if command -v ps > /dev/null; then
    local uptime
    uptime=$(ps -p "$pid" -o etime= 2>/dev/null | xargs || echo "unknown")
    dim "  uptime: $uptime"
  fi

  # Try to get last heartbeat from DB (optional, may fail if DB unavailable)
  if command -v psql > /dev/null && [[ -n "${DIRECT_URL:-}" ]]; then
    local last_heartbeat
    last_heartbeat=$(psql "$DIRECT_URL" -qtAX -c "
      SELECT
        EXTRACT(EPOCH FROM (NOW() - \"lastHeartbeatAt\"))::int || 's ago (' || hostname || ')'
      FROM \"ForgeDaemon\"
      ORDER BY \"lastHeartbeatAt\" DESC
      LIMIT 1
    " 2>/dev/null || echo "DB unavailable")

    if [[ "$last_heartbeat" != "DB unavailable" ]] && [[ -n "$last_heartbeat" ]]; then
      dim "  last heartbeat: $last_heartbeat"
    else
      dim "  last heartbeat: DB unavailable"
    fi
  fi

  exit 0
}

# ── Main ──────────────────────────────────────────────────────────────────────
case "${1:-}" in
  start)
    start_daemon
    ;;
  stop)
    stop_daemon
    ;;
  status)
    show_status
    ;;
  *)
    echo "Usage: bash scripts/forge/daemon-ctl.sh {start|stop|status}"
    exit 64
    ;;
esac
