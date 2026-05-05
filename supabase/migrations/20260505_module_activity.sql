-- Module activity log: records approval lifecycle events per module.
--
-- Motivo: Module.approvedAt/approvedBy guardam o estado atual mas perdem o
-- historico em multiplos round-trips (aprovar -> reabrir -> aprovar de novo).
-- Em modo ops (projeto rodando), reabrir um modulo e decisao de governanca
-- que precisa rastreabilidade. Tabela append-only espelhando TaskActivity.
--
-- Types: 'approved' | 'reopened' | 'renamed' (extensivel).
-- Payload jsonb por type:
--   approved: { promoted: int, totalFp: int }
--   reopened: { reverted: int }
--   renamed:  { from: text, to: text }

BEGIN;

CREATE TABLE IF NOT EXISTS public."ModuleActivity" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "moduleId"      uuid NOT NULL REFERENCES public."Module"(id) ON DELETE CASCADE,
  type            text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  "actorMemberId" uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  "createdAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ModuleActivity_moduleId_createdAt_idx"
  ON public."ModuleActivity" ("moduleId", "createdAt" DESC);

ALTER TABLE public."ModuleActivity" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "module_activity_read"   ON public."ModuleActivity";
DROP POLICY IF EXISTS "module_activity_insert" ON public."ModuleActivity";

CREATE POLICY "module_activity_read" ON public."ModuleActivity" FOR SELECT
  USING (EXISTS (
    SELECT 1
    FROM public."Module" mod
    JOIN public."ProjectMember" pm ON pm."projectId" = mod."projectId"
    JOIN public."Member" m         ON m.id           = pm."memberId"
    WHERE mod.id = "ModuleActivity"."moduleId"
      AND m."userId" = auth.uid()
  ));

CREATE POLICY "module_activity_insert" ON public."ModuleActivity" FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1
    FROM public."Module" mod
    JOIN public."ProjectMember" pm ON pm."projectId" = mod."projectId"
    JOIN public."Member" m         ON m.id           = pm."memberId"
    WHERE mod.id = "ModuleActivity"."moduleId"
      AND m."userId" = auth.uid()
  ));

COMMIT;
