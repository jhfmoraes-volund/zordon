# Vitor — Calibração para Hierarquia (Module → UserStory → Task) + Robustez

> **Status:** v2 (reescrito após auditoria do estado real)
> **Owner:** João Moraes
> **Última atualização:** 2026-05-05
> **Escopo:** alinhar o agente Vitor à hierarquia já modelada no schema (`Module → UserStory → Task` + `AcceptanceCriterion` polimórfico + `ProjectPersona`), expor essa hierarquia via tools, separar AC de produto vs AC técnico, e rodar a geração em três níveis com validação humana entre cada um.
> **Relacionado:** [vitor-calibration-plan.md](vitor-calibration-plan.md), [alpha-story-hierarchy-calibration.md](alpha-story-hierarchy-calibration.md).

---

## 1. Auditoria do estado real (o que já existe vs. o que o plano antigo ignorava)

Antes de qualquer fase: o schema **já modela a hierarquia inteira**. O Vitor é que está atrás. Mapa do que está pronto:

| Camada | Estado | Observação |
|---|---|---|
| Tabela `Module` | ✅ existe ([database.types.ts:1896](../src/lib/supabase/database.types.ts#L1896)) | Campos: `id, projectId, name, description`. **Não tem `slug` nem `reference`** — ver §2.1. |
| Tabela `UserStory` | ✅ existe ([:3210](../src/lib/supabase/database.types.ts#L3210)) | `title, want, soThat, reference (NOT NULL), moduleId, proposedModuleName, personaId, refinementStatus, acValidatedAt/By, designSessionId, createdByAgent`. |
| Tabela `AcceptanceCriterion` | ✅ existe ([:50](../src/lib/supabase/database.types.ts#L50)) | FK polimórfica: `taskId XOR userStoryId` (ambos nullable hoje — falta CHECK). `text, order, checkedAt, checkedBy`. |
| Tabela `ProjectPersona` | ✅ existe + auto-seed | DAL faz seed automático de `Builder/PM/Cliente` por projeto ([story-hierarchy.ts:123](../src/lib/dal/story-hierarchy.ts#L123)). `UserStory.personaId` aponta pra cá. |
| RPC `next_user_story_reference` | ✅ existe ([story-hierarchy.ts:247](../src/lib/dal/story-hierarchy.ts#L247)) | Gera `reference` (US-NNN) atomicamente no DB. |
| Fluxo `proposedModuleName → moduleId` | ✅ existe | XOR validado em [stories/route.ts:32](../src/app/api/projects/[id]/stories/route.ts#L32). Endpoint [approve-module/route.ts](../src/app/api/stories/[ref]/approve-module/route.ts) promove. DAL: `approveProposedModule` ([story-hierarchy.ts:372](../src/lib/dal/story-hierarchy.ts#L372)). |
| `refinementStatus` | ✅ existe | `draft | refined | committed`. É a peça de "estado de progresso" sem precisar de tabela de jobs. |
| DAL completo | ✅ existe | `createModule`, `createStory`, `createAc`, `setStoryRefinement`, `validateStoryAc`, `toggleAcCheck`, `setTaskUserStory`, `getRecentStoriesForProject` — tudo em [story-hierarchy.ts](../src/lib/dal/story-hierarchy.ts). |
| Tool `create_task` do Vitor | ⚠️ desalinhada ([create-task.ts](../src/lib/agent/tools/create-task.ts)) | `module: string` em texto livre, `userStoryId` ausente, AC vai pra markdown da `description`. |
| Tools `create_module` / `create_user_story` | ❌ não existem | Vitor não consegue criar Story nem Module. |
| Engine timeout | ⚠️ ([chat/route.ts:6](../src/app/api/design-sessions/[id]/chat/route.ts#L6)) | `maxDuration = 300s` + `stepCountIs(maxSteps)` em um único stream. Sprint cheia estoura. |

**Conclusão da auditoria:** o trabalho **não é construir hierarquia** — é (a) expor a hierarquia já existente como tools, (b) reordenar o fluxo do Vitor pra preencher `Module → Story → Task` na ordem certa, (c) separar AC de produto (na Story) de AC técnico (na Task), (d) quebrar a geração em três níveis com validação entre cada um.

---

## 2. Decisões a tomar antes de codar

### 2.1. `Module.slug` e `Module.reference` — adicionar ou descartar?

`Module` hoje só tem `name`. O plano original assumia `slug` + `reference (MOD-NNN)` mas isso adiciona migration + manutenção e o fluxo `proposedModuleName` resolve dedup por nome (se duplicar, é a tool de approve que decide reusar — ver §4.2).

**Decisão recomendada:** **não adicionar `slug` nem `reference` agora.** Idempotência por `(projectId, name)` é suficiente — o DAL `approveProposedModule` já faz isso. Reabrir se o time pedir referência curta na UI.

### 2.2. AC: dois níveis (produto na Story + técnico na Task)

Plano antigo dizia "AC só na Story". Isso conflita com QA (que valida Task) e com o brief denso atual ([prompt.ts:508](../src/lib/agent/prompt.ts#L508), AC inclui regression check, lint, typecheck — claramente técnico).

**Decisão:** modelo dual.
- `UserStory.acceptanceCriteria` (via `AcceptanceCriterion.userStoryId`) → AC **de produto**: comportamento observável pelo usuário/PM ("checkbox aparece em cada linha", "após aprovar, lista atualiza").
- `Task.acceptanceCriteria` (via `AcceptanceCriterion.taskId`) → AC **técnico**: condições verificáveis no PR ("TypeScript limpo", "regression check do botão A continua funcionando", "endpoint retorna 422 com array zod").
- Schema já permite (FK XOR). Adicionar CHECK constraint XOR pra travar dado bagunçado.
- Few-shot do prompt deixa a diferença explícita.

### 2.3. Fluxo de validação humana — usar `proposedModuleName` (não inventar UI nova)

Plano antigo previa lista custom de "módulos propostos com botão de aprovar". O schema já tem isso: Vitor cria Story com `proposedModuleName=X`, usuário aprova via endpoint, vira `moduleId`. Sem entidade nova, sem UI nova.

**Decisão:** Vitor **nunca** chama `create_module` direto. Cria Story com `proposedModuleName`. Aprovação é ato humano (UI ou tool `approve_module` chamada após confirmação no chat).

### 2.4. Granularidade de geração — três níveis

Plano antigo: gerar por módulo (1 request por módulo). Bom, mas insuficiente — módulo grande com 6 stories × 5 tasks = 30 entidades em 300s, ainda apertado.

**Decisão:** três níveis, cada um um request curto.
1. **Tree** (1 request total): esqueleto Module-tentativo + título de Stories. Persiste `UserStory(refinementStatus=draft, proposedModuleName, title, want, soThat)` sem AC. Usuário valida.
2. **Story detail** (1 request por Story): adiciona AC de produto, persona, want/soThat refinados. `refinementStatus → refined`.
3. **Task breakdown** (1 request por Story): gera Tasks técnicas com AC técnicos. Story `refinementStatus → committed`.

Validação humana entre cada nível, granularidade fina o bastante pra não estourar timeout, e progresso visível na árvore via `refinementStatus` + `Task.status`.

### 2.5. Engine: `maxSteps` pode subir, mas o ganho real vem da granularidade

`stepCountIs` é o limite de turnos da LLM dentro de um stream. Subir de 30 → 60 ajuda no nível de Story/Task, mas não é o que resolve timeout — é a quebra em requests separados (§2.4) que resolve.

**Decisão:** `maxSteps` permanece em 30 por default; só sobe se medirmos um modo (ex: Tree) que precise mais.

---

## 3. Objetivos & não-objetivos

**Objetivos:**
1. Vitor cria `UserStory` (com `proposedModuleName` ou `moduleId`), `AcceptanceCriterion` linkado a Story (produto) ou Task (técnico), e `Task` (com `userStoryId` obrigatório).
2. Geração roda em três níveis (Tree / Story detail / Task breakdown), cada um um request, com validação humana entre eles.
3. Idempotência: rerodar qualquer nível não duplica entidades.
4. Observabilidade mínima: dá pra saber em qual nó da árvore parou.

**Não-objetivos:**
- Trocar modelo do Vitor.
- Redesenhar UI do chat de design session (mas precisamos de uma view de árvore — ver §5.4).
- Mudar pipeline de transcripts.
- Backfill de tasks legadas (com AC em markdown). Ficam órfãs, são editadas manualmente se necessário.

---

## 4. Plano em 5 fases

### Fase 0 — Schema deltas (1 dia)

**0.1. CHECK constraint XOR em `AcceptanceCriterion`.**
- Migration: `ALTER TABLE "AcceptanceCriterion" ADD CONSTRAINT ac_xor CHECK ((taskId IS NULL) <> (userStoryId IS NULL));`
- Arquivo: `supabase/migrations/20260505_ac_xor_check.sql`.
- Rodar: `psql "$DIRECT_URL" -f supabase/migrations/20260505_ac_xor_check.sql` (regra do projeto).
- Antes de rodar: query `SELECT count(*) FROM "AcceptanceCriterion" WHERE (taskId IS NULL AND userStoryId IS NULL) OR (taskId IS NOT NULL AND userStoryId IS NOT NULL);` — se > 0, limpar antes da constraint.

**0.2. (Opcional) View `design_session_tree`.**
- View materializa Module → Story → Task pra UI consumir. Não bloqueia Fase 1.
- Defer pra Fase 5.

**Critério de aceite:**
- [ ] Constraint aplicada. Insert violando recusa.
- [ ] `database.types.ts` atualizado (re-gerar types após migration).

---

### Fase 1 — Tools que refletem a hierarquia (2 dias)

Não criar DAL novo — tudo já existe em [story-hierarchy.ts](../src/lib/dal/story-hierarchy.ts). Tools são wrappers finos que validam input e chamam o DAL.

**1.1. Tool `create_user_story` — nova.**
- Arquivo: `src/lib/agent/tools/create-user-story.ts`.
- Input schema (zod):
  ```ts
  {
    title: string,                                   // "Aprovar invoice em massa"
    want: string,                                    // "selecionar várias e aprovar de uma vez"
    soThat: string,                                  // "fechar o mês mais rápido"
    moduleId?: string,                               // XOR com proposedModuleName
    proposedModuleName?: string,                     // ex: "Faturamento" — usuário valida depois
    personaId?: string,                              // ProjectPersona — Builder/PM/Cliente ou customizado
    proposedPersonaName?: string,                    // (futuro — se quiser permitir; v1 usa só personaId)
    acceptanceCriteriaProduct?: string[],            // OPCIONAL na fase Tree, OBRIGATÓRIO em Story detail
    refinementStatus?: 'draft' | 'refined' | 'committed', // default 'draft'
  }
  ```
- Validação:
  - XOR `moduleId` vs `proposedModuleName` (mesmo refine que o endpoint REST).
  - Se `acceptanceCriteriaProduct` presente, cada item é frase verificável (apenas regra textual no prompt; tool não valida semântica).
- Comportamento: chama `createStory(...)` do DAL, que já cuida do `reference` via RPC e dos AC linkados.
- Idempotência: antes de inserir, busca `UserStory` no mesmo `(projectId, title)` com `refinementStatus IN ('draft','refined')`. Se existir, **atualiza** (merge AC, atualiza want/soThat) em vez de duplicar. Stories `committed` são tratadas como imutáveis pela tool (LLM precisa pedir ao usuário pra reabrir).
- Retorno: `{ id, reference, refinementStatus, criteriaCount, alreadyExisted }`.

**1.2. Tool `create_task` — atualizar (não substituir).**
- Editar [create-task.ts](../src/lib/agent/tools/create-task.ts):
  - **Adicionar:** `userStoryId: z.string()` — **obrigatório**.
  - **Manter:** `acceptanceCriteria: string[]` — **continua sendo AC técnico da task**. Mas em vez de embutir no markdown, persistir como linhas em `AcceptanceCriterion(taskId=task.id)`.
  - **Remover:** `module: string` (vem de `userStory.moduleId` agora; agente é instruído a não duplicar).
  - **Manter:** `description, notes, complexity, scope, dependsOn, category`. `description` segue o template denso ([prompt.ts:392-540](../src/lib/agent/prompt.ts#L392)) **sem** seção de AC duplicada.
- Idempotência: busca `Task` no mesmo `(designSessionId, userStoryId, title)` com `status='draft'`. Se existir, **atualiza** (mesmo critério da Story).
- Retorno: `{ id, title, functionPoints, acCount, alreadyExisted }`.

**1.3. Tool `approve_module` — nova (assistida).**
- Arquivo: `src/lib/agent/tools/approve-module.ts`.
- Input: `proposedName: string` (escopo: projeto da sessão).
- Comportamento: chama `approveProposedModule` em **todas** as stories do projeto com aquele `proposedModuleName`. Atalho: agente confirma com usuário no chat e só então chama essa tool.
- Retorno: `{ moduleId, moduleName, storiesPromoted }`.
- **Observação:** essa tool é uma conveniência. UI também pode acionar approve direto pelo endpoint REST. Manter as duas em paridade.

**1.4. Tool `list_stories` — nova (read).**
- Lista `UserStory` da sessão atual + projeto, com `refinementStatus` e contagem de AC/tasks. Espelha `list_tasks`.
- Vitor usa pra detectar "modo refinamento" (tree já existe) vs "modo inicial".

**1.5. Tool `set_story_refinement` — nova (write, write tools gating).**
- Input: `storyId, status: 'refined' | 'committed'`.
- Permite ao Vitor sinalizar transição de fase (ex: ao terminar Story detail → `refined`; ao terminar Task breakdown → `committed`).
- Wrapper de `setStoryRefinement` do DAL.

**1.6. Registrar tools em `assembleTools`.**
- Em [tools.ts](../src/lib/agent/tools.ts), bloco de gating por `createTasks + projectId`:
  ```ts
  if (capabilities?.createTasks && capabilities?.projectId) {
    tools.create_user_story = createUserStoryTool(sessionId, capabilities.projectId, capabilities.memberId);
    tools.create_task = createTaskTool(sessionId, capabilities.projectId, capabilities.memberId);
    tools.approve_module = approveModuleTool(capabilities.projectId);
    tools.list_stories = listStoriesTool(sessionId, capabilities.projectId);
    tools.set_story_refinement = setStoryRefinementTool(sessionId, capabilities.projectId);
    // já existentes:
    tools.list_tasks = listSessionTasksTool(sessionId);
    tools.list_project_tasks = listProjectTasksTool(sessionId, capabilities.projectId);
    tools.update_task = updateTaskTool(sessionId);
    tools.delete_task = deleteTaskTool(sessionId);
  }
  ```

**Critério de aceite da Fase 1:**
- [ ] As 5 tools compilam.
- [ ] Testes unitários básicos: idempotência (rerun não duplica), XOR (rejeita `moduleId` + `proposedModuleName` simultâneos).
- [ ] Smoke manual via chat: criar Story com proposedModuleName → criar Task com userStoryId → aprovar módulo → ver `Task.userStoryId.moduleId` populado.
- [ ] AC persiste em `AcceptanceCriterion` (não em markdown).

---

### Fase 2 — Prompt em três modos no step `briefing` (2 dias)

O step `briefing` ganha um `subPhase` em `currentStepData`: `'tree' | 'story_detail' | 'task_breakdown'`. Default `'tree'` ao entrar com `list_stories` vazia. UI seta o `subPhase` ao usuário clicar nos botões da árvore (§5.4).

**2.1. Reescrever `briefingSection` em [prompt.ts:324](../src/lib/agent/prompt.ts#L324).**

A seção vira três blocos selecionados pelo `subPhase`:

#### Modo Tree (esqueleto)
- Vitor lê: `prioritization`, `brainstorm`, `risks_gaps`, `technical_specs`, `personas` da sessão + `getRecentStoriesForProject(50)` no contexto.
- Sequência:
  1. Apresenta **mapa funcional** em markdown (igual hoje, [prompt.ts:349](../src/lib/agent/prompt.ts#L349)).
  2. Pergunta: "Posso começar persistindo essa árvore como rascunho?"
  3. Após confirmação: para cada Story do mapa, chama `create_user_story({ title, want (resumo), soThat (resumo), proposedModuleName, refinementStatus: 'draft' })`. **SEM AC ainda.**
  4. Resume: "Criei N stories em M módulos propostos. Pra cada uma, clique 'Detalhar' na árvore quando quiser refinar."

#### Modo Story Detail (uma story por vez)
- Disparado por `subPhase='story_detail' + currentStepData.targetStoryId`.
- Vitor lê: a Story alvo + Stories irmãs do mesmo módulo + decisions/research relevantes.
- Sequência:
  1. Lê a Story atual (`list_stories`).
  2. Refina `want`, `soThat`, define `personaId` (Builder/PM/Cliente — perguntar se ambíguo).
  3. Gera 4-8 **AC de produto** (verificável objetivamente, sim/não, inclui regression).
  4. Chama `create_user_story` (idempotente — vai atualizar a Story existente) com AC + persona.
  5. Chama `set_story_refinement(status='refined')`.
  6. Pergunta: "Aprovar módulo `<proposedName>`? Gerar tasks agora?"

#### Modo Task Breakdown (uma story por vez)
- Disparado por `subPhase='task_breakdown' + currentStepData.targetStoryId`.
- Pré-condição: Story `refinementStatus >= 'refined'`.
- Sequência:
  1. Lê Story + AC de produto.
  2. Para cada AC de produto: lista quais tasks técnicas precisam acontecer. Agrupa por arquivo/camada.
  3. Pra cada task: chama `create_task({ userStoryId, title, description (brief denso), acceptanceCriteria (técnicos), complexity, scope, dependsOn?, category? })`.
  4. Chama `set_story_refinement(status='committed')`.
  5. Resume: "Story X.com Y tasks geradas. Total: Z FP."

**2.2. Few-shot no prompt — único, cobrindo os três modos.**

Exemplo concreto (resumido — versão final no prompt fica completa):

```
## EXEMPLO de hierarquia completa

### Modo Tree (esqueleto)
→ create_user_story({
    title: "Aprovar invoice em massa",
    want: "Como financeiro, quero selecionar várias invoices e aprovar de uma vez",
    soThat: "pra fechar o mês mais rápido",
    proposedModuleName: "Faturamento",
    refinementStatus: "draft"
  })
  ← { id: "us-1", reference: "US-001", refinementStatus: "draft" }

→ create_user_story({
    title: "Aprovar invoice individual",
    want: "Como financeiro, quero aprovar uma invoice específica",
    soThat: "pra resolver casos urgentes",
    proposedModuleName: "Faturamento",
    refinementStatus: "draft"
  })
  ← { id: "us-2", reference: "US-002" }

[apresenta resumo, espera usuário escolher qual detalhar]

### Modo Story Detail (US-001)
→ create_user_story({
    title: "Aprovar invoice em massa",
    want: "...",
    soThat: "...",
    moduleId: null,                             // ainda em proposed
    proposedModuleName: "Faturamento",
    personaId: "<id-do-Cliente>",
    acceptanceCriteriaProduct: [
      "Checkbox de seleção múltipla aparece em cada linha de invoices pendentes",
      "Botão 'Aprovar selecionadas' só fica ativo quando >= 1 item selecionado",
      "Após aprovar, status das invoices vai pra 'approved' e a lista atualiza",
      "Aprovação individual continua funcionando após a mudança"
    ],
    refinementStatus: "refined"
  })
  ← { id: "us-1", criteriaCount: 4, alreadyExisted: true }

→ set_story_refinement({ storyId: "us-1", status: "refined" })

[pergunta ao usuário: "Aprovar módulo 'Faturamento'? Gerar tasks?"]

### Modo Task Breakdown (US-001)
→ create_task({
    userStoryId: "us-1",
    title: "[Faturamento] Adicionar checkbox de seleção múltipla na lista de invoices",
    description: "## Objetivo\n...\n## O que criar\n- src/app/...",
    acceptanceCriteria: [
      "TypeScript + lint + build limpos",
      "Componente <InvoiceListTable> recebe prop `selectable: boolean`",
      "Listagem sem `selectable` continua renderizando idêntica (regression)"
    ],
    complexity: "low",
    scope: "small"
  })
  ← { id: "tk-1", functionPoints: 3, acCount: 3 }

[repete create_task pra cada slice técnica]

→ set_story_refinement({ storyId: "us-1", status: "committed" })
```

**2.3. Régua de AC dividida no prompt.**
- Bloco "AC de produto" (no modo Story Detail): "verificável pelo PM/usuário sem ler código. Regression check incluso. Sem 'funciona bem'."
- Bloco "AC técnico" (no modo Task Breakdown): "verificável no PR (lint, typecheck, comportamento de função/componente). Sempre incluir um check de regression."

**2.4. `loadContext` do Vitor — adicionar dados de hierarquia.**
- Em [agents/vitor/index.ts](../src/lib/agent/agents/vitor/index.ts), adicionar três loads paralelos:
  - `getModulesForProject(projectId)` (limit implícito por projeto).
  - `getRecentStoriesForProject(projectId, { limit: 50 })`.
  - `getPersonasForProject(projectId)` — pra mapear persona ao gerar.
- Passar como `existingModules`, `existingStories`, `existingPersonas` no contexto. Carregar **só** quando `currentStepKey === 'briefing'` pra não inchar prompt em outros steps.

**Critério de aceite da Fase 2:**
- [ ] Few-shot mostra os três modos.
- [ ] Régua de AC tem dois blocos distintos.
- [ ] Smoke manual: rodar uma sessão completa Tree → Story Detail (uma story) → Task Breakdown (uma story). Ver hierarquia correta no banco.

---

### Fase 3 — Robustez via granularidade (1-2 dias)

A solução é **3 níveis × N requests**, não 1 stream gigante. Sem job table, sem worker.

**3.1. UI de árvore como driver.**
- Componente novo `<DesignSessionTree>` na página da Design Session ([src/app/(dashboard)/design-sessions/[id]/page.tsx]).
- Estrutura: lista expandível Module → Story → Task. Cada nó tem badge de status (`draft/refined/committed`/`task.status`) e botão de ação contextual:
  - Story `draft` → botão "Detalhar" → seta `subPhase='story_detail'` + `targetStoryId` no `currentStepData` da sessão e dispara `POST /chat`.
  - Story `refined` → botão "Gerar tasks" → seta `subPhase='task_breakdown'`.
  - Story `refined` ou `committed` com `proposedModuleName` → botão "Aprovar módulo" → chama endpoint REST direto (não passa pelo agente).
  - Module sem stories ainda → botão "Reabrir tree" → seta `subPhase='tree'`.

**3.2. `currentStepData.subPhase` + `targetStoryId` carregam o estado.**
- Persistido em `DesignSessionStep.data` (jsonb).
- Server lê em `loadContext` e passa pro prompt como parte do briefingSection.

**3.3. Sem mudança em `engine.ts` por enquanto.**
- `maxSteps` permanece 30. Cada modo cabe folgado nesse limite (Tree gera ~6-10 stories sem AC; Story detail é 1 story; Task breakdown é ~3-6 tasks).
- Se medirmos timeout em algum modo específico, subir só pra esse caso (override em `capabilities.maxSteps`).

**3.4. Idempotência em todas as tools.**
- `create_user_story`: dedupa por `(projectId, title)` com status `< 'committed'`.
- `create_task`: dedupa por `(designSessionId, userStoryId, title)` com `status='draft'`.
- `approve_module`: já é idempotente (reusa Module existente).

**Critério de aceite da Fase 3:**
- [ ] Árvore renderiza após Tree, com botões funcionais por nó.
- [ ] Clicar "Detalhar" numa Story dispara request curto, gera AC, atualiza badge.
- [ ] Clicar "Gerar tasks" gera tasks da story, atualiza árvore.
- [ ] Rerodar qualquer botão não duplica.
- [ ] Sessão com 5 módulos × 3-6 stories × 3-6 tasks completa sem timeout.

---

### Fase 4 — Observabilidade (1 dia)

**4.1. Tool call logging.**
- Verificar tabela existente; se não houver, criar `AgentToolCall (id, sessionId, agentName, toolName, input jsonb, output jsonb, durationMs, success bool, errorMessage, createdAt)`.
- Wrapper em `assembleTools` que envolve cada tool antes de devolver. Trunca input/output a 4KB.

**4.2. Métrica de progresso (view SQL).**
- View `design_session_progress`:
  - Por sessão: contagem de Story por `refinementStatus`, contagem de Task por `status`, total FP.
  - Útil pra dashboard interno e pra debug.

**4.3. Mensagem de erro estruturada nas tools.**
- Toda tool retorna `{ success: false, error: string, code?: string }` em falha (já é o padrão atual de `create_task`). Garantir consistência.

**Critério de aceite da Fase 4:**
- [ ] Tool calls do Vitor aparecem em `AgentToolCall`.
- [ ] View `design_session_progress` retorna dados sensatos.

---

### Fase 5 — UI de árvore + view materializada (2 dias)

Pode rodar em paralelo com Fase 3 se houver capacidade.

**5.1. View `design_session_tree`.**
- Materialized? Não — view simples (refresh barato). Junta Module + Story + Task + AC counts.

**5.2. Componente `<DesignSessionTree>`.**
- Render colapsável. Estados: `loading | empty | populated`.
- Polling/realtime: subscribe via Supabase Realtime no canal de `UserStory` + `Task` da sessão. Cada insert/update atualiza o nó.

**5.3. Botão "Aprovar módulo" inline.**
- Aparece em cada `proposedModuleName` único da árvore. Chama `POST /api/stories/[ref]/approve-module` na primeira story do grupo (ou um endpoint novo de batch — decidir conforme uso).

**Critério de aceite da Fase 5:**
- [ ] Árvore atualiza em tempo real durante geração.
- [ ] Aprovar módulo funciona inline.

---

## 5. Ordem de ataque

| Ordem | Fase | Por quê |
|---|---|---|
| 1 | Fase 0 (CHECK XOR) | Trava de integridade, simples, dá segurança pro resto. |
| 2 | Fase 1 (tools) | Precondição pra Fase 2 — sem tools novas, prompt não tem o que chamar. |
| 3 | Fase 2 (prompt três modos) | Já dá pra testar Tree → Story Detail → Task Breakdown manualmente via chat (sem UI nova). |
| 4 | Fase 3.4 (idempotência) | Fechar idempotência **antes** de a UI permitir cliques repetidos. |
| 5 | Fase 5 (UI árvore) | Habilita o fluxo "clica módulo a módulo" do requisito 6. Pode rodar em paralelo com Fase 3 não-UI. |
| 6 | Fase 4 (logging) | Depois que fluxo está estável, instrumenta. |

---

## 6. Riscos & mitigações

| Risco | Mitigação |
|---|---|
| Vitor cria stories duplicadas em sessões diferentes do mesmo projeto. | `existingStories` no contexto + idempotência por `(projectId, title)` na tool. |
| Idempotência de Story falha por variação de título ("Aprovar invoice em massa" vs "em lote"). | Aceitar — em caso de duplicata semântica, usuário deleta via UI. Não vale a pena resolver com fuzzy match agora. |
| Token budget do prompt cresce com `existingStories` (50 items). | Carregar só quando `currentStepKey === 'briefing'`. Cada story listada como linha curta (`[draft] US-042: titulo (módulo)`). |
| Concorrência: dois usuários gerando o mesmo nó. | Lock otimista futuro. Por agora: tools são idempotentes, então race produz no-op (ambos apontam pro mesmo registro). |
| AC duplicado entre Story (produto) e Task (técnico) por descuido da LLM. | Régua dividida no prompt + tool `create_task` ignora silenciosamente AC que sejam idênticos a algum AC da Story (compara texto normalizado). |
| Tasks legadas com AC em markdown ficam órfãs. | Fora de escopo. Documentar como dívida; backfill manual sob demanda. |
| `personaId` ambíguo ("é admin ou cliente?"). | Vitor pergunta no chat antes de gravar; default fica `null` se ambíguo. |
| Few-shot grande estoura tokens. | Medir antes/depois. Se passar 8k, mover few-shot pra exemplo dinâmico carregado só em `briefing`. |
| Mudança em `create_task` quebra sessões abertas chamando schema antigo. | `userStoryId` opcional na primeira semana com warning, obrigatório na semana 2 após prompt em prod. |

---

## 7. Métricas de sucesso

Baseline antes / target depois:

- **% de design sessions que completam Tree → Task Breakdown sem erro** (target: > 95%).
- **Tempo médio do request mais longo** (target: < 120s; teto físico 300s).
- **% de Tasks geradas pós-mudança com `userStoryId` populado** (target: 100%).
- **% de AC em `AcceptanceCriterion` vs em markdown** (target: 100% nas Stories e Tasks geradas pós-mudança).
- **Reclamações "perdeu o trabalho"** (target: 0).
- **Stories `committed` com persona populada** (target: > 80% — flexível porque algumas stories são genéricas).

---

## 8. Decisões em aberto

- [ ] `Module.slug` / `reference` — adiar conforme §2.1, ou alguém quer já?
- [ ] Tool `approve_module` no agente vs. só pelo endpoint REST — manter as duas? (Recomendação: sim, agente pode propor approve, mas usuário confirma — tool exige confirmação no chat antes de chamar.)
- [ ] AC `checkedAt` quando — só após validação humana, ou também quando teste passa? (Fora deste plano, mas relacionado.)
- [ ] `proposedPersonaName` (espelho de `proposedModuleName` mas pra persona) — implementar agora ou só no v2? (Recomendação: v2; usar `personaId` direto no v1, default Builder/PM/Cliente.)
- [ ] Vitor edita Module/Story committed — bloqueado por enquanto? (Recomendação: sim, edição de `committed` é manual via UI; Vitor pode propor reabertura.)

---

## 9. Próximos passos

1. **Validar com o time:** este plano cobre o problema? Decisões §2 batem?
2. **Branch:** `feat/vitor-hierarchy-calibration`. Commits via `bash scripts/sync-main.sh -m "ZRD-JM-NN: ..."`.
3. **Começar pela Fase 0** (migration CHECK XOR) — baixíssimo risco, libera Fase 1.
4. Após Fase 2 (smoke manual de chat funcionando) — decidir se Fase 5 (UI árvore) vai em paralelo ou depois.
