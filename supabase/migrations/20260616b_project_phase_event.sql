-- Migration: ProjectPhaseEvent (log append-only de transição de fase do funil)
-- Description: Cada movimento commercial→immersion→ops→post_ops vira uma linha
--   imutável (from/to/quem/quando). Antes só havia Project.phaseChangedAt — um
--   timestamp ÚNICO sobrescrito a cada troca, que perdia a trajetória. Este log
--   habilita lead time por fase e conversão de funil (Metrics Registry / Alpha),
--   e auditoria de "quem moveu o card e quando". phaseChangedAt segue como cache
--   da última entrada; este append-only acumula daqui pra frente.
-- Ref: src/app/api/projects/[id]/route.ts (PUT, bloco phaseChangedAt)
-- Date: 2026-06-16

CREATE TABLE "ProjectPhaseEvent" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId"  uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  "fromPhase"  text,                                          -- null = primeira fase registrada
  "toPhase"    text NOT NULL,
  "changedBy"  uuid REFERENCES "Member"(id) ON DELETE SET NULL, -- null = agente/sistema ou membro removido
  "changedAt"  timestamptz NOT NULL DEFAULT now()
);

-- Trajetória por projeto em ordem cronológica (lead time / funil).
CREATE INDEX ix_ppe_project_changed ON "ProjectPhaseEvent"("projectId", "changedAt");

ALTER TABLE "ProjectPhaseEvent" ENABLE ROW LEVEL SECURITY;

CREATE POLICY ppe_select ON "ProjectPhaseEvent" FOR SELECT
  USING (can_view_project("projectId"));

-- Append-only: writes só server-side (API route com service role). Sem UPDATE/
-- DELETE por design — log é imutável.
REVOKE INSERT, UPDATE, DELETE ON "ProjectPhaseEvent" FROM authenticated;

COMMENT ON TABLE "ProjectPhaseEvent" IS
  'Log append-only de transição de fase do projeto (funil commercial→immersion→ops→post_ops). fromPhase null = 1ª transição registrada; changedBy null = agente/sistema. Project.phaseChangedAt é o cache da última entrada; esta tabela guarda a trajetória completa pra lead time/conversão (Metrics Registry) e auditoria. Imutável: sem UPDATE/DELETE.';
