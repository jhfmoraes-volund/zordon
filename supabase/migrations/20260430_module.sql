-- Story Hierarchy V2 — Wave 1.3
-- Module: tag de agrupamento por área funcional do produto.
-- Sem owner, sem due date — apenas taxonomia.

CREATE TABLE IF NOT EXISTS public."Module" (
  id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "projectId"  text NOT NULL REFERENCES public."Project"(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  "updatedAt"  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "module_name_format" CHECK (name ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT "module_unique_per_project" UNIQUE ("projectId", name)
);

CREATE INDEX IF NOT EXISTS "module_project_idx" ON public."Module"("projectId");
