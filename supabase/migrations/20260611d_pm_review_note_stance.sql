-- Postura do risco em PMReviewNote (calibração Vitoria, capture 0ca428d4).
-- Problema: project-overview trata QUALQUER note kind='risk' ativa como
-- health=red, mesmo com mitigação em curso (caso SIAL). A prosa da Vitoria
-- já distinguia postura — faltava o campo estruturado.
--
--   managed      — mitigação em curso / sob controle. Não altera health.
--   needs_action — exige ação do PM/time. Segura amber.
--   escalate     — fora da alçada do time, exige escalação humana. Red
--                  (apenas em projeto operacional — gate na camada de leitura).
--
-- stance só faz sentido em kind='risk'; CHECK trava isso. Nullable porque
-- digest executivo (audience='executive') é re-gerado a cada report e não
-- participa do health.

ALTER TABLE "PMReviewNote" ADD COLUMN "stance" text;

ALTER TABLE "PMReviewNote" ADD CONSTRAINT "PMReviewNote_stance_check"
  CHECK (
    "stance" IS NULL
    OR ("kind" = 'risk' AND "stance" IN ('managed', 'needs_action', 'escalate'))
  );

-- Backfill: risco existente sem postura vira needs_action (amber) — não some
-- do radar, mas para de puxar red sozinho.
UPDATE "PMReviewNote" SET "stance" = 'needs_action'
  WHERE "kind" = 'risk' AND "stance" IS NULL AND "audience" = 'detail';
