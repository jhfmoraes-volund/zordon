#!/usr/bin/env bash
#
# scripts/ralph/ralph.sh — autonomous PRD execution loop for Volund
#
# Usage:
#   scripts/ralph/ralph.sh <feature> [max_iterations]
#
# Args:
#   <feature>          name of feature dir under scripts/ralph/features/
#   [max_iterations]   default: 10
#
# Loop semantics (per iteration):
#   1. Check prd.json — if all stories pass, exit 0 (COMPLETE).
#   2. Spawn fresh `claude -p` with prompt = CLAUDE.md.
#      Claude picks next ready story, implements it, runs verifiable checks,
#      commits via sync-main.sh on success, appends to progress.txt.
#   3. Verify post-iteration state. If no commit happened AND no progress
#      written, count as failed iteration.
#   4. Repeat until: COMPLETE, max_iterations hit, or 3 consecutive failures.
#
# Requires: claude CLI, jq, pnpm, bash >= 4
#
# See docs/runbooks/ralph-process.md for the full process.

set -euo pipefail

# ─── args & validation ──────────────────────────────────────────────────────

if [ $# -lt 1 ]; then
  echo "usage: $0 <feature> [max_iterations]" >&2
  exit 64
fi

FEATURE="$1"
MAX_ITER="${2:-10}"

REPO_ROOT="$(git rev-parse --show-toplevel)"
RALPH_DIR="$REPO_ROOT/scripts/ralph"
FEATURE_DIR="$RALPH_DIR/features/$FEATURE"
PRD_JSON="$FEATURE_DIR/prd.json"
PROGRESS="$FEATURE_DIR/progress.txt"
PROMPT_FILE="$RALPH_DIR/CLAUDE.md"

if [ ! -f "$PRD_JSON" ]; then
  echo "❌ prd.json not found: $PRD_JSON" >&2
  echo "   Run Rito 1 (Intake) first — see docs/runbooks/ralph-process.md" >&2
  exit 65
fi

if [ ! -f "$PROMPT_FILE" ]; then
  echo "❌ prompt template not found: $PROMPT_FILE" >&2
  exit 65
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "❌ claude CLI not found. Install: npm i -g @anthropic-ai/claude-code" >&2
  exit 127
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "❌ jq not found. Install: brew install jq" >&2
  exit 127
fi

# ─── branch safety ──────────────────────────────────────────────────────────

CURRENT_BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
  echo "❌ refuse to run Ralph on $CURRENT_BRANCH. Switch to a feature branch first." >&2
  exit 1
fi

# ─── state helpers ──────────────────────────────────────────────────────────

touch "$PROGRESS"

stories_total() {
  jq '.userStories | length' "$PRD_JSON"
}

stories_done() {
  jq '[.userStories[] | select(.passes == true)] | length' "$PRD_JSON"
}

all_pass() {
  [ "$(jq '[.userStories[] | select(.passes != true)] | length' "$PRD_JSON")" = "0" ]
}

print_status() {
  local total done_count
  total="$(stories_total)"
  done_count="$(stories_done)"
  echo "  📋 $done_count / $total stories pass"
}

# ─── pre-flight ─────────────────────────────────────────────────────────────

echo "🤖 Ralph starting — feature=$FEATURE max_iter=$MAX_ITER branch=$CURRENT_BRANCH"
print_status

if all_pass; then
  echo "✅ already complete — nothing to do."
  exit 0
fi

# ─── main loop ──────────────────────────────────────────────────────────────

ITER=0
CONSECUTIVE_FAILS=0

while [ "$ITER" -lt "$MAX_ITER" ]; do
  ITER=$((ITER + 1))
  echo ""
  echo "─── iteration $ITER / $MAX_ITER ──────────────────────────────────────"

  if all_pass; then
    echo "✅ all stories pass — <promise>COMPLETE</promise>"
    exit 0
  fi

  # snapshot HEAD pre-iter to detect commit
  PRE_HEAD="$(git -C "$REPO_ROOT" rev-parse HEAD)"
  PRE_PROGRESS_SIZE="$(wc -c <"$PROGRESS" | tr -d ' ')"

  # ─── invoke claude with fresh context ────────────────────────────────────
  # The prompt expands $FEATURE / paths so the subprocess knows what to do.
  PROMPT="$(FEATURE="$FEATURE" \
            PRD_JSON="$PRD_JSON" \
            PROGRESS="$PROGRESS" \
            REPO_ROOT="$REPO_ROOT" \
            envsubst <"$PROMPT_FILE" 2>/dev/null || cat "$PROMPT_FILE")"

  # Pass feature context via header even if envsubst not available
  HEADER="# Ralph iteration $ITER for feature: $FEATURE
# prd.json: $PRD_JSON
# progress.txt: $PROGRESS
# repo: $REPO_ROOT
"

  echo "  ▶ spawning claude -p (fresh context)..."
  set +e
  echo -e "$HEADER\n\n$PROMPT" | claude -p \
    --output-format text \
    --permission-mode acceptEdits \
    --allowed-tools "Read,Write,Edit,Bash,Glob,Grep,TodoWrite,WebFetch" \
    2>&1 | tee -a "$PROGRESS"
  CLAUDE_EXIT=$?
  set -e

  if [ "$CLAUDE_EXIT" -ne 0 ]; then
    echo "  ⚠ claude exited with $CLAUDE_EXIT"
  fi

  # ─── post-iter verification ──────────────────────────────────────────────
  POST_HEAD="$(git -C "$REPO_ROOT" rev-parse HEAD)"
  POST_PROGRESS_SIZE="$(wc -c <"$PROGRESS" | tr -d ' ')"

  COMMITTED="false"
  [ "$PRE_HEAD" != "$POST_HEAD" ] && COMMITTED="true"

  PROGRESS_GREW="false"
  [ "$POST_PROGRESS_SIZE" -gt "$PRE_PROGRESS_SIZE" ] && PROGRESS_GREW="true"

  echo ""
  echo "  iter $ITER summary: committed=$COMMITTED progress_grew=$PROGRESS_GREW"
  print_status

  if [ "$COMMITTED" = "true" ]; then
    CONSECUTIVE_FAILS=0
  else
    CONSECUTIVE_FAILS=$((CONSECUTIVE_FAILS + 1))
    echo "  ⚠ no commit this iteration ($CONSECUTIVE_FAILS consecutive)"
    if [ "$CONSECUTIVE_FAILS" -ge 3 ]; then
      echo ""
      echo "❌ 3 consecutive failed iterations — aborting." >&2
      echo "   Run: bash scripts/ralph/checkpoint.sh $FEATURE" >&2
      exit 2
    fi
  fi
done

echo ""
echo "⏸ max_iterations ($MAX_ITER) reached. Run checkpoint:"
echo "   bash scripts/ralph/checkpoint.sh $FEATURE"
print_status
exit 0
