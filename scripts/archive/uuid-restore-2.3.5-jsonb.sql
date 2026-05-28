-- triggers desabilitados pra evitar side effects em UPDATEs
-- 2.3.5 Reescreve CUID2 dentro de colunas jsonb via REPLACE
-- Apenas tabelas com jsonb que sabemos conter CUID2 (verificado em backup):
--   ChatMessage.parts/toolCalls/toolResults/actions
-- Idempotente: rows sem CUID2 não são afetadas.

BEGIN;
SET session_replication_role = replica;

DO $$
DECLARE r RECORD; tbl_col RECORD;
BEGIN
  FOR tbl_col IN
    SELECT * FROM (VALUES
      ('ChatMessage', 'parts'),
      ('ChatMessage', 'toolCalls'),
      ('ChatMessage', 'toolResults'),
      ('ChatMessage', 'actions'),
      ('MeetingTaskAction', 'payload'),
      ('SprintDeploy', 'tasksIncluded'),
      ('SprintDeploy', 'tasksFailed'),
      ('Task', 'dependencies')
    ) AS x(t, c)
  LOOP
    FOR r IN
      SELECT old_id, new_id::text AS new_id_str
      FROM _id_map
      WHERE old_id <> new_id::text
    LOOP
      EXECUTE format(
        'UPDATE public.%I SET %I = REPLACE(%I::text, %L, %L)::jsonb
         WHERE %I::text LIKE %L',
        tbl_col.t, tbl_col.c, tbl_col.c,
        r.old_id, r.new_id_str,
        tbl_col.c, '%' || r.old_id || '%'
      );
    END LOOP;
  END LOOP;
END $$;

-- Sanity: nenhum CUID2 restante em ChatMessage (não deveria, exceto refs externas tipo Roam)
SELECT 'remaining_cuid2_chatmessage_parts=' || count(*)
FROM public."ChatMessage"
WHERE parts::text ~ '"cm[a-z0-9]{20,}"';

COMMIT;
