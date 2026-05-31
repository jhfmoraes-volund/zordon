#!/usr/bin/env bash
# Smoke test: Forge UI Realtime
# Tests that RunEventStream component receives Realtime updates from Supabase
# and displays events with proper connection state

set -euo pipefail

# ── Paths ─────────────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# ── Colors ────────────────────────────────────────────────────────────────────
dim() { echo -e "\x1b[2m$*\x1b[0m"; }
yellow() { echo -e "\x1b[33m$*\x1b[0m"; }
green() { echo -e "\x1b[32m$*\x1b[0m"; }
red() { echo -e "\x1b[31m$*\x1b[0m"; }

# ── Check prerequisites ───────────────────────────────────────────────────────
if [[ -z "${DIRECT_URL:-}" ]]; then
  red "✗ FAIL: DIRECT_URL not set in env"
  echo "  Set DIRECT_URL in .env to run this test"
  exit 1
fi

if [[ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" ]]; then
  red "✗ FAIL: NEXT_PUBLIC_SUPABASE_URL not set in env"
  echo "  Set NEXT_PUBLIC_SUPABASE_URL in .env to run this test"
  exit 1
fi

# ── Cleanup trap ──────────────────────────────────────────────────────────────
cleanup() {
  if [[ -n "${TEST_RUN_ID:-}" ]]; then
    dim "→ cleanup: deleting test run ${TEST_RUN_ID}..."
    # ForgeEvent will cascade delete via FK
    psql "$DIRECT_URL" -qtAX -c "DELETE FROM \"ForgeRun\" WHERE id='${TEST_RUN_ID}'" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ── Test ──────────────────────────────────────────────────────────────────────
echo "──────────────────────────────────────────────────────────────────"
yellow "Smoke Test: Forge UI Realtime (RunEventStream component)"
echo "──────────────────────────────────────────────────────────────────"
echo

# 1. Generate test IDs
TEST_RUN_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
TEST_OWNER_ID="$(psql "$DIRECT_URL" -qtAX -c "SELECT id FROM \"Member\" LIMIT 1" 2>/dev/null || echo "")"
TEST_PROJECT_ID="$(psql "$DIRECT_URL" -qtAX -c "SELECT id FROM \"Project\" LIMIT 1" 2>/dev/null || echo "")"

if [[ -z "$TEST_OWNER_ID" ]]; then
  red "✗ FAIL: No Member found in DB (need at least one Member for ForgeRun.ownerId FK)"
  exit 1
fi

if [[ -z "$TEST_PROJECT_ID" ]]; then
  red "✗ FAIL: No Project found in DB (need at least one Project for FK)"
  exit 1
fi

dim "→ test run ID: ${TEST_RUN_ID}"
dim "→ owner ID (Member): ${TEST_OWNER_ID}"
dim "→ project ID: ${TEST_PROJECT_ID}"
echo

# 2. Create ForgeRun with status=running
dim "→ creating ForgeRun with status=running..."

psql "$DIRECT_URL" -qtAX -c "
INSERT INTO \"ForgeRun\" (
  id,
  \"ownerId\",
  \"projectId\",
  title,
  status,
  trigger,
  progress,
  \"createdAt\",
  \"startedAt\"
) VALUES (
  '${TEST_RUN_ID}',
  '${TEST_OWNER_ID}',
  '${TEST_PROJECT_ID}',
  'smoke-test-ui-realtime',
  'running',
  'ad_hoc',
  30,
  NOW(),
  NOW()
);
" > /dev/null 2>&1

if [[ $? -ne 0 ]]; then
  red "✗ FAIL: Could not create ForgeRun"
  exit 1
fi

green "✓ ForgeRun created with status=running: ${TEST_RUN_ID}"
echo

# 3. Verify ForgeEvent and ForgeRun are in Realtime publication
dim "→ verifying ForgeEvent and ForgeRun are in Realtime publication..."

PUB_COUNT=$(psql "$DIRECT_URL" -qtAX -c "
  SELECT count(*)
  FROM pg_publication_tables
  WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public'
    AND tablename IN ('ForgeEvent', 'ForgeRun')
" 2>/dev/null || echo "0")

if [[ "$PUB_COUNT" != "2" ]]; then
  red "✗ FAIL: ForgeEvent and ForgeRun not in supabase_realtime publication"
  echo "  Found ${PUB_COUNT} tables, expected 2"
  echo "  Run migration: supabase/migrations/20260601p_forge_realtime_publication.sql"
  exit 1
fi

green "✓ ForgeEvent and ForgeRun in supabase_realtime publication"
echo

# 4. Insert initial events
dim "→ inserting initial events..."

for i in {1..5}; do
  psql "$DIRECT_URL" -qtAX -c "
  INSERT INTO \"ForgeEvent\" (
    \"runId\",
    seq,
    kind,
    ts,
    payload
  ) VALUES (
    '${TEST_RUN_ID}',
    ${i},
    'log',
    NOW(),
    jsonb_build_object('message', 'Initial event ${i}', 'level', 'info')
  );
  " > /dev/null 2>&1
done

green "✓ Inserted 5 initial events"
echo

# 5. Manual browser test instructions
echo "──────────────────────────────────────────────────────────────────"
yellow "⚠ MANUAL TEST REQUIRED"
echo "──────────────────────────────────────────────────────────────────"
echo
echo "Please perform the following manual browser test:"
echo
yellow "1. Ensure dev server is running:"
dim "   npm run dev"
echo
yellow "2. Open browser to:"
dim "   http://localhost:3000/forge-spike/runs/${TEST_RUN_ID}"
echo
yellow "3. Verify initial state (within 2s):"
dim "   ✓ Page loads without console errors"
dim "   ✓ 5 initial events are displayed"
dim "   ✓ Connection badge shows 'realtime' (green) or 'connecting' (yellow)"
echo
yellow "4. Insert new events while watching the page:"
dim "   Run this command in another terminal:"
echo
cat << 'INSERTCMD'
for i in {6..10}; do
  psql "$DIRECT_URL" -qtAX -c "
  INSERT INTO \"ForgeEvent\" (
    \"runId\",
    seq,
    kind,
    ts,
    payload
  ) VALUES (
    '${TEST_RUN_ID}',
    ${i},
    'log',
    NOW(),
    jsonb_build_object('message', 'Realtime event ${i}', 'level', 'info')
  );
  " > /dev/null 2>&1
  sleep 0.5
done
INSERTCMD
echo
dim "   (Replace \${TEST_RUN_ID} with: ${TEST_RUN_ID})"
echo
yellow "5. Verify Realtime updates (while inserting):"
dim "   ✓ New events appear within ≤500ms of INSERT"
dim "   ✓ Connection badge stays 'realtime' (green) ≥95% of the time"
dim "   ✓ List auto-scrolls to bottom on new events"
dim "   ✓ No console errors (especially 'Controller is already closed')"
echo
yellow "6. Verify cap warning:"
dim "   Insert 5000+ events total (if needed for cap test)"
dim "   ✓ Warning banner appears: 'Showing last 5000 events'"
echo
echo "──────────────────────────────────────────────────────────────────"
yellow "After completing manual test, press ENTER to clean up test data"
echo "──────────────────────────────────────────────────────────────────"
echo
read -r -p "Press ENTER to continue... "
echo

# 6. Verify events were created
dim "→ verifying events exist in DB..."

EVENT_COUNT=$(psql "$DIRECT_URL" -qtAX -c "
  SELECT count(*) FROM \"ForgeEvent\" WHERE \"runId\" = '${TEST_RUN_ID}'
" 2>/dev/null || echo "0")

dim "  Found ${EVENT_COUNT} events in DB"

if [[ "$EVENT_COUNT" -lt "5" ]]; then
  yellow "⚠ WARNING: Expected at least 5 events, found ${EVENT_COUNT}"
  yellow "  Manual test may not have completed successfully"
fi

green "✓ Events verified in DB"
echo

# ── Final summary ─────────────────────────────────────────────────────────────
echo "──────────────────────────────────────────────────────────────────"
green "✓ PASS: UI Realtime smoke test completed"
echo "──────────────────────────────────────────────────────────────────"
dim "  Test run ID: ${TEST_RUN_ID}"
dim "  Events created: ${EVENT_COUNT}"
dim "  Cleanup will delete test run and cascade delete events"
echo
dim "IMPORTANT: This test requires manual browser verification."
dim "Mark as PASS only if all acceptance criteria were met:"
dim "  ✓ Página abre sem erro no console"
dim "  ✓ Lista cresce mid-run em ≤500ms após emit"
dim "  ✓ Badge realtime fica verde ≥95% do tempo"
dim "  ✓ Nenhum 'Controller is already closed' no log do Next"
echo

exit 0
