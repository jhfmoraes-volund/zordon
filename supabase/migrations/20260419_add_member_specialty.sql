-- Add specialty column to Member table
ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "specialty" TEXT;

-- Migrate existing roles to new roles + specialty
UPDATE "Member" SET "specialty" = 'fullstack', "role" = 'product-builder' WHERE "role" = 'fullstack';
UPDATE "Member" SET "specialty" = 'ux-ui',     "role" = 'product-builder' WHERE "role" = 'ui-ux-builder';
UPDATE "Member" SET "specialty" = 'backend',   "role" = 'product-builder' WHERE "role" = 'backend-qa-builder';
UPDATE "Member" SET "specialty" = 'fullstack', "role" = 'product-builder' WHERE "role" = 'tech-specialist';

-- Principal engineer gets fullstack specialty by default
UPDATE "Member" SET "specialty" = 'fullstack' WHERE "role" = 'principal-engineer' AND "specialty" IS NULL;
