-- Project.category — classifica projeto pra a visão "Projetos" do Overview.
--
--   billable      → trabalho de cliente faturável (default)
--   non_billable  → cliente não-faturável / testes / __eval__
--   internal      → projetos internos (Volund OS, dogfooding)
--
-- Eval continua sendo convenção de nome (__eval__), escondido por default na UI;
-- aqui só fazemos backfill conservador desses pra non_billable.

ALTER TABLE "Project"
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'billable'
  CHECK (category IN ('billable', 'non_billable', 'internal'));

-- Backfill: projetos de eval/teste caem em non_billable.
UPDATE "Project"
SET category = 'non_billable'
WHERE category = 'billable'
  AND name ILIKE '%\_\_eval\_\_%';
