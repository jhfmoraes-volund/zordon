-- =============================================================================
-- Fase 1: tabela espelho DesignSessionBrainstormFeature (dual-write transparente)
-- =============================================================================
-- Promove o array `data.solutions[]` do step `brainstorm` para uma tabela
-- relacional. UI/agente continuam escrevendo no jsonb — trigger sincroniza.
-- Permite query estruturada (filtros, joins, audit) sem refatorar wizard.
--
-- Estratégia:
--   - DesignSessionBrainstormFeature reflete data.solutions[] via trigger.
--   - Toda mudança em DesignSessionStepData onde stepKey='brainstorm' replica
--     pra tabela: full-replace (delete by sessionId + insert do array atual).
--   - Backfill final popula DSs existentes.
-- =============================================================================

BEGIN;

-- ─── 1. Tabela ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."DesignSessionBrainstormFeature" (
  -- PK: combina sessionId + featureId externo (do JSON, vindo do crypto.randomUUID() do client).
  -- Não usamos PK serial porque o ID original do card precisa ser estável
  -- entre wizard <-> tabela (frontend escreve com mesmo id após edit).
  id              text NOT NULL,
  "sessionId"     uuid NOT NULL REFERENCES public."DesignSession"(id) ON DELETE CASCADE,

  -- Conteúdo (espelha solutionSchema em src/lib/agent/schemas.ts)
  title           text NOT NULL,
  "howItSolves"   text,
  "targetPersona" text,
  "keyScreens"    text,
  "userFlows"     text,
  "painPointRef"  text,
  "technicalNotes" text,
  archived        boolean NOT NULL DEFAULT false,

  -- Inferido a partir do prefixo do título: "[LOGIN][PRESTADOR] Tela ..." → "LOGIN"
  "moduleHint"    text,

  -- Bucket vem do step `prioritization` (mvp/next/out). Sincronizado por trigger separado.
  bucket          text CHECK (bucket IS NULL OR bucket IN ('mvp', 'next', 'out')),

  -- Posição no array original (preserva ordem do brainstorm pro wizard)
  "orderIndex"    int NOT NULL DEFAULT 0,

  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id, "sessionId")
);

CREATE INDEX IF NOT EXISTS brainstorm_feature_session_idx
  ON public."DesignSessionBrainstormFeature" ("sessionId");

CREATE INDEX IF NOT EXISTS brainstorm_feature_module_hint_idx
  ON public."DesignSessionBrainstormFeature" ("sessionId", "moduleHint")
  WHERE "moduleHint" IS NOT NULL;

CREATE INDEX IF NOT EXISTS brainstorm_feature_bucket_idx
  ON public."DesignSessionBrainstormFeature" ("sessionId", bucket)
  WHERE bucket IS NOT NULL;

-- ─── 2. Helper: extrair moduleHint do título ─────────────────────────────────
-- Formato esperado: "[LOGIN][PRESTADOR] Tela de Login do Prestador ✔️"
--                  → "LOGIN"  (primeira tag em colchetes)
CREATE OR REPLACE FUNCTION public.extract_module_hint(p_title text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (regexp_match(p_title, '^\[([A-Z_ÇÁÉÍÓÚÂÊÔÃÕ]+)\]'))[1];
$$;

-- ─── 3. Sync function: replica data.solutions[] pra tabela ───────────────────
CREATE OR REPLACE FUNCTION public.sync_brainstorm_features()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id uuid;
  v_solutions  jsonb;
BEGIN
  -- Sai cedo se não é o step brainstorm
  IF NEW."stepKey" <> 'brainstorm' THEN
    RETURN NEW;
  END IF;

  v_session_id := NEW."sessionId";
  v_solutions := COALESCE(NEW.data -> 'solutions', '[]'::jsonb);

  -- Full-replace: deleta tudo da sessão e re-insere o array atual.
  -- Mais simples que diff incremental e seguro porque o array nunca é tão
  -- grande (max ~100 cards) e a operação é atomica.
  DELETE FROM public."DesignSessionBrainstormFeature"
  WHERE "sessionId" = v_session_id;

  INSERT INTO public."DesignSessionBrainstormFeature" (
    id, "sessionId", title, "howItSolves", "targetPersona",
    "keyScreens", "userFlows", "painPointRef", "technicalNotes",
    archived, "moduleHint", "orderIndex", "createdAt", "updatedAt"
  )
  SELECT
    sol->>'id',
    v_session_id,
    sol->>'title',
    sol->>'howItSolves',
    sol->>'targetPersona',
    sol->>'keyScreens',
    sol->>'userFlows',
    sol->>'painPointRef',
    sol->>'technicalNotes',
    COALESCE((sol->>'archived')::boolean, false),
    public.extract_module_hint(sol->>'title'),
    (idx - 1)::int,
    now(),
    now()
  FROM jsonb_array_elements(v_solutions) WITH ORDINALITY AS t(sol, idx)
  WHERE sol->>'id' IS NOT NULL  -- ignora cards mal-formados sem id
  ON CONFLICT (id, "sessionId") DO UPDATE SET
    title = EXCLUDED.title,
    "howItSolves" = EXCLUDED."howItSolves",
    "targetPersona" = EXCLUDED."targetPersona",
    "keyScreens" = EXCLUDED."keyScreens",
    "userFlows" = EXCLUDED."userFlows",
    "painPointRef" = EXCLUDED."painPointRef",
    "technicalNotes" = EXCLUDED."technicalNotes",
    archived = EXCLUDED.archived,
    "moduleHint" = EXCLUDED."moduleHint",
    "orderIndex" = EXCLUDED."orderIndex",
    "updatedAt" = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_brainstorm_features_trigger ON public."DesignSessionStepData";
CREATE TRIGGER sync_brainstorm_features_trigger
  AFTER INSERT OR UPDATE ON public."DesignSessionStepData"
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_brainstorm_features();

-- ─── 4. Bucket sync (do step `prioritization`) ───────────────────────────────
-- O step prioritization tem data.items[] com { id, bucket }.
-- O id casa com o solution.id do brainstorm. Quando prioritization muda,
-- propagamos bucket pra DesignSessionBrainstormFeature.
CREATE OR REPLACE FUNCTION public.sync_brainstorm_buckets()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id uuid;
  v_items      jsonb;
BEGIN
  IF NEW."stepKey" <> 'prioritization' THEN
    RETURN NEW;
  END IF;

  v_session_id := NEW."sessionId";
  v_items := COALESCE(NEW.data -> 'items', '[]'::jsonb);

  -- Reset todos os buckets da sessão (item pode ter sido removido do prioritization)
  UPDATE public."DesignSessionBrainstormFeature"
  SET bucket = NULL, "updatedAt" = now()
  WHERE "sessionId" = v_session_id AND bucket IS NOT NULL;

  -- Aplica buckets atuais
  UPDATE public."DesignSessionBrainstormFeature" f
  SET bucket = i.bucket, "updatedAt" = now()
  FROM (
    SELECT
      item->>'id' AS feature_id,
      item->>'bucket' AS bucket
    FROM jsonb_array_elements(v_items) AS item
    WHERE item->>'id' IS NOT NULL
      AND item->>'bucket' IN ('mvp', 'next', 'out')
  ) i
  WHERE f.id = i.feature_id AND f."sessionId" = v_session_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_brainstorm_buckets_trigger ON public."DesignSessionStepData";
CREATE TRIGGER sync_brainstorm_buckets_trigger
  AFTER INSERT OR UPDATE ON public."DesignSessionStepData"
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_brainstorm_buckets();

-- ─── 5. Backfill: popula DSs existentes ──────────────────────────────────────
-- Re-dispara o sync explicitamente pra cada row de brainstorm/prioritization
-- atualmente no banco. UPDATE com mesmo valor já dispara o trigger.
DO $$
DECLARE
  r record;
BEGIN
  -- brainstorm primeiro (cria/popula features)
  FOR r IN
    SELECT id FROM public."DesignSessionStepData" WHERE "stepKey" = 'brainstorm'
  LOOP
    UPDATE public."DesignSessionStepData"
    SET "updatedAt" = "updatedAt"  -- no-op pra disparar trigger
    WHERE id = r.id;
  END LOOP;

  -- prioritization depois (aplica buckets)
  FOR r IN
    SELECT id FROM public."DesignSessionStepData" WHERE "stepKey" = 'prioritization'
  LOOP
    UPDATE public."DesignSessionStepData"
    SET "updatedAt" = "updatedAt"
    WHERE id = r.id;
  END LOOP;
END $$;

COMMIT;
