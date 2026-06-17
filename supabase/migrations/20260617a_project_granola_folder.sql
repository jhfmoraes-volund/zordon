-- Vínculo durável folder-do-Granola → projeto (runbook pm-review-granola-folder, Fase 1.1).
-- Binding por folderId (não por nome). memberId = de quem é o token que enxerga a
-- folder (o auto-import roda per-member). Uma folder roteia pra no máx 1 projeto;
-- um projeto pode ter N folders (N linhas com folderId distinto).

CREATE TABLE IF NOT EXISTS public."ProjectGranolaFolder" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId"  uuid NOT NULL REFERENCES public."Project"(id) ON DELETE CASCADE,
  "folderId"   text NOT NULL,
  "folderName" text,                       -- display only, snapshot no bind
  -- memberId = de quem é o token que DIRIGE o roteamento, não dono do binding
  -- (o binding é do projeto). Por isso SET NULL: deletar/offboard um PM deixa o
  -- binding órfão (re-vinculável na UI), em vez de sumir e matar o roteamento
  -- em silêncio. Binding com memberId NULL fica inativo até reconectar.
  "memberId"   uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  "updatedAt"  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ProjectGranolaFolder_folder_key" UNIQUE ("folderId")
);

CREATE INDEX IF NOT EXISTS "ProjectGranolaFolder_member_idx"
  ON public."ProjectGranolaFolder" ("memberId");
CREATE INDEX IF NOT EXISTS "ProjectGranolaFolder_project_idx"
  ON public."ProjectGranolaFolder" ("projectId");

GRANT SELECT, INSERT, UPDATE, DELETE ON public."ProjectGranolaFolder" TO authenticated;
ALTER TABLE public."ProjectGranolaFolder" ENABLE ROW LEVEL SECURITY;

-- Lê: quem vê o projeto. Escreve: PM (mesma autoridade do PM Review) ou admin.
CREATE POLICY "pgf_select" ON public."ProjectGranolaFolder"
  FOR SELECT USING (public.is_manager() OR public.can_view_project("projectId"));
CREATE POLICY "pgf_insert" ON public."ProjectGranolaFolder"
  FOR INSERT WITH CHECK (public.is_manager() OR public.can_create_pm_review("projectId"));
CREATE POLICY "pgf_update" ON public."ProjectGranolaFolder"
  FOR UPDATE USING (public.is_manager() OR public.can_create_pm_review("projectId"))
  WITH CHECK (public.is_manager() OR public.can_create_pm_review("projectId"));
CREATE POLICY "pgf_delete" ON public."ProjectGranolaFolder"
  FOR DELETE USING (public.is_manager() OR public.can_create_pm_review("projectId"));
