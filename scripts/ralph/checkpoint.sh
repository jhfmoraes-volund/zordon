#!/usr/bin/env bash
#
# scripts/ralph/checkpoint.sh — Rito 3: review humano entre loops.
#
# Mostra estado do feature pra operador decidir se continua, pivota ou aborta.
#
# Usage:
#   scripts/ralph/checkpoint.sh <feature>

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 <feature>" >&2
  exit 64
fi

FEATURE="$1"
REPO_ROOT="$(git rev-parse --show-toplevel)"
FEATURE_DIR="$REPO_ROOT/scripts/ralph/features/$FEATURE"
PRD_JSON="$FEATURE_DIR/prd.json"
PROGRESS="$FEATURE_DIR/progress.txt"

if [ ! -f "$PRD_JSON" ]; then
  echo "❌ prd.json not found: $PRD_JSON" >&2
  exit 65
fi

BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"

echo "═══════════════════════════════════════════════════════════════════════"
echo "  Checkpoint — feature: $FEATURE · branch: $BRANCH"
echo "═══════════════════════════════════════════════════════════════════════"
echo ""

TOTAL="$(jq '.userStories | length' "$PRD_JSON")"
DONE="$(jq '[.userStories[] | select(.passes == true)] | length' "$PRD_JSON")"
PCT=0
[ "$TOTAL" -gt 0 ] && PCT=$((DONE * 100 / TOTAL))

echo "📋 Progresso: $DONE / $TOTAL stories ($PCT%)"
echo ""

echo "─── Status por story ──────────────────────────────────────────────────"
jq -r '.userStories[] | "\(if .passes == true then "✅" else "⬜" end) \(.id) — \(.title)"' "$PRD_JSON"
echo ""

echo "─── Próximas elegíveis (passes=false, dependsOn satisfeitos) ──────────"
jq -r '
  . as $root |
  [.userStories[] | select(.passes == true) | .id] as $done |
  .userStories[]
  | select(.passes != true)
  | select((.dependsOn // []) | all(. as $d | $done | index($d)))
  | "→ \(.id) — \(.title) [\(.estimateMinutes // "?")min]"
' "$PRD_JSON" | head -5
echo ""

echo "─── Últimos 10 commits ────────────────────────────────────────────────"
git -C "$REPO_ROOT" log --oneline -10
echo ""

if [ -f "$PROGRESS" ] && [ -s "$PROGRESS" ]; then
  echo "─── progress.txt (últimas 30 linhas) ──────────────────────────────────"
  tail -30 "$PROGRESS"
  echo ""
fi

echo "─── Diff acumulado vs main (stat) ─────────────────────────────────────"
git -C "$REPO_ROOT" diff --stat main...HEAD | tail -20
echo ""

echo "─── Próximas ações sugeridas ──────────────────────────────────────────"
if [ "$DONE" -eq "$TOTAL" ]; then
  echo "  ✅ Tudo passou — rode closeout:"
  echo "     bash scripts/ralph/closeout.sh $FEATURE"
else
  echo "  ▶ Continuar loop:   bash scripts/ralph/ralph.sh $FEATURE"
  echo "  🔧 Pivotar:         editar $PRD_JSON, commit, rodar ralph.sh"
  echo "  ✋ Abortar:         git reset --hard main; mv $PRD_JSON ${PRD_JSON}.aborted"
fi
echo ""
