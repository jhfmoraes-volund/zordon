-- Gera os blocos mecânicos da migration text→uuid.
-- Output capturado em /tmp/migration-blocks.sql e colado no arquivo final.
-- Usa pg_constraint (não info schema) pra robustez.

\pset format unaligned
\pset tuples_only on
\pset footer off

\echo '-- ════ BLOCK 1: DROP CONSTRAINT (FKs internas public→public, exclui cross-schema) ════'
SELECT 'ALTER TABLE public.' || quote_ident(t.relname) ||
       ' DROP CONSTRAINT ' || quote_ident(c.conname) || ';'
FROM pg_constraint c
JOIN pg_class t ON c.conrelid=t.oid
JOIN pg_namespace n ON t.relnamespace=n.oid
JOIN pg_class rt ON c.confrelid=rt.oid
JOIN pg_namespace rn ON rt.relnamespace=rn.oid
WHERE c.contype='f' AND n.nspname='public' AND rn.nspname='public'
ORDER BY t.relname, c.conname;

\echo ''
\echo '-- ════ BLOCK 2: ALTER PK to uuid (47 user tables) ════'
SELECT
  'ALTER TABLE public.' || quote_ident(c.table_name) ||
  ' ALTER COLUMN ' || quote_ident(c.column_name) ||
  ' DROP DEFAULT,' || E'\n  ALTER COLUMN ' || quote_ident(c.column_name) ||
  ' TYPE uuid USING ' || quote_ident(c.column_name) || '::uuid,' ||
  E'\n  ALTER COLUMN ' || quote_ident(c.column_name) ||
  ' SET DEFAULT gen_random_uuid();'
FROM information_schema.columns c
JOIN information_schema.tables t USING (table_schema, table_name)
WHERE c.table_schema='public' AND t.table_type='BASE TABLE'
  AND c.data_type='text'
  AND c.column_name='id'
  AND c.table_name <> '_prisma_migrations'
ORDER BY c.table_name;

\echo ''
\echo '-- ════ BLOCK 3: ALTER FK columns to uuid (FK reais + Id$ regex - whitelist) ════'
-- Union de:
--   (a) Todas colunas text que são FK formal (pg_constraint)
--   (b) Colunas text terminadas em Id$ (FKs lógicas sem constraint formal,
--       ex: Task.designSessionId)
-- Excluindo whitelist de external IDs.
WITH fk_text_cols AS (
  -- (a) Colunas FK formais que ainda são text
  SELECT t.relname AS table_name, a.attname AS column_name
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid=t.oid
  JOIN pg_namespace n ON t.relnamespace=n.oid
  JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
  WHERE c.contype='f' AND n.nspname='public'
    AND a.atttypid = 'text'::regtype
),
id_text_cols AS (
  -- (b) Colunas text+Id$ em base tables (inclui FKs lógicos sem constraint)
  SELECT c.table_name, c.column_name
  FROM information_schema.columns c
  JOIN information_schema.tables t USING (table_schema, table_name)
  WHERE c.table_schema='public' AND t.table_type='BASE TABLE'
    AND c.data_type='text' AND c.column_name ~ 'Id$'
    AND c.column_name <> 'id'
),
all_cols AS (
  SELECT table_name, column_name FROM fk_text_cols
  UNION
  SELECT table_name, column_name FROM id_text_cols
)
SELECT
  'ALTER TABLE public.' || quote_ident(table_name) ||
  ' ALTER COLUMN ' || quote_ident(column_name) ||
  ' TYPE uuid USING ' || quote_ident(column_name) || '::uuid;'
FROM all_cols
WHERE NOT (
    (table_name='Agent' AND column_name='modelId') OR
    (table_name='AgentVersion' AND column_name='modelId') OR
    (table_name='AgentUsage' AND column_name='modelId') OR
    (table_name='AgentUsage' AND column_name='generationId') OR
    (table_name='DesignSessionTranscript' AND column_name='roamTranscriptId')
  )
ORDER BY table_name, column_name;

\echo ''
\echo '-- ════ BLOCK 4: ADD CONSTRAINT (FKs internas) — pg_get_constraintdef ════'
SELECT
  'ALTER TABLE public.' || quote_ident(t.relname) ||
  ' ADD CONSTRAINT ' || quote_ident(c.conname) || ' ' ||
  pg_get_constraintdef(c.oid) || ';'
FROM pg_constraint c
JOIN pg_class t ON c.conrelid=t.oid
JOIN pg_namespace n ON t.relnamespace=n.oid
JOIN pg_class rt ON c.confrelid=rt.oid
JOIN pg_namespace rn ON rt.relnamespace=rn.oid
WHERE c.contype='f' AND n.nspname='public' AND rn.nspname='public'
ORDER BY t.relname, c.conname;

\echo ''
\echo '-- ════ BLOCK 5: DROP POLICY ════'
SELECT 'DROP POLICY IF EXISTS ' || quote_ident(policyname) ||
       ' ON public.' || quote_ident(tablename) || ';'
FROM pg_policies WHERE schemaname='public'
ORDER BY tablename, policyname;

\echo ''
\echo '-- ════ BLOCK 6: CREATE POLICY ════'
SELECT
  'CREATE POLICY ' || quote_ident(p.policyname) ||
  ' ON public.' || quote_ident(p.tablename) ||
  ' AS ' || p.permissive ||
  ' FOR ' || p.cmd ||
  ' TO ' || array_to_string(p.roles, ', ') ||
  CASE WHEN p.qual IS NOT NULL THEN E'\n  USING (' || p.qual || ')' ELSE '' END ||
  CASE WHEN p.with_check IS NOT NULL THEN E'\n  WITH CHECK (' || p.with_check || ')' ELSE '' END ||
  ';'
FROM pg_policies p
WHERE p.schemaname='public'
ORDER BY p.tablename, p.policyname;
