-- ═══════════════════════════════════════════════════════════
-- Member.role: trava aos valores canônicos definidos em
-- src/lib/roles.ts (ROLE_LEVELS keys, exceto 'guest' — guest
-- não tem Member row).
--
-- Por que: hoje a coluna aceita qualquer string, e isso já
-- causou um bug (auth.users com role='fullstack' — specialty
-- foi gravada como role na criação do membro).
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Fix do user que entrou com specialty no role ──────
-- manoel.pedro@beyondcompany.com.br: app_metadata.role estava
-- 'fullstack' (specialty). Member.role já está correto como
-- product-builder; alinha o app_metadata.

UPDATE auth.users
SET raw_app_meta_data = jsonb_set(
  COALESCE(raw_app_meta_data, '{}'::jsonb),
  '{role}',
  '"product-builder"'
)
WHERE id = '2e7fd349-0447-4a6b-9b7f-ee07a8bdd482'
  AND raw_app_meta_data->>'role' = 'fullstack';

-- ─── 2. CHECK constraint em Member.role ───────────────────

ALTER TABLE public."Member"
  DROP CONSTRAINT IF EXISTS "Member_role_check";

ALTER TABLE public."Member"
  ADD CONSTRAINT "Member_role_check"
  CHECK (role IN (
    'ceo',
    'cro',
    'head-ops',
    'pm',
    'principal-engineer',
    'product-builder'
  ));

COMMENT ON CONSTRAINT "Member_role_check" ON public."Member" IS
  'Roles canônicos. Espelha ROLE_LEVELS keys em src/lib/roles.ts (sem guest, que é externo e não tem Member).';
