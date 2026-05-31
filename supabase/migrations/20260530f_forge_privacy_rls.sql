-- ============================================================================
-- Forge privacy RLS — ownerId-based access (D24)
--
-- Substitui as policies project-based criadas em 20260516_forge_v1.sql por
-- policies owner-based. Rationale (D24): Forge runs são privados ao dev que
-- as criou, não compartilhados no nível de projeto. Isso permite experimentos
-- locais sem poluir o workspace do time.
--
-- Manager bypass se mantém em todas as policies.
-- ============================================================================

BEGIN;

-- ─── ForgeRun ────────────────────────────────────────────────────────────────
-- Drop policies antigas (project-based)
DROP POLICY IF EXISTS "ForgeRun_select" ON "ForgeRun";
DROP POLICY IF EXISTS "ForgeRun_mutate" ON "ForgeRun";

-- Criar policies novas (owner-based)
CREATE POLICY "ForgeRun_select" ON "ForgeRun"
  FOR SELECT USING (
    public.is_manager() OR "ownerId" = auth.uid()
  );

CREATE POLICY "ForgeRun_mutate" ON "ForgeRun"
  FOR ALL
  USING (public.is_manager() OR "ownerId" = auth.uid())
  WITH CHECK (public.is_manager() OR "ownerId" = auth.uid());

-- ─── ForgeTask ───────────────────────────────────────────────────────────────
-- ForgeTask tem projectId mas a privacy segue o run (via ownerId do run)
DROP POLICY IF EXISTS "ForgeTask_select" ON "ForgeTask";
DROP POLICY IF EXISTS "ForgeTask_mutate" ON "ForgeTask";

CREATE POLICY "ForgeTask_select" ON "ForgeTask"
  FOR SELECT USING (
    public.is_manager() OR EXISTS (
      SELECT 1 FROM "ForgeRun" r
      WHERE r.id = "ForgeTask"."runId"
        AND r."ownerId" = auth.uid()
    )
  );

CREATE POLICY "ForgeTask_mutate" ON "ForgeTask"
  FOR ALL
  USING (
    public.is_manager() OR EXISTS (
      SELECT 1 FROM "ForgeRun" r
      WHERE r.id = "ForgeTask"."runId"
        AND r."ownerId" = auth.uid()
    )
  )
  WITH CHECK (
    public.is_manager() OR EXISTS (
      SELECT 1 FROM "ForgeRun" r
      WHERE r.id = "ForgeTask"."runId"
        AND r."ownerId" = auth.uid()
    )
  );

-- ─── ForgeAgent ──────────────────────────────────────────────────────────────
-- Segue o run (via ownerId do run)
DROP POLICY IF EXISTS "ForgeAgent_select" ON "ForgeAgent";
DROP POLICY IF EXISTS "ForgeAgent_mutate" ON "ForgeAgent";

CREATE POLICY "ForgeAgent_select" ON "ForgeAgent"
  FOR SELECT USING (
    public.is_manager() OR EXISTS (
      SELECT 1 FROM "ForgeRun" r
      WHERE r.id = "ForgeAgent"."runId"
        AND r."ownerId" = auth.uid()
    )
  );

CREATE POLICY "ForgeAgent_mutate" ON "ForgeAgent"
  FOR ALL
  USING (
    public.is_manager() OR EXISTS (
      SELECT 1 FROM "ForgeRun" r
      WHERE r.id = "ForgeAgent"."runId"
        AND r."ownerId" = auth.uid()
    )
  )
  WITH CHECK (
    public.is_manager() OR EXISTS (
      SELECT 1 FROM "ForgeRun" r
      WHERE r.id = "ForgeAgent"."runId"
        AND r."ownerId" = auth.uid()
    )
  );

-- ─── ForgeEvent ──────────────────────────────────────────────────────────────
-- Segue o run (via ownerId do run)
DROP POLICY IF EXISTS "ForgeEvent_select" ON "ForgeEvent";
DROP POLICY IF EXISTS "ForgeEvent_mutate" ON "ForgeEvent";

CREATE POLICY "ForgeEvent_select" ON "ForgeEvent"
  FOR SELECT USING (
    public.is_manager() OR EXISTS (
      SELECT 1 FROM "ForgeRun" r
      WHERE r.id = "ForgeEvent"."runId"
        AND r."ownerId" = auth.uid()
    )
  );

CREATE POLICY "ForgeEvent_mutate" ON "ForgeEvent"
  FOR ALL
  USING (
    public.is_manager() OR EXISTS (
      SELECT 1 FROM "ForgeRun" r
      WHERE r.id = "ForgeEvent"."runId"
        AND r."ownerId" = auth.uid()
    )
  )
  WITH CHECK (
    public.is_manager() OR EXISTS (
      SELECT 1 FROM "ForgeRun" r
      WHERE r.id = "ForgeEvent"."runId"
        AND r."ownerId" = auth.uid()
    )
  );

COMMIT;
