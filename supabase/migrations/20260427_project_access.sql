-- ═══════════════════════════════════════════════════════════
-- ProjectAccess: fonte única de visibilidade por projeto.
--
-- Separa 3 eixos antes acoplados em ProjectMember:
--   1. Identidade  → auth.users (+ Member opcional pra funcionários)
--   2. Acesso      → ProjectAccess (esta tabela; viewer/session_participant/contributor/lead)
--   3. Alocação    → ProjectMember (continua existindo, só pra fpAllocation)
--
-- Manager (pm/head-ops/ceo) é bypass em tudo via is_manager().
-- Trigger em ProjectMember mantém ProjectAccess sincronizado:
--   INSERT/UPDATE → upsert (role=contributor)
--   DELETE       → contributor rebaixa pra viewer (mantém visão histórica)
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Tabela ProjectAccess ────────────────────────────────

CREATE TABLE IF NOT EXISTS public."ProjectAccess" (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId"    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "projectId" text NOT NULL REFERENCES public."Project"(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('viewer','session_participant','contributor','lead')),
  "grantedBy" uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  "grantedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("userId", "projectId")
);

CREATE INDEX IF NOT EXISTS "ProjectAccess_userId_projectId_idx"
  ON public."ProjectAccess" ("userId", "projectId");
CREATE INDEX IF NOT EXISTS "ProjectAccess_projectId_idx"
  ON public."ProjectAccess" ("projectId");

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public."ProjectAccess" TO anon, authenticated;

-- ─── 2. Backfill: ProjectMember → ProjectAccess (contributor) ─

INSERT INTO public."ProjectAccess" (id, "userId", "projectId", role, "grantedAt")
SELECT
  gen_random_uuid()::text,
  m."userId",
  pm."projectId",
  'contributor',
  pm."createdAt"
FROM public."ProjectMember" pm
JOIN public."Member" m ON m.id = pm."memberId"
WHERE m."userId" IS NOT NULL
ON CONFLICT ("userId", "projectId") DO NOTHING;

-- ─── 3. Helpers RLS ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.can_view_project(p_project_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."ProjectAccess"
    WHERE "userId" = auth.uid() AND "projectId" = p_project_id
  )
$$;

CREATE OR REPLACE FUNCTION public.can_edit_sessions(p_project_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."ProjectAccess"
    WHERE "userId" = auth.uid()
      AND "projectId" = p_project_id
      AND role IN ('session_participant','contributor','lead')
  )
$$;

CREATE OR REPLACE FUNCTION public.can_edit_tasks(p_project_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."ProjectAccess"
    WHERE "userId" = auth.uid()
      AND "projectId" = p_project_id
      AND role IN ('contributor','lead')
  )
$$;

-- can_access_session passa a usar can_view_project (visão segue acesso ao projeto)
CREATE OR REPLACE FUNCTION public.can_access_session(p_session_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.is_manager() OR EXISTS (
    SELECT 1 FROM public."DesignSession" ds
    WHERE ds.id = p_session_id
      AND public.can_view_project(ds."projectId")
  )
$$;

CREATE OR REPLACE FUNCTION public.can_edit_session(p_session_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.is_manager() OR EXISTS (
    SELECT 1 FROM public."DesignSession" ds
    WHERE ds.id = p_session_id
      AND public.can_edit_sessions(ds."projectId")
  )
$$;

-- is_allocated_to: deprecated, mantido como alias pra callers em transição.
-- TODO: remover em migration futura quando confirmar zero callers.
COMMENT ON FUNCTION public.is_allocated_to(text) IS
  'DEPRECATED: use can_view_project (visão) ou can_edit_tasks/can_edit_sessions (edição).';

-- ─── 4. Project: tighten SELECT ─────────────────────────────
-- Antes: USING (true). Agora: manager OU tem ProjectAccess.

DROP POLICY IF EXISTS "authenticated_select" ON public."Project";
CREATE POLICY "manager_or_viewer_select" ON public."Project"
  FOR SELECT TO authenticated
  USING (public.is_manager() OR public.can_view_project(id));

-- ─── 5. Sprint: tighten SELECT ──────────────────────────────

DROP POLICY IF EXISTS "authenticated_select" ON public."Sprint";
CREATE POLICY "manager_or_viewer_select" ON public."Sprint"
  FOR SELECT TO authenticated
  USING (public.is_manager() OR public.can_view_project("projectId"));

-- ─── 6. ProjectMember: tighten SELECT ───────────────────────

DROP POLICY IF EXISTS "authenticated_select" ON public."ProjectMember";
CREATE POLICY "manager_or_viewer_select" ON public."ProjectMember"
  FOR SELECT TO authenticated
  USING (public.is_manager() OR public.can_view_project("projectId"));

-- ─── 7. ProjectSquad: tighten SELECT ────────────────────────

DROP POLICY IF EXISTS "authenticated_select" ON public."ProjectSquad";
CREATE POLICY "manager_or_viewer_select" ON public."ProjectSquad"
  FOR SELECT TO authenticated
  USING (public.is_manager() OR public.can_view_project("projectId"));

-- ─── 8. Task: tighten SELECT + swap mutations ───────────────

DROP POLICY IF EXISTS "authenticated_select" ON public."Task";
DROP POLICY IF EXISTS "manager_or_allocated_select" ON public."Task";
DROP POLICY IF EXISTS "manager_or_allocated_insert" ON public."Task";
DROP POLICY IF EXISTS "manager_or_allocated_update" ON public."Task";
DROP POLICY IF EXISTS "manager_or_allocated_delete" ON public."Task";

CREATE POLICY "manager_or_viewer_select" ON public."Task"
  FOR SELECT TO authenticated
  USING (public.is_manager() OR public.can_view_project("projectId"));

CREATE POLICY "manager_or_editor_insert" ON public."Task"
  FOR INSERT TO authenticated
  WITH CHECK (public.is_manager() OR public.can_edit_tasks("projectId"));

CREATE POLICY "manager_or_editor_update" ON public."Task"
  FOR UPDATE TO authenticated
  USING (public.is_manager() OR public.can_edit_tasks("projectId"));

CREATE POLICY "manager_or_editor_delete" ON public."Task"
  FOR DELETE TO authenticated
  USING (public.is_manager() OR public.can_edit_tasks("projectId"));

-- ─── 9. TaskAssignment + TaskIteration: derivar via Task ────

DO $$
DECLARE tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY['TaskAssignment','TaskIteration']) LOOP
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_select" ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "manager_or_allocated_select" ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "manager_or_allocated_insert" ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "manager_or_allocated_update" ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "manager_or_allocated_delete" ON public.%I', tbl);

    EXECUTE format($p$
      CREATE POLICY "manager_or_viewer_select" ON public.%I
        FOR SELECT TO authenticated
        USING (public.is_manager() OR EXISTS (
          SELECT 1 FROM public."Task" t
          WHERE t.id = %I."taskId"
            AND public.can_view_project(t."projectId")
        ))
    $p$, tbl, tbl);

    EXECUTE format($p$
      CREATE POLICY "manager_or_editor_insert" ON public.%I
        FOR INSERT TO authenticated
        WITH CHECK (public.is_manager() OR EXISTS (
          SELECT 1 FROM public."Task" t
          WHERE t.id = %I."taskId"
            AND public.can_edit_tasks(t."projectId")
        ))
    $p$, tbl, tbl);

    EXECUTE format($p$
      CREATE POLICY "manager_or_editor_update" ON public.%I
        FOR UPDATE TO authenticated
        USING (public.is_manager() OR EXISTS (
          SELECT 1 FROM public."Task" t
          WHERE t.id = %I."taskId"
            AND public.can_edit_tasks(t."projectId")
        ))
    $p$, tbl, tbl);

    EXECUTE format($p$
      CREATE POLICY "manager_or_editor_delete" ON public.%I
        FOR DELETE TO authenticated
        USING (public.is_manager() OR EXISTS (
          SELECT 1 FROM public."Task" t
          WHERE t.id = %I."taskId"
            AND public.can_edit_tasks(t."projectId")
        ))
    $p$, tbl, tbl);
  END LOOP;
END $$;

-- ─── 10. DesignSession: SELECT via can_view_project, mutate via can_edit_sessions ─

DROP POLICY IF EXISTS "manager_or_allocated_select" ON public."DesignSession";
DROP POLICY IF EXISTS "manager_or_allocated_insert" ON public."DesignSession";
DROP POLICY IF EXISTS "manager_or_allocated_update" ON public."DesignSession";
DROP POLICY IF EXISTS "manager_or_allocated_delete" ON public."DesignSession";

CREATE POLICY "manager_or_viewer_select" ON public."DesignSession"
  FOR SELECT TO authenticated
  USING (public.is_manager() OR public.can_view_project("projectId"));

CREATE POLICY "manager_or_editor_insert" ON public."DesignSession"
  FOR INSERT TO authenticated
  WITH CHECK (public.is_manager() OR public.can_edit_sessions("projectId"));

CREATE POLICY "manager_or_editor_update" ON public."DesignSession"
  FOR UPDATE TO authenticated
  USING (public.is_manager() OR public.can_edit_sessions("projectId"));

CREATE POLICY "manager_or_editor_delete" ON public."DesignSession"
  FOR DELETE TO authenticated
  USING (public.is_manager() OR public.can_edit_sessions("projectId"));

-- ─── 11. DesignSession children: can_access_session (read) + can_edit_session (write) ─

DO $$
DECLARE tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'DesignSessionParticipant',
    'DesignSessionStepData',
    'DesignSessionItem'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS "manager_or_allocated_select" ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "manager_or_allocated_insert" ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "manager_or_allocated_update" ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "manager_or_allocated_delete" ON public.%I', tbl);

    EXECUTE format($p$
      CREATE POLICY "manager_or_viewer_select" ON public.%I
        FOR SELECT TO authenticated
        USING (public.can_access_session("sessionId"))
    $p$, tbl);

    EXECUTE format($p$
      CREATE POLICY "manager_or_editor_insert" ON public.%I
        FOR INSERT TO authenticated
        WITH CHECK (public.can_edit_session("sessionId"))
    $p$, tbl);

    EXECUTE format($p$
      CREATE POLICY "manager_or_editor_update" ON public.%I
        FOR UPDATE TO authenticated
        USING (public.can_edit_session("sessionId"))
    $p$, tbl);

    EXECUTE format($p$
      CREATE POLICY "manager_or_editor_delete" ON public.%I
        FOR DELETE TO authenticated
        USING (public.can_edit_session("sessionId"))
    $p$, tbl);
  END LOOP;
END $$;

-- ─── 12. RLS na ProjectAccess ──────────────────────────────

ALTER TABLE public."ProjectAccess" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "self_or_manager_select" ON public."ProjectAccess"
  FOR SELECT TO authenticated
  USING ("userId" = auth.uid() OR public.is_manager());

CREATE POLICY "manager_insert" ON public."ProjectAccess"
  FOR INSERT TO authenticated WITH CHECK (public.is_manager());

CREATE POLICY "manager_update" ON public."ProjectAccess"
  FOR UPDATE TO authenticated USING (public.is_manager());

CREATE POLICY "manager_delete" ON public."ProjectAccess"
  FOR DELETE TO authenticated USING (public.is_manager());

-- ─── 13. Triggers: ProjectMember ↔ ProjectAccess sync ─────

CREATE OR REPLACE FUNCTION public.sync_project_access_from_member()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_user uuid;
BEGIN
  SELECT "userId" INTO v_user FROM public."Member" WHERE id = NEW."memberId";
  IF v_user IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public."ProjectAccess" (id, "userId", "projectId", role)
  VALUES (gen_random_uuid()::text, v_user, NEW."projectId", 'contributor')
  ON CONFLICT ("userId", "projectId") DO UPDATE
    SET role = CASE
      -- Promove se era viewer/session_participant; preserva contributor/lead.
      WHEN "ProjectAccess".role IN ('viewer','session_participant') THEN 'contributor'
      ELSE "ProjectAccess".role
    END;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.demote_access_on_member_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_user uuid;
BEGIN
  SELECT "userId" INTO v_user FROM public."Member" WHERE id = OLD."memberId";
  IF v_user IS NULL THEN
    RETURN OLD;
  END IF;

  -- Rebaixa contributor pra viewer; preserva lead, viewer, session_participant.
  UPDATE public."ProjectAccess"
     SET role = 'viewer'
   WHERE "userId" = v_user
     AND "projectId" = OLD."projectId"
     AND role = 'contributor';
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS project_member_sync_access ON public."ProjectMember";
CREATE TRIGGER project_member_sync_access
  AFTER INSERT OR UPDATE ON public."ProjectMember"
  FOR EACH ROW EXECUTE FUNCTION public.sync_project_access_from_member();

DROP TRIGGER IF EXISTS project_member_demote_access ON public."ProjectMember";
CREATE TRIGGER project_member_demote_access
  AFTER DELETE ON public."ProjectMember"
  FOR EACH ROW EXECUTE FUNCTION public.demote_access_on_member_delete();
