-- Add isExternal flag to Member table
-- Identifies members who belong to external companies (e.g. Extreme Group)
-- rather than being Volund employees.

ALTER TABLE public."Member"
  ADD COLUMN "isExternal" BOOLEAN NOT NULL DEFAULT false;
