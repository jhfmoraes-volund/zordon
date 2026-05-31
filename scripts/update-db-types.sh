#!/bin/bash
# Regenerate database types from Supabase
npx supabase gen types typescript --project-id ugvqlmapqlobigkjboae > src/lib/supabase/database.types.ts
echo "✓ Database types updated"
