#!/usr/bin/env bash
#
# scripts/ralph/lib/prd-paths.sh — helpers compartilhados pra resolver PRDs
# entre os subdirs de estado (docs/prd/{backlog,ready,in-progress,blocked,done,archive}).
#
# Use:
#   source "$(git rev-parse --show-toplevel)/scripts/ralph/lib/prd-paths.sh"
#   prd_find <feature>       # imprime caminho do PRD; retorna 1 se não achar
#   prd_state <feature>      # imprime nome do subdir (backlog/ready/...); 1 se não achar
#   prd_move <feature> <target_state>  # mv entre subdirs (sem rename de filename)

PRD_ROOT="${PRD_ROOT:-$(git rev-parse --show-toplevel)/docs/prd}"
PRD_STATES=(in-progress ready blocked backlog done archive)

prd_find() {
  local feature="$1"
  local filename="prd-${feature}.md"
  local state path
  for state in "${PRD_STATES[@]}"; do
    path="$PRD_ROOT/$state/$filename"
    if [ -f "$path" ]; then
      echo "$path"
      return 0
    fi
  done
  # legacy fallback (PRD ainda na raiz de docs/prd/)
  if [ -f "$PRD_ROOT/$filename" ]; then
    echo "$PRD_ROOT/$filename"
    return 0
  fi
  return 1
}

prd_state() {
  local feature="$1"
  local filename="prd-${feature}.md"
  local state
  for state in "${PRD_STATES[@]}"; do
    if [ -f "$PRD_ROOT/$state/$filename" ]; then
      echo "$state"
      return 0
    fi
  done
  if [ -f "$PRD_ROOT/$filename" ]; then
    echo "_legacy_root"
    return 0
  fi
  return 1
}

prd_move() {
  local feature="$1"
  local target="$2"
  local filename="prd-${feature}.md"
  local current_state current_path target_path
  current_state="$(prd_state "$feature")" || {
    echo "❌ PRD não encontrado: $filename" >&2
    return 1
  }
  if [ "$current_state" = "_legacy_root" ]; then
    current_path="$PRD_ROOT/$filename"
  else
    current_path="$PRD_ROOT/$current_state/$filename"
  fi
  mkdir -p "$PRD_ROOT/$target"
  target_path="$PRD_ROOT/$target/$filename"
  if [ "$current_path" = "$target_path" ]; then
    return 0
  fi
  mv "$current_path" "$target_path"
}

prd_list_state() {
  local state="$1"
  local dir="$PRD_ROOT/$state"
  [ -d "$dir" ] || return 0
  find "$dir" -maxdepth 1 -name 'prd-*.md' -type f 2>/dev/null | sort
}
