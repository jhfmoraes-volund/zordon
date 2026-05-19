#!/usr/bin/env bash
#
# scripts/sync-joao-dev.sh — sincroniza local → origin/joao-dev (branch pessoal).
#
# Mesma máquina do sync-main.sh, mas dedicado à branch joao-dev:
#   - só roda se você estiver em joao-dev (sem --force-branch)
#   - push só pra origin por default (não pra todos os remotes)
#   - cria origin/joao-dev no primeiro push se ainda não existir
#
# Fluxo:
#   1. valida repo + branch == joao-dev
#   2. checa arquivos sensíveis ANTES de stagear
#   3. stagea tudo (inclui untracked) e commita (auto-tag ZRD-JM-NN)
#   4. fetch + rebase em cima de origin/joao-dev (se existir)
#   5. push pra origin/joao-dev (sem --force, sem --no-verify)
#
# Uso:
#   scripts/sync-joao-dev.sh                    # auto-tag + push pra origin
#   scripts/sync-joao-dev.sh -m "feat: msg"     # mensagem inline
#   scripts/sync-joao-dev.sh --to staging       # override de target
#   scripts/sync-joao-dev.sh --dry-run          # mostra o que faria
#
# Promover joao-dev → main: NÃO usa este script. Faça manual via PR/merge
# (gh pr create) ou rode sync-main.sh depois de fast-forward em main.
#
# Salvaguardas (idênticas a sync-main.sh):
#   - Bloqueia se .env, *.pem, *.key, credentials.*, id_rsa* aparecerem
#   - Só rebase, nunca merge
#   - Nunca usa --force nem --no-verify

set -euo pipefail

# Auto-troca de conta gh por remote (suporta múltiplas contas / repos).
# shellcheck source=lib/gh-account-switch.sh
source "$(dirname "$0")/lib/gh-account-switch.sh"

BRANCH="${JOAO_DEV_BRANCH:-joao-dev}"
DEFAULT_REMOTE="${JOAO_DEV_REMOTE:-origin}"
DRY_RUN=0
COMMIT_MSG=""
TO_ARG=""

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
dim()    { printf '\033[2m%s\033[0m\n' "$*"; }

usage() {
  awk 'NR>=3 && /^#/ { sub(/^# ?/, ""); print; next } NR>=3 { exit }' "$0"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--message) COMMIT_MSG="${2:-}"; shift 2 ;;
    --to)         TO_ARG="${2:-}"; shift 2 ;;
    --dry-run)    DRY_RUN=1; shift ;;
    -h|--help)    usage; exit 0 ;;
    *) red "✗ argumento desconhecido: $1"; usage >&2; exit 2 ;;
  esac
done

git_run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    printf '+ git'; printf ' %q' "$@"; printf '\n'
  else
    git "$@"
  fi
}

# ── 0. repo check ────────────────────────────────────────
git rev-parse --git-dir >/dev/null 2>&1 || { red "✗ não é um repositório git"; exit 1; }
cd "$(git rev-parse --show-toplevel)"

# ── 1. branch check ──────────────────────────────────────
current_branch="$(git symbolic-ref --short HEAD 2>/dev/null || echo DETACHED)"
if [[ "$current_branch" == "DETACHED" ]]; then
  red "✗ HEAD detached — faça checkout em '$BRANCH' primeiro."
  exit 1
fi
if [[ "$current_branch" != "$BRANCH" ]]; then
  red "✗ você está em '$current_branch', não em '$BRANCH'."
  echo "  pra criar a branch: git switch -c $BRANCH"
  echo "  pra trocar:         git switch $BRANCH"
  exit 1
fi

# ── 2. detect changes & sensitive files (PRE-stage) ──────
pending_files="$(git ls-files --others --exclude-standard --modified; git diff --cached --name-only)"
pending_files="$(printf '%s\n' "$pending_files" | sort -u | sed '/^$/d')"

bad="$(printf '%s\n' "$pending_files" | grep -E '(^|/)\.env(\.|$)|\.(pem|key)$|(^|/)credentials\.|(^|/)id_rsa' || true)"
if [[ -n "$bad" ]]; then
  red "✗ arquivos sensíveis em mudança pendente:"
  printf '%s\n' "$bad" | sed 's/^/    /'
  echo "  adicione ao .gitignore ou remova antes de rodar o sync."
  exit 1
fi

if [[ -n "$pending_files" ]]; then
  yellow "▸ mudanças pendentes:"
  git status --short | sed 's/^/    /'

  # ── 3. stage + auto-tag + commit ─────────────────────
  git_run add -A

  if [[ -z "$COMMIT_MSG" ]]; then
    last_n="$({ git log --all --pretty=%s 2>/dev/null || true; } \
      | { grep -oE '^ZRD-JM-[0-9]+' || true; } \
      | { grep -oE '[0-9]+$' || true; } \
      | sort -n | tail -1)"
    next_n=$(( 10#${last_n:-0} + 1 ))
    tag="$(printf 'ZRD-JM-%02d' "$next_n")"

    if [[ $DRY_RUN -eq 1 ]]; then diff_src=("HEAD"); else diff_src=("--cached"); fi

    stat="$({ git diff "${diff_src[@]}" --shortstat 2>/dev/null || true; } | sed 's/^ *//')"
    areas="$({ git diff "${diff_src[@]}" --name-only 2>/dev/null || true; } | awk -F/ '
      $1=="src" && $2=="lib"        { print "lib/"$3; next }
      $1=="src" && $2=="components" { print "components"; next }
      $1=="src" && $2=="app"        { print "app"; next }
      $1=="src" && $2=="hooks"      { print "hooks"; next }
      $1=="src" && $2=="contexts"   { print "contexts"; next }
      $1=="supabase"                { print "supabase"; next }
      $1=="scripts"                 { print "scripts"; next }
      $1=="docs"                    { print "docs"; next }
                                    { print $1 }
    ' | sort -u | head -4 | paste -sd, - | sed 's/,/, /g')"

    COMMIT_MSG="$tag: ${areas:-misc} — ${stat:-changes}"
    dim "▸ tag auto: $COMMIT_MSG"
  fi

  git_run commit -m "$COMMIT_MSG"
else
  dim "▸ sem mudanças locais pendentes."
fi

# ── 4. pick target remote ────────────────────────────────
TARGET="${TO_ARG:-$DEFAULT_REMOTE}"
if ! git remote get-url "$TARGET" >/dev/null 2>&1; then
  red "✗ remote '$TARGET' não existe. configurados: $(git remote | paste -sd, -)"
  exit 1
fi
dim "▸ target: $TARGET"

# Guarda a conta gh ativa pra restaurar no fim e troca pra que tem acesso ao
# target (será usada no fetch + push).
gh_account_save_active
trap gh_account_restore EXIT
gh_ensure_account_for_remote "$TARGET"

# ── 5. fetch + rebase em cima do remote (se existir) ─────
yellow "▸ fetch $TARGET/$BRANCH"
[[ $DRY_RUN -eq 0 ]] && git fetch "$TARGET" "$BRANCH" 2>/dev/null || true

if git rev-parse --verify "$TARGET/$BRANCH" >/dev/null 2>&1; then
  local_sha="$(git rev-parse HEAD)"
  remote_sha="$(git rev-parse "$TARGET/$BRANCH")"
  base_sha="$(git merge-base HEAD "$TARGET/$BRANCH" 2>/dev/null || echo '')"

  if [[ "$local_sha" == "$remote_sha" ]]; then
    dim "▸ HEAD == $TARGET/$BRANCH"
  elif [[ "$base_sha" == "$remote_sha" ]]; then
    dim "▸ local ahead de $TARGET/$BRANCH — fast-forward."
  else
    yellow "▸ divergiu de $TARGET/$BRANCH — rebase..."
    if ! git_run rebase "$TARGET/$BRANCH"; then
      red ""
      red "✗ rebase em conflito."
      cat <<EOF
  resolva os conflitos, depois rode:
    git add <arquivos resolvidos>
    git rebase --continue
    git push $TARGET $BRANCH

  pra abortar (volta ao estado pré-rebase):
    git rebase --abort
EOF
      exit 1
    fi
  fi
else
  yellow "▸ $TARGET/$BRANCH ainda não existe — push criará a branch."
fi

# ── 6. push ──────────────────────────────────────────────
yellow "▸ push $TARGET $BRANCH"
if [[ $DRY_RUN -eq 0 ]]; then
  # -u na primeira vez configura upstream; no-op depois
  if ! git push -u "$TARGET" "$BRANCH"; then
    red ""
    red "✗ push pra '$TARGET' falhou"
    cat <<EOF
  causa provável: o remote tem commits que o local não tem.
  inspecione com:
    git fetch $TARGET $BRANCH
    git log --oneline HEAD..$TARGET/$BRANCH

  rode o script de novo se for só "remote moveu durante o push".
EOF
    exit 1
  fi
fi

green "✓ sync done."
if [[ $DRY_RUN -eq 0 ]]; then
  git log -1 --oneline | sed 's/^/  /'
fi
