#!/usr/bin/env bash
#
# scripts/lib/gh-account-switch.sh — descobre qual conta `gh` tem acesso ao
# remote git e a ativa antes do push.
#
# Uso (via `source`):
#
#   source "$(dirname "$0")/lib/gh-account-switch.sh"
#
#   gh_account_save_active           # guarda a conta ativa atual (uma vez)
#   gh_ensure_account_for_remote origin   # antes de cada push
#   gh_ensure_account_for_remote staging
#   gh_account_restore               # no fim (trap EXIT recomendado)
#
# Comportamento:
#   - parseia a URL do remote (https://github.com/OWNER/REPO[.git] ou
#     git@github.com:OWNER/REPO) pra achar OWNER/REPO.
#   - lista contas gh autenticadas; pra cada uma, faz GH_TOKEN=<token> gh api
#     repos/OWNER/REPO. A primeira que retornar 200 é a que tem acesso.
#   - se a conta ativa já tem acesso, no-op (mensagem dim).
#   - se outra conta tem acesso, roda `gh auth switch -u <conta>`.
#   - se nenhuma tem (ou gh CLI não está disponível), avisa e segue sem falhar
#     — o `git push` vai falhar por conta própria e o erro fica claro.
#
# Salvaguardas:
#   - cacheia o lookup por remote (na primeira chamada de cada um)
#   - silencioso quando não precisa trocar; só fala quando muda
#   - nunca falha o script chamador (set -e safe)
#

# Evita re-source.
if [[ -n "${_GH_ACCOUNT_SWITCH_SH_LOADED:-}" ]]; then return 0; fi
_GH_ACCOUNT_SWITCH_SH_LOADED=1

_gh_red()    { printf '\033[31m%s\033[0m\n' "$*" >&2; }
_gh_yellow() { printf '\033[33m%s\033[0m\n' "$*" >&2; }
_gh_dim()    { printf '\033[2m%s\033[0m\n' "$*" >&2; }

# Conta gh ativa no momento do save (pra restaurar depois).
_GH_ORIGINAL_ACTIVE=""
# Cache: arrays paralelos (Bash 3 compatível). Cada índice em _GH_CACHE_KEYS
# tem o remote name; o índice correspondente em _GH_CACHE_VALS tem a conta gh
# que funciona, ou "__none__" se nenhuma funciona.
_GH_CACHE_KEYS=()
_GH_CACHE_VALS=()

# Lê do cache. Echoes valor se achar, vazio se não.
_gh_cache_get() {
  local key="$1" i
  for i in "${!_GH_CACHE_KEYS[@]}"; do
    if [[ "${_GH_CACHE_KEYS[$i]}" == "$key" ]]; then
      printf '%s' "${_GH_CACHE_VALS[$i]}"
      return 0
    fi
  done
}

# Escreve no cache (overwrite se já existir).
_gh_cache_set() {
  local key="$1" val="$2" i
  for i in "${!_GH_CACHE_KEYS[@]}"; do
    if [[ "${_GH_CACHE_KEYS[$i]}" == "$key" ]]; then
      _GH_CACHE_VALS[$i]="$val"
      return 0
    fi
  done
  _GH_CACHE_KEYS+=("$key")
  _GH_CACHE_VALS+=("$val")
}

# Verifica se `gh` está disponível e há ao menos uma conta autenticada.
_gh_available() {
  command -v gh >/dev/null 2>&1 || return 1
  gh auth status >/dev/null 2>&1 || return 1
  return 0
}

# Lista contas autenticadas (uma por linha). Robusto pra `gh auth status`
# que muda formato entre versões — usa regex pra "Logged in to github.com
# account NAME" (singular ou plural).
_gh_list_accounts() {
  gh auth status 2>&1 \
    | awk '/Logged in to github\.com account / {
        for (i=1; i<=NF; i++) if ($i == "account") { print $(i+1); next }
      }'
}

# Conta atualmente ativa (única). Retorna vazio se falhar.
_gh_active_account() {
  gh auth status --active 2>/dev/null \
    | awk '/Logged in to github\.com account / {
        for (i=1; i<=NF; i++) if ($i == "account") { print $(i+1); exit }
      }'
}

# Parseia a URL de remote em OWNER/REPO. Echoes "" se não der.
_gh_remote_to_slug() {
  local url="$1"
  # https://github.com/OWNER/REPO(.git)?  ou  git@github.com:OWNER/REPO(.git)?
  local slug
  slug="$(printf '%s\n' "$url" \
    | sed -E 's#^https?://[^/]+/##; s#^git@[^:]+:##; s#\.git$##')"
  # Aceita só algo no formato OWNER/REPO (rejeita vazios e gh.io)
  if [[ "$slug" =~ ^[^/]+/[^/]+$ ]]; then
    printf '%s' "$slug"
  fi
}

# Salva a conta ativa atual pra restaurar no fim. Idempotente.
gh_account_save_active() {
  _gh_available || return 0
  [[ -n "$_GH_ORIGINAL_ACTIVE" ]] && return 0
  _GH_ORIGINAL_ACTIVE="$(_gh_active_account)"
}

# Garante que a conta ativa tem acesso ao OWNER/REPO do remote dado.
# Se a conta ativa não tem acesso, mas outra conta autenticada tem, troca.
# Se nenhuma tem, só avisa — o git push vai expor o erro real.
gh_ensure_account_for_remote() {
  local remote="$1"

  _gh_available || { _gh_dim "▸ gh CLI indisponível — pulando troca de conta"; return 0; }

  local url slug cached
  url="$(git remote get-url "$remote" 2>/dev/null || true)"
  if [[ -z "$url" ]]; then
    _gh_yellow "▸ remote '$remote' não existe — gh-switch pulado"
    return 0
  fi

  # Só lida com github.com — outros hosts (gitlab, etc.) ignora.
  if [[ "$url" != *github.com* ]]; then
    _gh_dim "▸ '$remote' não é github.com — gh-switch pulado"
    return 0
  fi

  slug="$(_gh_remote_to_slug "$url")"
  if [[ -z "$slug" ]]; then
    _gh_dim "▸ remote '$remote' URL não-parseável ('$url') — gh-switch pulado"
    return 0
  fi

  # Cache hit
  cached="$(_gh_cache_get "$remote")"
  if [[ -n "$cached" ]]; then
    if [[ "$cached" == "__none__" ]]; then
      return 0  # já avisamos antes
    fi
    _gh_switch_if_needed "$cached" "$slug" "$remote"
    return 0
  fi

  local active accounts acc token
  active="$(_gh_active_account)"

  # Tenta primeiro a conta ativa — caminho feliz, evita listar.
  if [[ -n "$active" ]] && _gh_account_can_access "$active" "$slug"; then
    _gh_cache_set "$remote" "$active"
    _gh_dim "▸ gh: '$active' já tem acesso a $slug"
    return 0
  fi

  # Tenta cada outra conta autenticada.
  accounts="$(_gh_list_accounts)"
  while IFS= read -r acc; do
    [[ -z "$acc" ]] && continue
    [[ "$acc" == "$active" ]] && continue  # já testada
    if _gh_account_can_access "$acc" "$slug"; then
      _gh_cache_set "$remote" "$acc"
      _gh_switch_if_needed "$acc" "$slug" "$remote"
      return 0
    fi
  done <<<"$accounts"

  # Ninguém tem acesso — registra no cache e avisa uma vez.
  _gh_cache_set "$remote" "__none__"
  _gh_yellow "▸ gh: nenhuma conta autenticada tem acesso a $slug (remote '$remote')"
  _gh_dim   "  contas testadas: $(printf '%s' "$accounts" | tr '\n' ' ')"
  _gh_dim   "  o push provavelmente vai falhar — autentique com 'gh auth login'"
  return 0
}

# Roda `repos/<slug>` autenticando como <account>. Retorna 0 se 200.
_gh_account_can_access() {
  local account="$1" slug="$2" token
  token="$(gh auth token --user "$account" 2>/dev/null || true)"
  [[ -z "$token" ]] && return 1
  GH_TOKEN="$token" gh api "repos/$slug" --silent >/dev/null 2>&1
}

# Ativa <account> se ela não for a ativa atual.
_gh_switch_if_needed() {
  local target="$1" slug="$2" remote="$3" active
  active="$(_gh_active_account)"
  if [[ "$active" == "$target" ]]; then
    _gh_dim "▸ gh: '$target' já está ativo (acesso a $slug)"
    return 0
  fi
  _gh_yellow "▸ gh: trocando ativa '$active' → '$target' (acesso a $slug, remote '$remote')"
  gh auth switch -u "$target" >/dev/null 2>&1 || {
    _gh_red "✗ gh: falhou ao ativar '$target'"
    return 1
  }
}

# Restaura a conta ativa original. Idempotente.
gh_account_restore() {
  _gh_available || return 0
  [[ -z "$_GH_ORIGINAL_ACTIVE" ]] && return 0
  local current
  current="$(_gh_active_account)"
  if [[ "$current" != "$_GH_ORIGINAL_ACTIVE" ]]; then
    _gh_dim "▸ gh: restaurando conta ativa '$current' → '$_GH_ORIGINAL_ACTIVE'"
    gh auth switch -u "$_GH_ORIGINAL_ACTIVE" >/dev/null 2>&1 || true
  fi
}
