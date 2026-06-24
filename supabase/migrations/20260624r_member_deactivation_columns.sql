-- ═══════════════════════════════════════════════════════════════════════════
-- Soft-delete de membro (desativar ≠ excluir).
--
-- Pessoa que foi demitida ou saiu da empresa deve ser DESATIVADA, não excluída:
-- a row do Member permanece (lápide read-only), preservando 100% do histórico de
-- participação (autoria de tasks/comentários/design sessions, alocações passadas,
-- reviews). O hard delete (DELETE /api/members/[id]) continua existindo, mas só
-- pra cadastro criado por engano, sem histórico.
--
-- deactivatedAt IS NULL  ⇒ membro ativo (esse timestamp É o flag).
-- deactivatedReason      ⇒ motivo estruturado (demitido / saiu / outro).
-- deactivatedById        ⇒ quem desativou (auditoria; SET NULL se esse admin sair).
--
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260624r_member_deactivation_columns.sql
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "Member"
  ADD COLUMN "deactivatedAt"     timestamptz,
  ADD COLUMN "deactivatedReason" text CHECK ("deactivatedReason" IN ('terminated', 'left', 'other')),
  ADD COLUMN "deactivatedById"   uuid REFERENCES "Member"(id) ON DELETE SET NULL;

-- Índice parcial: a maioria das queries filtra "membros ativos" (deactivatedAt IS NULL).
CREATE INDEX "Member_active_idx" ON "Member" ("deactivatedAt") WHERE "deactivatedAt" IS NULL;
