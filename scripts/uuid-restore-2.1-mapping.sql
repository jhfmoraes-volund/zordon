-- triggers desabilitados pra evitar side effects em UPDATEs
-- 2.1 Cria _id_map e popula com new_id pra cada PK 'id' text
-- - Se id já é uuid: preserva (new_id = old::uuid)
-- - Se é CUID2: gera novo uuid

BEGIN;
SET session_replication_role = replica;

CREATE TABLE _id_map (
  table_name text NOT NULL,
  old_id text NOT NULL,
  new_id uuid NOT NULL,
  PRIMARY KEY (table_name, old_id)
);

CREATE OR REPLACE FUNCTION _is_uuid(s text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT s ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$$;

DO $$
DECLARE r RECORD; sql text;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t USING (table_schema, table_name)
    WHERE c.table_schema='public' AND t.table_type='BASE TABLE'
      AND c.column_name='id' AND c.data_type='text'
      AND c.table_name <> '_prisma_migrations'
  LOOP
    sql := format(
      'INSERT INTO _id_map(table_name, old_id, new_id)
       SELECT %L, id,
         CASE WHEN _is_uuid(id) THEN id::uuid ELSE gen_random_uuid() END
       FROM public.%I',
      r.table_name, r.table_name
    );
    EXECUTE sql;
  END LOOP;
END $$;

SELECT
  table_name,
  count(*) FILTER (WHERE old_id = new_id::text) AS preserved,
  count(*) FILTER (WHERE old_id <> new_id::text) AS regenerated
FROM _id_map
GROUP BY table_name
ORDER BY table_name;

SELECT 'TOTAL_MAPPED=' || count(*) FROM _id_map;

COMMIT;
