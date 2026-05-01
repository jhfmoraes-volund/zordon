-- triggers desabilitados pra evitar side effects em UPDATEs
-- 2.4 Reescreve PKs (id) usando _id_map.
-- FKs internas estão dropadas (step 2.2); UPDATEs em PK livres.

BEGIN;
SET session_replication_role = replica;

DO $$
DECLARE r RECORD; sql text;
BEGIN
  FOR r IN
    SELECT DISTINCT table_name FROM _id_map ORDER BY table_name
  LOOP
    sql := format(
      'UPDATE public.%I t
       SET id = m.new_id::text
       FROM _id_map m
       WHERE m.table_name = %L AND m.old_id = t.id
         AND m.old_id <> m.new_id::text',
      r.table_name, r.table_name
    );
    EXECUTE sql;
    RAISE NOTICE 'updated PK %', r.table_name;
  END LOOP;
END $$;

COMMIT;
