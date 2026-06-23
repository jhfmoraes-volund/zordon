-- F2.7 Backfill de órfãos do roster — roda ANTES do cutover (F2.8).
-- Sem isso, ao apontar os 3 readers pra finance.v_project_team, quem está hoje no
-- roster só via Project.pmId ou ProjectMember (sem labor_allocation vigente E sem
-- ProjectAccess) sumiria do roster. Invariante: "gente não some do roster".
--
-- Escopo = PM ∪ ProjectMember (NÃO só ProjectMember): o PM raramente tem linha em
-- ProjectMember, então a versão literal do runbook (só ProjectMember) deixaria os
-- PMs órfãos caírem. Análise pré-migração: 4 PMs órfãos (todos com userId),
-- 0 ProjectMember órfãos (os 20 sem alocação já têm ProjectAccess).
--
-- role: PM→'lead', ProjectMember→'viewer'. ACESSO ≠ ALOCAÇÃO (D8): NÃO cria
-- labor_allocation — custo não muda (invariante "custo standing não muda").
-- Idempotente: ON CONFLICT (userId,projectId) DO NOTHING. Pula quem não tem
-- Member.userId (não dá pra criar ProjectAccess; conferir count no log abaixo).
--
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260624n_backfill_roster.sql

INSERT INTO "ProjectAccess" ("userId", "projectId", role)
SELECT DISTINCT ON (m."userId", cand.project_id)
  m."userId", cand.project_id, cand.role
FROM (
  SELECT p.id AS project_id, p."pmId" AS member_id, 'lead'::text AS role, 1 AS prio
    FROM "Project" p WHERE p."pmId" IS NOT NULL
  UNION ALL
  SELECT pm."projectId", pm."memberId", 'viewer'::text AS role, 2 AS prio
    FROM "ProjectMember" pm
) cand
  JOIN "Member" m ON m.id = cand.member_id
WHERE m."userId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM finance.labor_allocation la
    WHERE la.project_id = cand.project_id AND la.member_id = cand.member_id
      AND (la.effective_to IS NULL OR la.effective_to >= current_date)
  )
  AND NOT EXISTS (
    SELECT 1 FROM "ProjectAccess" pa
    WHERE pa."projectId" = cand.project_id AND pa."userId" = m."userId"
  )
ORDER BY m."userId", cand.project_id, cand.prio   -- 'lead' (1) ganha de 'viewer' (2)
ON CONFLICT ("userId", "projectId") DO NOTHING;
