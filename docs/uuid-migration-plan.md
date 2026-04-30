# Plano — Migração `text` → `uuid` em todo o schema

> Status: ready to execute. MVP, sem usuários reais — janela ideal pra fazer agora.
> Estratégia: **big bang em transação única + wipe de dados + reseed**. Atomic, rollback automático em falha.

---

## 0. TL;DR

**O contexto que define a estratégia**

- **876 IDs no banco hoje NÃO são UUIDs válidos** (CUID2 do Prisma legado: `cmnxp972d0003p3rpzobz5evg`). `ALTER TYPE ... USING col::uuid` falharia em massa.
- **Não tem prod, não tem usuário real.** Wipe + reseed é o caminho honesto e simples — preserva schema, descarta dados de dev mistos.
- 5 colunas têm "Id$" no nome mas guardam **identificadores externos** (model strings, OpenRouter IDs) — **ficam `text`**.
- 8 **views**, 4 **triggers**, 16 **funções**, 133 **RLS policies**, ~85 **FKs**, 0 storage policies que dependem disso.
- 3 colunas userId já são `uuid` mas **nenhuma tem FK formal** pra `auth.users` — adicionamos.

**O que muda no DB**

- 47 tabelas: PK `text` → `uuid`
- ~85 FKs: `text` → `uuid` (excluindo whitelist abaixo)
- 5 colunas `*Id` whitelisted: ficam `text` (modelId, generationId, roamTranscriptId)
- 3 colunas `userId` ganham FK formal pra `auth.users(id)`
- 16 RPCs: parâmetros e retornos `text` → `uuid` quando representam IDs internos
- 1 RPC stale dropada (`create_meeting_with_reviews(date, jsonb, jsonb)` referencia tabelas mortas)
- 47 ocorrências de `gen_random_uuid()::text` → `gen_random_uuid()` em DEFAULTs
- Casts `::text`/`::uuid` em corpos de funções e triggers: removidos
- 133 RLS policies: drop + recreate sem casts
- 8 views: drop + recreate (não há mudança de definição, só recompilação)

**O que NÃO muda no app**

- Tipos TS continuam `string` — uuid serializa como string em JSON.
- Código TS/JS: zero alteração de lógica.
- 36 arquivos chamam `crypto.randomUUID()` antes de INSERT — continua válido (RFC 4122 v4).
- O único `crypto.randomUUID().slice(0, 7)` em [upload/route.ts:61](../src/app/api/design-sessions/[id]/upload/route.ts#L61) escreve dentro de `data jsonb`, não em PK — fica.

**Por quê**

- ~50% menos espaço em índices PK/FK (16 vs 37 bytes).
- Comparações binárias 16-byte vs varlena strcoll → planos de query melhores.
- Validação automática: `text` aceita `"abc"` como id; `uuid` rejeita.
- Alinhamento com `auth.uid()` (uuid nativo) — RLS sem casts.
- Schema atual é misto e inconsistente (3 userId já uuid, 1 que o plano antigo achava text não existe). Conserta.

---

## 1. Inventário completo (verificado contra DB ao vivo em 2026-04-30)

### 1.1 Tabelas — 47 user tables

```
AcceptanceCriterion, Agent, AgentConfig, AgentHeuristic, AgentUsage, AgentVersion,
ChatMessage, ChatThread, Client,
DesignDecision, DesignOpenQuestion, DesignSession, DesignSessionExportLog,
DesignSessionItem, DesignSessionParticipant, DesignSessionResearch,
DesignSessionStepData, DesignSessionTranscript,
Meeting, MeetingAttendee, MeetingProjectLink, MeetingProjectReview, MeetingTaskAction,
Member, MemberAssessment, MemberIntegration, MemberPDI, MemberSkill,
Module, PDIAction, Project, ProjectAccess, ProjectBusinessContext,
ProjectMember, ProjectPersona, ProjectSquad, ProjectWikiSection,
Sprint, SprintDeploy, SprintMember, Squad, SquadMember,
Task, TaskAssignment, TaskIteration, Todo, UserStory
```

`_prisma_migrations` (id `character varying`) **fica fora** — interno do Prisma, não tem FK incoming, não toca.

### 1.2 Colunas que ficam text (whitelist explícita)

Estas terminam em `Id$` mas armazenam **identificadores externos**, não FKs internas:

| Tabela | Coluna | Conteúdo |
|---|---|---|
| Agent | modelId | `"anthropic/claude-sonnet-4.6"` (LLM model ref) |
| AgentVersion | modelId | mesmo padrão |
| AgentUsage | modelId | mesmo padrão |
| AgentUsage | generationId | `"gen-1777216752-hPJuVT772kcD4X1yUGT2"` (OpenRouter) |
| DesignSessionTranscript | roamTranscriptId | id do Roam Research (externo) |

A migration vai gerar `ALTER COLUMN TYPE uuid` com base em regex `Id$`. **Excluir explicitamente essas 5 do gerador.**

### 1.3 Colunas userId (todas já uuid, faltam FKs)

| Tabela | userId nullable? | FK existe hoje? | ON DELETE pós-migração |
|---|---|---|---|
| Member | YES | NÃO | SET NULL |
| DesignSessionExportLog | NO | NÃO | CASCADE (NOT NULL impede SET NULL) |
| ProjectAccess | NO | NÃO | CASCADE (NOT NULL impede SET NULL) |

`UserStory.userId` **não existe** — o plano antigo errou. Tem `createdById text` (FK pra Member, vira uuid normal).

### 1.4 Views — 8 views afetadas

```
client_summary, design_session_summary,
member_capacity_overview, member_commitment_overview, member_summary,
sprint_capacity_overview, sprint_member_capacity,
user_story_overview
```

Todas fazem JOIN/SELECT em colunas que mudam de tipo → **DROP antes do ALTER TYPE, RECREATE depois com a mesma definição**. Definições íntegras já capturadas em `backups/views-pre.sql`.

### 1.5 Triggers — 4 triggers, 4 trigger functions

| Trigger | Tabela | Função | Ação na migração |
|---|---|---|---|
| project_seed_personas_trigger | Project | seed_project_personas | **Manter** — body só usa NEW.id (uuid pós) e literais |
| project_member_demote_access | ProjectMember | demote_access_on_member_delete | **Manter** — body usa OLD.* (uuid pós) e auth.uid() (uuid) |
| project_member_sync_access | ProjectMember | sync_project_access_from_member | **Recriar function** — tem `gen_random_uuid()::text` no body |
| task_done_at_trigger | Task | sync_task_done_at | **Manter** — não toca ids |

### 1.6 Funções — 16 a recriar, 1 a dropar

**Recriar com signature uuid:**

| Função | Sig atual | Sig nova |
|---|---|---|
| can_view_project | (text) → boolean | (uuid) → boolean |
| can_edit_sessions | (text) → boolean | (uuid) → boolean |
| can_edit_tasks | (text) → boolean | (uuid) → boolean |
| can_access_session | (text) → boolean | (uuid) → boolean |
| can_edit_session | (text) → boolean | (uuid) → boolean |
| can_view_meeting | (text) → boolean | (uuid) → boolean |
| can_edit_meeting | (text) → boolean | (uuid) → boolean |
| is_allocated_to | (text) → boolean | (uuid) → boolean |
| next_user_story_reference | (text) → text | (uuid) → text |
| ensure_wiki_sections | (text, jsonb) → SETOF | (uuid, jsonb) → SETOF |
| create_meeting_with_reviews/9 | (...., text, ...., text) → text | (...., text, ...., uuid) → uuid |
| get_my_member_id | () → text | () → uuid |
| delete_member_integration | (text, text) → void | (uuid, text) → void |
| get_member_integration_secret | (text, text) → text | (uuid, text) → text |
| set_member_integration | (text, text, text, text) → void | (uuid, text, text, text) → void |
| sync_project_access_from_member | trigger | trigger (sem `::text`) |

**Dropar entirely (não recriar):**

- `create_meeting_with_reviews(date, jsonb, jsonb)` — versão de 3 args. Body referencia `WeeklyMeeting` e `MeetingActionItem` que não existem mais (renomeadas/dropadas em migrations posteriores). É código morto.

**Manter unchanged:**

- `is_admin()`, `is_manager()`, `get_my_role()` — não tocam id
- `next_task_reference()` — retorna "TASK-001" string
- `unassigned_active_task_count()` — só conta
- `seed_project_personas`, `demote_access_on_member_delete`, `sync_task_done_at` — trigger functions sem casts em ids

### 1.7 RLS policies

- **public schema: 133 policies.** Drop + recreate todas (idêntico body, sem casts).
- **storage schema: 0 policies referenciando IDs do public.** Verificado.
- **Outros schemas (auth, vault): 0 policies referenciando public.\*.**

### 1.8 FKs internas — ~85 constraints

Inventário completo em `backups/constraints-pre.txt` (gerado na Fase 0). Cada FK tem:
- table_name, constraint_name, column_name
- ref_table, ref_column
- update_rule, delete_rule

Será reconstruído idêntico — apenas o tipo da coluna muda.

### 1.9 Sequences

`SELECT * FROM information_schema.sequences WHERE sequence_schema='public'` retorna **0 linhas**. Não tem sequence pra remover/recriar.

### 1.10 Indexes

10 indexes parciais (`WHERE col IS NOT NULL`) detectados. Postgres rebuilda automaticamente em ALTER COLUMN TYPE — **nenhum tem `::text` ou predicado dependente de tipo**. Nenhuma ação manual.

### 1.11 Vault FKs

`MemberIntegration.secretId uuid` referencia `vault.secrets` **via código** (funções `get_member_integration_secret` etc.) — não via FK formal. Nada a fazer.

### 1.12 Estado dos dados (pre-flight executado em 2026-04-30)

```
Total de IDs invalidos: 876
```

Distribuição (top): AgentUsage.modelId 237, AgentUsage.generationId 233 (esses ficam text — whitelist), TaskAssignment.memberId 47, ProjectMember/Squad/etc com 4-15 cada.

Mesmo descontando whitelist (~470 linhas), restam **~400 IDs em formato CUID2** em tabelas user-facing. **Não tem ALTER TYPE limpo possível em cima disso.**

**→ A migração inclui TRUNCATE de todas as tabelas user antes do ALTER TYPE.**

---

## 2. Estratégia: big bang transacional + wipe

```sql
BEGIN;
  -- 1. Pre-flight (counts pré, sanity)
  -- 2. DROP views (8)
  -- 3. DROP RLS policies (133)
  -- 4. DROP triggers que usam funções a recriar (1)
  -- 5. DROP functions (16) + DROP function obsoleta (1)
  -- 6. DROP FKs (~85)
  -- 7. TRUNCATE all user tables CASCADE  ← chave do plano
  -- 8. ALTER TYPE PKs (47) → uuid + DEFAULT gen_random_uuid()
  -- 9. ALTER TYPE FKs (~85) → uuid (com whitelist excluída)
  -- 10. RECREATE functions com uuid (16)
  -- 11. RECREATE triggers (1)
  -- 12. RECREATE FKs (~85)
  -- 13. ADD FKs auth.users (3)
  -- 14. RECREATE RLS policies (133)
  -- 15. RECREATE views (8)
  -- 16. Post-flight (counts pós + asserts)
COMMIT;
```

Falha em qualquer step → ROLLBACK automático → schema **e dados** intactos (porque truncate está dentro da transação). Em dev MVP, isso é a opção certa.

**Por que NÃO faseado:** during a transição com tipos mistos, FKs quebram. Sem benefício neste contexto.

**Por que TRUNCATE em vez de migrar dados:**
- 876 IDs em CUID2 não convertem com `::uuid`.
- Reescrever IDs preservando FK exigiria mapping table + rewrite de ~85 FKs em sequência. Frágil, lento, debugar é miséria.
- Dados atuais são dev/seed sem usuários reais. Reseed é mais rápido que migration de dados.

---

## 3. Runbook

### Fase 0 — Preparação

**0.1 Confirmar contexto**
- [x] Não tem prod, não tem usuário real → user explicit em 2026-04-30.
- [ ] `git status` clean OU branch dedicada pra essa migração: `git checkout -b feat/uuid-migration`
- [ ] Sem outras migrations pendentes na queue (verificar `supabase/migrations/` vs DB applied list).

**0.2 Backup completo**
```bash
mkdir -p backups
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /')
TS=$(date +%Y%m%d-%H%M)
pg_dump "$DIRECT_URL" --no-owner --no-acl > "backups/pre-uuid-${TS}.sql"
pg_dump "$DIRECT_URL" --schema-only --no-owner --no-acl > "backups/pre-uuid-${TS}-schema.sql"
ls -lh backups/pre-uuid-${TS}*
```

Validar: arquivo > 0 bytes, contém `CREATE TABLE public."Project"`, etc.

**0.3 Dump de constraints/policies/views/funções**

Salvar como `scripts/dump-pre-migration.sql`:
```sql
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
```

Rodar:
```bash
psql "$DIRECT_URL" -At -f scripts/dump-pre-migration.sql
wc -l backups/*-pre.*
```

**0.4 Validação dos backups (CRÍTICO antes de prosseguir)**

```bash
# Conta tabelas no dump:
grep -c "^CREATE TABLE public\." backups/pre-uuid-${TS}-schema.sql
# Esperado: 47 (mais _prisma_migrations = 48)

# Conta FKs:
grep -c "FOREIGN KEY" backups/pre-uuid-${TS}-schema.sql
# Esperado: ~85
```

### Fase 1 — Construir a migration

Arquivo: **`supabase/migrations/20260501_text_to_uuid.sql`**

(Filename `20260501` evita colisão com `20260430_acceptance_criterion.sql` etc. já presentes.)

**1.1 Geração mecânica de trechos**

Salvar em `scripts/uuid-build-migration.sql`:

```sql
-- Imprime DROP CONSTRAINT pra todos os FKs:
SELECT 'ALTER TABLE public.' || quote_ident(tc.table_name) ||
       ' DROP CONSTRAINT ' || quote_ident(tc.constraint_name) || ';'
FROM information_schema.table_constraints tc
WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
ORDER BY tc.table_name, tc.constraint_name;

-- Imprime ADD CONSTRAINT pra todos os FKs (idêntico ao original):
SELECT
  'ALTER TABLE public.' || quote_ident(tc.table_name) ||
  ' ADD CONSTRAINT ' || quote_ident(tc.constraint_name) ||
  ' FOREIGN KEY (' || quote_ident(kcu.column_name) || ')' ||
  ' REFERENCES public.' || quote_ident(ccu.table_name) ||
  ' (' || quote_ident(ccu.column_name) || ')' ||
  ' ON UPDATE ' || rc.update_rule ||
  ' ON DELETE ' || rc.delete_rule || ';'
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu USING (constraint_schema, constraint_name)
JOIN information_schema.referential_constraints rc USING (constraint_schema, constraint_name)
JOIN information_schema.constraint_column_usage ccu USING (constraint_schema, constraint_name)
WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
ORDER BY tc.table_name, tc.constraint_name;

-- Imprime ALTER TYPE pras PKs:
SELECT
  'ALTER TABLE public.' || quote_ident(table_name) ||
  ' ALTER COLUMN ' || quote_ident(column_name) ||
  ' DROP DEFAULT,' ||
  ' ALTER COLUMN ' || quote_ident(column_name) ||
  ' TYPE uuid USING ' || quote_ident(column_name) || '::uuid,' ||
  ' ALTER COLUMN ' || quote_ident(column_name) ||
  ' SET DEFAULT gen_random_uuid();'
FROM information_schema.columns
WHERE table_schema='public' AND data_type='text'
  AND column_name='id'
  AND table_name <> '_prisma_migrations'
ORDER BY table_name;

-- Imprime ALTER TYPE pras FKs (com whitelist):
SELECT
  'ALTER TABLE public.' || quote_ident(table_name) ||
  ' ALTER COLUMN ' || quote_ident(column_name) ||
  ' TYPE uuid USING ' || quote_ident(column_name) || '::uuid;'
FROM information_schema.columns
WHERE table_schema='public' AND data_type='text'
  AND column_name ~ 'Id$'
  AND NOT (
    -- Whitelist: external IDs that stay text
    (table_name='Agent' AND column_name='modelId') OR
    (table_name='AgentVersion' AND column_name='modelId') OR
    (table_name='AgentUsage' AND column_name='modelId') OR
    (table_name='AgentUsage' AND column_name='generationId') OR
    (table_name='DesignSessionTranscript' AND column_name='roamTranscriptId')
  )
ORDER BY table_name, column_name;

-- Imprime DROP POLICY:
SELECT 'DROP POLICY IF EXISTS ' || quote_ident(policyname) ||
       ' ON public.' || quote_ident(tablename) || ';'
FROM pg_policies WHERE schemaname='public'
ORDER BY tablename, policyname;
```

Rodar:
```bash
psql "$DIRECT_URL" -At -f scripts/uuid-build-migration.sql > /tmp/migration-blocks.sql
wc -l /tmp/migration-blocks.sql
```

**1.2 Estrutura final da migration (literal SQL commitado)**

```sql
-- supabase/migrations/20260501_text_to_uuid.sql
-- Migra todos PKs/FKs internos de text para uuid.
-- Wipe + reseed: dados atuais (CUID2 legado) não convertem.

BEGIN;

-- ═════════════════════════════════════════════════════════════
-- 1. Pre-flight
-- ═════════════════════════════════════════════════════════════
DO $$
BEGIN
  -- Sanity: confirma que estamos em dev, não em prod por engano.
  IF current_database() NOT IN ('postgres') THEN
    RAISE EXCEPTION 'Migration deve rodar contra DB nomeado postgres (dev/staging Supabase). DB atual: %', current_database();
  END IF;
  RAISE NOTICE 'Pre-flight ok. Procedendo com wipe+migrate.';
END $$;

-- ═════════════════════════════════════════════════════════════
-- 2. DROP views (8)
-- ═════════════════════════════════════════════════════════════
DROP VIEW IF EXISTS public.client_summary CASCADE;
DROP VIEW IF EXISTS public.design_session_summary CASCADE;
DROP VIEW IF EXISTS public.member_capacity_overview CASCADE;
DROP VIEW IF EXISTS public.member_commitment_overview CASCADE;
DROP VIEW IF EXISTS public.member_summary CASCADE;
DROP VIEW IF EXISTS public.sprint_capacity_overview CASCADE;
DROP VIEW IF EXISTS public.sprint_member_capacity CASCADE;
DROP VIEW IF EXISTS public.user_story_overview CASCADE;

-- ═════════════════════════════════════════════════════════════
-- 3. DROP RLS policies (133) — output literal de scripts/uuid-build-migration.sql
-- ═════════════════════════════════════════════════════════════
-- (cole 133 linhas DROP POLICY IF EXISTS ... ON public."..."; aqui)

-- ═════════════════════════════════════════════════════════════
-- 4. DROP triggers que usam funções a recriar
-- ═════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS project_member_sync_access ON public."ProjectMember";

-- ═════════════════════════════════════════════════════════════
-- 5. DROP functions (16 a recriar + 1 obsoleta)
-- ═════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.can_view_project(text);
DROP FUNCTION IF EXISTS public.can_edit_sessions(text);
DROP FUNCTION IF EXISTS public.can_edit_tasks(text);
DROP FUNCTION IF EXISTS public.can_access_session(text);
DROP FUNCTION IF EXISTS public.can_edit_session(text);
DROP FUNCTION IF EXISTS public.can_view_meeting(text);
DROP FUNCTION IF EXISTS public.can_edit_meeting(text);
DROP FUNCTION IF EXISTS public.is_allocated_to(text);
DROP FUNCTION IF EXISTS public.next_user_story_reference(text);
DROP FUNCTION IF EXISTS public.ensure_wiki_sections(text, jsonb);
DROP FUNCTION IF EXISTS public.create_meeting_with_reviews(timestamptz, jsonb, jsonb, text, text, jsonb, jsonb, text, text);
DROP FUNCTION IF EXISTS public.create_meeting_with_reviews(timestamptz, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.get_my_member_id();
DROP FUNCTION IF EXISTS public.delete_member_integration(text, text);
DROP FUNCTION IF EXISTS public.get_member_integration_secret(text, text);
DROP FUNCTION IF EXISTS public.set_member_integration(text, text, text, text);
DROP FUNCTION IF EXISTS public.sync_project_access_from_member() CASCADE;

-- ═════════════════════════════════════════════════════════════
-- 6. DROP FKs (~85) — output literal de scripts/uuid-build-migration.sql
-- ═════════════════════════════════════════════════════════════
-- (cole linhas ALTER TABLE ... DROP CONSTRAINT ...; aqui)

-- ═════════════════════════════════════════════════════════════
-- 7. TRUNCATE — wipe dados (FKs já dropadas, CASCADE seguro)
-- ═════════════════════════════════════════════════════════════
-- Ordem não importa porque não tem FK ativa, mas TRUNCATE precisa listar tudo
-- ou usar CASCADE. Lista explícita pra documentação.

TRUNCATE
  public."AcceptanceCriterion",
  public."Agent",
  public."AgentConfig",
  public."AgentHeuristic",
  public."AgentUsage",
  public."AgentVersion",
  public."ChatMessage",
  public."ChatThread",
  public."Client",
  public."DesignDecision",
  public."DesignOpenQuestion",
  public."DesignSession",
  public."DesignSessionExportLog",
  public."DesignSessionItem",
  public."DesignSessionParticipant",
  public."DesignSessionResearch",
  public."DesignSessionStepData",
  public."DesignSessionTranscript",
  public."Meeting",
  public."MeetingAttendee",
  public."MeetingProjectLink",
  public."MeetingProjectReview",
  public."MeetingTaskAction",
  public."Member",
  public."MemberAssessment",
  public."MemberIntegration",
  public."MemberPDI",
  public."MemberSkill",
  public."Module",
  public."PDIAction",
  public."Project",
  public."ProjectAccess",
  public."ProjectBusinessContext",
  public."ProjectMember",
  public."ProjectPersona",
  public."ProjectSquad",
  public."ProjectWikiSection",
  public."Sprint",
  public."SprintDeploy",
  public."SprintMember",
  public."Squad",
  public."SquadMember",
  public."Task",
  public."TaskAssignment",
  public."TaskIteration",
  public."Todo",
  public."UserStory"
RESTART IDENTITY;

-- ═════════════════════════════════════════════════════════════
-- 8. ALTER TYPE — PKs (47) — output literal
-- ═════════════════════════════════════════════════════════════
-- (cole 47 linhas ALTER TABLE ... ALTER COLUMN id ... aqui)
-- Após truncate, USING col::uuid sempre passa (sem linhas pra converter).

-- ═════════════════════════════════════════════════════════════
-- 9. ALTER TYPE — FKs (~85, com whitelist excluída) — output literal
-- ═════════════════════════════════════════════════════════════
-- (cole linhas ALTER TABLE ... ALTER COLUMN <fk> TYPE uuid ... aqui)

-- ═════════════════════════════════════════════════════════════
-- 10. RECREATE functions — uuid signatures
-- ═════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_my_member_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::json->'app_metadata'->>'member_id',
    ''
  )::uuid
$$;

CREATE OR REPLACE FUNCTION public.can_view_project(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."ProjectAccess"
    WHERE "userId" = auth.uid() AND "projectId" = p_project_id
  )
$$;

CREATE OR REPLACE FUNCTION public.can_edit_sessions(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."ProjectAccess"
    WHERE "userId" = auth.uid()
      AND "projectId" = p_project_id
      AND role IN ('session_participant','contributor','lead')
  )
$$;

CREATE OR REPLACE FUNCTION public.can_edit_tasks(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."ProjectAccess"
    WHERE "userId" = auth.uid()
      AND "projectId" = p_project_id
      AND role IN ('contributor','lead')
  )
$$;

CREATE OR REPLACE FUNCTION public.can_access_session(p_session_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT public.is_manager() OR EXISTS (
    SELECT 1 FROM public."DesignSession" ds
    WHERE ds.id = p_session_id
      AND public.can_view_project(ds."projectId")
  )
$$;

CREATE OR REPLACE FUNCTION public.can_edit_session(p_session_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT public.is_manager() OR EXISTS (
    SELECT 1 FROM public."DesignSession" ds
    WHERE ds.id = p_session_id
      AND public.can_edit_sessions(ds."projectId")
  )
$$;

CREATE OR REPLACE FUNCTION public.can_view_meeting(p_meeting_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public."Meeting" m
      JOIN public."MeetingAttendee" a ON a."meetingId" = m.id
      WHERE m.id = p_meeting_id
        AND m.type IN ('pm_review','general')
        AND a."memberId" = public.get_my_member_id()
    )
    OR EXISTS (
      SELECT 1
      FROM public."Meeting" m
      JOIN public."MeetingProjectLink" mpl ON mpl."meetingId" = m.id
      JOIN public."Project" p ON p.id = mpl."projectId"
      WHERE m.id = p_meeting_id
        AND m.type IN ('daily','super_planning')
        AND p."pmId" = public.get_my_member_id()
    )
$$;

CREATE OR REPLACE FUNCTION public.can_edit_meeting(p_meeting_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public."Meeting"
      WHERE id = p_meeting_id
        AND "createdById" = public.get_my_member_id()
        AND public.get_my_member_id() IS NOT NULL  -- antes era <> ''
    )
$$;

CREATE OR REPLACE FUNCTION public.is_allocated_to(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."ProjectMember"
    WHERE "memberId" = public.get_my_member_id()
      AND "projectId" = p_project_id
  )
$$;

CREATE OR REPLACE FUNCTION public.next_user_story_reference(p_project_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_key text;
  v_seq int;
BEGIN
  SELECT "referenceKey" INTO v_key FROM public."Project" WHERE id = p_project_id;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Project % is missing referenceKey', p_project_id;
  END IF;

  SELECT COALESCE(MAX(
    CAST(SUBSTRING(reference FROM '\-US\-(\d+)$') AS int)
  ), 0) + 1
  INTO v_seq
  FROM public."UserStory"
  WHERE "projectId" = p_project_id;

  RETURN v_key || '-US-' || LPAD(v_seq::text, 3, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_wiki_sections(p_project_id uuid, p_sections jsonb)
RETURNS SETOF public."ProjectWikiSection" LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public."ProjectWikiSection" ("projectId", "sectionKey", title, data, "order", "createdAt", "updatedAt")
  SELECT
    p_project_id,
    s->>'sectionKey',
    s->>'title',
    COALESCE(s->'data', '[]'::jsonb),
    (s->>'order')::int,
    now(),
    now()
  FROM jsonb_array_elements(p_sections) s
  ON CONFLICT ("projectId", "sectionKey") DO NOTHING;
  -- id usa DEFAULT gen_random_uuid(); removido cast ::text e literal

  RETURN QUERY
  SELECT * FROM public."ProjectWikiSection"
  WHERE "projectId" = p_project_id
  ORDER BY "order";
END;
$$;

CREATE OR REPLACE FUNCTION public.create_meeting_with_reviews(
  p_date timestamptz,
  p_reviews jsonb DEFAULT '[]'::jsonb,
  p_carry_actions jsonb DEFAULT '[]'::jsonb,
  p_type text DEFAULT 'pm_review',
  p_title text DEFAULT NULL,
  p_attendees jsonb DEFAULT '[]'::jsonb,
  p_project_ids jsonb DEFAULT '[]'::jsonb,
  p_notes text DEFAULT NULL,
  p_sprint_id uuid DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_meeting_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public."Meeting"
    (id, date, "type", title, notes, "sprintId", "createdAt", "updatedAt")
  VALUES
    (v_meeting_id, p_date, p_type, p_title, p_notes, p_sprint_id, now(), now());

  INSERT INTO public."MeetingProjectReview"
    ("meetingId", "projectId", "memberId", "order", "createdAt", "updatedAt")
  SELECT
    v_meeting_id,
    (r->>'projectId')::uuid,
    (r->>'memberId')::uuid,
    (r->>'order')::int,
    now(),
    now()
  FROM jsonb_array_elements(p_reviews) r;

  INSERT INTO public."MeetingAttendee"
    ("meetingId", "memberId", "externalName", "externalEmail", "externalRole", "role", "createdAt")
  SELECT
    v_meeting_id,
    NULLIF(a->>'memberId', '')::uuid,
    NULLIF(a->>'externalName', ''),
    NULLIF(a->>'externalEmail', ''),
    NULLIF(a->>'externalRole', ''),
    NULLIF(a->>'role', ''),
    now()
  FROM jsonb_array_elements(p_attendees) a
  WHERE COALESCE(a->>'memberId', a->>'externalName') IS NOT NULL;

  INSERT INTO public."MeetingProjectLink" ("meetingId", "projectId", "createdAt")
  SELECT v_meeting_id, value::uuid, now()
  FROM jsonb_array_elements_text(p_project_ids)
  ON CONFLICT DO NOTHING;

  INSERT INTO public."Todo"
    ("meetingId", description, "assigneeId", "createdById",
     "dueDate", status, source, "createdAt", "updatedAt")
  SELECT
    v_meeting_id,
    a->>'description',
    (a->>'assigneeId')::uuid,
    (a->>'assigneeId')::uuid,
    NULLIF(a->>'dueDate', '')::timestamptz,
    'todo',
    'meeting',
    now(),
    now()
  FROM jsonb_array_elements(p_carry_actions) a
  WHERE a->>'description' IS NOT NULL;

  RETURN v_meeting_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_member_integration(p_member_id uuid, p_provider text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'vault'
AS $$
DECLARE v_secret_id UUID;
BEGIN
  SELECT "secretId" INTO v_secret_id
  FROM public."MemberIntegration"
  WHERE "memberId" = p_member_id AND provider = p_provider;
  IF v_secret_id IS NULL THEN RETURN; END IF;
  DELETE FROM public."MemberIntegration"
  WHERE "memberId" = p_member_id AND provider = p_provider;
  DELETE FROM vault.secrets WHERE id = v_secret_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_member_integration_secret(p_member_id uuid, p_provider text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'vault'
AS $$
DECLARE v_secret_id UUID; v_secret TEXT;
BEGIN
  SELECT "secretId" INTO v_secret_id
  FROM public."MemberIntegration"
  WHERE "memberId" = p_member_id AND provider = p_provider;
  IF v_secret_id IS NULL THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE id = v_secret_id;
  RETURN v_secret;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_member_integration(p_member_id uuid, p_provider text, p_token text, p_token_hint text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'vault'
AS $$
DECLARE v_existing_secret_id UUID; v_new_secret_id UUID;
BEGIN
  SELECT "secretId" INTO v_existing_secret_id
  FROM public."MemberIntegration"
  WHERE "memberId" = p_member_id AND provider = p_provider;

  IF v_existing_secret_id IS NOT NULL THEN
    PERFORM vault.update_secret(v_existing_secret_id, p_token);
    UPDATE public."MemberIntegration"
    SET "tokenHint" = p_token_hint, "updatedAt" = now()
    WHERE "memberId" = p_member_id AND provider = p_provider;
  ELSE
    v_new_secret_id := vault.create_secret(p_token, format('member_%s_%s', p_member_id, p_provider));
    INSERT INTO public."MemberIntegration"("memberId", provider, "secretId", "tokenHint")
    VALUES (p_member_id, p_provider, v_new_secret_id, p_token_hint);
  END IF;
END;
$$;

-- Trigger function (sem ::text):
CREATE OR REPLACE FUNCTION public.sync_project_access_from_member()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE v_user uuid;
BEGIN
  SELECT "userId" INTO v_user FROM public."Member" WHERE id = NEW."memberId";
  IF v_user IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public."ProjectAccess" ("userId", "projectId", role)
  VALUES (v_user, NEW."projectId", 'contributor')
  ON CONFLICT ("userId", "projectId") DO UPDATE
    SET role = CASE
      WHEN "ProjectAccess".role IN ('viewer','session_participant') THEN 'contributor'
      ELSE "ProjectAccess".role
    END;
  RETURN NEW;
END $$;

-- ═════════════════════════════════════════════════════════════
-- 11. RECREATE triggers
-- ═════════════════════════════════════════════════════════════
CREATE TRIGGER project_member_sync_access
  AFTER INSERT OR UPDATE ON public."ProjectMember"
  FOR EACH ROW EXECUTE FUNCTION public.sync_project_access_from_member();

-- ═════════════════════════════════════════════════════════════
-- 12. RECREATE FKs (~85) — output literal
-- ═════════════════════════════════════════════════════════════
-- (cole linhas ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ...; aqui)

-- ═════════════════════════════════════════════════════════════
-- 13. ADD FKs auth.users (3)
-- ═════════════════════════════════════════════════════════════
ALTER TABLE public."Member"
  ADD CONSTRAINT "Member_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."DesignSessionExportLog"
  ADD CONSTRAINT "DesignSessionExportLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public."ProjectAccess"
  ADD CONSTRAINT "ProjectAccess_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES auth.users(id) ON DELETE CASCADE;

-- ═════════════════════════════════════════════════════════════
-- 14. RECREATE RLS policies (133) — output literal
-- ═════════════════════════════════════════════════════════════
-- (cole 133 CREATE POLICY ... aqui — bodies idênticos aos originais,
--  Postgres reconstrói tipo internamente; nenhum ::text/::uuid manual)

-- ═════════════════════════════════════════════════════════════
-- 15. RECREATE views (8)
-- ═════════════════════════════════════════════════════════════
-- (cole conteúdo de backups/views-pre.sql aqui — definições idênticas)

-- ═════════════════════════════════════════════════════════════
-- 16. Post-flight
-- ═════════════════════════════════════════════════════════════
DO $$
DECLARE
  cnt_text_id INT;
  cnt_fks INT;
  cnt_policies INT;
  cnt_funcs INT;
  cnt_views INT;
BEGIN
  -- Nenhuma coluna id/Id$ em text além da whitelist:
  SELECT count(*) INTO cnt_text_id
  FROM information_schema.columns
  WHERE table_schema='public' AND data_type='text'
    AND (column_name='id' OR column_name ~ 'Id$')
    AND NOT (
      (table_name='Agent' AND column_name='modelId') OR
      (table_name='AgentVersion' AND column_name='modelId') OR
      (table_name='AgentUsage' AND column_name='modelId') OR
      (table_name='AgentUsage' AND column_name='generationId') OR
      (table_name='DesignSessionTranscript' AND column_name='roamTranscriptId') OR
      (table_name='_prisma_migrations' AND column_name='id')
    );
  IF cnt_text_id > 0 THEN
    RAISE EXCEPTION 'Post-flight FAILED: % colunas ainda em text', cnt_text_id;
  END IF;

  -- FKs ≥ 85 (esperado: original + 3 novas):
  SELECT count(*) INTO cnt_fks
  FROM information_schema.table_constraints
  WHERE constraint_type='FOREIGN KEY' AND table_schema='public';
  IF cnt_fks < 85 THEN
    RAISE EXCEPTION 'Post-flight FAILED: só % FKs (esperado >= 85)', cnt_fks;
  END IF;

  -- Policies = 133:
  SELECT count(*) INTO cnt_policies FROM pg_policies WHERE schemaname='public';
  IF cnt_policies <> 133 THEN
    RAISE EXCEPTION 'Post-flight FAILED: % policies (esperado 133)', cnt_policies;
  END IF;

  -- Functions: 16 recriadas + funções unchanged. Sanity loose >= 20.
  SELECT count(*) INTO cnt_funcs
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prokind='f';
  IF cnt_funcs < 20 THEN
    RAISE EXCEPTION 'Post-flight FAILED: só % funções (esperado >= 20)', cnt_funcs;
  END IF;

  -- Views = 8:
  SELECT count(*) INTO cnt_views FROM information_schema.views WHERE table_schema='public';
  IF cnt_views <> 8 THEN
    RAISE EXCEPTION 'Post-flight FAILED: % views (esperado 8)', cnt_views;
  END IF;

  RAISE NOTICE 'Post-flight OK. text_id=% fks=% policies=% funcs=% views=%',
    cnt_text_id, cnt_fks, cnt_policies, cnt_funcs, cnt_views;
END $$;

COMMIT;
```

**1.3 Self-review check (antes de aplicar)**
- [ ] Cada DROP CONSTRAINT (step 6) tem ADD CONSTRAINT correspondente (step 12)
- [ ] Cada DROP POLICY (step 3) tem CREATE POLICY (step 14)
- [ ] Cada DROP FUNCTION (step 5) tem CREATE FUNCTION (step 10), exceto a obsoleta de 3-args
- [ ] Cada DROP VIEW (step 2) tem CREATE VIEW (step 15)
- [ ] DROP TRIGGER (step 4) → CREATE TRIGGER (step 11)
- [ ] Toda PK do schema aparece em step 8 (47 ALTER COLUMN id)
- [ ] Whitelist de 5 colunas externamente texto **ausentes** dos steps 9 e do post-flight
- [ ] Nenhum `::text` em DEFAULT, em corpo de função, em policy
- [ ] `get_my_member_id()` usa `NULLIF(...)::uuid` (porque jwt claim pode ser string vazia)
- [ ] `can_edit_meeting` mudou `<> ''` pra `IS NOT NULL`

### Fase 2 — Dry run em test DB

**2.1 Subir Postgres local em Docker**
```bash
docker run -d --name uuid-test \
  -e POSTGRES_PASSWORD=test \
  -p 5433:5432 \
  postgres:15
sleep 3
export TEST_URL="postgresql://postgres:test@localhost:5433/postgres"
```

**2.2 Restaurar backup no test DB**
```bash
# Usa o dump completo (schema + data) pra ter estado realístico:
psql "$TEST_URL" -f backups/pre-uuid-${TS}.sql
# Ignorar warnings sobre roles ausentes (anon, authenticated, service_role) —
# o schema ainda aplica, RLS fica desabilitada por falta de role mas isso é OK pro dry run.
```

**2.3 Aplicar migration**
```bash
psql "$TEST_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260501_text_to_uuid.sql
```

Se sair em erro: ler o stack, corrigir migration, re-restaurar test DB, repetir.

**2.4 Validações no DB**
```bash
psql "$TEST_URL" -c "\d \"Task\""
# id, projectId, sprintId, etc. devem ser uuid

psql "$TEST_URL" -c "SELECT count(*) FROM \"Project\""
# Deve ser 0 (truncated)

psql "$TEST_URL" -c "INSERT INTO \"Client\" (name, \"updatedAt\") VALUES ('TestClient', now()) RETURNING id"
# Deve retornar uuid v4

psql "$TEST_URL" -c "INSERT INTO \"Project\" (id, name, \"clientId\", \"updatedAt\") VALUES ('not-a-uuid', 'X', gen_random_uuid(), now())"
# ERROR: invalid input syntax for type uuid

psql "$TEST_URL" -c "SELECT count(*) FROM information_schema.table_constraints WHERE constraint_type='FOREIGN KEY' AND table_schema='public'"
# Deve ser >= 88 (85 originais + 3 novas auth.users)

psql "$TEST_URL" -c "SELECT count(*) FROM pg_policies WHERE schemaname='public'"
# Deve ser 133
```

**2.5 Cleanup test DB**
```bash
docker rm -f uuid-test
```

**Critério pra prosseguir**: 2.3 e 2.4 sem erro. Se falhar, voltar pra 1.2.

### Fase 3 — Aplicar em dev DB

```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /')
psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260501_text_to_uuid.sql
```

Se erro: ROLLBACK foi automático. Schema + dados intactos. Debug + retry.

### Fase 4 — Regenerar tipos + verificação

**4.1 Tipos TS**
```bash
npm run db:types
# regenera src/lib/supabase/database.types.ts
```

Diff esperado: zero mudança visual significativa (uuid serializa como `string` em TS).

**4.2 Build + lint**
```bash
npx tsc --noEmit
npx eslint src/
```

**4.3 Reseed**

Ordem importa (dependências):
```bash
# 1. Bootstrap admin auth user + Member
BOOTSTRAP_EMAIL='jh.moraes93@gmail.com' \
BOOTSTRAP_PASSWORD='<senha-dev>' \
BOOTSTRAP_NAME='João Moraes' \
BOOTSTRAP_ROLE='ceo' \
npx tsx supabase/seed/seed-auth-bootstrap.ts

# 2. Seed clients/projects/squads/members fixture
npx tsx supabase/seed/seed.ts

# 3. Seed auth users + link to Members
npx tsx supabase/seed/seed-auth-members.ts
```

Se algum seed falhar por hardcoded id que vira uuid, ajustar o script. Esperado: scripts usam `gen_random_uuid()` defaults via Supabase, então passa sem mudança.

**4.4 Smoke test no app**

```bash
npm run dev
```

Rodar manualmente:
- [ ] Login (magic link com email seed)
- [ ] Listar `/projects`
- [ ] Criar novo Project
- [ ] Abrir um Project, criar UserStory + AC
- [ ] Criar Sprint
- [ ] Criar Task vinculada a UserStory
- [ ] Criar TaskAssignment
- [ ] Profile/PDI
- [ ] Criar Meeting
- [ ] Inserir Todo

Erro de RLS aqui = policy mal recriada. Erro de FK = ALTER TYPE faltou em alguma coluna. Diagnóstico em [src/lib/supabase/database.types.ts](../src/lib/supabase/database.types.ts) regenerada.

**4.5 Sanity de planos (registro pra antes/depois)**
```sql
EXPLAIN ANALYZE SELECT * FROM "Task" WHERE "projectId" = '<uuid>';
SELECT relname, pg_size_pretty(pg_relation_size(oid)) AS size
FROM pg_class
WHERE relkind='i' AND (relname LIKE '%_pkey' OR relname LIKE '%_idx')
ORDER BY pg_relation_size(oid) DESC LIMIT 30;
```

Sem dados o EXPLAIN não vai mostrar nada útil — registrar mesmo assim como baseline futuro.

### Fase 5 — Commit + push

```bash
bash scripts/sync-main.sh -m "ZRD-JM-NN: schema — migrate all text IDs to native uuid (wipe+reseed)"
```

Push pra origin (prod) e staging — mas como **não tem prod**, o push é só de código. Os Supabase de staging/prod, quando existirem, vão aplicar a migration na próxima execução automatizada (CI/Supabase migrations).

---

## 4. Rollback

### Durante a transação
ROLLBACK automático. Schema + dados intactos. Investigar, corrigir, retry.

### Após COMMIT, se descobrir problema crítico
```bash
psql "$DIRECT_URL" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres, anon, authenticated, service_role;'
psql "$DIRECT_URL" -f backups/pre-uuid-${TS}.sql
```

Em ~2min restaura tudo. Drástico mas viável em dev.

---

## 5. Riscos e mitigações

| Risco | Prob. | Mitigação |
|---|---|---|
| ALTER TYPE falha por dado em CUID2 | Eliminada | TRUNCATE step 7 limpa antes |
| View bloqueia ALTER TYPE | Eliminada | Drop step 2 antes |
| Trigger function quebra com type mismatch | Mitigado | sync_project_access recriada explicitamente |
| FK perdida no recreate | Baixa | Self-review 1.3 + post-flight contagem >= 85 |
| RLS policy esquecida | Baixa | Self-review + post-flight count = 133 |
| Function recriada com body errado | Média | Self-review manual cada body em §10; smoke test 4.4 expõe |
| Whitelist insuficiente (coluna FK virou uuid mas era external) | Baixa | Cross-check com FK info (step 1.2 cobre 5 conhecidas) |
| `get_my_member_id()` retorna NULL pós (string vazia no JWT) | Mitigado | NULLIF + uuid; policies com `IS NOT NULL` em vez de `<> ''` |
| Reseed falha porque seed hardcoda IDs | Baixa | Seed atual usa Supabase default — verificado |
| Backup corrompido | Baixa | Validar restore em test DB ANTES (Fase 2.2) |
| Migration trava em prod | N/A | Não estamos em prod |
| Staging Supabase com dados | N/A | Não tem staging Supabase configurado (single DB) |

---

## 6. Não-objetivos (escopo explicitamente fora)

- Migrar 36 endpoints de `crypto.randomUUID()` client-side pra `RETURNING id`. Funciona pós-migração; refactor separado.
- Adicionar validação de UUID no client. Postgres já valida pós-migração; client middleware desnecessário.
- Refatorar agentes Alpha/Vitor pra ter slug column dedicado. Após truncate, novos agentes ganham UUIDs e a busca via `name` continua funcionando — não há regressão.
- Mexer em índices novos (otimização performance) — esta migration mantém os existentes; otimização vem depois.
- Rebatizar funções, mudar assinaturas além do tipo do id, ou remover lógica obsoleta além da `create_meeting_with_reviews/3` morta.
- Adicionar/remover RLS policies — só recreate idêntica.

---

## 7. Checklist de execução

### Fase 0
- [ ] 0.1 Confirmação: dev only, sem usuários reais, branch `feat/uuid-migration`
- [ ] 0.2 Backup completo `pg_dump` em `backups/pre-uuid-<TS>.sql`
- [ ] 0.3 Dumps de constraints/policies/views/funções em `backups/*-pre.*`
- [ ] 0.4 Validação: arquivos > 0 bytes, contagens batem (47 tabelas, ~85 FKs)

### Fase 1
- [ ] 1.1 Output de `scripts/uuid-build-migration.sql` capturado
- [ ] 1.2 Migration `20260501_text_to_uuid.sql` montada com **SQL literal expandido** (não geração-on-the-fly)
- [ ] 1.3 Self-review: 16 pares drop/recreate, whitelist confirmada, sem `::text` perdido

### Fase 2
- [ ] 2.1 Postgres local Docker rodando
- [ ] 2.2 Backup restaurado em test DB (warnings de role ignoráveis)
- [ ] 2.3 Migration aplicada com `ON_ERROR_STOP=1` sem falha
- [ ] 2.4 Validações DB-level: schema uuid, INSERT inválido falha, count FK >= 88, count policy = 133
- [ ] 2.5 Container Docker removido

### Fase 3
- [ ] 3 Migration aplicada em dev DB com `ON_ERROR_STOP=1`

### Fase 4
- [ ] 4.1 `npm run db:types` rodado
- [ ] 4.2 `tsc --noEmit` clean, `eslint` clean
- [ ] 4.3 Reseed: bootstrap → seed.ts → seed-auth-members
- [ ] 4.4 Smoke test app: login, projects, tasks, meeting, profile, todos
- [ ] 4.5 Tamanho de índices registrado (baseline)

### Fase 5
- [ ] 5 Commit via `sync-main.sh` com mensagem `ZRD-JM-NN: schema — migrate all text IDs to native uuid (wipe+reseed)`

---

## Anexo A — Whitelist de colunas que continuam text

```
Agent.modelId
AgentVersion.modelId
AgentUsage.modelId
AgentUsage.generationId
DesignSessionTranscript.roamTranscriptId
```

Razão: armazenam identificadores de serviços externos (LLM model strings, OpenRouter generation IDs, Roam Research transcript IDs). Não são FK internas.

## Anexo B — FKs novas pra auth.users

```sql
ALTER TABLE public."Member"
  ADD CONSTRAINT "Member_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."DesignSessionExportLog"
  ADD CONSTRAINT "DesignSessionExportLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public."ProjectAccess"
  ADD CONSTRAINT "ProjectAccess_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES auth.users(id) ON DELETE CASCADE;
```

`SET NULL` em Member porque a coluna é nullable (member desativado preserva histórico). `CASCADE` nas outras duas porque NOT NULL — perde sentido sem o user.

## Anexo C — Funções: deltas exatos

| Função | Mudança no body além da assinatura |
|---|---|
| can_view_project | nenhuma |
| can_edit_sessions | nenhuma |
| can_edit_tasks | nenhuma |
| can_access_session | nenhuma |
| can_edit_session | nenhuma |
| can_view_meeting | nenhuma |
| can_edit_meeting | `<> ''` → `IS NOT NULL` |
| is_allocated_to | nenhuma |
| next_user_story_reference | nenhuma |
| ensure_wiki_sections | removido `gen_random_uuid()::text, p_project_id` literal; coluna id usa DEFAULT |
| create_meeting_with_reviews/9 | `gen_random_uuid()::text` → DEFAULT; `(r->>'projectId')::uuid` em casts de payload jsonb |
| create_meeting_with_reviews/3 | **DROPADA** — referencia tabelas mortas |
| get_my_member_id | retorna `NULLIF(claim, '')::uuid` em vez de `coalesce(claim, '')` |
| delete_member_integration | sig `text → uuid` no member_id |
| get_member_integration_secret | sig `text → uuid` no member_id |
| set_member_integration | sig `text → uuid` no member_id; `format('member_%s_%s', ...)` continua funciona com uuid |
| sync_project_access_from_member | removido `gen_random_uuid()::text` e literal id no INSERT |
| is_admin, is_manager, get_my_role | unchanged |
| next_task_reference | unchanged (retorna "TASK-001" string) |
| unassigned_active_task_count | unchanged |
| seed_project_personas | unchanged |
| demote_access_on_member_delete | unchanged |
| sync_task_done_at | unchanged |

## Anexo D — Views: lista (definições íntegras em `backups/views-pre.sql`)

```
client_summary
design_session_summary
member_capacity_overview
member_commitment_overview
member_summary
sprint_capacity_overview
sprint_member_capacity
user_story_overview
```

Cada uma é dropada antes do ALTER TYPE e recriada depois com **definição idêntica** — Postgres recompila os tipos das colunas auto.

## Anexo E — Triggers: lista

```
project_seed_personas_trigger     ON Project        AFTER INSERT  → seed_project_personas (manter)
project_member_demote_access      ON ProjectMember  AFTER DELETE  → demote_access_on_member_delete (manter)
project_member_sync_access        ON ProjectMember  AFTER INS/UPD → sync_project_access_from_member (recriar)
task_done_at_trigger              ON Task           BEFORE INS/UPD→ sync_task_done_at (manter)
```
