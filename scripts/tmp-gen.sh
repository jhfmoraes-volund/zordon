#!/bin/bash
bunx supabase gen types typescript --project-id ugvqlmapqlobigkjboae > src/lib/supabase/database.types.ts
echo "✓ Types regenerated"
