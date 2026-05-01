# Plano — Restore do backup pré-migration (UUID-aware)

> Status: ready to execute. Restore pleno do backup `backups/pre-uuid-20260430-2000.sql` no DB já migrado pra uuid.
> Estratégia: **conversão CUID2 → uuid em Postgres local** + data-only dump → apply no remoto.

---

## 0. Contexto e estado atual

**O que aconteceu:**
- 2026-04-30 13:00: backup completo (`pre-uuid-20260430-2000.sql`, 6.2 MB).
- 2026-04-30 18:00: migration `20260501_text_to_uuid.sql` aplicada com TRUNCATE em todas as 47 tabelas do `public`. Schema virou uuid.
- 2026-04-30 18:30: reseed via `seed.ts`: 3 Members fictícios (Ana, Carlos, João Dev) + 2 Projects (TechCorp, RetailMax). Mais 1 Member real "João Moraes" (ceo) inserido manualmente, linkado ao auth.user `e6a391da...`.

**Estado verificado em 2026-04-30 ~21:00:**
| Recurso | Atual | Backup | Diff |
|---|---:|---:|---|
| auth.users | 16 | (não estava no backup) | **intacto** ✓ |
| Member | 4 (seed) | 17 | restaurar 17 reais |
| Project | 2 (seed) | 10 | restaurar 10 reais |
| Task | 8 (seed) | 174 | restaurar 174 reais |
| ChatMessage | 0 | 389 | restaurar 389 |
| AgentUsage | 0 | 237 | restaurar 237 |
| Total rows | ~50 | ~1300 | restaurar 1300 |
| MemberIntegration | 0 | 2 | tentar restaurar (depende vault) |
| FKs | 91 | 89 | sem mudança (schema OK) |

**Restrições:**
- Schema do remoto AGORA é uuid. Backup tem schema text + dados em CUID2 (Prisma legado) misturados com uuid (rows recentes).
- 5 colunas whitelist continuam text: `Agent.modelId`, `AgentVersion.modelId`, `AgentUsage.modelId`, `AgentUsage.generationId`, `DesignSessionTranscript.roamTranscriptId`.
- 5 FKs cross-schema pra `auth.users(id)`: userIds já são uuid no backup → preservam.
- `auth.users` no remoto NÃO foi tocado — os 16 auth users continuam lá. Members do backup têm `userId` apontando pra eles.

---

## 1. Decisões fechadas (sem prompts durante execução)

| # | Decisão | Razão |
|---|---|---|
| 1 | **Desabilitar 4 triggers durante INSERT** via `SET session_replication_role = replica` | `task_done_at_trigger` reescreveria `doneAt`; `project_seed_personas_trigger` duplicaria personas; `project_member_sync_access` duplicaria ProjectAccess |
| 2 | **MemberIntegration: tentar restaurar** | Não há FK formal pra `vault.secrets`; INSERT vai passar mesmo se secret órfão. Funções RPC retornam NULL se secret não existe — tolerável |
| 3 | **Backup do estado atual** antes do wipe | Segurança; rollback de 30s se algo sair errado |
| 4 | **Sobrescrever os 4 Members seed** | Members fictícios (Ana/Carlos/João Dev) são descartados; "João Moraes" do seed dá lugar ao "João Moraes" real do backup (mesmo userId, ID novo) |
| 5 | **`_prisma_migrations` não restaurado** | Metadata Prisma morta — Prisma não é mais migration tool do projeto |
| 6 | **Wipe do remoto antes do apply** | Garante começar de tabela vazia; INSERTs do dump não esbarram em rows seed remanescentes |
| 7 | **Re-sincronizar `auth.users.raw_app_meta_data`** | `member_id` no JWT precisa apontar pro Member.id correto (novo uuid após mapping) |

---

## 2. Estratégia: convert-in-local + data-only restore

```
┌─────────────────────────┐                ┌──────────────────────────┐
│  Postgres local (PG17)  │                │   Supabase dev (remoto)  │
│  schema TEXT            │                │   schema UUID            │
│  dados CUID2 + uuid     │                │   3 Members seed + João  │
└────────────┬────────────┘                └────────────┬─────────────┘
             │                                          │
   1. restore backup completo                  0. backup atual
                                                        │
   2. _id_map: CUID2 → gen_random_uuid()                │
      (uuid existente preserva)                         │
   3. UPDATE FKs internas via mapping                   │
   4. drop FKs → UPDATE PKs → re-add FKs                │
   5. Apply migration text→uuid SEM TRUNCATE            │
      → ALTER TYPE passa limpo                          │
                                                        │
   6. pg_dump --data-only --inserts                     │
      --disable-triggers                                │
                                                        │
             └─────────────►───────────────────────────►│
                                              7. TRUNCATE wipe
                                              8. SET session_replication_role=replica
                                              9. psql -f restore-data.sql
                                              10. RESET session_replication_role
                                              11. UPDATE auth.users.app_metadata
                                              12. validate counts + smoke
```

**Por que conversão em local:**
- ALTER TYPE no remoto exigiria UPDATE em coluna que JÁ é uuid (não dá pra reverter).
- Local é scratch space sem riscos.
- Após conversion + ALTER TYPE local, schemas batem perfeitamente; `pg_dump --data-only` produz INSERTs que rodam direto no remoto.

**Por que `--inserts` em vez de `COPY`:**
- INSERTs são idempotentes e legíveis (debug fácil).
- Lentidão (~1300 rows) é trivial — 1-2 min vs <10s de COPY.

**Por que não TS script:**
- Mapeamento manual de ordem topológica + 89 FKs × N colunas → fragilidade.
- pg_dump faz topo-sort pra free e o ALTER TYPE no final valida estrutura.

---

## 3. Inventário operacional

### 3.1 FKs (89 total, do `pg_constraint`)

- **86 FKs internas** (public→public): drop+recreate idênticas; precisam mapping CUID2→uuid das colunas FK.
- **3 FKs cross-schema** (public→auth.users): MANTIDAS intactas. userIds no backup já são uuid e batem com auth.users.
  - `AgentVersion.createdBy` (uuid)
  - `ProjectAccess.userId` (uuid, ON DELETE CASCADE)
  - `ProjectAccess.grantedBy` (uuid, ON DELETE SET NULL)

### 3.2 Triggers (4 ativos no remoto, 6 linhas no info_schema)

| Trigger | Tabela | Quando | Função | Risco no INSERT |
|---|---|---|---|---|
| project_seed_personas_trigger | Project | AFTER INSERT | seed_project_personas | **Cria 3 personas; backup já tem 4 ProjectPersona** → duplicatas se trigger ativo |
| project_member_demote_access | ProjectMember | AFTER DELETE | demote_access_on_member_delete | **Não dispara em INSERT** — sem risco |
| project_member_sync_access | ProjectMember | AFTER INSERT/UPDATE | sync_project_access_from_member | **Cria ProjectAccess; backup já tem 15 ProjectAccess** → duplicatas (mas tem ON CONFLICT, mitiga) |
| task_done_at_trigger | Task | BEFORE INSERT/UPDATE | sync_task_done_at | **Reescreve doneAt baseado em status** → perde valores históricos do backup |

**Mitigação geral:** `SET session_replication_role = replica` durante INSERT.

### 3.3 Vault secrets (MemberIntegration)

Backup tem 2 rows em `MemberIntegration`:
- `cmnxg5xzp0002p3x0xmznntad` (João Moraes) → roam, secretId `d0ca917f-c8f8-4742-8f07-bf1d5ad61f0d`
- `eef7ee5b-7c1a-4d88-9ce6-74bda88b0f75` (Brenda) → roam, secretId `b1819888-58e6-4549-8b31-ea4ec6bd14b3`

**Sem FK formal pra vault.secrets** — INSERT passa mesmo se secret não existe. Funções `get_member_integration_secret` retornam NULL nesse caso. Aceitável.

### 3.4 Whitelist (5 colunas que ficam text)

Não entram no mapping; valores preservados como text:
- `Agent.modelId` (e.g. `"anthropic/claude-sonnet-4.6"`)
- `AgentVersion.modelId`
- `AgentUsage.modelId`
- `AgentUsage.generationId` (e.g. `"gen-1777216752-..."`)
- `DesignSessionTranscript.roamTranscriptId` (vazio no backup)

### 3.5 Tabelas com PK composto (sem coluna `id`)

5 tabelas — não entram em `_id_map`, mas suas FK columns text→uuid são reescritas via mapping das tabelas referenciadas:
- `MeetingProjectLink` (meetingId+projectId)
- `MemberAssessment` (memberId+...)
- `MemberIntegration` (memberId+provider)
- `ProjectBusinessContext` (projectId)
- `SprintMember` (sprintId+memberId)

---

## 4. Runbook

### Fase 0 — Preparação (5 min)

**0.1 Backup do estado atual do remoto**
```bash
PG17=/opt/homebrew/opt/postgresql@17/bin
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /')
TS=$(date +%Y%m%d-%H%M)
$PG17/pg_dump "$DIRECT_URL" --no-owner --no-acl > "backups/post-truncate-${TS}.sql"
echo "$TS" > /tmp/restore-ts
ls -lh backups/post-truncate-${TS}.sql
```
Esperado: ~1 MB (poucos dados).

**0.2 Confirmar backup pré-migration intacto**
```bash
ls -lh backups/pre-uuid-20260430-2000.sql        # 6.2 MB
grep -c "^CREATE TABLE public\." backups/pre-uuid-20260430-2000-schema.sql 2>/dev/null || \
  grep -c "^CREATE TABLE public\." backups/pre-uuid-20260430-2000.sql       # esperado: 48
```

**0.3 Confirmar auth.users intacto**
```bash
psql "$DIRECT_URL" -At -c "SELECT count(*) FROM auth.users"   # esperado: 16
psql "$DIRECT_URL" -At -c "
SELECT count(*) FROM auth.users u
WHERE EXISTS (
  SELECT 1 FROM (VALUES
    ('e6a391da-9be6-492d-86be-a3533ed89409'::uuid),
    ('cca43bec-4f3b-4ded-918b-9d4c99352970'::uuid),
    ('8f893498-237e-4a2e-b6e8-aca00e61c796'::uuid),
    ('6c399489-1c2a-4609-9d0d-21767a2c383e'::uuid),
    ('0ff8c0bc-1729-45cd-853b-61822d152e4d'::uuid),
    ('d49e62af-20f0-4a99-bc21-aa7f596b1e61'::uuid),
    ('9fa562ab-4b03-4d75-acf7-b8f938ba6c7d'::uuid),
    ('b74a6d90-4f46-403e-9ba1-9b679a799690'::uuid),
    ('7e7b3d90-2285-4346-bee0-d31a2d3ed21a'::uuid),
    ('e0230698-a89d-4abd-be6b-6f9a777d75ef'::uuid),
    ('07185d0e-e979-4e77-a8c1-afeae2cf4bbf'::uuid),
    ('dcb05b62-f3eb-4197-a2a7-2673b5a63b79'::uuid),
    ('2e7fd349-0447-4a6b-9b7f-ee07a8bdd482'::uuid),
    ('df87f2d8-9331-429b-8628-e58740889972'::uuid),
    ('3c4a7e7b-4eb3-4f43-abe5-296ab72cf38a'::uuid),
    ('b8fe2a80-2330-4dc5-ad6b-9c855cd05c75'::uuid),
    ('23ffac6e-abd5-4cd9-8716-7e66fc3d8b6c'::uuid)
  ) AS expected(id) WHERE expected.id = u.id
);"
```
Esperado: 17 (todos os userIds do backup existem em auth.users).

**0.4 git status limpo (ou WIP commitado)**
```bash
git status --short
# OK: continuar mesmo com WIP da story-hierarchy não-committed; vamos só ler de DB e backup.
```

### Fase 1 — Subir Postgres local + restore (3 min)

**1.1 Iniciar instância**
```bash
PG17=/opt/homebrew/opt/postgresql@17/bin
DATA_DIR=/tmp/uuid-restore-pg
PORT=5433
LOG=/tmp/uuid-restore-pg.log

$PG17/pg_ctl -D "$DATA_DIR" stop 2>/dev/null
rm -rf "$DATA_DIR"
$PG17/initdb -D "$DATA_DIR" -U postgres --pwfile=<(echo test) -E UTF-8 --locale=en_US.UTF-8 >/dev/null 2>&1
$PG17/pg_ctl -D "$DATA_DIR" -l "$LOG" \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories='/tmp'" start
sleep 1
export LOCAL_URL="postgresql://postgres:test@127.0.0.1:5433/postgres"
$PG17/psql "$LOCAL_URL" -c "SELECT version()"
```

**1.2 Pre-criar roles Supabase**
```bash
$PG17/psql "$LOCAL_URL" <<'EOF'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE supabase_auth_admin LOGIN;
CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'authenticator';
GRANT anon, authenticated, service_role TO authenticator;
EOF
```

**1.3 Restore backup**
```bash
$PG17/psql "$LOCAL_URL" -v ON_ERROR_STOP=0 -f backups/pre-uuid-20260430-2000.sql > /tmp/restore.log 2>&1
tail -3 /tmp/restore.log
```

**1.4 Sanity (counts iguais ao backup)**
```bash
$PG17/psql "$LOCAL_URL" -At -c "
SELECT 'tables=' || count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';
SELECT 'fks=' || count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.contype='f' AND n.nspname='public';
SELECT 'Member=' || count(*) FROM \"Member\";
SELECT 'Project=' || count(*) FROM \"Project\";
SELECT 'Task=' || count(*) FROM \"Task\";
SELECT 'ChatMessage=' || count(*) FROM \"ChatMessage\";
"
```
Esperado: tables=48, fks=89, Member=17, Project=10, Task=174, ChatMessage=389.

### Fase 2 — Conversão CUID2 → uuid (2 min)

**2.1 Mapping table**

Salvar como `scripts/uuid-restore-2.1-mapping.sql`:
```sql
BEGIN;

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

COMMIT;
```

Aplicar:
```bash
$PG17/psql "$LOCAL_URL" -v ON_ERROR_STOP=1 -f scripts/uuid-restore-2.1-mapping.sql
```
Esperado: ~900 entries; output mostra preserved (já uuid) vs regenerated (CUID2).

**2.2 Drop FKs internas no local (pra permitir UPDATE em PK)**

Reusar o BLOCK 1 do gerador da migration original:
```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /')
psql "$DIRECT_URL" -f scripts/uuid-build-migration.sql 2>&1 | head -5
# Bloco 1 (DROP CONSTRAINT) sai pra stdout; capturar:
psql "$DIRECT_URL" -f scripts/uuid-build-migration.sql 2>/dev/null > /tmp/migration-blocks.sql
sed -n '/BLOCK 1:/,/BLOCK 2:/p' /tmp/migration-blocks.sql | grep "^ALTER TABLE" > /tmp/uuid-blocks/block1-drop-fk.sql
sed -n '/BLOCK 4:/,/BLOCK 5:/p' /tmp/migration-blocks.sql | grep "^ALTER TABLE" > /tmp/uuid-blocks/block4-add-fk.sql
mkdir -p /tmp/uuid-blocks

# Aplicar drop no LOCAL
$PG17/psql "$LOCAL_URL" -v ON_ERROR_STOP=1 -f /tmp/uuid-blocks/block1-drop-fk.sql
```

**2.3 Reescrever FKs (UPDATE colunas FK source via mapping)**

Salvar como `scripts/uuid-restore-2.3-rewrite-fks.sql`:
```sql
BEGIN;

DO $$
DECLARE r RECORD; sql text;
BEGIN
  -- Pra cada FK formal (capturada do dump pre-migration via pg_constraint
  -- antes de termos dropado no step 2.2 — usamos info_schema do BACKUP):
  -- mas FKs já foram dropadas, então usamos a query original sem JOIN em
  -- pg_constraint local. Estratégia alternativa: hardcoded list de FKs.
  -- Usar lista explícita derivada do backup-restored DB ANTES do drop (já lemos):
  NULL;
END $$;

-- Lista explícita (gerada do backup; cada linha: tabela_src, col_src, tabela_target):
-- Padrão UPDATE: SET col = m.new_id::text WHERE m.table_name=tgt AND m.old_id=src.col

UPDATE public."AcceptanceCriterion" t SET "checkedBy"   = m.new_id::text FROM _id_map m WHERE m.table_name='Member'        AND m.old_id=t."checkedBy"   AND t."checkedBy"   IS NOT NULL;
UPDATE public."AcceptanceCriterion" t SET "taskId"      = m.new_id::text FROM _id_map m WHERE m.table_name='Task'          AND m.old_id=t."taskId"      AND t."taskId"      IS NOT NULL;
UPDATE public."AcceptanceCriterion" t SET "userStoryId" = m.new_id::text FROM _id_map m WHERE m.table_name='UserStory'     AND m.old_id=t."userStoryId" AND t."userStoryId" IS NOT NULL;
UPDATE public."AgentConfig"        t SET "agentId"      = m.new_id::text FROM _id_map m WHERE m.table_name='Agent'         AND m.old_id=t."agentId";
UPDATE public."AgentHeuristic"     t SET "agentId"      = m.new_id::text FROM _id_map m WHERE m.table_name='Agent'         AND m.old_id=t."agentId";
UPDATE public."AgentUsage"         t SET "memberId"     = m.new_id::text FROM _id_map m WHERE m.table_name='Member'        AND m.old_id=t."memberId"    AND t."memberId" IS NOT NULL;
UPDATE public."AgentUsage"         t SET "threadId"     = m.new_id::text FROM _id_map m WHERE m.table_name='ChatThread'    AND m.old_id=t."threadId"    AND t."threadId" IS NOT NULL;
UPDATE public."AgentVersion"       t SET "agentId"      = m.new_id::text FROM _id_map m WHERE m.table_name='Agent'         AND m.old_id=t."agentId";
UPDATE public."ChatMessage"        t SET "threadId"     = m.new_id::text FROM _id_map m WHERE m.table_name='ChatThread'    AND m.old_id=t."threadId";
UPDATE public."ChatThread"         t SET "agentId"      = m.new_id::text FROM _id_map m WHERE m.table_name='Agent'         AND m.old_id=t."agentId"        AND t."agentId" IS NOT NULL;
UPDATE public."ChatThread"         t SET "agentVersionId" = m.new_id::text FROM _id_map m WHERE m.table_name='AgentVersion' AND m.old_id=t."agentVersionId" AND t."agentVersionId" IS NOT NULL;
UPDATE public."ChatThread"         t SET "createdBy"    = m.new_id::text FROM _id_map m WHERE m.table_name='Member'        AND m.old_id=t."createdBy"      AND t."createdBy" IS NOT NULL;
UPDATE public."ChatThread"         t SET "sessionId"    = m.new_id::text FROM _id_map m WHERE m.table_name='DesignSession' AND m.old_id=t."sessionId"      AND t."sessionId" IS NOT NULL;
UPDATE public."DesignDecision"     t SET "projectId"    = m.new_id::text FROM _id_map m WHERE m.table_name='Project'       AND m.old_id=t."projectId";
UPDATE public."DesignDecision"     t SET "sessionId"    = m.new_id::text FROM _id_map m WHERE m.table_name='DesignSession' AND m.old_id=t."sessionId";
UPDATE public."DesignDecision"     t SET "supersededBy" = m.new_id::text FROM _id_map m WHERE m.table_name='DesignDecision' AND m.old_id=t."supersededBy" AND t."supersededBy" IS NOT NULL;
UPDATE public."DesignOpenQuestion" t SET "projectId"    = m.new_id::text FROM _id_map m WHERE m.table_name='Project'       AND m.old_id=t."projectId";
UPDATE public."DesignOpenQuestion" t SET "sessionId"    = m.new_id::text FROM _id_map m WHERE m.table_name='DesignSession' AND m.old_id=t."sessionId";
UPDATE public."DesignSession"      t SET "createdBy"    = m.new_id::text FROM _id_map m WHERE m.table_name='Member'        AND m.old_id=t."createdBy"   AND t."createdBy" IS NOT NULL;
UPDATE public."DesignSession"      t SET "projectId"    = m.new_id::text FROM _id_map m WHERE m.table_name='Project'       AND m.old_id=t."projectId";
UPDATE public."DesignSessionExportLog" t SET "memberId" = m.new_id::text FROM _id_map m WHERE m.table_name='Member'        AND m.old_id=t."memberId"    AND t."memberId" IS NOT NULL;
UPDATE public."DesignSessionExportLog" t SET "sessionId" = m.new_id::text FROM _id_map m WHERE m.table_name='DesignSession' AND m.old_id=t."sessionId";
UPDATE public."DesignSessionItem"  t SET "sessionId"    = m.new_id::text FROM _id_map m WHERE m.table_name='DesignSession' AND m.old_id=t."sessionId";
UPDATE public."DesignSessionParticipant" t SET "memberId" = m.new_id::text FROM _id_map m WHERE m.table_name='Member'      AND m.old_id=t."memberId"    AND t."memberId" IS NOT NULL;
UPDATE public."DesignSessionParticipant" t SET "sessionId" = m.new_id::text FROM _id_map m WHERE m.table_name='DesignSession' AND m.old_id=t."sessionId";
UPDATE public."DesignSessionResearch" t SET "projectId"  = m.new_id::text FROM _id_map m WHERE m.table_name='Project'       AND m.old_id=t."projectId";
UPDATE public."DesignSessionResearch" t SET "sessionId"  = m.new_id::text FROM _id_map m WHERE m.table_name='DesignSession' AND m.old_id=t."sessionId";
UPDATE public."DesignSessionStepData" t SET "sessionId" = m.new_id::text FROM _id_map m WHERE m.table_name='DesignSession' AND m.old_id=t."sessionId";
UPDATE public."DesignSessionTranscript" t SET "importedByMemberId" = m.new_id::text FROM _id_map m WHERE m.table_name='Member'        AND m.old_id=t."importedByMemberId" AND t."importedByMemberId" IS NOT NULL;
UPDATE public."DesignSessionTranscript" t SET "projectId"          = m.new_id::text FROM _id_map m WHERE m.table_name='Project'       AND m.old_id=t."projectId";
UPDATE public."DesignSessionTranscript" t SET "sessionId"          = m.new_id::text FROM _id_map m WHERE m.table_name='DesignSession' AND m.old_id=t."sessionId";
UPDATE public."Meeting"            t SET "createdById" = m.new_id::text FROM _id_map m WHERE m.table_name='Member'        AND m.old_id=t."createdById" AND t."createdById" IS NOT NULL;
UPDATE public."Meeting"            t SET "sprintId"    = m.new_id::text FROM _id_map m WHERE m.table_name='Sprint'        AND m.old_id=t."sprintId"    AND t."sprintId" IS NOT NULL;
UPDATE public."MeetingAttendee"    t SET "meetingId"   = m.new_id::text FROM _id_map m WHERE m.table_name='Meeting'       AND m.old_id=t."meetingId";
UPDATE public."MeetingAttendee"    t SET "memberId"    = m.new_id::text FROM _id_map m WHERE m.table_name='Member'        AND m.old_id=t."memberId"    AND t."memberId" IS NOT NULL;
UPDATE public."MeetingProjectLink" t SET "meetingId"   = m.new_id::text FROM _id_map m WHERE m.table_name='Meeting'       AND m.old_id=t."meetingId";
UPDATE public."MeetingProjectLink" t SET "projectId"   = m.new_id::text FROM _id_map m WHERE m.table_name='Project'       AND m.old_id=t."projectId";
UPDATE public."MeetingProjectReview" t SET "meetingId" = m.new_id::text FROM _id_map m WHERE m.table_name='Meeting'       AND m.old_id=t."meetingId";
UPDATE public."MeetingProjectReview" t SET "memberId"  = m.new_id::text FROM _id_map m WHERE m.table_name='Member'        AND m.old_id=t."memberId";
UPDATE public."MeetingProjectReview" t SET "projectId" = m.new_id::text FROM _id_map m WHERE m.table_name='Project'       AND m.old_id=t."projectId";
UPDATE public."MeetingTaskAction"  t SET "decidedById"   = m.new_id::text FROM _id_map m WHERE m.table_name='Member'  AND m.old_id=t."decidedById"   AND t."decidedById" IS NOT NULL;
UPDATE public."MeetingTaskAction"  t SET "meetingId"     = m.new_id::text FROM _id_map m WHERE m.table_name='Meeting' AND m.old_id=t."meetingId";
UPDATE public."MeetingTaskAction"  t SET "projectId"     = m.new_id::text FROM _id_map m WHERE m.table_name='Project' AND m.old_id=t."projectId";
UPDATE public."MeetingTaskAction"  t SET "targetSprintId" = m.new_id::text FROM _id_map m WHERE m.table_name='Sprint'  AND m.old_id=t."targetSprintId" AND t."targetSprintId" IS NOT NULL;
UPDATE public."MeetingTaskAction"  t SET "taskId"        = m.new_id::text FROM _id_map m WHERE m.table_name='Task'    AND m.old_id=t."taskId"        AND t."taskId" IS NOT NULL;
UPDATE public."MemberAssessment"   t SET "memberId" = m.new_id::text FROM _id_map m WHERE m.table_name='Member' AND m.old_id=t."memberId";
UPDATE public."MemberIntegration"  t SET "memberId" = m.new_id::text FROM _id_map m WHERE m.table_name='Member' AND m.old_id=t."memberId";
UPDATE public."MemberPDI"          t SET "memberId" = m.new_id::text FROM _id_map m WHERE m.table_name='Member' AND m.old_id=t."memberId";
UPDATE public."MemberSkill"        t SET "memberId" = m.new_id::text FROM _id_map m WHERE m.table_name='Member' AND m.old_id=t."memberId";
UPDATE public."Module"             t SET "projectId" = m.new_id::text FROM _id_map m WHERE m.table_name='Project' AND m.old_id=t."projectId";
UPDATE public."PDIAction"          t SET "pdiId" = m.new_id::text FROM _id_map m WHERE m.table_name='MemberPDI' AND m.old_id=t."pdiId";
UPDATE public."Project"            t SET "clientId" = m.new_id::text FROM _id_map m WHERE m.table_name='Client' AND m.old_id=t."clientId";
UPDATE public."Project"            t SET "pmId"     = m.new_id::text FROM _id_map m WHERE m.table_name='Member' AND m.old_id=t."pmId" AND t."pmId" IS NOT NULL;
UPDATE public."ProjectAccess"      t SET "projectId" = m.new_id::text FROM _id_map m WHERE m.table_name='Project' AND m.old_id=t."projectId";
UPDATE public."ProjectBusinessContext" t SET "projectId" = m.new_id::text FROM _id_map m WHERE m.table_name='Project' AND m.old_id=t."projectId";
UPDATE public."ProjectMember"      t SET "memberId"  = m.new_id::text FROM _id_map m WHERE m.table_name='Member' AND m.old_id=t."memberId";
UPDATE public."ProjectMember"      t SET "projectId" = m.new_id::text FROM _id_map m WHERE m.table_name='Project' AND m.old_id=t."projectId";
UPDATE public."ProjectPersona"     t SET "projectId" = m.new_id::text FROM _id_map m WHERE m.table_name='Project' AND m.old_id=t."projectId";
UPDATE public."ProjectSquad"       t SET "projectId" = m.new_id::text FROM _id_map m WHERE m.table_name='Project' AND m.old_id=t."projectId";
UPDATE public."ProjectSquad"       t SET "squadId"   = m.new_id::text FROM _id_map m WHERE m.table_name='Squad'   AND m.old_id=t."squadId";
UPDATE public."ProjectWikiSection" t SET "projectId" = m.new_id::text FROM _id_map m WHERE m.table_name='Project' AND m.old_id=t."projectId";
UPDATE public."Sprint"             t SET "projectId" = m.new_id::text FROM _id_map m WHERE m.table_name='Project' AND m.old_id=t."projectId";
UPDATE public."SprintDeploy"       t SET "sprintId"  = m.new_id::text FROM _id_map m WHERE m.table_name='Sprint'  AND m.old_id=t."sprintId";
UPDATE public."SprintMember"       t SET "memberId"  = m.new_id::text FROM _id_map m WHERE m.table_name='Member' AND m.old_id=t."memberId";
UPDATE public."SprintMember"       t SET "sprintId"  = m.new_id::text FROM _id_map m WHERE m.table_name='Sprint' AND m.old_id=t."sprintId";
UPDATE public."SquadMember"        t SET "memberId"  = m.new_id::text FROM _id_map m WHERE m.table_name='Member' AND m.old_id=t."memberId";
UPDATE public."SquadMember"        t SET "squadId"   = m.new_id::text FROM _id_map m WHERE m.table_name='Squad'  AND m.old_id=t."squadId";
UPDATE public."Task"               t SET "createdById"     = m.new_id::text FROM _id_map m WHERE m.table_name='Member'        AND m.old_id=t."createdById"     AND t."createdById" IS NOT NULL;
UPDATE public."Task"               t SET "designSessionId" = m.new_id::text FROM _id_map m WHERE m.table_name='DesignSession' AND m.old_id=t."designSessionId" AND t."designSessionId" IS NOT NULL;
UPDATE public."Task"               t SET "projectId"       = m.new_id::text FROM _id_map m WHERE m.table_name='Project'       AND m.old_id=t."projectId";
UPDATE public."Task"               t SET "sprintId"        = m.new_id::text FROM _id_map m WHERE m.table_name='Sprint'        AND m.old_id=t."sprintId"        AND t."sprintId" IS NOT NULL;
UPDATE public."Task"               t SET "userStoryId"     = m.new_id::text FROM _id_map m WHERE m.table_name='UserStory'     AND m.old_id=t."userStoryId"     AND t."userStoryId" IS NOT NULL;
UPDATE public."TaskAssignment"     t SET "designSessionItemId" = m.new_id::text FROM _id_map m WHERE m.table_name='DesignSessionItem' AND m.old_id=t."designSessionItemId" AND t."designSessionItemId" IS NOT NULL;
UPDATE public."TaskAssignment"     t SET "memberId"            = m.new_id::text FROM _id_map m WHERE m.table_name='Member'            AND m.old_id=t."memberId"            AND t."memberId" IS NOT NULL;
UPDATE public."TaskAssignment"     t SET "taskId"              = m.new_id::text FROM _id_map m WHERE m.table_name='Task'              AND m.old_id=t."taskId";
UPDATE public."TaskIteration"      t SET "taskId" = m.new_id::text FROM _id_map m WHERE m.table_name='Task' AND m.old_id=t."taskId";
UPDATE public."Todo"               t SET "assigneeId"     = m.new_id::text FROM _id_map m WHERE m.table_name='Member'              AND m.old_id=t."assigneeId";
UPDATE public."Todo"               t SET "createdById"    = m.new_id::text FROM _id_map m WHERE m.table_name='Member'              AND m.old_id=t."createdById";
UPDATE public."Todo"               t SET "meetingId"      = m.new_id::text FROM _id_map m WHERE m.table_name='Meeting'             AND m.old_id=t."meetingId"      AND t."meetingId" IS NOT NULL;
UPDATE public."Todo"               t SET "sourceReviewId" = m.new_id::text FROM _id_map m WHERE m.table_name='MeetingProjectReview' AND m.old_id=t."sourceReviewId" AND t."sourceReviewId" IS NOT NULL;
UPDATE public."UserStory"          t SET "acValidatedBy"        = m.new_id::text FROM _id_map m WHERE m.table_name='Member'            AND m.old_id=t."acValidatedBy"        AND t."acValidatedBy" IS NOT NULL;
UPDATE public."UserStory"          t SET "createdById"          = m.new_id::text FROM _id_map m WHERE m.table_name='Member'            AND m.old_id=t."createdById"          AND t."createdById" IS NOT NULL;
UPDATE public."UserStory"          t SET "designSessionId"      = m.new_id::text FROM _id_map m WHERE m.table_name='DesignSession'     AND m.old_id=t."designSessionId"      AND t."designSessionId" IS NOT NULL;
UPDATE public."UserStory"          t SET "designSessionItemId"  = m.new_id::text FROM _id_map m WHERE m.table_name='DesignSessionItem' AND m.old_id=t."designSessionItemId"  AND t."designSessionItemId" IS NOT NULL;
UPDATE public."UserStory"          t SET "moduleId"             = m.new_id::text FROM _id_map m WHERE m.table_name='Module'            AND m.old_id=t."moduleId"             AND t."moduleId" IS NOT NULL;
UPDATE public."UserStory"          t SET "personaId"            = m.new_id::text FROM _id_map m WHERE m.table_name='ProjectPersona'    AND m.old_id=t."personaId"            AND t."personaId" IS NOT NULL;
UPDATE public."UserStory"          t SET "projectId"            = m.new_id::text FROM _id_map m WHERE m.table_name='Project'           AND m.old_id=t."projectId";

COMMIT;
```

Aplicar:
```bash
$PG17/psql "$LOCAL_URL" -v ON_ERROR_STOP=1 -f scripts/uuid-restore-2.3-rewrite-fks.sql
```

Cada UPDATE retorna count. Esperado: nenhum erro; counts > 0 nas tabelas com dados.

**2.4 Reescrever PKs (UPDATE id via mapping)**

Salvar como `scripts/uuid-restore-2.4-rewrite-pks.sql`:
```sql
BEGIN;

DO $$
DECLARE r RECORD; sql text;
BEGIN
  FOR r IN
    SELECT DISTINCT table_name FROM _id_map
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
```

Aplicar:
```bash
$PG17/psql "$LOCAL_URL" -v ON_ERROR_STOP=1 -f scripts/uuid-restore-2.4-rewrite-pks.sql
```

**2.5 Re-add FKs internas + verificar integridade**
```bash
$PG17/psql "$LOCAL_URL" -v ON_ERROR_STOP=1 -f /tmp/uuid-blocks/block4-add-fk.sql
$PG17/psql "$LOCAL_URL" -At -c "
SELECT 'fks_local=' || count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
WHERE c.contype='f' AND n.nspname='public';
"
```
Esperado: 89 FKs (86 internas + 3 cross-schema). Se reattach falhar: algum row tem FK órfã (data corruption no backup) — investigar coluna específica.

**2.6 Aplicar a migration text→uuid SEM TRUNCATE no local**
```bash
# Cria variant da migration sem TRUNCATE
sed '/^-- 7\. TRUNCATE/,/^RESTART IDENTITY;$/c\-- TRUNCATE pulado (dados convertidos via _id_map)' \
  supabase/migrations/20260501_text_to_uuid.sql > /tmp/migration-no-truncate.sql

# Verifica que TRUNCATE foi removido
grep -c "TRUNCATE" /tmp/migration-no-truncate.sql  # esperado: 0

# Aplicar no local
$PG17/psql "$LOCAL_URL" -v ON_ERROR_STOP=1 -f /tmp/migration-no-truncate.sql > /tmp/migration-local.log 2>&1
tail -5 /tmp/migration-local.log
```
Esperado: `Post-flight OK. text_id=0 fks=91 policies=133 funcs=24 views=8`.

**2.7 Validações no local (schema uuid + dados intactos)**
```bash
$PG17/psql "$LOCAL_URL" -At -c "
SELECT 'tables=' || count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';
SELECT 'Member=' || count(*) FROM \"Member\";
SELECT 'Project=' || count(*) FROM \"Project\";
SELECT 'Task=' || count(*) FROM \"Task\";
SELECT 'ChatMessage=' || count(*) FROM \"ChatMessage\";
SELECT 'sample_id_uuid=' || (SELECT id::text FROM \"Member\" LIMIT 1);
SELECT 'sample_modelId_text=' || (SELECT \"modelId\" FROM \"Agent\" LIMIT 1);
"
```

### Fase 3 — Data-only dump do local (1 min)

**3.1 Drop _id_map (não vai pro remoto)**
```bash
$PG17/psql "$LOCAL_URL" -c "DROP TABLE _id_map; DROP FUNCTION _is_uuid(text);"
```

**3.2 Dump --data-only --inserts --disable-triggers**
```bash
TS=$(cat /tmp/restore-ts)
$PG17/pg_dump "$LOCAL_URL" \
  --data-only \
  --no-owner \
  --no-acl \
  --schema=public \
  --exclude-table=public._prisma_migrations \
  --inserts \
  --disable-triggers \
  > backups/restore-data-${TS}.sql

ls -lh backups/restore-data-${TS}.sql
grep -c "^INSERT INTO public" backups/restore-data-${TS}.sql
# esperado: ≈1300 INSERTs
```

`--disable-triggers` adiciona `SET session_replication_role = replica;` no início e reset no final automaticamente — substitui o passo manual.

### Fase 4 — Apply no remoto (2 min)

**4.1 Wipe seed atual no remoto**
```bash
psql "$DIRECT_URL" <<'EOF'
BEGIN;
TRUNCATE
  public."AcceptanceCriterion", public."Agent", public."AgentConfig",
  public."AgentHeuristic", public."AgentUsage", public."AgentVersion",
  public."ChatMessage", public."ChatThread", public."Client",
  public."DesignDecision", public."DesignOpenQuestion", public."DesignSession",
  public."DesignSessionExportLog", public."DesignSessionItem",
  public."DesignSessionParticipant", public."DesignSessionResearch",
  public."DesignSessionStepData", public."DesignSessionTranscript",
  public."Meeting", public."MeetingAttendee", public."MeetingProjectLink",
  public."MeetingProjectReview", public."MeetingTaskAction", public."Member",
  public."MemberAssessment", public."MemberIntegration", public."MemberPDI",
  public."MemberSkill", public."Module", public."PDIAction", public."Project",
  public."ProjectAccess", public."ProjectBusinessContext", public."ProjectMember",
  public."ProjectPersona", public."ProjectSquad", public."ProjectWikiSection",
  public."Sprint", public."SprintDeploy", public."SprintMember",
  public."Squad", public."SquadMember", public."Task", public."TaskAssignment",
  public."TaskIteration", public."Todo", public."UserStory"
RESTART IDENTITY;
COMMIT;
EOF
psql "$DIRECT_URL" -At -c "
SELECT 'Member=' || count(*) FROM public.\"Member\";
SELECT 'Project=' || count(*) FROM public.\"Project\";
"
# esperado: 0, 0
```

**4.2 Apply data-only dump**
```bash
psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f backups/restore-data-${TS}.sql > /tmp/apply-data.log 2>&1
echo "exit=$?"
tail -10 /tmp/apply-data.log
grep -c "INSERT 0 1" /tmp/apply-data.log
# esperado: ≈1300 (cada INSERT confirma 1 row)
```

**4.3 Validação counts**
```bash
psql "$DIRECT_URL" -At -c "
SELECT 'Client=' || count(*) FROM public.\"Client\";              -- esperado: 7
SELECT 'Member=' || count(*) FROM public.\"Member\";              -- esperado: 17
SELECT 'Project=' || count(*) FROM public.\"Project\";            -- esperado: 10
SELECT 'Squad=' || count(*) FROM public.\"Squad\";                -- esperado: 3
SELECT 'Sprint=' || count(*) FROM public.\"Sprint\";              -- esperado: 10
SELECT 'Task=' || count(*) FROM public.\"Task\";                  -- esperado: 174
SELECT 'TaskAssignment=' || count(*) FROM public.\"TaskAssignment\"; -- esperado: 50
SELECT 'AcceptanceCriterion=' || count(*) FROM public.\"AcceptanceCriterion\"; -- esperado: 76
SELECT 'UserStory=' || count(*) FROM public.\"UserStory\";        -- esperado: 30
SELECT 'ChatMessage=' || count(*) FROM public.\"ChatMessage\";    -- esperado: 389
SELECT 'AgentUsage=' || count(*) FROM public.\"AgentUsage\";      -- esperado: 237
SELECT 'ProjectMember=' || count(*) FROM public.\"ProjectMember\"; -- esperado: 16
SELECT 'ProjectAccess=' || count(*) FROM public.\"ProjectAccess\"; -- esperado: 15
SELECT 'fks=' || count(*) FROM information_schema.table_constraints
  WHERE constraint_type='FOREIGN KEY' AND table_schema='public'; -- esperado: 91
"
```

**4.4 Re-sincronizar `auth.users.raw_app_meta_data`**
```bash
psql "$DIRECT_URL" <<'EOF'
UPDATE auth.users u
SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object(
    'role', m.role,
    'member_id', m.id::text
  )
FROM public."Member" m
WHERE m."userId" = u.id;
EOF

psql "$DIRECT_URL" -At -c "
SELECT u.email,
  u.raw_app_meta_data->>'role' AS role,
  u.raw_app_meta_data->>'member_id' AS member_id
FROM auth.users u
JOIN public.\"Member\" m ON m.\"userId\"=u.id
ORDER BY u.email;
"
```
Esperado: 17 linhas (todos auth.users com Member linkado), `role` e `member_id` populados.

### Fase 5 — Smoke test no app (5 min)

**5.1 Browser (recomendado)**
- Login `joao.moraes@volund.com.br` → Magic link.
- `/projects` → vê os 10 reais (TechCorp App, RetailMax Platform, etc).
- `/sprints` → 10 sprints com tasks reais.
- `/tasks` → 174 tasks; filtros por status batem com seed.
- `/members` → 17 reais.
- `/profile/pdi` → MemberPDI do João carrega.
- `/meetings` → 6 meetings históricos.

**5.2 SQL functional smoke (sem precisar UI)**
```bash
psql "$DIRECT_URL" -At -c "
SET LOCAL request.jwt.claims = jsonb_build_object(
  'sub', 'e6a391da-9be6-492d-86be-a3533ed89409',
  'app_metadata', jsonb_build_object('role','head-ops', 'member_id', (SELECT id::text FROM public.\"Member\" WHERE email='joao.moraes@volund.com.br'))
)::text;
SELECT can_view_project((SELECT id FROM public.\"Project\" LIMIT 1));   -- esperado: t
SELECT get_my_member_id();                                              -- esperado: uuid do João
SELECT count(*) FROM public.\"Project\" WHERE can_view_project(id);     -- esperado: >0
"
```

### Fase 6 — Cleanup (1 min)

```bash
$PG17/pg_ctl -D /tmp/uuid-restore-pg stop
rm -rf /tmp/uuid-restore-pg /tmp/uuid-restore-pg.log
rm -f /tmp/migration-no-truncate.sql /tmp/migration-blocks.sql /tmp/uuid-blocks/*

# backups/* já está no .gitignore — commit não vai pegar.
ls -lh backups/
```

### Fase 7 — (Opcional) Commit dos scripts

Se quiser preservar os scripts de mapping pra histórico:
```bash
git add scripts/uuid-restore-2.1-mapping.sql \
        scripts/uuid-restore-2.3-rewrite-fks.sql \
        scripts/uuid-restore-2.4-rewrite-pks.sql \
        docs/uuid-restore-plan.md
git commit -m "ZRD-JM-NN: scripts — restore CUID2→uuid mapping (one-shot recovery)"
git push origin main
```

---

## 5. Riscos e mitigações

| # | Risco | Prob. | Mitigação |
|---|---|---|---|
| 1 | Backup tem FK órfã (CUID2 referência sem mapping) | Baixa | Step 2.5 re-add FKs detecta antes do dump; se falhar, listar `_id_map` vs FK columns e investigar |
| 2 | `task_done_at_trigger` reescreve doneAt durante INSERT | Eliminada | `pg_dump --disable-triggers` adiciona `session_replication_role=replica` |
| 3 | `project_seed_personas_trigger` duplica ProjectPersona | Eliminada | Mesmo flag |
| 4 | `MemberIntegration.secretId` órfã (vault.secrets pode não ter) | Baixa | Sem FK formal — INSERT passa; RPC retorna NULL silenciosamente |
| 5 | `auth.users` não tem mais um userId que o Member referencia | Baixa | Pre-check 0.3 confirma 17 userIds existentes; FK `Member.userId → auth.users` valida no INSERT |
| 6 | Whitelist quebra (modelId tentando virar uuid) | Eliminada | Migration original já testada, blocks 2/3 não tocam |
| 7 | Mapping incompleto (alguma tabela com PK faltando) | Baixa | Step 2.1 inventaria todas tabelas com PK 'id' text via info_schema; coverage automática |
| 8 | Local PG não consegue restaurar backup (auth schema) | Baixa | Step 1.2 pre-cria roles; testado na migração anterior — funciona |
| 9 | INSERT no remoto duplica entry (constraint UNIQUE) | Baixa | TRUNCATE prévio (4.1) garante tabelas vazias |
| 10 | Trigger `sync_project_access_from_member` cria duplicatas | Eliminada | --disable-triggers + ProjectAccess ON CONFLICT defensive |
| 11 | Smoke test mostra dados mas RLS oculta tudo | Média | 4.4 re-sincroniza app_metadata.member_id; pode precisar deslogar/relogar pra refresh JWT |
| 12 | Tamanho do dump (--inserts) excede limite de psql | Baixa | ~1300 INSERTs = ~3-5 MB. Trivial |

---

## 6. Rollback

### Durante Fase 4 (apply remoto)

Se `psql -v ON_ERROR_STOP=1` falhar no meio:
1. O TRUNCATE 4.1 limpou tudo. Estado atual: tabelas parcialmente populadas.
2. Voltar ao estado pré-restore:
   ```bash
   psql "$DIRECT_URL" <<EOF
   BEGIN;
   TRUNCATE [...todas as 47 tabelas...] RESTART IDENTITY;
   COMMIT;
   EOF
   psql "$DIRECT_URL" -f backups/post-truncate-${TS}.sql
   ```
   Volta pros 4 Members seed que tinha antes.

### Após Fase 4 (descobre problema depois)

Mesmo procedimento — `post-truncate-${TS}.sql` é o snapshot de 0.1.

### Falha em Fase 2 (local)

Drop+restart Postgres local. Backup remoto não foi tocado.

---

## 7. Checklist de execução

### Fase 0 (5 min)
- [ ] 0.1 Backup atual `post-truncate-<TS>.sql` em `backups/`
- [ ] 0.2 Backup pré-migration confirmado (6.2 MB, 48 tabelas)
- [ ] 0.3 auth.users count=16, todos 17 userIds do backup existem
- [ ] 0.4 git status checked

### Fase 1 (3 min)
- [ ] 1.1 Postgres local subindo em :5433
- [ ] 1.2 5 roles Supabase pre-criadas
- [ ] 1.3 Restore completo OK (warnings sobre roles ignoráveis)
- [ ] 1.4 Counts batem: Member=17, Project=10, Task=174, ChatMessage=389

### Fase 2 (2 min)
- [ ] 2.1 `_id_map` populada com ~900 entries; preserved/regenerated breakdown OK
- [ ] 2.2 86 FKs internas dropadas no local
- [ ] 2.3 ~84 UPDATEs de FK columns OK (counts variam por tabela)
- [ ] 2.4 ~42 UPDATEs de PK OK
- [ ] 2.5 86 FKs re-adicionadas (fks_local=89)
- [ ] 2.6 Migration sem TRUNCATE aplicada — Post-flight OK
- [ ] 2.7 Sample id é uuid; sample modelId é text

### Fase 3 (1 min)
- [ ] 3.1 `_id_map` dropada
- [ ] 3.2 `restore-data-<TS>.sql` gerado, ~1300 INSERTs

### Fase 4 (2 min)
- [ ] 4.1 Wipe remoto (Member=0, Project=0)
- [ ] 4.2 psql apply exit=0; ~1300 "INSERT 0 1"
- [ ] 4.3 Counts batem (17 / 10 / 174 / 389 / 91 fks)
- [ ] 4.4 17 auth.users com role + member_id populados

### Fase 5 (5 min)
- [ ] 5.1 Browser smoke: login + /projects + /tasks + /members + /meetings
- [ ] 5.2 SQL smoke: can_view_project=t, get_my_member_id retorna uuid

### Fase 6 (1 min)
- [ ] 6 Cleanup: stop local pg, rm /tmp

### Fase 7 (opcional)
- [ ] 7 Commit + push dos 4 arquivos (3 SQL + 1 docs)

**Tempo total estimado: ~20 min execução real + smoke test.**

---

## 8. Anexos

### Anexo A — 17 Members do backup (ID original / userId)

| Nome | Email | Role | userId (auth.users) | ID original (CUID2/uuid) |
|---|---|---|---|---|
| João Moraes | joao.moraes@volund.com.br | head-ops | e6a391da... | cmnxg5xzp0002p3x0xmznntad |
| Vinicius Guedes | vinicius@volund.com.br | ceo | cca43bec... | cmnxobbpj0000p3rpqso13p0e |
| Levi Nóbrega | levi@beyondcompany.com.br | cro | 8f893498... | 0dd2704a-7c7c-40b1-b46d-b705a4c536a7 |
| Guilherme Perdigão | guilherme@volund.com.br | pm | 6c399489... | cmnxczlva000ap3vpq9unslvh |
| Brenda Bezerra | brenda.bezerra@volund.com.br | pm | 0ff8c0bc... | eef7ee5b-7c1a-4d88-9ce6-74bda88b0f75 |
| Jessicka Araujo | jessicka@volund.com.br | pm | d49e62af... | cmnxd1oew000bp3vp0n8pl03x |
| Davi Moura | davi.moura@beyondcompany.com.br | principal-engineer | 9fa562ab... | cmnyjjmms000gp3rpzsk8aarh |
| Vinícius Aguilar | vinicius.aguilar@volund.com.br | product-builder | b74a6d90... | cmnxcqfdb0004p39twhlsizcu |
| Eder Andrew | eder@volund.com.br | product-builder | 7e7b3d90... | cmnxd4l8k000cp3vpatv2rbxr |
| Filipe Izidorio | filipe.izidorio@beyondcompany.com.br | product-builder | e0230698... | e707a226-000e-44d5-a8e0-428234f26c99 |
| Khevin Carlos | khevin.karlos@beyondcompany.com.br | product-builder | 07185d0e... | 8d67202e-c45b-4513-ae85-331072fd08ee |
| David Carmo | david.carmo@beyondcompany.com.br | product-builder | dcb05b62... | 1d15b814-ad34-4309-bb3b-629fbabcf8c5 |
| Manoel Pedro | manoel.pedro@beyondcompany.com.br | product-builder | 2e7fd349... | 99dff952-a0a1-4859-b7e7-8a1402cffc27 |
| Luiz Albuquerque | luiz.albuquerque@beyondcompany.com.br | product-builder | df87f2d8... | 0666f0be-caff-4120-93a1-609a648702ff |
| TBA--1 | trial.volund@gmail.com | head-ops | 3c4a7e7b... | 677179cd-d277-4ec8-a6dc-f552f0f1df55 |
| TBA--2 | trial.volund.2@gmail.com | product-builder | b8fe2a80... | 7ed0dd06-4f85-4308-a153-edf91e212715 |
| TBA--3 | trial@gmail.com | product-builder | 23ffac6e... | 1a218d38-dd10-45f5-9630-f029381a2baf |

8 com CUID2 → ganham novo uuid; 9 já uuid → preservam ID.

### Anexo B — Lista das FKs por tabela (87 colunas FK reescritas)

Geradas via `pg_constraint` no DB pós-migration:

```
AcceptanceCriterion: checkedBy, taskId, userStoryId
AgentConfig: agentId
AgentHeuristic: agentId
AgentUsage: memberId, threadId
AgentVersion: agentId  (createdBy é cross-schema, não toca)
ChatMessage: threadId
ChatThread: agentId, agentVersionId, createdBy, sessionId
DesignDecision: projectId, sessionId, supersededBy
DesignOpenQuestion: projectId, sessionId
DesignSession: createdBy, projectId
DesignSessionExportLog: memberId, sessionId  (userId é cross-schema)
DesignSessionItem: sessionId
DesignSessionParticipant: memberId, sessionId
DesignSessionResearch: projectId, sessionId
DesignSessionStepData: sessionId
DesignSessionTranscript: importedByMemberId, projectId, sessionId
Meeting: createdById, sprintId
MeetingAttendee: meetingId, memberId
MeetingProjectLink: meetingId, projectId
MeetingProjectReview: meetingId, memberId, projectId
MeetingTaskAction: decidedById, meetingId, projectId, targetSprintId, taskId
MemberAssessment: memberId
MemberIntegration: memberId  (secretId é uuid pra vault, não toca)
MemberPDI: memberId
MemberSkill: memberId
Module: projectId
PDIAction: pdiId
Project: clientId, pmId
ProjectAccess: projectId  (userId/grantedBy cross-schema)
ProjectBusinessContext: projectId
ProjectMember: memberId, projectId
ProjectPersona: projectId
ProjectSquad: projectId, squadId
ProjectWikiSection: projectId
Sprint: projectId
SprintDeploy: sprintId
SprintMember: memberId, sprintId
SquadMember: memberId, squadId
Task: createdById, designSessionId (lógica), projectId, sprintId, userStoryId
TaskAssignment: designSessionItemId, memberId, taskId
TaskIteration: taskId
Todo: assigneeId, createdById, meetingId, sourceReviewId
UserStory: acValidatedBy, createdById, designSessionId, designSessionItemId,
           moduleId, personaId, projectId
```

87 colunas (86 FKs formais + 1 lógica `Task.designSessionId`). Whitelist (5 colunas modelId/generationId/roamTranscriptId) NÃO está aqui — fica text.

### Anexo C — Triggers e session_replication_role

Os 4 triggers em `public` (na verdade 6 linhas no info_schema porque INSERT+UPDATE conta separado):

| Trigger | Tabela | Eventos | Razão pra desabilitar |
|---|---|---|---|
| project_seed_personas_trigger | Project | INSERT | Seed cria 3 personas; backup já tem ProjectPersona populada |
| project_member_demote_access | ProjectMember | DELETE | Não dispara em INSERT (ok ativo) |
| project_member_sync_access | ProjectMember | INSERT, UPDATE | Sync ProjectAccess; backup já tem ProjectAccess |
| task_done_at_trigger | Task | INSERT, UPDATE | Reescreve doneAt baseado em status |

`pg_dump --disable-triggers` adiciona automaticamente:
```sql
SET session_replication_role = replica;
-- (INSERTs aqui)
SET session_replication_role = origin;
```

`replica` modo desabilita TODOS os triggers (e FK checks). Após reset pra `origin`, FK checks voltam imediatamente.

---

## 9. Resumo executivo

**O que estamos fazendo:** restaurar 17 Members + 10 Projects + 174 Tasks + ~1300 rows totais do backup pré-migration, mapeando IDs CUID2 pra uuid e preservando FKs e auth links.

**Como:**
1. Postgres local + restore backup (schema text).
2. _id_map gera uuid pra cada PK CUID2.
3. UPDATE em todas as 87 colunas FK + 42 PKs.
4. Migration text→uuid sem TRUNCATE roda limpa.
5. `pg_dump --data-only --inserts --disable-triggers`.
6. Wipe remoto + apply dump.
7. Re-sincroniza app_metadata.

**Tempo:** ~20 minutos.

**Reversibilidade:** alta. Backup do estado atual em fase 0; rollback de 30s aplicando o backup.

**Critério de sucesso:** counts batem (17/10/174/...), `auth.users` mantém 16 rows com app_metadata atualizada, smoke test no app passa.
