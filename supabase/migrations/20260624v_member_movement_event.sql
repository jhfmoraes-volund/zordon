-- MAH-007: Tabela MemberMovementEvent (append-only)
--
-- Log imutável de toda movimentação de membro/alocação/PM/roster.
-- Append-only: autenticados podem SELECT, mas INSERT/UPDATE/DELETE só via service_role.

CREATE TABLE "MemberMovementEvent" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "memberId"      uuid REFERENCES "Member"(id) ON DELETE SET NULL,
  "projectId"     uuid REFERENCES "Project"(id) ON DELETE CASCADE,
  "contractId"    uuid REFERENCES finance.contract(id) ON DELETE SET NULL,
  "allocationId"  uuid,                       -- ref histórica; alocação pode ter sido purgada
  kind            text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { before, after, reason, ... }
  "actorMemberId" uuid REFERENCES "Member"(id) ON DELETE SET NULL,
  "createdAt"     timestamptz NOT NULL DEFAULT now()
);

-- Índices por dimensão de consulta
CREATE INDEX "MemberMovementEvent_member_idx"   ON "MemberMovementEvent"("memberId", "createdAt" DESC);
CREATE INDEX "MemberMovementEvent_contract_idx" ON "MemberMovementEvent"("contractId", "createdAt" DESC);
CREATE INDEX "MemberMovementEvent_project_idx"  ON "MemberMovementEvent"("projectId", "createdAt" DESC);
CREATE INDEX "MemberMovementEvent_kind_idx"     ON "MemberMovementEvent"(kind, "createdAt" DESC);

-- RLS: leitura manager+ ou membro do projeto; escrita service_role (append-only)
ALTER TABLE "MemberMovementEvent" ENABLE ROW LEVEL SECURITY;

CREATE POLICY mme_read ON "MemberMovementEvent" FOR SELECT
  USING (is_manager() OR can_view_project("projectId"));

-- Append-only: REVOKE write de authenticated; só service_role escreve
REVOKE INSERT, UPDATE, DELETE ON "MemberMovementEvent" FROM authenticated;
GRANT SELECT ON "MemberMovementEvent" TO authenticated;
