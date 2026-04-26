-- ═══════════════════════════════════════════════════════════
-- Member PDI (Plano de Desenvolvimento Individual)
-- 6-month cycles fixed at H1 (Jan→Jun) and H2 (Jul→Dec).
-- Privacy: each member sees ONLY their own PDI (RLS enforced).
-- ═══════════════════════════════════════════════════════════

CREATE TABLE public."MemberPDI" (
  "id"             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "memberId"       text NOT NULL REFERENCES public."Member"("id") ON DELETE CASCADE,
  "cycleStartDate" date NOT NULL,
  "cycleEndDate"   date NOT NULL,
  "status"         text NOT NULL DEFAULT 'active'
    CHECK ("status" IN ('active','completed','cancelled')),
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("memberId", "cycleStartDate")
);

CREATE INDEX "MemberPDI_memberId_idx" ON public."MemberPDI" ("memberId");

CREATE TABLE public."PDIAction" (
  "id"          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "pdiId"       text NOT NULL REFERENCES public."MemberPDI"("id") ON DELETE CASCADE,
  "towerKey"    text,
  "title"       text NOT NULL,
  "why"         text,
  "how"         text,
  "criterion"   text NOT NULL,
  "dueAt"       date,
  "status"      text NOT NULL DEFAULT 'pending'
    CHECK ("status" IN ('pending','in_progress','done','cancelled')),
  "completedAt" timestamptz,
  "orderIdx"    integer NOT NULL DEFAULT 0,
  "createdAt"   timestamptz NOT NULL DEFAULT now(),
  "updatedAt"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "PDIAction_pdiId_idx" ON public."PDIAction" ("pdiId");

-- ─── RLS — self-only ──────────────────────────────────────

ALTER TABLE public."MemberPDI" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PDIAction" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public."MemberPDI" TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public."PDIAction" TO anon, authenticated;

CREATE POLICY "self_only" ON public."MemberPDI"
  FOR ALL TO authenticated
  USING (
    "memberId" IN (
      SELECT id FROM public."Member" WHERE "userId" = auth.uid()
    )
  )
  WITH CHECK (
    "memberId" IN (
      SELECT id FROM public."Member" WHERE "userId" = auth.uid()
    )
  );

CREATE POLICY "self_only" ON public."PDIAction"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public."MemberPDI" mp
      JOIN public."Member" m ON m.id = mp."memberId"
      WHERE mp.id = "PDIAction"."pdiId" AND m."userId" = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public."MemberPDI" mp
      JOIN public."Member" m ON m.id = mp."memberId"
      WHERE mp.id = "PDIAction"."pdiId" AND m."userId" = auth.uid()
    )
  );
