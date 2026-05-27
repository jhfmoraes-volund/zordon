# Plano — Menu de tasks (Duplicar / Clonar / Deletar) + Activity log

> Implementação em commit único. ACs originais (PT-BR) preservados em [Anexo A](#anexo-a--acs-originais).

## 0. Premissas confirmadas no código

- `reference` (`TASK-XXX`) é **global** via RPC `next_task_reference()` em [supabase/rls-setup.sql](../supabase/rls-setup.sql) — funciona pra clone cross-project sem refactor.
- ACs ficam em `AcceptanceCriterion` (FK por `taskId`) — copiar é loop de [`createAc()`](../src/lib/dal/story-hierarchy.ts#L421).
- `Task.acceptanceCriteria` (TEXT) é legacy não-usado pelo UI novo, mas existe — copio o valor bruto também, sem mexer no significado.
- [`requireProjectMemberApi(projectId)`](../src/lib/dal.ts#L394) valida edit-access — uso na origem (read) e destino (edit) no clone.
- Padrão de modal de criação = `Dialog` (igual [task-create-dialog.tsx](../src/components/story-hierarchy/task-create-dialog.tsx)).

## 1. DB — nova tabela `TaskActivity`

**Migration:** `supabase/migrations/20260430_task_activity.sql`

```sql
CREATE TABLE public."TaskActivity" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "taskId"      uuid NOT NULL REFERENCES public."Task"(id) ON DELETE CASCADE,
  type          text NOT NULL,             -- 'duplicated' | 'cloned_to' | 'cloned_from' (+ futuros)
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  "actorMemberId" uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  "createdAt"   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public."TaskActivity"("taskId", "createdAt" DESC);

ALTER TABLE public."TaskActivity" ENABLE ROW LEVEL SECURITY;

-- SELECT/INSERT: quem é membro do projeto da task pode ler/escrever
CREATE POLICY "task_activity_read"  ON public."TaskActivity" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public."Task" t
    JOIN public."ProjectMember" pm ON pm."projectId" = t."projectId"
    JOIN public."Member" m         ON m.id           = pm."memberId"
    WHERE t.id = "TaskActivity"."taskId" AND m."userId" = auth.uid()
  ));

CREATE POLICY "task_activity_insert" ON public."TaskActivity" FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."Task" t
    JOIN public."ProjectMember" pm ON pm."projectId" = t."projectId"
    JOIN public."Member" m         ON m.id           = pm."memberId"
    WHERE t.id = "TaskActivity"."taskId" AND m."userId" = auth.uid()
  ));
```

**Como rodar:**
```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && \
  psql "$DIRECT_URL" -f supabase/migrations/20260430_task_activity.sql
```

Depois regenero `src/lib/supabase/database.types.ts`.

> **Risco:** confirmar nomes exatos de `Member.userId` no schema antes de aplicar (RLS depende disso). Leio o schema e ajusto se necessário.

## 2. DAL — `src/lib/dal/task-activity.ts` (novo)

```ts
createActivity({ taskId, type, payload, actorMemberId })
getActivityForTask(taskId): TaskActivityRow[]
```

Mantém o padrão dos DAL existentes (`db()`, throw-on-error).

## 3. Backend — 3 endpoints novos

### 3.1 `POST /api/tasks/[id]/duplicate`

**Body:** `{ sprintId?: string | null, status?: TaskStatus }`

**Lógica:**
- Lê task original + ACs (via `getAcForTask`)
- Chama RPC `next_task_reference`
- INSERT nova task com:
  - **Copia:** `title` (sufixa ` (cópia)`), `description`, `type`, `scope`, `complexity`, `area`, `functionPoints`, `billable`, `notes`, `projectId`, `userStoryId`
  - **Reseta:** assignees (vazio), `sprintId` (do body ou `null`), `status` (do body ou `backlog`), `doneAt=null`, `githubBranchName=null`, `githubIssueNumber=null`, `githubPrNumber=null`, `githubPrUrl=null`, `mergeAttempts=0`, `lastMergeError=null`
- Loop copia ACs (sem `checked`/`checkedBy`/`checkedAt`)
- Insere `TaskActivity` na **original**: `type='duplicated', payload={ newTaskId, newTaskRef, sprintId, status }`
- Retorna a task nova completa (com `assignments` e `project`)

### 3.2 `POST /api/tasks/[id]/clone`

**Body:** `{ targetProjectId: string, status?: TaskStatus }`

**Lógica:**
- Valida edit-access em `targetProjectId` E read na origem
- Mesma cópia do duplicate, mas com `projectId = targetProjectId`
- **Reseta também:** `userStoryId=null`, `sprintId=null` (story/sprint pertencem ao projeto, não fazem sentido carregar)
- Title **não recebe sufixo** (vai pra outro projeto, então não há colisão visual)
- Insere `TaskActivity` em **dois lugares:**
  - Original: `type='cloned_to', payload={ targetProjectId, targetProjectName, newTaskId, newTaskRef }`
  - Nova: `type='cloned_from', payload={ sourceProjectId, sourceProjectName, sourceTaskId, sourceTaskRef }`
- Retorna `{ task, targetProjectName }`

### 3.3 `GET /api/tasks/[id]/activity`

Lista os eventos da task ordenados por `createdAt DESC`. Hidrata nomes (actor) via join com `Member`.

## 4. Frontend — componentes novos

### 4.1 `src/components/story-hierarchy/task-row-menu.tsx`

`DropdownMenu` com botão `MoreVertical` (3 pontos). `stopPropagation` no click pra não abrir o sheet. Itens:

- **Duplicar**
- **Clonar para projeto…**
- **Copiar referência** (`navigator.clipboard.writeText(task.reference)`)
- _Separator_
- **Deletar** (em vermelho, com `confirm()`)

### 4.2 `src/components/story-hierarchy/task-duplicate-dialog.tsx`

`Dialog`:
- `Select` Sprint (opções: sprints atuais do projeto + "Sem sprint")
- `Select` Status (default: `backlog`; opções: `backlog`/`todo`/`in_progress`/`review`/`done`)
- Botões: Cancelar / Duplicar

### 4.3 `src/components/story-hierarchy/task-clone-dialog.tsx`

`Dialog`:
- **Project picker** (filtra: projetos onde user é membro **e** ≠ atual)
- `Select` Status (default: `backlog`)
- Botões: Cancelar / Clonar
- Após sucesso: toast com texto "Clonada para **[Nome]**" + link `/projects/[id]?task=[ref]`

### 4.4 `src/components/story-hierarchy/task-activity-section.tsx`

Seção dentro do [task-sheet.tsx](../src/components/story-hierarchy/task-sheet.tsx), abaixo das notas, antes do DoD. Lista compacta:

- "Duplicada como `TASK-NNN` por João — 2h atrás"
- "Clonada para **[Projeto Y]** como `TASK-NNN` — ontem"
- "Clonada de **[Projeto X]** (`TASK-MMM`)"

Auto-fetch via `useEffect` quando o sheet abre (depende de `task.__id`).

## 5. Frontend — edits em arquivos existentes

### 5.1 [tasks-list.tsx](../src/components/story-hierarchy/tasks-list.tsx)

- Adicionar coluna `40px` no fim do `gridStyle` pro botão menu
- Header: span vazio na coluna nova
- Row: `<TaskRowMenu task={task} … />` com `onClick={stop}` no wrapper
- Props novas em `TasksListProps`: `onDuplicate`, `onClone`, `onDelete`, `onCopyRef`

### 5.2 [task-sheet.tsx](../src/components/story-hierarchy/task-sheet.tsx)

- Renderizar `<TaskActivitySection taskId={task.__id} />` antes do bloco de DoD em [linha ~609](../src/components/story-hierarchy/task-sheet.tsx#L609)

### 5.3 [app/(dashboard)/projects/[id]/page.tsx](../src/app/(dashboard)/projects/[id]/page.tsx)

- Estados: `duplicateTaskRef`, `cloneTaskRef` + handlers
- `handleDuplicateTask(taskRef, sprintId, status)` → `POST /duplicate` → `loadTasksAndSprints()` → abre sheet da nova
- `handleCloneTask(taskRef, targetProjectId, status)` → `POST /clone` → toast com link
- `handleDeleteTask(taskRef)` → `confirm()` → `DELETE /api/tasks/[id]` → `loadTasksAndSprints()`
- Carrega `projects[]` pra modal de clone via `GET /api/projects` (já existe — filtrar por membership do user, exceto o atual)

## 6. Ordem de execução

1. Ler schema p/ confirmar `Member.userId` → migration
2. `psql -f` migration + `supabase gen types`
3. DAL `task-activity.ts`
4. 3 endpoints (`duplicate` / `clone` / `activity`)
5. Componentes UI: `task-row-menu`, `task-duplicate-dialog`, `task-clone-dialog`, `task-activity-section`
6. Wire em `tasks-list.tsx` + `task-sheet.tsx`
7. Handlers em `projects/[id]/page.tsx`
8. `npx tsc --noEmit` + `npx eslint` nos arquivos tocados
9. Commit: `bash scripts/sync-main.sh -m "ZRD-JM-NN: tasks — menu (duplicar/clonar/deletar) + activity log"`

## 7. Decisões implícitas / tradeoffs

- **Clone cross-project sem story/sprint** — escolha consciente: story/sprint pertencem ao projeto, não fazem sentido carregar. User pode mover depois pelo task-sheet.
- **Sufixo ` (cópia)` apenas no Duplicate** (mesmo projeto). No Clone mantém o título igual — sem colisão visual entre projetos.
- **Activity inline (seção)**, não aba separada — task-sheet já é scrollável e a info é raramente referenciada; aba seria overkill pra 0–3 eventos típicos.
- **Permissão Deletar = mesma de editar** (`requireProjectMemberApi`). Não adiciono check extra "só admin/PM" — mantém consistente com o `DELETE /api/tasks/[id]` atual em [route.ts:80](../src/app/api/tasks/[id]/route.ts#L80).
- **`acceptanceCriteria` TEXT (legacy)** — copio o valor bruto também por completude, sem alterar comportamento.

## 8. Arquivos tocados

**Novos:**
- `supabase/migrations/20260430_task_activity.sql`
- `src/lib/dal/task-activity.ts`
- `src/app/api/tasks/[id]/duplicate/route.ts`
- `src/app/api/tasks/[id]/clone/route.ts`
- `src/app/api/tasks/[id]/activity/route.ts`
- `src/components/story-hierarchy/task-row-menu.tsx`
- `src/components/story-hierarchy/task-duplicate-dialog.tsx`
- `src/components/story-hierarchy/task-clone-dialog.tsx`
- `src/components/story-hierarchy/task-activity-section.tsx`

**Editados:**
- `src/lib/supabase/database.types.ts` (regen)
- `src/components/story-hierarchy/tasks-list.tsx`
- `src/components/story-hierarchy/task-sheet.tsx`
- `src/app/(dashboard)/projects/[id]/page.tsx`

---

## Anexo A — ACs originais

### Clonar para projeto

> **Por quê:** Times que gerenciam múltiplos projetos no Volund frequentemente replicam tasks de setup, infraestrutura ou padrões de qualidade entre projetos (ex: "Configurar CI/CD" aparece em todo novo projeto). Hoje isso exige recriação manual completa, perdendo rastreabilidade da origem.
>
> **Critério de aceite:**
> - Ação "Clonar para projeto..." disponível no menu de contexto da task.
> - Modal exibe lista de projetos ativos do usuário para seleção do destino.
> - Campos copiados: título, descrição, tipo, scope, complexity, FP calculado.
> - Campos resetados: status (`backlog`), sprintId (nulo), assignee (nulo — equipe do projeto destino pode ser diferente).
> - Task clonada recebe nova referência (TASK-XXX) no projeto destino.
> - Task original mantém link "Clonada para [Projeto Y] — TASK-XXX" no histórico.

### Duplicar

> **Por quê:** PMs e tech leads frequentemente criam tasks repetitivas (ex: "Implementar tela X para cliente" e "para prestador") e hoje precisam preencher manualmente cada campo. A duplicação reduz fricção no planning e diminui erro humano na estimativa — campo a campo copiado garante consistência de FP entre tasks similares.
>
> **Critério de aceite:**
> - Botão/ação "Duplicar" disponível no menu de contexto da task (board e backlog).
> - Task duplicada aparece imediatamente um modal para escolha do usuário: Para qual sprint será duplicada ou aba (ex: to-do, backlog e etc).
> - Todos os metadados são copiados, datas de criação/atualização (atualizadas).
> - Assignee é retirado na cópia.
> - Ação é registrada no histórico de atividade da task original.
