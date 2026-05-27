# Optimistic Updates — Plano de Adoção (Plataforma)

**Status:** proposta
**Escopo:** plataforma inteira — começa em `/projects/[id]` (TaskSheet, Bulk, AC, Sprint, criação) e expande para Stories, Design Sessions, Members/Projects/Clients CRUD, PDI, Todos, Meetings, Profile.
**Não-escopo:** kanban / drag-and-drop. Fora deste plano.
**Objetivo:** UI flipa instantaneamente em toda mutation, com rollback consistente em erro. Sem spinners, sem esperar round-trip.

---

## 1. Estado atual (resumo do levantamento)

### Já é otimista (pattern: snapshot → setState → await → rollback)
- [src/app/(dashboard)/projects/[id]/page.tsx:653-672](src/app/(dashboard)/projects/[id]/page.tsx#L653-L672) — `handleInlineStatusChange`
- [src/app/(dashboard)/projects/[id]/page.tsx:674-696](src/app/(dashboard)/projects/[id]/page.tsx#L674-L696) — `handleInlineSprintChange`
- [src/app/(dashboard)/projects/[id]/page.tsx:698-757](src/app/(dashboard)/projects/[id]/page.tsx#L698-L757) — `handleInlineAssigneesChange`
- [src/components/story-hierarchy/task-sheet.tsx:251-263](src/components/story-hierarchy/task-sheet.tsx#L251-L263) — toggle de AC checkbox **dentro do sheet** (apenas local; persist depende do parent)

### Aguarda servidor (ponto de atrito) — em `/projects/[id]`
| # | Local | Mutation | Sintoma |
|---|---|---|---|
| 1 | TaskSheet — AC checkbox toggle | parent diffa AC e dispara DELETE/POST/PATCH sequenciais | delay de ~300–500 ms até confirmar visual + reload completo |
| 2 | TaskSheet — AC add/edit/remove (texto) | parent diffa após `onSave` | mesmo do anterior |
| 3 | TaskSheet — campos texto (title/description/etc.) | `persistIfChanged` no blur + parent reload | ok funcionalmente, mas reload total é caro |
| 4 | TaskSheet / row — delete single | `DELETE /api/tasks/[id]` + reload | linha só some depois da resposta |
| 5 | Bulk update (status/sprint/assignee/tags) | `PATCH /api/tasks/bulk` + `loadTasksAndSprints()` | barra de bulk congela até completar |
| 6 | Bulk delete | mesmo endpoint | linhas só somem após resposta |
| 7 | Bulk add/remove tag | `/api/tasks/bulk` + reload | mesmo |
| 8 | Criar task/story/sprint | insert + reload | botão pressionado N vezes = N inserts |
| 9 | Story — salvar / criar | `PATCH /api/stories/[ref]` + reload | mesmo padrão de task |

### Aguarda servidor — fora de `/projects/[id]` (auditado 2026-05-01)
Mesmo anti-pattern (`await fetch + reload`) em ~30 mutation surfaces. Resumo por área:

| Área | Mutations | Arquivo principal |
|---|---|---|
| **Design Sessions** | delete/create session, progresso de steps, export tasks, MoSCoW, AC writers | `(dashboard)/design-sessions/[id]/**`, `components/project-sessions-tab.tsx` |
| **Projects CRUD** | create/edit/delete project, edit sheet, access (invites/roles), capacity (FP allocation) | `(dashboard)/projects/page.tsx`, `components/project-edit-sheet.tsx`, `components/project-access-sheet.tsx`, `components/project-capacity-tab.tsx` |
| **Clients** | create/edit/delete | `(dashboard)/clients/page.tsx` |
| **Members** | delete member, alocação a projetos | `(dashboard)/members/page.tsx`, `(dashboard)/members/[id]/page.tsx` |
| **PDI / Profile / Todos** | CRUD de actions, skills, todos | `(dashboard)/profile/pdi/page.tsx`, `(dashboard)/profile/skills/page.tsx`, `components/todo-sheet.tsx`, `(dashboard)/settings/page.tsx` |
| **Meetings** | delete meeting, action items | `(dashboard)/meetings/page.tsx`, `(dashboard)/meetings/[id]/page.tsx` |
| **Agent threads / Integrations** | delete thread (alpha chat), unlink integration | `(dashboard)/ops/page.tsx`, `components/settings/integrations-card.tsx` |

### Infra de cache
- **Sem React Query / SWR.** Estado vive em `useState` na page.
- **Sem `revalidatePath`/`revalidateTag`.** Refetch é manual (`loadTasksAndSprints`, `loadStoryHierarchy`).
- Refetch em background é **full reload** — refaz todas as stories/tasks/sprints mesmo ao mudar 1 campo.
- Page é `"use client"`, lê via Supabase browser client com RLS.

### Server actions/rotas tocadas
- `POST /api/projects/[id]/stories`
- `PATCH /api/stories/[ref]`
- `POST/PATCH/DELETE /api/tasks/[id]/acceptance[/acId]`
- `PUT /api/tasks/[id]/tags`
- `PATCH /api/tasks/bulk` (limite 100)
- `POST /api/tasks` (criação)
- Supabase direto: `Task.update`, `TaskAssignment.delete/insert`, `Sprint.insert`, `Task.insert`

---

## 2. Princípios

1. **UI flipa imediatamente.** Toda mutation parte de um snapshot, atualiza o estado local, dispara a request em paralelo, e reverte em erro.
2. **Rollback é obrigatório.** Não existe "best-effort sem rollback" (caso atual do AC diff).
3. **Refetch é targeted.** Em vez de `loadTasksAndSprints()` cheio, atualizar só a entidade afetada com o payload retornado pela API.
4. **Mutations retornam o novo estado.** Endpoints devolvem o objeto atualizado para reconciliação.
5. **Toast em erro, silêncio em sucesso.** Sem spinners, sem confirmações redundantes.
6. **Concorrência:** se o usuário dispara N mutations seguidas no mesmo campo, vale a última (cancel via AbortController ou versionamento por id de mutation).

---

## 3. Arquitetura proposta

### 3.1 Hook central: `useOptimisticCollection<T>`

Hook genérico parametrizado por entidade. `Tasks` é a primeira instância; `Stories`, `Sessions`, `Projects`, `Clients`, `Members`, `Todos`, `PdiActions`, `Meetings` reusam o mesmo shape.

```ts
// src/hooks/use-optimistic-collection.ts
type Mutation<T, X = never> =
  | { type: "patch"; id: string; patch: Partial<T> }
  | { type: "create"; entity: T }                 // entity.id pode ser tempId
  | { type: "delete"; id: string }
  | { type: "bulkPatch"; ids: string[]; patch: Partial<T> }
  | { type: "bulkDelete"; ids: string[] }
  | { type: "external_update"; entity: T }        // hook aceita updates vindos de fora (Realtime futuro) sem refactor
  | X;                                             // mutations específicas da entidade (ex.: AC para Task)

function useOptimisticCollection<T extends { id: string; updatedAt?: string }, X = never>(
  initial: T[],
  reducer: (state: T[], m: Mutation<T, X>) => T[],
) {
  const [committed, setCommitted] = useState(initial);
  const [optimistic, applyOptimistic] = useOptimistic(committed, reducer);

  async function mutate<R>(
    mutation: Mutation<T, X>,
    persist: () => Promise<R>,
    reconcile: (prev: T[], result: R) => T[],
    onSuccess?: (result: R) => void,
  ) {
    startTransition(async () => {
      applyOptimistic(mutation);
      try {
        const result = await persist();
        // Reconcile compara updatedAt: server-wins só se mais novo que o snapshot
        // (evita resposta tardia sobrescrever mudança mais recente do mesmo usuário)
        setCommitted(prev => reconcile(prev, result));
        onSuccess?.(result);
      } catch (e) {
        toast(errorToast(mutation, e));   // ver §3.5 — toast com Undo + retry
      }
    });
  }

  return { items: optimistic, mutate, setCommitted };
}
```

**Tasks-specific extensions (`X` param):**
```ts
type TaskExtra =
  | { type: "acToggle"; taskId: string; acId: string; checked: boolean }
  | { type: "acAdd"; taskId: string; ac: AC }
  | { type: "acPatch"; taskId: string; acId: string; patch: Partial<AC> }
  | { type: "acRemove"; taskId: string; acId: string };

const useOptimisticTasks = (initial: Task[]) =>
  useOptimisticCollection<Task, TaskExtra>(initial, taskReducer);
```

**Por que `useOptimistic` (React 19) + `useState`:**
- `useOptimistic` cuida do rollback automático ao final da transition.
- `useState` mantém a verdade (o que veio do servidor).
- Reducer puro facilita teste e aceita `external_update` (porta aberta pra Supabase Realtime sem refactor — ver §6).

### 3.2 Endpoints retornam o objeto atualizado

Refatoração mínima nos endpoints existentes para que cada mutation devolva o estado novo:

- `PATCH /api/tasks/[id]` → `{ task: Task }`
- `PATCH /api/tasks/bulk` → `{ tasks: Task[]; skipped?: string[] }`
- `POST /api/tasks/[id]/acceptance` → `{ ac: AC }`
- `PATCH /api/tasks/[id]/acceptance/[acId]` → `{ ac: AC }`
- `DELETE /api/tasks/[id]/acceptance/[acId]` → `{ ok: true }`

Isso elimina o "reload tudo" pós-mutation. Apenas a entidade tocada é reconciliada.

### 3.3 Endpoint novo: AC bulk diff

Hoje o `handleSaveTask` dispara N requests sequenciais para AC (DELETE + POST + PATCH). Trocar por:

- `PATCH /api/tasks/[id]/acceptance/bulk` com payload `{ creates: AC[], updates: AC[], deletes: string[] }` em **transação Supabase** (1 round-trip, atômico).
- Retorna `{ acceptanceCriteria: AC[] }` final.

Isso fecha o gap "rollback parcial" do AC diff atual.

### 3.4 Concorrência: AbortController por campo

Cada campo do TaskSheet tem um `AbortController`. Se o usuário muda title 3x em 1 segundo, cancela as 2 primeiras requests e mantém só a última. Evita race condition (resposta antiga sobrescreve resposta nova).

```ts
const controllers = useRef(new Map<string, AbortController>());

function persistField(taskId: string, field: string, value: any) {
  const key = `${taskId}:${field}`;
  controllers.current.get(key)?.abort();
  const ctrl = new AbortController();
  controllers.current.set(key, ctrl);
  return fetch(`/api/tasks/${taskId}`, { ... signal: ctrl.signal });
}
```

### 3.5 Estratégia de erro UX

Não basta toast genérico — pra ficar caprichado:

**1. Distinção por status code:**
- **403** → "Você não tem permissão para esta ação." (sem retry; usuário precisa de role correto)
- **409** (conflito de versão) → "Outro usuário editou. Recarregue para ver." (sem retry; abre porta pro versionamento futuro)
- **5xx** → "Erro de servidor. Tentando novamente…" + 1 retry com backoff (250ms). Se o retry falhar, vira toast de erro normal.
- **Network / abort** → "Sem conexão. Mudança revertida." (sem retry; rollback silencioso)
- **4xx genérico** (400/422) → "Não foi possível salvar: <mensagem do servidor>." (sem retry)

**2. Toast com action "Desfazer" no rollback bem-sucedido:**
Quando a mutation falha e o estado volta ao anterior, o toast oferece "Desfazer" — mas como o estado já voltou, o "Desfazer" na verdade é **"Tentar de novo"** (re-aplica a mutation que falhou). UX claro: usuário viu a mudança, viu sumir, e tem 1 clique pra retentar.

**3. Bulk parcial:**
Endpoint retorna `{ tasks: Task[], skipped: { id, reason }[] }`. Reconcile aplica os `tasks` e mantém os `skipped` no estado original + toast: "Atualizadas 47 de 50. 3 não tinham permissão." Sem rollback total.

**4. Sem `alert()` em lugar nenhum.** O `handleSaveTask` atual usa `alert()` — remover na Fase 7.

Usar [shadcn/ui sonner](https://ui.shadcn.com/docs/components/sonner) ou equivalente já presente no projeto (verificar antes).

### 3.6 Reconcile com `updatedAt`

Toda entidade tem `updatedAt` no shape (já está no schema). Regra do reconcile:

- Servidor retornou entidade com `updatedAt` **mais novo ou igual ao snapshot do otimista** → aplica server-wins (caminho normal).
- Servidor retornou `updatedAt` **mais antigo** que o estado atual local → ignora silenciosamente. Cenário: digitação rápida + rede lenta, resposta da request 1 chega depois da request 2 ter commitado um valor mais novo. Sem isso, request 1 (tardia) sobrescreveria o que o usuário acabou de digitar.

Não é versionamento full (409) — é só ordenação por timestamp. O endpoint precisa retornar `updatedAt` no payload (cobertura na Fase 2).

---

## 4. Plano de execução (fases)

### Fase 1 — Infra (1 dia)
1. Criar `src/hooks/use-optimistic-tasks.ts` com reducer + `useOptimistic`.
2. Adicionar toast (verificar se já existe; senão, instalar `sonner`).
3. Criar utilitário `reconcile(prev, mutation, serverResult)` para fundir o resultado do servidor com o estado local.
4. Tipos: `TaskMutation`, `MutationResult`.

**Critério de pronto:** hook compila, testável isoladamente com mocks.

### Fase 2 — Endpoints retornam o novo estado (1 dia)
1. Ajustar `PATCH /api/tasks/[id]` para retornar `{ task }`.
2. Ajustar `PATCH /api/tasks/bulk` para retornar `{ tasks }`.
3. Ajustar AC endpoints (POST/PATCH) para retornar a entidade.
4. Criar `PATCH /api/tasks/[id]/acceptance/bulk` com transação.

**Critério de pronto:** Postman/curl confirma payload novo. Testes de integração existentes passam (com adapter).

### Fase 3 — Migrar TaskSheet + delete single (1–2 dias)
1. Substituir `handleSaveTask` no parent pelo hook.
2. AC toggle/add/edit/remove → usar `mutate({ type: "ac..." }, persist)`.
3. Campos texto (title, description) → debounce 300 ms + `persistField` com AbortController.
4. Status / priority / estimate / owner / sprint inline → `mutate({ type: "patch", ... })`.
5. **Delete single** (TaskSheet ou row menu) → `mutate({ type: "delete", id }, persist)`. Linha some imediatamente; em erro volta + toast com Undo.
6. Remover `void loadStoryHierarchy()` em background — o reconcile já cobre.

**Critério de pronto:** abrir task, marcar 5 ACs em sequência, mudar título, deletar — tudo flipa instant, nenhum reload visível.

### Fase 4 — Migrar Bulk Actions (1 dia)
1. `bulk-actions-bar.tsx` → usa `mutate({ type: "bulkPatch", ids, patch }, persist)`.
2. Bulk delete → `mutate({ type: "bulkDelete", ids }, persist)`.
3. Bulk add/remove tag → variantes do bulkPatch.
4. Tratamento do `skippedDueToLimit` (>100 tasks): toast + reverter as skipped no estado local.

**Critério de pronto:** selecionar 50 tasks, mudar status — chip flipa em todas em <50 ms; resposta do servidor reconcilia em background.

### Fase 5 — Migrar criação (Task / Story / Sprint) (1 dia)
1. Criar task: `mutate({ type: "create", task: { ...input, id: tempId } }, persist)`.
2. ID temporário (`tmp_${ulid()}`) é substituído pelo real no reconcile.
3. Disable do botão durante a transition (não spinner — só `disabled` para evitar duplo-click).
4. Em erro: linha some + toast.

**Critério de pronto:** clicar "Nova task" mostra a row antes do servidor responder; clicar 3x em 1s cria 3 tasks (não 1, não 9).

### Fase 6 — Sprint operations (0.5 dia)
1. Criar sprint: `mutate({ type: "create", entity: ... }, persist)` análogo ao create task.
2. Editar sprint (título, datas, status active/closed): `mutate({ type: "patch", id, patch }, persist)`.
3. Delete sprint: `mutate({ type: "delete", id }, persist)`.

### Fase 7 — Cleanup `/projects/[id]` (0.5 dia)
1. Remover `loadTasksAndSprints` / `loadStoryHierarchy` dos handlers (manter só no mount + em refetch explícito do usuário).
2. Remover `alert()` do `handleSaveTask`.
3. Auditar com grep: `await supabase.*update`, `await fetch.*PATCH`, `void load`.

**Critério de pronto:** zero `await` bloqueante em handler de UI dentro de `/projects/[id]`.

---

## Fases 8–11 — Expansão pro resto da plataforma

Mesmo hook (`useOptimisticCollection<T>`) reusado em cada área. Cada fase = aplicar o pattern + endpoint retornar payload + remover `reload()`.

### Fase 8 — Stories + Design Sessions (1.5 dia)
1. **Story** (project page): create/patch/delete via `useOptimisticCollection<Story>`.
2. **Design Session list** (`components/project-sessions-tab.tsx`): create/delete otimista. Linha some/aparece instant.
3. **Design Session steps** (`design-sessions/[id]/steps/[step]/page.tsx`): patch de progresso step-a-step. Status (Draft → In Progress → Done) flipa instant.
4. **Design Session review** (`design-sessions/[id]/review/page.tsx`): MoSCoW reorder/patch, AC writers persist, export tasks (este último mantém spinner — é uma operação cara que cria N entidades; toast de progresso).

**Critério de pronto:** navegar pelos steps de uma session, marcar items, salvar — sem flicker de reload.

### Fase 9 — Projects / Clients / Members CRUD (1 dia)
1. **`/projects` list**: create/edit/delete project com `useOptimisticCollection<Project>`. Modal de create fecha imediatamente, linha aparece com tempId.
2. **Project edit sheet** (`components/project-edit-sheet.tsx`): patch + insert/delete de relacionamentos (members, tags). Hoje faz `await + reload`.
3. **Project access sheet** (`components/project-access-sheet.tsx`): convites/roles. Já tem rollback parcial — migrar pro pattern unificado.
4. **Project capacity tab** (`components/project-capacity-tab.tsx`): patch de FP allocation por member. Slider/input flipa instant.
5. **`/clients` list**: CRUD análogo a projects.
6. **`/members` list + `/members/[id]`**: delete member, patch alocação a projetos.

**Critério de pronto:** abrir lista de projects, deletar 3 em sequência — todas somem antes do servidor responder.

### Fase 10 — PDI / Profile / Todos (0.5 dia)
1. **PDI actions** (`profile/pdi/page.tsx`): CRUD de actions (~5 mutations), status change. Maior hotspot fora de projects.
2. **Skills** (`profile/skills/page.tsx`): patch de skill state.
3. **Todos** (`components/todo-sheet.tsx`): create/patch/delete + check.
4. **Profile / Settings** (`settings/page.tsx`): patch de auth metadata.

**Critério de pronto:** abrir PDI, marcar 5 actions como done — tudo flipa instant.

### Fase 11 — Meetings / Agent threads / Integrations (0.5 dia)
1. **Meetings list** (`meetings/page.tsx`): delete meeting otimista.
2. **Meeting actions** (`meetings/[id]/page.tsx`): action items CRUD + status (done/open).
3. **Agent threads** (`ops/page.tsx`): delete thread (alpha chat).
4. **Integrations** (`components/settings/integrations-card.tsx`): unlink (Roam, etc.).

**Critério de pronto:** zero `await fetch` seguido de `reload()` em handlers de UI no app inteiro (grep audit).

---

## 5. Edge cases e decisões

| Caso | Decisão |
|---|---|
| Erro de rede num bulk parcial | Endpoint retorna `{ tasks, skipped: [{id, reason}] }`. Reconcile aplica os tasks; skipped voltam ao estado original + toast informativo (§3.5). |
| Erro de rede em bulk total | Reverter todas; toast com action "Tentar de novo". Sem retry automático. |
| Conflito de versão (outro usuário editou) | Reconcile por `updatedAt` (§3.6) já protege contra resposta tardia do mesmo usuário. Conflito entre usuários diferentes: última escrita vence (atual). Futuro: 409 → toast (fora do escopo). |
| User fecha o sheet com mutation pendente | Mutation continua; toast aparece se falhar. Estado da página é atualizado normalmente. |
| User offline | `fetch` falha → rollback + toast "Sem conexão. Mudança revertida." Sem fila offline (fora do escopo). |
| AC bulk transação parcial | Endpoint usa `BEGIN/COMMIT` no Supabase. Falha em qualquer step = ROLLBACK total no servidor + rollback no cliente. |
| Mutation com ID temporário recebe outra mutation antes do servidor responder | Fila por `tempId`: segunda mutation espera o reconcile. Implementar com `Promise.then` simples. |
| Resposta tardia chega depois de o usuário ter feito nova mudança no mesmo campo | `updatedAt` do payload é mais antigo que o estado local → ignorado silenciosamente (§3.6). |
| 5xx transitório | 1 retry automático com backoff de 250ms. Falha persistente vira toast normal (§3.5). |
| 403 / sem permissão | Toast específico "Você não tem permissão" + rollback. Sem retry. |

---

## 6. O que **não** entra neste plano

- **Kanban / drag-and-drop reorder** (qualquer entidade). Fora de escopo.
- React Query / SWR migration (overkill pro escopo atual).
- **Realtime (Supabase channels)** — fora deste plano, mas o reducer já aceita `{ type: "external_update", entity }` (§3.1), então adoção futura **não exige refactor do hook** — só plugar o canal e despachar o action.
- Offline queue / persistência local.
- Server Components migration das pages (continuam client).
- **Versionamento full (409 conflict)**: o reconcile usa `updatedAt` pra ordenação (§3.6), mas detecção de conflito entre usuários diferentes fica pra depois.

---

## 7. Riscos

1. **`useOptimistic` requer React 19.** Confirmar versão do Next no `package.json` antes de começar (a CLAUDE.md avisa que é "Next que você não conhece" — checar `node_modules/next/dist/docs/`).
2. **Endpoints atuais retornam payloads inconsistentes.** Fase 2 pode quebrar callers fora de `/projects` se eles dependem do shape antigo. Fazer grep antes de mudar.
3. **Transação no Supabase em route handler.** Verificar se o cliente server-side suporta transações nativas; senão, usar uma RPC SQL function.
4. **AbortController + Next App Router.** Confirmar que `fetch` em route handler propaga o abort corretamente.

---

## 8. Próximos passos

1. Aprovar/ajustar este plano.
2. Confirmar versão do React/Next (suporte a `useOptimistic`).
3. Confirmar lib de toast já em uso.
4. Iniciar Fase 1.

**Estimativa total:**
- Fases 1–7 (`/projects/[id]` completo): 5–7 dias.
- Fases 8–11 (resto da plataforma): +3–4 dias (são repetição do mesmo padrão; cada área é integração, não design novo).
- **Total: 8–11 dias** de trabalho focado.
