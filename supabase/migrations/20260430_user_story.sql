-- Story Hierarchy V2 — Wave 1.4
-- UserStory: unidade narrativa "Como X, quero Y, para que Z".
-- Reference per-project (ex: CRM-US-001).

CREATE TABLE IF NOT EXISTS public."UserStory" (
  id                    text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "projectId"           text NOT NULL REFERENCES public."Project"(id) ON DELETE CASCADE,
  "moduleId"            text REFERENCES public."Module"(id) ON DELETE SET NULL,
  "proposedModuleName"  text,
  reference             text NOT NULL,

  title                 text NOT NULL,
  "personaId"           text REFERENCES public."ProjectPersona"(id),
  want                  text NOT NULL,
  "soThat"              text,

  "refinementStatus"    text NOT NULL DEFAULT 'draft'
                        CHECK ("refinementStatus" IN ('draft','refined','committed')),

  "acValidatedAt"       timestamptz,
  "acValidatedBy"       text REFERENCES public."Member"(id),

  "designSessionId"     text REFERENCES public."DesignSession"(id) ON DELETE SET NULL,
  "designSessionItemId" text REFERENCES public."DesignSessionItem"(id) ON DELETE SET NULL,

  "createdByAgent"      boolean NOT NULL DEFAULT false,
  "createdById"         text REFERENCES public."Member"(id),
  "createdAt"           timestamptz NOT NULL DEFAULT now(),
  "updatedAt"           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "user_story_reference_unique" UNIQUE (reference),
  CONSTRAINT "user_story_ac_validation_consistent" CHECK (
    ("acValidatedAt" IS NULL  AND "acValidatedBy" IS NULL) OR
    ("acValidatedAt" IS NOT NULL AND "acValidatedBy" IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS "user_story_project_idx"    ON public."UserStory"("projectId");
CREATE INDEX IF NOT EXISTS "user_story_module_idx"     ON public."UserStory"("moduleId") WHERE "moduleId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "user_story_refinement_idx" ON public."UserStory"("refinementStatus");
CREATE INDEX IF NOT EXISTS "user_story_ds_item_idx"    ON public."UserStory"("designSessionItemId") WHERE "designSessionItemId" IS NOT NULL;

-- Sequencer per-project (CRM-US-001, CRM-US-002, ...)
CREATE OR REPLACE FUNCTION public.next_user_story_reference(p_project_id text)
RETURNS text AS $$
DECLARE
  v_key text;
  v_seq int;
BEGIN
  SELECT "referenceKey" INTO v_key FROM public."Project" WHERE id = p_project_id;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Project % is missing referenceKey', p_project_id;
  END IF;

  SELECT COALESCE(MAX(
    CAST(SUBSTRING(reference FROM '\-US\-(\d+)$') AS int)
  ), 0) + 1
  INTO v_seq
  FROM public."UserStory"
  WHERE "projectId" = p_project_id;

  RETURN v_key || '-US-' || LPAD(v_seq::text, 3, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
