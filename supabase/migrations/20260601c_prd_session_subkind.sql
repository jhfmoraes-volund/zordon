-- PRD Session subKind column
-- Supports two modes: 'upload' (paste/upload markdown) and 'quick_ask' (chat with Vitor)
-- Only applies when type='prd_session'; NULL for other types.

ALTER TABLE "DesignSession"
  ADD COLUMN IF NOT EXISTS "subKind" text;

COMMENT ON COLUMN "DesignSession"."subKind" IS
  'Subtype for prd_session: upload | quick_ask. NULL for other session types.';

-- Partial index for efficient filtering of prd_session by subKind
CREATE INDEX IF NOT EXISTS ix_designsession_type_subkind
  ON "DesignSession" (type, "subKind")
  WHERE type = 'prd_session';
