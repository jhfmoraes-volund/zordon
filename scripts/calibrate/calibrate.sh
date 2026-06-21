#!/usr/bin/env bash
# calibrate.sh — dispatcher para o calibration loop multi-agente.
#
# Usage:
#   bash scripts/calibrate/calibrate.sh <agent> <subcommand> [args...]
#
# Agentes suportados (deve bater com .claude/skills/calibrate/registry.md):
#   vitoria — copiloto de planning (route: /planning/[id])
#   vitor   — agente de Design Session (route: /design-sessions/[id])
#   alpha   — agente Ops (route: /ops) [sem driver ainda — placeholder]
#
# Subcommands:
#   run <args>      — invoca o CLI driver do agente (proxy)
#   capture         — abre o flow guiado de captura de evidência [F3 — em construção]
#   list            — lista captures abertas do agente no banco
#   status          — mostra metadata do agente (modelo, route, runbook, driver)
#   score           — roda fixture canônica e popula scoreboard [F5 — em construção]
#   reset           — reseta fixture de eval do agente [usa SQL do runbook]
#   help            — mostra esta ajuda
#
# Exemplos:
#   bash scripts/calibrate/calibrate.sh vitoria status
#   bash scripts/calibrate/calibrate.sh vitoria run --planning $VITORIA_PLANNING --message "olá"
#   bash scripts/calibrate/calibrate.sh vitoria list
#   bash scripts/calibrate/calibrate.sh vitor run --session $SESSION_ID --message "..."

set -euo pipefail

# ── Resolve project root ──────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"

AGENT="${1:-}"
CMD="${2:-help}"
shift 2 2>/dev/null || true

# ── Cores ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
NC='\033[0m'

usage() {
  cat <<EOF
${CYAN}calibrate.sh${NC} — dispatcher do calibration loop multi-agente

${YELLOW}Usage:${NC}
  bash scripts/calibrate/calibrate.sh <agent> <subcommand> [args...]

${YELLOW}Agentes:${NC}
  vitoria   copiloto de planning
  vitor     agente de Design Session
  alpha     agente Ops [sem driver — placeholder]

${YELLOW}Subcommands:${NC}
  run         proxy pro CLI driver in-process (OpenRouter) — args repassados
  daemon-run  ${GREEN}RUNBOOK AUTOMATIZADO da surface VIVA (daemon)${NC} — [smoke|all|DVn]
  capture     flow guiado de captura de evidência [F3]
  list        lista captures abertas no banco
  status      metadata do agente
  score       roda fixture canônica + populates scoreboard [F5]
  reset       reseta fixture de eval [SQL do runbook]
  help        esta ajuda

${YELLOW}Loop completo:${NC}
  1) ${DIM}\$ bash scripts/calibrate/calibrate.sh vitoria capture${NC}     # PM observou bug, captura
  2) ${DIM}\$ bash scripts/calibrate/calibrate.sh vitoria list${NC}        # vê captures abertas
  3) ${DIM}\$ bash scripts/calibrate/calibrate.sh vitoria run [args]${NC}  # reproduz via driver
  4) ${DIM}# aplica fix em prompt/schema/tool/modelo${NC}
  5) ${DIM}\$ bash scripts/calibrate/calibrate.sh vitoria run [args]${NC}  # re-valida
  6) ${DIM}\$ bash scripts/sync-main.sh -m "...";${NC}                     # commit

Vocabulary compartilhada de categorias: docs/runbooks/agent-audits/README.md
Skill entrypoint: /calibrate (ver .claude/skills/calibrate/SKILL.md)
EOF
}

# ── Registry inline (autoritative em .claude/skills/calibrate/registry.md) ──
agent_status() {
  case "$1" in
    vitoria)
      cat <<EOF
${CYAN}vitoria${NC} — Copiloto de Planning Ceremony
  modelo:        anthropic/claude-sonnet-4.6
  route:         /planning/[id]
  channel:       planning
  driver:        scripts/calibrate/drivers/vitoria-cli.ts
  runbook:       docs/runbooks/agent-audits/vitoria-audit-v1.md
  prompt:        src/lib/agent/agents/vitoria/prompt.ts
  tools:         src/lib/agent/agents/vitoria/tools.ts
  eval suite:    src/eval/vitoria/
EOF
      ;;
    vitor)
      cat <<EOF
${CYAN}vitor${NC} — Agente de Design Session
  modelo:        anthropic/claude-sonnet-4.6
  route:         /design-sessions/[id]
  channel:       web
  driver:        scripts/calibrate/drivers/vitor-cli.ts
  runbook:       docs/agents/vitor/vitor-audit-v2.md
  prompt:        src/lib/agent/agents/vitor/prompt.ts
  tools:         src/lib/agent/agents/vitor/tools.ts
  eval suite:    src/eval/vitor/
EOF
      ;;
    alpha)
      cat <<EOF
${CYAN}alpha${NC} — Agente Ops
  modelo:        anthropic/claude-sonnet-4.6
  route:         /ops
  channel:       web
  driver:        ${RED}(ainda não existe — criar quando entrar no loop)${NC}
  runbook:       docs/agents/alpha/alpha-audit.md
  prompt:        src/lib/agent/agents/alpha/prompt.ts
  tools:         src/lib/agent/agents/alpha/tools.ts
  eval suite:    ${RED}(não criado)${NC}
EOF
      ;;
    *)
      echo -e "${RED}Agente desconhecido:${NC} $1" >&2
      echo "Conhecidos: vitoria, vitor, alpha" >&2
      return 1
      ;;
  esac
}

agent_driver() {
  case "$1" in
    vitoria) echo "scripts/calibrate/drivers/vitoria-cli.ts" ;;
    vitor)   echo "scripts/calibrate/drivers/vitor-cli.ts" ;;
    alpha)   echo "" ;;
    *) return 1 ;;
  esac
}

# ── Subcommands ───────────────────────────────────────────────────────────
cmd_run() {
  local agent="$1"
  shift
  local driver
  driver="$(agent_driver "$agent")"
  if [[ -z "$driver" ]]; then
    echo -e "${RED}Driver não existe para '$agent'${NC}" >&2
    echo "Crie em scripts/calibrate/drivers/${agent}-cli.ts (espelhar pattern de vitoria-cli.ts)" >&2
    exit 2
  fi
  if [[ ! -f "$driver" ]]; then
    echo -e "${RED}Driver path quebrado:${NC} $driver" >&2
    exit 2
  fi
  echo -e "${DIM}▸ $driver $*${NC}" >&2
  exec npx tsx --tsconfig tsconfig.eval.json "$driver" "$@"
}

cmd_capture() {
  local agent="$1"
  local capture_script="$SCRIPT_DIR/capture.sh"
  if [[ ! -f "$capture_script" ]]; then
    cat <<EOF
${YELLOW}F3 — capture.sh ainda não foi criado.${NC}

Por enquanto, registre captures manualmente via SQL ou Studio:

  INSERT INTO "AgentCalibrationCapture" (
    "agentSlug", "userPrompt", "observedBehavior", category, severity
  ) VALUES (
    '$agent',
    '<o que o PM digitou no chat>',
    '<o que aconteceu errado>',
    '<categoria do runbook>',
    'medium'
  ) RETURNING id;

Vocabulary: docs/runbooks/agent-audits/README.md
EOF
    return 0
  fi
  exec bash "$capture_script" "$agent"
}

cmd_list() {
  local agent="$1"
  local direct_url
  direct_url="$(grep '^DIRECT_URL=' .env 2>/dev/null | sed 's/^DIRECT_URL=//' | tr -d '"' || true)"
  if [[ -z "$direct_url" ]]; then
    echo -e "${RED}DIRECT_URL não encontrado em .env${NC}" >&2
    exit 2
  fi
  export DIRECT_URL="$direct_url"

  echo -e "${CYAN}Captures abertas/em-investigação — agent=$agent${NC}\n"
  psql "$DIRECT_URL" <<SQL
SELECT
  id,
  "capturedAt"::timestamp(0) AS captured,
  category,
  severity,
  status,
  LEFT("observedBehavior", 60) AS observed
FROM "AgentCalibrationCapture"
WHERE "agentSlug" = '$agent'
  AND status IN ('open', 'investigating')
ORDER BY "capturedAt" DESC
LIMIT 20;
SQL
}

cmd_score() {
  local agent="$1"
  cat <<EOF
${YELLOW}F5 — score automatizado ainda não foi criado.${NC}

Por enquanto, rode o scorecard manualmente seguindo o runbook:
$(agent_status "$agent" | grep runbook)
EOF
}

cmd_reset() {
  local agent="$1"
  case "$agent" in
    vitoria)
      cat <<EOF
${YELLOW}Reset SQL para vitoria — copie+rode contra \$DIRECT_URL${NC}

source <(grep '^DIRECT_URL=' .env | sed 's/^/export /'); psql "\$DIRECT_URL" <<'SQL'
DELETE FROM "AgentProposalOutcome" WHERE "proposalId" IN (
  SELECT id FROM "MeetingTaskAction" WHERE "planningCeremonyId" = :'VITORIA_PLANNING'
);
DELETE FROM "MeetingTaskAction" WHERE "planningCeremonyId" = :'VITORIA_PLANNING';
DELETE FROM "PlanningContextNote" WHERE "planningCeremonyId" = :'VITORIA_PLANNING';
DELETE FROM "ChatMessage" WHERE "threadId" IN (
  SELECT id FROM "ChatThread"
  WHERE "agentName" = :'VITORIA_PLANNING' AND channel='planning'
);
SQL

Runbook completo em docs/runbooks/vitoria-audit-v1.md § Reset
EOF
      ;;
    vitor)
      cat <<EOF
${YELLOW}Reset SQL para vitor — ver docs/agents/vitor/vitor-audit-v2.md § Reset completo${NC}
EOF
      ;;
    alpha)
      cat <<EOF
${YELLOW}Reset para alpha — ver docs/agents/alpha/alpha-audit.md${NC}
EOF
      ;;
  esac
}

# ── daemon-run: runbook automatizado da surface viva (padrão 2026-06-21) ────
cmd_daemon_run() {
  local agent="$1"; shift || true
  local rb
  case "$agent" in
    vitoria) rb="$PROJECT_ROOT/scripts/calibrate/runbooks/vitoria-planning-daemon.sh" ;;
    *) echo -e "${RED}Sem runbook daemon pra '$agent' ainda.${NC} Veja scripts/calibrate/runbooks/." >&2; exit 2 ;;
  esac
  [[ -f "$rb" ]] || { echo -e "${RED}Runbook não encontrado:${NC} $rb" >&2; exit 2; }
  echo -e "${CYAN}→ runbook daemon:${NC} $rb $*"
  bash "$rb" "$@"
}

# ── Main dispatch ─────────────────────────────────────────────────────────
case "${AGENT}" in
  ""|help|-h|--help)
    usage
    exit 0
    ;;
esac

case "${CMD}" in
  run)
    cmd_run "$AGENT" "$@"
    ;;
  daemon-run)
    cmd_daemon_run "$AGENT" "$@"
    ;;
  capture)
    cmd_capture "$AGENT"
    ;;
  list)
    cmd_list "$AGENT"
    ;;
  status)
    agent_status "$AGENT"
    ;;
  score)
    cmd_score "$AGENT"
    ;;
  reset)
    cmd_reset "$AGENT"
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    echo -e "${RED}Subcommand desconhecido:${NC} $CMD" >&2
    echo
    usage
    exit 2
    ;;
esac
