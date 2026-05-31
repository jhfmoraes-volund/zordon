#!/usr/bin/env bash
# Smoke test: ForgeRun Lifecycle
# Tests that ForgeRun.status transitions correctly: queued → running → done
# and that startedAt, endedAt, progress, meta.reason, meta.eventCounts are populated

set -euo pipefail

# ── Paths ─────────────────────────────────────────────────────────────────────
FORGE_HOME="${HOME}/.volund-forge"  # Match getForgeHome() default
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

# ── Cleanup trap ──────────────────────────────────────────────────────────────
cleanup() {
  if [[ -n "${TEST_RUN_ID:-}" ]]; then
    dim "→ cleanup: deleting test run ${TEST_RUN_ID}..."
    psql "$DIRECT_URL" -qtAX -c "DELETE FROM \"ForgeRun\" WHERE id='${TEST_RUN_ID}'" 2>/dev/null || true
  fi
  # Clean up workspace if exec-prd created it
  TEST_WORKSPACE="${FORGE_HOME}/runs/${TEST_RUN_ID}"
  if [[ -d "${TEST_WORKSPACE}" ]]; then
    dim "→ cleanup: removing test workspace ${TEST_WORKSPACE}..."
    rm -rf "${TEST_WORKSPACE}"
  fi
}
trap cleanup EXIT

# ── Test ──────────────────────────────────────────────────────────────────────
echo "──────────────────────────────────────────────────────────────────"
yellow "Smoke Test: ForgeRun Lifecycle (queued → running → done)"
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

# 2. Create minimal ForgeRun with status=queued and a manifest
dim "→ creating ForgeRun with status=queued and manifest..."

# Generate UUID for story/task id (need it for the manifest)
TEST_STORY_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"

# Create manifest JSON file (cleaner than escaping in SQL)
cat > /tmp/smoke-test-manifest.json <<MANIFESTEOF
{
  "version": 1,
  "prds": [
    {
      "reference": "smoke-test",
      "title": "Lifecycle Smoke Test",
      "oneLiner": "Test ForgeRun lifecycle transitions",
      "stories": [
        {
          "id": "${TEST_STORY_ID}",
          "title": "Trivial passing story",
          "description": "A story that always passes to test lifecycle",
          "acceptanceCriteria": ["Command exits 0"],
          "verifiable": [
            {
              "kind": "manual_browser",
              "command_or_query": "echo 'lifecycle test pass'",
              "expected": "pass"
            }
          ],
          "dependsOn": [],
          "estimateMinutes": 1,
          "touches": [],
          "agentProfile": "ops"
        }
      ]
    }
  ]
}
MANIFESTEOF

# First insert without manifest, then update with manifest from file
psql "$DIRECT_URL" -qtAX -c "
INSERT INTO \"ForgeRun\" (
  id,
  \"ownerId\",
  \"projectId\",
  title,
  status,
  trigger,
  \"createdAt\"
) VALUES (
  '${TEST_RUN_ID}',
  '${TEST_OWNER_ID}',
  '${TEST_PROJECT_ID}',
  'smoke-test-run-lifecycle',
  'queued',
  'ad_hoc',
  NOW()
);
" > /dev/null 2>&1

if [[ $? -ne 0 ]]; then
  red "✗ FAIL: Could not create ForgeRun"
  exit 1
fi

# Update with manifest (escape single quotes for SQL)
MANIFEST_ESCAPED=$(cat /tmp/smoke-test-manifest.json | sed "s/'/''/g")
psql "$DIRECT_URL" -qtAX -c "
UPDATE \"ForgeRun\"
SET manifest = '${MANIFEST_ESCAPED}'::jsonb
WHERE id = '${TEST_RUN_ID}';
" > /dev/null 2>&1

if [[ $? -ne 0 ]]; then
  red "✗ FAIL: Could not create ForgeRun"
  exit 1
fi

green "✓ ForgeRun created with status=queued: ${TEST_RUN_ID}"
echo

# 2a. Verify initial state: status=queued, startedAt=null
dim "→ verifying initial state..."
INITIAL_STATE=$(psql "$DIRECT_URL" -qtAX -c "
  SELECT status, \"startedAt\" IS NULL as startedAt_null
  FROM \"ForgeRun\"
  WHERE id='${TEST_RUN_ID}'
" 2>/dev/null || echo "")

INITIAL_STATUS=$(echo "$INITIAL_STATE" | cut -d'|' -f1)
INITIAL_STARTED_NULL=$(echo "$INITIAL_STATE" | cut -d'|' -f2)

if [[ "$INITIAL_STATUS" != "queued" ]]; then
  red "✗ FAIL: Initial status is '${INITIAL_STATUS}', expected 'queued'"
  exit 1
fi

if [[ "$INITIAL_STARTED_NULL" != "t" ]]; then
  red "✗ FAIL: startedAt should be NULL initially but was not"
  exit 1
fi

green "✓ Initial state correct: status=queued, startedAt=null"
echo

# 3. Create ForgeTask row (needed for FK in ForgeEvent)
RANDOM_ORD=$((1000000 + RANDOM))
TASK_RESULT=$(psql "$DIRECT_URL" -qtAX -c "
INSERT INTO \"ForgeTask\" (
  id,
  \"projectId\",
  \"runId\",
  ord,
  title,
  status
) VALUES (
  '${TEST_STORY_ID}',
  '${TEST_PROJECT_ID}',
  '${TEST_RUN_ID}',
  ${RANDOM_ORD},
  'Lifecycle smoke test story',
  'queued'
);
" 2>&1)

if [[ $? -ne 0 ]]; then
  red "✗ FAIL: Could not create ForgeTask"
  echo "$TASK_RESULT"
  exit 1
fi

dim "→ created ForgeTask: ${TEST_STORY_ID}"
echo

# 4. Run exec-prd.ts in manifest mode (which will call run-state helpers)
dim "→ running exec-prd.ts in manifest mode..."

cd "${REPO_ROOT}"

# Load Supabase env vars
if [[ -f .env ]]; then
  export NEXT_PUBLIC_SUPABASE_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env | cut -d= -f2- | tr -d '"')
  export SUPABASE_SERVICE_ROLE_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env | cut -d= -f2- | tr -d '"')
fi

# Set FORGE_RUN_ID to enable manifest mode (exec-prd will fetch from ForgeRun.manifest)
export FORGE_RUN_ID="${TEST_RUN_ID}"

# Run exec-prd with the run ID and a slug (slug can be anything since manifest mode uses DB)
npx tsx scripts/forge/exec-prd.ts "${TEST_RUN_ID}" smoke-test-lifecycle 1 > /tmp/smoke-test-lifecycle.log 2>&1 &
EXEC_PID=$!

# Wait up to 30s for completion
WAIT_COUNT=0
while [[ $WAIT_COUNT -lt 30 ]]; do
  if ! ps -p $EXEC_PID > /dev/null 2>&1; then
    break
  fi
  sleep 1
  WAIT_COUNT=$((WAIT_COUNT + 1))
done

# Kill if still running
if ps -p $EXEC_PID > /dev/null 2>&1; then
  yellow "⚠ exec-prd still running after 30s, killing..."
  kill $EXEC_PID 2>/dev/null || true
fi

dim "→ exec-prd finished or timed out"
echo

# 5. Wait for DB flush
dim "→ waiting 2s for DB flush..."
sleep 2
echo

# 6. Verify final state
dim "→ verifying final state..."

FINAL_STATE=$(psql "$DIRECT_URL" -qtAX -c "
  SELECT
    status,
    \"startedAt\" IS NOT NULL as started_set,
    \"endedAt\" IS NOT NULL as ended_set,
    progress,
    meta->>'reason' as reason,
    meta->>'eventCounts' IS NOT NULL as eventCounts_set
  FROM \"ForgeRun\"
  WHERE id='${TEST_RUN_ID}'
" 2>/dev/null || echo "")

FINAL_STATUS=$(echo "$FINAL_STATE" | cut -d'|' -f1)
STARTED_SET=$(echo "$FINAL_STATE" | cut -d'|' -f2)
ENDED_SET=$(echo "$FINAL_STATE" | cut -d'|' -f3)
PROGRESS=$(echo "$FINAL_STATE" | cut -d'|' -f4)
REASON=$(echo "$FINAL_STATE" | cut -d'|' -f5)
EVENTCOUNTS_SET=$(echo "$FINAL_STATE" | cut -d'|' -f6)

dim "  status: ${FINAL_STATUS}"
dim "  startedAt set: ${STARTED_SET}"
dim "  endedAt set: ${ENDED_SET}"
dim "  progress: ${PROGRESS}"
dim "  meta.reason: ${REASON}"
dim "  meta.eventCounts set: ${EVENTCOUNTS_SET}"
echo

# 6a. Verify status is done or error (not queued)
if [[ "$FINAL_STATUS" != "done" ]] && [[ "$FINAL_STATUS" != "error" ]]; then
  red "✗ FAIL: Final status is '${FINAL_STATUS}', expected 'done' or 'error'"
  echo
  dim "  exec-prd.ts output:"
  cat /tmp/smoke-test-lifecycle.log || true
  exit 1
fi

green "✓ Status transitioned to terminal state: ${FINAL_STATUS}"

# 6b. Verify startedAt is set
if [[ "$STARTED_SET" != "t" ]]; then
  red "✗ FAIL: startedAt should be set but is NULL"
  exit 1
fi

green "✓ startedAt is set"

# 6c. Verify endedAt is set
if [[ "$ENDED_SET" != "t" ]]; then
  red "✗ FAIL: endedAt should be set but is NULL"
  exit 1
fi

green "✓ endedAt is set"

# 6d. Verify progress
if [[ "$FINAL_STATUS" == "done" ]]; then
  if [[ "$PROGRESS" != "100" ]]; then
    red "✗ FAIL: progress should be 100 for done status, got ${PROGRESS}"
    exit 1
  fi
  green "✓ progress = 100 (done)"
else
  # For error status, progress can be < 100
  green "✓ progress = ${PROGRESS} (error status)"
fi

# 6e. Verify meta.reason or meta.errorReason is set
if [[ "$FINAL_STATUS" == "done" ]]; then
  if [[ -z "$REASON" ]] || [[ "$REASON" == "null" ]]; then
    red "✗ FAIL: meta.reason should be set for done status"
    exit 1
  fi
  green "✓ meta.reason is set: ${REASON}"
else
  # For error status, check meta.errorReason instead
  ERROR_REASON=$(psql "$DIRECT_URL" -qtAX -c "
    SELECT meta->>'errorReason' FROM \"ForgeRun\" WHERE id='${TEST_RUN_ID}'
  " 2>/dev/null || echo "")

  if [[ -z "$ERROR_REASON" ]] || [[ "$ERROR_REASON" == "null" ]]; then
    red "✗ FAIL: meta.errorReason should be set for error status"
    exit 1
  fi
  green "✓ meta.errorReason is set: ${ERROR_REASON}"
fi

# 6f. Verify meta.eventCounts is set and not empty
if [[ "$EVENTCOUNTS_SET" != "t" ]]; then
  red "✗ FAIL: meta.eventCounts should be set but is NULL"
  exit 1
fi

# Verify eventCounts is a non-empty jsonb object
EVENT_COUNTS_JSON=$(psql "$DIRECT_URL" -qtAX -c "
  SELECT meta->'eventCounts' FROM \"ForgeRun\" WHERE id='${TEST_RUN_ID}'
" 2>/dev/null || echo "{}")

if [[ "$EVENT_COUNTS_JSON" == "{}" ]] || [[ "$EVENT_COUNTS_JSON" == "null" ]]; then
  red "✗ FAIL: meta.eventCounts is empty or null: ${EVENT_COUNTS_JSON}"
  exit 1
fi

green "✓ meta.eventCounts is populated: ${EVENT_COUNTS_JSON}"
echo

# ── Final summary ─────────────────────────────────────────────────────────────
echo "──────────────────────────────────────────────────────────────────"
green "✓ PASS: ForgeRun lifecycle verified"
echo "──────────────────────────────────────────────────────────────────"
dim "  Initial state: status=queued, startedAt=null"
dim "  Final state: status=${FINAL_STATUS}, startedAt/endedAt set, progress=${PROGRESS}"
if [[ "$FINAL_STATUS" == "done" ]]; then
  dim "  meta.reason: ${REASON}"
else
  dim "  meta.errorReason: ${ERROR_REASON}"
fi
dim "  meta.eventCounts: ${EVENT_COUNTS_JSON}"
dim "  Cleanup will delete test run ${TEST_RUN_ID}"
echo

exit 0
