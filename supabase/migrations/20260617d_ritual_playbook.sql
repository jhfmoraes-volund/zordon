-- Ritual Playbook (design synth 2026-06-17): config por (projeto, ritual) que o
-- PM autora e o cron/manual consomem pra moldar como a Vitoria gera o ritual.
-- O COMPORTAMENTO das capabilities vive em código (src/lib/rituals/capability-
-- registry.ts); a tabela guarda só os PARAMS, como array ordenado em jsonb.
-- jsonb-not-child-table: lista pequena (<10), ordenada, lida inteira a cada run,
-- nada filtra SQL pra dentro das instâncias. Output da Vitoria fica FIXO; o
-- playbook só move inputs (fontes linkadas), audiência e ênfase.

BEGIN;

CREATE TABLE IF NOT EXISTS public."RitualPlaybook" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId"    uuid NOT NULL REFERENCES public."Project"(id) ON DELETE CASCADE,
  "ritualType"   text NOT NULL,
  -- array ordenado de instâncias { capabilityKey, enabled, params }, validado
  -- contra o paramsSchema (Zod) do registry na rota de autoria.
  capabilities   jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled        boolean NOT NULL DEFAULT true,
  "authoredById" uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  "createdAt"    timestamptz NOT NULL DEFAULT now(),
  "updatedAt"    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "RitualPlaybook_ritualType_check"
    CHECK ("ritualType" = ANY (ARRAY['pm_review'::text, 'planning'::text, 'release_planning'::text])),
  -- Singleton por (projeto, ritual): cron e Sintetizar fazem 1 maybeSingle().
  CONSTRAINT "RitualPlaybook_project_ritual_key" UNIQUE ("projectId", "ritualType")
);

CREATE INDEX IF NOT EXISTS "RitualPlaybook_project_idx"
  ON public."RitualPlaybook" ("projectId");

GRANT SELECT, INSERT, UPDATE, DELETE ON public."RitualPlaybook" TO authenticated;
ALTER TABLE public."RitualPlaybook" ENABLE ROW LEVEL SECURITY;

-- Mesma autoridade do PM Review / binding de folder: lê quem vê o projeto,
-- escreve PM-lead ou admin.
CREATE POLICY "ritualplaybook_select" ON public."RitualPlaybook"
  FOR SELECT USING (public.is_manager() OR public.can_view_project("projectId"));
CREATE POLICY "ritualplaybook_insert" ON public."RitualPlaybook"
  FOR INSERT WITH CHECK (public.is_manager() OR public.can_create_pm_review("projectId"));
CREATE POLICY "ritualplaybook_update" ON public."RitualPlaybook"
  FOR UPDATE USING (public.is_manager() OR public.can_create_pm_review("projectId"))
  WITH CHECK (public.is_manager() OR public.can_create_pm_review("projectId"));
CREATE POLICY "ritualplaybook_delete" ON public."RitualPlaybook"
  FOR DELETE USING (public.is_manager() OR public.can_create_pm_review("projectId"));

COMMIT;
