-- F1.5 (Vitória intelligence plan v2) — telemetria + outcome de propostas.
--
-- 1. ALTER "AgentUsage": adiciona projectId / callKind / latencyMs + indexes.
--    Estes campos eram emergent — sem eles o painel não consegue agrupar
--    por projeto nem distinguir 'turn' de 'extract'/'enrich'/'estimate'.
-- 2. CREATE "AgentProposalOutcome": registra decisão do PM (accepted / edited /
--    deleted / expired) sobre cada MeetingTaskAction proposta pela IA. Base
--    pra métricas de qualidade (% aceite, FP error) + futuro fine-tune.
-- 3. RLS: manager+ vê tudo; demais (builder/guest) só do próprio projeto
--    quando há ProjectAccess.

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. AgentUsage: novos campos
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public."AgentUsage"
  ADD COLUMN IF NOT EXISTS "projectId" uuid REFERENCES public."Project"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "callKind"  text   NOT NULL DEFAULT 'turn',
  ADD COLUMN IF NOT EXISTS "latencyMs" integer;

-- callKind enumerável (sem enum type pra evitar churn de migration depois)
ALTER TABLE public."AgentUsage"
  DROP CONSTRAINT IF EXISTS "AgentUsage_callKind_check";
ALTER TABLE public."AgentUsage"
  ADD CONSTRAINT "AgentUsage_callKind_check"
    CHECK ("callKind" IN ('turn', 'extract', 'enrich', 'estimate', 'other'));

CREATE INDEX IF NOT EXISTS "AgentUsage_projectId_createdAt_idx"
  ON public."AgentUsage" ("projectId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "AgentUsage_agentName_createdAt_idx"
  ON public."AgentUsage" ("agentName", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "AgentUsage_threadId_idx"
  ON public."AgentUsage" ("threadId");

-- ───────────────────────────────────────────────────────────────────────────
-- 2. AgentProposalOutcome
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public."AgentProposalOutcome" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "proposalId" uuid NOT NULL REFERENCES public."MeetingTaskAction"(id) ON DELETE CASCADE,
  "agentName"  text NOT NULL,                -- 'vitoria' | 'alpha' | ...
  "callKind"   text NOT NULL DEFAULT 'turn', -- mesma taxonomia de AgentUsage
  decision     text NOT NULL,                -- 'accepted' | 'edited' | 'deleted' | 'expired'
  "editsJson"  jsonb,                        -- diff antes/depois quando decision='edited'
  "fpEstimated" integer,                     -- FP que a IA estimou
  "fpReal"     integer,                      -- FP final (quando task vira done)
  "decidedAt"  timestamptz NOT NULL DEFAULT now(),
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "AgentProposalOutcome_decision_check"
    CHECK (decision IN ('accepted', 'edited', 'deleted', 'expired')),
  CONSTRAINT "AgentProposalOutcome_callKind_check"
    CHECK ("callKind" IN ('turn', 'extract', 'enrich', 'estimate', 'other'))
);

CREATE INDEX IF NOT EXISTS "AgentProposalOutcome_proposalId_idx"
  ON public."AgentProposalOutcome" ("proposalId");

CREATE INDEX IF NOT EXISTS "AgentProposalOutcome_agentName_decidedAt_idx"
  ON public."AgentProposalOutcome" ("agentName", "decidedAt" DESC);

-- ───────────────────────────────────────────────────────────────────────────
-- 3. RLS
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public."AgentUsage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AgentProposalOutcome" ENABLE ROW LEVEL SECURITY;

-- AgentUsage: manager+ lê tudo. Member (não-manager) lê só do projeto que
-- tem acesso. Write é só service_role (recordAgentUsage roda no servidor).
DROP POLICY IF EXISTS "AgentUsage_select_manager_or_project_access" ON public."AgentUsage";
CREATE POLICY "AgentUsage_select_manager_or_project_access"
  ON public."AgentUsage" FOR SELECT
  USING (
    public.is_manager()
    OR (
      "projectId" IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public."ProjectAccess" pa
        WHERE pa."projectId" = "AgentUsage"."projectId"
          AND pa."userId" = auth.uid()
      )
    )
  );

-- AgentProposalOutcome: mesma lógica via join em MeetingTaskAction → projectId.
DROP POLICY IF EXISTS "AgentProposalOutcome_select_manager_or_project_access" ON public."AgentProposalOutcome";
CREATE POLICY "AgentProposalOutcome_select_manager_or_project_access"
  ON public."AgentProposalOutcome" FOR SELECT
  USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."MeetingTaskAction" mta
      JOIN public."ProjectAccess" pa
        ON pa."projectId" = mta."projectId"
       AND pa."userId" = auth.uid()
      WHERE mta.id = "AgentProposalOutcome"."proposalId"
    )
  );

COMMIT;
