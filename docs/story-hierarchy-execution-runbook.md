# Story Hierarchy — Runbook de Execução

**Status:** runbook executável
**Data:** 2026-04-30
**Audience:** agente (humano ou IA) que vai executar a migração do zero
**Escopo:** sequência ordenada de waves pra levar o sandbox `/dev/stories` para produção real, sem precisar de contexto prévio do projeto.

**Documentos de apoio (leitura obrigatória da Wave 0):**
- [story-hierarchy-plan.md](./story-hierarchy-plan.md) — schema-alvo (V2)
- [story-hierarchy-migration.md](./story-hierarchy-migration.md) — plano de migração (este runbook é o executor)
- [story-hierarchy-backfill.md](./story-hierarchy-backfill.md) — backfill de dados legacy
- [story-hierarchy-alpha-integration.md](./story-hierarchy-alpha-integration.md) — integração com Alpha

---

## Convenções globais

### Formato de cada wave

```
## Wave N — <título>

**Objetivo:** uma frase
**Pré-requisitos:** waves anteriores concluídas + decisões humanas fechadas
**Tempo estimado:** N hours
**Pode rodar em paralelo com:** Wave X (se aplicável)

### Antes de começar
- [ ] checklist de pré-requisitos

### Ações
1. ação 1 com comando exato
2. ação 2
...

### Validação
queries SQL / tests / smoke checks

### Output esperado
arquivos criados/modificados, commits

### Se falhar
rollback ou ponto de parada

### Bloqueadores humanos
quando parar e perguntar
```

### Convenções do repo

- **Migrations:** rodam via `source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql "$DIRECT_URL" -f supabase/migrations/<file>.sql` (nunca pelo dashboard).
- **Commits:** `bash scripts/sync-main.sh -m "ZRD-JM-NN: <descrição>"`. Nunca abrir editor.
- **Após migration:** sempre regerar `src/lib/supabase/database.types.ts`.
- **Sem branches:** trabalha direto em `main` via sync-main.sh (que pusha pra origin + staging).
- **Não pular hooks:** se commit falha, investigar.

### Regra de ouro

**Pare e pergunte ao humano** sempre que:
- Decisão de negócio aparece (ex: aprovar nome de módulo, validar AC)
- Algo não bate com o esperado (count divergente, query retorna 0 onde deveria ter N)
- Validação falha em produção
- Rollback foi acionado em qualquer wave

Não tente "consertar criativamente" — comunique e espere direção.

---

## Wave 0 — Onboarding

**Objetivo:** entender o estado atual e validar premissas antes de tocar em código.
**Pré-requisitos:** acesso ao repo + `.env` com `DIRECT_URL` configurado.
**Tempo estimado:** 1-2h
**Pode rodar em paralelo com:** —

### Antes de começar
- [ ] Confirmar acesso ao repo via `git status` (deve estar em `main`).
- [ ] Confirmar `.env` tem `DIRECT_URL` válido — testar com `source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql "$DIRECT_URL" -c '\dt' | head`.
- [ ] Bun instalado e funcionando (`bun --version`).

### Ações

1. **Ler docs em ordem:**
   - `docs/story-hierarchy-plan.md` (V2 do schema-alvo) — entende o **modelo**
   - `docs/story-hierarchy-migration.md` — entende as **fases**
   - `docs/story-hierarchy-backfill.md` — entende **dados legacy**
   - `docs/story-hierarchy-alpha-integration.md` — entende **agente** (executar só depois da Wave 4)

2. **Inspecionar sandbox local:**
   - Subir dev server: `bun dev` (porta 3333).
   - Acessar `http://localhost:3333/dev/stories`.
   - Navegar pelas 5 tabs: Overview, Stories, Tasks, Sprints, Settings.
   - Abrir uma story (clicar linha) → toggle pra editar → salvar mock.
   - Abrir aba Sprints → expandir burndown.
   - Confirmar que tudo funciona sem erros no console.

3. **Mapear componentes prontos pra reuso:**
   - `src/components/story-hierarchy/` — 11 componentes (Stories list/sheet, Tasks list/sheet, Settings, Dialogs, AC, chips, helpers, types)
   - `src/components/sprint/` — 7 componentes (Navigator, Detail, Timeline, SummaryStats, Capacity, Burndown, helpers)
   - `src/app/(dashboard)/dev/stories/` — page de assembly + mock-data
   - **Não reescrever nada disso.** Page real apenas substitui mock-data por DAL real.

4. **Inventário do banco atual** (apenas leitura):
   ```sql
   -- Salvar output em docs/_runbook-snapshots/wave-0-pre-state.txt
   \dt
   \d "Project"
   \d "Task"
   \d "Sprint"
   SELECT COUNT(*) FROM "Project";
   SELECT COUNT(*) FROM "Task";
   SELECT COUNT(*) FROM "Sprint";
   ```

5. **Confirmar premissas com humano** (não criar nada ainda):
   - Feature flag `Project.useStoryHierarchy` (proposto) — OK?
   - Cleanup na Wave 10 ou refactor separado?
   - AC validation = manager-only via API ou column-level RLS?
   - Mock cosmético (capacity proporcional) vs realista (500 baseline)?

### Validação

- [ ] Sandbox em `/dev/stories` funciona end-to-end (todas as 5 tabs, story sheet, task sheet).
- [ ] Snapshot do banco salvo em `docs/_runbook-snapshots/wave-0-pre-state.txt`.
- [ ] As 4 decisões abertas estão fechadas (resposta do humano registrada).

### Output esperado

```
docs/_runbook-snapshots/wave-0-pre-state.txt   ← novo, snapshot de schema
```

Sem commit ainda.

### Se falhar

- Sandbox não sobe → conferir `bun install`, `.env`, ports. Não prosseguir.
- DB não responde → conferir `DIRECT_URL`. Não prosseguir.
- Decisões não fechadas → parar e perguntar humano.

### Bloqueadores humanos

- 4 decisões da seção 15 do migration plan. Sem essas respostas, não começar Wave 1.

---

## Wave 1 — Schema base (migrations forward-only)

**Objetivo:** criar todas as tabelas e colunas novas, sem mexer em código de aplicação.
**Pré-requisitos:** Wave 0 concluída + decisões abertas fechadas.
**Tempo estimado:** 2-3h
**Pode rodar em paralelo com:** —

### Antes de começar
- [ ] Backup completo do DB (qualquer ferramenta — `pg_dump`, snapshot Supabase, etc).
- [ ] Confirmar com humano que migrations vão direto em prod (sem staging) ou se precisa staging primeiro. **Recomendação:** staging primeiro se ambiente existe.

### Ações

Criar 7 arquivos em `supabase/migrations/` (datas YYYYMMDD do dia da execução). Conteúdo SQL exato está em [story-hierarchy-migration.md §2](./story-hierarchy-migration.md#2-fase-1--schema-migrations).

1. **Criar arquivo `supabase/migrations/<date>_project_reference_key_and_dod.sql`** — conteúdo §2.1 do migration plan.

2. **Criar arquivo `supabase/migrations/<date>_project_persona.sql`** — conteúdo §2.2.

3. **Criar arquivo `supabase/migrations/<date>_module.sql`** — conteúdo §2.3.

4. **Criar arquivo `supabase/migrations/<date>_user_story.sql`** — conteúdo §2.4 (inclui sequencer `next_user_story_reference`).

5. **Criar arquivo `supabase/migrations/<date>_acceptance_criterion.sql`** — conteúdo §2.5.

6. **Criar arquivo `supabase/migrations/<date>_task_extensions.sql`** — conteúdo §2.6 (com trigger `sync_task_done_at` cobrindo INSERT + UPDATE).

7. **Criar arquivo `supabase/migrations/<date>_user_story_overview_view.sql`** — conteúdo §2.7.

8. **Rodar em ordem** (parar no primeiro erro):
   ```bash
   source <(grep '^DIRECT_URL=' .env | sed 's/^/export /')

   for f in \
     supabase/migrations/<date>_project_reference_key_and_dod.sql \
     supabase/migrations/<date>_project_persona.sql \
     supabase/migrations/<date>_module.sql \
     supabase/migrations/<date>_user_story.sql \
     supabase/migrations/<date>_acceptance_criterion.sql \
     supabase/migrations/<date>_task_extensions.sql \
     supabase/migrations/<date>_user_story_overview_view.sql
   do
     echo "Rodando $f..."
     psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f "$f" || { echo "FALHOU em $f"; exit 1; }
   done
   ```

9. **Regen `database.types.ts`:**
   ```bash
   # Comando exato depende da config do projeto. Verificar package.json scripts ou
   # supabase config. Provável:
   bunx supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts
   ```

10. **Smoke test typecheck:** `bunx tsc --noEmit` deve passar (pode ter avisos novos sobre campos opcionais — corrigir conforme necessário, mas sem mudar lógica).

11. **Commit:**
    ```bash
    bash scripts/sync-main.sh -m "ZRD-JM-NN: schema base — Module, UserStory, AC, Persona + Task ext"
    ```

### Validação

```sql
-- Salvar output em docs/_runbook-snapshots/wave-1-post-state.txt
-- Tabelas existem
\dt "Module" "ProjectPersona" "UserStory" "AcceptanceCriterion"

-- Indexes existem
\di "user_story_*" "module_*" "ac_*" "task_user_story_*" "task_done_at_*" "project_use_story_hierarchy_*" "project_persona_*"

-- View existe
\d user_story_overview

-- Funções existem
\df next_user_story_reference seed_project_personas sync_task_done_at

-- Triggers existem
SELECT tgname, tgrelid::regclass FROM pg_trigger
  WHERE NOT tgisinternal
  AND tgrelid IN ('"Project"'::regclass, '"Task"'::regclass);

-- Project tem novos campos?
\d "Project"
SELECT id, "referenceKey", "definitionOfDone", "useStoryHierarchy" FROM "Project" LIMIT 3;
-- referenceKey deve estar NULL, definitionOfDone deve estar [], useStoryHierarchy deve estar false

-- Task tem novos campos?
\d "Task"
SELECT id, "userStoryId", "area", "doneAt" FROM "Task" LIMIT 3;
-- todos NULL ainda

-- Trigger seed funciona? (NÃO testar agora — trigger só dispara em Project novo;
-- testar criando 1 project teste e dropando depois, se necessário)
```

Todas as queries devem retornar resultados positivos. Se alguma falha, rollback (ver abaixo).

### Output esperado

```
supabase/migrations/<date>_project_reference_key_and_dod.sql   ← novo
supabase/migrations/<date>_project_persona.sql                  ← novo
supabase/migrations/<date>_module.sql                           ← novo
supabase/migrations/<date>_user_story.sql                       ← novo
supabase/migrations/<date>_acceptance_criterion.sql             ← novo
supabase/migrations/<date>_task_extensions.sql                  ← novo
supabase/migrations/<date>_user_story_overview_view.sql         ← novo
src/lib/supabase/database.types.ts                              ← modificado (regen)
docs/_runbook-snapshots/wave-1-post-state.txt                   ← novo
```

1 commit.

### Se falhar

Rollback SQL (rodar **na ordem inversa**):

```sql
DROP VIEW IF EXISTS user_story_overview;

DROP TRIGGER IF EXISTS task_done_at_trigger ON "Task";
DROP FUNCTION IF EXISTS sync_task_done_at();
ALTER TABLE "Task"
  DROP COLUMN IF EXISTS "userStoryId",
  DROP COLUMN IF EXISTS "area",
  DROP COLUMN IF EXISTS "doneAt";

DROP TABLE IF EXISTS "AcceptanceCriterion";
DROP FUNCTION IF EXISTS next_user_story_reference(uuid);
DROP TABLE IF EXISTS "UserStory";
DROP TABLE IF EXISTS "Module";

DROP TRIGGER IF EXISTS project_seed_personas_trigger ON "Project";
DROP FUNCTION IF EXISTS seed_project_personas();
DROP TABLE IF EXISTS "ProjectPersona";

ALTER TABLE "Project"
  DROP COLUMN IF EXISTS "referenceKey",
  DROP COLUMN IF EXISTS "definitionOfDone",
  DROP COLUMN IF EXISTS "useStoryHierarchy";
```

Salvar como `supabase/migrations/_rollback-wave-1.sql` antes de rodar Wave 1.

### Bloqueadores humanos

- Confirmar staging-first ou prod direto.
- Aprovar janela de execução (off-hours em prod).

---

## Wave 2 — RLS policies

**Objetivo:** habilitar RLS nas tabelas novas e criar policies usando os helpers existentes do projeto.
**Pré-requisitos:** Wave 1 concluída.
**Tempo estimado:** 1-2h
**Pode rodar em paralelo com:** Wave 3 (DAL não depende de RLS pra compilar; mas testar DAL precisa de RLS).

### Antes de começar
- [ ] Confirmar nomes dos helpers via `grep -n "CREATE OR REPLACE FUNCTION public" supabase/migrations/20260427_project_access.sql supabase/migrations/20260423_member_roles_access.sql`. Devem aparecer: `is_manager`, `can_view_project`, `can_edit_tasks`, `is_allocated_to`.

### Ações

1. **Criar migration `supabase/migrations/<date>_story_hierarchy_rls.sql`** — conteúdo §3.2 do migration plan (todas as 4 sub-seções: Module/Persona, UserStory, AcceptanceCriterion).

2. **Rodar:**
   ```bash
   source <(grep '^DIRECT_URL=' .env | sed 's/^/export /')
   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/<date>_story_hierarchy_rls.sql
   ```

3. **Smoke test com user real** (parar e pedir ajuda do PM/builder pra logar no app):
   - PM logado consegue criar Module via SQL `INSERT INTO "Module"...` num projeto ativo? **Sim**.
   - Builder logado consegue? **Não** (esperado).
   - Builder logado lê Module via `SELECT * FROM "Module" WHERE projectId = ?`? **Sim**.
   - Membro de outro projeto não-alocado: ambos falham.

4. **Commit:**
   ```bash
   bash scripts/sync-main.sh -m "ZRD-JM-NN: RLS pra Module/Persona/UserStory/AC"
   ```

### Validação

```sql
-- RLS habilitada?
SELECT tablename, rowsecurity FROM pg_tables
  WHERE schemaname = 'public'
  AND tablename IN ('Module', 'ProjectPersona', 'UserStory', 'AcceptanceCriterion');
-- Todas devem ter rowsecurity = true

-- Policies existem?
SELECT tablename, policyname, cmd FROM pg_policies
  WHERE schemaname = 'public'
  AND tablename IN ('Module', 'ProjectPersona', 'UserStory', 'AcceptanceCriterion')
  ORDER BY tablename, cmd;
```

Smoke test humano — checklist em §3.2.5 do migration plan.

### Output esperado

```
supabase/migrations/<date>_story_hierarchy_rls.sql   ← novo
```

1 commit.

### Se falhar

```sql
ALTER TABLE "Module"              DISABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectPersona"      DISABLE ROW LEVEL SECURITY;
ALTER TABLE "UserStory"           DISABLE ROW LEVEL SECURITY;
ALTER TABLE "AcceptanceCriterion" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "module_select" ON "Module";
DROP POLICY IF EXISTS "module_write"  ON "Module";
DROP POLICY IF EXISTS "persona_select" ON "ProjectPersona";
DROP POLICY IF EXISTS "persona_write"  ON "ProjectPersona";
DROP POLICY IF EXISTS "story_select"  ON "UserStory";
DROP POLICY IF EXISTS "story_insert"  ON "UserStory";
DROP POLICY IF EXISTS "story_update"  ON "UserStory";
DROP POLICY IF EXISTS "story_delete"  ON "UserStory";
DROP POLICY IF EXISTS "ac_select" ON "AcceptanceCriterion";
DROP POLICY IF EXISTS "ac_write"  ON "AcceptanceCriterion";
```

### Bloqueadores humanos

- Smoke test em §3 da Wave precisa de PM real ou builder real logado. Se não disponível, pular validação humana mas marcar TODO.

---

## Wave 3 — DAL helpers

**Objetivo:** centralizar acesso ao DB pra story-hierarchy num módulo TS reusável por server components e route handlers.
**Pré-requisitos:** Wave 1 concluída (types regenerados). Wave 2 recomendada mas não obrigatória.
**Tempo estimado:** 2-3h
**Pode rodar em paralelo com:** Wave 2.

### Antes de começar
- [ ] `bunx tsc --noEmit` passa (Wave 1 deixou typecheck limpo).
- [ ] Pasta `src/lib/dal/` não existe — criar.

### Ações

1. **Criar arquivo `src/lib/dal/story-hierarchy.ts`** — implementar conforme §4 do migration plan. Funções essenciais:
   - `getModulesForProject(projectId)`
   - `getPersonasForProject(projectId)`
   - `getStoriesForProject(projectId, filter?)`
   - `getStoryWithFullDetail(storyRef)`
   - `getRecentStoriesForProject(projectId, { limit })`  ← **adicionar**, usado pelo Alpha
   - `nextUserStoryReference(projectId)`
   - `createStory(input)` — atomic via RPC ou múltiplos inserts
   - `approveProposedModule(storyId, proposedName, projectId)`
   - `validateStoryAc(storyId, memberId)`
   - `setStoryRefinement(storyId, status)`
   - `toggleAcCheck(acId, memberId, checked)`
   - `setTaskUserStory(taskId, userStoryId | null)`

2. **Padrão pra cada função:**
   - Usar `createClient()` de `@/lib/supabase/server` (RLS aplicada via auth context)
   - Retornar dados tipados (`Database["public"]["Tables"]["..."]["Row"]`)
   - Errors via `throw` (caller trata)
   - Sem catch silencioso

3. **Validar typecheck:** `bunx tsc --noEmit` passa.

4. **(Opcional) Unit tests** — se o projeto tem padrão de testes, adicionar 3-5 tests dos helpers críticos. Caso contrário, pular.

5. **Commit:**
   ```bash
   bash scripts/sync-main.sh -m "ZRD-JM-NN: DAL pra story-hierarchy"
   ```

### Validação

- [ ] Typecheck OK.
- [ ] (Manual) Importar 1 helper em uma route handler de teste e chamar via curl — confirmar que retorna dados.

### Output esperado

```
src/lib/dal/story-hierarchy.ts   ← novo
```

1 commit.

### Se falhar

`git revert` do commit. DAL é só TS, nada no banco.

### Bloqueadores humanos

- Decisão sobre `createStory` atomic: usar RPC ou múltiplos inserts? **Recomendação:** múltiplos inserts agora (sem RPC); RPC vem na Wave 6 (Alpha). Wave 3 fica simples.

---

## Wave 4 — API route handlers

**Objetivo:** expor a hierarquia via REST pra UI consumir.
**Pré-requisitos:** Wave 3 concluída.
**Tempo estimado:** 4-6h
**Pode rodar em paralelo com:** —

### Antes de começar
- [ ] Conferir padrão dos handlers existentes em `src/app/api/projects/[id]/route.ts` pra seguir convenção (Zod input, response shape, error handling).

### Ações

Criar 14 arquivos `route.ts` conforme §5.1 do migration plan. Lista exata:

```
src/app/api/projects/[id]/modules/route.ts          GET, POST
src/app/api/projects/[id]/modules/[modId]/route.ts  PATCH, DELETE
src/app/api/projects/[id]/personas/route.ts         GET, POST
src/app/api/projects/[id]/personas/[perId]/route.ts PATCH, DELETE
src/app/api/projects/[id]/stories/route.ts          GET, POST
src/app/api/projects/[id]/dod/route.ts              PATCH
src/app/api/stories/[ref]/route.ts                  GET, PATCH, DELETE
src/app/api/stories/[ref]/approve-module/route.ts   POST
src/app/api/stories/[ref]/validate-ac/route.ts      POST
src/app/api/stories/[ref]/refinement/route.ts       PATCH
src/app/api/stories/[ref]/acceptance/route.ts       GET, POST
src/app/api/stories/[ref]/acceptance/[acId]/route.ts PATCH, DELETE
src/app/api/tasks/[id]/acceptance/route.ts          GET, POST
src/app/api/tasks/[id]/acceptance/[acId]/route.ts   PATCH, DELETE
src/app/api/tasks/[id]/move-to-story/route.ts       POST
```

Pra cada handler:

1. **Importar** DAL helpers + Zod + `NextResponse`.
2. **Definir Zod schema** pro body (POST/PATCH).
3. **Validar** auth (member está autenticado?).
4. **Verificar** acesso (`is_manager` ou `can_view/edit_X`) — passa via DAL e RLS.
5. **Chamar** DAL helper.
6. **Retornar** JSON tipado.

**Endpoint especial:** `validate-ac` exige `is_manager` na camada de aplicação (RLS não tem column-level — ver §3.2.5 do migration plan):
```ts
// /api/stories/[ref]/validate-ac/route.ts
const member = await getCurrentMember();
if (!hasMinLevel(member.role, MANAGER)) {
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}
await validateStoryAc(story.id, member.id);
```

Após cada handler:
- `bunx tsc --noEmit` passa
- (idealmente) testar via curl

Commit final da wave:
```bash
bash scripts/sync-main.sh -m "ZRD-JM-NN: API endpoints story-hierarchy"
```

### Validação

```bash
# Smoke test (com cookie auth de PM):
curl -X GET http://localhost:3333/api/projects/<UUID>/modules \
  -H "Cookie: <session>"
# Deve retornar []

curl -X POST http://localhost:3333/api/projects/<UUID>/modules \
  -H "Cookie: <session>" \
  -H "Content-Type: application/json" \
  -d '{"name":"TEST","description":"smoke test"}'
# Deve retornar 201 + module criado

curl -X DELETE http://localhost:3333/api/projects/<UUID>/modules/<MOD_UUID>
# 204
```

Repetir mínimo 3 endpoints diferentes (criar/listar/deletar de módulo, persona, story).

### Output esperado

```
src/app/api/projects/[id]/modules/...      ← 2 routes
src/app/api/projects/[id]/personas/...     ← 2 routes
src/app/api/projects/[id]/stories/...      ← 1 route (parent only)
src/app/api/projects/[id]/dod/route.ts     ← 1 route
src/app/api/stories/[ref]/...              ← 6 routes
src/app/api/tasks/[id]/...                 ← 2 routes (acceptance + move-to-story)
```

1 commit.

### Se falhar

`git revert` do commit. Sem efeito no banco.

### Bloqueadores humanos

- Se algum endpoint precisar de auth diferente do padrão (ex: webhook), parar e perguntar.

---

## Wave 5 — Page real + feature flag

**Objetivo:** substituir tabs antigas (Sprints, Schedule, Tasks legacy) na page de projeto pelas novas, atrás do flag `useStoryHierarchy`.
**Pré-requisitos:** Wave 4 concluída.
**Tempo estimado:** 4-6h
**Pode rodar em paralelo com:** Wave 6 (Alpha não depende da page nova).

### Antes de começar
- [ ] Ler `src/app/(dashboard)/projects/[id]/page.tsx` (1536 linhas) — entender tabs existentes.
- [ ] Ler `src/app/(dashboard)/dev/stories/page.tsx` — entender padrão da page nova.
- [ ] Confirmar imports: componentes vivem em `src/components/story-hierarchy/` e `src/components/sprint/` — **não copiar, importar.**

### Ações

1. **Editar `src/app/(dashboard)/projects/[id]/page.tsx`:**

   a. Adicionar import dos componentes novos:
      ```tsx
      import {
        StoriesList,
        StorySheet,
        TasksList as NewTasksList,
        TaskSheet as NewTaskSheet,
        SettingsPanel,
        ModuleDialog,
        PersonaDialog,
      } from "@/components/story-hierarchy";
      import {
        SprintNavigator,
        SprintDetail,
        SprintTimeline,
        SprintSummaryStats,
        findCurrentSprint,
        projectStats,
      } from "@/components/sprint";
      ```

   b. Adicionar fetch de novos dados via DAL (em useEffect ou Server Component layer):
      - modules, personas, stories, tasks com `userStoryId`, sprints + capacities.

   c. Definir novo `tabs[]` condicionado a `project.useStoryHierarchy`:
      ```tsx
      const tabs = project.useStoryHierarchy ? V2_TABS : LEGACY_TABS;
      ```

   d. Pra cada tab nova, importar componente e passar dados via props (espelha page do `/dev/stories/page.tsx`).

   e. Manter tabs antigas (Schedule, SprintsTab, TasksTab) **intactas** na branch LEGACY — usuários sem flag continuam usando.

2. **Atualizar layout/sidebar se necessário** — geralmente sem mudança.

3. **Smoke test em projeto real:**
   - Criar projeto-teste em staging (ou usar projeto piloto).
   - `UPDATE Project SET useStoryHierarchy = true, referenceKey = 'TST', definitionOfDone = '["test"]'::jsonb WHERE id = ?`
   - Acessar `/projects/<id>` — todas as 7 tabs aparecem.
   - Criar 1 module via Settings tab.
   - Criar 1 story via Stories tab (mesmo sem Alpha — manualmente).
   - Validar AC, mudar refinement, mover entre módulos.
   - Voltar `useStoryHierarchy = false` — vê tabs antigas funcionando.

4. **Commit:**
   ```bash
   bash scripts/sync-main.sh -m "ZRD-JM-NN: page real consome story-hierarchy atrás de flag"
   ```

### Validação

- [ ] Smoke test acima passa em ambos os modos (flag ON e OFF).
- [ ] Console sem erros em qualquer tab.
- [ ] Mobile (chrome devtools / iPhone): layouts respondem (componentes do sandbox já são responsivos).

### Output esperado

```
src/app/(dashboard)/projects/[id]/page.tsx   ← modificado, ainda contém código legacy
```

1 commit.

### Se falhar

- `git revert`. Página volta ao legacy.
- Banco não é afetado.

### Bloqueadores humanos

- Antes de habilitar pra qualquer projeto real (não-teste), **PM deve aprovar** após tour humano.

---

## Wave 6 — Alpha integration (paralela)

**Objetivo:** habilitar Alpha pra gerar UserStories + Tasks + AC respeitando taxonomia do projeto.
**Pré-requisitos:** Wave 4 concluída (API funcional). Pode rodar antes ou depois da Wave 5.
**Tempo estimado:** 5-8h
**Pode rodar em paralelo com:** Wave 5.

### Antes de começar
- [ ] Ler `docs/story-hierarchy-alpha-integration.md` inteiro.
- [ ] Localizar arquivos do Alpha no codebase (`src/lib/agent/alpha/` ou similar). Se nomenclatura mudou, ajustar.

### Ações

1. **Migration `supabase/migrations/<date>_alpha_rpc.sql`:**
   - Função `suggest_fp(scope, complexity)` — espelha matriz TS, IMMUTABLE.
   - Função `create_user_story_with_tasks(p_project_id, p_input, p_created_by, p_by_agent)` — atomic insert de Story + AC + Tasks + AC tasks.

   Conteúdo SQL completo em §5.1 do alpha-integration doc.

   ```bash
   psql "$DIRECT_URL" -f supabase/migrations/<date>_alpha_rpc.sql
   ```

2. **Adicionar Zod schemas** em `src/lib/agent/alpha/output-schemas.ts` — conforme §3 do alpha doc.

3. **Adicionar persistência** em `src/lib/agent/alpha/persist-stories.ts` — conforme §5.2.

4. **Atualizar contexto do prompt** — adicionar `modules`, `personas`, `recentStories` ao payload que entra no Alpha. Onde editar: depende da arquitetura atual (procurar onde o Alpha é invocado).

5. **Atualizar system prompt** com regras de §4 do alpha doc. Localização: `alpha-definition` ou similar.

6. **Respeitar feature flag:**
   ```ts
   const project = await getProject(projectId);
   if (!project.useStoryHierarchy) {
     return createTasksLegacy(...);  // path antigo
   }
   return persistAlphaStories(...);
   ```

7. **Calibração** — rodar 5 cenários de §6 do alpha doc:
   - Cenário 1: feature simples → 1 story 1 module
   - Cenário 2: feature complexa → 1 story múltiplas tasks
   - Cenário 3: módulo novo → proposedModuleName
   - Cenário 4: chat de status → não cria
   - Cenário 5: input ambíguo → pergunta antes

   Cada um 3× pra consistência. Documentar em `docs/alpha-calibration-results.md`.

8. **Commit (em 2-3 commits separados se possível pra rastreabilidade):**
   ```bash
   bash scripts/sync-main.sh -m "ZRD-JM-NN: Alpha — RPC create_user_story_with_tasks"
   bash scripts/sync-main.sh -m "ZRD-JM-NN: Alpha — Zod output schema + persistência"
   bash scripts/sync-main.sh -m "ZRD-JM-NN: Alpha — system prompt + contexto"
   ```

### Validação

- [ ] Função RPC roda: `SELECT * FROM create_user_story_with_tasks(?, ?, ?, true);` com payload exemplo.
- [ ] Calibração: 5/5 cenários produzem output esperado em ≥ 90% das execuções.
- [ ] PM revisou amostra e aprovou.

### Output esperado

```
supabase/migrations/<date>_alpha_rpc.sql                ← novo
src/lib/agent/alpha/output-schemas.ts                   ← novo
src/lib/agent/alpha/persist-stories.ts                  ← novo
src/lib/agent/alpha/system-prompt.ts (ou onde estiver)  ← modificado
docs/alpha-calibration-results.md                       ← seção atualizada
```

3 commits.

### Se falhar

- Migration: rollback `DROP FUNCTION create_user_story_with_tasks; DROP FUNCTION suggest_fp;`
- Code: `git revert` dos commits.
- Calibração: parar antes de habilitar pro time real. Iterar prompt.

### Bloqueadores humanos

- PM precisa revisar saídas da calibração e aprovar.

---

## Wave 7 — Backfill: infra

**Objetivo:** preparar tudo pra rodar backfill por projeto (sem rodar ainda).
**Pré-requisitos:** Wave 4 concluída (DAL + API existem pros scripts usarem).
**Tempo estimado:** 3-4h
**Pode rodar em paralelo com:** Wave 5 ou 6.

### Antes de começar
- [ ] Ler `docs/story-hierarchy-backfill.md` inteiro.

### Ações

1. **Criar migration `supabase/migrations/<date>_backfill_run.sql`** — conteúdo §1.2 do backfill doc.

   ```bash
   psql "$DIRECT_URL" -f supabase/migrations/<date>_backfill_run.sql
   ```

2. **Gerar inventário inicial:**
   ```bash
   psql "$DIRECT_URL" -f scripts/backfill/inventory.sql > docs/_backfill-snapshots/inventory-$(date +%Y%m%d).csv
   ```
   (criar `scripts/backfill/inventory.sql` com a query de §1.1)

3. **Criar diretório `scripts/backfill/`** com 9 scripts numerados (§1.4 do backfill doc):
   ```
   scripts/backfill/
   ├── 01-define-reference-keys.ts
   ├── 02-seed-personas.ts
   ├── 03-seed-default-dod.ts
   ├── 04-define-modules.ts
   ├── 05-classify-tasks.ts
   ├── 06-create-stories-from-tasks.ts
   ├── 07-migrate-ac-text-to-rows.ts
   ├── 08-backfill-task-done-at.ts
   ├── 09-classify-task-area.ts
   └── 99-flip-flag.ts
   ```

   Cada script:
   - Aceita `--project-id <uuid>` obrigatório
   - Aceita `--dry-run` opcional
   - Insere `BackfillRun` no início, atualiza no fim
   - `bun scripts/backfill/<file>.ts ...` é o invocação padrão

   **Implementar agora** apenas os scripts 01-03 + 07-08 (mais simples, idempotentes, baixo risco). Os demais (04, 05, 06, 09) implementar quando forem rodar de verdade — eles têm interação Alpha + PM e podem mudar.

4. **Backup automation** — criar `scripts/backfill/backup-project.sh`:
   ```bash
   #!/bin/bash
   set -e
   PROJECT_ID="$1"
   if [ -z "$PROJECT_ID" ]; then echo "Usage: $0 <project-id>"; exit 1; fi
   mkdir -p backups
   pg_dump "$DIRECT_URL" \
     --table='"Project"' --table='"Task"' --table='"TaskAssignment"' \
     --table='"Module"' --table='"UserStory"' --table='"AcceptanceCriterion"' \
     --table='"ProjectPersona"' \
     --data-only \
     --where='"projectId" = '"'"'$PROJECT_ID'"'"' \
     > "backups/project-${PROJECT_ID}-pre-backfill-$(date +%Y%m%d-%H%M).sql"
   echo "Backup salvo em backups/"
   ```

5. **Commit:**
   ```bash
   bash scripts/sync-main.sh -m "ZRD-JM-NN: backfill infra — BackfillRun + scripts 01/02/03/07/08"
   ```

### Validação

```sql
-- BackfillRun existe?
\d "BackfillRun"
SELECT COUNT(*) FROM "BackfillRun";  -- 0 esperado
```

```bash
# Scripts existem e respondem ao --help
bun scripts/backfill/01-define-reference-keys.ts --help

# Inventário gerado?
ls -la docs/_backfill-snapshots/
```

### Output esperado

```
supabase/migrations/<date>_backfill_run.sql        ← novo
docs/_backfill-snapshots/inventory-<date>.csv      ← novo
scripts/backfill/inventory.sql                     ← novo
scripts/backfill/01-define-reference-keys.ts       ← novo
scripts/backfill/02-seed-personas.ts               ← novo
scripts/backfill/03-seed-default-dod.ts            ← novo
scripts/backfill/07-migrate-ac-text-to-rows.ts     ← novo
scripts/backfill/08-backfill-task-done-at.ts       ← novo
scripts/backfill/backup-project.sh                 ← novo
```

1 commit.

### Se falhar

- Migration: `DROP TABLE "BackfillRun";`
- Scripts: `git revert`

### Bloqueadores humanos

- Decisão sobre **escopo do inventário**: backfillamos `archived` projects? Recomendação **não**.
- Quem **aprova taxonomia** de modules pra backfill (PM exclusivo ou pode ser CRO/Head Ops)?

---

## Wave 8 — Backfill: projeto-piloto

**Objetivo:** rodar backfill completo em **1 projeto** (escolhido por baixo risco) e validar antes de processar todos.
**Pré-requisitos:** Wave 7 concluída.
**Tempo estimado:** 2-4h por projeto-piloto (varia com tamanho).
**Pode rodar em paralelo com:** —

### Antes de começar
- [ ] Inventário (Wave 7) revisado pelo time.
- [ ] **PM escolheu projeto-piloto.** Sugestão: projeto `completed` ou `paused` com volume baixo (< 30 tasks). **Não escolher CRM ou projeto crítico de cliente** pra primeiro.
- [ ] PM definiu `referenceKey` desse projeto.
- [ ] PM definiu lista inicial de modules (YAML em `backfill-input/<key>-modules.yaml`).

### Ações

Para o projeto X escolhido:

1. **Backup:**
   ```bash
   bash scripts/backfill/backup-project.sh <project-uuid>
   ```

2. **Step 01 — referenceKey:**
   ```bash
   bun scripts/backfill/01-define-reference-keys.ts --project-id <uuid>
   # Interativo: pede o key. Se PM já decidiu, aceitar.
   ```

3. **Step 02 — personas:**
   ```bash
   bun scripts/backfill/02-seed-personas.ts --project-id <uuid>
   ```

4. **Step 03 — DoD:**
   ```bash
   bun scripts/backfill/03-seed-default-dod.ts --project-id <uuid>
   ```

5. **Step 04 — modules:**
   - Implementar agora se não foi feito na Wave 7.
   - Aplicar YAML do PM:
     ```bash
     bun scripts/backfill/04-define-modules.ts --project-id <uuid> --apply backfill-input/<key>-modules.yaml
     ```

6. **Decidir estratégia tasks órfãs:** baseado em §8 do backfill doc.

   **Se A (LEGACY placeholder)** — só pra completed sprints:
   ```bash
   bun scripts/backfill/06-create-stories-from-tasks.ts --project-id <uuid> --strategy=legacy
   ```

   **Se C (Alpha clustering)** — implementar 05 + 06 + revisão PM:
   ```bash
   bun scripts/backfill/05-classify-tasks.ts --project-id <uuid> --output backfill-input/<key>-classification.csv
   # PM revisa CSV
   bun scripts/backfill/06-create-stories-from-tasks.ts --project-id <uuid> --strategy=classified --input backfill-input/<key>-classification.csv
   ```

7. **Step 07 — AC text → rows:**
   ```bash
   bun scripts/backfill/07-migrate-ac-text-to-rows.ts --project-id <uuid>
   ```

8. **Step 08 — doneAt:**
   ```bash
   bun scripts/backfill/08-backfill-task-done-at.ts --project-id <uuid>
   ```

9. **Step 09 — area:**
   ```bash
   bun scripts/backfill/09-classify-task-area.ts --project-id <uuid> --output backfill-input/<key>-area.csv
   # PM revisa amostra de 20
   bun scripts/backfill/09-classify-task-area.ts --project-id <uuid> --apply backfill-input/<key>-area.csv
   ```

10. **Validação SQL** (§4 do backfill doc):
    ```bash
    psql "$DIRECT_URL" -v project_id="'<uuid>'" -f scripts/backfill/check-backfill.sql
    ```
    Todas as 6 checks devem retornar `ok`. Check 7 (area null) é warning.

11. **Tour humano** em staging (§5 do backfill doc):
    ```bash
    # Em staging, com user PM logado
    UPDATE Project SET useStoryHierarchy = true WHERE id = <uuid>;
    ```
    PM acessa `/projects/<id>`, valida 5 itens do checklist.

12. **Flip flag:**
    ```bash
    bun scripts/backfill/99-flip-flag.ts --project-id <uuid>
    ```

13. **Monitorar 48h** — sem erros 500 em `/api/stories/*` referentes ao projeto.

14. **Documentar** o run em `docs/_backfill-snapshots/<key>-<date>.md`:
    - Estratégia escolhida
    - Pequenos problemas e como contornados
    - Tempo total
    - Output das checks

### Validação

§4 do backfill doc — 6 checks SQL `ok`. Plus PM aprovou tour.

### Output esperado

```
backups/project-<id>-pre-backfill-...sql              ← novo
backfill-input/<key>-modules.yaml                     ← novo
backfill-input/<key>-classification.csv (opcional)    ← novo
backfill-input/<key>-area.csv                         ← novo
docs/_backfill-snapshots/<key>-<date>.md              ← novo
```

Plus mudanças no banco (no commit).

Sem commit de código geralmente — só docs e snapshots. Se houve fix de scripts da Wave 7, commit junto.

### Se falhar

§7 do backfill doc — restore from backup é a estratégia recomendada.

```bash
psql "$DIRECT_URL" < backups/project-<id>-pre-backfill-<date>.sql
```

### Bloqueadores humanos

- **Toda decisão de estratégia** (A vs B vs C vs D) pra tasks órfãs.
- **PM revisa CSVs** de classification (Step 05) e area (Step 09).
- **PM faz tour** e aprova flip.

---

## Wave 9 — Backfill: outros projetos

**Objetivo:** repetir Wave 8 pra cada projeto restante.
**Pré-requisitos:** Wave 8 concluída + lições aprendidas documentadas.
**Tempo estimado:** 1-4h por projeto, total varia. Estimar com humano baseado no inventário.
**Pode rodar em paralelo com:** —

### Antes de começar
- [ ] Inventário revisto e priorizado: ordem `completed` (rápido) → `active small` → `active large`.
- [ ] Lições da Wave 8 incorporadas (ajustes em scripts, melhorias no fluxo).
- [ ] PM disponível pra decisões em cada projeto `active`.

### Ações

Pra cada projeto da fila:

1. Repetir os 14 passos da Wave 8.
2. Documentar o run em `docs/_backfill-snapshots/<key>-<date>.md`.
3. Atualizar planilha mestre `docs/_backfill-snapshots/_progress.md`:
   ```
   | Projeto | Status      | Estratégia | Data    | Tempo | Notas    |
   | CRM     | done        | C+A        | 05/12   | 3h    | tudo OK  |
   | MKE     | in_progress | C          | 05/15   | -     | ...      |
   | LOGI    | pending     | -          | -       | -     | -        |
   ```

### Validação

Após cada projeto: §4 do backfill doc passa.
Cumulativo: `SELECT COUNT(*) FROM "Project" WHERE "useStoryHierarchy" = false AND status != 'archived';`

### Output esperado

Per projeto: similar à Wave 8.

### Se falhar

Per projeto: restore from backup. Continue com os outros.

### Bloqueadores humanos

- Continuação da Wave 9 quando 1 projeto falha — humano decide se segue ou para tudo.
- Disponibilidade de PMs.

---

## Wave 10 — Cleanup

**Objetivo:** remover colunas deprecated e código legacy.
**Pré-requisitos:** **TODOS** os projetos ativos com `useStoryHierarchy = true`.
**Tempo estimado:** 2-3h
**Pode rodar em paralelo com:** —

### Antes de começar
- [ ] Pré-check obrigatório:
  ```sql
  SELECT COUNT(*) FROM "Project"
    WHERE "useStoryHierarchy" = false
    AND status NOT IN ('archived');
  -- DEVE retornar 0
  ```
- [ ] **Backup completo do DB** (não só per projeto).
- [ ] Confirmar que **zero código** lê `Task.acceptanceCriteria` (text), `Task.type`, `Task.scope`:
  ```bash
  grep -rn '"acceptanceCriteria"\b' src/ | grep -v "AcceptanceCriterion" | grep -v "story-hierarchy"
  grep -rn '\.acceptanceCriteria\b' src/ | grep -v "AcceptanceCriterion" | grep -v "story-hierarchy"
  grep -rn 'task\.type\b\|"type":\s*' src/ | grep -i "task" | head -20
  grep -rn 'task\.scope\b\|"scope":\s*' src/ | grep -i "task" | head -20
  ```
  Resultado deve ser **vazio** ou apenas em arquivos legacy a serem deletados.

### Ações

1. **Migration `supabase/migrations/<date>_drop_deprecated_task_columns.sql`:**
   ```sql
   ALTER TABLE "Task"
     DROP COLUMN "acceptanceCriteria",  -- text legado
     DROP COLUMN "type",
     DROP COLUMN "scope";

   -- Pode também drop o flag pra forçar 100% do novo
   ALTER TABLE "Project"
     DROP COLUMN "useStoryHierarchy";
   ```

   **Atenção:** essa migration é **irreversível**. Tem certeza? Pré-check tem que passar 100%.

   ```bash
   psql "$DIRECT_URL" -f supabase/migrations/<date>_drop_deprecated_task_columns.sql
   ```

2. **Regen types:**
   ```bash
   bunx supabase gen types typescript ... > src/lib/supabase/database.types.ts
   ```

3. **Remover código legacy:**
   - `src/app/(dashboard)/projects/[id]/page.tsx` — apagar `OverviewTab`, `ScheduleTab`, `SprintsTab`, `TasksTab` antigos. Deixar apenas o caminho V2.
   - `src/components/task-sheet.tsx` (legacy) — apagar se ninguém mais usa. Verificar com `grep -rn "TaskSheet"` e ver se todos os imports vêm de `@/components/story-hierarchy`.
   - `src/components/task-list.tsx` (legacy) — idem.
   - `src/app/api/projects/[id]/schedule/` — apagar (cronograma deletado).

4. **Remover sandbox:**
   - `src/app/(dashboard)/dev/stories/` — opcional. Se virar de fato a versão definitiva, sandbox pode ficar como playground. Recomendo manter — útil pra testar componentes em isolamento.

5. **Typecheck final:** `bunx tsc --noEmit` sem erros.

6. **Smoke test:** abrir 3-5 projetos diferentes, navegar todas as tabs.

7. **Commit (em commits separados pra rastreabilidade):**
   ```bash
   bash scripts/sync-main.sh -m "ZRD-JM-NN: drop Task.acceptanceCriteria/type/scope + useStoryHierarchy flag"
   bash scripts/sync-main.sh -m "ZRD-JM-NN: remove código legacy (Schedule/Sprints/Tasks tabs antigos)"
   ```

### Validação

```sql
-- Colunas removidas?
\d "Task"
-- Não deve listar acceptanceCriteria, type, scope

\d "Project"
-- Não deve listar useStoryHierarchy
```

```bash
bunx tsc --noEmit  # sem erros
grep -rn "useStoryHierarchy" src/  # 0 hits
grep -rn '\.acceptanceCriteria\b' src/  # 0 hits exceto AcceptanceCriterion table refs
```

### Output esperado

```
supabase/migrations/<date>_drop_deprecated_task_columns.sql   ← novo
src/lib/supabase/database.types.ts                            ← regen
src/app/(dashboard)/projects/[id]/page.tsx                    ← simplificado
[arquivos legacy apagados]
```

2 commits.

### Se falhar

**Sem rollback simples** após DROP COLUMN. Por isso o backup completo na "Antes de começar" é obrigatório.

```bash
# Última cartada — restore do backup
pg_restore --clean --dbname="$DIRECT_URL" backup-pre-cleanup.dump
```

### Bloqueadores humanos

- Confirmar com humano: "100% dos projetos migrados, prosseguir com drop irreversível?". **Não rodar sem aprovação explícita.**

---

## Visão geral consolidada

```
Wave 0 — Onboarding                      [não-código, ~2h]
   │
   ▼
Wave 1 — Schema (7 migrations)           [código, ~3h]
   │
   ├─────────────► Wave 2 — RLS           [código, ~2h]
   │                  │
   │                  ▼
   ▼               Wave 3 — DAL          [código, ~3h]
                      │
                      ▼
                   Wave 4 — API           [código, ~5h]
                      │
                      ├──► Wave 5 — Page real         [código, ~5h]
                      │       │
                      ├──► Wave 6 — Alpha             [código, ~7h]
                      │       │
                      └──► Wave 7 — Backfill infra    [código, ~3h]
                              │
                              ▼
                           Wave 8 — Backfill piloto   [exec, ~3h]
                              │
                              ▼
                           Wave 9 — Backfill outros   [exec, varia]
                              │
                              ▼
                           Wave 10 — Cleanup          [código, ~3h]
```

**Caminho crítico:** Waves 0 → 1 → 2 → 3 → 4 → 7 → 8 → 9 → 10. Wave 5 e 6 são paralelas mas devem terminar antes da Wave 8 (pra projeto-piloto ter UI nova + Alpha funcional).

**Tempo total caminho crítico:** ~30h de trabalho técnico + tempo de calibração/validação humana + tempo de backfill (varia muito por número de projetos).

**Sugestão de cronograma:**
- Semana 1: Waves 0, 1, 2, 3
- Semana 2: Waves 4, 5
- Semana 2-3: Wave 6 (paralelo)
- Semana 3: Wave 7
- Semana 3-4: Wave 8 (piloto)
- Semana 4-5: Wave 9 (rollout)
- Semana 6: Wave 10 (cleanup)

---

## Convenções pra agente novo

### O que sempre fazer

- **Antes de cada wave:** ler a seção dela inteira + dependências marcadas.
- **Antes de cada commit:** rodar `bunx tsc --noEmit` e `git status` pra revisar mudanças.
- **Após cada wave:** atualizar `docs/_runbook-snapshots/wave-N-status.md` com:
  - Data de execução
  - Tempo gasto
  - Problemas encontrados
  - Decisões humanas registradas
  - Próxima wave + bloqueadores

### O que nunca fazer

- **Pular validação** porque "tá funcionando".
- **Inventar nomes** de helpers/funções — sempre conferir os existentes.
- **Rodar Wave 10** sem confirmação explícita (irreversível).
- **Rodar backfill em produção** sem backup do projeto.
- **Avançar sem fechar bloqueadores humanos.**

### Como pedir ajuda humana

Mensagem template quando travado:

```
WAVE N PAUSADA

Tarefa: <ação que estava executando>
Esperado: <resultado esperado>
Observado: <o que aconteceu>
Decisão necessária: <opção A | opção B | outra>
Estado atual: <o que já foi feito + estado limpo ou não>
Próxima ação se aprovado: <comando exato>
Rollback se necessário: <comando exato>
```

Esperar resposta antes de tomar qualquer ação destrutiva.
