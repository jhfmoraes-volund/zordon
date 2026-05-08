-- Garante unicidade case-insensitive pro referenceKey do Project.
-- Index parcial → permite múltiplos NULLs durante transição.

CREATE UNIQUE INDEX IF NOT EXISTS "project_reference_key_unique_idx"
  ON public."Project" (UPPER("referenceKey"))
  WHERE "referenceKey" IS NOT NULL;
