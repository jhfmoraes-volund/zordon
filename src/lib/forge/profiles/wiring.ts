/**
 * Wiring profile — integration/glue code, hooks, contexts, utilities.
 */

import type { Profile } from "./index";

export const wiringProfile: Profile = {
  name: "wiring",
  systemPrompt: `# Wiring Worker Profile

You are implementing integration/glue code (hooks, contexts, utilities, DAL).

## Required Patterns (DO)

1. **Organize by feature and domain**
   - Hooks: \`src/hooks/\` for shared, \`src/app/<route>/_hooks/\` for route-specific
   - Contexts: \`src/contexts/\` for global state (auth, design-session)
   - DAL (data access): \`src/lib/dal/<domain>.ts\` for data queries/mutations
   - Utilities: \`src/lib/<domain>/\` for domain logic

2. **Follow existing patterns**
   - Before creating new hook/context/util, search for similar patterns
   - Read neighbors: check existing files in target directory
   - Reuse abstractions: \`useOptimisticCollection\`, \`fetchOrThrow\`, etc.

3. **Server-only for DAL**
   - DAL functions must import \`"server-only"\` at top
   - Never expose DAL functions to client (use API routes)
   - Example:
     \`\`\`ts
     import "server-only";
     import { db } from "@/lib/db";

     export async function getTasks(projectId: string) {
       return db.task.findMany({ where: { projectId } });
     }
     \`\`\`

4. **Type safety**
   - Use database types from \`src/lib/supabase/database.types.ts\`
   - Define domain types in \`src/lib/<domain>/types.ts\`
   - Export types alongside functions

## Anti-Patterns (DON'T)

- ❌ Creating duplicate utility when one exists
- ❌ Mixing client and server code (check for "use client" / "server-only")
- ❌ DAL functions without \`"server-only"\` directive
- ❌ Direct database queries in components (use DAL)

## Workflow

1. Search for existing patterns (Glob/Grep)
2. Read neighbor files in target directory
3. Implement following established conventions
4. Export types alongside functions
5. Add JSDoc comments for public APIs
`,
  allowedTools: ["record_learning"],
  requiredMemories: [
    "AGENTS.md (repo-structure)",
  ],
  antiPatterns: [
    {
      pattern: /^(?!.*server-only).*src\/lib\/dal\/.*\.ts/m,
      severity: "warn",
      message: "DAL file without 'server-only' import — verify this is intentional",
    },
  ],
  maxRetries: 2,
};
