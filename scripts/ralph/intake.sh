#!/usr/bin/env bash
#
# scripts/ralph/intake.sh — Rito 1 (Intake): PRD → prd.json + move pra ready/
#
# Esta versão é INTERATIVA. Por design não decide §5 (Decisões Fixadas) nem §16
# (Stories) sozinha — apenas valida que o PRD já tem os requisitos, gera
# esqueleto de prd.json a partir do §16, e propõe a movimentação.
#
# Se você quer hardening profundo (LLM revisa decisões, propõe stories),
# invoque a skill /ralph-intake numa sessão interativa Claude Code em vez de
# rodar este script.
#
# Usage:
#   scripts/ralph/intake.sh <feature>
#
# Pré-condições:
#   - docs/prd/backlog/prd-<feature>.md existe
#   - PRD tem seção §16 com YAML de stories (per AGENTS.md PRD schema)
#
# Steps:
#   1. valida pré-condições
#   2. se scripts/ralph/features/<feature>/prd.json já existe, alerta
#   3. (não autogeração agressiva — só checks)
#   4. propõe mv backlog/ → ready/ se prd.json existir

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 <feature>" >&2
  echo "" >&2
  echo "Para hardening interativo via LLM, use a skill /ralph-intake numa" >&2
  echo "sessão Claude Code em vez deste script." >&2
  exit 64
fi

FEATURE="$1"
REPO_ROOT="$(git rev-parse --show-toplevel)"
RALPH_DIR="$REPO_ROOT/scripts/ralph"

# shellcheck source=lib/prd-paths.sh
source "$RALPH_DIR/lib/prd-paths.sh"

PRD_MD="$(prd_find "$FEATURE")" || {
  echo "❌ PRD não encontrado: docs/prd/*/prd-${FEATURE}.md" >&2
  echo "   Crie em docs/prd/backlog/prd-${FEATURE}.md primeiro." >&2
  exit 65
}

CURRENT_STATE="$(prd_state "$FEATURE")"
PRD_JSON="$RALPH_DIR/features/$FEATURE/prd.json"

echo "═══════════════════════════════════════════════════════════════════════"
echo "  Intake — feature: $FEATURE · estado atual: $CURRENT_STATE"
echo "═══════════════════════════════════════════════════════════════════════"
echo ""

# ─── 1. checks de prontidão do PRD ──────────────────────────────────────────

echo "── checks de prontidão do PRD ─────────────────────────────────────────"
fail=0

check_section() {
  local section_pattern="$1"
  local description="$2"
  if grep -qE "$section_pattern" "$PRD_MD"; then
    echo "  ✅ $description"
  else
    echo "  ❌ $description  — não encontrado"
    fail=$((fail + 1))
  fi
}

check_section "^## §5|Decisões fixadas|Decisões Fixadas" "§5 Decisões fixadas presente"
check_section "^## §7|## §?7\\.1|Schema|CREATE TABLE" "§7 Schema/DDL presente"
check_section "^## §8|APIs" "§8 APIs presente"
check_section "^## §13|Métricas" "§13 Métricas presente"
check_section "^## §16|Stories implementáveis" "§16 Stories implementáveis presente"

if grep -qE "TBD|TODO|FIXME|\\?\\?\\?" "$PRD_MD"; then
  count="$(grep -cE "TBD|TODO|FIXME|\\?\\?\\?" "$PRD_MD" || true)"
  echo "  ⚠ $count ocorrências de TBD/TODO/FIXME/??? no PRD — revise antes"
fi

echo ""

if [ "$fail" -gt 0 ]; then
  echo "❌ $fail seções obrigatórias ausentes. Complete o PRD antes do intake." >&2
  echo "   Schema completo em AGENTS.md (bloco 'PRDs — escrever pra Ralph')." >&2
  exit 1
fi

# ─── 2. prd.json existe? ────────────────────────────────────────────────────

echo "── prd.json ──────────────────────────────────────────────────────────"
if [ -f "$PRD_JSON" ]; then
  total="$(jq '.userStories | length' "$PRD_JSON" 2>/dev/null || echo "?")"
  echo "  ✅ $PRD_JSON existe ($total stories)"
else
  echo "  ❌ $PRD_JSON ausente"
  echo ""
  echo "  Gere manualmente espelhando §16 do PRD, ou use a skill /ralph-intake"
  echo "  pra fazer hardening interativo (Claude lê PRD + propõe prd.json)."
  echo ""
  echo "  Schema do prd.json: ver scripts/ralph/features/project-wiki/prd.json"
  exit 1
fi
echo ""

# ─── 3. propor mv ───────────────────────────────────────────────────────────

if [ "$CURRENT_STATE" = "ready" ]; then
  echo "✅ PRD já está em docs/prd/ready/ — pronto pra next.sh"
  exit 0
fi

if [ "$CURRENT_STATE" = "in-progress" ] || [ "$CURRENT_STATE" = "blocked" ]; then
  echo "⚠ PRD em '$CURRENT_STATE' — execução já iniciada. Não vou mover."
  echo "  Use: bash scripts/ralph/checkpoint.sh $FEATURE"
  exit 0
fi

echo "── mover PRD ──────────────────────────────────────────────────────────"
echo "  De:   docs/prd/$CURRENT_STATE/prd-$FEATURE.md"
echo "  Pra:  docs/prd/ready/prd-$FEATURE.md"
echo ""
read -p "  Confirma? [y/N] " confirm
if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
  prd_move "$FEATURE" ready
  echo ""
  echo "✅ PRD movido pra ready/."
  echo "   Próximo: bash scripts/ralph/next.sh"
else
  echo "⏸ Cancelado. PRD permanece em $CURRENT_STATE/."
fi
