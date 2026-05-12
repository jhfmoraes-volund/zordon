# Design Session — Normalization Plan

**Status:** Planning (revisão 2 — 2026-05-11)
**Created:** 2026-05-11
**Scope:** Migrar todos os steps de Design Session de JSONB monolítico (`DesignSessionStepData.data`) para tabelas relacionais.

**Princípio inegociável:** tabela é a **única** fonte de verdade. Nada de espelhar pra `DesignSessionStepData.data` via trigger. `DesignSessionStepData` será **drop completo** ao final da Fase 3 (não apenas a coluna `data`).

---

## 1. Objetivo

Hoje 9 dos 13 stepKeys oficiais ([src/lib/design-session-steps.ts:8](src/lib/design-session-steps.ts#L8)) persistem em `DesignSessionStepData.data jsonb`. Cada PUT do client substitui o JSON inteiro do step. Os 4 restantes: `briefing` (escreve em Task/UserStory) + 3 steps CI ainda não implementados (`retrospective`, `new_demands`, `refinement`).

Queremos:
- **Organização**: 1 tabela por step (com exceções), substituindo a coluna JSONB monolítica.
- **Source-of-truth única**: tabela = verdade. JSONB sai. Sem espelhamento via trigger. Sem dual-write.
- **API estruturada**: CRUD REST por recurso, em vez de PUT replace-total.
- **Princípio "normalize on demand"**: escalares viram colunas; arrays raramente queryados isoladamente ficam em jsonb na própria tabela; arrays queryados como entidades (com filtros) viram tabela por item.

**Fora de escopo nesta fase:**
- Vitor / agent tools (será replanejado depois, isoladamente).
- Steps de CI ainda não implementados (`retrospective`, `new_demands`, `refinement`) — seguem o mesmo padrão quando forem feitos.
- `briefing` (não persiste em step_data — escreve em `Task`/`UserStory`).

**Backfill: dentro do escopo.** Ver §8.5.

---

## 2. Princípios

1. **1 tabela por step**, exceto quando o step é coleção de entidades independentes com filtros previstos — aí 1 tabela por item.
2. **Escalares viram colunas tipadas** (text, int, enum via CHECK).
3. **Arrays sempre lidos junto da row pai ficam em jsonb** na mesma tabela. Não extraem.
4. **Steps 1:N com a session** (ex: lista de personas) usam `DesignSession.id` como FK + `orderIndex` int.
5. **Steps 1:1 com a session** (ex: product_vision, scope) usam `sessionId` como PK ou UNIQUE.
6. **RLS replicado** do padrão atual: leitura via `can_access_session(sessionId)`, mutação via `can_edit_session(sessionId)` ([supabase/migrations/20260427_project_access.sql:80-96](supabase/migrations/20260427_project_access.sql#L80)).
7. **Validação Zod obrigatória** em cada nova API (reaproveitar schemas em [src/lib/agent/schemas.ts](src/lib/agent/schemas.ts)).
8. **Optimistic updates obrigatório** na UI nova — `useOptimisticCollection` em listas, `useState` direto em forms 1:1.

---

## 2-bis. SuperSession — não é entidade separada, mas dita o conjunto ativo

**Crítico:** Super Session **não tem tabela própria**. É um valor de `DesignSession.type` (`'super'`) + coluna `DesignSession.selectedSteps text[]` ([supabase/migrations/20260429_design_session_super.sql](supabase/migrations/20260429_design_session_super.sql)). Lógica em [src/lib/design-session-steps.ts:80-106](src/lib/design-session-steps.ts#L80):

- `type='inception'` → `INCEPTION_STEPS` (preset)
- `type='continuous_improvement'` → `CI_STEPS` (preset)
- `type='super'` → `getStepsFromKeys(session.selectedSteps)` — lista arbitrária dentro do `STEP_CATALOG`, sempre normalizada com `ALWAYS_FIRST=pre_work` no início e `ALWAYS_LAST=briefing` no fim. CI keys (`retrospective`, `new_demands`, `refinement`) **podem** aparecer em Super.

### Impacto no plano

1. **Schema (§3): sem mudança.** As 9 tabelas novas (mais BrainstormFeature) já estão chaveadas por `sessionId` agnóstico ao `type`. Cada session só popula as tabelas dos steps que existem nela. Tabelas de steps fora da `selectedSteps` ficam **vazias** para aquela session — comportamento desejado, não bug.

2. **APIs (§5): rejeitar writes para step ausente da sessão.** Antes de qualquer `POST`/`PATCH`/`DELETE` num step 1:N (ex: `POST /api/design-sessions/[id]/personas`), validar que `personas_journeys` está em `getStepsForSession(session).map(s => s.key)`. Resposta `409 Conflict` com `{ error: "step not in this session" }`. Helper único:

   ```ts
   // src/lib/design-session/guards.ts
   export async function assertStepInSession(sessionId: string, stepKey: string): Promise<Response | null> {
     const session = await fetchSessionTypeAndSelectedSteps(sessionId);
     const keys = getStepsForSession(session).map(s => s.key);
     if (!keys.includes(stepKey)) {
       return Response.json({ error: `step ${stepKey} não pertence a esta sessão` }, { status: 409 });
     }
     return null;
   }
   ```

   Cada rota nova chama isso após `requireSessionEditApi`. Em rotas 1:1 (`/pre-work`, `/product-vision`, etc.) o stepKey é o nome do recurso; em 1:N, idem (o "personas" route → stepKey `personas_journeys`).

3. **Wizard / página container (§6.1):** já é dinâmico via `getStepsForSession(session)`. Sem mudança aqui — a página renderiza só os componentes dos steps presentes. Tabelas vazias para steps ausentes não causam erro porque os componentes nem são montados.

4. **Briefing (§6.4) e task-generator (§6.5):** o briefing agregado e o `buildSessionContext` precisam iterar **apenas os steps presentes na session** (`getStepsForSession`), não os 9 fixos. Endpoint `GET /full` deve retornar apenas as tabelas dos steps presentes (ou retornar todas e o cliente filtra — recomendo o primeiro, evita query desnecessária):

   ```ts
   // GET /api/design-sessions/[id]/full
   const session = await fetchSession(id);
   const stepKeys = getStepsForSession(session).map(s => s.key);
   // SELECT em paralelo só nas tabelas que correspondem a stepKeys ∩ {steps com tabela}
   ```

5. **`super-session-modal.tsx`:** zero mudança de schema. UI continua chamando `POST /api/design-sessions` com `type='super'` + `selectedSteps[]`, validado por `validateSuperSteps`. A normalização não toca essa rota.

6. **Steps CI selecionáveis em Super** (`retrospective`, `new_demands`, `refinement`): mesmo estando "fora de escopo" da Fase 1 (§1), Super Session já pode incluí-los hoje via `selectedSteps`. Isso quebra? Só se a UI desses steps existir, e hoje ela **não existe** (memory + exploration confirmam). Decisão: a Fase 1 **não cria tabelas para esses 3 steps**. Se uma Super os selecionar antes deles serem implementados, o componente não renderiza (mesmo comportamento de hoje). Quando forem implementados, ganham tabela + API no mesmo PR de implementação. Documentar isso no `super-session-modal.tsx`: opcional desabilitar `retrospective`/`new_demands`/`refinement` no checklist até estarem implementados.

### Smoke test obrigatório

Após a Fase 1 e o piloto:
- Criar Super Session com 3 steps opcionais (ex: `product_vision`, `hypotheses`, `risks_gaps`).
- Confirmar que API rejeita `POST /api/design-sessions/[id]/personas` com 409.
- Confirmar que `GET /full` retorna apenas as 3 tabelas + `pre_work` + briefing target, não as 9.
- Confirmar que briefing-sheet renderiza só seções dos steps presentes.

---

## 3. Schema final — 9 tabelas novas

> Naming: PascalCase pra tabela (compat com convenção atual), camelCase pras colunas.

### 3.1 `DesignSessionPreWork` (1:1)

```sql
create table "DesignSessionPreWork" (
  "sessionId" uuid primary key references "DesignSession"(id) on delete cascade,
  files jsonb not null default '[]',
    -- [{ id, name, size, type, extractedText }]
  transcripts jsonb not null default '[]',
    -- [{ id, summary, meetingTitle, meetingStart }]
  "updatedAt" timestamp not null default now()
);
```

**Por que jsonb em files/transcripts:** sempre lidos juntos da row, sem filtro previsto, e `extractedText` pode ser grande — não vale tabela própria. Chat thread já vive em `ChatThread` separada.

---

### 3.2 `DesignSessionProductVision` (1:1)

```sql
create table "DesignSessionProductVision" (
  "sessionId" uuid primary key references "DesignSession"(id) on delete cascade,
  problem text not null default '',
  "whoSuffers" text not null default '',
  consequences text not null default '',
  "successVision" text not null default '',
  "impactMetrics" text not null default '',
  "updatedAt" timestamp not null default now()
);
```

**100% escalar. Zero jsonb.**

---

### 3.3 `DesignSessionScope` (1:1)

```sql
create table "DesignSessionScope" (
  "sessionId" uuid primary key references "DesignSession"(id) on delete cascade,
  "is" jsonb not null default '[]',         -- [{ id, text }]
  "isNot" jsonb not null default '[]',
  "does" jsonb not null default '[]',
  "doesNot" jsonb not null default '[]',
  "updatedAt" timestamp not null default now()
);
```

**Por que jsonb e não 1 tabela discriminada:** items de scope são curtos, sempre exibidos juntos no PostItBoard. Não há filtro nem agregação. Manter inline simplifica drasticamente CRUD e UI.

> Nota: `is` é palavra reservada em SQL — exige aspas duplas sempre. Se virar problema, renomear pra `inScope` na coluna (mantém JSON shape via mapeamento no API layer).

---

### 3.4 `DesignSessionPersona` (1:N por session)

```sql
create table "DesignSessionPersona" (
  id text primary key,
  "sessionId" uuid not null references "DesignSession"(id) on delete cascade,
  name text not null default '',
  role text not null default '',
  context text not null default '',
  "asIsSteps" jsonb not null default '[]',   -- [{ id, description, painOrGain }]
  "toBeSteps" jsonb not null default '[]',
  "orderIndex" int not null default 0,
  "createdAt" timestamp not null default now(),
  "updatedAt" timestamp not null default now()
);

create index on "DesignSessionPersona"("sessionId", "orderIndex");
```

**Por que jsonb em journeys:** journeys são detalhe da persona, sempre lidos junto. Ninguém consulta "todos os journey steps do projeto". Se um dia precisar, extrai.

---

### 3.5 `DesignSessionBrainstormFeature` (1:N por session — JÁ EXISTE)

Mantém estrutura. Ver [supabase/migrations/20260508_brainstorm_feature_table.sql](supabase/migrations/20260508_brainstorm_feature_table.sql).

**Mudanças nesta fase (inverter a fonte de verdade):**
1. **Remover ambos os triggers** que espelham do JSON: `sync_brainstorm_features_trigger` (do step `brainstorm`) **e** `sync_brainstorm_buckets_trigger` (do step `prioritization`). Os dois mexem nesta tabela hoje — não dá pra remover um sem o outro, senão `bucket` fica sendo sobrescrito pelo trigger de prioritization durante a transição.
2. **Adicionar RLS retroativa** (§4.2 — a tabela foi criada sem `enable row level security`).
3. UI passa a escrever **direto na tabela** via novas APIs. Zero leitura de `DesignSessionStepData.data` para brainstorm.

Como brainstorm e prioritization compartilhavam essa tabela via triggers, **a migração dos dois steps precisa ir junta** (mesmo PR, mesma branch).

---

### 3.6 `DesignSessionRiskGap` (1:1)

```sql
create table "DesignSessionRiskGap" (
  "sessionId" uuid primary key references "DesignSession"(id) on delete cascade,
  risks jsonb not null default '[]',
    -- [{ id, text, category, severity, relatedFeature?, mitigation? }]
  gaps jsonb not null default '[]',
    -- [{ id, text, category?, severity?, relatedFeature?, mitigation? }]
  "updatedAt" timestamp not null default now()
);
```

**Por que jsonb:** risks/gaps são curtos, sempre exibidos juntos no board. Filtros (severity, category) podem ser feitos client-side ou via jsonb GIN se necessário.

> Alternativa caso queira granularidade: 2 tabelas (`DesignSessionRisk`, `DesignSessionGap`). Princípio "normalize on demand" diz pra deixar jsonb por ora.

---

### 3.7 `DesignSessionPriorityItem` (1:N por session) — **exceção: 1 tabela por item**

```sql
create table "DesignSessionPriorityItem" (
  id text primary key,
  "sessionId" uuid not null references "DesignSession"(id) on delete cascade,
  title text not null default '',
  "howItSolves" text not null default '',
  "targetPersona" text not null default '',
  bucket text not null default 'next' check (bucket in ('mvp', 'next', 'out')),
  "keyScreens" text,
  "userFlows" text,
  "painPointRef" text,
  "technicalNotes" text,
  "orderIndex" int not null default 0,
  "createdAt" timestamp not null default now(),
  "updatedAt" timestamp not null default now()
);

create index on "DesignSessionPriorityItem"("sessionId", bucket);
create index on "DesignSessionPriorityItem"("sessionId", "orderIndex");
```

**Por que tabela por item:** simétrico com brainstorm (que já é por item). Bucket é filtro previsto. Items são entidades independentes movíveis entre buckets.

**Seed cross-step:** o seed atual (puxa de `brainstorm.solutions` no primeiro load) vira lógica de API: `POST /seed-from-brainstorm` que insere items a partir das brainstorm features da session.

---

### 3.8 `DesignSessionTechnicalSpecs` (1:1)

```sql
create table "DesignSessionTechnicalSpecs" (
  "sessionId" uuid primary key references "DesignSession"(id) on delete cascade,
  stack text not null default '',
  performance text not null default '',
  notes text not null default '',
  integrations jsonb not null default '[]',  -- [{ id, text }]
  rules jsonb not null default '[]',          -- [{ id, text }]
  "updatedAt" timestamp not null default now()
);
```

**Por que jsonb:** integrations e rules são listas curtas, sem filtro previsto. Princípio normalize-on-demand.

---

### 3.9 `DesignSessionHypothesis` (1:N por session) — **exceção: 1 tabela por item**

```sql
create table "DesignSessionHypothesis" (
  id text primary key,
  "sessionId" uuid not null references "DesignSession"(id) on delete cascade,
  hypothesis text not null default '',
  indicator text not null default '',
  target text not null default '',
  "expectedResult" text not null default '',
  evidence text,
  "orderIndex" int not null default 0,
  "createdAt" timestamp not null default now(),
  "updatedAt" timestamp not null default now()
);

create index on "DesignSessionHypothesis"("sessionId", "orderIndex");
```

**Por que tabela por item:** hipóteses são entidades independentes, podem ser consultadas pra validar AC de stories no futuro.

---

## 4. RLS — usar o modelo robusto da plataforma

A plataforma já tem dois eixos de authz separados (ver memory `project_member_roles_access.md`):

- **Eixo global**: `access_level` ∈ {admin, manager, builder, guest} via `is_admin()` / `is_manager()`.
- **Eixo por-projeto**: `ProjectAccess.role` ∈ {viewer, session_participant, contributor, lead}.

Para Design Session existem **dois helpers SQL canônicos** ([supabase/migrations/20260427_project_access.sql:80-96](supabase/migrations/20260427_project_access.sql#L80)):

- `can_access_session(p_session_id)` — leitura: `is_manager() OR can_view_project(ds.projectId)`. Qualquer linha em `ProjectAccess` passa (incluindo viewer).
- `can_edit_session(p_session_id)` — mutação: `is_manager() OR can_edit_sessions(ds.projectId)`. Só `session_participant`/`contributor`/`lead` passam. **Viewer não escreve.**

Ambas as funções recebem **um único argumento** (`text`). Não passar `auth.uid()` — as funções já chamam internamente.

### 4.1 Padrão a aplicar em cada uma das 9 tabelas novas

```sql
alter table "DesignSessionPersona" enable row level security;

create policy "manager_or_viewer_select" on "DesignSessionPersona"
  for select using (can_access_session("sessionId"));

create policy "manager_or_editor_insert" on "DesignSessionPersona"
  for insert with check (can_edit_session("sessionId"));

create policy "manager_or_editor_update" on "DesignSessionPersona"
  for update using (can_edit_session("sessionId"))
  with check (can_edit_session("sessionId"));

create policy "manager_or_editor_delete" on "DesignSessionPersona"
  for delete using (can_edit_session("sessionId"));

grant select, insert, update, delete on "DesignSessionPersona" to authenticated;
```

Mesmo bloco para as outras 8 tabelas — usar `DO $$ FOR tname IN (...) LOOP EXECUTE format(...) $$;` na migration para gerar em batch (padrão de [20260427_project_access.sql:235-272](supabase/migrations/20260427_project_access.sql#L235)).

### 4.2 Corrigir RLS faltante em DesignSessionBrainstormFeature

[supabase/migrations/20260508_brainstorm_feature_table.sql](supabase/migrations/20260508_brainstorm_feature_table.sql) cria a tabela **sem `enable row level security`, sem policies, sem grant**. Está aberta hoje (ou seria, se a service-key não fosse usada). A migration desta fase **inclui** o bloco `enable RLS + 4 policies + grant` retroativamente em `DesignSessionBrainstormFeature`, antes de qualquer mudança de UI.

### 4.3 Validação

Após rodar a migration, validar via psql impersonando JWT:

```sql
set local request.jwt.claims = '{"sub":"<viewer-user-uuid>","app_metadata":{"role":"product-builder"}}';
-- esperado: select OK, insert/update/delete bloqueados pra viewer
```

Validar com 3 perfis: manager (bypass), session_participant (CRUD ok), viewer (só select).

---

## 5. APIs novas

### 5.1 Pattern geral

**Steps 1:1 com session** → 1 endpoint REST:
```
GET    /api/design-sessions/[id]/pre-work       → row inteira (ou default {})
PATCH  /api/design-sessions/[id]/pre-work       → atualiza colunas (Zod validated)
```

**Steps 1:N com session** → CRUD por entidade:
```
GET    /api/design-sessions/[id]/personas              → lista ordenada
POST   /api/design-sessions/[id]/personas              → cria
PATCH  /api/design-sessions/[id]/personas/[personaId]  → atualiza
DELETE /api/design-sessions/[id]/personas/[personaId]  → remove
PATCH  /api/design-sessions/[id]/personas/reorder      → bulk reorder { ids: [...] }
```

### 5.2 Lista de endpoints por step

| Step | Tipo | Endpoints |
|---|---|---|
| `pre_work` | 1:1 | GET, PATCH `/pre-work` |
| `product_vision` | 1:1 | GET, PATCH `/product-vision` |
| `scope_definition` | 1:1 | GET, PATCH `/scope` |
| `personas_journeys` | 1:N | CRUD `/personas` + reorder |
| `brainstorm` | 1:N | CRUD `/brainstorm-features` + reorder (substituir trigger-sync atual) |
| `risks_gaps` | 1:1 | GET, PATCH `/risks-gaps` |
| `prioritization` | 1:N | CRUD `/priority-items` + reorder + POST `/seed-from-brainstorm` |
| `technical_specs` | 1:1 | GET, PATCH `/technical-specs` |
| `hypotheses` | 1:N | CRUD `/hypotheses` + reorder |

### 5.3 Validação Zod

Todos os PATCH/POST usam Zod (extending [src/lib/agent/schemas.ts](src/lib/agent/schemas.ts)). Schemas atuais ficam quase como estão — só viram **obrigatórios em rota**, não opcionais.

### 5.4 Auth

- `GET` (leitura) → `requireSessionAccessApi(sessionId)` ([src/lib/dal.ts:544](src/lib/dal.ts#L544))
- `POST` / `PATCH` / `DELETE` / reorder / seed → `requireSessionEditApi(sessionId)` ([src/lib/dal.ts:564](src/lib/dal.ts#L564))

`requireSessionAccessApi` libera leitura para viewer; mutação **precisa** de `requireSessionEditApi`, que exige `session_participant`/`contributor`/`lead` ou manager+. Espelha exatamente o que a RLS faz.

### 5.5 Status codes

- 200 / 201 sucesso
- 400 Zod inválido (com detalhes)
- 403 sem acesso
- 404 recurso não existe
- 409 conflito (ex: tentar reorder com IDs inexistentes)
- 500 erro server

### 5.6 Endpoint genérico atual — política de cutover

[src/app/api/design-sessions/[id]/steps/[stepKey]/route.ts](src/app/api/design-sessions/[id]/steps/[stepKey]/route.ts) tem dois caminhos:
- `GET` → lê de `DesignSessionStepData.data`
- `PUT` → upsert full JSON em `DesignSessionStepData.data`, sem Zod, aceita `req.json()` cru.

Política: **dual-write é proibido.** No instante em que a UI de um step migra, a UI deixa de chamar o endpoint genérico (não escreve no JSON antigo) e passa a chamar só as rotas novas. O endpoint genérico continua ativo apenas para os steps que ainda não migraram (porque eles ainda lêem/escrevem JSON). Quando o último step migrar, o endpoint é **deletado no mesmo PR** que migra esse último step.

Em paralelo: para minimizar lixo gravado no JSON legado durante a transição, adicionar **Zod por stepKey** no endpoint genérico no início da Fase 1 (Fase 0 — abaixo). Sem Zod hoje, scripts/agents podem corromper dados.

---

## 6. UI — o que muda

### 6.1 Página container `[id]/steps/[step]/page.tsx`

**Hoje:** Single source `stepData: Record<string, unknown>`, debounced PUT replace-total a cada mudança.

**Depois:** Página passa `sessionId` pro componente. Componente faz fetch próprio (ou recebe data via prop loaded por um hook). Sem debounce — cada interação chama API.

### 6.2 Padrão por step

| Step | Componente | Mudança UI |
|---|---|---|
| `pre_work` | `pre-work-step.tsx` (421L) | Fetch via `GET /pre-work`. Upload já era endpoint próprio (continua). useState mantido pra files/transcripts. PATCH chamado em onChange (sem debounce ou debounce curto 200ms). |
| `product_vision` | inline em page (~80L) | Form 5 campos. PATCH onBlur de cada campo. Sem optimistic — espera 200ms perceptual. |
| `scope_definition` | `post-it-board.tsx` (112L) | 4 boards independentes. Cada add/edit/delete = PATCH no campo correspondente. Optimistic via state local. |
| `personas_journeys` | `persona-journey-board.tsx` (254L) | useOptimisticCollection pra lista de personas. Edição de uma persona (incluindo journey steps inline) = PATCH na persona inteira (não vale granular pra journey step). Reorder = endpoint reorder. |
| `brainstorm` | `solution-card-board.tsx` (448L) | useOptimisticCollection. CRUD direto em `DesignSessionBrainstormFeature`. **Para de ler de step_data.** Migra **junto** com prioritization (compartilham triggers). |
| `risks_gaps` | `risk-gap-board.tsx` (457L) | PATCH no array completo (risks ou gaps) por mudança. useState local com optimism. |
| `prioritization` | `priority-board.tsx` (118L) | useOptimisticCollection. Drag-to-bucket = PATCH bucket. Reorder dentro de bucket = endpoint reorder. **Para de ler de step_data.** |
| `technical_specs` | inline em page (~150L) | Form com 3 textareas + 2 listas. PATCH onBlur dos escalares + PATCH array em add/remove. |
| `hypotheses` | `hypothesis-board.tsx` (158L) | useOptimisticCollection. CRUD direto na API. **Piloto.** |

### 6.3 Hook pattern

Criar **1 hook por step** em `src/hooks/design-session/`:

```ts
// src/hooks/design-session/use-personas.ts
export function usePersonas(sessionId: string) {
  // fetch + useOptimisticCollection wrapping CRUD + reorder
  return { personas, create, update, remove, reorder, loading, error };
}
```

9 hooks (1 por step). Padrão consistente, fácil de revisar.

### 6.4 Briefing — efeito colateral

`briefing-sheet.tsx` lê dados de **todos** os steps pra renderizar markdown. Vai precisar atualizar pra buscar via endpoint agregado `GET /api/design-sessions/[id]/full`. O endpoint usa `getStepsForSession(session)` para limitar quais tabelas consulta — Super com 3 steps não dispara 9 SELECTs. O briefing-sheet renderiza só as seções dos steps presentes.

### 6.5 Task generator

[src/lib/task-generator.ts](src/lib/task-generator.ts) (`buildSessionContext`) lê hoje de `DesignSessionStepData`. Precisa atualizar pra ler das novas tabelas, iterando por `getStepsForSession(session)` (mesma regra do briefing). **Isso é o gancho onde o Vitor vai se plugar depois** — mas a refatoração de `buildSessionContext` em si vai acontecer já nesta fase, porque task-gen depende dele. Para Super Session, o contexto entregue ao gerador inclui só os steps escolhidos.

---

## 7. Schemas Zod consolidados

Reorganizar [src/lib/agent/schemas.ts](src/lib/agent/schemas.ts) → mover pra `src/lib/design-session/schemas.ts` (mais genérico, não é só pra agent). Adicionar schemas que faltam:

- `preWorkUpdateSchema`
- `productVisionUpdateSchema`
- `scopeUpdateSchema`
- `personaCreateSchema` / `personaUpdateSchema`
- `riskGapUpdateSchema`
- `priorityItemCreateSchema` / `priorityItemUpdateSchema` / `priorityItemReorderSchema`
- `technicalSpecsUpdateSchema`
- `hypothesisCreateSchema` / `hypothesisUpdateSchema`

Tipos derivados via `z.infer<>` substituem os tipos manuais espalhados nos componentes.

---

## 8. Ordem de execução

> Nada vai a produção até o final. Tudo em branch.

### Fase 0 — Defensiva no legado (rápida, ~1h)

0a. Adicionar Zod por `stepKey` no endpoint genérico [`PUT /api/design-sessions/[id]/steps/[stepKey]`](src/app/api/design-sessions/[id]/steps/[stepKey]/route.ts) usando os schemas existentes em [src/lib/agent/schemas.ts](src/lib/agent/schemas.ts). Bloqueia lixo entrando no JSON durante a transição.
0b. Trocar `requireSessionAccessApi` por `requireSessionEditApi` no `PUT` (corrigir bug latente: hoje viewer pode escrever via endpoint genérico se a RLS for bypassada por service-key em qualquer caminho).

### Fase 1 — Schema + APIs (sem tocar UI)

1. Migration `supabase/migrations/<data>_design_session_normalization.sql`:
   - Criar as 9 tabelas (uma para cada step) com colunas + indexes.
   - Aplicar RLS canônica (§4.1) em todas as 9.
   - **Aplicar RLS retroativa em `DesignSessionBrainstormFeature`** (§4.2 — tabela criada sem RLS).
   - Granular: ainda **não** dropar `DesignSessionStepData` nem remover triggers — UI ainda usa.
2. Regenerar `src/lib/supabase/database.types.ts`.
3. Criar schemas Zod consolidados em `src/lib/design-session/schemas.ts` (mover/reorganizar de `src/lib/agent/schemas.ts`).
4. Criar 9 conjuntos de rotas API (1 por step). Cada uma com:
   - `requireSessionEditApi` em mutação, `requireSessionAccessApi` em leitura
   - `assertStepInSession(sessionId, stepKey)` em mutação (rejeita 409 se step fora da sessão Super) — helper único em `src/lib/design-session/guards.ts`
   - Zod obrigatório
5. Criar endpoint agregado `GET /api/design-sessions/[id]/full` — consulta dinâmica baseada em `getStepsForSession(session)` (não consulta 9 tabelas se a Super só tem 3 steps).
6. Smoke test cada rota via curl com 3 perfis (manager, session_participant, viewer) **+ 1 Super Session** com subset de steps (validar 409 em step ausente).

### Fase 2 — UI (migração 1 step por vez, sem dual-write)

7. Criar pasta `src/hooks/design-session/` com hooks padronizados (`use-personas`, `use-hypotheses`, etc.).
8. **Piloto: `hypotheses`** (158L, 1 entidade, sem cross-step). Refatorar componente para chamar exclusivamente a nova API. Após merge, **deletar** qualquer leitura/escrita de `step_data` no path do `hypotheses`.
9. Validar UX (latência sem debounce, optimistic, error toast).
10. Migrar steps **um por um** (cada um vira PR/commit independente). Regra: ao migrar, a UI **para** de tocar o endpoint genérico para aquele step. Sem dual-write.
11. **Exceção: `brainstorm` + `prioritization` migram juntos** (compartilham triggers — §3.5). No mesmo PR: remove os 2 triggers + UI dos 2 boards + endpoints novos.
12. Após migrar todos os 9 steps:
    - Atualizar `briefing-sheet.tsx` para consumir `/full`.
    - Atualizar `task-generator.ts:buildSessionContext` para ler das novas tabelas.

### Fase 1.5 — Backfill (entre migration e UI piloto)

**Tamanho real do problema** (snapshot 2026-05-12):
- 6 sessions totais, 1 `completed` (Zelar v2 — 264e6d07), 5 `in_progress`.
- 20 rows em `DesignSessionStepData`.
- Maior `data jsonb`: 171KB (Zelar `brainstorm`). Soma total: ~370KB.
- Distintos stepKeys com dados: 9 (todos os Inception steps).

Pequeno o suficiente para fazer **backfill 100% em SQL** dentro da própria migration ou de uma migration imediatamente subsequente, sem script TS.

**Estratégia: backfill na mesma transação que cria as tabelas.**

A migration do passo 1 da Fase 1 tem **3 blocos**, todos no mesmo `BEGIN`/`COMMIT`:

1. `CREATE TABLE` + indexes + RLS em todas as 9 tabelas + retro-RLS em `DesignSessionBrainstormFeature` (§4.2).
2. **Backfill** (uma `INSERT ... SELECT ... FROM "DesignSessionStepData"` por tabela). Idempotente via `ON CONFLICT DO NOTHING` ou `ON CONFLICT (sessionId) DO UPDATE`.
3. `VACUUM ANALYZE` (fora do BEGIN se necessário).

Se qualquer SELECT do JSON falhar (shape inesperado), a transação inteira rolla back — segurança absoluta.

#### Mapping JSON → tabela (por step)

**1:1 (`pre_work`, `product_vision`, `scope_definition`, `risks_gaps`, `technical_specs`)** — single `INSERT`:

```sql
-- product_vision (escalar puro)
INSERT INTO "DesignSessionProductVision" ("sessionId", problem, "whoSuffers", consequences, "successVision", "impactMetrics", "updatedAt")
SELECT
  "sessionId",
  COALESCE(data->>'problem', ''),
  COALESCE(data->>'whoSuffers', ''),
  COALESCE(data->>'consequences', ''),
  COALESCE(data->>'successVision', ''),
  COALESCE(data->>'impactMetrics', ''),
  "updatedAt"
FROM "DesignSessionStepData"
WHERE "stepKey" = 'product_vision'
ON CONFLICT ("sessionId") DO NOTHING;

-- scope_definition (4 jsonb arrays)
INSERT INTO "DesignSessionScope" ("sessionId", "inScope", "outOfScope", does, "doesNot", "updatedAt")
SELECT
  "sessionId",
  COALESCE(data->'is', '[]'::jsonb),
  COALESCE(data->'isNot', '[]'::jsonb),
  COALESCE(data->'does', '[]'::jsonb),
  COALESCE(data->'doesNot', '[]'::jsonb),
  "updatedAt"
FROM "DesignSessionStepData"
WHERE "stepKey" = 'scope_definition'
ON CONFLICT ("sessionId") DO NOTHING;
```

**1:N (`personas_journeys`, `hypotheses`, `prioritization`)** — `INSERT ... SELECT ... jsonb_array_elements_with_ordinality(...)`:

```sql
-- personas: explode data->'personas' (array) em rows
INSERT INTO "DesignSessionPersona" (id, "sessionId", name, role, context, "asIsSteps", "toBeSteps", "orderIndex", "createdAt", "updatedAt")
SELECT
  COALESCE(persona->>'id', gen_random_uuid()::text),
  sd."sessionId",
  COALESCE(persona->>'name', ''),
  COALESCE(persona->>'role', ''),
  COALESCE(persona->>'context', ''),
  COALESCE(persona->'asIsSteps', '[]'::jsonb),
  COALESCE(persona->'toBeSteps', '[]'::jsonb),
  (ord - 1)::int,
  sd."updatedAt",
  sd."updatedAt"
FROM "DesignSessionStepData" sd,
     LATERAL jsonb_array_elements(sd.data->'personas') WITH ORDINALITY AS arr(persona, ord)
WHERE sd."stepKey" = 'personas_journeys'
ON CONFLICT (id) DO NOTHING;

-- hypotheses: explode data->'items' (ou shape equivalente — confirmar nome do array no JSON real)
INSERT INTO "DesignSessionHypothesis" (id, "sessionId", hypothesis, indicator, target, "expectedResult", evidence, "orderIndex", "createdAt", "updatedAt")
SELECT
  COALESCE(item->>'id', gen_random_uuid()::text),
  sd."sessionId",
  COALESCE(item->>'hypothesis', ''),
  COALESCE(item->>'indicator', ''),
  COALESCE(item->>'target', ''),
  COALESCE(item->>'expectedResult', ''),
  item->>'evidence',
  (ord - 1)::int,
  sd."updatedAt",
  sd."updatedAt"
FROM "DesignSessionStepData" sd,
     LATERAL jsonb_array_elements(sd.data->'items') WITH ORDINALITY AS arr(item, ord)
WHERE sd."stepKey" = 'hypotheses'
ON CONFLICT (id) DO NOTHING;
```

**Brainstorm:** já está na tabela `DesignSessionBrainstormFeature` (espelhada pelo trigger). Backfill **não precisa de INSERT** — só validar contagem e remover os 2 triggers no PR de migração de UI brainstorm+prioritization.

**Prioritization:** complementar — a tabela `DesignSessionBrainstormFeature` já tem `bucket` espelhado, mas o `DesignSessionPriorityItem` é tabela nova. Decisão: o `priority_item` é entidade separada do `brainstorm_feature` ou compartilha? Releitura: priorityItem tem `id` próprio (não FK pra brainstorm). Backfill explode `data->'items'` do step `prioritization`.

#### Validação pós-backfill (mesma migration)

```sql
-- Contagem por tabela vs source JSON
DO $$
DECLARE
  v_pv_count int;
  v_pv_expected int;
BEGIN
  SELECT COUNT(*) INTO v_pv_count FROM "DesignSessionProductVision";
  SELECT COUNT(*) INTO v_pv_expected FROM "DesignSessionStepData" WHERE "stepKey" = 'product_vision';
  IF v_pv_count != v_pv_expected THEN
    RAISE EXCEPTION 'product_vision backfill mismatch: % rows in table, % in source', v_pv_count, v_pv_expected;
  END IF;
  -- repetir para cada tabela
END $$;
```

Se qualquer assertion falhar, `ROLLBACK` automático.

#### Por que não script TS?

- Volume é trivial (6 sessions, ~370KB total).
- SQL puro é atômico (BEGIN/COMMIT), testável via `psql` local antes de prod.
- Não introduz dependência de runtime Node nem secrets de migration.
- Reproduzível em staging primeiro: rodar a mesma migration lá, validar Zelar v2 visualmente, depois prod.

#### Ordem operacional

1. Branch isolada, rodar migration localmente.
2. Comparar `SELECT count(*)` por tabela vs JSON source.
3. Para Zelar v2 (a session crítica `completed`): comparar `data->>'problem'` do JSON com `DesignSessionProductVision.problem`. Mesmo p/ uma persona, uma hipótese, um priority item — visual spot-check.
4. Rodar em staging.
5. Validar Zelar v2 na UI (briefing-sheet ainda lê do JSON nessa hora — só checar que rows existem nas tabelas).
6. Rodar em prod.
7. **Só então** começar a Fase 2 (UI piloto consome tabelas novas).

#### Janela de migração: usuários avisados (2026-05-12)

João avisou time que ninguém usa DS durante a migração. Isso elimina o risco de escritas no JSON legado durante a janela backfill → UI migrada. **Plano operacional:**

- Backfill (Fase 1.5) + Fase 2 (UI migration de todos os steps) + Fase 3 (drop de `DesignSessionStepData`) rodam **em sequência contínua na mesma janela**, sem reabertura para uso normal entre fases.
- Re-run de backfill **não é necessário** — JSON legado fica congelado.
- Se a janela se estender (>1 dia útil), avisar time de novo antes de reabrir uso. Se alguém precisar usar DS no meio da janela, **abortar Fase 2 e re-rodar backfill** (idempotente) antes de retomar.

> A Fase 2 deve começar logo após Fase 1.5 dentro da mesma janela; não deixar tabelas novas paradas read-only por dias.

---

### Fase 3 — Cleanup (no PR final da Fase 2)

13. Drop `DesignSessionStepData` **inteira** (não só a coluna `data`). Validar antes que `stepIndex`/`updatedAt` não são referenciados em lugar nenhum.
14. Drop RPCs `step_array_add/update/delete` em [20260506_step_data_atomic_array_ops.sql](supabase/migrations/20260506_step_data_atomic_array_ops.sql) (confirmar zero callers).
15. Drop trigger `step_data_reject_dup_ids`.
16. Drop endpoint genérico `/api/design-sessions/[id]/steps/[stepKey]/route.ts`.
17. Remover schemas e tipos legados que só serviam ao JSON shape.

**Backfill:** decisão à parte. Como `DesignSessionStepData` é dropada na Fase 3, ou o backfill acontece *antes* (script que lê JSON e popula as 9 tabelas — provavelmente entre Fase 1 e Fase 2 do piloto), ou aceitamos que as sessions existentes começam vazias nas tabelas novas e o usuário re-popula. Decidir antes do PR do piloto.

---

## 9. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| UI sem debounce fica "chatty" (muitas requests) | Optimistic updates resolvem o perceptual. Debounce curto (200ms) onde fizer sentido (campos texto livres). |
| `is` é palavra reservada em SQL | Sempre aspas duplas. Se virar dor, renomear coluna pra `inScope` com mapping no API layer. |
| Briefing precisa de dados de todos steps | Endpoint agregado `/full` retorna tudo num shot. |
| Task generator quebra durante transição | `buildSessionContext` atualizado junto com a refatoração da UI (mesma branch). Testes manuais antes de merge. |
| Brainstorm tem **dois** triggers sync ativos (brainstorm + prioritization) | Remove ambos no mesmo PR que migra brainstorm **E** prioritization — os dois steps escrevem na mesma tabela via triggers. Não dá pra separar sem condição de corrida. |
| `DesignSessionBrainstormFeature` foi criada sem RLS | Migration desta fase aplica `enable rls + 4 policies + grant` retroativamente. |
| Viewer escreve via endpoint legado | Fase 0 troca `requireSessionAccessApi` → `requireSessionEditApi` no PUT do endpoint genérico. |
| Super Session escreve em step que não pertence à `selectedSteps` | Guard `assertStepInSession` em cada rota CRUD (§2-bis ponto 2). 409 com mensagem clara. |
| Super com `retrospective`/`new_demands`/`refinement` selecionados antes deles existirem | Fase 1 não cria tabelas pra esses 3. Modal desabilita os checkboxes até implementação. Comportamento atual (componente não renderiza) é preservado. |
| Reorder em listas grandes | Endpoint reorder recebe `ids[]` ordenado e faz UPDATE em batch com transação. |
| Permissões viewer/editor diferentes por step | Mesmo `requireSessionAccessApi` atual — replicar sem mudar lógica. |

---

## 10. O que **não** está neste plano (decidido)

- **Vitor / agent tools**: replanejado isoladamente depois.
- **Backfill**: estratégia decidida quando tabelas/APIs prontas.
- **CI steps** (retrospective, new_demands, refinement): seguem em JSONB até serem implementados; quando forem, seguem o mesmo padrão.
- **Audit log / soft delete**: não introduzir nesta fase.
- **Versioning de step data**: não introduzir.

---

## 11. Próximos passos imediatos

1. Decisões pendentes antes da migration:
   - `is` reservado em `DesignSessionScope` → renomear pra `inScope`/`outOfScope`? Recomendação: **sim**, evita aspas em toda query.
   - `DesignSessionRiskGap` em jsonb vs 2 tabelas (`DesignSessionRisk` + `DesignSessionGap`)? Recomendação: **2 tabelas**, consistente com o princípio "se a UI já filtra, é entidade".
   - PKs `text` (vindo do client) vs `uuid` (server-gen) em Persona/PriorityItem/Hypothesis? Recomendação: **uuid server-gen** para alinhar com a migração de PKs feita em 2026-04-30. Aceitar precedente `text` só onde já existe (`DesignSessionBrainstormFeature`).
   - Super Session com CI steps selecionáveis: desabilitar `retrospective`/`new_demands`/`refinement` no `super-session-modal.tsx` enquanto não têm componente nem tabela? Recomendação: **sim**, evita session quebrada.
   - Backfill: estratégia definida em §1.5 (SQL puro na mesma migration). Confirmar que o shape de `data->'items'` vs `data->'personas'` etc. bate com o esperado — fazer dump local antes de escrever as queries finais.
2. Aprovar.
3. Fase 0: Zod + `requireSessionEditApi` no endpoint genérico (1h).
4. Fase 1 passo 1: criar migration `supabase/migrations/<data>_design_session_normalization.sql` com as 9 tabelas + RLS + retro-RLS em BrainstormFeature.

---
