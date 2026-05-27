-- ═══════════════════════════════════════════════════════════════════════════
-- Guest Access Hardening (Fase 1 / SQL)
--
-- Contexto: guests (access_level='guest') eram convidados via ProjectAccess
-- e ganhavam acesso de viewer+ ao projeto inteiro — incluindo qualquer DS,
-- task, story, sprint. Cliente externo enxergava trabalho interno do time.
--
-- Decisão (2026-05-26):
--   • DesignSession ganha coluna `visibility` ('public' | 'internal', default
--     'internal'). Guest só enxerga DS 'public'; time interno enxerga ambas.
--   • Tasks / Stories / Sprints permanecem abertas — gate de visibilidade é
--     APENAS na DS (decisão de simplicidade do PM).
--   • Toggle de visibility: admin/manager global OU ProjectAccess
--     IN ('lead','contributor') no projeto da DS.
--   • Member ganha flag `isGuest` (default false). Guest convidado recebe
--     Member-stub com isGuest=true, fpCapacity=0 — habilita TaskComment
--     (FK aponta pra Member) mas não polui relatórios de capacidade.
--   • Helper `is_guest()` lê do JWT (espelho de is_manager/is_admin).
--   • Helper `can_view_design_session(sessionId)` substitui o uso de
--     can_view_project() na SELECT policy de DesignSession.
--   • Helper `can_change_session_visibility(sessionId)` pra rota PATCH.
--   • Views de capacidade (member_capacity_summary, member_sprint_load) e
--     a coluna isGuest do Member não precisam de mudança aqui — Fase 2 (DAL)
--     vai filtrar guest do payload. Esta migration só prepara o terreno.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. DesignSession.visibility ──────────────────────────────────────────
ALTER TABLE public."DesignSession"
  ADD COLUMN IF NOT EXISTS "visibility" text NOT NULL DEFAULT 'internal';

ALTER TABLE public."DesignSession"
  DROP CONSTRAINT IF EXISTS "DesignSession_visibility_check";

ALTER TABLE public."DesignSession"
  ADD CONSTRAINT "DesignSession_visibility_check"
  CHECK ("visibility" IN ('public', 'internal'));

CREATE INDEX IF NOT EXISTS "DesignSession_visibility_idx"
  ON public."DesignSession" ("visibility");

-- ─── 2. Member.isGuest ────────────────────────────────────────────────────
ALTER TABLE public."Member"
  ADD COLUMN IF NOT EXISTS "isGuest" boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Member_isGuest_idx"
  ON public."Member" ("isGuest") WHERE "isGuest" = true;

-- Relaxar CHECK de position/role pra aceitar Member-stubs de guest. Guests
-- não têm cargo/specialty no time interno; armazenamos NULL e o CHECK só
-- vale pros membros internos (isGuest=false).
ALTER TABLE public."Member"
  ALTER COLUMN "position" DROP NOT NULL;

ALTER TABLE public."Member"
  DROP CONSTRAINT IF EXISTS "Member_position_check";
ALTER TABLE public."Member"
  ADD CONSTRAINT "Member_position_check"
  CHECK (
    "isGuest" = true
    OR "position" = ANY (ARRAY['ceo','cro','head-ops','pm','principal-engineer','product-builder'])
  );

ALTER TABLE public."Member"
  DROP CONSTRAINT IF EXISTS "Member_role_check";
ALTER TABLE public."Member"
  ADD CONSTRAINT "Member_role_check"
  CHECK (
    "isGuest" = true
    OR role = ANY (ARRAY['ceo','cro','head-ops','pm','principal-engineer','product-builder'])
  );

-- ─── 3. is_guest() helper ─────────────────────────────────────────────────
-- Espelha is_admin()/is_manager(). Lê access_level do JWT.
CREATE OR REPLACE FUNCTION public.is_guest()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.get_my_access_level() = 'guest'
$$;

-- ─── 4. can_view_design_session(sessionId) ────────────────────────────────
-- Substitui o uso direto de can_view_project() na SELECT policy de DS.
-- Regra:
--   • is_manager() → vê tudo (admin/manager global).
--   • Guest → só DS com visibility='public' E projeto acessível (ProjectAccess).
--   • Time interno (builder+ com ProjectAccess) → vê qualquer DS do projeto.
CREATE OR REPLACE FUNCTION public.can_view_design_session(p_session_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT public.is_manager() OR EXISTS (
    SELECT 1
    FROM public."DesignSession" ds
    WHERE ds.id = p_session_id
      AND public.can_view_project(ds."projectId")
      AND (
        NOT public.is_guest()
        OR ds."visibility" = 'public'
      )
  )
$$;

-- ─── 5. can_change_session_visibility(sessionId) ─────────────────────────
-- Quem pode promover/rebaixar uma DS pra/de 'public'.
-- Regra: admin/manager global OU ProjectAccess.role IN ('lead','contributor')
-- no projeto da DS (PMs do projeto).
CREATE OR REPLACE FUNCTION public.can_change_session_visibility(p_session_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT public.is_manager() OR EXISTS (
    SELECT 1
    FROM public."DesignSession" ds
    JOIN public."ProjectAccess" pa ON pa."projectId" = ds."projectId"
    WHERE ds.id = p_session_id
      AND pa."userId" = auth.uid()
      AND pa.role IN ('lead', 'contributor')
  )
$$;

-- ─── 6. Atualizar can_access_session() ────────────────────────────────────
-- Usado por DesignSessionItem / Participant / StepData (SELECT).
-- Hoje delega pra can_view_project — guest enxerga itens de DS interna.
-- Passa a delegar pra can_view_design_session, que respeita visibility.
CREATE OR REPLACE FUNCTION public.can_access_session(p_session_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT public.can_view_design_session(p_session_id)
$$;

-- ─── 7. Atualizar can_edit_session() ──────────────────────────────────────
-- Guest NÃO pode editar DS, mesmo que pública (read-only).
-- Time interno (builder+ com ProjectAccess) edita normalmente.
CREATE OR REPLACE FUNCTION public.can_edit_session(p_session_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT NOT public.is_guest() AND (
    public.is_manager() OR EXISTS (
      SELECT 1 FROM public."DesignSession" ds
      WHERE ds.id = p_session_id
        AND public.can_edit_sessions(ds."projectId")
    )
  )
$$;

-- ─── 8. Recriar policies de DesignSession SELECT ─────────────────────────
-- A policy atual delega pra can_view_project() direto. Trocar pra
-- can_view_design_session() pra honrar visibility.
DROP POLICY IF EXISTS manager_or_viewer_select ON public."DesignSession";
CREATE POLICY manager_or_viewer_select ON public."DesignSession"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.can_view_design_session(id));

-- DesignSessionTranscript / Research seguem o mesmo padrão (SELECT via
-- can_view_project no projeto). Trocar pra checar a DS associada.
DROP POLICY IF EXISTS manager_or_viewer_select ON public."DesignSessionTranscript";
CREATE POLICY manager_or_viewer_select ON public."DesignSessionTranscript"
  AS PERMISSIVE FOR SELECT TO public
  USING (public.can_view_design_session("sessionId"));

DROP POLICY IF EXISTS manager_or_viewer_select ON public."DesignSessionResearch";
CREATE POLICY manager_or_viewer_select ON public."DesignSessionResearch"
  AS PERMISSIVE FOR SELECT TO public
  USING (public.can_view_design_session("sessionId"));

-- DesignSessionItem / Participant / StepData já usam can_access_session(),
-- que foi atualizado no passo 6 — refletem visibility automaticamente.

-- ─── 9. Travar INSERT/UPDATE/DELETE de DS pra guest ──────────────────────
-- can_edit_sessions() está aberta pra qualquer ProjectAccess (decisão de
-- 2026-05-19). Guest tem ProjectAccess.viewer — passaria o check. Bloquear
-- aqui via wrapper que checa is_guest() antes de delegar.
DROP POLICY IF EXISTS manager_or_editor_insert ON public."DesignSession";
CREATE POLICY manager_or_editor_insert ON public."DesignSession"
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_guest() AND (public.is_manager() OR public.can_edit_sessions("projectId")));

DROP POLICY IF EXISTS manager_or_editor_update ON public."DesignSession";
CREATE POLICY manager_or_editor_update ON public."DesignSession"
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (NOT public.is_guest() AND (public.is_manager() OR public.can_edit_sessions("projectId")));

DROP POLICY IF EXISTS manager_or_editor_delete ON public."DesignSession";
CREATE POLICY manager_or_editor_delete ON public."DesignSession"
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (NOT public.is_guest() AND (public.is_manager() OR public.can_edit_sessions("projectId")));

-- ─── 9.5. design_session_summary: expor visibility ──────────────────────
-- A view é usada pelas listagens de DS no projeto. Sem visibility, o app
-- (rota /api/projects/[id]) não consegue filtrar DS interna pra guest.
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
    (count(dsi.id))::integer AS item_count
   FROM ("DesignSession" ds
     LEFT JOIN "DesignSessionItem" dsi ON ((dsi."sessionId" = ds.id)))
  GROUP BY ds.id;

-- ─── 9.7. TaskComment policies aceitam ProjectAccess (não só ProjectMember) ──
-- Antes: read/insert exigia ProjectMember (time interno). Guests com Member-stub
-- mas sem ProjectMember não conseguiam ler/criar comments via RLS. Migram pra
-- can_view_project() (ProjectAccess), que cobre tanto time interno quanto guest.
DROP POLICY IF EXISTS "task_comment_read"   ON public."TaskComment";
DROP POLICY IF EXISTS "task_comment_insert" ON public."TaskComment";

CREATE POLICY "task_comment_read" ON public."TaskComment" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public."Task" t
    WHERE t.id = "TaskComment"."taskId"
      AND public.can_view_project(t."projectId")
  ));

CREATE POLICY "task_comment_insert" ON public."TaskComment" FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."Task" t
    WHERE t.id = "TaskComment"."taskId"
      AND public.can_view_project(t."projectId")
  ));

-- ─── 10. Backfill: DS existentes ficam 'internal' por default ────────────
-- A coluna já nasce 'internal' via DEFAULT, mas garantimos consistência
-- caso alguma DS exista sem o valor (paranoia).
UPDATE public."DesignSession"
SET "visibility" = 'internal'
WHERE "visibility" IS NULL OR "visibility" NOT IN ('public', 'internal');

COMMIT;
