-- specMarkdown: o §1-§16 completo do PRD (fonte humana rica), guardado FORA do
-- alcance do trigger prd_set_markdown (que sobrescreve `markdown` a partir dos
-- campos estruturados). Backfill a partir de docs/prd/backlog/prd-<slug>.md.
ALTER TABLE "ProductRequirement"
  ADD COLUMN IF NOT EXISTS "specMarkdown" text;
