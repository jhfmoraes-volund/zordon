# Runbook — Unificação de Meetings com Story Hierarchy

> **Objetivo**: alinhar daily/super_planning ao novo modelo de Module → UserStory → Task,
> trocar UI paralela do `MeetingTaskActionSheet` pelo `TaskSheet` rico, simplificar
> daily pra 1 projeto, e auto-selecionar squad do projeto na criação da reunião.
>
> **Premissa validada (2026-05-03)**: produção tem 0 dailies multi-projeto e 0 dailies
> totais. Sem migração de dados na Fase 1.

---

## Sumário das fases

| Fase | Tema | Tamanho | Bloqueia |
|------|------|---------|----------|
| 1 | Daily = 1 projeto (contrato simplificado) | M | Fases 2 e 3 |
| 2 | Auto-select de `ProjectMember` no `MeetingSheet` | M | — |
| 3 | `MeetingTaskList` (componente próprio inspirado em `TasksList`) | L | Fase 4 |
| 4 | `MeetingTaskActionSheet` v2 (TaskSheet rico + banner de proposta) | L | — |
| 5 | Payload v2 + executor enriquecido (story/AC/tags na proposta) | M | Fase 4 (parcial) |
| 6 | Limpeza (deletar UI antiga, NewActionDialog) | S | Tudo acima |

Cada fase é independente em deploy (PR separada) e entrega valor isolado.

---

## Fase 1 — Daily = 1 projeto

**Por quê**: alinha com `super_planning` (já é 1:1), torna o resto do trabalho trivial
(sem união de squads, sem widgets empilhados, sugestões IA focadas), e limpa o modelo
mental ("daily é o pulso de um squad").

**Contexto**: o caso "reunião curta cobrindo squads compartilhados" passa a ser
explicitamente do tipo `general`. A descrição do tipo `daily` no sheet vai dizer isso.

### 1.1 Verificar dados (já feito)

```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /')
psql "$DIRECT_URL" -c "
  SELECT count(*) FROM (
    SELECT m.id FROM \"Meeting\" m
    JOIN \"MeetingProjectLink\" l ON l.\"meetingId\" = m.id
    WHERE m.type = 'daily'
    GROUP BY m.id
    HAVING count(l.\"projectId\") > 1
  ) sub;
"
# Resultado em 2026-05-03: 0 — sem migração de dados.
```

> Se for não-zero no futuro: rodar script de migração que duplica meeting por
> `MeetingProjectLink` extra OU converte pra `general`. Decidir caso a caso.

### 1.2 Backend — validação de criação

**Arquivo**: `src/app/api/meetings/route.ts:107-112`

```diff
- if (type === "daily" && projectIds.length === 0) {
+ if (type === "daily" && projectIds.length !== 1) {
    return NextResponse.json(
-     { error: "Daily requer ao menos um projeto vinculado." },
+     { error: "Daily requer exatamente um projeto vinculado." },
      { status: 400 }
    );
  }
```

### 1.3 Backend — validação de edição

**Arquivo**: `src/app/api/meetings/[id]/route.ts:344-349`

```diff
- if (type === "daily" && body.projectIds.length === 0) {
+ if (type === "daily" && body.projectIds.length !== 1) {
    return NextResponse.json(
-     { error: "Daily requer ao menos um projeto vinculado." },
+     { error: "Daily requer exatamente um projeto vinculado." },
      { status: 400 },
    );
  }
```

### 1.4 Frontend — `MeetingSheet`

**Arquivo**: `src/components/meetings/meeting-sheet.tsx`

- **Linha 26-27** (descrição do tipo `daily`): atualizar para
  `"Daily de um projeto. Discuta progresso, blockers e plano de ação sobre as tasks da sprint atual. Para pautas que cruzam projetos, use Reunião geral."`
- **Linha 258**: trocar `if (type === "daily") return projectIds.size > 0` por
  `return projectIds.size === 1`.
- **Linha 461-465** (label do picker): `daily` deve mostrar `"Projeto"` (singular), igual super_planning.
- **Linha 484-488** (toggle do projeto): `daily` usa `selectSingleProject(p.id)` (mesmo handler de super_planning).
- **Linha 253** (`projectsLocked`): manter false para daily — diferente de super_planning, daily pode trocar projeto na edição (não tem dependência de sprint ativa).

### 1.5 Testar manualmente

1. Criar daily — só permite 1 projeto. UI não deixa marcar 2.
2. Editar daily — pode trocar de projeto livremente.
3. Tentar burlar via curl com `projectIds: [a, b]` → 400 esperado.

### 1.6 Sem necessidade de migration SQL

Banco já está coerente (0 multi-project dailies). Não criar trigger/CHECK constraint —
a regra vive na camada de aplicação.

### Arquivos tocados na Fase 1

- `src/app/api/meetings/route.ts`
- `src/app/api/meetings/[id]/route.ts`
- `src/components/meetings/meeting-sheet.tsx`

### Critério de done

- [ ] Criar daily só aceita 1 projeto (UI + API).
- [ ] Editar daily aceita troca de projeto.
- [ ] super_planning continua intocado.
- [ ] Smoke test manual passou.

---

## Fase 2 — Auto-select de `ProjectMember`

**Por quê**: daily/super_planning sempre são de um squad. Listar 30 membros pra escolher
manualmente força scan + erro. Pré-selecionar o `ProjectMember` é o que faz sentido
conceitual e operacional.

**Decisão**: o picker continua existindo (PM pode desmarcar quem está de férias), mas
arranca pré-marcado. Para `general`, comportamento atual é mantido.

### 2.1 Backend — endpoint enxuto de leitura

**Novo arquivo**: `src/app/api/projects/[id]/members/route.ts`

```ts
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const { id } = await params;
  const { data, error } = await db()
    .from("ProjectMember")
    .select("memberId, member:Member(id, name, role)")
    .eq("projectId", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const members = (data ?? [])
    .map((pm) => {
      const m = Array.isArray(pm.member) ? pm.member[0] : pm.member;
      return m ? { id: m.id, name: m.name, role: m.role } : null;
    })
    .filter((m): m is { id: string; name: string; role: string | null } => !!m);

  return NextResponse.json(members);
}
```

> Nota: já existe `POST/DELETE` em `[memberId]/route.ts` para mutação individual; este
> endpoint coleção é GET-only.

### 2.2 Backend — default de attendees na criação

**Arquivo**: `src/app/api/meetings/route.ts` (depois das validações de tipo, antes da RPC)

```ts
// Auto-fill attendees from ProjectMember when caller didn't pass any
if (
  (type === "daily" || type === "super_planning") &&
  resolvedAttendees.length === 0 &&
  projectIds.length > 0
) {
  const { data: pms } = await supabase
    .from("ProjectMember")
    .select("memberId")
    .in("projectId", projectIds);
  resolvedAttendees = (pms ?? []).map((p) => ({
    memberId: p.memberId,
    role: "attendee",
  }));
}
```

> Defesa contra clique rápido sem descer até o picker. UI ainda envia attendees explícitos no fluxo normal.

### 2.3 Frontend — `MeetingSheet` auto-populate

**Arquivo**: `src/components/meetings/meeting-sheet.tsx`

#### 2.3.1 Estado e tracking

Adicionar dois sets pra rastrear overrides do PM (sem isso, "tirei alguém, troquei
projeto, pessoa volta" vira bug). **Para Fase 2 daily já é 1 projeto** (Fase 1
finalizada), então simplifica.

```ts
// Membros vindos do ProjectMember do projeto selecionado
const [autoSelectedIds, setAutoSelectedIds] = useState<Set<string>>(new Set());
// Override explícito do PM
const [removedFromAuto, setRemovedFromAuto] = useState<Set<string>>(new Set());
const [addedManually, setAddedManually] = useState<Set<string>>(new Set());
```

`memberIds` (que já existe) deixa de ser fonte da verdade direta — passa a ser derivado:

```ts
const memberIds = useMemo(() => {
  const next = new Set(autoSelectedIds);
  for (const id of removedFromAuto) next.delete(id);
  for (const id of addedManually) next.add(id);
  return next;
}, [autoSelectedIds, removedFromAuto, addedManually]);
```

> Substitui o `useState<Set>` de `memberIds`. Toggle vira:

```ts
const toggleMember = (id: string) => {
  if (memberIds.has(id)) {
    if (autoSelectedIds.has(id)) {
      setRemovedFromAuto((prev) => new Set(prev).add(id));
    } else {
      setAddedManually((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  } else {
    if (autoSelectedIds.has(id)) {
      setRemovedFromAuto((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } else {
      setAddedManually((prev) => new Set(prev).add(id));
    }
  }
};
```

#### 2.3.2 Effect — fetch ProjectMember quando projeto muda

```ts
useEffect(() => {
  if (type !== "daily" && type !== "super_planning") return;
  if (projectIds.size === 0) {
    setAutoSelectedIds(new Set());
    return;
  }

  const ids = Array.from(projectIds);
  Promise.all(
    ids.map((id) =>
      fetch(`/api/projects/${id}/members`).then((r) => r.json()),
    ),
  ).then((lists) => {
    const ids = new Set<string>();
    for (const list of lists) {
      for (const m of list as { id: string }[]) ids.add(m.id);
    }
    setAutoSelectedIds(ids);
    // Reset overrides quando o squad muda — comportamento esperado
    setRemovedFromAuto(new Set());
    setAddedManually(new Set());
  });
}, [type, Array.from(projectIds).join("|")]);
```

> **Edge case — edição**: na hidratação (linha 124-186), pular este effect. A diff entre
> `meeting.attendees` e o squad atual se faz no load:
> - `meeting.attendees ∩ currentSquad` → `autoSelectedIds`
> - `currentSquad \ meeting.attendees` → `removedFromAuto`
> - `meeting.attendees \ currentSquad` → `addedManually`
>
> Isso preserva decisões históricas. Implementar como um fluxo `if (mode === "edit") loadEditState()` separado do effect normal.

#### 2.3.3 UI — agrupar squad vs convidados

Substituir o block atual (`meeting-sheet.tsx:514-538`) por dois grupos:

```tsx
{showMemberPicker && (
  <div className="grid gap-2">
    <Label>
      {type === "general" ? "Membros participantes" : "Squad do projeto"}
    </Label>

    <div className="flex flex-wrap gap-2">
      {/* Membros do squad — pré-marcados, podem desmarcar */}
      {members
        .filter((m) => autoSelectedIds.has(m.id) || addedManually.has(m.id))
        .map((m) => (
          <MemberChip key={m.id} member={m} selected={memberIds.has(m.id)}
                      onToggle={() => toggleMember(m.id)} />
        ))}
    </div>

    {(type === "daily" || type === "super_planning") &&
      members.length > autoSelectedIds.size && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Adicionar convidado de fora do squad
          </summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {members
              .filter((m) => !autoSelectedIds.has(m.id))
              .map((m) => (
                <MemberChip key={m.id} member={m} selected={memberIds.has(m.id)}
                            onToggle={() => toggleMember(m.id)} />
              ))}
          </div>
        </details>
      )}
  </div>
)}
```

> `MemberChip` é um pequeno helper local, mesmo visual de hoje (linhas 524-534). Extrair pra evitar duplicação.

#### 2.3.4 Submit — sem mudança de contrato

`memberIds` continua alimentando `attendees` exatamente como hoje (linha 276). PM apenas vê pré-marcados.

### 2.4 Testar manualmente

- Criar super_planning + escolher projeto → squad já marcado.
- Desmarcar uma pessoa → ela some da seleção.
- Adicionar convidado de fora → entra como manual.
- Trocar de projeto → squad atualiza, overrides resetam.
- Editar reunião antiga → overrides preservados (não reaparece quem foi removido).

### Arquivos tocados na Fase 2

- `src/app/api/projects/[id]/members/route.ts` (novo)
- `src/app/api/meetings/route.ts`
- `src/components/meetings/meeting-sheet.tsx`

### Critério de done

- [ ] `/api/projects/{id}/members` retorna squad.
- [ ] Auto-select funciona em criação.
- [ ] Trocar projeto reseta overrides.
- [ ] Editar reunião antiga preserva diff.
- [ ] Smoke test manual passou.

---

## Fase 3 — `MeetingTaskList` componente próprio

**Por quê**: o widget atual renderiza 3 `<Section>` com `ActionRow` minimalista. PM
quer ver o plano com as mesmas affordances do board (sort, filtros, bulk). Mas TasksList
tem props acopladas a "task real" — copiar com adaptação dá liberdade de evoluir sem
risco de quebrar `/projects/[id]`.

### 3.1 Refactor preparatório (XS, vai num commit separado)

**Mover sort utilities** de `src/components/story-hierarchy/tasks-list.tsx` (linhas 116-201)
para `src/components/story-hierarchy/sort.ts`:

- Exportar `compareTasks`, `sortTasks`, `STATUS_RANK`, tipos `SortKey`, `SortDir`, `SortContext`.
- TasksList importa de lá. Comportamento idêntico — só remoção de duplicação futura.

> Validar: rodar página `/projects/[id]`, confirmar ordenação ainda funciona.

### 3.2 Adapter `actionToTaskRow`

**Novo arquivo**: `src/components/meetings/meeting-task-list/adapters.ts`

```ts
import type { MeetingTaskAction } from "../meeting-task-action-sheet";
import type { Task } from "@/components/story-hierarchy";

type RawTask = {
  id: string;
  reference: string | null;
  title: string;
  status: string;
  type: string;
  scope: string;
  complexity: string;
  priority: number;
  sprintId: string | null;
  userStoryId: string | null;
  functionPoints: number | null;
  billable: boolean | null;
  dueDate: string | null;
  notes: string | null;
  assignments: { memberId: string }[];
  tags: { TaskTag: { id: string; name: string; tone: string } }[];
};

/**
 * Converte uma MeetingTaskAction em "linha exibível". Cada tipo tem semântica:
 *  - create: virtual; tudo do payload; reference null.
 *  - update: real com diff aplicado; ícone marca colunas alteradas.
 *  - move: real; coluna sprint mostra current → target.
 *  - delete: real com strikethrough.
 *  - review: real sem mudança.
 */
export type ActionRow = {
  action: MeetingTaskAction;
  task: Task;                            // shape Task da story-hierarchy
  changedFields: Set<keyof Task>;        // só populado em update
  targetSprintId: string | null;         // só populado em move
};

export function actionToRow(
  action: MeetingTaskAction,
  task: RawTask | null,
  storyRefById: Map<string, string>,    // userStoryId -> reference
): ActionRow {
  // ... lógica por tipo. create monta task virtual do payload.
  // update faz merge { ...task, ...payload } e marca changedFields.
  // move/delete/review repassam task + flag.
}
```

> Detalhe de implementação: o `Task` da story-hierarchy tem `userStoryRef` (string ref),
> não `userStoryId`. Adapter precisa do `storyRefById` map pra traduzir.

### 3.3 Componente `MeetingTaskList`

**Novo arquivo**: `src/components/meetings/meeting-task-list/index.tsx`

API mínima:

```ts
type MeetingTaskListProps = {
  rows: ActionRow[];                          // já adaptadas
  stories: Story[];
  modules: Module[];
  members: Member[];
  sprints: SprintLite[];
  availableTags: TaskTag[];

  onOpenAction: (action: MeetingTaskAction) => void;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onBulkApprove?: (ids: string[]) => Promise<void>;
  onBulkReject?: (ids: string[]) => Promise<void>;
};
```

#### Layout das colunas

| Coluna | Render |
|--------|--------|
| `[checkbox]` | só pra rows com decision=pending |
| **Ação** | `StatusChip` via `lookupChip(ACTION_TYPE, action.type)` |
| **Decisão** | badge sutil pending/approved/rejected (via lookupChip se existir, senão criar) |
| **Ref** | `task.reference` ou `—` |
| **Título** | task.title; em update, ícone diff sutil quando título mudou |
| **Story / Módulo** | `MOD-X / US-Y` resolvidos do map |
| **Sprint** | nome; em `move` mostra `current → target` |
| **Tags** | `TagChip` + overflow |
| **Assignee** | `task.assigneeIds[0]` resolvido pra nome |
| **FP** | numérico |
| **Inline ações** | `Aprovar` `Rejeitar` (pending) ou `Abrir` |

#### Filtros próprios (sheet em mobile, toolbar inline em desktop)

- Tipo de ação (`__all` / create / update / move / delete / review)
- Origem (IA / manual)
- Module (compartilhado com `availableTags` filter de TasksList)
- Tag
- Assignee

#### Agrupamento default

`groupBy: "decision" | "none"` — default `"decision"`. Mantém PM organizado por
pending/approved/rejected, com filtros refinando dentro.

#### Sort

Importar de `sort.ts` (Fase 3.1). Permitir mesmo `SortKey`, mais um `actionType` opcional.

#### Bulk bar

**Novo**: `src/components/meetings/meeting-task-list/bulk-bar.tsx` — pequeno.
Ações: Aprovar selecionadas / Rejeitar selecionadas. Sem update/delete (não fazem
sentido sobre propostas em massa).

### 3.4 `TaskActionWidget` — usar a lista nova

**Arquivo**: `src/components/meetings/task-action-widget.tsx`

- Carregar `tasksById` (atualmente já faz; refinar pra buscar `*` em vez de `id, reference, title, status`).
- Carregar `stories`, `modules`, `availableTags` do projeto (quem hoje é responsabilidade do `TaskSheet`; o widget precisa pra alimentar a lista).
- Mapear `actions` via `actionToRow` → `rows`.
- Substituir blocos `<Section>` (linhas 204-258) por `<MeetingTaskList rows={rows} ... />`.
- Manter header (nome do projeto, "Sugerir com IA", "Nova ação") e footer ("Aplicar plano (N)").

### Arquivos tocados na Fase 3

- `src/components/story-hierarchy/sort.ts` (novo, refactor)
- `src/components/story-hierarchy/tasks-list.tsx` (importa do novo sort.ts)
- `src/components/meetings/meeting-task-list/index.tsx` (novo)
- `src/components/meetings/meeting-task-list/adapters.ts` (novo)
- `src/components/meetings/meeting-task-list/bulk-bar.tsx` (novo)
- `src/components/meetings/task-action-widget.tsx` (refactor)

### Critério de done

- [ ] Refactor de sort não quebra `/projects/[id]`.
- [ ] Lista renderiza pending/approved/rejected agrupados por decisão.
- [ ] Sort por status, story, sprint, FP funcionam.
- [ ] Filtros funcionam.
- [ ] Bulk approve aprova N actions de uma vez.
- [ ] Click em row abre o sheet (Fase 4 troca o sheet, mas hoje pode abrir o velho).

---

## Fase 4 — `MeetingTaskActionSheet` v2 (TaskSheet rico)

**Por quê**: hoje há dois sheets (`MeetingTaskActionSheet` paralelo e `TaskSheetInner`
do projeto). PM aprende dois layouts. A proposta de update/move/delete/review numa
reunião perde campos que o `TaskSheetInner` mostra (AC, tags, FP, story, comments, feed).

**Decisão**: um único sheet em todo o produto. A reunião continua dona do workflow
proposta→decisão→execução; a diferença é só o **header de banner** e o **footer**
da proposta envolvendo `TaskSheetInner`.

### 4.1 Wrapper `ProposalShell`

**Novo arquivo**: `src/components/meetings/proposal-shell.tsx`

```tsx
type ProposalShellProps = {
  action: MeetingTaskAction;
  busy: boolean;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
  onClose: () => void;
  children: React.ReactNode;       // o TaskSheetInner
};
```

Renderiza:
- **Banner topo**: amarelo. `"Proposta de {tipo} · {origem}"`, confidence se IA, reasoning.
  (Aproveitar styling de `meeting-task-action-sheet.tsx:207-242`.)
- `{children}` = TaskSheetInner.
- **Footer**: `Fechar` / `Rejeitar` / `Aprovar` (depende de decision).

### 4.2 Loader de contexto reusável

`TaskSheetByRef` (existente) já carrega ctx pra task real. Para `update/move/delete/review`
ele já serve — extrair a lógica de loading pra `useTaskSheetContext(taskId, projectId)`
e expor como hook.

**Novo arquivo**: `src/components/story-hierarchy/use-task-sheet-context.ts` (extrair
de `task-sheet-by-ref.tsx:77-177`).

### 4.3 Modos de operação do sheet

```
action.type | source/decision        | comportamento do TaskSheetInner
─────────────────────────────────────────────────────────────────────
create      | manual (já approved)   | escreve direto na Task DEPOIS de aplicar (igual hoje)
            |                        | enquanto não aplicado: edita payload local
update      | pending                | cada campo editado → atualiza payload, NÃO Task
update      | approved (pendente apl)| cada campo → atualiza payload (re-aprova implícito)
move        | qualquer               | UI read-only do conteúdo; só sprint destino editável
delete      | qualquer               | UI read-only + banner "vai pro backlog"
review      | qualquer               | UI read-only + painel reasons (já existe)
```

> Implementação: passar prop `mode: "live" | "draft"` ao `TaskSheetInner`. Em `draft`,
> os handlers `onSave/onChangeSprint/onChangeAssignees/onAcCreate/...` recebem closures
> que escrevem em buffer local (não chamam API). Em `live` (manual create depois de aplicar,
> ou view fora de meeting), comportamento atual.
>
> Esse `mode` é só pro Fase 4 — um boolean evita explosão de variantes.

### 4.4 `MeetingTaskActionSheet` v2

**Substituir** `src/components/meetings/meeting-task-action-sheet.tsx`:

```tsx
export function MeetingTaskActionSheet({ action, meetingId, projectId, ... }) {
  const ctx = useTaskSheetContext(action.taskId, projectId, /* drafts via payload */);
  const [draft, setDraft] = useState(action.payload);

  return (
    <ResponsiveSheet open onOpenChange={...}>
      <ResponsiveSheetContent size="lg">
        <ProposalShell action={action} ...>
          {action.type === "create" || action.type === "update" ? (
            <TaskSheetInner
              mode="draft"
              task={draftToTask(action, draft, ctx)}
              {...ctx}
              onSave={(updated) => setDraft(taskToPatch(updated))}
              onChangeAssignees={(_, ids) => setDraft({ ...draft, assigneeIds: ids })}
              onAcCreate={(_, text) => setDraft({ ...draft, acceptanceCriteria: [...(draft.acceptanceCriteria ?? []), { text, checked: false, id: makeTempId() }] })}
              ...
            />
          ) : action.type === "move" ? (
            <MoveProposalView action={action} ctx={ctx} draft={draft} setDraft={setDraft} />
          ) : action.type === "delete" ? (
            <DeleteProposalView action={action} ctx={ctx} />
          ) : (
            <ReviewProposalView action={action} draft={draft} setDraft={setDraft} />
          )}
        </ProposalShell>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
```

> `MoveProposalView`/`DeleteProposalView`/`ReviewProposalView` são versões simples
> (mantém o que existe hoje — pickers de sprint, lista de reasons). Não precisa do
> TaskSheet inteiro pra estes casos.

### 4.5 Persistência ao aprovar

O endpoint `PUT /api/meetings/[id]/task-actions/[actionId]` (existente) já recebe
`payload` no body quando `decision === "approved"`. Continuar enviando o `draft`
acumulado nesse momento.

### 4.6 Permissões

Builder não-alocado no projeto: `TaskSheetInner` em mode `draft` deve estar `readOnly` —
adicionar prop `readOnly?: boolean` no inner que desabilita inputs. Banner do Proposal
explica: `"Você não tem permissão de edição neste projeto."`

### Arquivos tocados na Fase 4

- `src/components/story-hierarchy/use-task-sheet-context.ts` (novo, extract)
- `src/components/story-hierarchy/task-sheet.tsx` (adicionar props `mode`, `readOnly`)
- `src/components/task-sheet-by-ref.tsx` (refatorar pra usar o hook)
- `src/components/meetings/proposal-shell.tsx` (novo)
- `src/components/meetings/meeting-task-action-sheet.tsx` (rewrite)
- `src/components/meetings/proposal-views/{move,delete,review}.tsx` (novos)

### Critério de done

- [ ] Abrir update no widget mostra TaskSheetInner com banner.
- [ ] Editar campos no draft não chama API até "Aprovar".
- [ ] Aprovar manda o draft consolidado pro backend.
- [ ] Move/delete/review continuam funcionando (views próprias).
- [ ] Builder sem permissão vê read-only.

---

## Fase 5 — Payload v2 + executor enriquecido

**Por quê**: hoje `applyCreate` ([task-action-executor.ts:78](src/lib/meetings/task-action-executor.ts#L78))
não insere `userStoryId`, AC nem tags. Resultado: task criada via reunião nasce avulsa
e anêmica vs task criada em `/projects/[id]`. A IA também não sabe sugerir com hierarquia.

### 5.1 Schema do payload v2

`MeetingTaskAction.payload` é JSON, sem migration. Campos novos:

```ts
type MeetingTaskActionPayloadV2 = {
  // Existentes
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  type?: TaskType;
  scope?: TaskScope;
  complexity?: TaskComplexity;
  priority?: number;
  billable?: boolean;
  functionPoints?: number | null;
  notes?: string | null;
  dueDate?: string | null;
  sprintId?: string | null;
  assigneeIds?: string[];

  // Novos (V2)
  userStoryId?: string | null;
  acceptanceCriteria?: Array<{ text: string }>;
  tagIds?: string[];
};
```

### 5.2 Executor — `applyCreate` enriquecido

**Arquivo**: `src/lib/meetings/task-action-executor.ts`

Adicionar depois do insert da Task ([linha 105](src/lib/meetings/task-action-executor.ts#L105)):

```ts
// Story link
if (typeof p.userStoryId === "string") {
  await supabase.from("Task").update({ userStoryId: p.userStoryId }).eq("id", taskId);
  // ou incluir no insert acima — preferir incluir no insert
}

// Acceptance criteria
const acs = Array.isArray(p.acceptanceCriteria) ? p.acceptanceCriteria : [];
if (acs.length > 0) {
  await supabase.from("AcceptanceCriterion").insert(
    acs.map((ac, i) => ({
      id: crypto.randomUUID(),
      taskId,
      text: ac.text,
      order: i,
    }))
  );
}

// Tags
const tagIds = Array.isArray(p.tagIds) ? (p.tagIds as string[]) : [];
if (tagIds.length > 0) {
  await supabase.from("TaskTagAssignment").insert(
    tagIds.map((tagId) => ({ id: crypto.randomUUID(), taskId, tagId }))
  );
}
```

> Preferir incluir `userStoryId` direto no insert original em vez de update separado.

### 5.3 Executor — `applyUpdate` enriquecido

Similar: aceitar `userStoryId`, reconciliar AC (diff: novos/atualizados/removidos),
reconciliar tags (substituir set, mesmo padrão de `/api/tasks/[id]/tags`).

### 5.4 Suggester — contrato v2

**Arquivo**: `src/lib/meetings/task-action-suggester.ts`

Adicionar ao `SYSTEM_PROMPT` ([linha 19](src/lib/meetings/task-action-suggester.ts#L19)):

- Mencionar `userStoryId`, `acceptanceCriteria` no payload de create.
- Anexar lista de stories ativos do projeto no contexto (`buildSuggestionContext`):

```ts
const { data: stories } = await supabase
  .from("UserStory")
  .select("id, reference, title, moduleId")
  .eq("projectId", projectId);
// adicionar no SprintContext
```

> A IA passa a ancorar tasks em stories. Sem isso, todas viram avulsas.

### Arquivos tocados na Fase 5

- `src/lib/meetings/task-action-executor.ts`
- `src/lib/meetings/task-action-suggester.ts`

### Critério de done

- [ ] `applyCreate` insere AC, tags, story link.
- [ ] `applyUpdate` reconcilia AC, tags, story link.
- [ ] IA sugere create com `userStoryId` quando contexto permite.
- [ ] Smoke test: criar task via reunião → resultado idêntico a criar via projeto.

---

## Fase 6 — Limpeza

**Por quê**: depois das fases anteriores, `NewActionDialog` e `CreateUpdateForm` viram
código morto.

### 6.1 Deletar `NewActionDialog`

**Arquivo**: `src/components/meetings/task-action-widget.tsx:442-536`

- "Nova ação" do widget vira **"Nova task"**: abre direto o `MeetingTaskActionSheet` v2
  com `action.type = "create"` (POST cria action + abre sheet).
- Para `update/move/delete/review`: agir sobre task existente vira affordance dentro
  do próprio TaskSheet (botão "Mover de sprint" / "Remover da sprint" / "Marcar pra
  revisar" no header), que cria a action pendente.

### 6.2 Deletar `CreateUpdateForm`

**Arquivo**: `src/components/meetings/meeting-task-action-sheet.tsx:377-549`

Já não é mais referenciado depois da Fase 4.

### 6.3 Atualizar `TaskActionWidget` header

Substituir botão "Nova ação" → "Nova task" + dropdown opcional pra ações secundárias.

### Arquivos tocados na Fase 6

- `src/components/meetings/task-action-widget.tsx` (deletar dialog, simplificar)
- `src/components/meetings/meeting-task-action-sheet.tsx` (deletar form antigo)
- `src/components/story-hierarchy/task-sheet.tsx` (adicionar botões "Mover/Remover/Revisar" no header — só ativos quando `mode === "live"` em contexto de meeting)

### Critério de done

- [ ] `NewActionDialog` removido.
- [ ] `CreateUpdateForm` removido.
- [ ] `Nova task` abre sheet rico direto.
- [ ] `Mover/Remover/Revisar` ações criam MeetingTaskAction pendente.

---

## Plano de PRs (mapeamento)

| PR | Fases | Deploy independente? |
|----|-------|----------------------|
| **PR-1** | 1 — Daily 1:1 | Sim |
| **PR-2** | 2 — Auto-select squad | Sim |
| **PR-3** | 3.1 — Refactor sort utilities | Sim (zero comportamento) |
| **PR-4** | 3.2-3.4 — MeetingTaskList (abrindo sheet velho) | Sim, melhora UX sozinho |
| **PR-5** | 4 — Sheet v2 (TaskSheetInner com banner) | Sim |
| **PR-6** | 5 — Payload v2 (executor + suggester) | Sim |
| **PR-7** | 6 — Limpeza | Sim |

> 7 PRs, ordem flexível depois da PR-1. Cada uma sob 400 linhas líquidas exceto PR-4 e PR-5 (provavelmente 600-800).

---

## Premissas e riscos

### Premissas
- **Zero dailies em produção** (validado 2026-05-03 via psql). Sem migração de dados.
- `MeetingTaskAction.payload` é JSON livre — campos novos não exigem migration.
- `TaskSheetInner` é reusável fora do `/projects/[id]` (já provado por `TaskSheetByRef`).

### Riscos
- **Multi-projeto histórico aparecer no futuro**: re-rodar query da Fase 1.1 antes da PR-1.
- **`mode="draft"` no TaskSheetInner**: introduzir condicionais demais polui o componente. Mitigação: encapsular em hook `useDraftHandlers(draft, setDraft)` que produz handlers compatíveis com a API existente — TaskSheetInner não precisa saber.
- **Permissão Builder + edit em draft**: testar matriz `Builder/PM/Admin × create/update/move/delete/review` antes de mergear PR-5.
- **IA gerando `userStoryId` inválido**: validar no executor (PR-6) — se story não existe no projeto, fail-soft (linka null + log).

---

## Memória — atualizar após Fase 6

Salvar um project memory: `project_meeting_task_unification.md` com nota:
> "Daily/super_planning unificados via TaskSheet rico (não há mais
> `MeetingTaskActionSheet` paralelo). Daily é 1:1 com projeto.
> Squad auto-selecionado a partir de `ProjectMember`. Implementado em maio/2026."
