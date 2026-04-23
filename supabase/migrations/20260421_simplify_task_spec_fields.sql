-- Simplify task spec fields:
-- Drop businessContext, outOfScope, uiGuidance (absorbed by description + acceptance criteria)
-- Rename technicalNotes → notes (general-purpose)

ALTER TABLE "Task" DROP COLUMN IF EXISTS "businessContext";
ALTER TABLE "Task" DROP COLUMN IF EXISTS "outOfScope";
ALTER TABLE "Task" DROP COLUMN IF EXISTS "uiGuidance";
ALTER TABLE "Task" RENAME COLUMN "technicalNotes" TO "notes";
