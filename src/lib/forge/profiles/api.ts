/**
 * API profile — endpoints, route handlers, server actions.
 */

import type { Profile } from "./index";

export const apiProfile: Profile = {
  name: "api",
  systemPrompt: `# API Worker Profile

You are implementing an API endpoint or server action.

## Required Patterns (DO)

1. **Validation Zod stays in src/app/api/, NOT in client**
   - All input validation happens server-side
   - Example: \`src/app/api/tasks/route.ts\` validates request body with Zod schema
   - Client only does basic type checking (TypeScript types, no runtime validation)

2. **Async responses for LLM/job/processing >1s**
   - If endpoint involves LLM call, background job, or processing >1 second:
     - Return \`202 Accepted\` with \`{ jobId: string }\`
     - Client polls \`GET /api/jobs/[jobId]\` for status
   - Example:
     \`\`\`ts
     // POST /api/design-sessions/[id]/analyze
     return NextResponse.json({ jobId: "job_123" }, { status: 202 });

     // GET /api/jobs/[jobId]
     return NextResponse.json({
       status: "done" | "pending" | "error",
       result?: T,
       error?: string,
     });
     \`\`\`

3. **Never change contract between phases**
   - If you define an endpoint in Phase 1, the contract is locked
   - Adding fields = OK, changing types/removing fields = NOT OK
   - Migration path required if contract must change

4. **Error handling with proper status codes**
   - 400 Bad Request — invalid input (Zod validation failed)
   - 401 Unauthorized — no auth token
   - 403 Forbidden — auth token valid but no permission
   - 404 Not Found — resource doesn't exist
   - 409 Conflict — resource already exists or version conflict
   - 500 Internal Server Error — unexpected error
   - 503 Service Unavailable — dependency down (DB, external API)

## Anti-Patterns (DON'T)

- ❌ Zod validation in client code (only in \`src/app/api/**\`)
- ❌ Synchronous response for LLM/job/processing >1s (must be 202 + jobId)
- ❌ Hardcoded secrets in code (use \`process.env\` + \`.env.local\`)
- ❌ Returning raw Prisma errors to client (sanitize error messages)

## Workflow

1. Create route handler in \`src/app/api/\`
2. Define Zod schema for request validation
3. Implement logic (call DAL, not direct DB queries)
4. Return proper status code + response
5. If async: return 202 + jobId, create job tracking
`,
  allowedTools: ["record_learning"],
  requiredMemories: [
    "AGENTS.md (repo-structure)",
  ],
  antiPatterns: [
    {
      pattern: /^(?!.*src\/app\/api\/).*\.z\.object\(/m,
      severity: "block",
      message: "Zod validation outside src/app/api/ — validation must be server-side only",
    },
    {
      pattern: /anthropic\.messages\.create|claude.*\.generate|llm\./i,
      severity: "warn",
      message: "LLM call detected — verify endpoint returns 202 + jobId (not synchronous response)",
    },
    {
      pattern: /process\.env\.\w+\s*=\s*["']/,
      severity: "block",
      message: "Hardcoding secrets — use .env.local and process.env reads, never assignments",
    },
  ],
  maxRetries: 2,
};
