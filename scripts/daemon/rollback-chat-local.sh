#!/usr/bin/env bash
# Reverte feature chat-via-claude-local na ordem segura (FKs respeitadas).
#
# Ordem reversa do apply:
#   1. ChatTurnEvent (depende de ChatTurn)
#   2. ChatTurn (depende de ChatThread, ChatMessage, ForgeDaemon, Member)
#   3. AgentMode (isolada — depende só de Member)
#   4. ForgeJob.kind (ALTER reverso — última pq ChatTurn não depende dela,
#      mas ForgeJob com kind=chat existe ainda)
#
# Uso:
#   bash scripts/daemon/rollback-chat-local.sh

set -euo pipefail

cd "$(dirname "$0")/../.."

if [[ ! -f .env ]]; then
  echo "Erro: .env não encontrado em $(pwd)" >&2
  exit 1
fi

source <(grep '^DIRECT_URL=' .env | sed 's/^/export /')

if [[ -z "${DIRECT_URL:-}" ]]; then
  echo "Erro: DIRECT_URL não setado no .env" >&2
  exit 1
fi

ROLLBACK_DIR="supabase/migrations/rollback"

FILES=(
  "20260602i_chat_local_chat_turn_event_rollback"
  "20260602h_chat_local_chat_turn_rollback"
  "20260602j_chat_local_agent_mode_rollback"
  "20260602g_chat_local_forge_job_kind_rollback"
)

echo "→ Rollback chat-via-claude-local em 4 etapas:"
echo ""

for f in "${FILES[@]}"; do
  echo "  → $f"
  if ! psql "$DIRECT_URL" -f "$ROLLBACK_DIR/$f.sql"; then
    echo ""
    echo "✗ Falhou em $f. Estado parcial — investigue antes de re-rodar." >&2
    exit 1
  fi
  echo ""
done

echo "✓ Rollback completo. Regenere os tipos:"
echo "  npm run db:types"
