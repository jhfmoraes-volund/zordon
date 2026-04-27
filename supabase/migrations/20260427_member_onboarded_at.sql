-- ============================================================
-- Member onboarding flag
--
-- Marca quando o membro completou o onboarding inicial
-- (specialty, seniority, githubUsername, fpCapacity).
-- O dashboard layout gateia em /onboarding até esse campo ser
-- preenchido.
--
-- Backfill: todos os membros existentes ficam como já onboarded
-- (não queremos forçar quem já tá ativo a refazer o flow).
-- Novos convites são criados com NULL e passam pelo onboarding.
-- ============================================================

BEGIN;

ALTER TABLE public."Member"
  ADD COLUMN "onboardedAt" timestamptz;

UPDATE public."Member"
   SET "onboardedAt" = now()
 WHERE "onboardedAt" IS NULL;

COMMIT;
