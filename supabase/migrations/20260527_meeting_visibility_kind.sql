-- Meeting: separar EVENTO (reunião) de seu eixo de ACESSO.
--
-- Modelo novo:
--   • visibility (private|public) GOVERNA quem vê.
--       - private → só o creator (sem admin bypass).
--       - public  → quem participou (attendee).
--   • kind (rótulo leve) organiza/filtra, NÃO governa acesso.
--
-- Esta migration é ADITIVA e idempotente: adiciona as colunas, deriva os
-- valores dos `type` atuais, e reescreve can_view_meeting pra governar por
-- visibility. NÃO dropa a coluna `type` nem o check antigo — isso fica pra
-- fase de limpeza (quando daily/planning/pm_review já tiverem virado Cerimônia).
--
-- Derivação type → (visibility, kind):
--   private        → (private, general)
--   general        → (public,  general)
--   pm_review      → (public,  pm_review)
--   daily          → (public,  daily)
--   super_planning → (public,  planning)

BEGIN;

-- ── 1. Colunas novas ────────────────────────────────────────────────────────
ALTER TABLE public."Meeting"
  ADD COLUMN IF NOT EXISTS "visibility" text NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'general';

-- ── 2. Backfill a partir do type atual ──────────────────────────────────────
-- Idempotente: só recalcula com base no type (fonte de verdade legada).
UPDATE public."Meeting"
SET
  "visibility" = CASE WHEN "type" = 'private' THEN 'private' ELSE 'public' END,
  "kind" = CASE "type"
    WHEN 'super_planning' THEN 'planning'
    WHEN 'private'        THEN 'general'
    WHEN 'general'        THEN 'general'
    ELSE "type"  -- pm_review, daily mantêm o rótulo
  END;

-- ── 3. CHECK constraints (drop+recreate pra idempotência) ───────────────────
ALTER TABLE public."Meeting" DROP CONSTRAINT IF EXISTS "Meeting_visibility_check";
ALTER TABLE public."Meeting"
  ADD CONSTRAINT "Meeting_visibility_check"
  CHECK ("visibility" = ANY (ARRAY['private'::text, 'public'::text]));

ALTER TABLE public."Meeting" DROP CONSTRAINT IF EXISTS "Meeting_kind_check";
ALTER TABLE public."Meeting"
  ADD CONSTRAINT "Meeting_kind_check"
  CHECK ("kind" = ANY (ARRAY[
    'general'::text, 'one_on_one'::text, 'external'::text, 'sync'::text,
    -- rótulos legados preservados até a migração pra Cerimônias:
    'pm_review'::text, 'daily'::text, 'planning'::text
  ]));

-- ── 4. Reescrever can_view_meeting pra governar por VISIBILITY ───────────────
-- Antes: branchava em type (private/pm_review/general vs daily/super_planning).
-- Agora: visibility decide. private = creator-only (sem admin bypass);
-- public = admin OU attendee. Mantém o caminho project-link (PM do projeto
-- linkado vê) porque cerimônias ainda moram como Meeting até a fase 2.
CREATE OR REPLACE FUNCTION public.can_view_meeting(p_meeting_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    -- private: só quem criou, sem admin bypass.
    EXISTS (
      SELECT 1
      FROM public."Meeting" m
      WHERE m.id = p_meeting_id
        AND m."visibility" = 'private'
        AND m."createdById" = public.get_my_member_id()
        AND public.get_my_member_id() IS NOT NULL
    )
    OR (
      -- public: admin vê tudo.
      public.is_admin()
      AND EXISTS (
        SELECT 1 FROM public."Meeting" m
        WHERE m.id = p_meeting_id AND m."visibility" = 'public'
      )
    )
    OR EXISTS (
      -- public: quem participou (attendee).
      SELECT 1
      FROM public."Meeting" m
      JOIN public."MeetingAttendee" a ON a."meetingId" = m.id
      WHERE m.id = p_meeting_id
        AND m."visibility" = 'public'
        AND a."memberId" = public.get_my_member_id()
    )
    OR EXISTS (
      -- public + linkada a projeto: PM do projeto vê (cerimônias legadas).
      SELECT 1
      FROM public."Meeting" m
      JOIN public."MeetingProjectLink" mpl ON mpl."meetingId" = m.id
      JOIN public."Project" p ON p.id = mpl."projectId"
      WHERE m.id = p_meeting_id
        AND m."visibility" = 'public'
        AND p."pmId" = public.get_my_member_id()
    )
$$;

COMMIT;
