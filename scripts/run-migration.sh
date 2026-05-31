#!/bin/bash
# Run a single migration file via psql
set -e

if [ -z "$1" ]; then
  echo "Usage: bash scripts/run-migration.sh <migration-file>"
  exit 1
fi

MIGRATION_FILE="$1"

if [ ! -f "$MIGRATION_FILE" ]; then
  echo "Error: Migration file not found: $MIGRATION_FILE"
  exit 1
fi

# Load DIRECT_URL from .env
export $(grep "^DIRECT_URL=" .env | xargs)

if [ -z "$DIRECT_URL" ]; then
  echo "Error: DIRECT_URL not found in .env"
  exit 1
fi

echo "Running migration: $MIGRATION_FILE"
psql "$DIRECT_URL" -f "$MIGRATION_FILE"
echo "✓ Migration complete"
