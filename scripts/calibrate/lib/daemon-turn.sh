#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# daemon-turn.sh — lib do RUNBOOK AUTOMATIZADO de calibração contra o DAEMON.
#
# PADRÃO NOVO (2026-06-21): a calibração da surface VIVA dos agentes (Vitoria/
# Alpha/Vitor no daemon) roda como runbook automatizado re-rodável, não como SQL
# ad-hoc. Este lib é o motor: enfileira um ChatTurn + ForgeJob (igual
# streamViaClaudeDaemon, menos o SSE), faz poll, e expõe asserts.
#
# O driver OpenRouter (scripts/calibrate/drivers/vitoria-cli.ts) continua válido
# pra reproduzir o engine in-process; ESTE harness é pra superfície de PROD.
#
# Uso (num runbook): source este lib, defina OWNER/SESSION/CEREMONY, chame
#   enqueue_daemon_turn <channel> <session> <title> <msg>   # seta TURN/THREAD
#   wait_turn "$TURN" [timeout_s]
#   assert_* "$TURN" ...
#   report
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ENQUEUE_SQL="$REPO_ROOT/scripts/calibrate/lib/enqueue-daemon-turn.sql"

# DIRECT_URL do .env do monorepo (DB compartilhado com o daemon).
if [[ -z "${DIRECT_URL:-}" ]]; then
  # shellcheck disable=SC1090
  source <(grep '^DIRECT_URL=' "$REPO_ROOT/.env" | sed 's/^/export /')
fi
[[ -n "${DIRECT_URL:-}" ]] || { echo "FATAL: DIRECT_URL não setado (.env)"; exit 1; }

# Member do facilitador (João) — owner dos jobs de teste.
OWNER="${OWNER:-dc4d91f5-0d29-453a-b11e-d42dd6a7b158}"

PASS_N=0; FAIL_N=0
declare -a FAILURES=()

_c_grn=$'\033[0;32m'; _c_red=$'\033[0;31m'; _c_dim=$'\033[2m'; _c_cyn=$'\033[0;36m'; _c_rst=$'\033[0m'

_psql() { psql "$DIRECT_URL" -At -q "$@"; }

# enqueue_daemon_turn <channel> <session> <title> <msg> → seta TURN, THREAD
enqueue_daemon_turn() {
  local channel="$1" session="$2" title="$3" msg="$4"
  local out
  out=$(_psql -v channel="$channel" -v session="$session" -v owner="$OWNER" \
        -v title="$title" -v msg="$msg" -f "$ENQUEUE_SQL")
  TURN="${out%%|*}"; THREAD="${out##*|}"
  echo "${_c_dim}  ↑ enqueued turn=$TURN thread=$THREAD${_c_rst}"
}

turn_status()      { _psql -c "SELECT status FROM \"ChatTurn\" WHERE id='$1';"; }
turn_tools()       { _psql -c "SELECT COALESCE(string_agg(DISTINCT replace(payload->>'tool','mcp__zordon__',''),','),'') FROM \"ChatTurnEvent\" WHERE \"turnId\"='$1' AND kind='tool_use';"; }
turn_tool_count()  { _psql -c "SELECT count(*) FROM \"ChatTurnEvent\" WHERE \"turnId\"='$1' AND kind='tool_use';"; }
turn_errors()      { _psql -c "SELECT count(*) FROM \"ChatTurnEvent\" WHERE \"turnId\"='$1' AND kind='tool_result' AND (payload->>'isError')='true';"; }
turn_response()    { _psql -c "SELECT content FROM \"ChatMessage\" WHERE \"threadId\"=(SELECT \"threadId\" FROM \"ChatTurn\" WHERE id='$1') AND role='assistant' ORDER BY \"createdAt\" DESC LIMIT 1;"; }
proposed_count()   { _psql -c "SELECT count(*) FROM \"MeetingTaskAction\" WHERE \"planningCeremonyId\"='$1' AND \"createdAt\" > now() - interval '$2 min';"; }

# wait_turn <turnId> [timeout_s=480] → ecoa status final; imprime progresso
wait_turn() {
  local turn="$1" timeout="${2:-480}" elapsed=0 st
  while (( elapsed < timeout )); do
    st="$(turn_status "$turn")"
    printf "${_c_dim}  … %3ds  status=%-8s tools=%s errs=%s${_c_rst}\n" \
      "$elapsed" "$st" "$(turn_tool_count "$turn")" "$(turn_errors "$turn")"
    case "$st" in done|error|aborted) echo "$st"; return 0 ;; esac
    sleep 6; elapsed=$((elapsed+6))
  done
  echo "timeout"; return 1
}

# ── Asserts ──────────────────────────────────────────────────────────────────
_pass() { PASS_N=$((PASS_N+1)); echo "${_c_grn}  ✓ $1${_c_rst}"; }
_fail() { FAIL_N=$((FAIL_N+1)); FAILURES+=("$1"); echo "${_c_red}  ✗ $1${_c_rst}"; }

assert_no_tool_errors() { local n; n="$(turn_errors "$1")"; [[ "$n" == "0" ]] && _pass "tools sem erro (infra ok)" || _fail "tools com $n erro(s) — infra/fetch"; }
assert_min_reads()      { local n; n="$(turn_tool_count "$1")"; (( n >= ${2:-1} )) && _pass "leu contexto ($n tool calls ≥ ${2:-1})" || _fail "poucas leituras ($n < ${2:-1})"; }
assert_tool_called()    { turn_tools "$1" | grep -q "$2" && _pass "chamou $2" || _fail "NÃO chamou $2"; }
assert_tool_not_called(){ turn_tools "$1" | grep -q "$2" && _fail "chamou tool indevida $2 (off-topic)" || _pass "não chamou $2 (disciplina)"; }
assert_resp_matches()   { turn_response "$1" | grep -qiE "$2" && _pass "resposta casa /$2/" || _fail "resposta NÃO casa /$2/"; }
assert_resp_not_matches(){ turn_response "$1" | grep -qiE "$2" && _fail "resposta casa indevidamente /$2/ (alucinação?)" || _pass "resposta não alucina /$2/"; }
assert_proposed()       { local n; n="$(proposed_count "$2" "${4:-8}")"; (( n >= $3 )) && _pass "propôs $n (≥ $3) ações" || _fail "propôs $n (< $3)"; }
# assert_titles_convention <ceremony> <minutes> — cada título recente bate [verbo] ... (escopo) para [propósito]
assert_titles_convention() {
  local bad
  bad=$(_psql -c "SELECT count(*) FROM \"MeetingTaskAction\" WHERE \"planningCeremonyId\"='$1' AND \"createdAt\" > now() - interval '$2 min' AND NOT (payload->>'title' ~ '\\(.+\\).*[Pp]ara ');")
  local tot; tot=$(proposed_count "$1" "$2")
  if [[ "$bad" == "0" && "$tot" != "0" ]]; then _pass "convenção de título: $tot/$tot no padrão"
  else _fail "convenção de título: $bad/$tot fora do padrão [verbo] [objeto] (escopo) para [propósito]"; fi
}

scenario() { echo ""; echo "${_c_cyn}━━━ $1 ━━━${_c_rst}"; }

report() {
  echo ""; echo "${_c_cyn}═══ SCORECARD ═══${_c_rst}"
  echo "  PASS=$PASS_N  FAIL=$FAIL_N"
  if (( FAIL_N > 0 )); then printf "  ${_c_red}falhas:${_c_rst}\n"; printf "   - %s\n" "${FAILURES[@]}"; fi
  (( FAIL_N == 0 ))
}
