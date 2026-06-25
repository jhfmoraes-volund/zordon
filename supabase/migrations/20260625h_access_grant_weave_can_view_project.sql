-- ═══════════════════════════════════════════════════════════
-- Folda os grants em can_view_project — a ÚNICA mudança de RLS necessária
-- pro caso de uso v1 (visibilidade do projeto via grant).
--
-- Por quê só can_view_project:
--   - A página do projeto é client-only; a visibilidade é 100% RLS via o
--     SELECT de Project (policy manager_or_viewer_select → can_view_project).
--     Estender este helper faz o projeto Y aparecer pro membro concedido —
--     e cascateia pra todas as reads (Sprint/Task/DesignSession/PlanningSession).
--   - As rotas de Planning usam db() (service-role, bypassa RLS) guardadas por
--     helpers TS. A participação no ritual (ler + chat) é gated por
--     requireProjectViewApi → canViewProject (TS, weave na Fase 2). Logo o
--     grant view-level já destrava o ritual SEM tocar can_edit_tasks/
--     can_edit_project — que são COMPARTILHADOS (tasks, ProjectResource,
--     EntityLink, DesignSession) e vazariam escrita além do Planning.
--
-- Mutações pesadas do Planning (complete/approve/edit PRD/delete) seguem
-- contributor/lead/manager-only — fora do escopo do grant v1.
--
-- Corpo base copiado de 20260501_text_to_uuid.sql:594 + OR has_any_project_grant.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.can_view_project(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."ProjectAccess"
    WHERE "userId" = auth.uid() AND "projectId" = p_project_id
  ) OR public.has_any_project_grant(p_project_id)
$$;
