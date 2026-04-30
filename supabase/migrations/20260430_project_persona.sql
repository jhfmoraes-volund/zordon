-- Story Hierarchy V2 — Wave 1.2
-- ProjectPersona: a quem a story serve. 3 default seedadas via trigger ao criar
-- projeto novo. Projetos existentes recebem seed via backfill.

CREATE TABLE IF NOT EXISTS public."ProjectPersona" (
  id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "projectId"  text NOT NULL REFERENCES public."Project"(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  "updatedAt"  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "persona_unique_per_project" UNIQUE ("projectId", name)
);

CREATE INDEX IF NOT EXISTS "project_persona_project_idx"
  ON public."ProjectPersona"("projectId");

-- Trigger: seed automático ao criar projeto novo
CREATE OR REPLACE FUNCTION public.seed_project_personas()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public."ProjectPersona" ("projectId", name, description) VALUES
    (NEW.id, 'Builder',  'Membro do time que executa tasks'),
    (NEW.id, 'PM',       'Gestor do projeto, define prioridades e valida entregas'),
    (NEW.id, 'Cliente',  'Stakeholder externo / usuário final do produto')
  ON CONFLICT ("projectId", name) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS "project_seed_personas_trigger" ON public."Project";
CREATE TRIGGER "project_seed_personas_trigger"
AFTER INSERT ON public."Project"
FOR EACH ROW EXECUTE FUNCTION public.seed_project_personas();
