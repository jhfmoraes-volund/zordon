# Task Tags — unificação de shape e tipo

**Status:** plano · 2026-05-12
**Branch:** `joao-dev`

## Contexto

O conceito `TaskTag` está duplicado no codebase em **dois eixos diferentes** que se acumulam num mesmo bug visível.

### Eixo 1 — shape do array (causa do bug)

`Task.tags` aparece em **dois shapes** no código:

- **Embed Supabase** (load via `tags:TaskTagAssignment(TaskTag(...))`):
  ```ts
  Array<{ TaskTag: { id: string; name: string; tone: string } | null }>
  ```
- **Achatado** (servidor PUT `/api/tasks/[id]`, `listTagsForTask`, `/api/tasks/[id]/tags`):
  ```ts
  Array<{ id: string; name: string; tone: string }>
  ```

`RawTask.tags` no client é o shape embed. O PUT do servidor sobrescreve `tags` com o shape achatado. Reconcile `{...t, ...server}` em `handleInlineStatusChange` (e nos handlers de sprint, assignees, save) substitui o array. O `adaptTask` lê `j.TaskTag` em cada item, não encontra, filtra tudo fora → **tags somem visualmente**.

**Sintoma reportado:** ao mudar o status de uma task no projects page, as tags somem. Refresh ou re-adicionar uma tag traz todas de volta (porque `handleChangeTaskTags` chama `loadTasksAndSprints()`, que reidrata via embed).

### Eixo 2 — tipo do item (dívida estrutural)

Existem **duas definições** de `TaskTag` exportadas no codebase:

- **Server** ([src/lib/dal/task-tags.ts:10](../src/lib/dal/task-tags.ts#L10)) — `{ id, projectId, name, tone: ChipTone }`. Estrito, com `projectId`, `tone` como union literal.
- **Client** ([src/components/story-hierarchy/types.ts:57](../src/components/story-hierarchy/types.ts#L57)) — `{ id, name, tone: string }`. Frouxo, sem `projectId`, `tone` solto.

Mesmo nome, objetos diferentes. TypeScript não acusa porque cada arquivo importa "o seu", e estruturalmente o tipo da DAL é assignable ao do client (super-conjunto de campos). Coexistem por acidente histórico — DAL nasceu espelhando a tabela, client nasceu modelando o que o chip precisa, ninguém comparou.

Visualmente representam **a mesma coisa** (o chip de tag). Manter dois tipos:
- Convida bugs futuros (refactor de tone, adição de campo, cross-project).
- Custa cognição (onboarding, code review).
- Esconde a oportunidade de tipar `tone` com segurança em compile time (hoje `tone: string` aceita `"banana"` sem queixa).

## Decisão

**Um tipo único, um shape único.**

```ts
// src/lib/task-tags.ts (já existe, shared — sem `server-only`)
export type TaskTag = {
  id: string;
  projectId: string;
  name: string;
  tone: ChipTone;
};
```

E `Task.tags: TaskTag[]` (achatado) em todo o domínio. O wrapper `{ TaskTag: ... }` do embed é detalhe de persistência e fica isolado **na borda** (logo após cada fetch Supabase).

**Justificativa:**
- `TaskTag[]` é o shape natural de domínio (1 array, sem wrapper).
- Já é o formato em que `adaptTask`, `RawTaskForRow → RowTask`, `/api/tasks/[id]` PUT e `/api/tasks/[id]/tags` operam.
- `ChipTone` em compile time elimina classe de bugs ("tone inválido foi parar na UI").
- `projectId` no objeto remove lookups indiretos em features futuras (cross-project views, agente, mover tags entre projetos).
- Eliminar a divergência elimina **uma classe de bugs**: nenhum reconcile pode mais misturar shapes, nenhum import pode mais pegar a versão "errada" do tipo.

## Mudanças

### 1. Tipo canônico em `src/lib/task-tags.ts`

Adicionar no topo do arquivo (logo após `TAG_TONES`):

```ts
export type TaskTag = {
  id: string;
  projectId: string;
  name: string;
  tone: ChipTone;
};

/** Shape devolvido pelo embed `tags:TaskTagAssignment(TaskTag(...))` do Supabase. */
export type TaskTagEmbedRow = { TaskTag: TaskTag | null };

/** Achata `TaskTagAssignment(TaskTag(...))` em `TaskTag[]`, ordenado por nome.
 *  Roda `normalizeTone` em cada item — input vem do Postgres como `string` solto. */
export function flattenTagEmbed(
  rows: TaskTagEmbedRow[] | null | undefined,
): TaskTag[];

/** Normaliza string crua do Postgres pra `ChipTone`. Fallback: "muted". */
export function normalizeTone(t: string): ChipTone;
```

`normalizeTone` migra de [src/lib/dal/task-tags.ts:17](../src/lib/dal/task-tags.ts#L17) (hoje privado) pra cá, pra ser usado pelo helper compartilhado.

**Importante:** o helper exige `projectId` no input do embed. Isso obriga **todos os embeds** a passarem a selecionar `projectId` — ver §3.

### 2. Remover definições duplicadas

- **Apagar** `export type TaskTag` em [src/components/story-hierarchy/types.ts:57](../src/components/story-hierarchy/types.ts#L57).
- **Apagar** `export type TaskTag` em [src/lib/dal/task-tags.ts:10](../src/lib/dal/task-tags.ts#L10). A DAL importa de `@/lib/task-tags`. `toTag(row)` permanece (mapeia `TaskTagRow` do Postgres → `TaskTag` canônico).
- **Atualizar** o re-export em [src/components/story-hierarchy/index.ts:19](../src/components/story-hierarchy/index.ts#L19) de `./types` pra `@/lib/task-tags`. Mantém o barril funcionando — consumidores que importam `TaskTag` do barril não mudam.

### 3. Embeds Supabase passam a selecionar `projectId`

Todos os embeds atuais selecionam `TaskTag(id, name, tone)`. Para o tipo canônico, precisam selecionar `TaskTag(id, projectId, name, tone)`.

Callsites:

- [src/app/api/tasks/route.ts:119](../src/app/api/tasks/route.ts#L119) — POST `.select(...)`
- [src/app/(dashboard)/projects/[id]/page.tsx:421](../src/app/(dashboard)/projects/[id]/page.tsx#L421) — `loadTasksAndSprints`
- [src/components/story-sheet-by-ref.tsx:120, 193](../src/components/story-sheet-by-ref.tsx) — load + refresh
- [src/components/task-sheet-by-ref.tsx:155, 238](../src/components/task-sheet-by-ref.tsx) — load + refresh
- [src/components/story-hierarchy/use-task-sheet-context.ts:143](../src/components/story-hierarchy/use-task-sheet-context.ts#L143) — `loadTask`
- [src/components/meetings/meeting-task-action-sheet.tsx:142](../src/components/meetings/meeting-task-action-sheet.tsx#L142) — bind task
- [src/components/meetings/task-action-widget.tsx:103](../src/components/meetings/task-action-widget.tsx#L103) — load tasks

`suggest-sprints` ([src/app/api/projects/[id]/suggest-sprints/route.ts:84](../src/app/api/projects/[id]/suggest-sprints/route.ts#L84)) usa alias `tag:` (não `TaskTag:`) e devolve `TaskTagLite` próprio — fica fora.

### 4. Servidor — achatar tags antes de devolver

**[src/app/api/tasks/[id]/route.ts](../src/app/api/tasks/[id]/route.ts)** — `fetchTask` (linha 18):
- Incluir `tags:TaskTagAssignment(TaskTag(id, projectId, name, tone))` no `TASK_SELECT`.
- Remover o segundo round-trip `listTagsForTask(id)` da linha 31 — economiza uma query.
- Achatar via `flattenTagEmbed` antes de devolver. Estrutura final do return preserva `_count: { iterations }`.

**[src/app/api/tasks/route.ts](../src/app/api/tasks/route.ts)** — POST (linha 119):
- Embed já presente, ajustar a select pra incluir `projectId`.
- Achatar antes de devolver `full`.

**[src/app/api/tasks/[id]/duplicate/route.ts](../src/app/api/tasks/[id]/duplicate/route.ts)** e **[src/app/api/tasks/[id]/clone/route.ts](../src/app/api/tasks/[id]/clone/route.ts)** — corrigir bug latente:
- `SELECT_FULL` hoje **não traz tags** ([duplicate:28](../src/app/api/tasks/[id]/duplicate/route.ts#L28), [clone:29](../src/app/api/tasks/[id]/clone/route.ts#L29)). Adicionar `tags:TaskTagAssignment(TaskTag(id, projectId, name, tone))`.
- Achatar antes de devolver. (As assignments **já são copiadas** — [duplicate:120-128](../src/app/api/tasks/[id]/duplicate/route.ts#L120) — só o response que estava omitindo.)

### 5. Client — achatar logo após cada `from("Task").select(...)`

Em cada um dos 7 callsites listados em §3, **imediatamente após** o fetch:

```ts
const rows = (data ?? []).map((t) => ({
  ...t,
  tags: flattenTagEmbed(t.tags),
}));
```

Importa `flattenTagEmbed` de `@/lib/task-tags`.

### 6. Tipos e adapters — simplificar

**[src/app/(dashboard)/projects/[id]/page.tsx](../src/app/(dashboard)/projects/[id]/page.tsx):**
```ts
type RawTask = {
  // ...
  tags: TaskTag[];   // antes: Array<{ TaskTag: {...} | null }>
};
```

**[src/components/story-hierarchy/adapters.ts:108-116](../src/components/story-hierarchy/adapters.ts#L108-L116):**
```ts
type TaskAdapterInput = {
  // ...
  tags?: TaskTag[];   // antes: Array<{ TaskTag?: {...} | null }>
};

// adaptTask simplifica (era map+filter+map+sort):
const tags = [...(row.tags ?? [])].sort((a, b) => a.name.localeCompare(b.name));
```

**[src/components/meetings/meeting-task-list/adapters.ts:46-70](../src/components/meetings/meeting-task-list/adapters.ts#L46-L70):**
```ts
type RawTaskForRow = {
  // ...
  tags?: TaskTag[];   // antes: { TaskTag: {...} }[]
};

// rawToTask simplifica:
const tags: TaskTag[] = raw.tags ?? [];
```

### 7. Handlers optimistic de tag

**[src/app/(dashboard)/projects/[id]/page.tsx](../src/app/(dashboard)/projects/[id]/page.tsx)** — `handleBulkAddTag` e `handleBulkRemoveTag`:

```ts
// add:
const has = t.tags.some((tg) => tg.id === tagId);            // era entry.TaskTag?.id
return { ...t, tags: [...t.tags, tag] };                     // sem wrapper

// remove:
tags: t.tags.filter((tg) => tg.id !== tagId)                 // era entry.TaskTag?.id
```

O objeto `tag` passado em `add` precisa ter `projectId` — vem de `availableTags` que já é `TaskTag[]` canônico. Confirmar no diff.

### 8. Reconciles `{...t, ...server}`

Ficam intocados. Funcionam por construção — não há mais divergência de shape **nem** de tipo:

- [page.tsx:1077-1078](../src/app/(dashboard)/projects/[id]/page.tsx#L1077-L1078) — status
- [page.tsx:1102-1103](../src/app/(dashboard)/projects/[id]/page.tsx#L1102-L1103) — sprint
- [page.tsx:1164-1165](../src/app/(dashboard)/projects/[id]/page.tsx#L1164-L1165) — assignees
- [page.tsx:1204-1205](../src/app/(dashboard)/projects/[id]/page.tsx#L1204-L1205) — save

### 9. Fallout do `tone: string` → `tone: ChipTone`

Apertar `tone` vai expor lugares que hoje passam string solta sem narrowing. Pontos previsíveis:

- **`TaskTagLite`** em [suggest-sprints/route.ts:34](../src/app/api/projects/[id]/suggest-sprints/route.ts#L34) e [suggest-sprints-sheet.tsx:50](../src/components/sprint/suggest-sprints-sheet.tsx#L50) — `{ id, name, tone: string }`. Fica fora do canônico (não tem `projectId`, é DTO de resposta agregada). **Manter como está** e renomear nada — `TaskTagLite` ≠ `TaskTag`, é OK.
- **Componentes que recebem `TaskTag` e passam `tone` adiante** — devem compilar direto porque `ChipTone` é subtipo de `string`.
- **Fixtures/mocks** (`dev/tags/page.tsx`, etc.) — se construírem `TaskTag` literal sem `projectId` ou com tone fora do union, erro de tipo. Ajustar pra usar `projectId` real e tone válido.

Rodar `npm run typecheck` cedo e endereçar caso a caso. Espera-se **≤ 5** ajustes incidentais fora dos arquivos centrais.

## Fora de escopo

- `/api/projects/[id]/suggest-sprints` — usa embed alias `tag:` (não `TaskTag:`) e DTO próprio `TaskTagLite`. Sem mudança.
- `task-action-executor.ts`, `task-snapshot.ts`, `dal/task-tags.ts` (queries DAL) — só escrita ou agregação interna; o `toTag(row)` da DAL passa a importar `TaskTag` do `@/lib/task-tags`.
- `/api/tasks/bulk` — não retorna shape de tags.
- `/api/tasks/[id]/tags` — já retorna `TaskTag[]` achatado; só passa a tipar o return como `TaskTag` canônico (via `listTagsForTask`).
- `dev/stories/page.tsx` — fixture local sem servidor.

## Execução em dois PRs

Dividir reduz blast radius e facilita reverter se algo escapar.

### PR 1 — server canônico (fundação)

1. Adicionar `TaskTag` + `TaskTagEmbedRow` + `flattenTagEmbed` + `normalizeTone` em `src/lib/task-tags.ts`.
2. Remover `export type TaskTag` da DAL; importar de `@/lib/task-tags`. `toTag` permanece.
3. Atualizar `TASK_SELECT` em `/api/tasks/[id]/route.ts` pra incluir tags no embed (com `projectId`); achatar; remover `listTagsForTask` extra.
4. Atualizar POST `/api/tasks/route.ts`: ajustar select + achatar.
5. Adicionar tags no `SELECT_FULL` de duplicate + clone; achatar.
6. Smoke: criar task via UI, mudar status, atualizar via PUT — confirmar response trazendo `tags: TaskTag[]` com `projectId`.

**Estado intermediário entre PRs:** client ainda lê embed e adapta. PUT response traz `TaskTag[]` canônico (com `projectId` extra). Estruturalmente compatível com o `TaskTag` frouxo do client — não quebra nada.

### PR 2 — client canônico (consume)

1. Remover `export type TaskTag` de `story-hierarchy/types.ts`.
2. Atualizar re-export em `story-hierarchy/index.ts` pra apontar pra `@/lib/task-tags`.
3. Adicionar `projectId` em todos os 7 embeds do client.
4. Achatar via `flattenTagEmbed` logo após cada fetch.
5. Simplificar `RawTask`, `TaskAdapterInput`, `RawTaskForRow` (§6).
6. Simplificar `adaptTask` e `rawToTask`.
7. Atualizar `handleBulkAddTag` / `handleBulkRemoveTag` (§7).
8. Resolver fallout do `tone: ChipTone` (§9).
9. Smoke completo (lista abaixo).

## Validação

1. **`npm run typecheck`** — deve passar limpo em ambos os PRs. PR2 vai expor o fallout do `tone` estrito; resolver inline.
2. **`npm run lint`**.
3. **Grep negativo** (PR2): `grep -rn "j.TaskTag\|entry.TaskTag\|t.TaskTag" src/` deve voltar vazio fora de queries Supabase. Garante que nenhum callsite ficou pra trás lendo o wrapper.
4. **Grep duplicate**: `grep -rn "export type TaskTag" src/` deve voltar **apenas** `src/lib/task-tags.ts`.
5. **Smoke manual no projects page** (PR2):
   - Criar task com 2+ tags → status muda → tags permanecem.
   - Trocar sprint → tags permanecem.
   - Trocar assignee → tags permanecem.
   - Editar via sheet (save) → tags permanecem.
   - Bulk add/remove tag → otimista funciona, reconcile não duplica nem some.
   - Duplicate task → tags vêm copiadas no response (verificar network tab).
   - Clone task entre projetos → tags vêm no response.
   - Meeting → criar task action com tags → confirmar render.

## Arquivos editados (estimativa)

### PR 1 — server (5 arquivos)
```
src/lib/task-tags.ts                                        +TaskTag, +TaskTagEmbedRow, +flattenTagEmbed, +normalizeTone
src/lib/dal/task-tags.ts                                    −export TaskTag, +import from @/lib/task-tags
src/app/api/tasks/[id]/route.ts                             ~fetchTask (embed+achata, drop listTagsForTask)
src/app/api/tasks/route.ts                                  ~POST return (achata)
src/app/api/tasks/[id]/duplicate/route.ts                   ~SELECT_FULL +tags, achata
src/app/api/tasks/[id]/clone/route.ts                       ~SELECT_FULL +tags, achata
```

### PR 2 — client (10 arquivos)
```
src/components/story-hierarchy/types.ts                     −export TaskTag
src/components/story-hierarchy/index.ts                     ~re-export TaskTag from @/lib/task-tags
src/app/(dashboard)/projects/[id]/page.tsx                  ~RawTask, load (+projectId, flatten), handlers
src/components/story-hierarchy/adapters.ts                  ~TaskAdapterInput, adaptTask
src/components/meetings/meeting-task-list/adapters.ts       ~RawTaskForRow, rawToTask
src/components/story-sheet-by-ref.tsx                       ~select +projectId, flatten
src/components/task-sheet-by-ref.tsx                        ~select +projectId, flatten
src/components/story-hierarchy/use-task-sheet-context.ts    ~loadTask (+projectId, flatten)
src/components/meetings/meeting-task-action-sheet.tsx       ~bind (+projectId, flatten)
src/components/meetings/task-action-widget.tsx              ~load (+projectId, flatten)
```

**Total: 16 arquivos** (5 + 10 acima, + fallout incidental ≤5).

Diff dominado por `src/app/(dashboard)/projects/[id]/page.tsx`. Demais arquivos têm diff pequeno e mecânico — leitura linha a linha em review é factível.

## Riscos e mitigação

- **Esquecer um embed sem `projectId`.** Mitigação: TypeScript acusa (o `flattenTagEmbed` exige `TaskTag` completo no input).
- **Esquecer de achatar em algum callsite client.** Mitigação: o tipo `RawTask`/`TaskAdapterInput`/`RawTaskForRow` muda pra `TaskTag[]`, então qualquer load que ainda devolva embed quebra na atribuição.
- **Fallout amplo do `tone: ChipTone`.** Mitigação: rodar typecheck cedo no PR2; valores de fallback (`normalizeTone`) cobrem qualquer string crua remanescente.
- **Performance.** Remover `listTagsForTask` em `fetchTask` é **ganho** (–1 round-trip por GET de task). Embeds extras com `projectId` são string adicional desprezível.
