#!/usr/bin/env bash
#
# Forge restart — descarta o progresso da forja e volta pro ponto zero.
#
# Reseta as 3 camadas ortogonais da forja (ver mapa em src/lib/forge/paths.ts):
#   1. FILESYSTEM   ~/volund-forge/{workspaces,runs,logs,cache}/*  → wipe
#   2. RUN-STATE DB ForgeRun/Agent/Task/Event/Job/Daemon            → DELETE
#   3. SPEC DB      ProductRequirement                              → status approved→draft
#                                                                     + zera lastRun* (projeção)
#
# NÃO deleta os PRDs (rows ProductRequirement ficam, só voltam pra draft pra você
# reescrever in-place). NÃO toca em ForgeSpec nem ForgeLearning (waist + lições
# aprendidas persistem). NÃO mexe em Project.forgeSourceSessionId (o vínculo
# PRD↔sessão continua — não precisa desvincular pra reescrever).
#
# Escopo atual: TUDO (todos os projetos). Filesystem inteiro + run-state global.
#
# Uso:
#   bash scripts/forge/reset.sh           # DRY-RUN: mostra o plano + contagens, não apaga nada
#   bash scripts/forge/reset.sh --yes     # EXECUTA o wipe completo
#   bash scripts/forge/reset.sh --yes --home /custom/forge   # override FORGE_HOME
#
set -euo pipefail

# ─── args ──────────────────────────────────────────────────────────────────────
EXECUTE=0
FORGE_HOME_OVERRIDE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) EXECUTE=1; shift ;;
    --home)   FORGE_HOME_OVERRIDE="$2"; shift 2 ;;
    *) echo "arg desconhecido: $1" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FORGE_HOME="${FORGE_HOME_OVERRIDE:-${FORGE_HOME:-$HOME/volund-forge}}"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
dim()  { printf "\033[2m%s\033[0m\n" "$*"; }
red()  { printf "\033[31m%s\033[0m\n" "$*"; }
grn()  { printf "\033[32m%s\033[0m\n" "$*"; }

# ─── carrega DIRECT_URL (psql, session mode, sem pgbouncer) ──────────────────────
if [[ ! -f "$REPO_ROOT/.env" ]]; then
  red "✗ .env não encontrado em $REPO_ROOT"; exit 1
fi
# Parse literal (não re-avalia $ na senha; sobrevive a set -u). Strip aspas.
DIRECT_URL="$(grep -m1 '^DIRECT_URL=' "$REPO_ROOT/.env" | cut -d= -f2-)"
DIRECT_URL="${DIRECT_URL%\"}"; DIRECT_URL="${DIRECT_URL#\"}"
if [[ -z "${DIRECT_URL:-}" ]]; then
  red "✗ DIRECT_URL não está no .env"; exit 1
fi

# ─── SQL de reset (transacional) ─────────────────────────────────────────────────
read -r -d '' RESET_SQL <<'SQL' || true
BEGIN;
-- Run-state: deletado em ordem filhos→pais (cascades cobririam, mas explícito é auditável).
DELETE FROM "ForgeEvent";
DELETE FROM "ForgeTask";
DELETE FROM "ForgeAgent";
DELETE FROM "ForgeJob";
DELETE FROM "ForgeRun";      -- FK ProductRequirement.lastRunId → SET NULL dispara aqui
DELETE FROM "ForgeDaemon";   -- heartbeats stale; daemon re-registra no próximo start
-- PRDs: mantém as rows, volta pra draft, zera projeção denormalizada de run.
UPDATE "ProductRequirement" SET status = 'draft' WHERE status = 'approved';
UPDATE "ProductRequirement"
   SET "lastRunId" = NULL, "lastRunStatus" = NULL, "lastRunFinishedAt" = NULL
 WHERE "lastRunId" IS NOT NULL
    OR "lastRunStatus" IS NOT NULL
    OR "lastRunFinishedAt" IS NOT NULL;
COMMIT;
SQL

# ─── contagens "antes" (pro plano) ───────────────────────────────────────────────
bold "FORGE · reset"
dim  "─────────────"
echo "FORGE_HOME : $FORGE_HOME"
echo "DB         : $(echo "$DIRECT_URL" | sed -E 's#://[^@]+@#://***@#')"
echo

bold "Vai apagar do filesystem:"
for sub in workspaces runs logs cache; do
  d="$FORGE_HOME/$sub"
  if [[ -d "$d" ]]; then
    n=$(find "$d" -mindepth 1 -maxdepth 1 ! -name '.DS_Store' 2>/dev/null | wc -l | tr -d ' ')
    echo "  $sub/  ($n item(s))"
  else
    echo "  $sub/  (não existe)"
  fi
done
echo

bold "Vai apagar/alterar no DB:"
psql "$DIRECT_URL" -At <<'SQL' 2>/dev/null | while IFS='|' read -r label cnt; do printf "  %-28s %s\n" "$label" "$cnt"; done || red "  (não consegui ler contagens — DB offline?)"
SELECT 'ForgeRun (delete)',                    count(*) FROM "ForgeRun"
UNION ALL SELECT 'ForgeTask (delete)',          count(*) FROM "ForgeTask"
UNION ALL SELECT 'ForgeEvent (delete)',         count(*) FROM "ForgeEvent"
UNION ALL SELECT 'ForgeAgent (delete)',         count(*) FROM "ForgeAgent"
UNION ALL SELECT 'ForgeJob (delete)',           count(*) FROM "ForgeJob"
UNION ALL SELECT 'ForgeDaemon (delete)',        count(*) FROM "ForgeDaemon"
UNION ALL SELECT 'PRD approved→draft',          count(*) FROM "ProductRequirement" WHERE status='approved'
UNION ALL SELECT 'PRD com lastRun* (zera)',     count(*) FROM "ProductRequirement" WHERE "lastRunId" IS NOT NULL OR "lastRunStatus" IS NOT NULL OR "lastRunFinishedAt" IS NOT NULL;
SQL
echo
dim "Preservado: ForgeSpec, ForgeLearning, rows ProductRequirement, Project.forgeSourceSessionId."
echo

# ─── dry-run vs execute ──────────────────────────────────────────────────────────
if [[ "$EXECUTE" -ne 1 ]]; then
  yellow_note() { printf "\033[33m%s\033[0m\n" "$*"; }
  yellow_note "DRY-RUN. Nada foi alterado."
  yellow_note "Pra executar de verdade: bash scripts/forge/reset.sh --yes"
  exit 0
fi

# ─── EXECUTE ─────────────────────────────────────────────────────────────────────
bold "→ 1/3  parando daemon (libera locks + evita jobs órfãos)…"
bash "$REPO_ROOT/scripts/daemon/daemon-ctl.sh" stop || dim "  (daemon não estava rodando)"

bold "→ 2/3  wipe filesystem…"
for sub in workspaces runs logs cache; do
  d="$FORGE_HOME/$sub"
  if [[ -d "$d" ]]; then
    find "$d" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  fi
  mkdir -p "$d"
done
grn "  ✓ $FORGE_HOME zerado (estrutura recriada)"

bold "→ 3/3  reset run-state + PRDs→draft no DB…"
psql "$DIRECT_URL" -v ON_ERROR_STOP=1 <<SQL
$RESET_SQL
SQL
grn "  ✓ DB resetado"

echo
grn "✓ Forja resetada. Próximo run faz fresh clone; PRDs estão em draft pra reescrever."
