#!/usr/bin/env bash
# capture.sh — flow guiado pra capturar evidência de bug observado em prod.
#
# Inserta linha em AgentCalibrationCapture + backup local em docs/evidence/.
# Roda interativo por default; passe --non-interactive + flags pra modo scriptable.
#
# Usage:
#   bash scripts/calibrate/capture.sh <agent>                          # interativo
#   bash scripts/calibrate/capture.sh <agent> [flags]                  # mista
#
# Flags:
#   --user-prompt "..."       o que o PM mandou pro agente
#   --observed "..."          o que aconteceu errado
#   --expected "..."          o que devia ter acontecido (opcional)
#   --category <cat>          categoria da vocabulary (validada)
#   --severity low|medium|high|critical   (default medium)
#   --planning-id <uuid>      link opcional pra PlanningCeremony
#   --session-id <uuid>       link opcional pra DesignSession
#   --meeting-id <uuid>       link opcional pra Meeting
#   --thread-id <uuid>        link opcional pra ChatThread
#   --project-id <uuid>       link opcional pra Project
#   --screenshot <path>       caminho local do PNG/JPG (copia pra docs/evidence/)
#   --runbook-ref <V_NN>      cenário do runbook que cobre (ex: "V6", "V2.2")
#   --non-interactive         falha se algum campo obrigatório não passado por flag
#
# Vocabulary canônica de categorias: docs/runbooks/agent-audits/README.md
#
# Após captura:
#   Imprime o capture_id retornado.
#   Próximo passo: bash scripts/calibrate/calibrate.sh <agent> run [args] (reproduz)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
NC='\033[0m'

# ── Args ──────────────────────────────────────────────────────────────────
AGENT="${1:-}"
shift 2>/dev/null || true

USER_PROMPT=""
OBSERVED=""
EXPECTED=""
CATEGORY=""
SEVERITY="medium"
PLANNING_ID=""
SESSION_ID=""
MEETING_ID=""
THREAD_ID=""
PROJECT_ID=""
SCREENSHOT=""
RUNBOOK_REF=""
INTERACTIVE=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user-prompt)    USER_PROMPT="$2"; shift 2 ;;
    --observed)       OBSERVED="$2"; shift 2 ;;
    --expected)       EXPECTED="$2"; shift 2 ;;
    --category)       CATEGORY="$2"; shift 2 ;;
    --severity)       SEVERITY="$2"; shift 2 ;;
    --planning-id)    PLANNING_ID="$2"; shift 2 ;;
    --session-id)     SESSION_ID="$2"; shift 2 ;;
    --meeting-id)     MEETING_ID="$2"; shift 2 ;;
    --thread-id)      THREAD_ID="$2"; shift 2 ;;
    --project-id)     PROJECT_ID="$2"; shift 2 ;;
    --screenshot)     SCREENSHOT="$2"; shift 2 ;;
    --runbook-ref)    RUNBOOK_REF="$2"; shift 2 ;;
    --non-interactive) INTERACTIVE=0; shift ;;
    *)
      echo -e "${RED}Flag desconhecida:${NC} $1" >&2
      exit 2
      ;;
  esac
done

# ── Validações ────────────────────────────────────────────────────────────
VALID_AGENTS=("vitoria" "vitor" "alpha")
VALID_CATEGORIES=(
  "sem-tool" "sem-contexto" "prompt-confuso" "modelo-alucina"
  "schema-rejeita" "tool-off-topic" "manifest-blindspot" "scope-tangent"
  "gate-bypass" "confidence-missing" "confidence-fabricated"
  "outcome-missing" "infra-bug" "correto"
)
VALID_SEVERITIES=("low" "medium" "high" "critical")

contains() {
  local needle="$1"; shift
  local item
  for item in "$@"; do
    [[ "$item" == "$needle" ]] && return 0
  done
  return 1
}

if [[ -z "$AGENT" ]]; then
  echo -e "${RED}Falta o slug do agente.${NC}" >&2
  echo "Uso: bash scripts/calibrate/capture.sh <agent> [flags]" >&2
  exit 2
fi
if ! contains "$AGENT" "${VALID_AGENTS[@]}"; then
  echo -e "${RED}Agente desconhecido:${NC} $AGENT" >&2
  echo "Conhecidos: ${VALID_AGENTS[*]}" >&2
  exit 2
fi

# ── Prompts interativos pros campos faltantes ─────────────────────────────
ask() {
  local var_name="$1"; local prompt="$2"; local required="$3"
  local current="${!var_name}"
  [[ -n "$current" ]] && return 0
  if [[ "$INTERACTIVE" == "0" ]]; then
    if [[ "$required" == "1" ]]; then
      echo -e "${RED}Campo obrigatório faltando em modo --non-interactive:${NC} $prompt" >&2
      exit 2
    fi
    return 0
  fi
  echo -ne "${CYAN}?${NC} $prompt"
  [[ "$required" == "1" ]] && echo -ne " ${RED}*${NC}"
  echo -n ": "
  read -r value
  eval "$var_name=\$value"
}

echo -e "${YELLOW}▸ Capture pra agente:${NC} $AGENT"
echo -e "${DIM}  Pressione Enter pra pular campos opcionais.${NC}"
echo

ask USER_PROMPT  "O que o PM digitou pro agente?" 1
ask OBSERVED     "O que aconteceu (errado)?" 1
ask EXPECTED     "O que devia ter acontecido? (opcional)" 0

if [[ -z "$CATEGORY" ]]; then
  if [[ "$INTERACTIVE" == "1" ]]; then
    echo
    echo -e "${CYAN}? Categoria:${NC} ${RED}*${NC}"
    echo -e "${DIM}  Vocabulary canônica (docs/runbooks/agent-audits/README.md):${NC}"
    local i=1
    for cat in "${VALID_CATEGORIES[@]}"; do
      printf "    %2d) %s\n" "$i" "$cat"
      ((i++))
    done
    echo -n "  Escolha [1-${#VALID_CATEGORIES[@]}]: "
    read -r choice
    if ! [[ "$choice" =~ ^[0-9]+$ ]] || [[ "$choice" -lt 1 ]] || [[ "$choice" -gt "${#VALID_CATEGORIES[@]}" ]]; then
      echo -e "${RED}Escolha inválida${NC}" >&2
      exit 2
    fi
    CATEGORY="${VALID_CATEGORIES[$((choice-1))]}"
  else
    echo -e "${RED}--category obrigatório em modo --non-interactive${NC}" >&2
    exit 2
  fi
fi

if ! contains "$CATEGORY" "${VALID_CATEGORIES[@]}"; then
  echo -e "${RED}Categoria inválida:${NC} $CATEGORY" >&2
  echo "Válidas: ${VALID_CATEGORIES[*]}" >&2
  exit 2
fi
if ! contains "$SEVERITY" "${VALID_SEVERITIES[@]}"; then
  echo -e "${RED}Severity inválida:${NC} $SEVERITY" >&2
  echo "Válidas: ${VALID_SEVERITIES[*]}" >&2
  exit 2
fi

ask SEVERITY     "Severidade [low|medium|high|critical] (default: medium)" 0
[[ -z "$SEVERITY" ]] && SEVERITY="medium"

ask PLANNING_ID  "PlanningCeremony.id (se aplicável)" 0
ask SESSION_ID   "DesignSession.id (se aplicável)" 0
ask MEETING_ID   "Meeting.id (se aplicável)" 0
ask THREAD_ID    "ChatThread.id (se aplicável)" 0
ask PROJECT_ID   "Project.id (se aplicável)" 0
ask RUNBOOK_REF  "Cenário do runbook (V_NN — se já tem)" 0
ask SCREENSHOT   "Path local do screenshot PNG (se tem)" 0

# ── Backup local em docs/evidence/<agent>/YYYY-MM-DD/HHMMSS-<category>.md ──
TS=$(date +%Y-%m-%d/%H%M%S)
EVIDENCE_DIR="docs/evidence/$AGENT/$(dirname "$TS")"
mkdir -p "$EVIDENCE_DIR"
EVIDENCE_FILE="$EVIDENCE_DIR/$(basename "$TS")-${CATEGORY}.md"
SCREENSHOT_LOCAL=""

if [[ -n "$SCREENSHOT" ]] && [[ -f "$SCREENSHOT" ]]; then
  SCREENSHOT_LOCAL="$EVIDENCE_DIR/$(basename "$TS")-${CATEGORY}$(echo "$SCREENSHOT" | sed 's/.*\././')"
  cp "$SCREENSHOT" "$SCREENSHOT_LOCAL"
fi

cat > "$EVIDENCE_FILE" <<EOF
# Capture · $AGENT · ${CATEGORY}

**Captured:** $(date -u +"%Y-%m-%dT%H:%M:%SZ")
**Severity:** ${SEVERITY}
**Runbook ref:** ${RUNBOOK_REF:-(none)}

## User prompt

\`\`\`
${USER_PROMPT}
\`\`\`

## Observed behavior

${OBSERVED}

## Expected behavior

${EXPECTED:-(não preenchido)}

## Context links

- Planning:  ${PLANNING_ID:-—}
- Session:   ${SESSION_ID:-—}
- Meeting:   ${MEETING_ID:-—}
- Thread:    ${THREAD_ID:-—}
- Project:   ${PROJECT_ID:-—}
- Screenshot: ${SCREENSHOT_LOCAL:-—}

EOF

echo
echo -e "${GREEN}✓ Backup local salvo:${NC} $EVIDENCE_FILE"
[[ -n "$SCREENSHOT_LOCAL" ]] && echo -e "${GREEN}✓ Screenshot:${NC} $SCREENSHOT_LOCAL"

# ── Insert no banco ───────────────────────────────────────────────────────
DIRECT_URL="$(grep '^DIRECT_URL=' .env 2>/dev/null | sed 's/^DIRECT_URL=//' | tr -d '"' || true)"
if [[ -z "$DIRECT_URL" ]]; then
  echo -e "${RED}DIRECT_URL não em .env — capture salvo só localmente.${NC}" >&2
  exit 0
fi

# psql escape — usa stdin com format
escape_sql() {
  printf '%s' "$1" | sed "s/'/''/g"
}

USER_PROMPT_SQL=$(escape_sql "$USER_PROMPT")
OBSERVED_SQL=$(escape_sql "$OBSERVED")
EXPECTED_SQL=$(escape_sql "$EXPECTED")

nullable() {
  [[ -z "$1" ]] && echo "NULL" || echo "'$1'"
}

CAPTURE_ID=$(psql "$DIRECT_URL" -tAq -v ON_ERROR_STOP=1 <<SQL | head -1

INSERT INTO \"AgentCalibrationCapture\" (
  \"agentSlug\",
  \"userPrompt\",
  \"observedBehavior\",
  \"expectedBehavior\",
  category,
  severity,
  \"planningCeremonyId\",
  \"designSessionId\",
  \"meetingId\",
  \"threadId\",
  \"projectId\",
  \"screenshotPath\",
  \"runbookScenarioRef\",
  status
) VALUES (
  '$AGENT',
  '$USER_PROMPT_SQL',
  '$OBSERVED_SQL',
  $(if [[ -n "$EXPECTED" ]]; then echo "'$EXPECTED_SQL'"; else echo "NULL"; fi),
  '$CATEGORY',
  '$SEVERITY',
  $(nullable "$PLANNING_ID"),
  $(nullable "$SESSION_ID"),
  $(nullable "$MEETING_ID"),
  $(nullable "$THREAD_ID"),
  $(nullable "$PROJECT_ID"),
  $(nullable "$SCREENSHOT_LOCAL"),
  $(nullable "$RUNBOOK_REF"),
  'open'
)
RETURNING id;
SQL
)

if [[ -z "$CAPTURE_ID" ]] || [[ "$CAPTURE_ID" == *"ERROR"* ]]; then
  echo -e "${RED}✗ Falha ao inserir no banco:${NC}" >&2
  echo "$CAPTURE_ID" >&2
  echo
  echo -e "${YELLOW}Backup local foi salvo em $EVIDENCE_FILE${NC}" >&2
  exit 1
fi

echo -e "${GREEN}✓ Capture inserida:${NC} $CAPTURE_ID"
echo

# ── Próximos passos ───────────────────────────────────────────────────────
cat <<EOF
${CYAN}Próximos passos:${NC}

  1) Reproduzir:    ${DIM}bash scripts/calibrate/calibrate.sh $AGENT run [args]${NC}
  2) Listar abertas: ${DIM}bash scripts/calibrate/calibrate.sh $AGENT list${NC}
  3) Aplicar fix em prompt/schema/tool/modelo conforme categoria '$CATEGORY'
  4) Re-validar com mesmo CLI cmd
  5) Promote pra eval suite quando fix passar:
     ${DIM}psql \$DIRECT_URL -c "UPDATE \"AgentCalibrationCapture\" SET status='fixed', \"evalCaseAdded\"=true WHERE id='$CAPTURE_ID';"${NC}

${CYAN}Para registrar o fix:${NC} insira em AgentCalibrationFix linkando captureId='$CAPTURE_ID'.
EOF
