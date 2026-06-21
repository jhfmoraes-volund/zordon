# PRD — Vitoria Story Vision (planning)

**Status:** backlog (Rito 1 / Intake não rodou)
**Owner:** João Moraes
**Data:** 2026-06-21
**Audiência:** PM (usuário da planning) + builders (consomem tasks penduradas) + Vitoria (agente)
**Codename:** `vitoria-story-vision`
**PRDs irmãos:** `prd-vitoria-agentic-planning` (sprint/bulk/Granola — NÃO sobrepor) · referência viva `docs/prd/in-progress/prd-project-wiki.md`

---

## 1. Problema

Na calibração da Vitoria no planning (2026-06-21) ficou claro: ela cria **tasks** muito bem (via `propose_task_action` / `propose_tasks` → staging em `MeetingTaskAction`, PM aprova no Concluir), mas **não tem visão de stories**. Três problemas concretos:

1. **`propose_story` é raso e cego.** A tool ([src/lib/agent/agents/vitoria/tools.ts:573](../../../src/lib/agent/agents/vitoria/tools.ts)) só recebe `title/want/soThat/proposedModuleName`, cria a `UserStory` **na hora** (não em staging) com `refinementStatus='draft'` e **sem AC nenhum**. A Vitoria não consegue: ver as stories que já existem no projeto, decompor uma story em tasks de forma guiada, gerir o status da story, nem anexar critérios de aceite. Story vira casca vazia.
2. **A planning não mostra a árvore de stories.** O staging (`ReleasePlanningProposals`) lista propostas de task **planas** — sem agrupar por story/módulo. `get_planning_state` ([tools.ts:1103](../../../src/lib/agent/agents/vitoria/tools.ts)) devolve `pendingProposals` + `activeNotes` + `sprintMemory`, mas **zero stories**. Ou seja: a Vitoria cria uma story, pendura tasks via `userStoryId`, e nem ela nem o PM enxergam a hierarquia resultante no fluxo. O PM não confia no que não vê.
3. **Decompor story→task é um caminho não-trilhado.** O encanamento existe: `propose_task_action(create)` aceita `payload.userStoryId` e o executor ([src/lib/meetings/task-action-executor.ts:467](../../../src/lib/meetings/task-action-executor.ts)) já valida o link contra o projeto (fail-soft → null). Mas a Vitoria não tem ferramenta pra **ler a story e suas tasks** antes de decompor, nem pra saber quais AC a story precisa cobrir. Decompõe no escuro.

O domínio já tem hierarquia rica (`Module → UserStory → AcceptanceCriterion`, `UserStory ↔ Task` via `userStoryId`) e DAL madura ([src/lib/dal/story-hierarchy.ts](../../../src/lib/dal/story-hierarchy.ts)). Falta **dar à Vitoria, na planning, as ferramentas de leitura + as de escrita de story/AC + o estado visível** — reusando o que existe, sem schema paralelo.

## 2. Solução em uma frase

Dar à Vitoria, na surface de planning, uma capacidade real de stories — ler a árvore `Module→Story→Task` existente, propor/editar story com AC, e decompor story em tasks guiada — reusando as entidades `Module`/`UserStory`/`AcceptanceCriterion` e o staging de `MeetingTaskAction` (PM aprova), sem migration nova e sem substituir o story-tree do Vitor em Design Session.

## 3. Não-objetivos

- **Não** cobre sprint awareness, bulk de tasks, comentário, ingestão de Granola/transcript — isso é do PRD irmão `prd-vitoria-agentic-planning`.
- **Não** substitui o story tree do Vitor em Design Session (Vitor monta a árvore na DS Inception; aqui é planning/execução, projeto vivo).
- **Não** cria entidade/tabela nova de story. Reusa `Module`/`UserStory`/`AcceptanceCriterion`.
- **Não** introduz "staging de story" como nova tabela. A story é criada/editada direto (igual `propose_story` hoje); só as **tasks** passam por `MeetingTaskAction`. (Ver D2 — decisão deliberada, não dívida.)
- **Não** muda o contrato de `propose_task_action`/`propose_tasks` (já aceitam `userStoryId`).
- **Não** toca PM Review nem Release Planning surface — escopo é a surface `planning` (e `release_planning` herda por já incluir `VITORIA_PLANNING_PROJECT_NAMES`, mas não é foco).
- **Não** implementa aprovação humana por-card da story (story aparece viva; o PM corrige via chat, como hoje).
- **Não** mexe em RLS — todas as escritas passam por DAL `server-only` / service-role do daemon, igual ao restante das tools da Vitoria.

## 4. Personas e jornada

### PM na planning
> "Pedi pra Vitoria organizar o backlog da sprint. Ela leu as stories que já existem (`list_project_stories`), viu que 'Conciliação de cobrança' tem 4 AC mas só 1 task, e propôs 3 tasks novas penduradas nessa story. Eu vejo a árvore Módulo→Story→Tasks no estado da planning antes de concluir — não preciso adivinhar onde cada task cai."

### Vitoria (agente)
> "Antes eu criava story cega e pendurava task no escuro. Agora leio `get_story_detail` (want/soThat/AC/tasks atuais), proponho story com AC de uma vez (`propose_story` com `acceptanceCriteria[]`), e quando decomponho chamo `decompose_story` que me devolve as AC da story pra eu derivar uma task por AC. Se a story já existe, eu reuso o id — não duplico."

### Builder (consome o resultado)
> "A task que peguei tem `userStoryId` apontando pra uma story com want/soThat/AC reais. Sei o porquê do trabalho sem pingar o PM."

## 5. Decisões fixadas

| # | Decisão | Escolha | Por quê |
|---|---|---|---|
| D1 | Entidades | **Reusar `Module` / `UserStory` / `AcceptanceCriterion`** (sem tabela nova) | Hierarquia madura já existe ([story-hierarchy.ts](../../../src/lib/dal/story-hierarchy.ts)); paralelo seria dívida. Schema confirmado: `UserStory(projectId, moduleId, proposedModuleName, reference, title, want, soThat, personaId, refinementStatus, createdByAgent, dismissedAt)`. |
| D2 | Onde a story entra | **Story criada/editada DIRETO (não em staging); só TASKS passam por `MeetingTaskAction`** | É o modelo atual do `propose_story` — story é o container leve que agrupa os ghosts das tasks staged. Pôr story em staging exigiria tabela nova (não-objetivo §3). A story nasce `refinementStatus='draft'` + `createdByAgent=true` (igual hoje), visível como container; as tasks continuam propostas até o PM Concluir. |
| D3 | Decompor story→task | **`propose_task_action(create)` com `payload.userStoryId`** apontando pra story que JÁ EXISTE | Encanamento já existe e é validado no executor (fail-soft → null, [task-action-executor.ts:467](../../../src/lib/meetings/task-action-executor.ts)). **Ordem obrigatória:** story criada via `propose_story` ANTES de pendurar tasks (a tool `decompose_story` reforça isso devolvendo o `storyId` + AC pra derivar). |
| D4 | AC da story | **`propose_story` ganha `acceptanceCriteria: string[]` opcional**; AC gravado via `createAc({userStoryId})` no mesmo insert | DAL `createStory` já aceita `acceptanceCriteria[]` e grava em `AcceptanceCriterion` ([story-hierarchy.ts:278](../../../src/lib/dal/story-hierarchy.ts)). A tool atual ignora isso — é o gap mais barato de fechar. `AcceptanceCriterion.userStoryId` é coluna real (FK confirmada). |
| D5 | Status da story | **`update_story` edita `title/want/soThat/proposedModuleName/refinementStatus`** via DAL `updateStory` | `refinementStatus` é `'draft'|'refined'|'committed'` (CHECK no DB). A Vitoria promove `draft→refined` quando a story está madura; `committed` fica pra cascata da DS (não a Vitoria). Edição reusa `updateStory` que já existe. |
| D6 | Leitura | **3 reads novos: `list_project_stories`, `get_story_detail`, e `get_planning_state` passa a incluir `stories`** | A Vitoria precisa VER antes de propor (anti-duplicação de story, reuso de id). Reusa `getStoriesForProject` / `getStoryByReference` da DAL. `get_planning_state` ganha um bloco `stories` (árvore Módulo→Story→#tasks) — fecha o problema #2. |
| D7 | Espelho daemon | **Toda tool nova/alterada espelha nos DOIS repos** (monorepo `tools.ts` com `execute` + daemon `tools.ts` schema-only + `tools-registry.ts` nos dois) | Memory `project_daemon_tool_advertisement`: daemon anuncia schema da própria cópia, execução é proxied pro monorepo. Confirmado: `propose_story` no daemon é stub sem `execute` ([zordon-daemon .../vitoria/tools.ts:96](../../../../zordon-daemon/src/lib/agent/agents/vitoria/tools.ts)). |
| D8 | Surface | **Escopo = surface `planning`**; as tools entram em `VITORIA_PLANNING_PROJECT_NAMES` (projectId-only) | Reads e escrita de story são project-scoped, não precisam de `planningId` (igual `propose_story` hoje). Entram no array que já alimenta `VITORIA_PLANNING_TOOLS` e `VITORIA_RELEASE_PLANNING_TOOLS`. |
| D9 | Anti-duplicação de story | **`propose_story` checa título existente no projeto (case-insensitive, não-dismissed) e devolve o id existente em vez de criar 2ª** | Espelha o anti-dup de task do executor ([task-action-executor.ts:430](../../../src/lib/meetings/task-action-executor.ts)). Evita árvore poluída com stories irmãs idênticas em re-plano. |
| D10 | Módulo | **`proposedModuleName` é texto livre na proposta; promoção a `Module` real só na cascata da DS** (`approveProposedModule`) | A Vitoria não cria `Module` (CHECK `^[A-Z][A-Z0-9_]*$` + `normalizeModuleName` é território da promoção). Ela agrupa por `proposedModuleName`; o Module real materializa quando/se a DS for concluída. Mantém o modelo atual. |
| D11 | Validação de input | **Schema Zod fino + clamp server-side**; sem `.min()/.max()` em `z.array()` | Memory `feedback_anthropic_structured_output_no_array_constraints`: API recusa minItems/maxItems com Anthropic. AC: array sem constraint de tamanho, clamp/validação no `execute`. |
| D12 | Eval | **Cada tool nova ganha ≥1 caso no driver de calibração da Vitoria** quando o comportamento for observável | Loop de calibração (AGENTS.md): bug recorrente vira eval case. Aqui pré-empta: o cenário "decompôs story sem ler AC" vira case. (Story EVAL é opcional/Fase-2-friendly — marcada como tal.) |

## 6. Arquitetura

### 6.1 Diagrama

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

### 6.2 Componentes (cada caixa = função/tool real)

| Componente | Tipo | Reusa |
|---|---|---|
| `list_project_stories` | tool (read) | `getStoriesForProject(projectId)` ou query enxuta `UserStory + AcceptanceCriterion(count) + Module(name)` |
| `get_story_detail` | tool (read) | `getStoryByReference` (aceita ref OU id) — devolve want/soThat/AC/tasks penduradas |
| `propose_story` (alterada) | tool (write) | `nextUserStoryReference` + insert `UserStory` + `createAc` por AC; anti-dup por título |
| `update_story` | tool (write) | `updateStory` / `setStoryRefinement` |
| `decompose_story` | tool (read+guidance) | lê AC da story, devolve `{ storyId, want, soThat, acceptanceCriteria[], existingTasks[] }` + hint "chame propose_task_action(create) com payload.userStoryId pra cada AC sem task" |
| `get_planning_state` (alterada) | tool (read) | adiciona `stories: [{ id, reference, title, moduleName, taskCount, acCount, refinementStatus }]` |

### 6.3 Fluxo de decomposição (ordem fixada — D3)

1. Vitoria chama `list_project_stories` → vê o que existe.
2. Se a story-alvo não existe: `propose_story({title, want, soThat, proposedModuleName, acceptanceCriteria})` → recebe `storyId`.
3. `decompose_story(storyId)` → recebe AC + tasks já penduradas.
4. Para cada AC sem task: `propose_task_action({type:'create', payload:{..., userStoryId: storyId}})` → staging.
5. PM Conclui a planning → `applyPendingActionsForPlanning` aplica as tasks, executor linka `userStoryId` (validado).

## 7. Schema

**Reusa — sem migration nova.** Todas as tabelas envolvidas já existem (verificado em `src/lib/supabase/database.types.ts`):

- `UserStory` — `id, projectId, moduleId, proposedModuleName, reference, title, want, soThat, personaId, refinementStatus, createdById, createdByAgent, designSessionId, dismissedAt, acValidatedAt, createdAt, updatedAt`. (linha 8138)
- `Module` — `id, projectId, name (CHECK ^[A-Z][A-Z0-9_]*$), description, approvedAt, approvedBy`. (linha 4561)
- `AcceptanceCriterion` — `id, userStoryId, taskId, text, order, checkedAt, checkedBy`. FK `AcceptanceCriterion_userStoryId_fkey`. (linha 42)
- `MeetingTaskAction` — `payload.userStoryId` consumido no apply ([task-action-executor.ts:300, 467](../../../src/lib/meetings/task-action-executor.ts)). (linha 4065)
- RPC `next_user_story_reference(p_project_id)` — existe (database.types.ts:8873).

**RLS:** sem mudança. Reads/writes da Vitoria rodam via DAL `server-only` (monorepo) com a credencial já em uso pelas tools existentes (service-role no daemon). Nenhuma policy nova.

**Único ALTER possível (opcional, NÃO bloqueante):** se quisermos distinguir story criada pela Vitoria na planning vs Vitor na DS além de `createdByAgent`, poderia haver `UserStory.createdByAgentSlug text`. **Decisão: NÃO fazer na Fase 1** — `createdByAgent=true` + `designSessionId IS NULL` já distingue (story de planning não tem `designSessionId`). Listado só pra registrar que foi considerado e descartado.

## 8. APIs

Esta feature é **100% tools de agente** (MCP) — não adiciona endpoint REST novo. As tools executam síncronas (< 1s, são CRUD de story/AC + queries) então **não** precisam do contrato async 202+jobId (esse contrato vale pra LLM/job > 1s; aqui o LLM já é o caller, a tool é a folha).

| Tool | Tipo | Args (modelo) | Contrato de retorno |
|---|---|---|---|
| `list_project_stories` | read | `{ moduleName?, refinementStatus?, includeDismissed? }` | `{ ok, stories: [{ id, reference, title, moduleName, want, taskCount, acCount, refinementStatus }] }` |
| `get_story_detail` | read | `{ refOrId }` | `{ ok, story: { id, reference, title, want, soThat, moduleName, refinementStatus, acceptanceCriteria: [{id,text}], tasks: [{id,reference,title,status}] } }` |
| `propose_story` (alterada) | write | `{ title, want, soThat?, proposedModuleName?, acceptanceCriteria? }` | `{ ok, storyId, reference, title, acCreated, deduped? }` |
| `update_story` | write | `{ storyId, title?, want?, soThat?, proposedModuleName?, refinementStatus? }` | `{ ok, storyId, fieldsUpdated[] }` |
| `decompose_story` | read+guidance | `{ refOrId }` | `{ ok, storyId, want, soThat, acceptanceCriteria[], existingTasks[], hint }` |
| `get_planning_state` (alterada) | read | `{}` | `{ ..., stories: [...] }` (campo novo, retrocompatível) |

Todas resolvem `projectId` (e `planningId` quando relevante) do **closure** `buildVitoriaTools` — nunca arg do modelo (espelha o resto das tools).

## 9. UX

A surface de planning hoje mostra propostas de task planas (`ReleasePlanningProposals`). A mudança de UX é **mínima e opcional na Fase 1** (o foco é a capacidade do agente). O ganho de UX vem de `get_planning_state.stories` ficar disponível pro chat narrar a árvore:

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

## 10. Integrações

- **Design Session (Vitor):** Vitor cria a árvore na DS Inception; quando a DS conclui, stories viram `committed` e Module materializa ([completeSession](../../../src/lib/dal/story-hierarchy.ts)). A Vitoria na planning opera sobre o projeto vivo — pode reusar stories já `committed` (pendura mais tasks) ou criar stories novas de planning (`designSessionId IS NULL`). **Sem colisão:** Vitor escreve story na DS, Vitoria escreve story na planning; mesma tabela, escopos distintos por `designSessionId`.
- **Tasks (staging):** `decompose_story` → `propose_task_action(userStoryId)` → `applyPendingActionsForPlanning` → executor linka. Encanamento existente.
- **PM Review / Release Planning:** intocados. `release_planning` herda as tools novas por incluir `VITORIA_PLANNING_PROJECT_NAMES`, sem esforço extra.
- **Daemon:** espelho obrigatório (D7).

## 11. Faseamento

### Fase 1 — Capacidade de story na planning (este PRD)
Entrega **mais** que o sistema atual: hoje a Vitoria só tem `propose_story` raso. Fase 1 dá leitura (3 reads), escrita rica (story+AC, update, status), decomposição guiada, e estado visível (`get_planning_state.stories`). Tudo espelhado no daemon.

- `list_project_stories` + `get_story_detail` (reads)
- `propose_story` ganha `acceptanceCriteria[]` + anti-dup (D4, D9)
- `update_story` (D5)
- `decompose_story` (D3)
- `get_planning_state` ganha bloco `stories` (D6)
- Espelho daemon de todas (D7)
- Registro nos dois `tools-registry.ts` (D8)

### Fase 2 — Visualização agrupada + eval
- `ReleasePlanningProposals` agrupa cards por story/módulo (UX §9 wireframe)
- Casos de eval no driver da Vitoria (D12)
- `decompose_story` opcionalmente sugere PFV por AC (heurística)

### Fase 3 (opcional)
- Vitoria propõe **mover** tasks soltas pra dentro de uma story (`propose_task_action(update, userStoryId)`) em lote
- Sugestão de split de story grande (> N AC) em duas

## 12. Riscos

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| Vitoria duplica story em re-plano | Média | Médio | Anti-dup por título no `propose_story` (D9); `list_project_stories` antes de criar (prompt) |
| Decompõe story antes de criá-la (ordem invertida) | Média | Médio | `decompose_story` exige `storyId` existente e devolve erro claro se não achar; `propose_task_action` com `userStoryId` inválido já fail-soft → null no executor (não quebra) |
| `userStoryId` órfão (story dismissed entre propor e aplicar) | Baixa | Baixo | Executor valida `validStoryKeys` no apply ([task-action-executor.ts:341](../../../src/lib/meetings/task-action-executor.ts)); link vira null + warn, task ainda é criada |
| Schema Zod com array min/max quebra Anthropic | Média | Alto | D11 — sem `.min()/.max()` em `z.array()`; clamp server-side |
| Daemon e monorepo divergem (tool num só) | Média | Alto | D7 — checklist de espelho; story de verificação roda grep nos dois repos |
| Vitoria seta `refinementStatus='committed'` indevidamente | Baixa | Médio | `update_story` aceita só `draft`/`refined` do agente; `committed` é território da cascata da DS (validação no execute) |
| Story de planning polui a lista do projeto antes de aprovada | Baixa | Baixo | Story nasce `draft` + `createdByAgent`; lista do projeto/DS filtra por status; PM corrige via chat (modelo atual, D2) |

## 13. Métricas de sucesso

| Métrica | Meta | Instrumento |
|---|---|---|
| Tasks penduradas em story | ≥ 60% das tasks criadas pela Vitoria na planning têm `userStoryId` (30d) | SQL: `SELECT count(*) FILTER (WHERE "userStoryId" IS NOT NULL)::float / count(*) FROM "Task" WHERE "createdByAgent" AND "designSessionId" IS NULL AND "createdAt" > now()-interval '30d'` |
| Stories da Vitoria com ≥1 AC | ≥ 70% das stories criadas via `propose_story` na planning têm AC | SQL: `SELECT count(DISTINCT us.id) FILTER (WHERE ac.id IS NOT NULL)::float / count(DISTINCT us.id) FROM "UserStory" us LEFT JOIN "AcceptanceCriterion" ac ON ac."userStoryId"=us.id WHERE us."createdByAgent" AND us."designSessionId" IS NULL AND us."createdAt" > now()-interval '30d'` |
| Stories órfãs (0 tasks) | < 20% das stories de planning ficam sem task após conclude | SQL: `SELECT count(*) FILTER (WHERE t.id IS NULL)::float / count(*) FROM "UserStory" us LEFT JOIN "Task" t ON t."userStoryId"=us.id WHERE us."createdByAgent" AND us."designSessionId" IS NULL` |
| Anti-dup funciona | 0 pares de stories `createdByAgent` com título idêntico (case-insensitive) no mesmo projeto | SQL: `SELECT "projectId", lower(title), count(*) FROM "UserStory" WHERE "createdByAgent" GROUP BY 1,2 HAVING count(*)>1` (espera vazio) |
| Espelho daemon | tools novas existem nos dois `tools-registry.ts` | `grep -c '<tool>' src/lib/agent/tools-registry.ts` e idem no zordon-daemon (espera ≥1 nos dois) |

## 14. Open questions

Nenhuma bloqueante pra Fase 1. Não-bloqueantes (resolver na fase indicada):

1. **(Fase 2)** `decompose_story` deve estimar PFV por AC, ou deixar a Vitoria estimar? Sugestão: deixar a Vitoria estimar (mantém schema da task como SSOT da estimativa).
2. **(Fase 2)** Agrupar o staging por story na UI exige tocar `ReleasePlanningProposals` — escopo de UX a dimensionar quando a capacidade estiver provada em uso.
3. **(Fase 3)** Vale a Vitoria propor split de story grande automaticamente? Depende de evidência de que stories grandes acontecem no planning (vs só na DS).

## 15. Referências

- Tools atuais da Vitoria: [src/lib/agent/agents/vitoria/tools.ts](../../../src/lib/agent/agents/vitoria/tools.ts) (`propose_story` linha 573, `get_planning_state` linha 1103)
- Registry de tools por surface: [src/lib/agent/tools-registry.ts](../../../src/lib/agent/tools-registry.ts) (`VITORIA_PLANNING_PROJECT_NAMES` linha 399)
- DAL de hierarquia: [src/lib/dal/story-hierarchy.ts](../../../src/lib/dal/story-hierarchy.ts) (`createStory` linha 236, `updateStory` linha 298, `getStoriesForProject` linha 127)
- Apply do staging (link userStoryId): [src/lib/meetings/task-action-executor.ts](../../../src/lib/meetings/task-action-executor.ts) (linha 300 valida, 467 linka)
- Espelho daemon: [zordon-daemon .../vitoria/tools.ts](../../../../zordon-daemon/src/lib/agent/agents/vitoria/tools.ts) · [.../tools-registry.ts](../../../../zordon-daemon/src/lib/agent/tools-registry.ts)
- Schema: `src/lib/supabase/database.types.ts` (`UserStory` 8138, `Module` 4561, `AcceptanceCriterion` 42, `MeetingTaskAction` 4065)
- Memories: `project_daemon_tool_advertisement`, `feedback_anthropic_structured_output_no_array_constraints`, `project_vitoria_daemon_surfaces`
- PRD de referência (formato): [docs/prd/in-progress/prd-project-wiki.md](./prd-project-wiki.md)

---

## 16. Stories implementáveis (Fase 1)

Stories ≤ 30min, sequenciáveis via `dependsOn`. Total: 8 stories. Toda story que cria/altera tool repete o espelho daemon como AC e tem `verifiable` automatizável.

### STORY-001 — read: list_project_stories (monorepo)
**Description:** Adiciona a tool `list_project_stories` em `buildVitoriaTools` ([tools.ts](../../../src/lib/agent/agents/vitoria/tools.ts)). Lê stories do projeto (não-dismissed por default) com `moduleName`, `taskCount`, `acCount`, `refinementStatus`. Reusa query enxuta sobre `UserStory + Module(name) + AcceptanceCriterion(count) + Task(count)` (não traz description/AC text — isso é `get_story_detail`).
**acceptanceCriteria:**
- "`buildVitoriaTools` exporta a tool `list_project_stories` com `inputSchema` `{ moduleName?, refinementStatus?, includeDismissed? }`."
- "Retorna `{ ok: true, stories: [{ id, reference, title, moduleName, want, taskCount, acCount, refinementStatus }] }`."
- "Query filtra `projectId` do closure e `dismissedAt IS NULL` salvo `includeDismissed=true`."
- "Sem `.min()/.max()` em nenhum `z.array()` do schema (D11)."
**verifiable:**
- kind: typecheck
  command_or_query: "pnpm tsc --noEmit"
  expected: "exit 0, sem erros novos"
- kind: lint
  command_or_query: "grep -c 'list_project_stories' src/lib/agent/agents/vitoria/tools.ts"
  expected: "≥1"
**dependsOn:** []
**estimateMinutes:** 25
**touches:** ["src/lib/agent/agents/vitoria/tools.ts"]

### STORY-002 — read: get_story_detail (monorepo)
**Description:** Adiciona `get_story_detail` que aceita `refOrId` (reference VLD-NNN OU uuid) e devolve a story completa: want/soThat/moduleName/refinementStatus + `acceptanceCriteria[{id,text}]` + `tasks[{id,reference,title,status}]`. Reusa `getStoryByReference` (ref) ou query por id; valida que a story é do `projectId` do closure.
**acceptanceCriteria:**
- "Tool `get_story_detail` com `inputSchema` `{ refOrId: string }`."
- "Resolve por reference se casar `^[A-Z]+-\\d+$`, senão por id (uuid)."
- "Retorna AC ordenados por `order` e tasks penduradas (`Task.userStoryId = story.id`, `dismissedAt IS NULL`)."
- "Devolve `{ ok:false, error }` se a story for de outro projeto ou não existir."
**verifiable:**
- kind: typecheck
  command_or_query: "pnpm tsc --noEmit"
  expected: "exit 0"
- kind: lint
  command_or_query: "grep -c 'get_story_detail' src/lib/agent/agents/vitoria/tools.ts"
  expected: "≥1"
**dependsOn:** []
**estimateMinutes:** 25
**touches:** ["src/lib/agent/agents/vitoria/tools.ts"]

### STORY-003 — write: propose_story ganha acceptanceCriteria + anti-dup (monorepo)
**Description:** Estende `propose_story` ([tools.ts:573](../../../src/lib/agent/agents/vitoria/tools.ts)): adiciona `acceptanceCriteria: z.array(z.string()).optional()` (sem min/max — D11) e, no `execute`, (a) checa título duplicado no projeto (case-insensitive, `dismissedAt IS NULL`) devolvendo o `storyId` existente + `deduped:true` em vez de criar 2ª (D9); (b) após o insert da story, grava cada AC não-vazio via `AcceptanceCriterion.insert({ userStoryId, text, order })`. Retorna `{ ok, storyId, reference, title, acCreated, deduped? }`.
**acceptanceCriteria:**
- "`propose_story` aceita `acceptanceCriteria?: string[]`; AC com ≥3 chars são gravados em `AcceptanceCriterion` com `userStoryId` e `order` sequencial."
- "Título já existente (case-insensitive, não-dismissed) no projeto retorna o id existente com `deduped:true`, sem inserir nova UserStory."
- "Retorno inclui `acCreated` (int) e `deduped?` (bool)."
- "Nenhum `.min()/.max()` em `z.array()` (D11)."
**verifiable:**
- kind: typecheck
  command_or_query: "pnpm tsc --noEmit"
  expected: "exit 0"
- kind: sql
  command_or_query: "SELECT count(*) FROM \"UserStory\" us JOIN \"AcceptanceCriterion\" ac ON ac.\"userStoryId\"=us.id LIMIT 1"
  expected: "query roda (FK userStoryId existe) — confirma que o caminho de gravação é válido"
**dependsOn:** ["STORY-001"]
**estimateMinutes:** 30
**touches:** ["src/lib/agent/agents/vitoria/tools.ts"]

### STORY-004 — write: update_story (monorepo)
**Description:** Adiciona `update_story` que edita uma story existente: `{ storyId, title?, want?, soThat?, proposedModuleName?, refinementStatus? }`. Reusa `updateStory` da DAL. `refinementStatus` aceita só `'draft'|'refined'` do agente (rejeita `'committed'` com erro claro — D5). Valida que a story é do `projectId` do closure antes de mutar.
**acceptanceCriteria:**
- "Tool `update_story` com os campos opcionais acima; pelo menos 1 campo obrigatório (erro se patch vazio)."
- "`refinementStatus='committed'` retorna `{ ok:false, error }` (território da cascata da DS)."
- "Story de outro projeto retorna erro, não muta."
- "Retorna `{ ok, storyId, fieldsUpdated: string[] }`."
**verifiable:**
- kind: typecheck
  command_or_query: "pnpm tsc --noEmit"
  expected: "exit 0"
- kind: lint
  command_or_query: "grep -c 'update_story' src/lib/agent/agents/vitoria/tools.ts"
  expected: "≥1"
**dependsOn:** ["STORY-002"]
**estimateMinutes:** 25
**touches:** ["src/lib/agent/agents/vitoria/tools.ts"]

### STORY-005 — read+guidance: decompose_story (monorepo)
**Description:** Adiciona `decompose_story({ refOrId })` que lê a story (reusa lógica de `get_story_detail`), devolve `{ ok, storyId, want, soThat, acceptanceCriteria[], existingTasks[], hint }` onde `hint` instrui o modelo a chamar `propose_task_action(create)` com `payload.userStoryId = storyId` pra cada AC ainda sem task. NÃO escreve task (apenas leitura + orientação — a escrita é responsabilidade do `propose_task_action`, mantendo o staging como único caminho de task).
**acceptanceCriteria:**
- "Tool `decompose_story` com `inputSchema` `{ refOrId: string }`."
- "Retorna AC da story + tasks já penduradas + `hint` textual citando `propose_task_action` e `userStoryId`."
- "Erro claro se a story não existir/for de outro projeto (reforça ordem D3: story antes de decompor)."
- "Não faz nenhum INSERT/UPDATE em Task nem MeetingTaskAction."
**verifiable:**
- kind: typecheck
  command_or_query: "pnpm tsc --noEmit"
  expected: "exit 0"
- kind: lint
  command_or_query: "grep -c 'decompose_story' src/lib/agent/agents/vitoria/tools.ts"
  expected: "≥1"
**dependsOn:** ["STORY-002"]
**estimateMinutes:** 25
**touches:** ["src/lib/agent/agents/vitoria/tools.ts"]

### STORY-006 — read: get_planning_state ganha bloco stories (monorepo)
**Description:** Estende `get_planning_state` ([tools.ts:1103](../../../src/lib/agent/agents/vitoria/tools.ts)) adicionando `stories: [{ id, reference, title, moduleName, taskCount, acCount, refinementStatus }]` ao retorno (campo novo, retrocompatível — não remove nada). Query project-scoped sobre `UserStory` (não-dismissed) + contagens. Resolve o problema #2 (estado da árvore visível no fluxo).
**acceptanceCriteria:**
- "`get_planning_state` retorna o objeto existente + chave `stories` (array)."
- "Campos: `id, reference, title, moduleName, taskCount, acCount, refinementStatus`."
- "Stories `dismissedAt IS NULL`, project-scoped pelo closure."
- "Nenhum campo pré-existente do retorno foi removido/renomeado (retrocompatível)."
**verifiable:**
- kind: typecheck
  command_or_query: "pnpm tsc --noEmit"
  expected: "exit 0"
- kind: lint
  command_or_query: "grep -n 'stories' src/lib/agent/agents/vitoria/tools.ts | grep -c get_planning_state || grep -c 'stories:' src/lib/agent/agents/vitoria/tools.ts"
  expected: "≥1 (bloco stories presente)"
**dependsOn:** ["STORY-001"]
**estimateMinutes:** 25
**touches:** ["src/lib/agent/agents/vitoria/tools.ts"]

### STORY-007 — espelho daemon: schemas das tools novas (zordon-daemon)
**Description:** Espelha no daemon ([zordon-daemon .../vitoria/tools.ts](../../../../zordon-daemon/src/lib/agent/agents/vitoria/tools.ts)) os **schemas** (advertise only, sem `execute` — o daemon proxia a execução pro monorepo, D7) das tools `list_project_stories`, `get_story_detail`, `update_story`, `decompose_story`, e atualiza o schema/descrição de `propose_story` pra incluir `acceptanceCriteria`. `get_planning_state` não muda de schema (mesmo input `{}`).
**acceptanceCriteria:**
- "Daemon `tools.ts` tem entradas (schema-only) pra `list_project_stories`, `get_story_detail`, `update_story`, `decompose_story`."
- "Daemon `propose_story` inclui `acceptanceCriteria` no `inputSchema`."
- "Nenhuma das entradas novas no daemon tem `execute` (mantém o padrão de advertisement)."
- "`pnpm tsc --noEmit` (ou tsc do daemon) passa no repo do daemon."
**verifiable:**
- kind: lint
  command_or_query: "for t in list_project_stories get_story_detail update_story decompose_story; do grep -c \"$t\" /Users/joaomoraes/projetos-ai-dev/Perke/perke/zordon-daemon/src/lib/agent/agents/vitoria/tools.ts; done"
  expected: "cada um ≥1"
- kind: typecheck
  command_or_query: "cd /Users/joaomoraes/projetos-ai-dev/Perke/perke/zordon-daemon && pnpm tsc --noEmit"
  expected: "exit 0"
**dependsOn:** ["STORY-003", "STORY-004", "STORY-005"]
**estimateMinutes:** 30
**touches:** ["../zordon-daemon/src/lib/agent/agents/vitoria/tools.ts"]

### STORY-008 — registry: tools novas em VITORIA_PLANNING_PROJECT_NAMES nos dois repos
**Description:** Registra as 4 tools novas de leitura/escrita de story em `VITORIA_PLANNING_PROJECT_NAMES` (projectId-only, planningId opcional — D8) nos DOIS `tools-registry.ts` (monorepo [tools-registry.ts:399](../../../src/lib/agent/tools-registry.ts) e daemon). `propose_story` e `get_planning_state` já estão registrados (alterações in-place, não precisam re-registrar). Confirma que `VITORIA_PLANNING_TOOLS` e `VITORIA_RELEASE_PLANNING_TOOLS` herdam por spread.
**acceptanceCriteria:**
- "`VITORIA_PLANNING_PROJECT_NAMES` no monorepo inclui `list_project_stories`, `get_story_detail`, `update_story`, `decompose_story`."
- "Mesmo array no daemon `tools-registry.ts` inclui os 4 nomes."
- "As 4 tools aparecem em `getToolNamesForAgent('vitoria','planning')` (herdadas via `VITORIA_PLANNING_TOOLS`)."
- "tsc passa nos dois repos."
**verifiable:**
- kind: lint
  command_or_query: "for t in list_project_stories get_story_detail update_story decompose_story; do grep -c \"$t\" src/lib/agent/tools-registry.ts /Users/joaomoraes/projetos-ai-dev/Perke/perke/zordon-daemon/src/lib/agent/tools-registry.ts; done"
  expected: "cada arquivo ≥1 por tool"
- kind: typecheck
  command_or_query: "pnpm tsc --noEmit"
  expected: "exit 0"
**dependsOn:** ["STORY-007"]
**estimateMinutes:** 20
**touches:** ["src/lib/agent/tools-registry.ts", "../zordon-daemon/src/lib/agent/tools-registry.ts"]

---

**Total Fase 1:** 8 stories, ~205 min (~3h25). Reuso máximo de DAL/schema existentes; zero migration.
