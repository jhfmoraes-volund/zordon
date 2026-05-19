-- ═══════════════════════════════════════════════════════════
-- Meeting type 'private' — reunião pessoal do owner, com
-- transcript do Granola e (opcional) projetos vinculados.
--
-- Diferenças vs outros types:
--   - Visibilidade: SÓ o creator. Admin NÃO vê (não tem
--     admin override no ramo 'private' do can_view_meeting).
--   - Projetos: opcional (0..N). Sem squad auto. Sem PMs.
--   - Attendees: apenas o owner.
--   - Alpha: lê transcript, escreve `notes`, cria To-dos do
--     owner, e (se houver projetos) propõe Tasks via
--     MeetingTaskAction nos projetos vinculados.
--
-- Também adiciona Meeting.transcript: o transcript bruto do
-- Granola fica num campo separado de `notes` (que vira o
-- espaço editável de conclusões do owner / resumo do Alpha).
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Meeting.type — aceita 'private' ────────────────────
ALTER TABLE public."Meeting"
  DROP CONSTRAINT IF EXISTS "Meeting_type_check";

ALTER TABLE public."Meeting"
  ADD CONSTRAINT "Meeting_type_check"
  CHECK ("type" IN ('pm_review', 'general', 'daily', 'super_planning', 'private'));

-- ── 2. Meeting.transcript — transcript bruto do provider ──
ALTER TABLE public."Meeting"
  ADD COLUMN IF NOT EXISTS "transcript" text;

-- ── 3. can_view_meeting: ramo 'private' = só o creator ────
-- Recria a função inteira. Admin override continua nos outros
-- types, MAS NÃO em 'private' — esse é o ponto.
CREATE OR REPLACE FUNCTION public.can_view_meeting(p_meeting_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    -- 'private' tem regra própria: só quem criou, sem admin bypass.
    EXISTS (
      SELECT 1
      FROM public."Meeting" m
      WHERE m.id = p_meeting_id
        AND m.type = 'private'
        AND m."createdById" = public.get_my_member_id()
        AND public.get_my_member_id() IS NOT NULL
    )
    OR (
      -- Demais types mantêm comportamento anterior (admin OR rules).
      public.is_admin()
      AND EXISTS (
        SELECT 1 FROM public."Meeting" m
        WHERE m.id = p_meeting_id AND m.type <> 'private'
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public."Meeting" m
      JOIN public."MeetingAttendee" a ON a."meetingId" = m.id
      WHERE m.id = p_meeting_id
        AND m.type IN ('pm_review','general')
        AND a."memberId" = public.get_my_member_id()
    )
    OR EXISTS (
      SELECT 1
      FROM public."Meeting" m
      JOIN public."MeetingProjectLink" mpl ON mpl."meetingId" = m.id
      JOIN public."Project" p ON p.id = mpl."projectId"
      WHERE m.id = p_meeting_id
        AND m.type IN ('daily','super_planning')
        AND p."pmId" = public.get_my_member_id()
    )
$$;

COMMIT;
