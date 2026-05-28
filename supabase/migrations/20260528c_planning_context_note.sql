-- ═══════════════════════════════════════════════════════════
-- PlanningContextNote — briefing como rows tipadas (NÃO jsonb).
--
-- Briefing do Alpha vira N rows atômicas, cada uma com `kind`:
--   summary | theme | risk | capacity_signal | code_observation | open_question
--
-- Por que rows e não jsonb:
--   • filtro/dismiss/insert independente por nota;
--   • multi-agent friendly (outro agente INSERTa, sem race condition);
--   • RLS por linha (esconder open_question de guest, p. ex.);
--   • schema evolui (add coluna) sem migrar dados — DS sofreu disso.
--
-- Sources como uuid[] (citação leve, não FK relacional pesada). Promove pra
-- tabela `PlanningContextNoteSource` SE algum dia "quantas notes citam este
-- transcript?" virar query frequente. YAGNI em SQL também.
--
-- Author xor: agent (alpha) OU member, nunca ambos, nunca nenhum.
--
-- Plus: MeetingTaskAction ganha FK opcional planningCeremonyId pra rastrear
-- origem das actions que vieram da planning.
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- 1. PlanningContextNote
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public."PlanningContextNote" (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "planningCeremonyId"   uuid NOT NULL REFERENCES public."PlanningCeremony"(id) ON DELETE CASCADE,
  kind                   text NOT NULL,
  content                text NOT NULL,
  "sourceTranscriptIds"  uuid[] NOT NULL DEFAULT '{}',
  "sourceMeetingIds"     uuid[] NOT NULL DEFAULT '{}',
  "sourceRepoPath"       text,
  priority               int NOT NULL DEFAULT 0,
  "dismissedAt"          timestamptz,
  "generatedAt"          timestamptz NOT NULL DEFAULT now(),
  "generatedByAgent"     text,
  "generatedByMemberId"  uuid REFERENCES public."Member"(id) ON DELETE SET NULL
);

-- kind enum
ALTER TABLE public."PlanningContextNote"
  DROP CONSTRAINT IF EXISTS "PlanningContextNote_kind_check";
ALTER TABLE public."PlanningContextNote"
  ADD CONSTRAINT "PlanningContextNote_kind_check"
  CHECK (kind = ANY (ARRAY[
    'summary'::text, 'theme'::text, 'risk'::text,
    'capacity_signal'::text, 'code_observation'::text, 'open_question'::text
  ]));

-- agent enum (extensível depois)
ALTER TABLE public."PlanningContextNote"
  DROP CONSTRAINT IF EXISTS "PlanningContextNote_generatedByAgent_check";
ALTER TABLE public."PlanningContextNote"
  ADD CONSTRAINT "PlanningContextNote_generatedByAgent_check"
  CHECK ("generatedByAgent" IS NULL OR "generatedByAgent" = ANY (ARRAY['alpha'::text]));

-- xor: agente OU membro, nunca ambos, nunca nenhum
ALTER TABLE public."PlanningContextNote"
  DROP CONSTRAINT IF EXISTS "PlanningContextNote_author_xor_check";
ALTER TABLE public."PlanningContextNote"
  ADD CONSTRAINT "PlanningContextNote_author_xor_check"
  CHECK (
    ("generatedByAgent" IS NOT NULL AND "generatedByMemberId" IS NULL)
    OR
    ("generatedByAgent" IS NULL AND "generatedByMemberId" IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS "PlanningContextNote_planning_kind_idx"
  ON public."PlanningContextNote" ("planningCeremonyId", kind)
  WHERE "dismissedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "PlanningContextNote_planning_priority_idx"
  ON public."PlanningContextNote" ("planningCeremonyId", priority DESC)
  WHERE "dismissedAt" IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public."PlanningContextNote" TO authenticated;

ALTER TABLE public."PlanningContextNote" ENABLE ROW LEVEL SECURITY;

-- SELECT: vê se vê o projeto da planning. (Refinamento futuro: esconder
-- open_question de guest — adicionar policy WHERE kind <> 'open_question'
-- OR access_level <> 'guest' quando o guest_access_hardening estabilizar.)
CREATE POLICY "planningcontextnote_select" ON public."PlanningContextNote"
  FOR SELECT USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PlanningCeremony" pc
      WHERE pc.id = "planningCeremonyId" AND public.can_view_project(pc."projectId")
    )
  );

CREATE POLICY "planningcontextnote_insert" ON public."PlanningContextNote"
  FOR INSERT WITH CHECK (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PlanningCeremony" pc
      WHERE pc.id = "planningCeremonyId" AND public.can_view_project(pc."projectId")
    )
  );

-- UPDATE: dismissar, reprioritizar, editar content. Quem vê pode editar (refina depois).
CREATE POLICY "planningcontextnote_update" ON public."PlanningContextNote"
  FOR UPDATE
  USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PlanningCeremony" pc
      WHERE pc.id = "planningCeremonyId" AND public.can_view_project(pc."projectId")
    )
  )
  WITH CHECK (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PlanningCeremony" pc
      WHERE pc.id = "planningCeremonyId" AND public.can_view_project(pc."projectId")
    )
  );

CREATE POLICY "planningcontextnote_delete" ON public."PlanningContextNote"
  FOR DELETE USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."PlanningCeremony" pc
      WHERE pc.id = "planningCeremonyId" AND public.can_view_project(pc."projectId")
    )
  );

COMMENT ON TABLE public."PlanningContextNote" IS
  'Briefing do Alpha como rows tipadas por kind. NÃO jsonb (aprendizado DS). xor: generatedByAgent OU generatedByMemberId.';

-- ═════════════════════════════════════════════════════════════════════════
-- 2. MeetingTaskAction.planningCeremonyId — rastrear origem
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE public."MeetingTaskAction"
  ADD COLUMN IF NOT EXISTS "planningCeremonyId" uuid
    REFERENCES public."PlanningCeremony"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "MeetingTaskAction_planningCeremonyId_idx"
  ON public."MeetingTaskAction" ("planningCeremonyId")
  WHERE "planningCeremonyId" IS NOT NULL;

COMMENT ON COLUMN public."MeetingTaskAction"."planningCeremonyId" IS
  'Origem da action: se proposta numa planning ceremony, registra qual. NULL = veio de fluxo legado (super_planning Meeting).';

COMMIT;
