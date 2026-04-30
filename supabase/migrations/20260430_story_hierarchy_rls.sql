-- Story Hierarchy V2 — Wave 2
-- RLS pra Module / ProjectPersona / UserStory / AcceptanceCriterion.
-- Reusa helpers existentes: is_manager, can_view_project, can_edit_tasks.

-- ─── Module ──────────────────────────────────────────────────────────────────

ALTER TABLE public."Module" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "module_select" ON public."Module";
DROP POLICY IF EXISTS "module_write"  ON public."Module";

CREATE POLICY "module_select" ON public."Module"
  FOR SELECT TO authenticated
  USING (public.is_manager() OR public.can_view_project("projectId"));

-- INSERT/UPDATE/DELETE: apenas manager (taxonomia é PM-only)
CREATE POLICY "module_write" ON public."Module"
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

-- ─── ProjectPersona ──────────────────────────────────────────────────────────

ALTER TABLE public."ProjectPersona" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "persona_select" ON public."ProjectPersona";
DROP POLICY IF EXISTS "persona_write"  ON public."ProjectPersona";

CREATE POLICY "persona_select" ON public."ProjectPersona"
  FOR SELECT TO authenticated
  USING (public.is_manager() OR public.can_view_project("projectId"));

CREATE POLICY "persona_write" ON public."ProjectPersona"
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

-- ─── UserStory ───────────────────────────────────────────────────────────────

ALTER TABLE public."UserStory" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "story_select" ON public."UserStory";
DROP POLICY IF EXISTS "story_insert" ON public."UserStory";
DROP POLICY IF EXISTS "story_update" ON public."UserStory";
DROP POLICY IF EXISTS "story_delete" ON public."UserStory";

CREATE POLICY "story_select" ON public."UserStory"
  FOR SELECT TO authenticated
  USING (public.is_manager() OR public.can_view_project("projectId"));

-- INSERT: manager OU builder alocado (Alpha bypassa via service-role).
CREATE POLICY "story_insert" ON public."UserStory"
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_manager() OR public.can_edit_tasks("projectId")
  );

-- UPDATE: manager sempre. Builder alocado pode atualizar (acValidatedAt/By são
-- gatekeeped na camada API — ver story-hierarchy-migration.md §3.2.5).
CREATE POLICY "story_update" ON public."UserStory"
  FOR UPDATE TO authenticated
  USING (public.is_manager() OR public.can_edit_tasks("projectId"))
  WITH CHECK (public.is_manager() OR public.can_edit_tasks("projectId"));

CREATE POLICY "story_delete" ON public."UserStory"
  FOR DELETE TO authenticated
  USING (public.is_manager());

-- ─── AcceptanceCriterion ─────────────────────────────────────────────────────

ALTER TABLE public."AcceptanceCriterion" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ac_select" ON public."AcceptanceCriterion";
DROP POLICY IF EXISTS "ac_write"  ON public."AcceptanceCriterion";

CREATE POLICY "ac_select" ON public."AcceptanceCriterion"
  FOR SELECT TO authenticated
  USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."UserStory" us
      WHERE us.id = "AcceptanceCriterion"."userStoryId"
        AND public.can_view_project(us."projectId")
    )
    OR EXISTS (
      SELECT 1 FROM public."Task" t
      WHERE t.id = "AcceptanceCriterion"."taskId"
        AND public.can_view_project(t."projectId")
    )
  );

CREATE POLICY "ac_write" ON public."AcceptanceCriterion"
  FOR ALL TO authenticated
  USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."UserStory" us
      WHERE us.id = "AcceptanceCriterion"."userStoryId"
        AND public.can_edit_tasks(us."projectId")
    )
    OR EXISTS (
      SELECT 1 FROM public."Task" t
      WHERE t.id = "AcceptanceCriterion"."taskId"
        AND public.can_edit_tasks(t."projectId")
    )
  )
  WITH CHECK (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."UserStory" us
      WHERE us.id = "AcceptanceCriterion"."userStoryId"
        AND public.can_edit_tasks(us."projectId")
    )
    OR EXISTS (
      SELECT 1 FROM public."Task" t
      WHERE t.id = "AcceptanceCriterion"."taskId"
        AND public.can_edit_tasks(t."projectId")
    )
  );
