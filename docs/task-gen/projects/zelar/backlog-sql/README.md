# Backlog SQL — cards do Zelar no Zordon

Esta pasta guarda os arquivos SQL gerados pela skill `/task-gen-story`
para registrar **cards de planejamento** do projeto Zelar no Zordon.

## O que esses arquivos fazem

Cada arquivo `<YYYYMMDD>_zordon_backlog_us<NNN>.sql` faz **apenas**:

```sql
INSERT INTO "Task" (...)                    -- novos cards no backlog
INSERT INTO "TaskAcceptanceCriterion" (...) -- vínculo task → AC-da-Story
INSERT INTO "AcceptanceCriterion" (...)     -- checklist técnico (taskId)
INSERT INTO "TaskDependency" (...)          -- ordem de execução
```

São tabelas **internas do Zordon** (software de gestão). Aplicar esse arquivo
não cria nem altera nenhum schema de produto — só popula o backlog.

## O que esses arquivos NÃO fazem

**Nenhum DDL de produto.** Os snippets `CREATE TABLE`, `ALTER TABLE`,
`CREATE FUNCTION` etc. que aparecem dentro do campo `Task.description` são
**referência para quem implementar a task depois**, num banco do produto
Zelar (separado do Zordon). Nunca devem ser executados aqui.

Por isso esses arquivos vivem em `docs/task-gen/projects/zelar/backlog-sql/` e **não** em
`supabase/migrations/`. A pasta `supabase/migrations/` é exclusiva para
migrations do banco do Zordon.

## Como aplicar

```bash
psql "$DIRECT_URL" -f docs/task-gen/projects/zelar/backlog-sql/<arquivo>.sql
```

Onde `DIRECT_URL` aponta para o banco do **Zordon** (este repo). O arquivo
está dentro de `BEGIN; ... COMMIT;`, então rollback automático em qualquer
falha — seguro de re-rodar.
