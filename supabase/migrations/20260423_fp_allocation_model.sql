-- Modelo de alocação de Function Points em 3 camadas:
--   (1) Member.fpCapacity                — bateria total por sprint
--   (2) ProjectMember.fpAllocation       — quanto dessa bateria vai pro projeto
--   (3) SprintMember.fpAllocation        — override opcional por sprint específico
--
-- Overcommit é permitido (só alerta, não bloqueia) — PM é adulto.

-- ─── 1. ProjectMember ganha fpAllocation (teto padrão por sprint) ───────────
ALTER TABLE public."ProjectMember"
  ADD COLUMN "fpAllocation" INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public."ProjectMember"."fpAllocation" IS
  'Teto de FP por sprint que este membro dedica a este projeto. Default 0 — PM deve configurar.';

-- ─── 2. SprintMember: override opcional por sprint ──────────────────────────
-- Quando presente, sobrescreve o ProjectMember.fpAllocation pra esse sprint.
CREATE TABLE public."SprintMember" (
  "sprintId"     TEXT NOT NULL REFERENCES public."Sprint"(id) ON DELETE CASCADE,
  "memberId"     TEXT NOT NULL REFERENCES public."Member"(id) ON DELETE CASCADE,
  "fpAllocation" INTEGER NOT NULL,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("sprintId", "memberId")
);

CREATE INDEX idx_sprint_member_member ON public."SprintMember"("memberId");

COMMENT ON TABLE public."SprintMember" IS
  'Override de fpAllocation por sprint. Quando ausente, usa ProjectMember.fpAllocation.';

GRANT ALL ON public."SprintMember" TO service_role, authenticated;

-- ─── 3. View: visão da bateria do membro ────────────────────────────────────
-- capacity = total. committed = soma dos ProjectMember.fpAllocation.
-- remaining = capacity - committed (pode ser negativo = overcommit).
CREATE OR REPLACE VIEW public.member_commitment_overview AS
SELECT
  m.id,
  m.name,
  m.role,
  m."fpCapacity"                                     AS capacity,
  COALESCE(SUM(pm."fpAllocation"), 0)::INTEGER       AS committed,
  (m."fpCapacity" - COALESCE(SUM(pm."fpAllocation"), 0))::INTEGER AS remaining,
  COUNT(DISTINCT pm."projectId")::INTEGER            AS project_count
FROM public."Member" m
LEFT JOIN public."ProjectMember" pm ON pm."memberId" = m.id
GROUP BY m.id, m.name, m.role, m."fpCapacity";

GRANT SELECT ON public.member_commitment_overview TO service_role, authenticated;

-- ─── 4. View: capacidade real por sprint ────────────────────────────────────
-- Respeita overrides de SprintMember quando presentes.
-- allocated = soma de FP das tasks ativas do sprint.
CREATE OR REPLACE VIEW public.sprint_capacity_overview AS
WITH member_sprint_alloc AS (
  SELECT
    s.id AS sprint_id,
    SUM(COALESCE(sm."fpAllocation", pm."fpAllocation"))::INTEGER AS capacity
  FROM public."Sprint" s
  JOIN public."ProjectMember" pm ON pm."projectId" = s."projectId"
  LEFT JOIN public."SprintMember" sm
    ON sm."sprintId" = s.id AND sm."memberId" = pm."memberId"
  GROUP BY s.id
),
sprint_alloc AS (
  SELECT
    t."sprintId" AS sprint_id,
    COALESCE(SUM(t."functionPoints"), 0)::INTEGER AS allocated
  FROM public."Task" t
  WHERE t."sprintId" IS NOT NULL
    AND t.status = ANY (ARRAY['todo','in_progress','review','changes_requested'])
  GROUP BY t."sprintId"
)
SELECT
  msa.sprint_id AS "sprintId",
  msa.capacity,
  COALESCE(sa.allocated, 0)                   AS allocated,
  (msa.capacity - COALESCE(sa.allocated, 0))  AS remaining
FROM member_sprint_alloc msa
LEFT JOIN sprint_alloc sa ON sa.sprint_id = msa.sprint_id;

GRANT SELECT ON public.sprint_capacity_overview TO service_role, authenticated;

-- ─── 5. View: alocação efetiva por (member, sprint) ─────────────────────────
-- Útil pro Zordon saber, dado um sprint, quanto cada membro pode assumir lá.
-- Respeita override; se não houver SprintMember, usa ProjectMember.
CREATE OR REPLACE VIEW public.sprint_member_capacity AS
SELECT
  s.id                                                AS "sprintId",
  pm."memberId",
  m.name                                              AS member_name,
  s."projectId",
  COALESCE(sm."fpAllocation", pm."fpAllocation")::INTEGER AS fp_allocation,
  COALESCE((
    SELECT SUM(t."functionPoints")
    FROM public."Task" t
    JOIN public."TaskAssignment" ta ON ta."taskId" = t.id
    WHERE t."sprintId" = s.id
      AND ta."memberId" = pm."memberId"
      AND t.status = ANY (ARRAY['todo','in_progress','review','changes_requested'])
  ), 0)::INTEGER                                      AS fp_used,
  (sm."fpAllocation" IS NOT NULL)                     AS has_sprint_override
FROM public."Sprint" s
JOIN public."ProjectMember" pm ON pm."projectId" = s."projectId"
JOIN public."Member" m ON m.id = pm."memberId"
LEFT JOIN public."SprintMember" sm
  ON sm."sprintId" = s.id AND sm."memberId" = pm."memberId";

GRANT SELECT ON public.sprint_member_capacity TO service_role, authenticated;

-- ─── 6. Atualiza AgentConfig do Zordon ──────────────────────────────────────
-- Remove ideal_fp_per_sprint (agora derivado da soma de alocações).
DELETE FROM public."AgentConfig"
  WHERE "agentId" = 'agent-zordon' AND key = 'ideal_fp_per_sprint';

-- Remove min_fp_per_member (substituído por percentual).
DELETE FROM public."AgentConfig"
  WHERE "agentId" = 'agent-zordon' AND key = 'min_fp_per_member';

-- Adiciona min_utilization_percent (0.0 a 1.0).
INSERT INTO public."AgentConfig" ("agentId", key, value, description) VALUES
  ('agent-zordon', 'min_utilization_percent', '0.5'::jsonb,
    'Percentual mínimo de utilização da alocação do membro. Abaixo disso, Zordon sinaliza subutilização.')
ON CONFLICT ("agentId", key) DO UPDATE
  SET value = EXCLUDED.value, description = EXCLUDED.description;

-- Sprints agora são semanais (era 15).
UPDATE public."AgentConfig"
  SET value = '7'::jsonb,
      description = 'Duração padrão do sprint em dias (semanal).',
      "updatedAt" = now()
  WHERE "agentId" = 'agent-zordon' AND key = 'sprint_length_days';
