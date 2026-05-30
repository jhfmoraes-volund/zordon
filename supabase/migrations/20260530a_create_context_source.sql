-- Migration A: criar tabela ContextSource + enum + RLS
-- Story: CTXSRC-001

-- 1. Enum de tipos
CREATE TYPE public.context_source_kind AS ENUM (
  'transcript',
  'meeting',
  'spreadsheet_csv',
  'spreadsheet_gsheets',
  'github_repo',
  'github_pr',
  'github_issue'
);

-- 2. Tabela principal
CREATE TABLE public."ContextSource" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         public.context_source_kind NOT NULL,
  "projectId"  uuid REFERENCES public."Project"(id) ON DELETE CASCADE,
  title        text NOT NULL,
  "externalId" text,
  "externalUrl" text,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary      text,
  "fullText"   text,
  "capturedAt" timestamptz,
  "createdBy"  uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  "updatedAt"  timestamptz NOT NULL DEFAULT now()
);

-- 3. Índices
CREATE INDEX "ContextSource_project_kind_idx"
  ON public."ContextSource" ("projectId", kind);
CREATE INDEX "ContextSource_kind_externalId_idx"
  ON public."ContextSource" (kind, "externalId");

-- 4. RLS
ALTER TABLE public."ContextSource" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ContextSource_select" ON public."ContextSource"
  FOR SELECT TO authenticated
  USING ("projectId" IS NULL OR public.can_view_project("projectId"));

CREATE POLICY "ContextSource_insert" ON public."ContextSource"
  FOR INSERT TO authenticated
  WITH CHECK ("projectId" IS NULL OR public.can_edit_project("projectId"));

CREATE POLICY "ContextSource_update" ON public."ContextSource"
  FOR UPDATE TO authenticated
  USING ("projectId" IS NULL OR public.can_edit_project("projectId"))
  WITH CHECK ("projectId" IS NULL OR public.can_edit_project("projectId"));

CREATE POLICY "ContextSource_delete" ON public."ContextSource"
  FOR DELETE TO authenticated
  USING ("projectId" IS NULL OR public.can_edit_project("projectId"));
