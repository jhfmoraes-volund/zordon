# RUNBOOK — Refatorar `projects/[id]/page.tsx` (God component, 2002 linhas)

> **Audiência:** um agente LLM executando single-shot. Este doc é autossuficiente — não
> precisa redescobrir a estrutura. Todos os números de linha referenciam o estado em
> `eaca20a` (branch `joao-dev`, working tree de 2026-05-27). Reconfira com `grep` antes
> de editar, porque outras mudanças na working tree podem ter deslocado linhas.
>
> **Regra de ouro deste repo (CLAUDE.md):** nunca `setState` direto após `fetch` em
> coleção — sempre `mutate(...)` do `useOptimisticCollection`. Sheets/dialogs sempre via
> `ResponsiveSheet`/`ResponsiveDialog`. Forms via `Field` compound. Esta refatoração
> **preserva comportamento** — não muda padrões de mutação, só *move* código.

---

## 1. Objetivo e não-objetivos

**Objetivo:** reduzir `src/app/(dashboard)/projects/[id]/page.tsx` de ~2002 linhas para
~300–400, extraindo os **51 handlers** e o **estado de UI** para custom hooks por domínio,
seguindo o padrão `_hooks/` que **já existe** nesta pasta. O componente final deve ser um
"compositor": chama hooks, passa o resultado pros tabs/dialogs.

**NÃO-objetivos (não faça):**
- ❌ Não mude o padrão de mutação de nenhum handler (quem usa `taskMutate` continua; quem
  usa `fetchOrThrow + reload` continua). Refatoração é *mecânica*, comportamento idêntico.
- ❌ Não extraia o JSX dos tabs — **já está extraído** (`StoriesList`, `SprintsTab`,
  `ProjectSessionsTab`, `ProjectWiki`, `SettingsTab`).
- ❌ Não introduza Context API. O prop-drilling do `SprintsTab` (38 props) é feio mas
  funciona; resolvê-lo é fase opcional 6, separada e arriscada — não bloqueia o resto.
- ❌ Não toque nos 4 hooks de dados existentes (`use-project-meta`, `use-story-hierarchy`,
  `use-tasks-and-sprints`, `use-project-members`) — são a fundação, estão corretos.
- ❌ Não mexa em `_tabs/sprints-tab.tsx` nem `_tabs/settings-tab.tsx` (a não ser ajustar
  imports de tipo, se necessário).

---

## 2. Estrutura atual (o mapa)

### 2.1 O que já está extraído (NÃO refazer)

```
src/app/(dashboard)/projects/[id]/
├── page.tsx                    ← 2002 linhas (ALVO)
├── _types.ts                   ← TabKey, ProjectMeta, RawTask, RawSprint, etc.
├── _hooks/
│   ├── use-project-meta.ts        → { project, reload: loadProject }
│   ├── use-story-hierarchy.ts     → { rawModules, rawPersonas, rawStories, setRawStories,
│   │                                  taskAcRows, acRowsCollection, acIdAliasRef,
│   │                                  resolveAcId, reload: loadStoryHierarchy }
│   ├── use-tasks-and-sprints.ts   → { rawTasks, setRawTasks, taskMutate, tasksCollection,
│   │                                  rawSprints, setRawSprints, projectTags,
│   │                                  setProjectTags, reload: loadTasksAndSprints }
│   └── use-project-members.ts     → { rawMembers, rawProjectMembers, rawSprintMembers,
│                                      reloadMembers: loadMembers }
└── _tabs/
    ├── sprints-tab.tsx         ← recebe 38 props (prop-drilling)
    └── settings-tab.tsx
```

Os tabs `stories`/`sessions`/`wiki` usam componentes globais:
`StoriesList` de `@/components/story-hierarchy`, `ProjectSessionsTab` de
`@/components/project-sessions-tab`, `ProjectWiki` de `@/components/project-wiki`.

### 2.2 Anatomia do page.tsx (linhas aproximadas)

| Faixa | Conteúdo | Destino |
|-------|----------|---------|
| 1–95 | imports (35) + helpers de módulo (`adaptTask`, `makeTempId`, etc.) | fica / move com handlers |
| 96–166 | setup: `use(params)`, auth, **4 hooks de dados** | **fica** no page |
| 168–201 | **20 useStates de UI** | move pra hooks de UI/ação |
| 203–397 | **14 useMemos** (adapt + derivações) + 2 useEffects | maioria **fica** (ver §5) |
| 399–537 | handlers de **Sprint** (10) | `useSprintActions` |
| 538–789 | handlers de **Story** + AC de story (7) | `useStoryActions` |
| 786 | helper `findTaskIdByRef` | move pra `useTaskActions` |
| 576–1188 | handlers de **Task**: create, inline×4, save, AC×4, delete (12) | `useTaskActions` |
| 1088–1153 | handlers de **clone/duplicate** (5) | `useTaskActions` (ou sub-hook) |
| 1189–1362 | handlers **bulk** de task (5) | `useTaskActions` |
| 1363–1485 | handlers de **Module/Persona** (8) | `useTaxonomyActions` |
| 1487–2002 | **render**: hero + ribbon + tab switch + ~12 dialogs | **fica** no page (encolhe sozinho) |

### 2.3 Os 51 handlers, por cluster

**Sprint (→ `useSprintActions`):** `handleCreateSprint` (401), `handleUpdateSprint` (433),
`requestActivateSprint` (455), `requestCompleteSprint` (463), `requestReopenSprint` (467),
`handleActivateSprint` (475), `handleReopenSprint` (485), `handleDeleteSprint` (495),
`deleteSprint` (499).

**Story (→ `useStoryActions`):** `handleCreateStory` (538), `handleStoryPatch` (675),
`handleStoryAcCreate` (704), `handleStoryAcUpdateText` (721), `handleStoryAcToggle` (738),
`handleStoryAcDelete` (755), `handleDeleteStory` (766).

**Task (→ `useTaskActions`):** `handleCreateTask` (576), `handleCreateTag` (641),
`handleChangeTaskTags` (658), `findTaskIdByRef` (786, helper), `handleInlineStatusChange`
(790), `handleInlineSprintChange` (815), `handleInlineAssigneeChange` (841),
`handleInlineAssigneesChange` (849), `handleSaveTask` (902), `handleAcCreate` (944),
`handleAcUpdateText` (993), `handleAcToggle` (1023), `handleAcDelete` (1056),
`loadTargetProjects` (1074), `openDuplicateDialog` (1088), `openCloneDialog` (1092),
`handleCopyTaskRef` (1097), `handleConfirmDuplicate` (1105), `handleConfirmClone` (1129),
`handleDeleteTask` (1154), `deleteTask` (1165), `handleBulkUpdate` (1189),
`handleBulkDelete` (1233), `handleBulkDuplicate` (1257), `handleBulkAddTag` (1282),
`handleBulkRemoveTag` (1330).

**Taxonomy (→ `useTaxonomyActions`):** `handleApproveProposedModule` (1363),
`handleValidateAc` (1376), `handleCreateModule` (1387), `handleUpdateModule` (1403),
`handleDeleteModule` (1419), `handleCreatePersona` (1437), `handleUpdatePersona` (1453),
`handleDeletePersona` (1469).

### 2.4 Os 20 useStates, classificados

| useState | Tipo | Vai pra |
|----------|------|---------|
| `activeTab` (127) | navegação | **fica** no page (controla render + URL sync) |
| `sprintView` (137) | navegação | **fica** no page (URL sync + ribbon + tab) |
| `accessOpen` (168), `editOpen` (169) | UI projeto | **fica** no page (dialogs de projeto) |
| `sprintDialogOpen` (170), `suggestSheetOpen` (171), `suggestSheetTargetId` (172), `sprintAction` (175), `sprintDeleteTargetId` (180), `sprintEditingId` (183), `sprintContextSheet` (184) | UI sprint | `useSprintActions` |
| `selectedStoryRef` (188) | UI story | `useStoryActions` (ou fica — ver §7 armadilha 3) |
| `selectedTaskRef` (189) | UI task | `useTaskActions` (idem) |
| `moduleDialog` (191), `personaDialog` (195) | UI taxonomy | `useTaxonomyActions` |
| `duplicateTaskRef` (198), `cloneTaskRef` (199), `targetProjects` (200) | UI task clone | `useTaskActions` |
| `confirmState` (201) | UI confirm global | **fica** no page (compartilhado por delete de sprint/story/task/module/persona) |

> **`confirmState` é o nó górdio:** ele é setado por `handleDeleteStory`, `handleDeleteTask`,
> `handleDeleteModule`, `handleDeletePersona` (4 clusters diferentes). Mantenha-o no page e
> passe `setConfirmState` como dependência pros hooks que precisam (ver contratos §4).

---

## 3. Arquitetura-alvo

Crie 4 novos arquivos em `_hooks/`, espelhando o estilo dos hooks de dados existentes
(abra `use-tasks-and-sprints.ts` como template de estilo — header-comment explicando
responsabilidade, `return { … }` plano no fim).

```
_hooks/
├── use-sprint-actions.ts      (novo)  ← estado UI de sprint + 9 handlers
├── use-story-actions.ts       (novo)  ← 7 handlers de story/AC-de-story
├── use-task-actions.ts        (novo)  ← findTaskIdByRef + 25 handlers de task
└── use-taxonomy-actions.ts    (novo)  ← estado UI de module/persona + 8 handlers
```

Cada hook recebe as **dependências** que seus handlers usam (collections, reloads,
setters, `id`, `supabase`) e devolve `{ ...estadoUI, ...handlers }`. O page deixa de
declarar os handlers — só desestrutura os hooks e repassa.

**Princípio de contrato:** o hook **não** recria estado de dados (esse vem dos 4 hooks de
dados via parâmetro). Ele só agrega estado de **UI** próprio + os handlers. Assim não há
duplicação de fonte de verdade.

---

## 4. Contratos exatos dos 4 hooks novos

> Copie as funções **verbatim** do page.tsx pra dentro do hook. A única mudança no corpo
> é: variáveis que antes eram escopo do componente (ex. `id`, `taskMutate`, `loadX`,
> `setConfirmState`, `sprints`, `rawStories`) agora chegam como **parâmetros do hook** ou
> via closure dos params. Não reescreva a lógica.

### 4.1 `useSprintActions`

```ts
export function useSprintActions(args: {
  id: string;
  supabase: SupabaseClient;            // de createClient()
  sprints: SprintView[];               // derivado (lido por requestActivate/deleteSprint)
  tasks: AdaptedTask[];                // lido por deleteSprint (contagem)
  loadTasksAndSprints: () => Promise<void>;
  sprintView: NavValue | null;          // deleteSprint LÊ pra saber se a deletada é a focada
  setSprintView: (v: NavValue | null) => void; // deleteSprint reposiciona a view (linha 519)
}) {
  const [sprintDialogOpen, setSprintDialogOpen] = useState(false);
  const [suggestSheetOpen, setSuggestSheetOpen] = useState(false);
  const [suggestSheetTargetId, setSuggestSheetTargetId] = useState<string | null>(null);
  const [sprintAction, setSprintAction] = useState<…>(null);   // copie o tipo união (175-179)
  const [sprintDeleteTargetId, setSprintDeleteTargetId] = useState<string | null>(null);
  const [sprintEditingId, setSprintEditingId] = useState<string | null>(null);
  const [sprintContextSheet, setSprintContextSheet] = useState<…>(null); // copie tipo (184-187)

  // … 9 handlers verbatim (401-537) …

  return {
    sprintDialogOpen, setSprintDialogOpen,
    suggestSheetOpen, setSuggestSheetOpen,
    suggestSheetTargetId, setSuggestSheetTargetId,
    sprintAction, setSprintAction,
    sprintDeleteTargetId, setSprintDeleteTargetId,
    sprintEditingId, setSprintEditingId,
    sprintContextSheet, setSprintContextSheet,
    handleCreateSprint, handleUpdateSprint,
    requestActivateSprint, requestCompleteSprint, requestReopenSprint,
    handleActivateSprint, handleReopenSprint, handleDeleteSprint, deleteSprint,
  };
}
```

✅ **Verificado:** `deleteSprint` (499-537) faz `fetchOrThrow(DELETE /api/sprints/:id)`,
depois `if (sprintView === targetId) setSprintView(null)` (linha 519), depois
`loadTasksAndSprints()`. Por isso `sprintView` (leitura) **e** `setSprintView` entram nos
args. Sem optimistic — é fetch + reload.

### 4.2 `useStoryActions`

```ts
export function useStoryActions(args: {
  id: string;
  project: ProjectMeta | null;                           // handleCreateStory guard referenceKey
  rawStories: RawStory[];
  setRawStories: Dispatch<SetStateAction<RawStory[]>>;   // handleStoryPatch faz optimistic
  loadStoryHierarchy: () => Promise<void>;
  setConfirmState: (s: ConfirmState | null) => void;     // handleDeleteStory usa
  setSelectedStoryRef: (ref: string | null) => void;     // handleCreateStory abre o sheet
}) {
  // handleCreateStory NÃO tem estado de UI próprio além de selectedStoryRef.
  // DECISÃO (ver §7 armadilha 3): selectedStoryRef pode ficar no page OU vir aqui.
  // Recomendado: deixar selectedStoryRef no PAGE e este hook só devolver handlers.
  // … 7 handlers verbatim (538, 675, 704, 721, 738, 755, 766) …
  return {
    handleCreateStory, handleStoryPatch,
    handleStoryAcCreate, handleStoryAcUpdateText, handleStoryAcToggle, handleStoryAcDelete,
    handleDeleteStory,
  };
}
```

✅ **Verificado:** `handleCreateStory` (538-575) faz `POST /api/stories`, recebe
`{ story: { reference } }` e chama `setSelectedStoryRef(story.reference)` (linha 559) pra
abrir o sheet do novo story. Também faz guard: se `!project?.referenceKey`, mostra toast e
`return` cedo. **Passe `setSelectedStoryRef` como arg** (mantém o sheet abrindo) e
`project` (pro guard de referenceKey).

### 4.3 `useTaskActions`

O maior. 25 handlers + o helper `findTaskIdByRef` + 3 estados de UI de clone.

```ts
export function useTaskActions(args: {
  id: string;
  rawTasks: RawTask[];                 // findTaskIdByRef busca aqui
  taskMutate: TaskMutate;              // o mutate do useOptimisticCollection (tipo: ver hook de dados)
  loadTasksAndSprints: () => Promise<void>;
  stories: AdaptedStory[];             // handleSaveTask resolve userStoryId via stories
  rawMembers: RawMember[];             // handleInlineAssigneesChange monta optimistic
  project: ProjectMeta | null;        // idem (pm fallback)
  projectTags: TaskTag[];              // (se algum handler ler; senão remova)
  setProjectTags: Dispatch<SetStateAction<TaskTag[]>>; // handleCreateTag
  acRowsCollection: …;                 // handleAc* (create/update/toggle/delete) — granular optimistic
  resolveAcId: (…) => …;               // handleAc* usa pra resolver temp→real id
  setConfirmState: (s: ConfirmState | null) => void;   // handleDeleteTask
}) {
  const [duplicateTaskRef, setDuplicateTaskRef] = useState<string | null>(null);
  const [cloneTaskRef, setCloneTaskRef] = useState<string | null>(null);
  const [targetProjects, setTargetProjects] = useState<ProjectLite[]>([]);

  function findTaskIdByRef(ref: string): string | null { /* 786 verbatim */ }

  // … 25 handlers verbatim …

  return {
    duplicateTaskRef, setDuplicateTaskRef,
    cloneTaskRef, setCloneTaskRef,
    targetProjects, setTargetProjects,
    findTaskIdByRef,
    handleCreateTask, handleCreateTag, handleChangeTaskTags,
    handleInlineStatusChange, handleInlineSprintChange,
    handleInlineAssigneeChange, handleInlineAssigneesChange,
    handleSaveTask,
    handleAcCreate, handleAcUpdateText, handleAcToggle, handleAcDelete,
    loadTargetProjects, openDuplicateDialog, openCloneDialog,
    handleCopyTaskRef, handleConfirmDuplicate, handleConfirmClone,
    handleDeleteTask, deleteTask,
    handleBulkUpdate, handleBulkDelete, handleBulkDuplicate,
    handleBulkAddTag, handleBulkRemoveTag,
  };
}
```

⚠️ **`handleCreateTask` seta `setSelectedTaskRef`** no fim (637) pra abrir o sheet. Mesma
decisão da armadilha 3: ou passe `setSelectedTaskRef` como arg, ou retorne o ref. O page
chama `handleCreateTask` de 2 lugares (botão "+ task" e `onCreateTaskForStory` no
StorySheet) — ambos esperam o sheet abrir. **Preserve isso.**

⚠️ Os 4 `handleAc*` de **task** (944-1073) usam `acRowsCollection` + `resolveAcId` +
`acIdAliasRef` (optimistic granular). Isso vem do `useStoryHierarchy`. Passe os 3 e leia
944-1073 com atenção — é o trecho mais sutil (optimistic com alias de id temp→real).

### 4.4 `useTaxonomyActions`

```ts
export function useTaxonomyActions(args: {
  id: string;
  loadStoryHierarchy: () => Promise<void>;
  setConfirmState: (s: ConfirmState | null) => void;
  // ✅ Verificado: handleApproveProposedModule (1363) e handleValidateAc (1376) só fazem
  // fetchOrThrow(POST .../promote-proposed-module | .../validate-ac) + loadStoryHierarchy.
  // Nenhuma dep extra além das 3 acima.
}) {
  const [moduleDialog, setModuleDialog] = useState<{ open: boolean; suggested?: string }>({ open: false });
  const [personaDialog, setPersonaDialog] = useState<{ open: boolean }>({ open: false });
  // … 8 handlers verbatim (1363-1485) …
  return {
    moduleDialog, setModuleDialog, personaDialog, setPersonaDialog,
    handleApproveProposedModule, handleValidateAc,
    handleCreateModule, handleUpdateModule, handleDeleteModule,
    handleCreatePersona, handleUpdatePersona, handleDeletePersona,
  };
}
```

---

## 5. O que FICA no page.tsx

- `use(params)`, `useMemo(() => createClient())`, `useAuth`, `canManageSprint`, `isGuest`,
  `visibleTabs`.
- Os **4 hooks de dados** (chamadas inalteradas).
- `activeTab`/`sprintView` + os 2 `useEffect` de URL sync e default de sprint (210-228,
  388-392).
- **Todos os 14 useMemos de adapt/derivação** (modules, personas, stories, tasks,
  backlogTasks, members, sprints, capacities, moduleUsage, personaUsage, activeSprintId,
  selectedStory, selectedTask). Eles derivam de dados crus e são lidos pelo render + por
  vários hooks. **Calcule no page e passe pros hooks que precisam.** Não duplique.
- `accessOpen`/`editOpen` + `confirmState`.
- Os 4 novos hooks de ação.
- Todo o **render** (1487-2002) — encolhe porque os handlers viram `taskActions.handleX`.

**Ordem de declaração no page (importa por causa de TDZ):**
1. params/auth/data-hooks
2. `activeTab`/`sprintView` states
3. os 14 useMemos (precisam de `rawX` dos data-hooks)
4. `confirmState`, `accessOpen`, `editOpen`
5. os 4 hooks de ação (precisam dos useMemos `sprints`/`tasks`/`stories` + setters)
6. derivações finais de render (`activeSprint`, `focused`, `isSyntheticView`…)
7. return

---

## 6. Plano de execução (faseado, commitável, reversível)

Cada fase é um commit isolado. **Rode `npx tsc --noEmit` ao fim de cada fase** — deve
passar (exit 0) antes de seguir. O sinal de sucesso de cada fase: page.tsx encolhe, tsc
limpo, comportamento idêntico.

### Fase 1 — `useTaxonomyActions` (menor risco, valida o padrão)
8 handlers, deps mínimas (`id`, `loadStoryHierarchy`, `setConfirmState`). Sem optimistic.
Extraia, troque os usos no page por `taxonomy.handleX` / `taxonomy.moduleDialog`, rode tsc.
**Por que primeiro:** menor, isolado, prova a mecânica antes dos clusters grandes.

### Fase 2 — `useSprintActions`
9 handlers + 7 estados de UI. Sem optimistic (usa `fetchOrThrow`/`supabase` + reload).
Atenção ao `setSprintView` em `deleteSprint`. Troque os ~20 usos no render (SprintsTab
props + os 4 dialogs de sprint no fim).

### Fase 3 — `useStoryActions`
7 handlers. Atenção ao `handleCreateStory`→`selectedStoryRef` (armadilha 3).

### Fase 4 — `useTaskActions` (maior, faça por último)
25 handlers + clone state. É onde mora o `taskMutate` e o AC optimistic granular. Faça
**incremental dentro da fase**: primeiro os inline+save+create (que são autossimilares),
depois os AC, depois bulk, depois clone/dup. Rode tsc entre sub-grupos se quiser.

### Fase 5 — limpeza do page
Remova imports órfãos (use `npx eslint` pra achar `no-unused-vars`), confira que page.tsx
ficou ~300-400 linhas, e que o único estado restante é navegação/projeto/confirm.

### Fase 6 — (OPCIONAL, separado) desinflar props do SprintsTab
Só depois das 1-5 estáveis. O `SprintsTab` recebe 38 props. Opção: passar
`sprintActions` + `taskActions` como 2 objetos em vez de 35 props soltas. Isso toca
`_tabs/sprints-tab.tsx` (alto risco). **Não faça junto com 1-5.**

---

## 7. Armadilhas conhecidas (LEIA antes de codar)

1. **TDZ / ordem de hooks:** os hooks de ação dependem de useMemos (`sprints`, `tasks`,
   `stories`) que dependem dos data-hooks. Declare na ordem do §5.6. Se inverter, runtime
   error "Cannot access before initialization".

2. **`taskMutate` cancela por chave (`${type}:${id}`)** — ele é estável (vem do
   useOptimisticCollection). Passar como arg é seguro, não precisa `useCallback`.

3. **`selectedStoryRef` / `selectedTaskRef` — onde moram?** Eles são (a) setados por
   handlers de create (pra abrir o sheet), (b) setados pelo render (cliques nos tabs/sheets),
   (c) lidos pelos useMemos `selectedStory`/`selectedTask`. **Recomendação:** mantenha-os no
   **page** e passe `setSelectedTaskRef`/`setSelectedStoryRef` como arg pros hooks que criam.
   Mover pra dentro do hook força o page a ler `taskActions.selectedTaskRef` no useMemo, o
   que acopla o useMemo ao hook de ação — pior. Deixe no page.

4. **`confirmState` é compartilhado por 4 clusters.** Fica no page; `setConfirmState` é arg.

5. **Os AC handlers de task (944-1073)** usam `acRowsCollection` + `resolveAcId` +
   `acIdAliasRef` (ref mutável!). O `acIdAliasRef` é um `useRef` — passe a ref inteira, não
   `.current`. Leia o corpo: há mapeamento temp-id → real-id que NÃO pode quebrar senão
   toggles/deletes de AC recém-criado falham.

6. **`handleInlineAssigneeChange` chama `handleInlineAssigneesChange`** (846) — os dois vão
   pro mesmo hook, então a chamada interna continua funcionando. Só garanta que ambos estão
   no mesmo arquivo.

7. **Não rode prettier.** O projeto não usa prettier (não está nas deps; rodar reformata
   código alheio e polui o diff). Indente à mão seguindo o estilo do arquivo (2 espaços).

8. **Working tree tem outras mudanças.** `meeting-sheet.tsx`, `page.tsx` de meetings, etc.
   estão modificados por outra sessão. **Não toque neles.** Seu escopo é só
   `projects/[id]/page.tsx` + os 4 novos `_hooks/*.ts`.

---

## 8. Verificação (Definition of Done)

```bash
# 1. Type-check limpo
npx tsc --noEmit          # exit 0

# 2. Sem lint novo (compare contagem antes/depois nos arquivos tocados)
npx eslint "src/app/(dashboard)/projects/[id]/page.tsx" \
           "src/app/(dashboard)/projects/[id]/_hooks/"*.ts

# 3. page.tsx encolheu
wc -l "src/app/(dashboard)/projects/[id]/page.tsx"   # alvo: < 450 linhas

# 4. Nenhum handler sobrou solto no page (devem estar nos hooks)
grep -cE "async function handle|function handle|function request" \
  "src/app/(dashboard)/projects/[id]/page.tsx"       # alvo: 0

# 5. Smoke test manual (use a skill /run ou /verify):
#    - abrir um projeto, trocar entre tabs Stories/Sprints/Settings
#    - criar/editar/deletar uma task (optimistic + persiste)
#    - criar/ativar/completar/deletar uma sprint
#    - criar story, adicionar AC, marcar AC
#    - duplicar e clonar uma task
#    - criar/deletar module e persona
#    - confirmar que os ConfirmDialog de delete aparecem e funcionam
```

**Critério comportamental:** zero diferença visível pro usuário. Mesmos toasts, mesmos
optimistic updates, mesmos dialogs. Se algo mudou de comportamento, a extração quebrou —
reverta a fase e releia o corpo do handler.

---

## 9. Contexto da reorg (timing)

A reorg de Cerimônias (`docs/meetings-reorg-plan.md`) vai **adicionar um tab** a este page
na Fase 1 dela (`ProjectCeremoniesTab`, novo). Isso é **aditivo** e ortogonal a esta
refatoração — um novo `activeTab === "ceremonies"` no switch + 1 import. Não conflita.
Idealmente faça **esta refatoração antes** da reorg tocar o page, pra o tab novo nascer
num arquivo já enxuto. Se a reorg já tiver adicionado o tab quando você chegar aqui, só
trate `ProjectCeremoniesTab` como mais um caso do switch (não precisa de hook de ação —
ele se auto-gerencia, como `ProjectSessionsTab`).

---

## 10. Resultado (concluído — ZRD-JM-97..101)

Executado em 5 fases, cada uma tsc-clean e commitada separadamente:

| Fase | Commit | O que saiu do page | page.tsx |
|------|--------|--------------------|----------|
| — | (baseline) | — | 2002 |
| 1 | ZRD-JM-97 | `useTaxonomyActions` (8 handlers + module/persona dialog state) | 1875 |
| 2 | ZRD-JM-98 | `useSprintActions` (9 handlers + 7 estados de UI) | 1743 |
| 3 | ZRD-JM-99 | `useStoryActions` (7 handlers) | 1609 |
| 4 | ZRD-JM-100 | `useTaskActions` (25 handlers + findTaskIdByRef + refsToIds + clone state) | 934 |
| 5 | ZRD-JM-101 | limpeza de 12 imports órfãos | 929 |

**Por que 929 e não as ~450 do alvo da seção 7:** o alvo assumia mover só lógica, e
moveu — **zero handler solto** sobrou no page (`grep` da verificação dá 0). As 929 linhas
restantes são **JSX de render** (5 tabs, dialogs, sheets, ribbons, header) + a tab de
Cerimônias que a reorg adicionou no meio do caminho. Deflacionar isso exigiria extrair o
markup de cada tab em subcomponentes — uma "Fase 6" que estava **fora de escopo** desta
refatoração (que era de lógica, não de apresentação). Decisão consciente de parar aqui:
o God-component de *lógica* foi desmontado; a árvore de JSX é uma refatoração separada.

**Não-regressões herdadas:** o eslint reporta 2 errors no page (`react-hooks/preserve-manual-memoization`
no useMemo de `capacities`, e `react-hooks/set-state-in-effect` no effect de default-sprint).
Ambos **pré-existem** ao refactor (confirmado em `610b5d9~1`) — vieram verbatim do original,
não foram introduzidos aqui. Ficam como dívida pré-existente, fora do escopo deste runbook.
