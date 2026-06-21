#!/usr/bin/env bash
# cleanup-runbook.sh — remove artefatos dos runbooks automatizados de calibração.
#
#   bash scripts/calibrate/runbooks/cleanup-runbook.sh              # só threads [runbook]
#   bash scripts/calibrate/runbooks/cleanup-runbook.sh --staging <ceremony> <min>
#                                                                   # + staging MTA recente
#
# Threads de teste são taggeadas com título '[runbook]…' — seguro deletar.
# Staging (MeetingTaskAction do DV3) NÃO tem threadId, então é opt-in por
# ceremony + janela de tempo (cuidado: não apague backfill real).
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
if [[ -z "${DIRECT_URL:-}" ]]; then
  _t="$(mktemp)"; grep '^DIRECT_URL=' "$REPO_ROOT/.env" | head -1 | sed 's/^/export /' > "$_t"; source "$_t"; rm -f "$_t"
fi
_psql() { psql "$DIRECT_URL" -At -q "$@"; }

echo "Removendo threads [runbook]… + turns/messages/events:"
_psql <<'SQL'
WITH th AS (SELECT id FROM "ChatThread" WHERE title LIKE '[runbook]%'),
     tn AS (SELECT id FROM "ChatTurn" WHERE "threadId" IN (SELECT id FROM th)),
     de AS (DELETE FROM "ChatTurnEvent" WHERE "turnId" IN (SELECT id FROM tn) RETURNING 1),
     dt AS (DELETE FROM "ChatTurn" WHERE "threadId" IN (SELECT id FROM th) RETURNING 1),
     dm AS (DELETE FROM "ChatMessage" WHERE "threadId" IN (SELECT id FROM th) RETURNING 1),
     dh AS (DELETE FROM "ChatThread" WHERE id IN (SELECT id FROM th) RETURNING 1)
SELECT 'events='||(SELECT count(*) FROM de)||' turns='||(SELECT count(*) FROM dt)||
       ' msgs='||(SELECT count(*) FROM dm)||' threads='||(SELECT count(*) FROM dh);
SQL

if [[ "${1:-}" == "--staging" ]]; then
  CEREMONY="${2:?ceremony id}"; MIN="${3:?minutos}"
  echo "Removendo MeetingTaskAction da ceremony $CEREMONY criadas nos últimos $MIN min:"
  _psql -c "DELETE FROM \"MeetingTaskAction\" WHERE \"planningCeremonyId\"='$CEREMONY' AND \"createdAt\" > now() - interval '$MIN min';"
fi
echo "done."
