-- Dump constraints/policies/views/functions pré-migration pra diff posterior

\o backups/constraints-pre.txt
SELECT tc.table_name, tc.constraint_name, kcu.column_name,
       ccu.table_name AS ref_table, ccu.column_name AS ref_column,
       rc.update_rule, rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu USING (constraint_schema, constraint_name)
JOIN information_schema.referential_constraints rc USING (constraint_schema, constraint_name)
JOIN information_schema.constraint_column_usage ccu USING (constraint_schema, constraint_name)
WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
ORDER BY tc.table_name, tc.constraint_name;

\o backups/policies-pre.txt
SELECT schemaname, tablename, policyname, cmd, roles::text, qual, with_check
FROM pg_policies WHERE schemaname='public'
ORDER BY tablename, policyname;

\o backups/views-pre.sql
SELECT '-- ' || table_name || E'\nCREATE OR REPLACE VIEW public."' || table_name || '" AS' || E'\n' || view_definition || E'\n'
FROM information_schema.views
WHERE table_schema='public'
ORDER BY table_name;

\o backups/functions-pre.sql
SELECT pg_get_functiondef(p.oid) || E';\n'
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.prokind='f'
ORDER BY p.proname;

\o
