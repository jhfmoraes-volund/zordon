# Activity Feed na Task Sheet — Plano

> **Status:** rascunho · **Autor:** discussão JM ↔ Claude · **Data:** 2026-05-01

## Contexto e motivação

Hoje toda comunicação sobre uma task acontece fora do Zordon (Telegram, Roam) e
se perde. Quando um dev pega uma task semanas depois, não há contexto de
decisões anteriores. A seção atual `Definition of Done · projeto` na TaskSheet é
quase decorativa — ocupa espaço mas é pouco lida.

A proposta troca essa seção por um **feed de atividade** com dois tipos de
entrada:

1. **Comentários manuais** — texto livre, markdown básico, @mention de membros
   do projeto, anexo de imagens (jpg/png).
2. **Eventos automáticos** — status changed, assignee changed, sprint changed,
   FP/scope/complexity, AC checked, tags, links, sub-tasks.

Cada item exibe ator, ação, timestamp relativo (`há 2h`) com absoluto no hover.
O histórico automático elimina a pergunta "por que essa task ainda está
parada?".

## O que já existe (não reinventar)

- **Tabela `TaskActivity`** — [supabase/migrations/20260501_task_activity.sql](../supabase/migrations/20260501_task_activity.sql)
  com `id`, `taskId`, `type`, `payload jsonb`, `actorMemberId`, `createdAt` e
  RLS por membership de projeto. Hoje guarda apenas `duplicated`, `cloned_to`,
  `cloned_from`.
- **DAL** — [src/lib/dal/task-activity.ts](../src/lib/dal/task-activity.ts) com
  `createActivity()` e `getActivityForTask()`.
- **Endpoint** — `GET /api/tasks/[id]/activity`.
- **Componente** — [src/components/story-hierarchy/task-activity-section.tsx](../src/components/story-hierarchy/task-activity-section.tsx)
  rendering 3 tipos com `formatRelative()` em pt-BR.
- **Markdown** — [src/components/ui/markdown.tsx](../src/components/ui/markdown.tsx)
  (wrapper de `react-markdown` com collapse).
- **Optimistic** — infra completa: [src/hooks/use-optimistic-collection.ts](../src/hooks/use-optimistic-collection.ts),
  [src/lib/optimistic/](../src/lib/optimistic/) (reconcile, toast, retry policy).

O que **falta**: comentários como entidade, uploads de imagem (Storage não usado
no repo ainda), eventos automáticos vindos das mutations, @mention +
notificações, e o redesign visual do feed.

## Decisão central: 1 entidade ou 2?

**Opção A — Tudo dentro de `TaskActivity`**: comentários viram `type='comment'`
com `payload = { body, attachments, mentions }`.

**Opção B — `TaskComment` separado + `TaskActivity` para eventos**: feed é a
*união* das duas tabelas ordenadas por timestamp.

**Decisão: B, com union view.** Comentários têm ciclo de vida diferente
(editáveis, deletáveis, anexos, mentions). Misturá-los em `payload jsonb`
espalha a regra de negócio em vários lugares e dificulta queries (ex: "todos
comentários de um membro", "tasks com comentários não lidos"). Eventos
automáticos são *imutáveis* — nasceram pra serem append-only. Misturar
imutável com mutável em uma tabela só vira dor depois.

**Trade-off aceito:** B exige uma `view` (`TaskFeedItem`) que une as duas
tabelas para paginação cronológica. View simples, ganho de modelar comentários
como entidade própria paga rápido.

## Princípios

- **Renderers como mapa**, não switch enorme. `const renderers: Record<TaskActivityType, (item) => ReactNode>`. Adicionar tipo = adicionar entrada.
- **Recorder defensivo**: `createActivity` em `try/catch`, log e segue. Activity é metadado — não pode quebrar o write principal.
- **Paginação desde o início**: feed cresce sem limite. Endpoint aceita `?before=<cursor>&limit=50`. Carregar 50, "carregar mais" depois. Barato agora, caro retroativo.
- **Optimistic em comentários**: encaixa direto no `use-optimistic-collection` — tempId, reconcile pelo id real. Erro 403 → toast contextualizado + rollback automático.
- **Mention parser puro**: `parseMentions(body, members)` retorna ids únicos válidos. Usado no client (preview) e no server (validação). Mesma função.
- **Markdown puro armazenado**, render derivado. Nunca guardar HTML.
- **Soft delete em comentários**: preserva continuidade do thread.

## Fase 1 — Eventos automáticos (sem UI nova)

**Objetivo:** task vira "auditável". Cada mutation já existente registra uma
activity. UI continua a mesma — só preencher o feed que está vazio.

### 1.1 Estender `TaskActivityType`

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

### 1.2 Helper `recordTaskChanges`

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

### 1.3 Plugar no PUT `/api/tasks/[id]`

Em [src/app/api/tasks/[id]/route.ts](../src/app/api/tasks/[id]/route.ts):
antes do update, `getTask`; depois do update, `recordTaskChanges(id, before, after, actor)`.

Mesmo padrão em:

- [src/app/api/tasks/[id]/acceptance/route.ts](../src/app/api/tasks/[id]/acceptance/route.ts) — `ac_added`
- [src/app/api/tasks/[id]/acceptance/[acId]/route.ts](../src/app/api/tasks/[id]/acceptance/[acId]/route.ts) — `ac_checked` / `ac_unchecked` / `ac_edited`
- [src/app/api/tasks/[id]/acceptance/bulk/route.ts](../src/app/api/tasks/[id]/acceptance/bulk/route.ts)
- [src/app/api/tasks/[id]/tags/route.ts](../src/app/api/tasks/[id]/tags/route.ts) — `tags_changed`
- [src/app/api/tasks/[id]/move-to-story/route.ts](../src/app/api/tasks/[id]/move-to-story/route.ts) — `story_changed`
- [src/app/api/tasks/route.ts](../src/app/api/tasks/route.ts) — `created` no POST

**Regra:** atividade é registrada *após* o commit do update bem-sucedido.
Falha no `createActivity` faz log mas não derruba a request.

### 1.4 Renderizar os novos tipos

Estender `renderItem` em [task-activity-section.tsx](../src/components/story-hierarchy/task-activity-section.tsx).
Extrair pra `src/components/story-hierarchy/activity-renderers.tsx` com map
`type → renderer` para crescer limpo.

### Critério de aceite Fase 1

Abrir uma task, mudar status/assignee/sprint/FP → feed mostra cada evento com
ator + timestamp. Zero código novo de UI estrutural.

**Estimativa:** ~1 dia.

## Fase 2 — Comentários (texto + markdown + mention)

**Objetivo:** sair do "log read-only" pra "discussion thread". Sem upload de
imagem ainda — adiciona na fase 3 sem refactor.

### 2.1 Migration `20260502_task_comments.sql`

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

**Por que `mentionedMemberIds` denormalizado em coluna:** permite query
"minhas mentions" sem parsear o body. Fonte da verdade pra notificação — se o
autor edita e tira o `@joao`, ele não fica notificado eternamente.

**Por que soft delete:** apagar um comentário no meio do thread reescreve a
história. Soft delete vira "comentário removido" no render.

### 2.2 Migration `20260503_task_feed_view.sql`

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

### 2.3 DAL `src/lib/dal/task-comments.ts`

- `createComment({ taskId, body, mentionedMemberIds, authorMemberId })`
- `editComment(id, body, mentionedMemberIds)` — só autor (validar no API)
- `deleteComment(id)` — soft, só autor ou admin
- `parseMentions(body, projectMembers): string[]` — função pura

### 2.4 API

- `POST /api/tasks/[id]/comments` — cria
- `PATCH /api/tasks/[id]/comments/[cid]` — edita body
- `DELETE /api/tasks/[id]/comments/[cid]` — soft delete
- `GET /api/tasks/[id]/feed` — unified feed (substitui chamada atual a `/activity`)

### 2.5 UI — `<TaskFeed>` substitui `<TaskActivitySection>`

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
- `<Textarea>` simples + toolbar minimalista (B, I, link, código). Não vamos
  introduzir TipTap/Lexical — overkill pra body de comentário e o repo já usa
  `react-markdown` pra render. Markdown raw no input é suficiente.
- Mention: detector `@` no input → popover com lista filtrada de `members`
  (já passado como prop pelo TaskSheet). Insere `@nome` no texto e adiciona id
  no array `mentionedMemberIds` em estado.
- `Cmd+Enter` envia. Submit usa **mesmo padrão otimista** do resto (`use-optimistic-collection`):
  comment aparece com `tempId` antes do servidor responder.

**Item:**
- Avatar com inicial (Member não tem `avatar_url`; círculo com inicial mantém
  consistência com o resto do app).
- Markdown render via [src/components/ui/markdown.tsx](../src/components/ui/markdown.tsx).
- Hover do timestamp mostra absoluto via [Tooltip](../src/components/ui/tooltip.tsx).
- Botão "Editar" / "Apagar" só pro autor; aparece no hover (ou kebab).

### Critério de aceite Fase 2

Posto comentário com `@joao está bloqueado por X`, ele aparece no feed
instantaneamente, com markdown renderizado, mention destacada, timestamp
relativo. Edito → fica `(editado)`. Apago → vira `comentário removido`.

**Estimativa:** ~2-3 dias.

## Fase 3 — Anexos de imagem

**Objetivo:** anexar jpg/png ao comentário. Storage do Supabase ainda não é
usado no repo — abre o caminho.

### 3.1 Bucket + policies

Migration `20260504_task_attachments.sql`:

- `INSERT INTO storage.buckets (id, name, public) VALUES ('task-attachments', 'task-attachments', false)`
  — privado, served via signed URLs.
- Policies: upload exige membership do projeto da task; path convention
  `{projectId}/{taskId}/{filename}`. Read mesma regra.

### 3.2 Tabela `TaskCommentAttachment`

```sql
CREATE TABLE "TaskCommentAttachment" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "commentId" uuid NOT NULL REFERENCES "TaskComment"(id) ON DELETE CASCADE,
  "storagePath" text NOT NULL,
  "mimeType"  text NOT NULL CHECK ("mimeType" IN ('image/jpeg','image/png')),
  "sizeBytes" int NOT NULL CHECK ("sizeBytes" <= 5242880),
  width       int, height int,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
```

Comentário pode ter N anexos. CASCADE garante limpeza.

### 3.3 API + DAL

- `POST /api/tasks/[id]/comments/[cid]/attachments` — multipart, valida tipo +
  tamanho, faz upload pro bucket, insere row.
- DAL `getAttachmentsForComments(commentIds)` em batch (N+1 killer no feed).
- View `TaskFeedItem` ganha `attachments jsonb` (subselect agg) ou hidrata no
  DAL — preferir hidratar fora da view pra mantê-la simples.

### 3.4 UI

- Composer ganha botão de imagem + drag-drop. Preview antes de enviar. Cap em
  4 imagens por comentário (UI + check no DAL).
- Render: thumb 240px no feed, lightbox no clique. Reaproveitar pattern de
  galeria se existir; senão `<Dialog>` simples com a imagem.
- Signed URL gerada server-side por request do feed (TTL 1h, cache no client).

### Critério de aceite Fase 3

Cola print no comentário, sobe, aparece como thumb clicável.

**Estimativa:** ~1.5-2 dias.

## Fase 4 — Notificações in-app de @mention

**Objetivo:** ser mencionado dispara notificação visível na UI. Sem e-mail
(futuro).

### 4.1 Tabela `Notification`

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

### 4.2 Disparo

No `createComment` / `editComment`: para cada `mentionedMemberId` novo (em
edit, diff contra o anterior pra não notificar 2x), insere `Notification` com
`type='task_mention'`.

### 4.3 UI

- Bell icon no header global. Adicionar em [src/app/(dashboard)/](../src/app/(dashboard)/)
  se não houver espaço.
- Dropdown com lista; clique navega pra `/tasks/[ref]?comment={id}` que abre
  TaskSheet + scroll pro comment.
- `PATCH /api/notifications/[id]/read` ou bulk `/notifications/read-all`.
- Polling simples (`fetch` 60s) pra MVP. Realtime (Supabase channels) é fácil
  depois — não bloqueia.

### Critério de aceite Fase 4

João é mencionado → bell ganha badge → clica → vai direto pro comment.

**Estimativa:** ~1.5-2 dias.

## Sequência sugerida

1. **Fase 1** primeiro — entrega valor imediato (audit trail real) sem refactor
   visual. Testa o pipeline de eventos.
2. **Fase 2** — coração da feature.
3. **Fase 3 e 4** podem ir em paralelo (anexos é Storage, notif é trigger) ou
   na ordem que quiser.

**Total:** ~6-8 dias de trabalho focado, dividido em 4 PRs independentes.

## Substituição da seção "Definition of Done · projeto"

Hoje em [task-sheet.tsx:672-681](../src/components/story-hierarchy/task-sheet.tsx#L672-L681)
ocupando o final do body. Decisão: **manter DoD como collapsed/accordion no rodapé**
(referência rápida) e dar o destaque visual pro feed acima dela.

Posicionamento sugerido na TaskSheet:

```
… campos editáveis …
<Separator />
<AcList />
<Separator />
<TaskFeed />            -- novo, ocupa o espaço nobre
<DefinitionOfDone />    -- collapsed por default
```

## Decisões em aberto

- **Mentions de squads/grupos** (`@frontend`): fora de escopo MVP, não bloqueia.
- **Reactions em comentários** (`👍`): adiável, não exige schema change relevante depois.
- **E-mail de mention**: depende de infra de transactional email. Não bloqueia o in-app.
- **Realtime do feed**: Supabase channels. Polling é suficiente pro MVP; trocar é troca de hook, não de schema.
