# Planning Command Center

> Documentação da funcionalidade `/rituals/[id]` no modelo staging-commit com árvore hierárquica Module → Story → Task. Complementa [planning-staging-model-plan.md](./planning-staging-model-plan.md) (plano original) e [planning-ceremony-plan.md](./planning-ceremony-plan.md) (schema de dados).

---

## 1. Ideia central — o que é a Planning

A Planning é o **espaço de trabalho do PM** para preparar (ou ajustar) uma sprint. Não é um "ritual de aprovação" no sentido tradicional; é uma **sessão de staging atômica** onde o PM conversa com a Vitória, ela propõe mudanças, ele edita, e tudo só aplica de fato quando ele aperta **Concluir planning**.

A metáfora canônica é Git:

```
Planning #1 (segunda) ──┐
Planning #2 (quarta)  ──┼──► Sprint 23 (estado atual = soma dos commits)
Planning #3 (sexta)   ──┘
```

- **Cada Planning = um commit** na "branch" sprint.
- **Concluir = `git commit`** — append-only, irreversível.
- **Reverter = abrir nova Planning** conversando com a Vitória ("desfaz a criação da VLD-105"). Não existe Reopen.
- **Sprint = HEAD** da branch — soma dos efeitos de todas as plannings concluídas até aqui.

Esse modelo substituiu o anterior de 6 fases manuais (`idle → reading → proposing → approving → closed → archived`) que forçava o PM a clicar "Iniciar leitura", "Revisar" etc. Agora o PM vê só 2 estados: `Em planejamento` e `Concluída`.

---

## 2. As duas camadas — staging × produção

A Planning vive sobre **duas camadas independentes** que aparecem no mesmo componente visual:

```
┌──────────────────────────────────────────────────────────────┐
│  CAMADA REAL (produção)                                      │
│    Module / UserStory / Task — fonte da verdade do banco     │
│    Toda visualização tem como base esse estado.              │
├──────────────────────────────────────────────────────────────┤
│  CAMADA PENDING (staging)                                    │
│    MeetingTaskAction — "esse banco vai ficar assim depois"   │
│    Decora a camada real com pins/ghosts até o PM decidir.    │
└──────────────────────────────────────────────────────────────┘
```

Regras de ouro:

1. A árvore **sempre** renderiza a camada real.
2. A camada pending **decora** nós reais OU **adiciona ghosts** (linhas que ainda não existem).
3. Click no **nó real** → sheet rico (`TaskSheetByRef` / `StorySheetByRef`) para edição direta.
4. Click no **pin/ghost** → `MeetingTaskActionSheet` para decidir (aprovar/rejeitar) ou ajustar o payload da proposta.
5. **Concluir planning** → `applyPendingActionsForPlanning` aplica todas as pending em ordem → tree reflui naturalmente (realtime).

### Estados de uma MeetingTaskAction

Cada proposta tem **dois eixos de estado**:

```
decision:  pending | approved | rejected     ← decisão humana
execution: pending | applied  | failed | skipped   ← efeito no banco real
```

Combinações relevantes:

| decision | execution | O que isso significa | Como a árvore renderiza |
|---|---|---|---|
| `pending` | `pending` | Proposta nova esperando o PM | Pin/ghost normal |
| `approved` | `pending` | PM aprovou individualmente, mas concluir ainda não rodou | Pin com sufixo "✓" |
| `rejected` | `*` | PM rejeitou | Some da árvore |
| `*` | `applied` | Já virou realidade | Some da árvore (vira nó real via realtime) |
| `*` | `failed` | Falhou ao aplicar (post-concluir) | Pin vermelho com tooltip do erro |

---

## 3. A árvore hierárquica — Module → Story → Task

A esquerda da `/rituals/[id]` mostra uma árvore de 3 níveis, copiando exatamente a estrutura do Briefing de Design Session:

```
▾ ▣ Onboarding                  5 stories
   ▾ 📄 ZRDN-S-021  Login com magic link    refined   👤 Cliente   3 AC · 2 tasks
      ├─ 🔧 ZRDN-T-103  Magic link UI          5FP backlog
      ├─ 🔧 ZRDN-T-104  Callback handler       3FP todo
      ├─ ➕ NOVA      Auditoria de login          ai (87%)   ← ghost (create pending)
      └─ →  ENTRANDO  ZRDN-T-150 (do backlog)     ai
   ▸ 📄 ZRDN-S-022  Convite por email          2 tasks
▾ ▣ Billing                     3 stories
   …
```

### Escopo do que aparece

A Planning usa filtro **B — sprint + backlog elegível**:

- **Committed** (sólido, opacity 100%) — tasks com `sprintId = planning.sprintId`.
- **Eligible** (esmaecido, opacity 65%) — tasks com `sprintId IS NULL` cujo `userStoryId` pertence aos **mesmos módulos** das stories já comprometidas. Isto é, o backlog do qual o PM pode puxar coisas para a sprint.

Módulos sem nenhuma task na sprint **não aparecem** (diferente do Briefing DS, que pré-popula todos do projeto). Filtro implementado em [src/lib/dal/hierarchy-tree.ts](../../../src/lib/dal/hierarchy-tree.ts) via `includeEmptyModules: false`.

### Tipos de decoração por tipo de action

A simbologia segue a convenção já estabelecida em `ProposalRow`:

| Type | Glyph | Tom | Onde decora | Comportamento especial |
|---|---|---|---|---|
| `create` | `+` | verde | Ghost row **dentro da story-alvo** (`payload.userStoryId`) | Borda tracejada; click → action sheet |
| `update` | `≠` | azul | Pin no título da task real (`action.taskId`) | Tooltip com diff resumido |
| `delete` | `−` | vermelho | Pin + **strikethrough** no título da task real | Visual de "vai sumir" |
| `move`  | `→` | âmbar | Pin no título da task real | Label dinâmico: "entrando"/"saindo"/"p/ backlog" conforme `targetSprintId` |
| `review` | `?` | cyan | Pin na task OU story (conforme `taskId`/`payload.userStoryId`) | Não muta banco — só fecha como `skipped` |

### Bucket de propostas sem âncora

Propostas que não têm onde se ancorar limpo (ex: `create` sem `userStoryId` válido, `update`/`delete` com `taskId` de task fora do escopo) vão pra uma seção **abaixo da árvore**:

```
┌─ ✨ Propostas sem âncora (3) ───────────────────────────┐
│ [+ create]   Auditoria de login                       │
│ [≠ update]   Refatorar Auth flow                      │
│ [? review]   Devemos manter VLD-088 nesta sprint?     │
└────────────────────────────────────────────────────────┘
```

Mantém visibilidade — nenhuma proposta é "perdida".

---

## 4. Arquitetura técnica

### Componentização — pacote `hierarchy-tree`

O mesmo primitive serve DS Briefing e Planning Command Center:

```
src/components/hierarchy-tree/                 ← pacote presentational
  ├─ types.ts            RowDecoration, GhostTaskNode, callbacks/slots
  ├─ hierarchy-tree.tsx  container puro (expand state, slots)
  ├─ module-row.tsx
  ├─ story-row.tsx
  ├─ task-row.tsx        + DecorationPin (export pra orphan panel reusar)
  └─ index.ts

src/lib/hierarchy-tree-types.ts                ← tipos puros (client-safe)
  HierarchyModuleNode, HierarchyStoryNode, HierarchyTaskNode, HierarchyStats

src/lib/dal/hierarchy-tree.ts                  ← DAL server-only
  buildHierarchyTree({ projectId, filter, includeEmptyModules, guest })
    filter: { kind: "design-session"; sessionId }
          | { kind: "sprint"; sprintId; includeBacklogEligible? }
```

O `HierarchyTree` é puramente apresentacional — recebe `tree`, `actions` via slots, e callbacks. Não sabe nada de Vitor, MeetingTaskAction, ou de qual sheet abrir. Quem orquestra:

- **`DesignSessionTree`** ([src/components/design-session/design-session-tree.tsx](../../../src/components/design-session/design-session-tree.tsx)) — wrapper para DS Briefing. Plumba botões do Vitor ("Detalhar" / "Gerar tasks") via slot `extraStoryActions`. Realtime em `UserStory`, `Task`, `Module` filtrados por `designSessionId`.
- **`PlanningTree`** ([src/components/planning/planning-tree.tsx](../../../src/components/planning/planning-tree.tsx)) — wrapper para Planning. Mapeia `MeetingTaskAction[]` → decorações + ghosts. Realtime em `Task`, `UserStory`, `MeetingTaskAction` filtrados por planning/projeto. Plumba os 3 sheets.

### Endpoints

| Método | Rota | Retorna |
|---|---|---|
| `GET` | `/api/design-sessions/[id]/tree` | `{ sessionId, projectId, tree, stats }` (escopo DS) |
| `GET` | `/api/planning/[id]/tree` | `{ planningId, projectId, sprintId, tree, stats }` (escopo sprint + backlog elegível) |
| `GET` | `/api/planning/[id]/actions` | `MeetingTaskAction[]` (já existia) |
| `POST` | `/api/planning/[id]/complete` | Aplica pending actions + fecha planning (commit) |

Ambos endpoints `/tree` chamam o mesmo helper DAL com filtros diferentes.

### Stats do Ribbon

`PlanningRibbon` mostra contagem segmentada:

```
[3 módulos · 8 stories · 12+2 tasks · 84 FP · 6 propostas]
                            ▲                     ▲
                            12 committed + 2 eligible    amber se >0
```

Stats vêm do `PlanningTree` via callback `onStatsChange` — combinam `stats` do endpoint `/tree` + contagem de actions pending do endpoint `/actions`.

---

## 5. Walkthrough: como o PM usa

### Cenário 1 — Sprint planning de segunda-feira

1. **PM abre `/projects/[id]?tab=ceremonies`** → vê lista, clica em "Planning · Sprint 23 · 28/05".
2. **Tree carrega**: 3 módulos tocados pela sprint, ~12 tasks committed sólidas + algumas eligible esmaecidas.
3. **PM puxa contexto**: clica "Contexto" no ribbon, importa transcript da daily de sexta + da call com cliente.
4. **PM pede análise no chat**: "Vitória, baseado nessa daily, o que ajusto na sprint?"
5. **Vitória propõe**: aparecem ghosts e pins. Tree fica com `+ Nova Recovery`, `→ Saindo VLD-102`, `≠ Alterar scope VLD-101`.
6. **PM clica num pin** que não convence (ex: a alteração de scope) → abre `MeetingTaskActionSheet` → ajusta o payload manualmente.
7. **PM aperta "Concluir planning"** → confirm dialog avisa "5 propostas serão aplicadas" → ok.
8. **Pending actions executam** em sequência. Realtime atualiza a tree: ghosts viram tasks sólidas, pins somem.
9. **Planning fica "Concluída"**. Sprint 23 agora tem o estado novo.

### Cenário 2 — Ajuste mid-sprint na quarta

1. **PM abre `/rituals/new?sprintId=23`** → nova planning na mesma sprint.
2. **Vitória já está fresh** mas pode ler contexto da planning anterior se importar.
3. **PM no chat**: "Cancela a Recovery e troca pelo Audit Logs".
4. **Vitória propõe**: `+ Nova Audit Logs`, `− Remover VLD-105` (a Recovery criada segunda).
5. **PM concluir** → audit trail mostra Sprint 23 = Planning#1 + Planning#2.

Não há "Reopen" da Planning#1. Cada ajuste é commit novo.

---

## 6. Garantias / invariantes

- **Atomicidade do commit**: `concludePlanning` aplica em ordem `create → update → move → delete`. Se uma falha (`execution=failed`), as anteriores ficam aplicadas e a planning **não avança** para `closed`. PM pode editar payload da falhada e abrir nova planning.
- **Audit trail completo**: nenhuma action é deletada — `decision`/`execution` preservam histórico. `MeetingTaskAction.aiReasoning` mantém porquê a Vitória sugeriu.
- **State machine guardrail**: trigger SQL em `PlanningCeremony` revalida transições de phase como defesa em segundo nível, mesmo se a API for chamada fora da DAL.
- **Realtime sem race**: três canais Supabase (Task, UserStory, MeetingTaskAction) com debounce de 500ms convergem para um único reload da tree+actions. Conflitos de optimistic resolvem-se pela próxima leitura.
- **RLS por trás**: DAL bypassa RLS (usa `db()` service_role) mas a rota valida `requireProjectViewApi`/`requireProjectEditTasksApi` antes. Guest mode (via `isGuestActor`) mascara FP nas tasks.

---

## 7. Limites conhecidos

- **Eligible scope é por módulo**, não por story específica. Se PM quer "ver só backlog da story X", precisa do TaskSheet. Considerar filtro futuro no ribbon.
- **Story `create` ainda não tem ghost**: a Vitória atual só cria Task (não Story). Quando isso mudar, adicionar slot `ghostStoriesForModule` no `HierarchyTree`.
- **`update` não mostra diff visual no pin** — só hint com `aiReasoning`. Diff completo aparece dentro do `MeetingTaskActionSheet`. Melhoria pendente: tooltip rico com `field: old → new`.
- **Realtime de `MeetingTaskAction` requer publication ativa em Supabase**. Se ações novas não aparecem sozinhas, verificar `ALTER PUBLICATION supabase_realtime ADD TABLE "MeetingTaskAction"`.

---

## 8. Como evoluir

| Quer adicionar… | Onde mexer |
|---|---|
| Novo tipo de action (ex: `link`) | Adicionar em `MeetingTaskAction.type` no schema + caso no switch de `buildDecorations` em `planning-tree.tsx` + handler em `task-action-executor.ts` |
| Nova decoração visual (ex: pin laranja "✦ urgente") | Estender `RowDecoration.tone` em [hierarchy-tree/types.ts](../../../src/components/hierarchy-tree/types.ts) + `DECORATION_TONE` em `task-row.tsx` |
| Reusar a tree em outra tela (ex: Release Planning) | Criar wrapper análogo a `PlanningTree`/`DesignSessionTree` + novo filtro em `HierarchyFilter` + endpoint `GET /api/<scope>/[id]/tree` |
| Mudar o que é "eligible" | Ajustar query em `buildHierarchyTree` (sprint branch) — hoje é `sprintId IS NULL AND moduleId IN <touched>` |

---

## 9. Arquivos-chave (referência rápida)

**Server**
- [src/lib/dal/hierarchy-tree.ts](../../../src/lib/dal/hierarchy-tree.ts) — DAL helper genérico
- [src/lib/hierarchy-tree-types.ts](../../../src/lib/hierarchy-tree-types.ts) — tipos puros compartilhados
- [src/lib/dal/planning.ts](../../../src/lib/dal/planning.ts) — `concludePlanning` (staging-commit)
- [src/lib/meetings/task-action-executor.ts](../../../src/lib/meetings/task-action-executor.ts) — `applyPendingActionsForPlanning`
- [src/app/api/planning/[id]/tree/route.ts](../../../src/app/api/planning/[id]/tree/route.ts) — endpoint planning
- [src/app/api/design-sessions/[id]/tree/route.ts](../../../src/app/api/design-sessions/[id]/tree/route.ts) — endpoint DS

**Client — primitive**
- [src/components/hierarchy-tree/](../../../src/components/hierarchy-tree/) — pacote completo

**Client — wrappers**
- [src/components/design-session/design-session-tree.tsx](../../../src/components/design-session/design-session-tree.tsx) — wrapper DS
- [src/components/planning/planning-tree.tsx](../../../src/components/planning/planning-tree.tsx) — wrapper Planning (com decorações)

**Client — sheets canônicos (reuso)**
- [src/components/task-sheet-by-ref.tsx](../../../src/components/task-sheet-by-ref.tsx) — abre task rica em qualquer contexto
- [src/components/story-sheet-by-ref.tsx](../../../src/components/story-sheet-by-ref.tsx) — abre story rica em qualquer contexto
- [src/components/meetings/meeting-task-action-sheet.tsx](../../../src/components/meetings/meeting-task-action-sheet.tsx) — decisão/edit de proposta

**Client — chrome**
- [src/components/planning/planning-ribbon.tsx](../../../src/components/planning/planning-ribbon.tsx) — header com stats hierárquicos
- [src/app/(dashboard)/rituals/[id]/page.tsx](../../../src/app/(dashboard)/rituals/[id]/page.tsx) — página orquestradora
