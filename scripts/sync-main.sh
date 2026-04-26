#!/usr/bin/env bash
#
# scripts/sync-main.sh — sincroniza local → origin/main (tratando local como SSOT).
#
# Fluxo:
#   1. valida branch + repo
#   2. checa arquivos sensíveis ANTES de stagear
#   3. stagea tudo (inclui untracked) e commita
#   4. fetch origin
#   5. rebase em cima de origin/main se divergiu (linear history)
#   6. push regular (sem --force)
#
# Uso:
#   scripts/sync-main.sh                          # abre $EDITOR pra mensagem
#   scripts/sync-main.sh -m "feat: minha mudança" # mensagem inline
#   scripts/sync-main.sh --dry-run                # mostra o que faria
#   scripts/sync-main.sh --force-branch           # permite rodar fora da main
#
# Salvaguardas:
#   - Bloqueia se .env, *.pem, *.key, credentials.*, id_rsa* aparecerem
#   - Só rebase, nunca merge
#   - Nunca usa --force nem --no-verify
#   - Em conflito: para com instruções claras, work tree fica intacto

set -euo pipefail

MAIN_BRANCH="${MAIN_BRANCH:-main}"
REMOTE="${REMOTE:-origin}"
DRY_RUN=0
COMMIT_MSG=""
FORCE_BRANCH=0

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
dim()    { printf '\033[2m%s\033[0m\n' "$*"; }

usage() {
  sed -n '3,28p' "$0" | sed 's/^# \?//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--message)   COMMIT_MSG="${2:-}"; shift 2 ;;
    --dry-run)      DRY_RUN=1; shift ;;
    --force-branch) FORCE_BRANCH=1; shift ;;
    -h|--help)      usage; exit 0 ;;
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
  red "✗ HEAD detached — faça checkout numa branch primeiro."
  exit 1
fi
if [[ "$current_branch" != "$MAIN_BRANCH" && $FORCE_BRANCH -eq 0 ]]; then
  red "✗ você está em '$current_branch', não em '$MAIN_BRANCH'."
  echo "  use --force-branch pra pushar nessa branch, ou checkout pra '$MAIN_BRANCH'."
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

  # ── 3. stage + commit ────────────────────────────────
  git_run add -A

  if [[ -n "$COMMIT_MSG" ]]; then
    git_run commit -m "$COMMIT_MSG"
  else
    git_run commit
  fi
else
  dim "▸ sem mudanças locais pendentes."
fi

# ── 4. fetch ─────────────────────────────────────────────
yellow "▸ fetch $REMOTE/$MAIN_BRANCH"
[[ $DRY_RUN -eq 0 ]] && git fetch "$REMOTE" "$MAIN_BRANCH"

# ── 5. rebase if diverged ────────────────────────────────
if git rev-parse --verify "$REMOTE/$MAIN_BRANCH" >/dev/null 2>&1; then
  local_sha="$(git rev-parse HEAD)"
  remote_sha="$(git rev-parse "$REMOTE/$MAIN_BRANCH")"
  base_sha="$(git merge-base HEAD "$REMOTE/$MAIN_BRANCH" 2>/dev/null || echo '')"

  if [[ "$local_sha" == "$remote_sha" ]]; then
    dim "▸ HEAD == $REMOTE/$MAIN_BRANCH (nada a pushar)"
    green "✓ done."
    exit 0
  elif [[ "$base_sha" == "$remote_sha" ]]; then
    dim "▸ local ahead de $REMOTE/$MAIN_BRANCH — fast-forward."
  else
    yellow "▸ divergiu de $REMOTE/$MAIN_BRANCH — rebase..."
    if ! git_run rebase "$REMOTE/$MAIN_BRANCH"; then
      red ""
      red "✗ rebase em conflito."
      cat <<EOF
  resolva os conflitos, depois rode:
    git add <arquivos resolvidos>
    git rebase --continue
    git push $REMOTE $MAIN_BRANCH

  pra abortar tudo (volta ao estado pré-rebase):
    git rebase --abort
EOF
      exit 1
    fi
  fi
else
  yellow "▸ $REMOTE/$MAIN_BRANCH ainda não existe — push criará a branch."
fi

# ── 6. push (regular, sem --force) ───────────────────────
yellow "▸ push $REMOTE $MAIN_BRANCH"
if [[ $DRY_RUN -eq 0 ]]; then
  if ! git push "$REMOTE" "$MAIN_BRANCH"; then
    red ""
    red "✗ push falhou."
    cat <<EOF
  causa provável: alguém pushou em $REMOTE/$MAIN_BRANCH entre o fetch e o push.
  rode o script de novo — ele vai re-fazer fetch+rebase do estado atual.

  se persistir, investigue manualmente com:
    git fetch $REMOTE $MAIN_BRANCH
    git log --oneline HEAD..$REMOTE/$MAIN_BRANCH
EOF
    exit 1
  fi
fi

green "✓ sync done."
[[ $DRY_RUN -eq 0 ]] && git log -1 --oneline | sed 's/^/  /'
