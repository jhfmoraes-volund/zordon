# Activity Feed na Task Sheet — Plano

> **Status:** revisado · **Autor:** discussão JM ↔ Claude · **Data:** 2026-05-01
> **Escopo confirmado:** comentários + log de eventos automáticos + @mentions + notificações in-app. Anexos de imagem ficam para um próximo ciclo.

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
   projeto. (Anexos: fora de escopo neste plano.)
2. **Eventos automáticos** — status changed, assignee changed, sprint changed,
   FP/scope/complexity, AC checked, tags, links, sub-tasks.

Cada item exibe ator, ação, timestamp relativo (`há 2h`) com absoluto no hover.
O histórico automático elimina a pergunta "por que essa task ainda está
parada?".

---

## 2. O que já existe (não reinventar)

| Recurso | Localização | Estado atual |
|---|---|---|
| Tabela `TaskActivity` | [supabase/migrations/20260501_task_activity.sql](../supabase/migrations/20260501_task_activity.sql) | Existe, com RLS por membership. Hoje guarda apenas `duplicated`, `cloned_to`, `cloned_from`. |
| DAL de activity | [src/lib/dal/task-activity.ts](../src/lib/dal/task-activity.ts) | `createActivity()` + `getActivityForTask()` prontos. |
| Endpoint | `GET /api/tasks/[id]/activity` | Lê o feed atual (read-only). |
| Componente | [task-activity-section.tsx](../src/components/story-hierarchy/task-activity-section.tsx) | Render minimalista de 3 tipos. Será reescrito. |
| Markdown | [src/components/ui/markdown.tsx](../src/components/ui/markdown.tsx) | Wrapper de `react-markdown` com collapse. |
| Optimistic | [use-optimistic-collection.ts](../src/hooks/use-optimistic-collection.ts) + [src/lib/optimistic/](../src/lib/optimistic/) (`reconcile.ts`, `toast.ts`) | Hook + reconcile + classify/retry de erros. **Sem `retry policy` separado** — está em `toast.ts` (`withServerRetry`, `isRetryable`). |
| Resolver de ator | [src/lib/dal.ts](../src/lib/dal.ts) → `getCurrentMember()` / `getActorMemberId()` | Já lida com impersonation. Usar isso em todos os disparos de activity. |

**Falta:** comentários como entidade, eventos automáticos plugados nas
mutations, @mention + notificações, redesign visual do feed.

---

## 3. Riscos e decisões abertas (resolver antes de codar)

Itens onde uma escolha errada vira refactor caro depois. Cada um precisa de
sinal verde antes de iniciar a fase respectiva.

| # | Decisão | Recomendação | Impacto se errar |
|---|---|---|---|
| R1 | **1 entidade ou 2** (comentários vs eventos) | 2 tabelas (`TaskComment` + `TaskActivity`) com union view. Ver §4. | Refatorar schema depois com dados em produção. |
| R2 | **Atividade dentro ou fora da transação** do update | **Fora**, best-effort, log e segue. Activity é metadado. | Falha de log derruba mutation principal → bug crítico de UX. |
| R3 | **Quem é o "ator"** quando admin impersona | Usar `getActorMemberId()` (já resolve impersonation corretamente — ver [dal.ts:244-258](../src/lib/dal.ts#L244-L258)). | Auditoria mente sobre quem fez o quê. |
| R4 | **Edição de comentário com mentions** dispara nova notificação? | Sim, **só para mentions novos** (diff). Edição que tira menção não desnotifica. | Spam de notificação ou silêncio inesperado. |
| R5 | **Soft delete de comentário** preserva mentions/notificações? | Sim. Notificações ficam intactas; render do comentário vira "removido". | Perda de auditoria; usuário sente "fantasma" no inbox. |
| R6 | **Paginação do feed** | Cursor `?before=<createdAt>&limit=50` já na v1. | Rewrite quando uma task tiver 200+ eventos. |
| R7 | **Realtime** | Polling 60s no MVP. Supabase Channels depois (troca de hook, sem schema change). | Nada — adiável sem custo. |
| R8 | **Composer de markdown** | `<Textarea>` puro, sem TipTap/Lexical. Render usa o `markdown.tsx` existente. | Overkill: TipTap adiciona ~300kb e meses de manutenção. |
| R9 | **`mentionedMemberIds` denormalizado** | Sim, em coluna `uuid[]`. Fonte da verdade pra notificação. | Reparsear o body em todo lugar; bug quando edição muda mentions. |

---

## 4. Decisão central: 1 entidade ou 2?

**Opção A — Tudo dentro de `TaskActivity`**: comentários viram `type='comment'`
com `payload = { body, mentions }`.

**Opção B — `TaskComment` separado + `TaskActivity` para eventos**: feed é a
*união* das duas tabelas ordenadas por timestamp.

**Decisão: B, com union view.** Comentários têm ciclo de vida diferente
(editáveis, deletáveis, mentions). Misturá-los em `payload jsonb` espalha a
regra de negócio em vários lugares e dificulta queries (ex: "todos comentários
de um membro", "tasks com comentários não lidos"). Eventos automáticos são
*imutáveis* — nasceram pra serem append-only. Misturar imutável com mutável em
uma tabela só vira dor depois.

**Trade-off aceito:** B exige uma `view` (`TaskFeedItem`) que une as duas
tabelas para paginação cronológica. View simples, ganho de modelar comentários
como entidade própria paga rápido.

> ⚠ **Cuidado com a view.** `UNION ALL` entre tabelas com colunas
> heterogêneas força `NULL::tipo` em metade das colunas — funciona, mas o
> planner não usa o índice de `TaskActivity` quando a query final faz `ORDER BY
> "createdAt" DESC LIMIT 50`. **Validar com `EXPLAIN ANALYZE`** numa task com
> 500+ items. Se vier ruim, plano B é fazer 2 fetches paralelos no DAL e
> mergear no Node — mais simples e tipicamente mais rápido em cardinalidade
> baixa.

---

## 5. Princípios de implementação

- **Renderers como mapa**, não switch enorme. `const renderers: Record<TaskActivityType, (item) => ReactNode>`. Adicionar tipo = adicionar entrada.
- **Recorder defensivo**: `createActivity` em `try/catch`, log e segue. Activity é metadado — não pode quebrar o write principal. (R2)
- **Fora da transação do update**. Update commita primeiro, activity é registrada depois. Falha de activity vira log no servidor, não 500 pro cliente. (R2)
- **Paginação desde o início**: feed cresce sem limite. Endpoint aceita `?before=<cursor>&limit=50`. Carregar 50, "carregar mais" depois. Barato agora, caro retroativo. (R6)
- **Optimistic em comentários**: encaixa direto no `useOptimisticCollection` — tempId, reconcile pelo id real. Erro 403 → toast contextualizado + rollback automático.
- **Mention parser puro**: `parseMentions(body, members)` retorna ids únicos válidos. Usado no client (preview) e no server (validação). Mesma função, código de [src/lib/](../src/lib/).
- **Markdown puro armazenado**, render derivado. Nunca guardar HTML.
- **Soft delete em comentários**: preserva continuidade do thread. (R5)
- **Ator resolvido via `getActorMemberId()`**, sempre. Nunca passar `auth.uid()` cru. (R3)

---

## 6. Fase 1 — Eventos automáticos (sem UI nova)

> **Objetivo:** task vira "auditável". Cada mutation já existente registra uma
> activity. UI continua a mesma — só preencher o feed que está vazio.

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
  | "ac_added" | "ac_removed" | "ac_checked" | "ac_unchecked" | "ac_edited"
  | "title_edited"
  | "description_edited"
  | "duplicated" | "cloned_to" | "cloned_from"; // existentes
```

Payload convention: `{ before, after, ...context }`. Ex:
`status_changed → { before: "todo", after: "in_progress" }`.

> ⚠ **`title_edited` e `description_edited` ruidosos.** A TaskSheet faz
> persist on-blur por campo ([task-sheet.tsx:656](../src/components/story-hierarchy/task-sheet.tsx#L656)).
> Se o usuário entra/sai do textarea 5x, gera 5 events idênticos. **Mitigação:**
> recorder ignora quando `before === after` (já necessário) **e** debounce
> server-side: se houver `title_edited` do mesmo ator nos últimos 2min,
> *atualizar* o `after` do último em vez de criar um novo. Documentar essa regra
> no recorder. Sem isso, o feed vira poluição.

### 6.2 Helper `recordTaskChanges`

Novo arquivo `src/lib/dal/task-activity-recorder.ts` com diff field-by-field;
emite uma activity por campo alterado. Centraliza a lógica para não repetir em
cada route.

**Por que separar do DAL base:** o recorder tem regras de negócio (quais campos
auditar, como nomear). O DAL só persiste. Mantém [task-activity.ts](../src/lib/dal/task-activity.ts) puro.

```ts
export async function recordTaskChanges(
  taskId: string,
  before: TaskRow,
  after: TaskRow,
  actorMemberId: string | null,
): Promise<void>
```

> ⚠ **Tipagem de `before`/`after`.** `TaskRow` puro não basta — alguns eventos
> precisam de **contexto hidratado** (ex: `assignees_changed` quer nomes para
> renderizar; `sprint_changed` quer nome do sprint, não só id). Recomendação:
> recorder grava só ids no payload e o renderer hidrata na leitura via prop
> `members` / `sprints` já passada pelo TaskSheet. Evita race condition de
> dados defasados no payload (ex: membro renomeado).

### 6.3 Plugar nos endpoints existentes

| Endpoint | Eventos a emitir | Observação |
|---|---|---|
| [PUT /api/tasks/[id]](../src/app/api/tasks/[id]/route.ts) | `status_changed`, `assignees_changed`, `sprint_changed`, `story_changed`, `fp_changed`, `scope_changed`, `complexity_changed`, `type_changed`, `title_edited`, `description_edited`, `tags_changed` | **Já busca `current` antes do update** ([linha 55-59](../src/app/api/tasks/[id]/route.ts#L55-L59)) — perfeito para `before`. Adicionar `recordTaskChanges` após linha 87. |
| [POST /api/tasks](../src/app/api/tasks/route.ts) | `created` | Payload mínimo: id e título. |
| [/api/tasks/[id]/acceptance](../src/app/api/tasks/[id]/acceptance/route.ts) | `ac_added` | |
| [/api/tasks/[id]/acceptance/[acId]](../src/app/api/tasks/[id]/acceptance/[acId]/route.ts) | `ac_checked` / `ac_unchecked` / `ac_edited` / `ac_removed` | |
| [/api/tasks/[id]/acceptance/bulk](../src/app/api/tasks/[id]/acceptance/bulk/route.ts) | Idem em batch — **emitir 1 event por AC ou 1 batch event?** Ver crítica. |
| [/api/tasks/[id]/tags](../src/app/api/tasks/[id]/tags/route.ts) | `tags_changed` (1 event com diff completo) | |
| [/api/tasks/[id]/move-to-story](../src/app/api/tasks/[id]/move-to-story/route.ts) | `story_changed` | |

> ⚠ **Bulk de AC: eventos individuais ou agregados?** Toggle bulk de 12 ACs
> gera 12 linhas no feed. Recomendação: **1 evento `ac_bulk_changed`** com
> `payload = { added: [...], removed: [...], checked: [...], unchecked: [...] }`.
> Renderer mostra resumo ("João marcou 4 ACs"). Ouvinte expande no hover se
> quiser detalhe. Mesma regra para `tags_changed` (já é diff agregado). Padrão
> consistente.

> ⚠ **Tags via PUT vs endpoint dedicado.** `PUT /api/tasks/[id]` *também* aceita
> `tagIds` ([linha 77-85](../src/app/api/tasks/[id]/route.ts#L77-L85)). Quem
> emite o `tags_changed`? **Decisão:** o recorder no PUT diff'a `tagIds` — se
> mudou, emite. Endpoint `/tags` chama `recordTaskChanges` também. Toda emissão
> passa por **um** lugar (recorder), nunca espalhada.

> ⚠ **Migration falta — tipo `text`, não enum.** A coluna `TaskActivity.type`
> hoje é `text` ([20260501_task_activity.sql:7](../supabase/migrations/20260501_task_activity.sql#L7))
> sem CHECK. Ótimo: não precisa de migration pra adicionar tipos novos. Manter
> assim — enum no Postgres é caro de evoluir. A constraint vive no TS.

**Regra:** atividade é registrada *após* o commit do update bem-sucedido.
Falha no `createActivity` faz log mas não derruba a request.

### 6.4 Renderizar os novos tipos

Estender `renderItem` em [task-activity-section.tsx](../src/components/story-hierarchy/task-activity-section.tsx).
Extrair pra `src/components/story-hierarchy/activity-renderers.tsx` com map
`type → renderer` para crescer limpo.

### Critério de aceite — Fase 1

- [ ] Mudar status na TaskSheet → feed mostra `João mudou status: todo → in_progress · há 2s`
- [ ] Adicionar/remover assignee → feed mostra `João adicionou Maria · há 5s`
- [ ] Editar title 5x em sequência → feed mostra **1** evento (debounce de 2min funcionando)
- [ ] Bulk-toggle 4 ACs → feed mostra **1** linha agregada
- [ ] Forçar erro no `createActivity` (ex: derrubar tabela em dev) → mutation principal continua passando, erro só no log
- [ ] `EXPLAIN` no GET do feed: usa o índice `TaskActivity_taskId_createdAt_idx`

**Estimativa revisada:** ~1.5 dias (originalmente 1 dia — debounce + bulk
agregado + recorder testado direito custam o meio-dia extra).

---

## 7. Fase 2 — Comentários (texto + markdown + mention)

> **Objetivo:** sair do "log read-only" pra "discussion thread".

### 7.1 Migration `20260502_task_comments.sql`

```sql
CREATE TABLE public."TaskComment" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "taskId"        uuid NOT NULL REFERENCES "Task"(id) ON DELETE CASCADE,
  "authorMemberId" uuid NOT NULL REFERENCES "Member"(id) ON DELETE RESTRICT,
  body            text NOT NULL CHECK (char_length(body) > 0 AND char_length(body) <= 8000),
  "mentionedMemberIds" uuid[] NOT NULL DEFAULT '{}',
  "editedAt"      timestamptz,
  "deletedAt"     timestamptz,
  "createdAt"     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON "TaskComment" ("taskId", "createdAt" DESC);
CREATE INDEX ON "TaskComment" USING gin ("mentionedMemberIds");

-- RLS: ler exige membership; escrever exige authorMemberId = current member.
```

> ⚠ **RLS de UPDATE/DELETE precisa ser explícito.** Plano só citou
> "escrever exige authorMemberId = current". Faltam policies separadas para
> `UPDATE` e `DELETE`. Sem elas qualquer membro do projeto pode editar/apagar
> comentário alheio. Adicionar:
> ```sql
> CREATE POLICY "comment_update" ON "TaskComment" FOR UPDATE
>   USING ("authorMemberId" IN (SELECT id FROM "Member" WHERE "userId" = auth.uid()));
> CREATE POLICY "comment_delete" ON "TaskComment" FOR DELETE
>   USING ("authorMemberId" IN (SELECT id FROM "Member" WHERE "userId" = auth.uid()));
> ```
> Admin override (apagar comentário ofensivo) faz na rota com `service_role` se
> precisar — não na policy.

> ⚠ **`ON DELETE RESTRICT` no author quebra remoção de membro.** Se um membro
> sai do time, não dá pra deletar a row do `Member`. Trocar por `ON DELETE SET
> NULL` e tornar `authorMemberId` nullable. Render mostra "ex-membro" quando
> null. Mesma lógica que `TaskActivity.actorMemberId` já usa
> ([20260501_task_activity.sql:9](../supabase/migrations/20260501_task_activity.sql#L9)).

> ⚠ **CHECK 8000 caracteres — generoso?** Trello limita ~16k. GitHub ~65k.
> 8000 é OK pra MVP, mas dá pra subir sem custo. Recomendo **16000** —
> ainda evita abuse, cobre 99% dos casos.

**Por que `mentionedMemberIds` denormalizado em coluna:** permite query
"minhas mentions" sem parsear o body. Fonte da verdade pra notificação — se o
autor edita e tira o `@joao`, ele não fica notificado eternamente.

**Por que soft delete:** apagar um comentário no meio do thread reescreve a
história. Soft delete vira "comentário removido" no render.

### 7.2 Migration `20260503_task_feed_view.sql`

```sql
CREATE OR REPLACE VIEW "TaskFeedItem" AS
  SELECT
    'activity' AS kind, id, "taskId", "createdAt",
    "actorMemberId" AS "memberId",
    type, payload, NULL::text AS body, NULL::uuid[] AS "mentionedMemberIds",
    NULL::timestamptz AS "editedAt", NULL::timestamptz AS "deletedAt"
  FROM "TaskActivity"
  UNION ALL
  SELECT
    'comment', id, "taskId", "createdAt",
    "authorMemberId", NULL, NULL, body, "mentionedMemberIds",
    "editedAt", "deletedAt"
  FROM "TaskComment";
```

DAL: `getFeedForTask(taskId, { limit, before })` lê dessa view, ordena DESC,
hidrata actor.

> ⚠ **View herda RLS das tabelas base?** No Postgres, view sem `security
> invoker` (default) **roda com permissão do owner** — RLS das tabelas base
> *não se aplica*. Adicionar `WITH (security_invoker = true)` na view (Postgres
> 15+, suportado pelo Supabase). Sem isso, qualquer usuário autenticado vê
> tudo. **Crítico para auditar antes de fazer deploy.**

> ⚠ **Plano alternativo se a view ficar lenta.** Já mencionado em §4. Se o
> `EXPLAIN ANALYZE` apontar seq scan, abandona a view e o DAL faz 2 queries
> (`TaskActivity` + `TaskComment` com mesmo `taskId`, `LIMIT 50` cada),
> merge in-memory por `createdAt`, `slice(0, 50)`. Trivial.

### 7.3 DAL `src/lib/dal/task-comments.ts`

- `createComment({ taskId, body, mentionedMemberIds, authorMemberId })`
- `editComment(id, body, mentionedMemberIds)` — **autorização na rota**, DAL só persiste
- `deleteComment(id)` — soft, mesma regra
- `parseMentions(body, projectMembers): string[]` — função pura

> ⚠ **`parseMentions` precisa especificar a sintaxe agora.** Plano não diz se
> é `@joão`, `@joao`, `@<uuid>`, `@joao_silva`. Recomendação:
> `@<slug>` onde slug = `member.name` lowercased + sem acentos + `-` no espaço.
> Salva o slug no body, resolve `slug → memberId` no parser. Edge case: 2
> membros com mesmo nome → suffixar com 4 chars do uuid (`@joao-silva-a3f2`).
> Decisão técnica que pode parecer pequena, mas impacta o picker, o storage e o
> render. **Resolver antes de codar.**

### 7.4 API

| Método | Endpoint | Notas |
|---|---|---|
| `POST` | `/api/tasks/[id]/comments` | Cria. Server reparseia mentions e ignora ids do client (defesa) |
| `PATCH` | `/api/tasks/[id]/comments/[cid]` | Edita body; checa `authorMemberId === currentMember` |
| `DELETE` | `/api/tasks/[id]/comments/[cid]` | Soft delete |
| `GET` | `/api/tasks/[id]/feed` | Substitui `/activity`. Aceita `?before&limit` |

> ⚠ **Manter `/api/tasks/[id]/activity` ou substituir?** O componente atual
> chama `/activity`. Plano diz que `/feed` "substitui". **Recomendação:**
> mantém `/activity` funcionando, cria `/feed` em paralelo, migra o componente
> e só **depois** remove `/activity`. Evita componente quebrado por 1 commit
> intermediário. Marcar `/activity` como deprecated em comentário.

### 7.5 UI — `<TaskFeed>` substitui `<TaskActivitySection>`

Reescreve [task-activity-section.tsx](../src/components/story-hierarchy/task-activity-section.tsx)
virando `<TaskFeed taskId members currentMember />`.

```
<TaskFeed>
  <CommentComposer />          -- editor markdown + mention picker
  <FeedTimeline>               -- lista cronológica reversa
    <CommentItem />            -- markdown render + edit/delete inline
    <ActivityItem />           -- como hoje, mas com renderers expandidos
  </FeedTimeline>
</TaskFeed>
```

**Composer:**
- `<Textarea>` simples + toolbar minimalista (B, I, link, código). **Sem
  TipTap/Lexical** — overkill, repo já tem `react-markdown` instalado
  ([package.json:45](../package.json#L45)).
- Mention: detector `@` no input → popover com lista filtrada de `members`
  (já passado como prop pelo TaskSheet). Insere `@<slug>` no texto e adiciona
  id no array `mentionedMemberIds` em estado.
- `Cmd+Enter` envia. Submit usa **mesmo padrão otimista** do resto
  ([useOptimisticCollection](../src/hooks/use-optimistic-collection.ts#L95)):
  comment aparece com `tempId` antes do servidor responder.

**Item:**
- Avatar com inicial (Member não tem `avatar_url`; círculo com inicial mantém
  consistência com o resto do app).
- Markdown render via [src/components/ui/markdown.tsx](../src/components/ui/markdown.tsx).
- Hover do timestamp mostra absoluto via [Tooltip](../src/components/ui/tooltip.tsx).
- Botão "Editar" / "Apagar" só pro autor; aparece no hover (ou kebab).

> ⚠ **Order: ascending ou descending?** Trello é ascendente (mais antigo em
> cima, composer no fim). GitHub Issues idem. O `task-activity-section.tsx`
> atual ordena DESC. **Recomendação:** virar ASC pro feed novo (mais natural
> pra leitura de thread). Composer fica no fim. "Carregar mais" carrega
> *acima*.

> ⚠ **`task` precisa expor `__id` consistentemente.** Hoje o componente lê
> `(task as Task & { __id?: string }).__id` ([task-sheet.tsx:669](../src/components/story-hierarchy/task-sheet.tsx#L669)).
> Esse cast é frágil. Aproveitar a fase pra normalizar — passar `taskId`
> explícito como prop ao `<TaskFeed>`. Sem cast inline.

### Critério de aceite — Fase 2

- [ ] Posto comentário com `@joão está bloqueado` → aparece optimisticamente, depois reconcilia
- [ ] Edito comentário → fica `(editado)` com tooltip do `editedAt`
- [ ] Apago → vira "comentário removido" mantendo o lugar no thread
- [ ] Tento editar comentário de outro autor via `curl PATCH` → 403 (RLS/rota)
- [ ] Mention de membro fora do projeto → ignorada server-side
- [ ] 51º comentário não aparece sem clicar "carregar mais"
- [ ] Página com 200 comentários renderiza sem jank perceptível

**Estimativa:** ~2.5–3 dias (composer com mention picker é o item caro).

---

## 8. Fase 3 — Notificações in-app de @mention

> **Objetivo:** ser mencionado dispara notificação visível na UI. Sem e-mail
> (futuro). Anexos foram retirados do escopo, então essa é a fase final.

### 8.1 Tabela `Notification`

```sql
CREATE TABLE "Notification" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "memberId"    uuid NOT NULL REFERENCES "Member"(id) ON DELETE CASCADE,
  type          text NOT NULL,
  payload       jsonb NOT NULL,
  "readAt"      timestamptz,
  "createdAt"   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON "Notification" ("memberId", "readAt", "createdAt" DESC);
```

**Genérica de propósito:** `type` + `payload`. Permite estender pra
`task_assigned`, `sprint_starting`, `comment_reply` sem schema change.

Payload típico de `task_mention`:
`{ taskId, taskRef, commentId, actorMemberId, snippet }`.

> ⚠ **Auto-mention.** João escreve `@joão lembrar de testar`. Plano não diz se
> auto-mention notifica. **Recomendação:** filtrar `mentionedMemberIds`
> removendo o próprio `authorMemberId` antes de inserir notificações.

> ⚠ **Snippet quebra com edição.** O `payload.snippet` é congelado no insert.
> Se o autor edita o comentário 5min depois mudando completamente o texto, a
> notificação ainda mostra o snippet antigo. Aceitável para MVP — documentar
> como conhecido. Alternativa: snippet derivado on-read via JOIN, mas custa
> uma query extra por notificação listada.

### 8.2 Disparo

No `createComment` / `editComment`: para cada `mentionedMemberId` novo (em
edit, diff contra o anterior pra não notificar 2x), insere `Notification` com
`type='task_mention'`. (R4)

> ⚠ **Race em edit rápido.** Se o usuário edita 3x em 10s adicionando/removendo
> a mesma mention, gera múltiplas notificações órfãs. Mitigação: dedupe por
> `(memberId, payload->>'commentId')` único parcial — só insere se não existe
> notificação não-lida do mesmo `commentId` para o mesmo `memberId`.
> Implementar como `INSERT ... ON CONFLICT DO NOTHING` com unique partial
> index:
> ```sql
> CREATE UNIQUE INDEX ON "Notification" ("memberId", (payload->>'commentId'))
>   WHERE "readAt" IS NULL AND type = 'task_mention';
> ```

### 8.3 UI

- Bell icon no header do dashboard ([src/app/(dashboard)/](../src/app/(dashboard)/)).
- Dropdown com lista; clique navega pra `/tasks/[ref]?comment={id}` que abre
  TaskSheet + scroll pro comment. **Requer suporte a query param na rota da
  task** — verificar se existe; se não, adicionar nessa fase.
- `PATCH /api/notifications/[id]/read` ou bulk `/notifications/read-all`.
- Polling simples (`fetch` 60s) pra MVP. Realtime (Supabase channels) é fácil
  depois — não bloqueia. (R7)

> ⚠ **Polling 60s × N usuários ativos.** 50 usuários ativos = 3000 hits/h só
> nessa rota. Aceitável, mas: (a) cachear count `unread` em
> `localStorage` com TTL pra evitar refetch em cada navegação; (b) só fazer
> polling com `document.visibilityState === "visible"`; (c) backoff
> exponencial após erros consecutivos.

### Critério de aceite — Fase 3

- [ ] João é mencionado → bell ganha badge em até 60s
- [ ] Clica na notificação → vai pra TaskSheet, comentário em destaque, marcada como lida
- [ ] Auto-mention não dispara notificação
- [ ] Edição que adiciona menção dispara só pro membro novo
- [ ] Edição que remove menção não desnotifica (mas não duplica também)
- [ ] Tab em background não polling
- [ ] Apagar comentário (soft) **não** apaga a notificação (R5)

**Estimativa:** ~1.5–2 dias.

---

## 9. Sequência sugerida

1. **Fase 1** primeiro — entrega valor imediato (audit trail real) sem
   refactor visual. Testa o pipeline de eventos.
2. **Fase 2** — coração da feature, depende de §3 R8 e R9 fechados.
3. **Fase 3** — desbloqueada após Fase 2 mergear.

**Total revisado:** ~5–7 dias de trabalho focado, em **3 PRs sequenciais**
(originalmente 4 — anexos saíram).

---

## 10. Substituição da seção "Definition of Done · projeto"

Hoje em [task-sheet.tsx:672-681](../src/components/story-hierarchy/task-sheet.tsx#L672-L681)
ocupando o final do body. Decisão: **manter DoD como collapsed/accordion no
rodapé** (referência rápida) e dar o destaque visual pro feed acima dela.

Posicionamento sugerido na TaskSheet:

```
… campos editáveis …
<Separator />
<AcList />
<Separator />
<TaskFeed />            -- novo, ocupa o espaço nobre
<DefinitionOfDone />    -- collapsed por default
```

---

## 11. Decisões adiadas (fora deste plano)

| Item | Por quê adiar | Custo de adiar |
|---|---|---|
| **Anexos de imagem** | Storage policies + bucket + thumb pipeline merecem ciclo próprio | Zero — schema dos comentários não muda |
| **Mentions de squads/grupos** (`@frontend`) | Precisa modelo de squad antes | Zero — mesmo schema de mentions |
| **Reactions** (`👍`) | Não é fricção real hoje | Zero — tabela `CommentReaction` à parte |
| **E-mail de mention** | Depende de transactional email infra | Zero — `Notification` já é canônico |
| **Realtime do feed** | Polling cobre MVP | Zero — troca de hook, sem schema |

---

## 12. Tabela de tasks (organização de execução)

> Cada linha vira uma task no projeto. IDs sugeridos com prefixo `AF` (Activity
> Feed) só para referência local — substituir pelo padrão real do board.

### PR 1 — Fase 1 (Eventos automáticos)

| ID | Task | Depende | Esforço |
|---|---|---|---|
| AF-1 | Estender `TaskActivityType` em [task-activity.ts](../src/lib/dal/task-activity.ts) | — | 0.5h |
| AF-2 | Criar `task-activity-recorder.ts` com `recordTaskChanges` (diff field-by-field, debounce de title/description) | AF-1 | 3h |
| AF-3 | Plugar recorder em `PUT /api/tasks/[id]` (cobre 8 dos 11 tipos de evento) | AF-2 | 1.5h |
| AF-4 | Plugar recorder em `POST /api/tasks` (`created`) | AF-2 | 0.5h |
| AF-5 | Plugar recorder nas 3 rotas de AC (`acceptance`, `acceptance/[acId]`, `acceptance/bulk` — bulk emite 1 evento agregado) | AF-2 | 1.5h |
| AF-6 | Plugar recorder em `tags/route.ts` e `move-to-story/route.ts` | AF-2 | 1h |
| AF-7 | Renderers expandidos: extrair `activity-renderers.tsx` com map `type → component` | AF-1 | 2h |
| AF-8 | Teste manual: percorrer critérios de aceite §6 | todos acima | 1h |

**Total Fase 1:** ~11h ≈ 1.5 dias.

### PR 2 — Fase 2 (Comentários)

| ID | Task | Depende | Esforço |
|---|---|---|---|
| AF-9 | **Decisão R8** (sintaxe de mention `@<slug>`) documentada no plano | — | 0.5h |
| AF-10 | Migration `20260502_task_comments.sql` (com policies UPDATE/DELETE corretas, `ON DELETE SET NULL` no author, body 16k) | AF-9 | 1.5h |
| AF-11 | Migration `20260503_task_feed_view.sql` com `WITH (security_invoker = true)` + benchmark `EXPLAIN ANALYZE` | AF-10, PR1 | 2h |
| AF-12 | Atualizar [database.types.ts](../src/lib/supabase/database.types.ts) | AF-10, AF-11 | 0.5h |
| AF-13 | DAL `src/lib/dal/task-comments.ts` (CRUD + `parseMentions` puro) | AF-12 | 3h |
| AF-14 | DAL `getFeedForTask` (com fallback in-memory merge se view ficar lenta) | AF-12 | 2h |
| AF-15 | Endpoints `POST/PATCH/DELETE /comments` + `GET /feed` (mantém `/activity` como deprecated) | AF-13, AF-14 | 3h |
| AF-16 | Componente `<CommentComposer>` (textarea + toolbar markdown + mention picker via `@` + `Cmd+Enter`) | AF-13 | 4h |
| AF-17 | Componente `<TaskFeed>` (timeline ASC, paginação `before`, optimistic via `useOptimisticCollection`) | AF-15, AF-16 | 4h |
| AF-18 | Migrar TaskSheet: remover `<TaskActivitySection>`, plugar `<TaskFeed>`, normalizar prop `taskId` (sem cast `__id`) | AF-17 | 1.5h |
| AF-19 | Adicionar DoD collapsed no rodapé | AF-18 | 0.5h |
| AF-20 | Teste manual: critérios §7 + auditoria de RLS via `curl` direto | todos acima | 1.5h |

**Total Fase 2:** ~24h ≈ 3 dias.

### PR 3 — Fase 3 (Notificações)

| ID | Task | Depende | Esforço |
|---|---|---|---|
| AF-21 | Migration `20260504_notifications.sql` (com partial unique index pra dedupe) | PR2 | 1h |
| AF-22 | Atualizar `database.types.ts` | AF-21 | 0.5h |
| AF-23 | Disparo de notificação em `createComment` / `editComment` (filtra auto-mention, diff em edit) | AF-21 | 2h |
| AF-24 | Endpoints `GET /api/notifications`, `PATCH /[id]/read`, `POST /read-all` | AF-21 | 2h |
| AF-25 | Componente `<NotificationBell>` no header do dashboard | AF-24 | 3h |
| AF-26 | Polling visibility-aware com cache local + backoff | AF-25 | 2h |
| AF-27 | Suporte a `?comment=<id>` no link da TaskSheet (scroll + highlight) | AF-25 | 1.5h |
| AF-28 | Teste manual: critérios §8 | todos acima | 1.5h |

**Total Fase 3:** ~13.5h ≈ 1.5–2 dias.

**Total geral revisado:** ~48h ≈ 6 dias úteis. Margem de erro ±20% → **5–7
dias**, conforme §9.

---

## 13. Checklist pré-merge (todos os PRs)

- [ ] Migrations rodadas via `psql "$DIRECT_URL" -f ...` (nunca pelo Dashboard — ver [AGENTS.md](../AGENTS.md))
- [ ] `database.types.ts` regenerado e commitado
- [ ] RLS testada com usuário não-membro (deve receber 403/empty)
- [ ] `EXPLAIN ANALYZE` no GET do feed em task com 200+ items
- [ ] Optimistic rollback testado (network throttle + erro 500 forçado)
- [ ] `getActorMemberId()` usado em todos os disparos de activity (R3 — impersonation correta)
- [ ] Lighthouse / sem regressão visual perceptível na TaskSheet
- [ ] Commit no padrão `ZRD-JM-NN: …` via `bash scripts/sync-main.sh -m "…"`
