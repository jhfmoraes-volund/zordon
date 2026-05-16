-- ============================================================================
-- FORGE v1 — Agent Factory observatory schema
--
-- Cria 4 tabelas (ForgeRun, ForgeAgent, ForgeTask, ForgeEvent) com escopo de
-- projeto, suporte a forge_task type=agentic|human, RLS via helpers existentes
-- (is_manager bypass, can_view_project pra leitura, can_edit_tasks pra mutação).
--
-- Convenção: tabelas PascalCase quoted, colunas camelCase quoted (mesmo
-- padrão de "Project", "UserStory", "Member").
--
-- Tudo em uma transação. Realtime ligado nas 4 tabelas pra Fase 11.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── ForgeRun ────────────────────────────────────────────────────────────────
CREATE TABLE "ForgeRun" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId"   uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  "ownerId"     uuid NOT NULL REFERENCES "Member"(id) ON DELETE CASCADE,
  title         text NOT NULL,
  status        text NOT NULL CHECK (status IN ('queued','running','done','error','aborted')),
  progress      int  NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  trigger       text NOT NULL CHECK (trigger IN ('story','task','ad_hoc')),
  "triggerRef"  uuid,
  "startedAt"   timestamptz,
  "endedAt"     timestamptz,
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt"   timestamptz NOT NULL DEFAULT now()
);

-- ─── ForgeAgent ──────────────────────────────────────────────────────────────
CREATE TABLE "ForgeAgent" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "runId"       uuid NOT NULL REFERENCES "ForgeRun"(id) ON DELETE CASCADE,
  "parentId"    uuid REFERENCES "ForgeAgent"(id) ON DELETE CASCADE,
  name          text NOT NULL,
  role          text NOT NULL,
  status        text NOT NULL CHECK (status IN ('idle','spawning','thinking','tool','streaming','done','error')),
  progress      int  NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  "tokensIn"    int  NOT NULL DEFAULT 0,
  "tokensOut"   int  NOT NULL DEFAULT 0,
  "costUsd"     numeric(10,4) NOT NULL DEFAULT 0,
  "startedAt"   timestamptz,
  "endedAt"     timestamptz,
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- ─── ForgeTask ───────────────────────────────────────────────────────────────
-- Unidade atômica de execução. type=agentic roda no agente; type=human marca
-- pra Builder/Designer/Ops fazer manualmente (deploy, validação, etc).
CREATE TABLE "ForgeTask" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId"     uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  "userStoryId"   uuid REFERENCES "UserStory"(id) ON DELETE SET NULL,
  "runId"         uuid REFERENCES "ForgeRun"(id) ON DELETE SET NULL,
  "agentId"       uuid REFERENCES "ForgeAgent"(id) ON DELETE SET NULL,
  ord             int  NOT NULL,
  title           text NOT NULL,
  type            text NOT NULL DEFAULT 'agentic' CHECK (type IN ('agentic','human')),
  "assigneeId"    uuid REFERENCES "Member"(id),
  "dueDate"       timestamptz,
  status          text NOT NULL CHECK (status IN (
                    'queued','idle','spawning','thinking','tool','streaming','done','error',
                    'todo','doing','blocked'
                  )),
  progress        int  NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  "currentTool"   text,
  "tokensIn"      int  NOT NULL DEFAULT 0,
  "tokensOut"     int  NOT NULL DEFAULT 0,
  "costUsd"       numeric(10,4) NOT NULL DEFAULT 0,
  "startedAt"     timestamptz,
  "endedAt"       timestamptz,
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE ("projectId", ord)
);

-- ─── ForgeEvent ──────────────────────────────────────────────────────────────
-- Stream append-only que pinta a UI. seq monotônico por run.
CREATE TABLE "ForgeEvent" (
  "runId"       uuid NOT NULL REFERENCES "ForgeRun"(id) ON DELETE CASCADE,
  seq           bigint NOT NULL,
  "agentId"     uuid REFERENCES "ForgeAgent"(id) ON DELETE CASCADE,
  "taskId"      uuid REFERENCES "ForgeTask"(id) ON DELETE CASCADE,
  ts            timestamptz NOT NULL DEFAULT clock_timestamp(),
  kind          text NOT NULL CHECK (kind IN (
                  'thought','tool_call','tool_result','token','status',
                  'spawn','task_spawn','metric','error','done'
                )),
  payload       jsonb NOT NULL,
  PRIMARY KEY ("runId", seq)
);

-- ─── índices ─────────────────────────────────────────────────────────────────
CREATE INDEX "ForgeRun_project_idx"   ON "ForgeRun"("projectId", "createdAt" DESC);
CREATE INDEX "ForgeAgent_run_idx"     ON "ForgeAgent"("runId");
CREATE INDEX "ForgeTask_project_idx"  ON "ForgeTask"("projectId", ord);
CREATE INDEX "ForgeTask_story_idx"    ON "ForgeTask"("userStoryId");
CREATE INDEX "ForgeEvent_agent_idx"   ON "ForgeEvent"("agentId", seq);
CREATE INDEX "ForgeEvent_task_idx"    ON "ForgeEvent"("taskId", seq);

-- ─── seq monotônico por run ──────────────────────────────────────────────────
-- Advisory lock por run serializa inserts concorrentes sem trancar a tabela.
-- Cliente chama antes de inserir em ForgeEvent. Lock libera no fim da tx.
CREATE OR REPLACE FUNCTION public.forge_next_seq(p_run uuid) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE s bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_run::text));
  SELECT coalesce(max(seq), 0) + 1 INTO s
  FROM "ForgeEvent" WHERE "runId" = p_run;
  RETURN s;
END$$;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Helpers existentes (criados em 20260501_text_to_uuid.sql):
--   is_manager()              — Manager+ bypass
--   can_view_project(uuid)    — ProjectAccess role >= viewer
--   can_edit_tasks(uuid)      — ProjectAccess role >= contributor
ALTER TABLE "ForgeRun"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ForgeAgent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ForgeTask"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ForgeEvent" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ForgeRun_select" ON "ForgeRun"
  FOR SELECT USING (public.is_manager() OR public.can_view_project("projectId"));
CREATE POLICY "ForgeRun_mutate" ON "ForgeRun"
  FOR ALL
  USING (public.is_manager() OR public.can_edit_tasks("projectId"))
  WITH CHECK (public.is_manager() OR public.can_edit_tasks("projectId"));

CREATE POLICY "ForgeTask_select" ON "ForgeTask"
  FOR SELECT USING (public.is_manager() OR public.can_view_project("projectId"));
CREATE POLICY "ForgeTask_mutate" ON "ForgeTask"
  FOR ALL
  USING (public.is_manager() OR public.can_edit_tasks("projectId"))
  WITH CHECK (public.is_manager() OR public.can_edit_tasks("projectId"));

CREATE POLICY "ForgeAgent_select" ON "ForgeAgent"
  FOR SELECT USING (
    public.is_manager() OR EXISTS (
      SELECT 1 FROM "ForgeRun" r
      WHERE r.id = "ForgeAgent"."runId"
        AND public.can_view_project(r."projectId")
    )
  );
CREATE POLICY "ForgeAgent_mutate" ON "ForgeAgent"
  FOR ALL
  USING (
    public.is_manager() OR EXISTS (
      SELECT 1 FROM "ForgeRun" r
      WHERE r.id = "ForgeAgent"."runId"
        AND public.can_edit_tasks(r."projectId")
    )
  )
  WITH CHECK (
    public.is_manager() OR EXISTS (
      SELECT 1 FROM "ForgeRun" r
      WHERE r.id = "ForgeAgent"."runId"
        AND public.can_edit_tasks(r."projectId")
    )
  );

CREATE POLICY "ForgeEvent_select" ON "ForgeEvent"
  FOR SELECT USING (
    public.is_manager() OR EXISTS (
      SELECT 1 FROM "ForgeRun" r
      WHERE r.id = "ForgeEvent"."runId"
        AND public.can_view_project(r."projectId")
    )
  );
CREATE POLICY "ForgeEvent_mutate" ON "ForgeEvent"
  FOR ALL
  USING (
    public.is_manager() OR EXISTS (
      SELECT 1 FROM "ForgeRun" r
      WHERE r.id = "ForgeEvent"."runId"
        AND public.can_edit_tasks(r."projectId")
    )
  )
  WITH CHECK (
    public.is_manager() OR EXISTS (
      SELECT 1 FROM "ForgeRun" r
      WHERE r.id = "ForgeEvent"."runId"
        AND public.can_edit_tasks(r."projectId")
    )
  );

-- ─── realtime ────────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE "ForgeRun";
ALTER PUBLICATION supabase_realtime ADD TABLE "ForgeAgent";
ALTER PUBLICATION supabase_realtime ADD TABLE "ForgeTask";
ALTER PUBLICATION supabase_realtime ADD TABLE "ForgeEvent";

COMMIT;
