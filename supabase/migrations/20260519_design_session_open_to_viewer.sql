-- ═══════════════════════════════════════════════════════════
-- Design Session: abre interação para todo ProjectAccess (viewer+).
--
-- Antes: só session_participant/contributor/lead interagia em sessions.
-- Viewer ficava read-only — não criava, não chatava, não adicionava notas.
-- Decisão (2026-05-19): design session é colaborativa; qualquer pessoa com
-- acesso ao projeto deve poder interagir. Mantém-se a separação por projeto
-- (ProjectAccess) — só o nível "interage vs. não interage" foi removido.
--
-- Efeito: can_edit_sessions(projectId) passa a aceitar QUALQUER linha de
-- ProjectAccess, exatamente como can_view_project. Por consequência,
-- can_edit_session(sessionId) e todas as policies/RPCs que dependem dele
-- também ficam abertas a viewer+.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.can_edit_sessions(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."ProjectAccess"
    WHERE "userId" = auth.uid()
      AND "projectId" = p_project_id
  )
$$;
