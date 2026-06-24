# VITORIA — VISÃO DE STORIES NA PLANNING — Runbook

> **Não-Ralph.** Capacidade evolutiva com julgamento + human-in-the-loop — iterada por humano + Claude, não por loop autônomo. Mesmo regime do [vitoria-weekly-planning-runbook.md](vitoria-weekly-planning-runbook.md) e do [pm-review-unified-app-runbook.md](pm-review-unified-app-runbook.md).
>
> **Escopo:** surface `planning` (e `release_planning` herda). É **planning/execução de projeto vivo** — **NÃO** substitui o story tree que o Vitor monta na Design Session Inception.
>
> **Companheiro / não-sobreposição:** o `vitoria-weekly-planning-runbook.md` cobre sprint awareness, tradução de SSOT externo, bulk de tasks e cadência. Este aqui cobre **só a visão de stories** (ler a árvore, escrever story+AC, decompor). Não há colisão de escopo.
>
> **Data de abertura:** 2026-06-21 (pós-calibração da Vitoria no planning).

---

## §1 — A dor

Na calibração da Vitoria no planning (2026-06-21) ficou claro: ela cria **tasks** muito bem (via `propose_task_action` / `propose_tasks` → staging em `MeetingTaskAction`, PM aprova no Concluir), mas **não tem visão de stories**. Três problemas concretos, todos verificados no código:

1. **`propose_story` é raso e cego.** A tool ([tools.ts:573](../../src/lib/agent/agents/vitoria/tools.ts)) só recebe `title/want/soThat/proposedModuleName`, cria a `UserStory` **na hora** (não em staging) com `refinementStatus='draft'` e **sem AC nenhum**. A Vitoria não consegue: ver as stories que já existem no projeto, decompor uma story em tasks de forma guiada, gerir o status da story, nem anexar critérios de aceite. Story vira casca vazia.

2. **A planning não mostra a árvore de stories.** O staging (`ReleasePlanningProposals`) lista propostas de task **planas** — sem agrupar por story/módulo. `get_planning_state` ([tools.ts:1103](../../src/lib/agent/agents/vitoria/tools.ts)) devolve `pendingProposals` + `activeNotes` + `sprintMemory`, mas **zero stories**. A Vitoria cria uma story, pendura tasks via `userStoryId`, e nem ela nem o PM enxergam a hierarquia resultante no fluxo. O PM não confia no que não vê.

3. **Decompor story→task é um caminho não-trilhado.** O encanamento existe: `propose_task_action(create)` aceita `payload.userStoryId` e o executor ([task-action-executor.ts:300,467](../../src/lib/meetings/task-action-executor.ts)) já **consome e valida** o link contra o projeto (fail-soft → null). Mas a Vitoria não tem ferramenta pra **ler a story e suas tasks** antes de decompor, nem pra saber quais AC a story precisa cobrir. Decompõe no escuro.

O domínio já tem hierarquia rica (`Module → UserStory → AcceptanceCriterion`, `UserStory ↔ Task` via `userStoryId`) e DAL madura ([story-hierarchy.ts](../../src/lib/dal/story-hierarchy.ts)). Falta **dar à Vitoria, na planning, as ferramentas de leitura + as de escrita de story/AC + o estado visível** — reusando o que existe, sem schema paralelo.

**Uma frase:** dar à Vitoria, na planning, uma capacidade real de stories — ler a árvore `Module→Story→Task`, propor/editar story com AC, e decompor story em tasks guiada — reusando `Module`/`UserStory`/`AcceptanceCriterion` e o staging de `MeetingTaskAction` (PM aprova), **sem migration nova** e sem substituir o story-tree do Vitor.

---

## §2 — O que NÃO entra (não deixe a sessão derivar)

- **Não** cobre sprint awareness, bulk de tasks, comentário, ingestão de Granola/transcript — isso é do runbook irmão [vitoria-weekly-planning-runbook.md](vitoria-weekly-planning-runbook.md).
- **Não** substitui o story tree do Vitor em Design Session. Vitor monta a árvore na DS Inception; aqui é planning/execução, projeto vivo. **Sem colisão:** mesma tabela `UserStory`, escopos distintos por `designSessionId` (story de planning tem `designSessionId IS NULL`).
- **Não** cria entidade/tabela nova de story. Reusa `Module`/`UserStory`/`AcceptanceCriterion`.
- **Não** introduz "staging de story" como nova tabela. A story é criada/editada **direto** (igual `propose_story` hoje); só as **tasks** passam por `MeetingTaskAction`. (Ver D2 — decisão deliberada, não dívida.)
- **Não** muda o contrato de `propose_task_action`/`propose_tasks` (já aceitam `userStoryId`).
- **Não** toca PM Review nem Release Planning surface — escopo é a surface `planning` (e `release_planning` herda por já incluir `VITORIA_PLANNING_PROJECT_NAMES`, mas não é foco).
- **Não** implementa aprovação humana por-card da story (story aparece viva; o PM corrige via chat, como hoje).
- **Não** mexe em RLS — todas as escritas passam por DAL `server-only` / service-role do daemon, igual ao restante das tools da Vitoria.
- **Não** cria `Module` real (CHECK `^[A-Z][A-Z0-9_]*$` + `normalizeModuleName` é território da promoção via cascata da DS). A Vitoria agrupa por `proposedModuleName` (texto livre).

---

## §3 — Modelo mental

```
┌──────────────────────────────────────────────────────────────────────┐
│ Surface: planning (thread.channel='planning')                         │
│   Chat Vitoria  ──►  daemon (Claude SDK)  ──► tool calls               │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ MCP tool advertise (schema-only no daemon)
                                 │ execução PROXIED pro monorepo
                ┌────────────────┴─────────────────────────────────┐
                │ buildVitoriaTools(planningId, projectId)          │
                │  (src/lib/agent/agents/vitoria/tools.ts)          │
                ├───────────────────────────────────────────────────┤
                │ READ (novas):                                     │
                │   list_project_stories  → getStoriesForProject    │
                │   get_story_detail      → getStoryByReference     │
                │   get_planning_state    → + bloco `stories`       │
                │ WRITE (alteradas/novas):                          │
                │   propose_story (+acceptanceCriteria, anti-dup)   │
                │   update_story  → updateStory / setStoryRefinement│
                │   decompose_story → lê AC + devolve plano de tasks │
                │ (decompose NÃO escreve task; instrui o modelo a    │
                │  chamar propose_task_action com userStoryId)       │
                └────────────────┬─────────────────────┬────────────┘
                                 │                      │
                  ┌──────────────┴─────┐   ┌────────────┴───────────────┐
                  │ DAL story-hierarchy│   │ MeetingTaskAction (staging)│
                  │  UserStory/Module/ │   │  payload.userStoryId        │
                  │  AcceptanceCriterion│   │  → executor valida + linka  │
                  └────────────────────┘   └─────────────────────────────┘
```

**Fluxo de decomposição (ordem fixada — D3):**

1. Vitoria chama `list_project_stories` → vê o que existe.
2. Se a story-alvo não existe: `propose_story({title, want, soThat, proposedModuleName, acceptanceCriteria})` → recebe `storyId`.
3. `decompose_story(storyId)` → recebe AC + tasks já penduradas.
4. Para cada AC sem task: `propose_task_action({type:'create', payload:{..., userStoryId: storyId}})` → staging.
5. PM Conclui a planning → `applyPendingActionsForPlanning` aplica as tasks, executor linka `userStoryId` (validado).

**Invariante central:** a story é o container leve (criada direto, `draft` + `createdByAgent`); só as **tasks** passam por staging e aprovação do PM. A Vitoria **lê antes de propor** (anti-duplicação). O Module real materializa só na cascata da DS.

---

## §4 — Decisões fixadas (Dn — imutáveis, não rediscutir no meio)

| # | Decisão | Por quê |
|---|---------|---------|
| **D1** | **Reusar `Module` / `UserStory` / `AcceptanceCriterion`** (sem tabela nova). | Hierarquia madura já existe ([story-hierarchy.ts](../../src/lib/dal/story-hierarchy.ts)); paralelo seria dívida. Schema confirmado: `UserStory(projectId, moduleId, proposedModuleName, reference, title, want, soThat, personaId, refinementStatus, createdByAgent, designSessionId, dismissedAt)`. |
| **D2** | **Story criada/editada DIRETO (não em staging); só TASKS passam por `MeetingTaskAction`.** | É o modelo atual do `propose_story` — story é o container leve que agrupa os ghosts das tasks staged. Pôr story em staging exigiria tabela nova (§2). A story nasce `refinementStatus='draft'` + `createdByAgent=true` (igual hoje), visível como container; as tasks continuam propostas até o PM Concluir. |
| **D3** | **Decompor story→task = `propose_task_action(create)` com `payload.userStoryId`** apontando pra story que JÁ EXISTE. | Encanamento já existe e é validado no executor (fail-soft → null, [task-action-executor.ts:467](../../src/lib/meetings/task-action-executor.ts)). **Ordem obrigatória:** story criada via `propose_story` ANTES de pendurar tasks (`decompose_story` reforça isso devolvendo o `storyId` + AC pra derivar). |
| **D4** | **`propose_story` ganha `acceptanceCriteria: string[]` opcional**; AC gravado via `AcceptanceCriterion.insert({userStoryId})` no mesmo fluxo. | DAL `createStory` já aceita `acceptanceCriteria[]` e grava em `AcceptanceCriterion` ([story-hierarchy.ts:278](../../src/lib/dal/story-hierarchy.ts)). A tool atual ignora isso — é o gap mais barato de fechar. **`AcceptanceCriterion.userStoryId` é coluna real** (FK `AcceptanceCriterion_userStoryId_fkey` confirmada) → AC de story já é suportado pelo schema. |
| **D5** | **`update_story` edita `title/want/soThat/proposedModuleName/refinementStatus`** via DAL `updateStory`. | `refinementStatus` é `'draft'\|'refined'\|'committed'` (CHECK no DB). A Vitoria promove `draft→refined` quando a story está madura; **`committed` fica pra cascata da DS** (rejeitado no execute). Edição reusa `updateStory` que já existe. |
| **D6** | **3 reads: `list_project_stories`, `get_story_detail`, e `get_planning_state` passa a incluir `stories`.** | A Vitoria precisa VER antes de propor (anti-duplicação de story, reuso de id). Reusa `getStoriesForProject` / `getStoryByReference` da DAL. `get_planning_state` ganha um bloco `stories` (árvore Módulo→Story→#tasks) — fecha o problema #2. |
| **D7** | **Toda tool nova/alterada espelha nos DOIS repos** (monorepo `tools.ts` com `execute` + daemon `tools.ts` schema-only + `tools-registry.ts` nos dois). | Memory [[project_daemon_tool_advertisement]]: daemon anuncia schema da própria cópia, execução é proxied pro monorepo. **Confirmado: `propose_story` no daemon é stub sem `execute`** ([zordon-daemon .../vitoria/tools.ts:96](../../../zordon-daemon/src/lib/agent/agents/vitoria/tools.ts)). |
| **D8** | **Escopo = surface `planning`**; as tools entram em `VITORIA_PLANNING_PROJECT_NAMES` (projectId-only). | Reads e escrita de story são project-scoped, não precisam de `planningId` (igual `propose_story` hoje). Entram no array que já alimenta `VITORIA_PLANNING_TOOLS` e `VITORIA_RELEASE_PLANNING_TOOLS` (herdam por spread). |
| **D9** | **`propose_story` checa título existente no projeto (case-insensitive, não-dismissed) e devolve o id existente** em vez de criar 2ª. | Espelha o anti-dup de task do executor ([task-action-executor.ts:430](../../src/lib/meetings/task-action-executor.ts)). Evita árvore poluída com stories irmãs idênticas em re-plano. |
| **D10** | **`proposedModuleName` é texto livre na proposta; promoção a `Module` real só na cascata da DS** (`approveProposedModule`). | A Vitoria não cria `Module` (CHECK `^[A-Z][A-Z0-9_]*$` + `normalizeModuleName` é território da promoção). Ela agrupa por `proposedModuleName`; o Module real materializa quando/se a DS for concluída. Mantém o modelo atual. |
| **D11** | **Schema Zod fino + clamp server-side**; sem `.min()/.max()` em `z.array()`. | Memory [[feedback_anthropic_structured_output_no_array_constraints]]: API recusa minItems/maxItems com Anthropic. AC: array sem constraint de tamanho, clamp/validação no `execute`. |
| **D12** | **Cada tool nova ganha ≥1 caso no driver de calibração da Vitoria** quando o comportamento for observável. | Loop de calibração (AGENTS.md): bug recorrente vira eval case. Aqui pré-empta: o cenário "decompôs story sem ler AC" vira case. (Opcional / Fase-2-friendly.) |

---

## §5 — As tools (cada caixa = função/tool real)

| Tool | Tipo | Args (modelo) | Contrato de retorno | Reusa |
|------|------|---------------|---------------------|-------|
| `list_project_stories` | read | `{ moduleName?, refinementStatus?, includeDismissed? }` | `{ ok, stories: [{ id, reference, title, moduleName, want, taskCount, acCount, refinementStatus }] }` | `getStoriesForProject(projectId)` ou query enxuta `UserStory + Module(name) + AcceptanceCriterion(count) + Task(count)` |
| `get_story_detail` | read | `{ refOrId }` | `{ ok, story: { id, reference, title, want, soThat, moduleName, refinementStatus, acceptanceCriteria:[{id,text}], tasks:[{id,reference,title,status}] } }` | `getStoryByReference` (aceita ref OU id) |
| `propose_story` (alterada) | write | `{ title, want, soThat?, proposedModuleName?, acceptanceCriteria? }` | `{ ok, storyId, reference, title, acCreated, deduped? }` | `nextUserStoryReference` + insert `UserStory` + `AcceptanceCriterion.insert` por AC; anti-dup por título |
| `update_story` | write | `{ storyId, title?, want?, soThat?, proposedModuleName?, refinementStatus? }` | `{ ok, storyId, fieldsUpdated[] }` | `updateStory` / `setStoryRefinement` |
| `decompose_story` | read+guidance | `{ refOrId }` | `{ ok, storyId, want, soThat, acceptanceCriteria[], existingTasks[], hint }` | lê AC da story; `hint` instrui o modelo a chamar `propose_task_action(create)` com `userStoryId` pra cada AC sem task |
| `get_planning_state` (alterada) | read | `{}` | `{ ..., stories:[{ id, reference, title, moduleName, taskCount, acCount, refinementStatus }] }` (campo novo, retrocompatível) | adiciona bloco `stories` (árvore) ao retorno existente |

Todas resolvem `projectId` (e `planningId` quando relevante) do **closure** `buildVitoriaTools` — nunca arg do modelo (espelha o resto das tools). `decompose_story` **NÃO escreve task** — apenas leitura + orientação; a escrita é responsabilidade do `propose_task_action`, mantendo o staging como único caminho de task.

**Esta capacidade é 100% tools de agente (MCP)** — não adiciona endpoint REST. As tools são síncronas (< 1s, CRUD de story/AC + queries) → **não** precisam do contrato async 202+jobId (esse vale pra LLM/job > 1s; aqui o LLM já é o caller, a tool é a folha).

---

## §6 — Schema (o que muda: nada)

**Reusa — sem migration nova.** Todas as tabelas já existem (verificado em `src/lib/supabase/database.types.ts`):

- `UserStory` — `id, projectId, moduleId, proposedModuleName, reference, title, want, soThat, personaId, refinementStatus, createdById, createdByAgent, designSessionId, dismissedAt, acValidatedAt, createdAt, updatedAt`. (linha 8138)
- `Module` — `id, projectId, name (CHECK ^[A-Z][A-Z0-9_]*$), description, approvedAt, approvedBy`. (linha 4561) → **mantém `proposedModuleName` texto livre, materializa Module via cascata da DS (D10).**
- `AcceptanceCriterion` — `id, userStoryId, taskId, text, order, checkedAt, checkedBy`. **FK `AcceptanceCriterion_userStoryId_fkey` confirmada → AC de story já suportado.** (linha 42)
- `MeetingTaskAction` — `payload.userStoryId` **consumido e validado** no apply ([task-action-executor.ts:300, 467](../../src/lib/meetings/task-action-executor.ts)). (linha 4065)
- RPC `next_user_story_reference(p_project_id)` — existe (database.types.ts:8873).

**RLS:** sem mudança. Reads/writes da Vitoria rodam via DAL `server-only` (monorepo) com a credencial já em uso pelas tools existentes (service-role no daemon). Nenhuma policy nova.

**ALTER considerado e DESCARTADO (registro):** distinguir story criada pela Vitoria na planning vs Vitor na DS poderia usar `UserStory.createdByAgentSlug text`. **Decisão: NÃO fazer** — `createdByAgent=true` + `designSessionId IS NULL` já distingue (story de planning não tem `designSessionId`). Listado só pra constar que foi considerado.

---

## §7 — Passos de implementação (Fase 1)

Cada passo é cirúrgico e reusa DAL/schema existentes. Ordem por dependência (o espelho daemon e o registry fecham a cadeia). **Critério de pronto global:** `pnpm tsc --noEmit` limpo nos dois repos; as 4 tools novas aparecem em `getToolNamesForAgent('vitoria','planning')`; sem `.min()/.max()` em nenhum `z.array()` (D11).

### Passo 1 — read: `list_project_stories` (monorepo)
Adiciona a tool em `buildVitoriaTools`. Lê stories do projeto (não-dismissed por default) com `moduleName`, `taskCount`, `acCount`, `refinementStatus`. Query enxuta sobre `UserStory + Module(name) + AcceptanceCriterion(count) + Task(count)` — **não** traz description/AC text (isso é `get_story_detail`).
- **Toca:** `src/lib/agent/agents/vitoria/tools.ts`
- **Pronto quando:** `inputSchema` `{ moduleName?, refinementStatus?, includeDismissed? }`; retorna `{ ok:true, stories:[...] }`; filtra `projectId` do closure + `dismissedAt IS NULL` salvo `includeDismissed=true`; sem array min/max.

### Passo 2 — read: `get_story_detail` (monorepo)
Aceita `refOrId` (reference `VLD-NNN` OU uuid) e devolve a story completa: want/soThat/moduleName/refinementStatus + `acceptanceCriteria[{id,text}]` + `tasks[{id,reference,title,status}]`. Reusa `getStoryByReference` (ref) ou query por id; valida que a story é do `projectId` do closure.
- **Toca:** `src/lib/agent/agents/vitoria/tools.ts`
- **Pronto quando:** resolve por reference se casar `^[A-Z]+-\d+$`, senão por id; AC ordenados por `order`; tasks penduradas (`Task.userStoryId = story.id`, `dismissedAt IS NULL`); `{ ok:false, error }` se for de outro projeto ou não existir.

### Passo 3 — write: `propose_story` ganha `acceptanceCriteria` + anti-dup (monorepo)
Estende `propose_story` ([tools.ts:573](../../src/lib/agent/agents/vitoria/tools.ts)): adiciona `acceptanceCriteria: z.array(z.string()).optional()` (sem min/max — D11) e, no `execute`: (a) checa título duplicado no projeto (case-insensitive, `dismissedAt IS NULL`) devolvendo o `storyId` existente + `deduped:true` em vez de criar 2ª (D9); (b) após o insert da story, grava cada AC não-vazio via `AcceptanceCriterion.insert({ userStoryId, text, order })`.
- **Toca:** `src/lib/agent/agents/vitoria/tools.ts`
- **Pronto quando:** AC com ≥3 chars gravados com `userStoryId` + `order` sequencial; título já existente retorna id existente com `deduped:true` sem inserir; retorno inclui `acCreated` (int) + `deduped?` (bool); sem array min/max.
- **Sanity SQL (FK existe):** `SELECT count(*) FROM "UserStory" us JOIN "AcceptanceCriterion" ac ON ac."userStoryId"=us.id LIMIT 1` roda → confirma que o caminho de gravação é válido.
- **Depende de:** Passo 1.

### Passo 4 — write: `update_story` (monorepo)
Adiciona `update_story` que edita uma story existente. Reusa `updateStory` da DAL. `refinementStatus` aceita só `'draft'|'refined'` do agente (**rejeita `'committed'`** com erro claro — D5). Valida que a story é do `projectId` do closure antes de mutar.
- **Toca:** `src/lib/agent/agents/vitoria/tools.ts`
- **Pronto quando:** pelo menos 1 campo obrigatório (erro se patch vazio); `refinementStatus='committed'` retorna `{ ok:false, error }`; story de outro projeto não muta; retorna `{ ok, storyId, fieldsUpdated:[] }`.
- **Depende de:** Passo 2.

### Passo 5 — read+guidance: `decompose_story` (monorepo)
Adiciona `decompose_story({ refOrId })` que lê a story (reusa lógica do Passo 2), devolve `{ ok, storyId, want, soThat, acceptanceCriteria[], existingTasks[], hint }` onde `hint` instrui o modelo a chamar `propose_task_action(create)` com `payload.userStoryId = storyId` pra cada AC ainda sem task. **NÃO escreve task** (leitura + orientação — a escrita é do `propose_task_action`, mantendo o staging como único caminho).
- **Toca:** `src/lib/agent/agents/vitoria/tools.ts`
- **Pronto quando:** retorna AC + tasks penduradas + `hint` textual citando `propose_task_action` e `userStoryId`; erro claro se a story não existir/for de outro projeto (reforça ordem D3); **nenhum INSERT/UPDATE em Task nem MeetingTaskAction.**
- **Depende de:** Passo 2.

### Passo 6 — read: `get_planning_state` ganha bloco `stories` (monorepo)
Estende `get_planning_state` ([tools.ts:1103](../../src/lib/agent/agents/vitoria/tools.ts)) adicionando `stories:[{ id, reference, title, moduleName, taskCount, acCount, refinementStatus }]` ao retorno (campo novo, **retrocompatível** — não remove nada). Query project-scoped sobre `UserStory` (não-dismissed) + contagens. **Fecha o problema #2** (estado da árvore visível no fluxo).
- **Toca:** `src/lib/agent/agents/vitoria/tools.ts`
- **Pronto quando:** retorna o objeto existente + chave `stories`; campos `id, reference, title, moduleName, taskCount, acCount, refinementStatus`; `dismissedAt IS NULL`, project-scoped pelo closure; nenhum campo pré-existente removido/renomeado.
- **Depende de:** Passo 1.

### Passo 7 — espelho daemon: schemas das tools novas (zordon-daemon) — **D7, regra das 2 cópias**
Espelha no daemon ([zordon-daemon .../vitoria/tools.ts](../../../zordon-daemon/src/lib/agent/agents/vitoria/tools.ts)) os **schemas** (advertise only, **sem `execute`** — o daemon proxia a execução pro monorepo) das tools `list_project_stories`, `get_story_detail`, `update_story`, `decompose_story`, e atualiza o schema/descrição de `propose_story` pra incluir `acceptanceCriteria`. `get_planning_state` não muda de schema (mesmo input `{}`). **Reiniciar o daemon depois** (ele anuncia o schema da própria cópia).
- **Toca:** `../zordon-daemon/src/lib/agent/agents/vitoria/tools.ts`
- **Pronto quando:** daemon `tools.ts` tem entradas schema-only pras 4 tools novas; `propose_story` inclui `acceptanceCriteria` no `inputSchema`; nenhuma entrada nova tem `execute`; tsc do daemon passa.
- **Depende de:** Passos 3, 4, 5.

### Passo 8 — registry: tools novas em `VITORIA_PLANNING_PROJECT_NAMES` nos dois repos (D8)
Registra as 4 tools novas de leitura/escrita de story em `VITORIA_PLANNING_PROJECT_NAMES` (projectId-only, planningId opcional — D8) nos DOIS `tools-registry.ts` (monorepo [tools-registry.ts:399](../../src/lib/agent/tools-registry.ts) e daemon). `propose_story` e `get_planning_state` já estão registrados (alterações in-place, não re-registrar). `VITORIA_PLANNING_TOOLS` e `VITORIA_RELEASE_PLANNING_TOOLS` herdam por spread.
- **Toca:** `src/lib/agent/tools-registry.ts`, `../zordon-daemon/src/lib/agent/tools-registry.ts`
- **Pronto quando:** `VITORIA_PLANNING_PROJECT_NAMES` nos dois repos inclui os 4 nomes; as 4 aparecem em `getToolNamesForAgent('vitoria','planning')`; tsc passa nos dois.
- **Depende de:** Passo 7.

> **Ordem de execução resumida:** 1 e 2 (reads, paralelos) → 3 e 6 dependem de 1 → 4 e 5 dependem de 2 → 7 (espelho daemon) depende de 3/4/5 → 8 (registry) depende de 7. ~3h25 total, reuso máximo, zero migration.

---

## §8 — Faseamento (1→3 · cada fase entrega mais que hoje)

### Fase 1 — Capacidade de story na planning `[este runbook]`
Entrega **mais** que o sistema atual: hoje a Vitoria só tem `propose_story` raso. A Fase 1 dá leitura (3 reads), escrita rica (story+AC, update, status), decomposição guiada, e estado visível (`get_planning_state.stories`). Tudo espelhado no daemon. (Os 8 passos do §7.)

### Fase 2 — Visualização agrupada + eval
- `ReleasePlanningProposals` agrupa cards por story/módulo (UX §9 wireframe abaixo).
- Casos de eval no driver da Vitoria (D12) — começando pelo cenário "decompôs story sem ler AC".
- `decompose_story` opcionalmente sugere PFV por AC (heurística).

### Fase 3 — Refinamento de árvore (opcional)
- Vitoria propõe **mover** tasks soltas pra dentro de uma story (`propose_task_action(update, userStoryId)`) em lote.
- Sugestão de split de story grande (> N AC) em duas — só se houver evidência de que stories grandes acontecem no planning (vs só na DS).

Fase 1 entrega ≥ o que existe hoje sem regressão — `propose_story` continua funcionando, só ganha campos; nada é tirado.

---

## §9 — UX

A surface de planning hoje mostra propostas de task planas (`ReleasePlanningProposals`). A mudança de UX é **mínima e opcional na Fase 1** — o foco é a capacidade do agente. O ganho vem de `get_planning_state.stories` ficar disponível pro chat narrar a árvore:

```
Chat Vitoria (planning):
┌────────────────────────────────────────────────────────────┐
│ Vitoria: Li o backlog. Estado atual:                         │
│                                                              │
│  Módulo COBRANCA                                             │
│   └─ Story VLD-12 "Conciliação de cobrança" (refined)        │
│        AC: 4 · tasks: 1  ⚠ 3 AC sem task                     │
│   └─ Story VLD-19 "Estorno" (draft) · AC: 2 · tasks: 0       │
│                                                              │
│  Proponho 3 tasks na VLD-12 (1 por AC descoberto).           │
│  [aparecem no staging, penduradas na story]                  │
└────────────────────────────────────────────────────────────┘
```

**Wireframe da árvore no staging (Fase 2, opcional):** agrupar `ReleasePlanningProposals` por `payload.userStoryId` → header de story (reference + título) sobre os cards de task. Não-bloqueante; a Fase 1 entrega a capacidade, a Fase 2 a visualização agrupada.

---

## §10 — Integrações

- **Design Session (Vitor):** Vitor cria a árvore na DS Inception; quando a DS conclui, stories viram `committed` e Module materializa ([completeSession](../../src/lib/dal/story-hierarchy.ts)). A Vitoria na planning opera sobre o projeto vivo — pode reusar stories já `committed` (pendura mais tasks) ou criar stories novas de planning (`designSessionId IS NULL`). **Sem colisão:** Vitor escreve story na DS, Vitoria escreve story na planning; mesma tabela, escopos distintos por `designSessionId`.
- **Tasks (staging):** `decompose_story` → `propose_task_action(userStoryId)` → `applyPendingActionsForPlanning` → executor linka. Encanamento existente.
- **PM Review / Release Planning:** intocados. `release_planning` herda as tools novas por incluir `VITORIA_PLANNING_PROJECT_NAMES`, sem esforço extra.
- **Daemon:** espelho obrigatório (D7) + restart.

---

## §11 — Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Vitoria duplica story em re-plano | Média | Médio | Anti-dup por título no `propose_story` (D9); `list_project_stories` antes de criar (prompt) |
| Decompõe story antes de criá-la (ordem invertida) | Média | Médio | `decompose_story` exige `storyId` existente e devolve erro claro se não achar; `propose_task_action` com `userStoryId` inválido já fail-soft → null no executor (não quebra) |
| `userStoryId` órfão (story dismissed entre propor e aplicar) | Baixa | Baixo | Executor valida `validStoryKeys` no apply ([task-action-executor.ts:341](../../src/lib/meetings/task-action-executor.ts)); link vira null + warn, task ainda é criada |
| Schema Zod com array min/max quebra Anthropic | Média | Alto | D11 — sem `.min()/.max()` em `z.array()`; clamp server-side |
| Daemon e monorepo divergem (tool num só) | Média | Alto | D7 — checklist de espelho; verificação roda grep nos dois repos (§12) |
| Vitoria seta `refinementStatus='committed'` indevidamente | Baixa | Médio | `update_story` aceita só `draft`/`refined` do agente; `committed` é território da cascata da DS (validação no execute) |
| Story de planning polui a lista do projeto antes de aprovada | Baixa | Baixo | Story nasce `draft` + `createdByAgent`; lista do projeto/DS filtra por status; PM corrige via chat (modelo atual, D2) |

---

## §12 — Métricas de sucesso (cada uma com instrumento)

| Métrica | Meta | Instrumento |
|---------|------|-------------|
| Tasks penduradas em story | ≥ 60% das tasks criadas pela Vitoria na planning têm `userStoryId` (30d) | `SELECT count(*) FILTER (WHERE "userStoryId" IS NOT NULL)::float / count(*) FROM "Task" WHERE "createdByAgent" AND "designSessionId" IS NULL AND "createdAt" > now()-interval '30d'` |
| Stories da Vitoria com ≥1 AC | ≥ 70% das stories criadas via `propose_story` na planning têm AC | `SELECT count(DISTINCT us.id) FILTER (WHERE ac.id IS NOT NULL)::float / count(DISTINCT us.id) FROM "UserStory" us LEFT JOIN "AcceptanceCriterion" ac ON ac."userStoryId"=us.id WHERE us."createdByAgent" AND us."designSessionId" IS NULL AND us."createdAt" > now()-interval '30d'` |
| Stories órfãs (0 tasks) | < 20% das stories de planning ficam sem task após conclude | `SELECT count(*) FILTER (WHERE t.id IS NULL)::float / count(*) FROM "UserStory" us LEFT JOIN "Task" t ON t."userStoryId"=us.id WHERE us."createdByAgent" AND us."designSessionId" IS NULL` |
| Anti-dup funciona | 0 pares de stories `createdByAgent` com título idêntico (case-insensitive) no mesmo projeto | `SELECT "projectId", lower(title), count(*) FROM "UserStory" WHERE "createdByAgent" GROUP BY 1,2 HAVING count(*)>1` (espera vazio) |
| Espelho daemon | tools novas existem nos dois `tools-registry.ts` | `grep -c '<tool>' src/lib/agent/tools-registry.ts` e idem no zordon-daemon (espera ≥1 nos dois) |

---

## §13 — Referências de código (vivo)

- **Tools da Vitoria:** [tools.ts](../../src/lib/agent/agents/vitoria/tools.ts) (`propose_story` linha 573, `get_planning_state` linha 1103) · agente [vitoria/index.ts](../../src/lib/agent/agents/vitoria/index.ts) · connector [planning-chat.ts](../../src/lib/agent/connectors/planning-chat.ts)
- **Registry de tools por surface:** [tools-registry.ts](../../src/lib/agent/tools-registry.ts) (`VITORIA_PLANNING_PROJECT_NAMES` linha 399)
- **DAL de hierarquia:** [story-hierarchy.ts](../../src/lib/dal/story-hierarchy.ts) (`createStory` linha 236, `updateStory` linha 298, `getStoriesForProject` linha 127, AC insert linha 278)
- **Apply do staging (link userStoryId):** [task-action-executor.ts](../../src/lib/meetings/task-action-executor.ts) (linha 300 consome/valida, 341 `validStoryKeys`, 430 anti-dup de task, 467 linka)
- **Espelho daemon:** [zordon-daemon .../vitoria/tools.ts](../../../zordon-daemon/src/lib/agent/agents/vitoria/tools.ts) (`propose_story` stub linha 96) · [.../tools-registry.ts](../../../zordon-daemon/src/lib/agent/tools-registry.ts)
- **Schema:** `src/lib/supabase/database.types.ts` (`UserStory` 8138, `Module` 4561, `AcceptanceCriterion` 42, `MeetingTaskAction` 4065, RPC `next_user_story_reference` 8873)
- **Memories:** [[project_daemon_tool_advertisement]] · [[feedback_anthropic_structured_output_no_array_constraints]] · [[project_vitoria_daemon_surfaces]]
- **Runbooks irmãos:** [vitoria-weekly-planning-runbook.md](vitoria-weekly-planning-runbook.md) · [pm-review-unified-app-runbook.md](pm-review-unified-app-runbook.md)

---

## §14 — Frontier / o que falta

- **Eval cases (Fase 2):** `decompose_story` deve estimar PFV por AC, ou deixar a Vitoria estimar? **Sugestão:** deixar a Vitoria estimar (mantém o schema da Task como SSOT da estimativa). Vira case no driver de calibração quando o comportamento for observável em prod.
- **Visualização agrupada (Fase 2):** agrupar o staging por story na UI exige tocar `ReleasePlanningProposals` — escopo de UX a dimensionar **quando a capacidade estiver provada em uso**.
- **Split de story grande (Fase 3):** vale a Vitoria propor split automático? Depende de evidência de que stories grandes acontecem no planning (vs só na DS). Não construir sem o sinal.
- **Move de task solta pra story (Fase 3):** `propose_task_action(update, userStoryId)` em lote — só faz sentido depois que a árvore for visível e usada.

---

## §15 — HANDOFF: o que NÃO tocar

Para quem implementar a Fase 1:

1. **NÃO** crie tabela nova de story nem "staging de story". Story é criada direto (D2); só tasks passam por `MeetingTaskAction`.
2. **NÃO** crie `Module` real a partir da Vitoria — ela só usa `proposedModuleName` (texto livre). Module materializa na cascata da DS (D10, CHECK `^[A-Z][A-Z0-9_]*$`).
3. **NÃO** mude o contrato de `propose_task_action`/`propose_tasks` — já aceitam `userStoryId`.
4. **NÃO** deixe `update_story` setar `refinementStatus='committed'` — território da cascata da DS (D5).
5. **NÃO** use `.min()/.max()` em `z.array()` — quebra Anthropic (D11). Clamp no `execute`.
6. **SEMPRE** espelhe a tool nos DOIS repos (monorepo com `execute`, daemon schema-only sem `execute`) + **reinicie o daemon** (D7). Tool num repo só = daemon anuncia schema stale.
7. **NÃO** toque PM Review nem o story tree do Vitor na DS — escopo é só a surface `planning`.
8. **VERIFIQUE** depois: `getToolNamesForAgent('vitoria','planning')` lista as 4 tools novas; grep das tools acha ≥1 nos dois `tools-registry.ts`; `pnpm tsc --noEmit` limpo nos dois repos.
