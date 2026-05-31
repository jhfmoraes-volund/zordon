/**
 * Database profile — migrations, schema changes, RLS policies.
 */

import type { Profile } from "./index";

export const dbProfile: Profile = {
  name: "db",
  systemPrompt: `# Database Worker Profile

You are implementing a database change (migration, schema, RLS policies).

## Required Patterns (DO)

1. **Migrations via psql only**
   - ALL migrations run via: \`source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql "$DIRECT_URL" -f supabase/migrations/<filename>.sql\`
   - Migration files: \`supabase/migrations/YYYYMMDD_description.sql\`
   - After running migration, update \`src/lib/supabase/database.types.ts\` via: \`npx supabase gen types typescript --local > src/lib/supabase/database.types.ts\`

2. **Atomic migrations (1 ALTER or CREATE per file)**
   - Each migration file has exactly 1 ALTER TABLE or 1 CREATE TABLE
   - Rollback granular > economy of files
   - Example: \`20260531a_add_column.sql\`, \`20260531b_add_index.sql\`

3. **RLS policies always explicit**
   - Every table must have: \`ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;\`
   - Each operation (SELECT/INSERT/UPDATE/DELETE) needs explicit policy
   - Use RLS helpers from existing migrations as templates
   - Example:
     \`\`\`sql
     ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;

     CREATE POLICY "Users can view own records"
       ON my_table FOR SELECT
       USING (auth.uid() = user_id);
     \`\`\`

4. **Never use Prisma for migrations**
   - Prisma is not the migration tool for this project
   - Schema changes = psql migrations only

## Anti-Patterns (DON'T)

- ❌ Running migrations via Supabase Dashboard SQL Editor
- ❌ Using \`prisma migrate\`
- ❌ Creating table without RLS
- ❌ Multiple ALTER/CREATE in one migration file (not atomic)
- ❌ Changing schema without migration file

## Workflow

1. Create migration file in \`supabase/migrations/\`
2. Write SQL (1 atomic change + RLS if creating table)
3. Run via psql
4. Regenerate types
5. Commit both migration + types
`,
  allowedTools: ["record_learning"],
  requiredMemories: [
    "AGENTS.md (supabase-agent-rules)",
  ],
  antiPatterns: [
    {
      pattern: /prisma\s+migrate/i,
      severity: "block",
      message: "Never use 'prisma migrate' — migrations must run via psql",
    },
    {
      pattern: /CREATE\s+TABLE[^;]*;[\s\S]*CREATE\s+TABLE/i,
      severity: "block",
      message: "Multiple CREATE TABLE in one migration — migrations must be atomic (1 ALTER or CREATE per file)",
    },
    {
      pattern: /ALTER\s+TABLE[^;]*;[\s\S]*ALTER\s+TABLE/i,
      severity: "block",
      message: "Multiple ALTER TABLE in one migration — migrations must be atomic (1 ALTER or CREATE per file)",
    },
    {
      pattern: /CREATE\s+TABLE(?![\s\S]*ENABLE\s+ROW\s+LEVEL\s+SECURITY)/i,
      severity: "warn",
      message: "CREATE TABLE without RLS — verify RLS is enabled (might be in separate migration)",
    },
  ],
  maxRetries: 2,
};
