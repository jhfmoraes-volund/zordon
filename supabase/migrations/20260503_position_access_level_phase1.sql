-- ═══════════════════════════════════════════════════════════
-- Phase 1 (M1) — Split `position` (cargo) from `access_level` (authz).
--
-- Until now, a single `role` string mixed two axes:
--   - Cargo: ceo, cro, head-ops, pm, principal-engineer, product-builder, guest
--   - Access level: implied by the cargo via lookup tables (admin/manager/builder/guest)
--
-- After this migration:
--   - `Member.position` (added, mirrored from `role` via trigger) is the cargo.
--   - `auth.users.app_metadata.access_level` is the authoritative authz axis,
--     with values: builder | manager | admin | guest.
--   - is_admin() / is_manager() helpers read access_level from the JWT (with
--     fallback to legacy role while JWTs rotate).
--
-- This migration is **fully retro-compatible**:
--   - `Member.role` column stays alive; a BEFORE INSERT/UPDATE trigger keeps
--     `role` and `position` in sync both ways. Phase 2 (M2) drops `role`.
--   - Views expose both `role` and `position` so old TS callers keep working.
--   - is_admin()/is_manager() take both forms of input via CASE fallback.
--
-- Rollout window: ~7 days of coexistence, then run M2 cleanup.
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Backfill access_level on every auth.users row ──────────────
-- Idempotent: only touches rows missing access_level. Preserves manual
-- overrides (e.g., promoting a builder to admin without changing position).

UPDATE auth.users
SET raw_app_meta_data = jsonb_set(
  COALESCE(raw_app_meta_data, '{}'::jsonb),
  '{access_level}',
  to_jsonb(CASE raw_app_meta_data->>'role'
    WHEN 'ceo'                THEN 'admin'
    WHEN 'cro'                THEN 'admin'
    WHEN 'head-ops'           THEN 'admin'
    WHEN 'pm'                 THEN 'manager'
    WHEN 'principal-engineer' THEN 'builder'
    WHEN 'product-builder'    THEN 'builder'
    WHEN 'guest'              THEN 'guest'
    ELSE                            'guest'
  END)
)
WHERE raw_app_meta_data->>'access_level' IS NULL;

-- Smoke check: nobody left without access_level.
DO $$
DECLARE missing int;
BEGIN
  SELECT count(*) INTO missing
    FROM auth.users
   WHERE raw_app_meta_data->>'access_level' IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION 'access_level missing on % auth.users rows', missing;
  END IF;
END $$;

-- ─── 2. Add Member.position (mirrored from role) ───────────────────

ALTER TABLE public."Member" ADD COLUMN IF NOT EXISTS position text;

UPDATE public."Member" SET position = role WHERE position IS NULL;

ALTER TABLE public."Member" ALTER COLUMN position SET NOT NULL;

-- Same allowed values as the existing Member_role_check.
ALTER TABLE public."Member" DROP CONSTRAINT IF EXISTS "Member_position_check";
ALTER TABLE public."Member" ADD CONSTRAINT "Member_position_check"
  CHECK (position IN (
    'ceo','cro','head-ops','pm','principal-engineer','product-builder'
  ));

-- ─── 3. Bidirectional sync trigger (dropped in M2) ─────────────────
-- During coexistence, both `role` and `position` columns live side-by-side.
-- This trigger ensures any write to one is mirrored to the other, regardless
-- of which the caller used. Old TS still writes `role`; new TS writes
-- `position`; the DB keeps both consistent.

CREATE OR REPLACE FUNCTION public.sync_member_role_position()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- One of them must be set; default the other to match.
    NEW.position := COALESCE(NEW.position, NEW.role);
    NEW.role     := COALESCE(NEW.role, NEW.position);
  ELSIF TG_OP = 'UPDATE' THEN
    -- If only one was changed, mirror it onto the other. If both were
    -- changed in the same UPDATE, position wins (new vocabulary).
    IF NEW.position IS DISTINCT FROM OLD.position THEN
      NEW.role := NEW.position;
    ELSIF NEW.role IS DISTINCT FROM OLD.role THEN
      NEW.position := NEW.role;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS member_sync_role_position ON public."Member";
CREATE TRIGGER member_sync_role_position
  BEFORE INSERT OR UPDATE ON public."Member"
  FOR EACH ROW EXECUTE FUNCTION public.sync_member_role_position();

-- ─── 4. Recreate views exposing both `role` and `position` ─────────
-- Old callers can keep reading `role`; new callers read `position`. Both
-- aliases come from the same underlying column and are kept in sync by
-- the trigger above.

DROP VIEW IF EXISTS public.member_summary CASCADE;
CREATE VIEW public.member_summary AS
  SELECT
    m.id,
    m.name,
    m.email,
    m.role,
    m.position,
    m."githubUsername",
    m."fpCapacity",
    m."createdAt",
    m."updatedAt",
    m."userId",
    ((SELECT count(*) FROM "SquadMember" sm WHERE sm."memberId" = m.id))::integer AS squad_count,
    ((SELECT count(*) FROM "TaskAssignment" ta
        JOIN "Task" t ON t.id = ta."taskId"
       WHERE ta."memberId" = m.id
         AND t.status = ANY (ARRAY['todo','in_progress','review','changes_requested']::text[])
    ))::integer AS active_task_count
  FROM "Member" m;

DROP VIEW IF EXISTS public.member_capacity_overview CASCADE;
CREATE VIEW public.member_capacity_overview AS
  SELECT
    m.id,
    m.name,
    m.role,
    m.position,
    m."fpCapacity" AS fp_capacity,
    COALESCE(
      sum(t."functionPoints") FILTER (
        WHERE t.status = ANY (ARRAY['todo','in_progress','review','changes_requested']::text[])
      ), 0::bigint
    )::integer AS fp_allocated,
    count(ta.id) FILTER (
      WHERE t.status = ANY (ARRAY['todo','in_progress','review','changes_requested']::text[])
    )::integer AS active_task_count
  FROM "Member" m
  LEFT JOIN "TaskAssignment" ta ON ta."memberId" = m.id
  LEFT JOIN "Task" t            ON t.id = ta."taskId"
  GROUP BY m.id, m.name, m.role, m.position, m."fpCapacity";

DROP VIEW IF EXISTS public.member_commitment_overview CASCADE;
CREATE VIEW public.member_commitment_overview AS
  SELECT
    m.id,
    m.name,
    m.role,
    m.position,
    m."fpCapacity" AS capacity,
    COALESCE(sum(pm."fpAllocation"), 0::bigint)::integer AS committed,
    (m."fpCapacity" - COALESCE(sum(pm."fpAllocation"), 0::bigint))::integer AS remaining,
    count(DISTINCT pm."projectId")::integer AS project_count
  FROM "Member" m
  LEFT JOIN "ProjectMember" pm ON pm."memberId" = m.id
  GROUP BY m.id, m.name, m.role, m.position, m."fpCapacity";

GRANT SELECT ON public.member_summary,
                public.member_capacity_overview,
                public.member_commitment_overview
  TO anon, authenticated;

-- ─── 5. RLS helpers read access_level from JWT ─────────────────────
-- The 20+ policies that call is_admin()/is_manager() do NOT need to be
-- recreated — only the implementation of these two functions changes.

CREATE OR REPLACE FUNCTION public.get_my_access_level()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT coalesce(
    current_setting('request.jwt.claims', true)::json->'app_metadata'->>'access_level',
    -- Fallback: derive from legacy `role` while JWTs are still rotating.
    CASE current_setting('request.jwt.claims', true)::json->'app_metadata'->>'role'
      WHEN 'ceo'                THEN 'admin'
      WHEN 'cro'                THEN 'admin'
      WHEN 'head-ops'           THEN 'admin'
      WHEN 'pm'                 THEN 'manager'
      WHEN 'principal-engineer' THEN 'builder'
      WHEN 'product-builder'    THEN 'builder'
      WHEN 'guest'              THEN 'guest'
      ELSE                            'guest'
    END
  )
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.get_my_access_level() = 'admin'
$$;

CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.get_my_access_level() IN ('admin', 'manager')
$$;

-- get_my_role() stays alive (untouched) for legacy callers until M2.

COMMIT;
