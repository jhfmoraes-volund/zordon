#!/usr/bin/env bash
#
# scripts/ralph/closeout.sh — Rito 4: audit final + PR + archive.
#
# Pré-condição: todas as stories de prd.json com passes=true.
#
# Steps:
#   1. Audit gates: lint, typecheck, build
#   2. Sugere rodar SAGE + /security-review manualmente (Claude operador)
#   3. Cria PR via gh
#   4. Arquiva PRD e prd.json
#
# Usage:
#   scripts/ralph/closeout.sh <feature> [--dry-run]

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 <feature> [--dry-run]" >&2
  exit 64
fi

FEATURE="$1"
DRY_RUN="false"
[ "${2:-}" = "--dry-run" ] && DRY_RUN="true"

REPO_ROOT="$(git rev-parse --show-toplevel)"
FEATURE_DIR="$REPO_ROOT/scripts/ralph/features/$FEATURE"
PRD_JSON="$FEATURE_DIR/prd.json"
PRD_MD="$REPO_ROOT/docs/prd/prd-$FEATURE.md"
PROGRESS="$FEATURE_DIR/progress.txt"
TODAY="$(date -u +%Y%m%d)"

cd "$REPO_ROOT"

# ─── 1. validações ──────────────────────────────────────────────────────────

if [ ! -f "$PRD_JSON" ]; then
  echo "❌ prd.json not found: $PRD_JSON" >&2
  exit 65
fi

PENDING="$(jq '[.userStories[] | select(.passes != true)] | length' "$PRD_JSON")"
if [ "$PENDING" -gt 0 ]; then
  echo "❌ $PENDING stories ainda com passes=false — feature não está pronta." >&2
  echo "   bash scripts/ralph/checkpoint.sh $FEATURE" >&2
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  echo "❌ refuse to run closeout on $BRANCH" >&2
  exit 1
fi

echo "═══════════════════════════════════════════════════════════════════════"
echo "  Closeout — feature: $FEATURE · branch: $BRANCH"
echo "═══════════════════════════════════════════════════════════════════════"
echo ""

# ─── 2. audit gates ─────────────────────────────────────────────────────────

echo "── lint ───────────────────────────────────────────────────────────────"
pnpm lint
echo "✅ lint ok"
echo ""

echo "── typecheck ──────────────────────────────────────────────────────────"
npx tsc --noEmit
echo "✅ typecheck ok"
echo ""

echo "── build ──────────────────────────────────────────────────────────────"
pnpm build
echo "✅ build ok"
echo ""

# ─── 3. SAGE / security review (manuais — só lembra) ────────────────────────

echo "── manual audits requeridos antes do PR ──────────────────────────────"
echo "  No Claude Code operador, rode:"
echo "    /security-review"
echo "    Agent(sage): SAGE sweep no diff de $BRANCH vs main pro feature $FEATURE"
echo ""
read -p "  Audits manuais concluídos? [y/N] " AUDIT_OK
if [ "$AUDIT_OK" != "y" ] && [ "$AUDIT_OK" != "Y" ]; then
  echo "⏸ pause — rode audits e volte aqui."
  exit 1
fi
echo ""

# ─── 4. archive PRD + prd.json ──────────────────────────────────────────────

ARCHIVE_PRD="$REPO_ROOT/docs/archive/prd-$FEATURE-$TODAY.md"
ARCHIVE_FEATURE="$REPO_ROOT/scripts/ralph/features/_archive/$FEATURE-$TODAY"

echo "── arquivamento ──────────────────────────────────────────────────────"
if [ "$DRY_RUN" = "true" ]; then
  echo "  [dry-run] git mv $PRD_MD $ARCHIVE_PRD"
  echo "  [dry-run] mv $FEATURE_DIR $ARCHIVE_FEATURE"
else
  mkdir -p "$(dirname "$ARCHIVE_PRD")"
  mkdir -p "$(dirname "$ARCHIVE_FEATURE")"
  [ -f "$PRD_MD" ] && git mv "$PRD_MD" "$ARCHIVE_PRD" 2>/dev/null || echo "  PRD já arquivado ou ausente"
  [ -d "$FEATURE_DIR" ] && mv "$FEATURE_DIR" "$ARCHIVE_FEATURE"
  bash "$REPO_ROOT/scripts/sync-main.sh" -m "ralph($FEATURE): archive PRD + prd.json após conclusão"
fi
echo ""

# ─── 5. abrir PR ────────────────────────────────────────────────────────────

echo "── PR ─────────────────────────────────────────────────────────────────"

PR_BODY=$(mktemp)
{
  echo "## Summary"
  echo ""
  echo "Implementação da feature **$FEATURE** via Ralph loop autônomo."
  echo ""
  echo "PRD: \`docs/archive/prd-$FEATURE-$TODAY.md\` (anteriormente em \`docs/prd/\`)"
  echo ""
  echo "## Stories implementadas"
  echo ""
  jq -r '.userStories[] | "- \(.id) — \(.title)"' "$ARCHIVE_FEATURE/prd.json" 2>/dev/null \
    || jq -r '.userStories[] | "- \(.id) — \(.title)"' "$PRD_JSON"
  echo ""
  echo "## Audits"
  echo ""
  echo "- [x] lint"
  echo "- [x] typecheck"
  echo "- [x] build"
  echo "- [x] SAGE sweep (manual)"
  echo "- [x] /security-review (manual)"
  echo ""
  echo "## Iteration log"
  echo ""
  echo "Ver \`scripts/ralph/features/_archive/$FEATURE-$TODAY/progress.txt\`"
  echo ""
  echo "🤖 Gerado via [Ralph process](docs/runbooks/ralph-process.md)"
} >"$PR_BODY"

if [ "$DRY_RUN" = "true" ]; then
  echo "  [dry-run] gh pr create --title \"ralph: $FEATURE\" --body @$PR_BODY"
  cat "$PR_BODY"
else
  gh pr create --title "ralph: $FEATURE" --body-file "$PR_BODY" || {
    echo "⚠ gh pr create falhou — body em $PR_BODY"
    exit 1
  }
fi

rm -f "$PR_BODY"

echo ""
echo "✅ closeout completo."
