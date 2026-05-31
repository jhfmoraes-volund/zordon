-- Drop CHECK constraint on ForgeEvent.kind to allow free-form event taxonomy
-- Taxonomy is now maintained in code at src/lib/forge/runtime/event-kinds.ts

ALTER TABLE "ForgeEvent" DROP CONSTRAINT IF EXISTS "ForgeEvent_kind_check";

COMMENT ON COLUMN "ForgeEvent"."kind" IS
  'Free-form text. Canonical taxonomy lives in src/lib/forge/runtime/event-kinds.ts. '
  'Examples: autorun_started, story_picked, story_done, tool_use, tool_result, '
  'assistant_text, error, autorun_done.';
