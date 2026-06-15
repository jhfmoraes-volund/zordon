-- ═══════════════════════════════════════════════════════════
-- OpenSourceCard: cards de endomarketing por colaborador
--
-- "Open Source" = página interna (builder+) com cards estilo
-- trading card sobre um colaborador (ARQUIVO #NNN). Curadoria
-- é admin-only; leitura é de qualquer não-guest.
--
-- Seções repetidas (humanFacts, builderFacts, chat, soundtrack)
-- moram em jsonb; tags/callMeFor/truthsAndLie em text[].
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Tabela ──────────────────────────────────────────────

CREATE TABLE "OpenSourceCard" (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "archiveNumber"    integer NOT NULL UNIQUE,
  category           text NOT NULL DEFAULT 'ENDOMARKETING',
  name               text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  title              text,
  "photoStoragePath" text,
  "photoUpdatedAt"   timestamptz,
  tags               text[] NOT NULL DEFAULT '{}',
  quote              text,
  "quoteAttribution" text,
  "humanFacts"       jsonb NOT NULL DEFAULT '[]'::jsonb,
  "builderFacts"     jsonb NOT NULL DEFAULT '[]'::jsonb,
  "callMeFor"        text[] NOT NULL DEFAULT '{}',
  chat               jsonb NOT NULL DEFAULT '[]'::jsonb,
  "truthsAndLie"     text[] NOT NULL DEFAULT '{}',
  soundtrack         jsonb NOT NULL DEFAULT '[]'::jsonb,
  "displayOrder"     integer,
  "isPublished"      boolean NOT NULL DEFAULT true,
  "createdBy"        uuid REFERENCES "Member"(id) ON DELETE SET NULL,
  "createdAt"        timestamptz NOT NULL DEFAULT now(),
  "updatedAt"        timestamptz NOT NULL DEFAULT now()
);

-- ─── 2. Índices ─────────────────────────────────────────────

CREATE INDEX ix_open_source_card_order
  ON "OpenSourceCard" ("displayOrder", "archiveNumber");

-- ─── 3. RLS ─────────────────────────────────────────────────

ALTER TABLE "OpenSourceCard" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "open_source_select" ON public."OpenSourceCard";
DROP POLICY IF EXISTS "open_source_insert" ON public."OpenSourceCard";
DROP POLICY IF EXISTS "open_source_update" ON public."OpenSourceCard";
DROP POLICY IF EXISTS "open_source_delete" ON public."OpenSourceCard";

-- SELECT: qualquer authenticated que não seja guest.
CREATE POLICY "open_source_select" ON public."OpenSourceCard"
  FOR SELECT TO authenticated
  USING (public.get_my_access_level() <> 'guest');

-- INSERT/UPDATE/DELETE: admins (founders).
CREATE POLICY "open_source_insert" ON public."OpenSourceCard"
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "open_source_update" ON public."OpenSourceCard"
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "open_source_delete" ON public."OpenSourceCard"
  FOR DELETE TO authenticated
  USING (public.is_admin());
