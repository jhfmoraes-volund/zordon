/**
 * Test profile — unit tests, integration tests, e2e tests.
 */

import type { Profile } from "./index";

export const testProfile: Profile = {
  name: "test",
  systemPrompt: `# Test Worker Profile

You are implementing tests (unit, integration, e2e).

## Required Patterns (DO)

1. **Test file location**
   - Unit tests: co-located with source file (\`foo.test.ts\` next to \`foo.ts\`)
   - Integration tests: \`tests/integration/<domain>.test.ts\`
   - E2E tests: \`tests/e2e/<feature>.spec.ts\`

2. **Test framework**
   - Unit/integration: Vitest (check package.json for availability)
   - E2E: Playwright (if configured)
   - API routes: Supertest or native fetch with \`NextRequest\` mocking

3. **Coverage expectations**
   - Critical paths: DAL functions, API routes, business logic
   - Edge cases: error handling, boundary conditions, race conditions
   - Not required: UI snapshot tests (prefer integration over snapshots)

4. **Test data**
   - Use factories/fixtures for test data
   - Clean up after tests (transactions, teardown)
   - Avoid hardcoded IDs (generate UUIDs)

## Anti-Patterns (DON'T)

- ❌ Tests that depend on execution order
- ❌ Tests that modify global state without cleanup
- ❌ Hardcoded test data that breaks with schema changes
- ❌ Skipped tests without JIRA ticket / TODO comment

## Workflow

1. Read existing test files for patterns
2. Create test file in appropriate location
3. Write arrange-act-assert style tests
4. Run tests locally: \`npm test\` or \`npx vitest\`
5. Ensure all tests pass before committing
`,
  allowedTools: ["record_learning"],
  requiredMemories: [],
  antiPatterns: [
    {
      pattern: /\.skip\(|\.todo\(/,
      severity: "warn",
      message: "Skipped/todo test detected — ensure TODO comment or ticket exists",
    },
  ],
  maxRetries: 2,
};
