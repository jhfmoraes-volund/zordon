#!/usr/bin/env bash
#
# scripts/sync-main.sh — sincroniza local → remote(s)/main (local como SSOT).
#
# Fluxo:
#   1. valida branch + repo
#   2. checa arquivos sensíveis ANTES de stagear
#   3. stagea tudo (inclui untracked) e commita
#   4. detecta remotes; se >1, pergunta qual (staging, prod, ambos)
#   5. fetch + rebase em cima do remote primário (linear history)
#   6. push regular (sem --force) pra cada target escolhido
#
# Uso:
#   scripts/sync-main.sh                          # abre $EDITOR pra mensagem; push pra TODOS os remotes (default)
#   scripts/sync-main.sh -m "feat: msg"           # mensagem inline; push pra todos
#   scripts/sync-main.sh --to staging             # push só pra staging
#   scripts/sync-main.sh --to origin              # push só pra origin (prod)
#   scripts/sync-main.sh --to all                 # explícito (mesmo que default)
#   scripts/sync-main.sh --dry-run                # mostra o que faria
#   scripts/sync-main.sh --force-branch           # permite rodar fora da main
#
# Default behavior: when no --to flag is given AND multiple remotes exist,
# push pra TODOS. Otimiza pra LLMs / CI / scripts encadeados — sem prompt
# interativo. Pra escolher um único target, use --to <nome>.
#
# Adicionar segundo remote (uma vez):
#   git remote add staging <url>
#
# Salvaguardas:
#   - Bloqueia se .env, *.pem, *.key, credentials.*, id_rsa* aparecerem
#   - Só rebase, nunca merge
#   - Nunca usa --force nem --no-verify
#   - Em conflito: para com instruções claras, work tree fica intacto

set -euo pipefail

# Auto-troca de conta gh por remote (suporta múltiplas contas / repos).
# shellcheck source=lib/gh-account-switch.sh
source "$(dirname "$0")/lib/gh-account-switch.sh"

MAIN_BRANCH="${MAIN_BRANCH:-main}"
DRY_RUN=0
COMMIT_MSG=""
FORCE_BRANCH=0
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
    -m|--message)   COMMIT_MSG="${2:-}"; shift 2 ;;
    --to)           TO_ARG="${2:-}"; shift 2 ;;
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

  # ── 3. stage + auto-tag + commit ─────────────────────
  git_run add -A

  if [[ -z "$COMMIT_MSG" ]]; then
    # próximo número ZRD-JM-NN (procura em git log; tolerante a "nenhum match")
    last_n="$({ git log --all --pretty=%s 2>/dev/null || true; } \
      | { grep -oE '^ZRD-JM-[0-9]+' || true; } \
      | { grep -oE '[0-9]+$' || true; } \
      | sort -n | tail -1)"
    next_n=$(( 10#${last_n:-0} + 1 ))
    tag="$(printf 'ZRD-JM-%02d' "$next_n")"

    # diff source: --cached em modo real, HEAD em dry-run (nada foi staged)
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

# ── 4. pick target remote(s) ─────────────────────────────
REMOTES=()
while IFS= read -r line; do REMOTES+=("$line"); done < <(git remote)
if [[ ${#REMOTES[@]} -eq 0 ]]; then
  red "✗ nenhum remote configurado. adicione com: git remote add origin <url>"
  exit 1
fi

declare -a TARGETS
if [[ -n "$TO_ARG" ]]; then
  if [[ "$TO_ARG" == "all" ]]; then
    TARGETS=("${REMOTES[@]}")
  else
    # validate the named remote exists
    found=0
    for r in "${REMOTES[@]}"; do [[ "$r" == "$TO_ARG" ]] && found=1; done
    if [[ $found -eq 0 ]]; then
      red "✗ remote '$TO_ARG' não existe. configurados: ${REMOTES[*]}"
      exit 1
    fi
    TARGETS=("$TO_ARG")
  fi
elif [[ ${#REMOTES[@]} -eq 1 ]]; then
  TARGETS=("${REMOTES[0]}")
else
  # Default: push pra todos os remotes. Sem prompt — é o que LLMs / CI
  # esperam. Pra single target, use --to <nome>.
  TARGETS=("${REMOTES[@]}")
fi

dim "▸ targets: ${TARGETS[*]}"
PRIMARY="${TARGETS[0]}"

# Guarda a conta gh ativa pra restaurar no fim e troca pra que tem acesso ao
# remote primário (será usada no fetch + rebase).
gh_account_save_active
trap gh_account_restore EXIT
gh_ensure_account_for_remote "$PRIMARY"

# ── 5. fetch + rebase em cima do primário ────────────────
yellow "▸ fetch $PRIMARY/$MAIN_BRANCH"
[[ $DRY_RUN -eq 0 ]] && git fetch "$PRIMARY" "$MAIN_BRANCH"

if git rev-parse --verify "$PRIMARY/$MAIN_BRANCH" >/dev/null 2>&1; then
  local_sha="$(git rev-parse HEAD)"
  remote_sha="$(git rev-parse "$PRIMARY/$MAIN_BRANCH")"
  base_sha="$(git merge-base HEAD "$PRIMARY/$MAIN_BRANCH" 2>/dev/null || echo '')"

  if [[ "$local_sha" == "$remote_sha" ]]; then
    dim "▸ HEAD == $PRIMARY/$MAIN_BRANCH"
  elif [[ "$base_sha" == "$remote_sha" ]]; then
    dim "▸ local ahead de $PRIMARY/$MAIN_BRANCH — fast-forward."
  else
    yellow "▸ divergiu de $PRIMARY/$MAIN_BRANCH — rebase..."
    if ! git_run rebase "$PRIMARY/$MAIN_BRANCH"; then
      red ""
      red "✗ rebase em conflito."
      cat <<EOF
  resolva os conflitos, depois rode:
    git add <arquivos resolvidos>
    git rebase --continue
    git push $PRIMARY $MAIN_BRANCH

  pra abortar (volta ao estado pré-rebase):
    git rebase --abort
EOF
      exit 1
    fi
  fi
else
  yellow "▸ $PRIMARY/$MAIN_BRANCH ainda não existe — push criará a branch."
fi

# ── 6. push pra cada target ──────────────────────────────
declare -a FAILED
for t in "${TARGETS[@]}"; do
  gh_ensure_account_for_remote "$t"
  yellow "▸ push $t HEAD:$MAIN_BRANCH"
  if [[ $DRY_RUN -eq 0 ]]; then
    if ! git push "$t" "HEAD:$MAIN_BRANCH"; then
      red "✗ push pra '$t' falhou"
      FAILED+=("$t")
    fi
  fi
done

if [[ ${#FAILED[@]} -gt 0 ]]; then
  red ""
  red "✗ falhou em: ${FAILED[*]}"
  cat <<EOF
  causa provável: o remote tem commits que o local não tem, ou histórico diferente.
  inspecione com:
    git fetch <remote> $MAIN_BRANCH
    git log --oneline HEAD..<remote>/$MAIN_BRANCH

  rode o script de novo se for só "remote moveu durante o push".
EOF
  exit 1
fi

green "✓ sync done."
if [[ $DRY_RUN -eq 0 ]]; then
  git log -1 --oneline | sed 's/^/  /'
fi
