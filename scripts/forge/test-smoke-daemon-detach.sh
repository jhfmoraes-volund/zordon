#!/usr/bin/env bash
# Smoke test: daemon detach + survival
# Tests that the daemon survives after the spawning shell is killed

set -euo pipefail

# ── Paths ─────────────────────────────────────────────────────────────────────
FORGE_HOME="${HOME}/.forge"
DAEMON_PID_PATH="${FORGE_HOME}/daemon.pid"
DAEMON_LOG_PATH="${FORGE_HOME}/daemon.log"
DAEMON_CTL="scripts/forge/daemon-ctl.sh"

# ── Colors ────────────────────────────────────────────────────────────────────
dim() { echo -e "\x1b[2m$*\x1b[0m"; }
yellow() { echo -e "\x1b[33m$*\x1b[0m"; }
green() { echo -e "\x1b[32m$*\x1b[0m"; }
red() { echo -e "\x1b[31m$*\x1b[0m"; }

# ── Cleanup trap ──────────────────────────────────────────────────────────────
cleanup() {
  dim "→ cleanup: stopping daemon..."
  bash "$DAEMON_CTL" stop 2>/dev/null || true
}
trap cleanup EXIT

# ── Test ──────────────────────────────────────────────────────────────────────
echo "──────────────────────────────────────────────────────────────────"
yellow "Smoke Test: Daemon Detach + Survival"
echo "──────────────────────────────────────────────────────────────────"
echo

# 1. Stop any existing daemon
dim "→ pre-test cleanup (stop any existing daemon)..."
bash "$DAEMON_CTL" stop 2>/dev/null || true
sleep 1

# 2. Start daemon in a subshell
dim "→ starting daemon in a subshell..."
(
  bash "$DAEMON_CTL" start
) &
SUBSHELL_PID=$!

# Wait for subshell to finish
wait "$SUBSHELL_PID" 2>/dev/null || true
sleep 2

# 3. Get daemon PID
if [[ ! -f "$DAEMON_PID_PATH" ]]; then
  red "✗ FAIL: PID file not created after start"
  exit 1
fi

DAEMON_PID=$(cat "$DAEMON_PID_PATH")

if [[ -z "$DAEMON_PID" ]]; then
  red "✗ FAIL: PID file is empty"
  exit 1
fi

green "✓ daemon started with PID $DAEMON_PID (subshell was $SUBSHELL_PID)"
echo

# 4. Verify subshell is dead but daemon is alive
dim "→ verifying subshell is dead..."
if ps -p "$SUBSHELL_PID" > /dev/null 2>&1; then
  yellow "⚠ subshell still alive (PID $SUBSHELL_PID) — this is unexpected but harmless"
else
  green "✓ subshell is dead (PID $SUBSHELL_PID)"
fi

dim "→ verifying daemon is still alive..."
if ! ps -p "$DAEMON_PID" > /dev/null 2>&1; then
  red "✗ FAIL: daemon died after subshell exit"
  exit 1
fi
green "✓ daemon still running (PID $DAEMON_PID)"
echo

# 5. Verify heartbeat in DB (if DIRECT_URL available)
if [[ -n "${DIRECT_URL:-}" ]]; then
  dim "→ checking heartbeat in DB..."

  # Wait up to 10s for a heartbeat to appear
  HEARTBEAT_FOUND=false
  for i in {1..10}; do
    HEARTBEAT=$(psql "$DIRECT_URL" -qtAX -c "
      SELECT COUNT(*) FROM \"ForgeDaemon\"
      WHERE \"lastHeartbeatAt\" > NOW() - INTERVAL '15 seconds'
    " 2>/dev/null || echo "0")

    if [[ "$HEARTBEAT" == "1" ]]; then
      HEARTBEAT_FOUND=true
      break
    fi

    dim "  attempt $i/10... no recent heartbeat yet"
    sleep 1
  done

  if [[ "$HEARTBEAT_FOUND" == true ]]; then
    green "✓ heartbeat found in DB (within last 15s)"
  else
    yellow "⚠ no heartbeat in DB (this may be expected if daemon is initializing)"
  fi
else
  yellow "⚠ DIRECT_URL not set, skipping DB heartbeat check"
fi

echo
echo "──────────────────────────────────────────────────────────────────"
green "✓ PASS: Daemon survived subshell exit"
echo "──────────────────────────────────────────────────────────────────"
dim "  PID: $DAEMON_PID"
dim "  Log: $DAEMON_LOG_PATH"
dim "  Cleanup will stop daemon on exit"
echo

exit 0
