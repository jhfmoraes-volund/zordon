# Activity Feed na Task Sheet — Plano V2

> **Status:** Fase 1 entregue · Fase 2 pronta para iniciar · **Autor:** discussão JM ↔ Claude · **Última atualização:** 2026-05-02
> **Versão:** V2 — incorpora análise crítica do V1 ([activity-feed-plan.md](../archive/activity-feed-plan.md))
> **Escopo confirmado:** comentários + log de eventos automáticos + @mentions + notificações in-app. Anexos de imagem ficam para um próximo ciclo.

## Estado atual (resumo executivo)

- ✅ **Fase 1 — Eventos automáticos (PR1)**: implementada e em produção. Toda mutação de Task via TaskSheet gera evento no feed.
- ⏳ **AF-10 — Teste manual da Fase 1**: pendente (smoke test pelo usuário).
- 🟡 **Fase 2 — Comentários + @mentions**: próxima. Plano detalhado em §7 e §12.
- ⬜ **Fase 3 — Notificações in-app + bell**: depois da Fase 2.

**Para um agente pegar do ponto atual:** leia §0.5 (estado de implementação), §3 (decisões já fechadas) e §7 + §12 (plano da Fase 2). Tudo o que está fora desse caminho é contexto histórico — útil mas não crítico.

---

## 0.5 Estado de implementação (2026-05-02)

### Fase 1 — Entregue

**Arquivos novos:**
- [src/lib/dal/task-snapshot.ts](../src/lib/dal/task-snapshot.ts) — `snapshotTaskHydrated()` (Task + assignees + tags) e `snapshotAcceptance()`. Usado por todos os endpoints que mutam Task.
- [src/lib/dal/task-activity-recorder.ts](../src/lib/dal/task-activity-recorder.ts) — `recordTaskChanges` / `recordTaskCreated` / `recordAcceptanceChanges`. Resolve ator internamente via `getActorMemberId()`. Best-effort com `try/catch`. Diff functions exportadas: `diffTaskSnapshot`, `diffAcceptance`, `isAcDiffEmpty`.
- [src/components/story-hierarchy/activity-renderers.tsx](../src/components/story-hierarchy/activity-renderers.tsx) — Map `type → Renderer` cobrindo os 16 tipos de evento. Hidrata nomes via `RendererCtx` (`members`, `sprints`, `stories`, `projectTags`).
- [src/hooks/use-field-debounce.ts](../src/hooks/use-field-debounce.ts) — Coalescing por chave; flush automático no unmount (não perde edição).

**Arquivos editados (instrumentados com recorder):**
- [src/lib/dal/task-activity.ts](../src/lib/dal/task-activity.ts) — `TaskActivityType` estendido (16 tipos).
- [src/app/api/tasks/route.ts](../src/app/api/tasks/route.ts) — POST emite `created`.
- [src/app/api/tasks/[id]/route.ts](../src/app/api/tasks/[id]/route.ts) — PUT faz snapshot before/after + `recordTaskChanges`.
- [src/app/api/tasks/[id]/tags/route.ts](../src/app/api/tasks/[id]/tags/route.ts) — emite `tags_changed`.
- [src/app/api/tasks/[id]/move-to-story/route.ts](../src/app/api/tasks/[id]/move-to-story/route.ts) — emite `story_changed`.
- [src/app/api/tasks/[id]/acceptance/route.ts](../src/app/api/tasks/[id]/acceptance/route.ts), [acceptance/[acId]/route.ts](../src/app/api/tasks/[id]/acceptance/[acId]/route.ts), [acceptance/bulk/route.ts](../src/app/api/tasks/[id]/acceptance/bulk/route.ts) — todas emitem `ac_bulk_changed` agregado.
- [src/components/task-sheet-by-ref.tsx](../src/components/task-sheet-by-ref.tsx) — `handleSave`, `handleChangeSprint`, `handleChangeAssignees` migrados de supabase direto → `PUT /api/tasks/[id]` (caminho A — uma fonte só de mutação).
- [src/components/story-hierarchy/task-sheet.tsx](../src/components/story-hierarchy/task-sheet.tsx) — debounce client em title/description/notes (`persistTextDebounced`); bloco DoD removido; passa `ctx` (members, sprints, stories, projectTags) para `<TaskActivitySection>`.
- [src/components/story-hierarchy/task-activity-section.tsx](../src/components/story-hierarchy/task-activity-section.tsx) — usa `renderActivity` com hidratação contextual; mostra empty state "Sem atividade ainda." em vez de esconder seção.

### Decisões de execução que diferem do plano original

1. **AF-3.5 (testes unit) skipped**: o repositório não tem test runner configurado (sem `vitest`, `jest`, nada em `package.json`). Adicionar runner agora seria scope creep. Funções puras (`diffTaskSnapshot`, `diffAcceptance`, futuro `parseMentions`) são testáveis manualmente; quando o projeto adotar runner, escrever testes é trivial.

2. **Caminho A confirmado e aplicado**: durante AF-8 descobrimos que `task-sheet-by-ref.tsx` mutava `Task` via supabase direto (5 callsites), bypassando o recorder. Migração completa para `PUT /api/tasks/[id]` foi feita — agora **todas** as mutações da TaskSheet passam pelo endpoint. Confirmado por grep: nenhum outro consumidor client-side muta `Task`/`TaskAssignment`/`TaskTagAssignment` direto.

3. **DoD removido da TaskSheet**: decisão tomada na conversa de 2026-05-01. DoD continua nas settings do projeto. Bloco do task-sheet.tsx removido em AF-18 antecipado.

4. **Empty state na seção "Atividade"**: implementado em 2026-05-02. Antes: `if (items.length === 0) return null` escondia a seção. Agora: mostra "Sem atividade ainda." em itálico, mantendo a moldura.

5. **Lint pré-existente preservado**: 4 erros de lint pré-existentes em arquivos que tocamos (`any` cast em `fetchTask`, `prefer-const` em `iterationCounts`, `set-state-in-effect` warning em `task-sheet.tsx`, `unused TASK_STATUS_MAP`). Não corrigidos — fora do escopo da feature.

### Tarefa adjacente em curso (não bloqueia Fase 2)

- **Tags otimistas no TagPicker**: prompt JSON pronto em [docs/agent-prompts/tags-optimistic.json](./agent-prompts/tags-optimistic.json) para outro agente executar. Resolve queixa de lentidão na alteração de tags. Fase 2 não depende disso.

---

## 0. O que mudou em relação ao V1

V2 fecha 7 buracos identificados na crítica do V1. Resumo:

| # | Mudança | Impacto |
|---|---|---|
| M1 | Snapshot pré-mutation explícito (não confia em `TaskRow`) | Novo helper `snapshotTaskHydrated()`. Sem ele o recorder perde diffs de assignees/tags. |
| M2 | Recorder lê ator **internamente** via `getActorMemberId()` — não recebe como argumento | Impossível esquecer ou passar `auth.uid()` cru. R3 fica impossível de errar. |
| M3 | Recorder pluga **só nos endpoints** (não no DAL `setTagsForTask`) | Uma fonte de emissão. Elimina o risco de double-fire. |
| M4 | Debounce de title/description vai para o **client**, não server | Mantém `TaskActivity` append-only/imutável (a premissa do §4 do V1). Sem race de UPDATE concorrente. |
| M5 | View em fase 2 entra como **otimização opcional**; default é 2-fetch in-memory merge | Reduz risco da fase 2. View vira "nice to have" depois de medir. |
| M6 | Decisões fechadas (R8 slug, R5 link de notif para comment removido, soft-delete preserva body) | Plano fica realmente executável, sem "decidir antes de codar". |
| M7 | Testes unitários explícitos no escopo (`parseMentions`, `recordTaskChanges` diff) | Funções puras, custo baixo, evita regressão silenciosa. |

---

## 1. Contexto e motivação

Hoje toda comunicação sobre uma task acontece fora do Zordon (Telegram, Roam) e
se perde. Quando um dev pega uma task semanas depois, não há contexto de
decisões anteriores. A seção atual `Definition of Done · projeto` na TaskSheet
([task-sheet.tsx:672-681](../src/components/story-hierarchy/task-sheet.tsx#L672-L681))
é quase decorativa — ocupa espaço mas é pouco lida.

A proposta troca essa seção por um **feed de atividade** com dois tipos de
entrada:

1. **Comentários manuais** — texto com markdown leve, @mention de membros do
   projeto. (Anexos: fora de escopo.)
2. **Eventos automáticos** — status, assignee, sprint, FP/scope/complexity,
   AC checked, tags, links, sub-tasks, etc.

Cada item exibe ator, ação, timestamp relativo (`há 2h`) com absoluto no hover.
Histórico automático elimina a pergunta "por que essa task ainda está parada?".

---

## 2. O que já existe (não reinventar)

| Recurso | Localização | Estado atual |
|---|---|---|
| Tabela `TaskActivity` | [supabase/migrations/20260501_task_activity.sql](../supabase/migrations/20260501_task_activity.sql) | Existe, RLS por membership. Hoje guarda apenas `duplicated`, `cloned_to`, `cloned_from`. Coluna `type text` sem CHECK — bom, evolui sem migration. |
| DAL de activity | [src/lib/dal/task-activity.ts](../src/lib/dal/task-activity.ts) | `createActivity()` + `getActivityForTask()` prontos. |
| Endpoint | `GET /api/tasks/[id]/activity` | Lê o feed atual (read-only). |
| Componente | [task-activity-section.tsx](../src/components/story-hierarchy/task-activity-section.tsx) | Render minimalista de 3 tipos. Será reescrito. |
| Markdown | [src/components/ui/markdown.tsx](../src/components/ui/markdown.tsx) | Wrapper de `react-markdown` com collapse. |
| Optimistic | [use-optimistic-collection.ts](../src/hooks/use-optimistic-collection.ts) + [src/lib/optimistic/](../src/lib/optimistic/) (`reconcile.ts`, `toast.ts`) | Hook + reconcile + classify/retry de erros (`withServerRetry`, `isRetryable`). |
| Resolver de ator | [src/lib/dal.ts](../src/lib/dal.ts) → `getCurrentMember()` / `getActorMemberId()` | Já lida com impersonation ([dal.ts:244-258](../src/lib/dal.ts#L244-L258)). |
| Padrão de debounce client-side | [use-wiki-items.ts:48-53](../src/hooks/use-wiki-items.ts#L48-L53) | Pattern `useRef<setTimeout>` + `clearTimeout` já no codebase. Reutilizar para title/description (M4). |

**Falta:** comentários como entidade, eventos automáticos plugados, @mention +
notificações, redesign visual do feed, snapshot hidratado pré-mutation.

---

## 3. Decisões fechadas (todas resolvidas para V2)

| # | Decisão | Resolução final |
|---|---|---|
| R1 | 1 entidade ou 2 (comentários vs eventos) | **2 tabelas** (`TaskComment` + `TaskActivity`). Sem view; merge in-memory no DAL. (Ver §4.) |
| R2 | Atividade dentro ou fora da transação do update | **Fora**, best-effort, log e segue. |
| R3 | Quem é o "ator" quando admin impersona | `getActorMemberId()`, **resolvido dentro do recorder** (M2). |
| R4 | Edição de comentário com mentions dispara nova notificação? | Sim, **só para mentions novos** (diff). |
| R5 | Soft delete de comentário preserva mentions/notificações? | Sim. **Body preservado** (audit). Render mostra "comentário removido" no lugar. Notificação clicada → vai pra TaskSheet, scroll para a posição original, mostra "comentário removido (apagado por X em Y)". |
| R6 | Paginação do feed | Cursor `?before=<createdAt>&limit=50` já na v1. |
| R7 | Realtime | Polling 60s no MVP. Supabase Channels depois. |
| R8 | Sintaxe de mention | `@<slug>` onde slug = `member.name` lowercased + sem acentos + `-` no espaço. Disambiguação: 2 membros com slug igual → suffixar com 4 chars do uuid (`@joao-silva-a3f2`). Resolver `slug → memberId` no `parseMentions`. (Ver §7.3.1.) |
| R9 | `mentionedMemberIds` denormalizado | Sim, em coluna `uuid[]`. |
| R10 (novo) | Quem resolve o ator: caller ou recorder? | **Recorder** chama `getActorMemberId()` internamente. Caller nunca passa. (M2) |
| R11 (novo) | Recorder pluga em endpoint ou em DAL? | **Endpoint**. Uma fonte só. (M3) |
| R12 (novo) | Debounce de title/description | **Client-side**, on-blur com 2min coalescing. Server fica burro. (M4) |
| R13 (novo) | View vs merge in-memory na fase 2 | **Merge in-memory** como default. View `TaskFeedItem` é otimização futura, só se medir necessidade. (M5) |

---

## 4. Modelo de dados — duas tabelas, sem view

Comentários têm ciclo de vida (editáveis, deletáveis, mentions). Eventos
automáticos são imutáveis. Misturar em `payload jsonb` único espalha regra de
negócio. **Decisão: B (V1) mantida — duas tabelas.**

**Mudança V2:** sem view `TaskFeedItem`. O DAL faz duas queries paralelas
(`TaskActivity` + `TaskComment`), merge in-memory por `createdAt`, slice. É
simples, sem pegadinhas de RLS via `security_invoker`, e em cardinalidade
realista (50 itens visíveis) tipicamente mais rápido. View vira otimização
condicional documentada em §11.

---

## 5. Princípios de implementação

- **Renderers como mapa**, não switch enorme. `const renderers: Record<TaskActivityType, (item) => ReactNode>`.
- **Recorder defensivo**: `createActivity` em `try/catch`, log e segue. (R2)
- **Fora da transação do update**. (R2)
- **Paginação desde o início**: `?before=<cursor>&limit=50`. (R6)
- **Optimistic em comentários**: hook `useOptimisticCollection` na **coleção de comments só**. Activities são read-only no client (chegam via fetch, não otimista). Render mergeia local. **Não usar o hook na coleção mista.**
- **Mention parser puro**: `parseMentions(body, members)` retorna ids únicos válidos. Usado no client (preview) e no server (validação). Mesma função.
- **Markdown puro armazenado**, render derivado. Nunca guardar HTML.
- **Soft delete em comentários**: preserva continuidade do thread e auditoria. Body fica intacto no DB. (R5)
- **Ator resolvido dentro do recorder**, sempre. Caller não passa. (M2/R10)
- **Snapshot pré-mutation centralizado**: `snapshotTaskHydrated(id)` retorna `{ task, assigneeIds, tagIds }`. Único helper, todo endpoint que vai mutar e auditar passa por ele. (M1)

---

## 6. Fase 1 — Eventos automáticos (sem UI nova)

> **Objetivo:** task vira "auditável". UI continua a mesma — só preencher o feed
> que está vazio.

### 6.1 Estender `TaskActivityType`

[src/lib/dal/task-activity.ts](../src/lib/dal/task-activity.ts):

```ts
export type TaskActivityType =
  | "created"
  | "status_changed"
  | "assignees_changed"
  | "sprint_changed"
  | "story_changed"
  | "fp_changed"
  | "scope_changed"
  | "complexity_changed"
  | "type_changed"
  | "tags_changed"
  | "ac_bulk_changed"
  | "title_edited"
  | "description_edited"
  | "duplicated" | "cloned_to" | "cloned_from";
```

Sem `ac_added/removed/checked/etc` granulares — bulk e single passam pelo
`ac_bulk_changed` com payload diff. Padrão consistente com `tags_changed`.

Payload convention: `{ before, after, ...context }`.

> **Sem migration.** Coluna `TaskActivity.type` é `text` sem CHECK. Constraint vive em TS.

### 6.2 Snapshot hidratado pré-mutation (M1 — novo)

Novo arquivo `src/lib/dal/task-snapshot.ts`:

```ts
export type TaskSnapshot = {
  task: TaskRow;
  assigneeIds: string[];   // ordenados, dedup
  tagIds: string[];        // ordenados, dedup
};

export async function snapshotTaskHydrated(taskId: string): Promise<TaskSnapshot | null>;
```

Implementação: 1 query que faz `SELECT Task.* + array_agg(TaskAssignment.memberId) + array_agg(TaskTag.tagId)` (ou 3 queries em paralelo se SQL ficar feio — premature optimization sair).

**Por que esse helper existe:**
- `assigneeIds` não está em `TaskRow` (vem de `TaskAssignment`)
- `tagIds` não está em `TaskRow` (vem de `TaskTag`)
- O recorder precisa diff'ar essas listas — tem que ler antes da mutation
- Centralizar em um helper evita que cada endpoint reinvente o snapshot e esqueça campos

**Onde é usado:**
- `PUT /api/tasks/[id]`: snapshot antes de qualquer mutation; recorder consome `before` e `after` (re-snapshot pós-mutation).
- `/api/tasks/[id]/tags`: idem.
- `/api/tasks/[id]/move-to-story`: idem.
- `/api/tasks/[id]/acceptance/*`: o snapshot do `Task` em si não muda; AC tem seu próprio "antes/depois" (lista de AC ids/states). Reuso parcial.

### 6.3 Helper `recordTaskChanges`

Novo arquivo `src/lib/dal/task-activity-recorder.ts`:

```ts
// Lê ator internamente. Caller NUNCA passa actorMemberId.
export async function recordTaskChanges(
  taskId: string,
  before: TaskSnapshot,
  after: TaskSnapshot,
): Promise<void>;

// Para criação. before não existe.
export async function recordTaskCreated(
  taskId: string,
): Promise<void>;

// Para AC bulk/single.
export async function recordAcceptanceChanges(
  taskId: string,
  diff: { added: string[]; removed: string[]; checked: string[]; unchecked: string[]; edited: string[] },
): Promise<void>;
```

Diff field-by-field; emite uma activity por **campo** alterado (mas
`assigneesChanged` e `tagsChanged` são 1 evento agregado com diff completo).
Wrapped em `try/catch` — falha vira log no servidor, não 500.

### 6.4 Plugar nos endpoints (M3 — uma camada só)

| Endpoint | Eventos |
|---|---|
| [PUT /api/tasks/[id]](../src/app/api/tasks/[id]/route.ts) | `status_changed`, `assignees_changed`, `sprint_changed`, `story_changed`, `fp_changed`, `scope_changed`, `complexity_changed`, `type_changed`, `title_edited`, `description_edited`, `tags_changed` |
| [POST /api/tasks](../src/app/api/tasks/route.ts) | `created` |
| [/acceptance](../src/app/api/tasks/[id]/acceptance/route.ts) + [bulk](../src/app/api/tasks/[id]/acceptance/bulk/route.ts) + [acId](../src/app/api/tasks/[id]/acceptance/[acId]/route.ts) | `ac_bulk_changed` (single = bulk com 1 item) |
| [/tags](../src/app/api/tasks/[id]/tags/route.ts) | `tags_changed` |
| [/move-to-story](../src/app/api/tasks/[id]/move-to-story/route.ts) | `story_changed` |

**Padrão de uso no PUT (cobre o R12 + M1 + M3):**

```ts
// 1. Snapshot pré-mutation (uma query, hidratada)
const before = await snapshotTaskHydrated(id);
if (!before) return 404;

// 2. Auth
const denied = await requireProjectMemberApi(before.task.projectId);
if (denied) return denied;

// 3. Mutations (assignment, tags, task) — como já é hoje
// ... lines 67-87 atuais ...

// 4. Snapshot pós-mutation
const after = await snapshotTaskHydrated(id);

// 5. Audit (best-effort, não derruba a request)
if (after) {
  recordTaskChanges(id, before, after).catch((e) =>
    console.error("[task-activity] recordTaskChanges failed", e)
  );
}

// 6. Resposta
return NextResponse.json(await fetchTask(id));
```

**Regra crítica:** o recorder roda **só no endpoint**. Nunca dentro de
`setTagsForTask` ou outras funções DAL. Caso contrário `PUT /tasks/[id]` que
recebe `tagIds` dispararia `tags_changed` duas vezes (uma no PUT, uma no DAL).
(M3/R11)

### 6.5 Debounce de title/description — client-side (M4/R12)

V1 propunha "se houver `title_edited` do mesmo ator nos últimos 2min,
*atualizar* o `after` do último". Isso quebra a premissa de "TaskActivity é
imutável" (§4) e introduz race em writes concorrentes.

**V2:** debounce no **client**. A TaskSheet já persiste on-blur por campo
([task-sheet.tsx:656](../src/components/story-hierarchy/task-sheet.tsx#L656)).
Trocar `onBlur → persistImmediate` por um wrapper `useFieldDebounce(field,
2_000ms)` que coalesce múltiplos blurs do mesmo campo na mesma sessão.

Pattern já existe no codebase ([use-wiki-items.ts:48-53](../src/hooks/use-wiki-items.ts#L48-L53)) —
`useRef<setTimeout>` + `clearTimeout`. Reutilizar.

Server fica burro: cada PUT recebido = 1 `title_edited` se o valor mudou.
Append-only preservado, sem `UPDATE` na tabela de activity.

### 6.6 Renderizar os novos tipos

Estender `renderItem` em [task-activity-section.tsx](../src/components/story-hierarchy/task-activity-section.tsx).
Extrair pra `src/components/story-hierarchy/activity-renderers.tsx` com map
`type → renderer`.

**Hidratação contextual:** o renderer recebe `members` e `sprints` já passados
pelo TaskSheet. Payload guarda só ids; nomes resolvem na leitura. Evita
payload defasado (ex: membro renomeado depois).

### 6.7 Testes (M7 — novo)

`src/lib/dal/__tests__/task-activity-recorder.test.ts`:
- diff de single field (status, fp, etc.)
- diff agregado (assignees, tags) com lista vazia, lista com items, união
- ignora quando before === after
- ignora campo que não está em allowlist

Função pura, fácil de testar, alto retorno. ~1h.

### Critério de aceite — Fase 1

- [ ] Mudar status na TaskSheet → feed mostra `João mudou status: todo → in_progress · há 2s`
- [ ] Adicionar/remover assignee → feed mostra `João adicionou Maria · há 5s`
- [ ] Editar title 5x em 30s → feed mostra **1** evento (debounce client funcionando)
- [ ] Bulk-toggle 4 ACs → feed mostra **1** linha agregada (`ac_bulk_changed`)
- [ ] Forçar erro no `createActivity` (ex: derrubar tabela em dev) → mutation principal continua passando, erro só no log
- [ ] Admin impersonando outro membro → ator do evento é o membro impersonado, não o admin
- [ ] Update concorrente do mesmo campo (2 abas, 2 PUTs) → cada PUT emite seu evento, sem race
- [ ] Testes unitários passam (`recordTaskChanges` diff)

**Estimativa:** ~2 dias (V1 dizia 1.5; +0.5 por causa de M1 snapshot helper +
M7 testes).

---

## 7. Fase 2 — Comentários (texto + markdown + mention)

> **Objetivo:** sair do "log read-only" pra "discussion thread".

### 7.0 Handoff para o agente que vai implementar

**Estado do código quando começar:** Fase 1 está em main. O componente
[`<TaskActivitySection>`](../src/components/story-hierarchy/task-activity-section.tsx)
já existe, faz fetch em `GET /api/tasks/[id]/activity` e renderiza eventos via
[`activity-renderers.tsx`](../src/components/story-hierarchy/activity-renderers.tsx).
Você vai **substituir** esse componente por `<TaskFeed>` no mesmo lugar, mas
**reutiliza** o renderer (que já cobre os 16 tipos de evento).

**O TaskSheet já passa o ctx hidratado:** [task-sheet.tsx:680-689](../src/components/story-hierarchy/task-sheet.tsx#L680-L689)
hoje passa `{ members, sprints, stories, projectTags }` para
`<TaskActivitySection>`. `<TaskFeed>` recebe o **mesmo** ctx + `currentMember`
(que precisa ser adicionado). Não reinventar.

**Ordem de execução recomendada:**
1. AF-11: rodar a migration via psql (ver §7.1)
2. AF-12: regerar `database.types.ts` com `npm run db:types`
3. AF-13: DAL `task-comments.ts` + `parseMentions` puro (ver §7.3)
4. AF-14: DAL `getFeedForTask` (ver §7.2)
5. AF-15: 4 endpoints (ver §7.4)
6. AF-16: `<CommentComposer>` (ver §7.5)
7. AF-17: `<TaskFeed>` mergeando comments + activities (ver §7.5)
8. AF-18: trocar `<TaskActivitySection>` por `<TaskFeed>` em [task-sheet.tsx:680-689](../src/components/story-hierarchy/task-sheet.tsx#L680-L689); deletar o endpoint `/activity` e o componente velho **no mesmo commit**
9. AF-19: teste manual + auditoria RLS via curl (ver §7 Critério de aceite)

**Comando para rodar a migration** (ver [AGENTS.md](../../AGENTS.md)):

```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && \
  psql "$DIRECT_URL" -f supabase/migrations/20260502_task_comments.sql
```

**Padrões do codebase a seguir:**
- DAL: `"server-only"` no topo, importar `db` de `@/lib/db`, tipos via `Database["public"]["Tables"]["X"]["Row"]`.
- Endpoints: `requireProjectMemberApi(projectId)` para auth (ver [tasks/[id]/route.ts](../src/app/api/tasks/[id]/route.ts) como referência).
- Optimistic: `useOptimisticCollection` ([use-optimistic-collection.ts](../src/hooks/use-optimistic-collection.ts)) — usar **só na coleção de comments**, não na coleção mista.
- Toast de erro: `showErrorToast` de `@/lib/optimistic/toast`.
- Markdown: usar [src/components/ui/markdown.tsx](../src/components/ui/markdown.tsx) (wrapper de `react-markdown` que já existe).

**Não faça:**
- ❌ Test runner novo (projeto não tem) — pular AF-13.5 e AF-3.5-equivalentes; documentar que `parseMentions` foi testado manualmente.
- ❌ View `TaskFeedItem` em SQL — V2 abandonou em favor de merge in-memory (ver §7.2).
- ❌ TipTap/Lexical no composer — `<Textarea>` puro + toolbar mínima.
- ❌ Mexer no recorder ou nos endpoints da Fase 1 — eles estão estáveis.
- ❌ Mexer no DoD (já foi removido da TaskSheet em 2026-05-01).

### 7.1 Migration `20260502_task_comments.sql`

```sql
BEGIN;

CREATE TABLE public."TaskComment" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "taskId"        uuid NOT NULL REFERENCES "Task"(id) ON DELETE CASCADE,
  "authorMemberId" uuid REFERENCES "Member"(id) ON DELETE SET NULL,  -- nullable, igual TaskActivity
  body            text NOT NULL CHECK (char_length(body) > 0 AND char_length(body) <= 16000),
  "mentionedMemberIds" uuid[] NOT NULL DEFAULT '{}',
  "editedAt"      timestamptz,
  "deletedAt"     timestamptz,
  "createdAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON "TaskComment" ("taskId", "createdAt" DESC);
CREATE INDEX ON "TaskComment" USING gin ("mentionedMemberIds");

ALTER TABLE "TaskComment" ENABLE ROW LEVEL SECURITY;

-- SELECT: qualquer membro do projeto vê
CREATE POLICY "comment_read" ON "TaskComment" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "Task" t
    JOIN "ProjectMember" pm ON pm."projectId" = t."projectId"
    JOIN "Member" m ON m.id = pm."memberId"
    WHERE t.id = "TaskComment"."taskId" AND m."userId" = auth.uid()
  ));

-- INSERT: qualquer membro do projeto pode criar (autor é setado pela rota)
CREATE POLICY "comment_insert" ON "TaskComment" FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Task" t
    JOIN "ProjectMember" pm ON pm."projectId" = t."projectId"
    JOIN "Member" m ON m.id = pm."memberId"
    WHERE t.id = "TaskComment"."taskId" AND m."userId" = auth.uid()
  ));

-- UPDATE: só o autor (M3 do V1 — corrigido em V2)
CREATE POLICY "comment_update" ON "TaskComment" FOR UPDATE
  USING ("authorMemberId" IN (SELECT id FROM "Member" WHERE "userId" = auth.uid()));

-- DELETE: só o autor (soft delete na app; hard delete não usado fora de admin via service_role)
CREATE POLICY "comment_delete" ON "TaskComment" FOR DELETE
  USING ("authorMemberId" IN (SELECT id FROM "Member" WHERE "userId" = auth.uid()));

COMMIT;
```

**Notas:**
- `authorMemberId` nullable + `ON DELETE SET NULL`: consistente com
  `TaskActivity.actorMemberId`. Permite remover `Member` sem quebrar FK.
  Render mostra "ex-membro".
- 16k chars: GitHub usa 65k, Trello 16k. Cobre ~99% dos casos sem virar abuse vector.
- `mentionedMemberIds` denormalizado: query "minhas mentions" sem reparser; fonte
  da verdade da notificação. Reescrito em cada UPDATE pelo server (R9).
- Soft delete preserva `body` no DB (audit). Render decide o que mostrar com base em `deletedAt`. (R5)

### 7.2 Sem view — DAL faz merge (M5)

V1 propunha view `TaskFeedItem` com `UNION ALL`. V2 abandona em favor de:

```ts
// src/lib/dal/task-feed.ts
export async function getFeedForTask(
  taskId: string,
  opts: { limit?: number; before?: string } = {},
): Promise<FeedItem[]> {
  const limit = opts.limit ?? 50;
  const [activities, comments] = await Promise.all([
    fetchActivitiesPage(taskId, limit, opts.before),
    fetchCommentsPage(taskId, limit, opts.before),
  ]);
  // merge desc por createdAt, slice(0, limit), inclui resolved actor
  return mergeFeed(activities, comments).slice(0, limit);
}
```

**Por que melhor que view:**
- Sem RLS via `security_invoker` (gotcha resolvida sem ser introduzida)
- Sem `EXPLAIN ANALYZE` obrigatório no checklist
- Cardinalidade real (50 itens) → 2 queries paralelas + merge in-memory é trivial
- Quando crescer, view continua disponível como otimização (§11)

### 7.3 DAL `src/lib/dal/task-comments.ts`

- `createComment({ taskId, body, mentionedMemberIds })` — `authorMemberId` resolvido **dentro** via `getActorMemberId()` (consistência com recorder, M2)
- `editComment(id, body, mentionedMemberIds)` — autorização na rota; DAL só persiste; seta `editedAt = now()`
- `deleteComment(id)` — soft, seta `deletedAt = now()`
- `parseMentions(body, projectMembers): { ids: string[]; slugs: string[] }` — função pura

#### 7.3.1 Sintaxe de mention (R8 — fechado)

`@<slug>` onde:

```ts
function memberSlug(m: { id: string; name: string | null }): string {
  const base = (m.name ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")  // sem acento
    .replace(/[^a-z0-9\s-]/g, "")                       // só [a-z0-9 -]
    .trim()
    .replace(/\s+/g, "-");
  return base || `m-${m.id.slice(0, 8)}`;
}
```

**Disambiguação:** se 2+ membros do projeto têm slug igual, todos os membros
ambíguos ganham sufixo `-<uuid4chars>`. Resolução determinística por id. Slug
é **derivado** (nunca armazenado em coluna), então renomear membro propaga ao
re-render.

**Parser:**
- Regex: `/(?:^|\s)@([a-z0-9-]+)\b/g`
- Para cada match, busca em `projectMembers` por slug (com disambiguação aplicada)
- Retorna `{ ids: [...], slugs: [...] }` (slugs útil pro render highlight)
- Mentions a slugs inválidos são ignoradas silenciosamente

#### 7.3.2 Testes (M7)

`src/lib/dal/__tests__/parse-mentions.test.ts`:
- mention simples → resolve id
- mention de slug inválido → ignorado
- 2 membros homônimos → ambos resolvem por sufixo
- mention no início, meio, depois de pontuação
- escape `\@` (decisão: não suportar; documentar)
- código inline com `@foo` → ainda parseado (decisão: simples > correto). Documentar.

### 7.4 API

| Método | Endpoint | Notas |
|---|---|---|
| `POST` | `/api/tasks/[id]/comments` | Cria. Server **reparseia mentions** via `parseMentions(body, projectMembers)` e ignora ids do client (defesa). |
| `PATCH` | `/api/tasks/[id]/comments/[cid]` | Edita body; checa `authorMemberId === currentMember`. Reparseia mentions. Seta `editedAt = now()`. |
| `DELETE` | `/api/tasks/[id]/comments/[cid]` | Soft delete. Mesmo check de autor. |
| `GET` | `/api/tasks/[id]/feed` | Novo. Aceita `?before&limit`. |

**Sobre `/api/tasks/[id]/activity`:** mantém funcionando até `<TaskFeed>`
mergear; depois remove no mesmo PR (não em commits separados — evita componente
quebrado intermediário). Inverso do V1: V1 sugeria deprecation gradual; V2 faz
swap atômico no PR2.

### 7.5 UI — `<TaskFeed>` substitui `<TaskActivitySection>`

Reescreve o componente. Estrutura:

```
<TaskFeed taskId members currentMember>
  <FeedTimeline order="asc">
    <CommentItem />            -- markdown render + edit/delete inline
    <ActivityItem />           -- como hoje, mas com renderers expandidos
  </FeedTimeline>
  <CommentComposer />          -- editor markdown + mention picker
</TaskFeed>
```

**Ordem ASC** (como GitHub Issues, Trello). Composer no fim. "Carregar mais"
carrega *acima*.

**Composer:**
- `<Textarea>` simples + toolbar minimalista (B, I, link, código). Sem TipTap.
- Mention: detector `@` → popover com lista filtrada de `members` (já passado pelo TaskSheet). Insere `@<slug>` no texto + adiciona id em `mentionedMemberIds` em estado.
- `Cmd+Enter` envia.
- **Optimistic via `useOptimisticCollection` na coleção de comments só** — não na coleção mista (correção do V1 §5).
- Activities chegam via fetch normal e mergeiam no render. Sem optimistic em activities (não há mutation client → activity).

**Item:**
- Avatar com inicial (Member não tem `avatar_url`).
- Markdown render via [src/components/ui/markdown.tsx](../src/components/ui/markdown.tsx).
- Hover do timestamp mostra absoluto via Tooltip.
- "Editar" / "Apagar" só pro autor; aparece no hover.

**Normalizar `taskId` (M+ V1 mencionou):** prop explícita pro `<TaskFeed>`, sem
`(task as Task & { __id?: string }).__id` ([task-sheet.tsx:669](../src/components/story-hierarchy/task-sheet.tsx#L669)).

### 7.6 Soft-delete — comportamento de UI

Render de `CommentItem` quando `deletedAt != null`:

```
[ícone trash dim] comentário removido por João · há 2d
```

- Body do markdown não renderiza (mas continua no DB).
- Mentions ainda apontam pro `commentId`; quando notif clicada, scroll vai pra esse item e mostra o "removido". (R5)
- Edit/delete inline some.

### Critério de aceite — Fase 2

- [ ] Posto comentário com `@joão está bloqueado` → aparece optimisticamente, depois reconcilia
- [ ] Edito comentário → fica `(editado)` com tooltip do `editedAt`
- [ ] Apago → vira "comentário removido" mantendo o lugar no thread
- [ ] Tento editar comentário de outro autor via `curl PATCH` → 403 (RLS + rota)
- [ ] Tento deletar via `curl DELETE` autor diferente → 403
- [ ] Mention de membro fora do projeto → ignorada server-side
- [ ] 2 membros com mesmo nome → mention disambigua via sufixo de uuid
- [ ] 51º comentário não aparece sem clicar "carregar mais"
- [ ] Página com 200 comentários renderiza sem jank perceptível (medir com perf trace)
- [ ] `parseMentions` testes unitários passam
- [ ] Admin impersonando posta comment → autor é o membro impersonado

**Estimativa:** ~3 dias (mantida do V1, agora com testes inclusos).

---

## 8. Fase 3 — Notificações in-app de @mention

> **Objetivo:** ser mencionado dispara notificação visível na UI.

### 8.1 Migration `20260504_notifications.sql`

```sql
BEGIN;

CREATE TABLE "Notification" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "memberId"    uuid NOT NULL REFERENCES "Member"(id) ON DELETE CASCADE,
  type          text NOT NULL,
  payload       jsonb NOT NULL,
  "readAt"      timestamptz,
  "createdAt"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON "Notification" ("memberId", "readAt", "createdAt" DESC);

-- Dedupe: só uma notif não-lida por (member, comment) (R4 + race em edit rápido)
CREATE UNIQUE INDEX "notif_unread_per_comment"
  ON "Notification" ("memberId", (payload->>'commentId'))
  WHERE "readAt" IS NULL AND type = 'task_mention';

ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif_self_read" ON "Notification" FOR SELECT
  USING ("memberId" IN (SELECT id FROM "Member" WHERE "userId" = auth.uid()));

CREATE POLICY "notif_self_update" ON "Notification" FOR UPDATE
  USING ("memberId" IN (SELECT id FROM "Member" WHERE "userId" = auth.uid()));

-- Insert via service_role apenas (rota faz com elevated client). Sem policy de insert.

COMMIT;
```

Genérica: `type` + `payload`. Permite estender pra `task_assigned`,
`sprint_starting`, `comment_reply` sem schema change.

Payload típico de `task_mention`:
`{ taskId, taskRef, commentId, actorMemberId, snippet }`.

### 8.2 Disparo

No `createComment` / `editComment`:
- Calcular `mentionsToNotify` = `(novos mentionedMemberIds)` menos `actorMemberId` (auto-mention silenciada). Em edit, diff contra anterior.
- `INSERT ... ON CONFLICT DO NOTHING` no `Notification`. O partial unique idx faz dedupe automático: se já existe não-lida pro mesmo `commentId` no mesmo membro, no-op.
- **Comportamento "reabre notif após read":** se a notif anterior foi marcada read e a mention reaparece numa edição, o partial unique idx **permite** o insert (porque ele só cobre `WHERE readAt IS NULL`). Documentar: "edições que mencionam de novo, depois de leitura prévia, **renotificam**". Comportamento esperado no Slack/GH.

**Snippet:** congelado no insert. Se autor edita texto mudando completamente,
notif mostra snippet antigo. Aceitável MVP — documentar como conhecido. Custo
de "snippet derivado on-read" (JOIN extra) não vale.

### 8.3 UI

- Bell icon no header do dashboard ([src/app/(dashboard)/](../src/app/(dashboard)/)).
- Dropdown com lista; clique navega pra `/tasks/[ref]?comment={id}` que abre TaskSheet + scroll pro comment.
  - Se comment foi soft-deleted desde o disparo da notif: TaskSheet abre, scroll para a posição original, mostra "comentário removido por X em Y". (R5)
- `PATCH /api/notifications/[id]/read` ou bulk `POST /notifications/read-all`.
- Polling 60s + safeguards:
  - **`document.visibilityState === "visible"`** — sem polling em tab background
  - **localStorage cache** do count `unread` com TTL 30s — evita refetch em cada navegação
  - **Backoff exponencial** após erros consecutivos (1, 2, 4, 8min, max 8min)

### 8.4 Suporte a `?comment=<id>` na rota da TaskSheet

Verificar se a rota existe; provavelmente não. Adicionar nessa fase:
- TaskSheet lê `searchParams.comment`
- `useEffect` faz scroll para `[data-comment-id="${id}"]` + highlight visual fade-out de 3s

### Critério de aceite — Fase 3

- [ ] João é mencionado → bell ganha badge em até 60s
- [ ] Clica na notif → vai pra TaskSheet, comentário em destaque, marcada como lida
- [ ] Auto-mention não dispara notificação
- [ ] Edição que adiciona menção dispara só pro membro novo
- [ ] Edição que remove menção não desnotifica (mas não duplica)
- [ ] Tab em background não polling (verificar via DevTools network)
- [ ] Notif clicada de comment soft-deleted: scroll funciona, mostra "removido"
- [ ] `INSERT` concorrente do mesmo (member, commentId) → 1 row vence, outras viram no-op (sem 500)
- [ ] Apagar comentário (soft) **não** apaga a notif (R5)

**Estimativa:** ~2 dias.

---

## 9. Sequência sugerida

1. **Fase 1** primeiro — entrega audit trail real sem refactor visual.
2. **Fase 2** — coração da feature. Todas as decisões R8/R10/R11/R12/R13 já estão fechadas em §3.
3. **Fase 3** — desbloqueada após Fase 2 mergear.

**Total V2:** ~7 dias úteis. ±20% → **6–8 dias**. Aumento vs V1 (~5–7) por
causa de M1 snapshot helper, M7 testes, R5 link de notif para comment removido.

3 PRs sequenciais.

---

## 10. Remoção da seção "Definition of Done · projeto"

[task-sheet.tsx:672-681](../src/components/story-hierarchy/task-sheet.tsx#L672-L681)
hoje ocupa o final do body. Decisão: **remover da TaskSheet**. DoD continua
editável nas settings do projeto (onde já vive a fonte da verdade); a TaskSheet
não é o lugar dela. Feed ocupa o espaço liberado.

```
… campos editáveis …
<Separator />
<AcList />
<Separator />
<TaskFeed />            -- novo, ocupa o espaço inteiro liberado
```

---

## 11. Decisões adiadas (fora deste plano)

| Item | Por quê adiar | Custo de adiar |
|---|---|---|
| **View `TaskFeedItem`** | Merge in-memory cobre MVP; view só vale se `getFeedForTask` aparecer em flame graph | Zero — troca interna do DAL |
| **Anexos de imagem** | Storage policies + bucket + thumb pipeline merecem ciclo próprio | Zero — schema dos comentários não muda |
| **Mentions de squads/grupos** (`@frontend`) | Precisa modelo de squad antes | Zero — mesmo schema |
| **Reactions** (`👍`) | Não é fricção real hoje | Zero — tabela à parte |
| **E-mail de mention** | Depende de transactional email infra | Zero — `Notification` já é canônico |
| **Realtime do feed** | Polling cobre MVP | Zero — troca de hook |
| **Edit history de comment** | "comentário foi editado X vezes" útil mas não bloqueia | Zero — adiciona `TaskCommentEdit` table depois |

---

## 12. Tabela de tasks (organização de execução)

> Cada linha vira uma task no projeto. IDs com prefixo `AF` só para referência.

### PR 1 — Fase 1 (Eventos automáticos) ✅ ENTREGUE

| ID | Task | Status |
|---|---|---|
| AF-1 | Estender `TaskActivityType` em [task-activity.ts](../src/lib/dal/task-activity.ts) | ✅ |
| AF-2 | Criar `task-snapshot.ts` com `snapshotTaskHydrated()` | ✅ |
| AF-3 | Criar `task-activity-recorder.ts` (`recordTaskChanges` / `recordTaskCreated` / `recordAcceptanceChanges`) | ✅ |
| AF-3.5 | Testes unit do recorder | ⏭️ skipped (sem test runner no projeto) |
| AF-4 | Plugar recorder em `PUT /api/tasks/[id]` | ✅ |
| AF-5 | Plugar recorder em `POST /api/tasks` (`created`) | ✅ |
| AF-6 | Plugar recorder nas 3 rotas de AC | ✅ |
| AF-7 | Plugar recorder em `tags/route.ts` e `move-to-story/route.ts` | ✅ |
| AF-7.5–7.7 | Migrar `task-sheet-by-ref.tsx` (handleSave/Sprint/Assignees) → `PUT /api/tasks/[id]` | ✅ (descoberto durante AF-8 — caminho A) |
| AF-8 | Debounce client-side de title/description ([use-field-debounce.ts](../src/hooks/use-field-debounce.ts)) | ✅ |
| AF-9 | Renderers expandidos ([activity-renderers.tsx](../src/components/story-hierarchy/activity-renderers.tsx)) | ✅ |
| AF-9.5 | Empty state na seção "Atividade" ("Sem atividade ainda.") | ✅ (2026-05-02) |
| AF-10 | Teste manual: critérios §6 | 🟡 pendente (usuário) |

**Total Fase 1:** ~17h gastos. Caminho A (migração de `task-sheet-by-ref`) adicionou ~1.5h não orçada — saldo final dentro da margem.

### PR 2 — Fase 2 (Comentários)

| ID | Task | Depende | Esforço |
|---|---|---|---|
| AF-11 | Migration `20260502_task_comments.sql` (policies UPDATE/DELETE explícitas, body 16k, author nullable) | PR1 | 1.5h |
| AF-12 | Atualizar [database.types.ts](../src/lib/supabase/database.types.ts) | AF-11 | 0.5h |
| AF-13 | DAL `src/lib/dal/task-comments.ts` (CRUD + `parseMentions` puro com slug + disambiguação) | AF-12 | 3.5h |
| AF-13.5 | Testes unit `parseMentions` (slug, disambiguação, edge cases) | AF-13 | 1h |
| AF-14 | DAL `getFeedForTask` (2-fetch paralelo + merge in-memory, sem view) | AF-12 | 1.5h |
| AF-15 | Endpoints `POST/PATCH/DELETE /comments` + `GET /feed` | AF-13, AF-14 | 3h |
| AF-16 | `<CommentComposer>` (textarea + toolbar markdown + mention picker via `@` + `Cmd+Enter`) | AF-13 | 4h |
| AF-17 | `<TaskFeed>` (timeline ASC, paginação `before`, optimistic só na coleção de comments) | AF-15, AF-16 | 4h |
| AF-18 | Migrar TaskSheet: trocar `<TaskActivitySection>` por `<TaskFeed>`, **remover bloco DoD** ([task-sheet.tsx:672-681](../src/components/story-hierarchy/task-sheet.tsx#L672-L681)), normalizar prop `taskId` (sem cast `__id`), remover endpoint `/activity` no mesmo commit | AF-17 | 2h |
| AF-19 | Teste manual: critérios §7 + auditoria RLS via `curl` direto | todos acima | 2h |

**Total Fase 2:** ~23.5h ≈ 3 dias.

### PR 3 — Fase 3 (Notificações)

| ID | Task | Depende | Esforço |
|---|---|---|---|
| AF-20 | Migration `20260504_notifications.sql` (partial unique idx pra dedupe) | PR2 | 1h |
| AF-21 | Atualizar `database.types.ts` | AF-20 | 0.5h |
| AF-22 | Disparo de notif em `createComment` / `editComment` (filtra auto-mention, diff em edit, `ON CONFLICT DO NOTHING`) | AF-20 | 2h |
| AF-23 | Endpoints `GET /api/notifications`, `PATCH /[id]/read`, `POST /read-all` | AF-20 | 2h |
| AF-24 | `<NotificationBell>` no header do dashboard | AF-23 | 3h |
| AF-25 | Polling visibility-aware + localStorage cache + backoff | AF-24 | 2h |
| AF-26 | Suporte `?comment=<id>` na rota da TaskSheet (scroll + highlight 3s; comporta soft-deleted) | AF-24 | 2h |
| AF-27 | Teste manual: critérios §8 | todos acima | 1.5h |

**Total Fase 3:** ~14h ≈ 2 dias.

**Total V2:** ~54.5h ≈ 7 dias úteis. ±20% → **6–8 dias**.

---

## 13. Checklist pré-merge (todos os PRs)

- [ ] Migrations rodadas via `psql "$DIRECT_URL" -f ...` (nunca pelo Dashboard — ver [AGENTS.md](../../AGENTS.md))
- [ ] `database.types.ts` regenerado e commitado
- [ ] RLS testada com usuário não-membro (deve receber 403/empty)
- [ ] RLS testada com membro não-autor tentando UPDATE/DELETE comment alheio (PR2)
- [ ] Optimistic rollback testado (network throttle + erro 500 forçado)
- [ ] `getActorMemberId()` usado em todos os disparos de activity (R3 — impersonation correta) — verificado por busca de "actorMemberId" no recorder
- [ ] Recorder pluga **só nos endpoints**, nunca em DAL (R11) — verificado por busca de `recordTaskChanges` em `src/lib/dal/`
- [ ] Concurrent writes do mesmo campo não causam race em `TaskActivity`
- [ ] Testes unitários passam (`recordTaskChanges`, `parseMentions`)
- [ ] Lighthouse / sem regressão visual perceptível na TaskSheet
- [ ] Commit no padrão `ZRD-JM-NN: …` via `bash scripts/sync-main.sh -m "…"`

---

## 14. Quickstart para o agente da Fase 2

**Você é o próximo agente assumindo este plano. Faça nesta ordem:**

1. Leia §0.5 (estado de implementação) — entenda o que já existe.
2. Leia §3 (decisões fechadas) — não reabra debates de R1–R13.
3. Leia §7.0 (handoff) — orientações específicas pra Fase 2.
4. Leia §7.1–§7.5 — o "como fazer" de cada parte.
5. Comece em §12 PR2, AF-11 (migration). Siga em ordem; não pule.

**Comandos essenciais:**

```bash
# Subir dev server
npm run dev

# Rodar a migration (substituir <filename>)
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && \
  psql "$DIRECT_URL" -f supabase/migrations/<filename>.sql

# Regerar types após migration
npm run db:types

# Typecheck e lint
npx tsc --noEmit
npx eslint <arquivos modificados>

# Commit final
bash scripts/sync-main.sh -m "ZRD-JM-NN: feed — Fase 2 (comments + mentions)"
```

**Arquivos da Fase 1 que você vai TOCAR (mas não quebrar):**
- [src/components/story-hierarchy/task-sheet.tsx](../src/components/story-hierarchy/task-sheet.tsx) (AF-18: troca componente, props já existem)
- [src/components/story-hierarchy/activity-renderers.tsx](../src/components/story-hierarchy/activity-renderers.tsx) (REUTILIZA — vai ser chamado pelo `<TaskFeed>` para os items kind=activity)

**Arquivos da Fase 1 a APAGAR no PR2 (AF-18):**
- [src/components/story-hierarchy/task-activity-section.tsx](../src/components/story-hierarchy/task-activity-section.tsx) — substituído por `<TaskFeed>`
- [src/app/api/tasks/[id]/activity/route.ts](../src/app/api/tasks/[id]/activity/route.ts) — substituído por `/feed`

**Arquivos da Fase 1 a NÃO TOCAR:**
- `src/lib/dal/task-activity.ts`, `task-snapshot.ts`, `task-activity-recorder.ts` — estáveis, em uso pelos endpoints.
- 7 endpoints já instrumentados (PUT/POST tasks, 3 AC, tags, move-to-story) — funcionam, não precisam de mudança.
- `src/hooks/use-field-debounce.ts` — pode reutilizar se precisar de debounce no composer; senão, deixe.

**Não adicione test runner.** O projeto não tem. Se você quiser garantia em `parseMentions`, faça um arquivo `src/lib/dal/__manual_tests__/parse-mentions.md` com casos verificados manualmente, e siga.

**Quando estiver pronto:** sinalize para o usuário fazer AF-19 (teste manual + curl da RLS) antes do commit final.
