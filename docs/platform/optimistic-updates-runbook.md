# Optimistic Updates — Runbook de Execução

Companion do `docs/optimistic-updates-plan.md`. Este é o documento operacional: passos verificáveis, comandos, critérios de pronto. Marca as caixas conforme avança.

**Pré-requisitos confirmados (2026-05-01):**
- React 19.2.4 ✓ (`useOptimistic` disponível)
- Next 16.2.2 ✓
- sonner ^2.0.7 ✓ (toast lib já instalada — `src/components/ui/sonner.tsx`)
- Endpoint `PATCH /api/tasks/[id]` já retorna a task completa ✓ (route.ts L88-90, fetchTask)
- Endpoint AC POST já retorna `{ acceptance: ac }` ✓
- Endpoint AC PATCH já retorna `{ acceptance }` ✓
- Endpoint AC DELETE retorna 204 (sem body) — ok pra reconcile

**Conclusão:** Fase 2 do plano original (ajustar payloads) está em grande parte pronta. O trabalho real é cliente.

---

## Convenção de commits

`ZRD-JM-NN: optu — <fase>` (sigla "optu" = optimistic updates). Commit por fase. Push via `bash scripts/sync-main.sh -m "..."`.

---

## Fase 1 — Infra (hook + reducer + reconcile + toast helper)

**Objetivo:** infra reusável que toda fase seguinte plugga.

- [ ] Criar `src/hooks/use-optimistic-collection.ts`
  - [ ] Tipo `Mutation<T, X>` genérico (patch/create/delete/bulkPatch/bulkDelete/external_update + `X`)
  - [ ] Hook `useOptimisticCollection<T, X>(initial, reducer)`
  - [ ] Usa `useOptimistic` (React 19) + `useState` + `useTransition`
  - [ ] Função `mutate(mutation, persist, reconcile, onSuccess?)`
  - [ ] AbortController por chave (concorrência)
- [ ] Criar `src/lib/optimistic/reconcile.ts`
  - [ ] `reconcileById(prev, server, idKey)` — substitui por id, respeitando `updatedAt`
  - [ ] `replaceTempId(prev, tempId, real)` — para criação otimista
- [ ] Criar `src/lib/optimistic/toast.ts`
  - [ ] `errorToast(mutation, error)` — distingue 403 / 409 / 5xx / network / 4xx
  - [ ] Action "Tentar de novo" no toast (re-aplica mutation)
  - [ ] 1 retry automático em 5xx com backoff de 250ms
- [ ] Criar `src/components/story-hierarchy/task-reducer.ts`
  - [ ] Reducer puro pra `Task[]` com mutations específicas (acToggle/acAdd/acPatch/acRemove)
- [ ] **Critério de pronto:** type-check passa, hook usável em mock isolado.
- [ ] Commit: `ZRD-JM-NN: optu — fase 1 infra (hook + reducer + toast helper)`

## Fase 2 — Endpoints retornam payload (audit)

**Objetivo:** garantir que toda mutation retorna o estado novo.

- [x] `PATCH /api/tasks/[id]` (PUT) → retorna task completa ✓ (já está)
- [ ] `PATCH /api/tasks/bulk` → atualizar pra retornar `{ tasks: Task[]; skipped: { id, reason }[] }` em vez de `{ ok, count }`
- [x] `POST /api/tasks/[id]/acceptance` → `{ acceptance }` ✓
- [x] `PATCH /api/tasks/[id]/acceptance/[acId]` → `{ acceptance }` ✓
- [ ] `DELETE /api/tasks/[id]/acceptance/[acId]` → trocar 204 por `{ ok: true, id }` (mais fácil reconciliar)
- [ ] `PATCH /api/stories/[ref]` → confirmar retorno
- [ ] `POST /api/projects/[id]/stories` → confirmar retorno
- [ ] `POST /api/tasks` → confirmar retorno
- [ ] `POST /api/sprints` → confirmar retorno
- [ ] `DELETE /api/tasks/[id]` → trocar `{ ok }` por `{ ok, id }`
- [ ] **Critério de pronto:** curl em cada endpoint retorna shape esperado.
- [ ] Commit: `ZRD-JM-NN: optu — fase 2 endpoints retornam payload`

## Fase 2.5 — Endpoint novo: AC bulk diff (transação)

**Objetivo:** substituir N requests sequenciais por 1 atômico no save de AC.

- [ ] Criar `src/app/api/tasks/[id]/acceptance/bulk/route.ts`
- [ ] PATCH com payload `{ creates: AC[], updates: AC[], deletes: string[] }`
- [ ] Implementar como RPC SQL function `task_acceptance_bulk_diff(task_id, payload)` (Supabase não suporta transação nativa em route handler)
  - [ ] Migration: `supabase/migrations/<date>_ac_bulk_diff_rpc.sql`
  - [ ] Rodar via `psql "$DIRECT_URL" -f <path>`
- [ ] Atualizar `src/lib/supabase/database.types.ts`
- [ ] Endpoint chama RPC, retorna `{ acceptance: AC[] }` final
- [ ] **Critério de pronto:** curl com payload diff retorna lista atualizada; falha em 1 step = ROLLBACK.
- [ ] Commit: `ZRD-JM-NN: optu — fase 2.5 AC bulk diff RPC`

## Fase 3 — TaskSheet (AC + campos + status + assignees + sprint + delete)

**Objetivo:** zero await bloqueante no TaskSheet.

- [ ] Substituir `handleSaveTask` no parent por `mutate({ type: "patch" }, ...)`
- [ ] AC toggle/add/edit/remove → `mutate({ type: "ac..." }, ...)`
- [ ] AC save em batch → chama endpoint bulk diff
- [ ] Campos texto (title, description) → debounce 300ms + AbortController
- [ ] Status / priority / estimate / owner / sprint → patch otimista
- [ ] **Delete single** → `mutate({ type: "delete", id }, ...)` (linha some imediato)
- [ ] Remover `void loadStoryHierarchy()` em background
- [ ] **Critério de pronto:** abrir task, marcar 5 ACs, mudar título, deletar — flicker zero.
- [ ] Commit: `ZRD-JM-NN: optu — fase 3 TaskSheet otimista`

## Fase 4 — Bulk Actions

- [ ] `bulk-actions-bar.tsx` → `mutate({ type: "bulkPatch" }, ...)`
- [ ] Bulk delete → `mutate({ type: "bulkDelete" }, ...)`
- [ ] Bulk add/remove tag → variantes do bulkPatch
- [ ] `skippedDueToLimit` → toast + reverter no estado local
- [ ] **Critério de pronto:** 50 tasks selecionadas, mudança de status — chip flipa em <50ms.
- [ ] Commit: `ZRD-JM-NN: optu — fase 4 bulk actions otimistas`

## Fase 5 — Criação otimista (Task / Story)

- [ ] Criar task: `mutate({ type: "create", entity: { ...input, id: tempId } }, ...)`
- [ ] `tempId = "tmp_" + crypto.randomUUID()`
- [ ] Reconcile substitui tempId pelo id real
- [ ] Botão `disabled` durante transition (não spinner)
- [ ] Erro: linha some + toast
- [ ] **Critério de pronto:** clicar "Nova task" mostra row antes do servidor; 3 cliques em 1s = 3 tasks.
- [ ] Commit: `ZRD-JM-NN: optu — fase 5 criação otimista`

## Fase 6 — Sprint operations

- [ ] Criar sprint otimista
- [ ] Editar sprint (título, datas, status active/closed)
- [ ] Deletar sprint
- [ ] **Critério de pronto:** criar sprint mostra coluna instant.
- [ ] Commit: `ZRD-JM-NN: optu — fase 6 sprint ops`

## Fase 7 — Cleanup `/projects/[id]`

- [ ] Remover `loadTasksAndSprints` / `loadStoryHierarchy` dos handlers (manter só no mount + refetch explícito)
- [ ] Remover `alert()` do `handleSaveTask`
- [ ] Audit grep:
  - `grep -rn "await supabase.*update" src/app/(dashboard)/projects/`
  - `grep -rn "await fetch.*PATCH" src/app/(dashboard)/projects/`
  - `grep -rn "void load" src/app/(dashboard)/projects/`
- [ ] **Critério de pronto:** zero `await` bloqueante em handler de UI dentro de `/projects/[id]`.
- [ ] Commit: `ZRD-JM-NN: optu — fase 7 cleanup projects`

## Fase 8 — Stories + Design Sessions

- [ ] Story (project page): create/patch/delete via `useOptimisticCollection<Story>`
- [ ] Design Session list (`components/project-sessions-tab.tsx`): create/delete
- [ ] Design Session steps (`design-sessions/[id]/steps/[step]/page.tsx`): patch progresso
- [ ] Design Session review (`design-sessions/[id]/review/page.tsx`): MoSCoW + AC writers
  - [ ] Export tasks **mantém spinner** (operação cara, cria N entidades)
- [ ] **Critério de pronto:** navegar steps + marcar items — sem flicker.
- [ ] Commit: `ZRD-JM-NN: optu — fase 8 stories e design sessions`

## Fase 9 — Projects / Clients / Members CRUD

- [ ] `/projects` list: create/edit/delete project com `useOptimisticCollection<Project>`
- [ ] `components/project-edit-sheet.tsx`: patch + relacionamentos
- [ ] `components/project-access-sheet.tsx`: convites/roles (migrar pra pattern unificado)
- [ ] `components/project-capacity-tab.tsx`: FP allocation
- [ ] `/clients` list: CRUD análogo
- [ ] `/members` list + `/members/[id]`: delete + alocação
- [ ] **Critério de pronto:** deletar 3 projects em sequência = todas somem antes da resposta.
- [ ] Commit: `ZRD-JM-NN: optu — fase 9 projects/clients/members CRUD`

## Fase 10 — PDI / Profile / Todos

- [ ] `profile/pdi/page.tsx`: CRUD actions + status change
- [ ] `profile/skills/page.tsx`: patch skill state
- [ ] `components/todo-sheet.tsx`: create/patch/delete + check
- [ ] `settings/page.tsx`: patch auth metadata
- [ ] **Critério de pronto:** marcar 5 PDI actions como done = tudo flipa instant.
- [ ] Commit: `ZRD-JM-NN: optu — fase 10 PDI/profile/todos`

## Fase 11 — Meetings / Agent threads / Integrations

- [ ] `meetings/page.tsx`: delete meeting
- [ ] `meetings/[id]/page.tsx`: action items CRUD + status
- [ ] `ops/page.tsx`: delete thread (alpha chat)
- [ ] `components/settings/integrations-card.tsx`: unlink (Roam etc.)
- [ ] **Critério de pronto:** zero `await fetch + reload()` em handler de UI no app inteiro.
- [ ] Commit: `ZRD-JM-NN: optu — fase 11 meetings/agents/integrations`

## Audit final

- [ ] `grep -rn "await fetch" src/app src/components | grep -v "await.json\|test\|\.spec\."`
  - Toda match restante deve ser **dentro de `mutate(..., persist)`** ou em código não-UI (server actions).
- [ ] `grep -rn "alert(" src/app src/components` → zero
- [ ] `pnpm lint && pnpm type-check`
- [ ] Smoke test manual: TaskSheet, bulk, criar/deletar task/story/sprint, design session, PDI
- [ ] Commit final: `ZRD-JM-NN: optu — audit final + cleanup`

---

## Notas de implementação

### Por que `useOptimistic` em vez de só `useState`

`useOptimistic` da React 19 cuida do **rollback automático** ao final da `startTransition` — se a transition falhar/abortar, o estado volta sozinho. Sem isso, cada handler precisa snapshot+rollback manual (pattern atual em `handleInlineStatusChange`), o que duplica código.

### Reconcile com `updatedAt`

Toda entidade no Supabase tem `updatedAt`. Regra: se o servidor retornou `updatedAt` mais antigo que o estado local, **ignora silenciosamente** (resposta tardia). Sem isso, request 1 chegando depois da request 2 sobrescreve a digitação mais recente.

### AbortController

Cada mutation tem uma chave (`${entity}:${id}:${field}`). Se o usuário digitar 3x em 1s, as 2 primeiras são canceladas via `controller.abort()`. Evita race condition.

### Toast com retry

5xx → 1 retry automático com backoff 250ms (silencioso). Se falhar de novo, vira toast normal. 403/409/4xx → toast direto, sem retry. Toda mutation falha tem botão "Tentar de novo" (re-aplica a mesma mutation).

### Realtime (futuro)

Reducer aceita `{ type: "external_update", entity }`. Quando plugar Supabase Realtime depois, basta despachar esse action no canal. Zero refactor do hook.
