#!/usr/bin/env bash
# start.sh — stack de dev do Zordon: daemon (background) + app Next (foreground).
#
# Reinicia os DOIS de uma vez. Chat/tools de agente vivem nos dois repos:
#   • app    = execução das tools (/api/agents/tools) + prompt (prepare-turn)
#   • daemon = lista de tools exposta via MCP (mcp-server)
# Mudou tool/prompt? Roda isto e os dois pegam o estado novo.
#
# O daemon sobe em BACKGROUND (serviço; logs em ~/.zordon-daemon/daemon.log via
# o launcher próprio dele). O app sobe em FOREGROUND — você vê HMR/erros e o
# Ctrl+C derruba só o app (o daemon segue vivo; use 'stop' pra derrubar tudo).
#
# Uso:
#   ./start.sh                 # restart daemon (bg) + Next foreground (porta 3333)
#   ./start.sh 4000            # idem, porta custom
#   ./start.sh --app-only      # só o app (não toca no daemon)
#   ./start.sh --daemon-only   # só o daemon (restart bg) e sai
#   ./start.sh stop            # derruba app (porta) + daemon
#
# Env:
#   ZORDON_DAEMON_DIR  — caminho do repo zordon-daemon (default: ../zordon-daemon)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DAEMON_DIR="${ZORDON_DAEMON_DIR:-$SCRIPT_DIR/../zordon-daemon}"
cd "$SCRIPT_DIR"

PORT=3333
APP=1
DAEMON=1
ACTION=start

for arg in "$@"; do
  case "$arg" in
    stop)           ACTION=stop ;;
    --app-only)     DAEMON=0 ;;
    --daemon-only)  APP=0 ;;
    [0-9]*)         PORT="$arg" ;;
    -h|--help|help) awk 'NR==1{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "arg desconhecido: $arg (use -h)" >&2; exit 1 ;;
  esac
done

c_grn=$'\033[32m'; c_yel=$'\033[33m'; c_dim=$'\033[2m'; c_reset=$'\033[0m'
info() { printf '%s→%s %s\n' "$c_grn" "$c_reset" "$*"; }
warn() { printf '%s!%s %s\n' "$c_yel" "$c_reset" "$*"; }

# Libera a porta: TERM → espera ~1.5s → KILL. Menos abrupto que kill -9 seco.
# (PIDs são numéricos → split intencional e seguro; sem glob.)
free_port() {
  local pids; pids="$(lsof -ti :"$PORT" 2>/dev/null || true)"
  [ -z "$pids" ] && return 0
  info "porta $PORT ocupada — encerrando ($(echo "$pids" | tr '\n' ' '))"
  # shellcheck disable=SC2086
  kill -TERM $pids 2>/dev/null || true
  for _ in 1 2 3 4 5 6; do
    lsof -ti :"$PORT" >/dev/null 2>&1 || return 0
    sleep 0.25
  done
  pids="$(lsof -ti :"$PORT" 2>/dev/null || true)"
  # shellcheck disable=SC2086
  [ -n "$pids" ] && kill -KILL $pids 2>/dev/null || true
  return 0
}

# Delega o ciclo de vida do daemon pro launcher robusto dele (cwd-independente).
daemon() {
  if [ ! -x "$DAEMON_DIR/scripts/start.sh" ]; then
    warn "daemon start.sh não encontrado em $DAEMON_DIR — pulando daemon."
    warn "ajuste ZORDON_DAEMON_DIR se o repo estiver em outro lugar."
    return 1
  fi
  "$DAEMON_DIR/scripts/start.sh" "$@"
}

if [ "$ACTION" = stop ]; then
  [ "$APP" = 1 ]    && { info "parando app (porta $PORT)…"; free_port; }
  [ "$DAEMON" = 1 ] && { info "parando daemon…"; daemon stop || true; }
  exit 0
fi

# Daemon primeiro (bg, retorna rápido e não bloqueia o terminal).
if [ "$DAEMON" = 1 ]; then
  info "reiniciando daemon (background)…"
  daemon restart || warn "daemon restart falhou — seguindo com o app."
  printf '%slogs do daemon:%s %s/scripts/start.sh logs\n' "$c_dim" "$c_reset" "$DAEMON_DIR"
fi

if [ "$APP" = 1 ]; then
  free_port
  info "subindo Next em foreground na porta $PORT (Ctrl+C pra parar)…"
  exec npx next dev --port "$PORT"
fi
