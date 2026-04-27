-- ============================================================
-- Rename MeetingActionItem → Todo
--
-- Promove ações de reunião a um cidadão de primeira classe:
-- "Todo" — uma obrigação de uma pessoa, opcionalmente com origem
-- em reunião. Suporta criação manual no profile e via Alpha agent.
--
-- Mudanças:
--  1. Rename da tabela e suas constraints (PK + 3 FKs)
--  2. meetingId vira nullable
--  3. status ganha CHECK ('todo','doing','done') — matches house style
--  4. Adiciona createdById (audit + base pra regra de hierarquia na API)
--  5. Adiciona source ('meeting'|'manual'|'agent') discriminador
--  6. CHECK de consistência: source='meeting' ⟺ meetingId presente
--  7. Indexes pros 2 padrões de leitura (perfil x reunião)
--  8. RLS reescrita — assignee vê suas; managers veem tudo
--     (corrige bug atual onde Builder não enxergava nem suas ações)
--
-- Hierarquia de criação (Builder→self, PM→Builder, CEO→todos)
-- é enforced na camada de API, NÃO em RLS — coerente com o resto
-- do projeto que usa service_role + requireMinLevelApi.
-- ============================================================

BEGIN;

-- ── 1. Rename table + constraints ──────────────────────────
ALTER TABLE public."MeetingActionItem" RENAME TO "Todo";

ALTER TABLE public."Todo"
  RENAME CONSTRAINT "MeetingActionItem_pkey" TO "Todo_pkey";
ALTER TABLE public."Todo"
  RENAME CONSTRAINT "MeetingActionItem_assigneeId_fkey" TO "Todo_assigneeId_fkey";
ALTER TABLE public."Todo"
  RENAME CONSTRAINT "MeetingActionItem_meetingId_fkey" TO "Todo_meetingId_fkey";
ALTER TABLE public."Todo"
  RENAME CONSTRAINT "MeetingActionItem_sourceReviewId_fkey" TO "Todo_sourceReviewId_fkey";

-- ── 2. meetingId opcional ──────────────────────────────────
ALTER TABLE public."Todo" ALTER COLUMN "meetingId" DROP NOT NULL;

-- ── 3. Status com CHECK ───────────────────────────────────
ALTER TABLE public."Todo"
  ADD CONSTRAINT "Todo_status_check"
  CHECK (status IN ('todo', 'doing', 'done'));

-- ── 4. createdById ─────────────────────────────────────────
ALTER TABLE public."Todo"
  ADD COLUMN "createdById" text
  REFERENCES public."Member"(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- Backfill defensivo (prod tem 0 linhas; cobre dev/staging com dados):
-- assume que o assignee criou pra si quando histórico não temos
UPDATE public."Todo" SET "createdById" = "assigneeId" WHERE "createdById" IS NULL;
ALTER TABLE public."Todo" ALTER COLUMN "createdById" SET NOT NULL;

-- ── 5. source discriminador ────────────────────────────────
ALTER TABLE public."Todo"
  ADD COLUMN source text NOT NULL DEFAULT 'meeting';
ALTER TABLE public."Todo"
  ADD CONSTRAINT "Todo_source_check"
  CHECK (source IN ('meeting', 'manual', 'agent'));

-- ── 6. Consistência source ↔ meetingId / sourceReviewId ────
-- - meeting: meetingId obrigatório, sourceReviewId pode ou não estar setado
-- - manual / agent: sem meetingId nem review
ALTER TABLE public."Todo"
  ADD CONSTRAINT "Todo_source_meeting_consistency"
  CHECK (
    (source = 'meeting' AND "meetingId" IS NOT NULL)
    OR (source <> 'meeting' AND "meetingId" IS NULL AND "sourceReviewId" IS NULL)
  );

-- ── 7. Indexes ─────────────────────────────────────────────
-- Padrão 1: profile widget — "todas as todos do membro X, agrupadas por status"
CREATE INDEX "Todo_assignee_status_idx"
  ON public."Todo" ("assigneeId", status, "dueDate" NULLS LAST);

-- Padrão 2: reunião — "todos atrelados à reunião X" (parcial: só os que têm)
CREATE INDEX "Todo_meeting_idx"
  ON public."Todo" ("meetingId") WHERE "meetingId" IS NOT NULL;

-- ── 8. RLS — substitui as 4 policies antigas ───────────────
DROP POLICY IF EXISTS "manager_select" ON public."Todo";
DROP POLICY IF EXISTS "manager_insert" ON public."Todo";
DROP POLICY IF EXISTS "manager_update" ON public."Todo";
DROP POLICY IF EXISTS "manager_delete" ON public."Todo";

-- SELECT: assignee sempre vê suas; managers veem tudo (mantém visibilidade
-- atual em reuniões + dá acesso a Builder pras suas no profile)
CREATE POLICY "Todo_select" ON public."Todo" FOR SELECT TO authenticated
  USING (
    "assigneeId" = public.get_my_member_id()
    OR public.is_manager()
  );

-- INSERT: criador é o usuário corrente; assignee é self OU criador é manager.
-- Hierarquia fina (PM→Builder, CEO→PM/Builder) enforced na API.
CREATE POLICY "Todo_insert" ON public."Todo" FOR INSERT TO authenticated
  WITH CHECK (
    "createdById" = public.get_my_member_id()
    AND (
      "assigneeId" = public.get_my_member_id()
      OR public.is_manager()
    )
  );

-- UPDATE: assignee (status), criador (edição), ou manager (full)
CREATE POLICY "Todo_update" ON public."Todo" FOR UPDATE TO authenticated
  USING (
    "assigneeId" = public.get_my_member_id()
    OR "createdById" = public.get_my_member_id()
    OR public.is_manager()
  );

-- DELETE: criador ou manager
CREATE POLICY "Todo_delete" ON public."Todo" FOR DELETE TO authenticated
  USING (
    "createdById" = public.get_my_member_id()
    OR public.is_manager()
  );

COMMIT;
