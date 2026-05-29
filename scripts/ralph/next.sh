#!/usr/bin/env bash
#
# scripts/ralph/next.sh — pega o próximo PRD em ready/ e executa o loop Ralph.
#
# Fluxo:
#   1. ls docs/prd/ready/  → pega 1º filename (ordem lexicográfica)
#   2. mv ready/ → in-progress/
#   3. bash ralph.sh <feature>
#   4. quando loop termina: mv in-progress/ → blocked/  (humano revisa via checkpoint)
#
# Sempre move pra blocked/ no fim — nunca arquiva sozinho. Humano sempre no
# loop. Use closeout.sh pra arquivar com data.
#
# Usage:
#   scripts/ralph/next.sh [max_iterations]
#
# Exit codes:
#   0  loop completo, PRD em blocked/ esperando review
#   1  setup error (ready vazio, prd.json ausente, etc.)
#   2  Ralph abortou (3 falhas consecutivas)

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
RALPH_DIR="$REPO_ROOT/scripts/ralph"
READY_DIR="$REPO_ROOT/docs/prd/ready"
IN_PROGRESS_DIR="$REPO_ROOT/docs/prd/in-progress"
BLOCKED_DIR="$REPO_ROOT/docs/prd/blocked"

# Parse args: --yes/-y pula confirmação; primeiro arg numérico é max_iter
ASSUME_YES=0
MAX_ITER=10
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    *)
      if [[ "$arg" =~ ^[0-9]+$ ]]; then
        MAX_ITER="$arg"
      fi
      ;;
  esac
done

# shellcheck source=lib/prd-paths.sh
source "$RALPH_DIR/lib/prd-paths.sh"

# ─── 1. pick next ───────────────────────────────────────────────────────────

# Se já tem PRD em in-progress/, retoma esse (não pega novo de ready/)
in_progress_files=()
if [ -d "$IN_PROGRESS_DIR" ]; then
  while IFS= read -r -d '' f; do
    in_progress_files+=("$f")
  done < <(find "$IN_PROGRESS_DIR" -maxdepth 1 -name 'prd-*.md' -type f -print0 2>/dev/null)
fi

if [ "${#in_progress_files[@]}" -gt 1 ]; then
  echo "❌ $IN_PROGRESS_DIR tem múltiplos PRDs em paralelo:" >&2
  printf '   %s\n' "${in_progress_files[@]}" >&2
  echo "   Resolva manualmente antes de continuar (1 PRD/vez por default)." >&2
  exit 1
fi

resume_mode=0
if [ "${#in_progress_files[@]}" -eq 1 ]; then
  next_path="${in_progress_files[0]}"
  resume_mode=1
else
  if [ ! -d "$READY_DIR" ]; then
    echo "❌ $READY_DIR não existe. Crie pastas: mkdir -p $READY_DIR" >&2
    exit 1
  fi
  next_path="$(find "$READY_DIR" -maxdepth 1 -name 'prd-*.md' -type f 2>/dev/null | sort | head -1)"
  if [ -z "$next_path" ]; then
    echo "📭 Backlog vazio em docs/prd/ready/"
    echo ""
    echo "   Opções:"
    echo "   - Criar PRD novo em docs/prd/backlog/, rodar Rito 1 (intake), mover pra ready/"
    echo "   - Ver fila completa:  ls docs/prd/*/prd-*.md"
    exit 0
  fi
fi

filename="$(basename "$next_path")"
feature_preview="${filename#prd-}"
feature_preview="${feature_preview%.md}"
prdjson_preview="$RALPH_DIR/features/$feature_preview/prd.json"
passes_preview="?"
total_preview="?"
if [ -f "$prdjson_preview" ]; then
  passes_preview="$(jq '[.userStories[] | select(.passes==true)] | length' "$prdjson_preview" 2>/dev/null || echo "?")"
  total_preview="$(jq '.userStories | length' "$prdjson_preview" 2>/dev/null || echo "?")"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════════════"
if [ "$resume_mode" -eq 1 ]; then
  echo "  📍 RETOMAR — $feature_preview ($passes_preview/$total_preview stories) em in-progress/"
else
  echo "  ⏭ PRÓXIMO — $feature_preview ($passes_preview/$total_preview stories) de ready/"
fi
echo "  max_iter: $MAX_ITER · branch: $(git rev-parse --abbrev-ref HEAD)"

# Mostrar outras opções na fila pra contexto
ready_others="$(find "$READY_DIR" -maxdepth 1 -name 'prd-*.md' -type f 2>/dev/null | sort)"
if [ "$resume_mode" -eq 1 ] && [ -n "$ready_others" ]; then
  echo ""
  echo "  ⚠ Há PRDs em ready/ aguardando (mas in-progress tem prioridade):"
  echo "$ready_others" | sed "s|.*/|     • |"
fi
echo "═══════════════════════════════════════════════════════════════════════"

# Confirmação (skipa se --yes ou stdin não-TTY)
if [ "$ASSUME_YES" -ne 1 ]; then
  if [ -t 0 ]; then
    read -p "Continuar? [y/N] " confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
      echo "⏸ Cancelado pelo usuário."
      exit 0
    fi
  else
    echo ""
    echo "❌ stdin não é TTY e --yes não foi passado. Use:"
    echo "   bash scripts/ralph/next.sh --yes [max_iter]"
    echo "   ou rode no terminal interativo."
    exit 1
  fi
fi

# Se for novo PRD, move pra in-progress agora
if [ "$resume_mode" -eq 0 ]; then
  mkdir -p "$IN_PROGRESS_DIR"
  mv "$next_path" "$IN_PROGRESS_DIR/$filename"
  next_path="$IN_PROGRESS_DIR/$filename"
  echo "▶ Movido pra in-progress/"
fi

# Deriva feature do filename: prd-<feature>.md
filename="$(basename "$next_path")"
feature="${filename#prd-}"
feature="${feature%.md}"

# ─── 2. validar prd.json existe ─────────────────────────────────────────────

prdjson="$RALPH_DIR/features/$feature/prd.json"
if [ ! -f "$prdjson" ]; then
  echo "❌ $prdjson não existe — Rito 1 (Intake) incompleto pra $feature." >&2
  echo "   Rode:  bash $RALPH_DIR/intake.sh $feature" >&2
  echo "   (ou crie prd.json manualmente espelhando §16 do PRD)" >&2
  # Devolve PRD pra ready/ pra não ficar preso em in-progress incorretamente
  mkdir -p "$READY_DIR"
  mv "$next_path" "$READY_DIR/$filename"
  echo "   PRD devolvido a ready/" >&2
  exit 1
fi

# ─── 3. disparar ralph.sh ───────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════════════════════"
echo "  Disparando Ralph — feature: $feature · max_iter: $MAX_ITER"
echo "═══════════════════════════════════════════════════════════════════════"
echo ""

set +e
bash "$RALPH_DIR/ralph.sh" "$feature" "$MAX_ITER"
ralph_exit=$?
set -e

# ─── 4. move pra blocked/ (humano revisa) ───────────────────────────────────

mkdir -p "$BLOCKED_DIR"
mv "$next_path" "$BLOCKED_DIR/$filename"

passes="$(jq '[.userStories[] | select(.passes==true)] | length' "$prdjson")"
total="$(jq '.userStories | length' "$prdjson")"

echo ""
echo "═══════════════════════════════════════════════════════════════════════"
if [ "$ralph_exit" -eq 0 ]; then
  if [ "$passes" -eq "$total" ]; then
    echo "  ✅ Ralph COMPLETO — $passes/$total stories. PRD em blocked/ (review humano)."
  else
    echo "  ⏸ Ralph max-iter — $passes/$total stories. PRD em blocked/."
  fi
else
  echo "  ⚠ Ralph ABORTOU (exit $ralph_exit) — $passes/$total stories. PRD em blocked/."
fi
echo "═══════════════════════════════════════════════════════════════════════"
echo ""
echo "  Próximos passos:"
echo "  - Revisar:   bash $RALPH_DIR/checkpoint.sh $feature"
echo "  - Continuar: bash $RALPH_DIR/next.sh   (retoma este mesmo PRD)"
if [ "$passes" -eq "$total" ]; then
  echo "  - Closeout:  source $RALPH_DIR/lib/prd-paths.sh && prd_move $feature done"
  echo "               bash $RALPH_DIR/closeout.sh $feature"
fi
echo ""

exit "$ralph_exit"
