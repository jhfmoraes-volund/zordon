-- ─── DesignSession.isMain ──────────────────────────────────────────────
-- Marca a DS canônica do projeto pra cada `type` (Inception, Continuous
-- Improvement, etc). Consumida pela aba Sessions (sobe pro topo da coluna
-- Publicado) e por agentes que precisam da "fonte do porquê" do projeto.
--
-- Regras:
--   1. Só DS pública pode ser main (não faz sentido canon ser invisível pra
--      guest). Reforçado via CHECK constraint.
--   2. No máximo 1 main por (projectId, type). Reforçado via unique partial
--      index.
--   3. Demote automático: quando uma DS public+main vira internal, perde o
--      flag (trigger BEFORE UPDATE).

ALTER TABLE public."DesignSession"
  ADD COLUMN "isMain" boolean NOT NULL DEFAULT false;

ALTER TABLE public."DesignSession"
  ADD CONSTRAINT "DesignSession_isMain_requires_public"
  CHECK (NOT ("isMain" = true AND "visibility" <> 'public'));

CREATE UNIQUE INDEX "DesignSession_isMain_per_type"
  ON public."DesignSession" ("projectId", "type")
  WHERE "isMain" = true;

CREATE OR REPLACE FUNCTION public.demote_main_on_visibility_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."visibility" <> 'public' AND NEW."isMain" = true THEN
    NEW."isMain" := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS design_session_demote_main ON public."DesignSession";
CREATE TRIGGER design_session_demote_main
  BEFORE UPDATE OF "visibility" ON public."DesignSession"
  FOR EACH ROW
  EXECUTE FUNCTION public.demote_main_on_visibility_change();

-- View design_session_summary precisa expor isMain pra listagem usar.
DROP VIEW IF EXISTS public.design_session_summary;
CREATE VIEW public.design_session_summary AS
 SELECT ds.id,
    ds."projectId",
    ds.type,
    ds.status,
    ds.title,
    ds.description,
    ds."currentStep",
    ds."totalSteps",
    ds."scheduledAt",
    ds."completedAt",
    ds."actualDurationMin",
    ds."createdBy",
    ds."createdAt",
    ds."updatedAt",
    ds."visibility",
    ds."isMain",
    (count(dsi.id))::integer AS item_count
   FROM ("DesignSession" ds
     LEFT JOIN "DesignSessionItem" dsi ON ((dsi."sessionId" = ds.id)))
  GROUP BY ds.id;
