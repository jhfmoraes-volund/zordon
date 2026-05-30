-- Add facilitatorId to DesignSession (mirrors Planning/PMReview pattern).
-- Default no UI = membro logado (criador). Pode ser trocado por outro membro.

ALTER TABLE "DesignSession"
  ADD COLUMN "facilitatorId" uuid REFERENCES "Member"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "DesignSession_facilitatorId_idx"
  ON "DesignSession"("facilitatorId");
