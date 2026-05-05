---
title: Alpha — Story Hierarchy + Sprint Planner (V3)
status: plano executável · supersede v1 e v2
last_updated: 2026-05-05
audience: próximo agente (humano ou IA) que vai executar
---

# Alpha — Story Hierarchy + Sprint Planner (V3)

**Princípio orientador:** *reusar plumbing antes de criar, calibrar antes de empilhar prompt.*

V3 corta o ribbon (vira documento separado depois), adiciona **Fase 0 — Auditoria do Alpha hoje** pra calibrar onde está o gargalo real, separa o trabalho em **fases com release intermediário**, e troca "estender factories" por **wrappers Alpha-only** (blast radius menor).

---

## 0. TL;DR

| Pergunta | Resposta |
|---|---|
| Vitor já gera Module/UserStory/Task/AC? | ✅ Sim, em prod |
| Tools de hierarquia existem em [src/lib/agent/tools/](src/lib/agent/tools/)? | ✅ 7 factories prontas — atadas a `sessionId` |
| Alpha conhece elas? | ❌ Zero menção em [agents/alpha/tools.ts](src/lib/agent/agents/alpha/tools.ts) |
| Prompt do Alpha menciona Module/Story/Persona? | ❌ Zero menção |
| RPCs de hierarquia precisam ser criados? | ❌ DAL `createStory` + factories cobrem tudo |
| `get_member_commitments` / `get_sprint_capacity` existem no Alpha? | ✅ Já em prod |
| `bulk_update_tasks` RPC existe? | ❌ É a única migration nova (template: [`task_acceptance_bulk_diff`](supabase/migrations/20260501_ac_bulk_diff_rpc.sql)) |
| Refinement loop (update story/task/AC pelo agente) existe? | ❌ Tem `update_task_*` granulares, mas falta story/AC |
| Há observability de comportamento do Alpha? | ⚠️ AgentUsage tem chamadas/custo, mas **sem dashboard de qualidade** |

**Resultado:** plano em **4 fases com ship intermediário**, ~30h reais (8h auditoria+hierarquia / 10h planner / 8h ferramentas de refinement / 4h rollout). Total honesto, com piloto entre fases.

**Não inclui ribbon.** Vira documento próprio depois.

---

## 1. Inventário (snapshot 2026-05-05)

### 1.1 Schema/RPCs

| Item | Existe? | Path |
|---|---|---|
| `Module` | ✅ | [20260430_module.sql](supabase/migrations/20260430_module.sql) |
| `UserStory` | ✅ | [20260430_user_story.sql](supabase/migrations/20260430_user_story.sql) |
| `AcceptanceCriterion` | ✅ | [20260430_acceptance_criterion.sql](supabase/migrations/20260430_acceptance_criterion.sql) |
| `ProjectPersona` | ✅ | [20260430_project_persona.sql](supabase/migrations/20260430_project_persona.sql) |
| `TaskAssignment` (M:N) | ✅ | schema base |
| RPC `next_user_story_reference` | ✅ | [20260430_user_story.sql](supabase/migrations/20260430_user_story.sql) |
| RPC `next_task_reference` | ✅ | [20260429_task_creator.sql](supabase/migrations/20260429_task_creator.sql) |
| RPC `task_acceptance_bulk_diff` | ✅ | [20260501_ac_bulk_diff_rpc.sql](supabase/migrations/20260501_ac_bulk_diff_rpc.sql) — **template** |
| View `member_commitment_overview` | ✅ | [20260423_fp_allocation_model.sql](supabase/migrations/20260423_fp_allocation_model.sql) |
| View `sprint_member_capacity` | ✅ | [20260430_fp_capacity_metrics.sql](supabase/migrations/20260430_fp_capacity_metrics.sql) |
| View `sprint_capacity_overview` | ✅ | mesma |
| View `user_story_overview` | ✅ | [20260430_user_story_overview_view.sql](supabase/migrations/20260430_user_story_overview_view.sql) |
| `Module.approvedAt` / approval flow | ✅ | [20260505_module_approval.sql](supabase/migrations/20260505_module_approval.sql) |
| RPC `bulk_update_tasks` | ❌ | **CRIAR (Fase 2)** |

### 1.2 Tools factories em [src/lib/agent/tools/](src/lib/agent/tools/)

| Factory | Arquivo | Sessão? |
|---|---|---|
| `proposeModulesTool(projectId)` | [propose-modules.ts](src/lib/agent/tools/propose-modules.ts) | sem dep — usa direto |
| `syncProjectPersonasTool(projectId)` | [sync-personas.ts](src/lib/agent/tools/sync-personas.ts) | sem dep — usa direto |
| `approveModuleTool(projectId)` | [manage-stories.ts](src/lib/agent/tools/manage-stories.ts) | sem dep — usa direto |
| `setStoryRefinementTool(projectId)` | [manage-stories.ts](src/lib/agent/tools/manage-stories.ts) | sem dep — usa direto |
| `createUserStoryTool(sessionId, projectId, createdById?)` | [create-user-story.ts](src/lib/agent/tools/create-user-story.ts) | requer `sessionId` (idempotência usa) |
| `listStoriesTool(sessionId, projectId)` | [manage-stories.ts](src/lib/agent/tools/manage-stories.ts) | requer `sessionId` |
| `createTaskTool(sessionId, projectId, createdById?)` | [create-task.ts](src/lib/agent/tools/create-task.ts) | requer `sessionId` |

**Decisão V3 (≠ V2):** **NÃO estender factories**. Em vez disso, criar **wrappers finos Alpha-only** que reusam a DAL [src/lib/dal/story-hierarchy.ts](src/lib/dal/story-hierarchy.ts). Razões:
- Idempotência da factory atual usa `(sessionId, userStoryId, title)` — virar `string | null` exige partial unique index e espalha condicional pelo arquivo todo. Risco de regredir Vitor é real (gate "rodar vitor-cli.ts" não cobre o caso `null`).
- Wrappers são ~40 linhas cada e têm escopo claro (Alpha = ops, sem session). Não compete com Vitor.
- Se um dia Alpha ficar "session-aware" (ex: meeting como session), promove o wrapper a factory.

### 1.3 DAL [src/lib/dal/story-hierarchy.ts](src/lib/dal/story-hierarchy.ts) (já session-agnóstica)

`getModulesForProject`, `getPersonasForProject`, `getStoriesForProject`, `getStoryByReference`, `createStory`, `updateStory`, `setStoryRefinement`, `validateStoryAc`, `approveProposedModule`, `promoteTasksForModule`, `revertTasksForModule`, `getAcForStory`, `getAcForTask`, `toggleAcCheck`. **Tudo o que o Alpha precisa, exposto como função TS pura.**

### 1.4 Alpha hoje

[src/lib/agent/agents/alpha/](src/lib/agent/agents/alpha/):

- **context.ts (1129 linhas):** `buildOpsContext` → baseline + `buildProjectFocus` + `buildSprintFocus` + `buildMeetingFocus` + global. **Zero menção a Module/Persona/UserStory.**
- **prompt.ts (244 linhas):** zero menção a hierarquia.
- **tools.ts (1859 linhas):** 30+ tools de ops. Já tem `get_member_commitments`, `get_sprint_capacity`, `create_sprint`, `create_task` (isolada, sem `userStoryId`), `assign_task`, `move_task_to_sprint`, `update_task_*` granulares. **Nenhuma de hierarquia.**

### 1.5 Harness de calibração

[scripts/alpha-cli.ts](scripts/alpha-cli.ts) já existe. Suporta:
- `--member-id` (obrigatório)
- `--message` ou `--message-file`
- `--current-path` (rota → contexto)
- `--meeting-id`
- `--thread-id` ou `--new-thread` (**multi-turn via thread persistido!**)
- `--max-steps`
- imprime tool-calls + outputs em stream

**Implicação:** calibração D (multi-turn: 4 perguntas → resposta → proposta → confirma) funciona reusando o mesmo `--thread-id` em chamadas sequenciais. Não precisa harness novo.

---

## 2. Plano V3 — 4 Fases

| Fase | Escopo | Ship | Tempo |
|---|---|---|---|
| **0 — Auditoria** | Rodar 10–15 conversas reais no Alpha hoje, classificar falhas, decidir se hierarquia é mesmo o gargalo | Doc `alpha-audit.md` + decisão go/no-go pra Fase 1 | 4h |
| **1 — Hierarquia básica + Refinement** | Wrappers Alpha-only (read+write taxonomia), context block taxonomia (lazy/condicional), prompt hierarquia, refinement tools (update_story / manage AC) | Ship Zordon, 1 semana piloto | 12h |
| **2 — Sprint Planner Mode** | RPC `bulk_update_tasks`, tools `get_project_capacity` / `list_unplanned_tasks` / `bulk_update_tasks`, prompt "Sprint Planning", gate por intent | Ship Zordon, 1 semana piloto | 10h |
| **3 — Rollout + Observability** | Kill switch por projeto, AgentQualityLog (logging estruturado de classificações), dashboard mínimo, rollout gradual nos outros projetos | Ship geral | 4h |

**Total honesto:** 30h spread em 3–4 semanas. Não 16h sequenciais.

**Sequência crítica:** 0 → 1 → 2 → 3. Cada fase tem gate de calibração + ship intermediário.

---

## 3. Fase 0 — Auditoria do Alpha hoje (4h)

**Objetivo:** antes de empilhar 500 linhas de prompt e 6 tools novas, **medir** onde o Alpha falha hoje e validar que hierarquia é o gargalo certo.

### 3.1 Setup

```bash
# Member-id de teste (você)
psql "$DIRECT_URL" -c "SELECT id, name FROM \"Member\" WHERE email = 'joao.moraes@volund.com.br';"
# Salve o id como $ALPHA_TEST_MEMBER

# Projeto piloto
psql "$DIRECT_URL" -c "SELECT id, name FROM \"Project\" WHERE name ILIKE '%zordon%' OR name ILIKE '%volund%' ORDER BY \"createdAt\" DESC LIMIT 5;"
# Salve o id como $ALPHA_TEST_PROJECT
```

Cria doc vazio:
```bash
touch docs/alpha-audit.md
```

### 3.2 Cenários de auditoria (15 prompts, 1 run cada)

Roda em sessão NOVA por prompt (pra não contaminar contexto):

```bash
# Template
npx tsx --require ./scripts/_server-only-shim.cjs scripts/alpha-cli.ts \
  --member-id "$ALPHA_TEST_MEMBER" \
  --new-thread \
  --current-path "/projects/$ALPHA_TEST_PROJECT" \
  --message "<prompt>"
```

**Cobertura:** distribui pra ver pontos cegos, não só hierarquia.

| # | Prompt | O que mede |
|---|---|---|
| A1 | "criar uma story de magic-link com expiração" | Alpha reconhece "story" como conceito? Cria task isolada (legacy) ou pergunta? |
| A2 | "qual módulo a feature 'auditoria de eventos' deveria entrar?" | Alpha sabe que módulo existe? Inventa? Recusa? |
| A3 | "lista os módulos desse projeto" | Alpha tem ferramenta de leitura de módulos? |
| A4 | "lista as user stories desse projeto" | Idem stories |
| A5 | "criar 5 tasks pra implementar checkout" | Atomicidade — cria 1 ou 5? Vincula a story? |
| A6 | "como tá o sprint?" (controle, baseline) | Sanity check — Alpha continua respondendo bem ao caso já em prod? |
| A7 | "organiza o backlog em sprints" | Alpha tem capacity awareness? Pergunta? Chuta? |
| A8 | "quem tá sobrecarregado?" (controle) | Sanity check capacity (já em prod) |
| A9 | "criar story 'login' e já criar as tasks dela" | Composição — Alpha encadeia ou faz uma só? |
| A10 | "essa story aqui (passa um ref) tá com AC ruim, melhora" | Refinement loop — Alpha consegue editar AC? |
| A11 | "quero refinar a story X, dividir em 3 menores" | Split — gap conhecido |
| A12 | "melhorar dashboard" (vago) | Alpha pede clarificação ou inventa? |
| A13 | "essa task aqui tá errada, ajusta o título" | Update granular — funciona? |
| A14 | "marca a story X como refined" | Workflow — `setStoryRefinement` exposto? |
| A15 | "quais personas existem nesse projeto?" | Persona awareness |

### 3.3 Classificação de falhas (template em `alpha-audit.md`)

Pra cada prompt, anotar 1 linha:

```markdown
## A1 — "criar uma story de magic-link com expiração"

- **Resultado:** [criou task / criou story / recusou / pediu clarificação / outro]
- **Tools chamadas:** [lista]
- **Falha?** [sim/não]
- **Categoria de falha:**
  - [ ] sem-tool (falta ferramenta exposta)
  - [ ] sem-contexto (Alpha não sabe que algo existe)
  - [ ] prompt-confuso (regra ambígua)
  - [ ] modelo-alucina (tool existe mas Alpha ignora)
  - [ ] comportamento-correto (nada a fazer)
- **Notas:** [1 frase]
```

### 3.4 Decisão go/no-go (gate da Fase 0)

Após os 15 prompts, contar:

- **falhas categoria `sem-tool` + `sem-contexto` ≥ 8/15** → hierarquia É o gargalo. Ir pra Fase 1 sem mudar plano.
- **falhas `prompt-confuso` ≥ 5/15** → o problema é prompt atual, não hierarquia. **Pausar V3, fazer prompt cleanup primeiro.**
- **falhas `modelo-alucina` ≥ 5/15** → problema de modelo (Opus vs Sonnet, temperatura). Discutir antes de Fase 1.
- **Sanity (A6, A8): falha** → tem regressão antes mesmo da V3. Investigar.

Saída: 1 parágrafo no fim de `alpha-audit.md` com decisão.

### 3.5 Bonus — heatmap de tool usage (opcional, 30min)

```sql
-- Quais tools o Alpha mais chama hoje, em produção
SELECT
  jsonb_array_elements(parts)->>'toolName' AS tool_name,
  count(*) AS calls
FROM "ChatMessage"
WHERE "agentName" = 'alpha'
  AND parts IS NOT NULL
  AND "createdAt" > now() - interval '14 days'
GROUP BY 1
ORDER BY 2 DESC
LIMIT 30;
```

Adiciona ao audit doc. **Útil pra:** detectar tools dead (nunca chamadas — candidatas a remoção) e tools sobre-utilizadas (talvez compostas em vez de granulares).

---

## 4. Fase 1 — Hierarquia básica + Refinement (12h)

**Pré-condição:** auditoria passou, hierarquia é o gargalo.

**Objetivo de produto:** PM consegue conversar com o Alpha pra **criar, classificar, refinar e iterar** Module/Story/Task/AC sem sair do chat.

### 4.1 Onda 1.1 — Wrappers Alpha-only (3h)

**Arquivo novo:** `src/lib/agent/tools/alpha-hierarchy.ts`

7 wrappers, ~40 linhas cada. Padrão:

```ts
import { tool } from "ai";
import { z } from "zod";
import {
  getModulesForProject,
  getPersonasForProject,
  getStoryByReference,
  createStory,
  updateStory,
  setStoryRefinement,
  approveProposedModule,
  // ...
} from "@/lib/dal/story-hierarchy";

export function listModulesForOpsTool(projectId: string) {
  return tool({
    description: "Lista módulos do projeto com count de stories. Use antes de criar stories pra evitar criar módulo paralelo.",
    inputSchema: z.object({}),
    execute: async () => {
      const modules = await getModulesForProject(projectId);
      return { modules };
    },
  });
}

export function listPersonasForOpsTool(projectId: string) { /* análogo */ }
export function getStoryOverviewForOpsTool(projectId: string) { /* getStoryByReference */ }

export function createStoryForOpsTool(projectId: string, createdById: string) {
  return tool({
    description: "Cria UserStory no projeto. Toda story criada vira refinementStatus=draft. Sempre passe um moduleId existente OU proposedModuleName em UPPERCASE_SNAKE.",
    inputSchema: z.object({
      title: z.string().min(3),
      want: z.string().min(3),
      soThat: z.string().optional(),
      moduleId: z.string().uuid().nullable(),
      proposedModuleName: z.string().optional(),
      personaId: z.string().uuid(),
      acceptanceCriteria: z.array(z.string()).min(1).max(8),
      reasoning: z.string().min(10),
    }),
    execute: async (input) => {
      // Idempotência alpha-only: (projectId, title) com refinementStatus IN ('draft','refined')
      const existing = await getStoriesForProject(projectId);
      const dup = existing.find(
        s => normalizeTitle(s.title) === normalizeTitle(input.title) &&
             ['draft', 'refined'].includes(s.refinementStatus)
      );
      if (dup) {
        return {
          ok: false,
          duplicate: { reference: dup.reference, title: dup.title },
          message: "Story similar já existe. Sugira reutilizar ou estender."
        };
      }

      const created = await createStory({
        projectId,
        ...input,
        createdById,
        refinementStatus: 'draft',
      });
      return { ok: true, story: created };
    },
  });
}

export function updateStoryForOpsTool(projectId: string) { /* updateStory */ }
export function setStoryRefinementForOpsTool(projectId: string) { /* setStoryRefinement */ }
export function approveModuleForOpsTool(projectId: string, actorId: string) { /* approveProposedModule */ }
export function proposeModulesForOpsTool(projectId: string) { /* reusa proposeModulesTool — não tem dep de session */ }
export function syncPersonasForOpsTool(projectId: string) { /* reusa syncProjectPersonasTool — sem dep de session */ }
```

**Não esquece:** AC tools (gap descoberto na auditoria — A10/A11).

```ts
export function manageStoryAcForOpsTool(projectId: string) {
  return tool({
    description: "Adiciona/remove/edita acceptance criteria de uma story. Use durante refinement.",
    inputSchema: z.object({
      storyRef: z.string(),
      operations: z.array(z.discriminatedUnion('op', [
        z.object({ op: z.literal('add'), text: z.string().min(3) }),
        z.object({ op: z.literal('remove'), acId: z.string().uuid() }),
        z.object({ op: z.literal('edit'), acId: z.string().uuid(), text: z.string().min(3) }),
      ])).min(1).max(10),
      reasoning: z.string().min(10),
    }),
    execute: async ({ storyRef, operations, reasoning }) => {
      // chama DAL — adiciona helper se faltar (provável: addAc/removeAc/updateAc)
    },
  });
}
```

**Migration nova (se DAL não tiver os helpers de AC granular):** verificar se `getAcForStory` + `addAcToStory` / `removeAc` / `updateAcText` existem. **Provavelmente faltam — criar na DAL antes do wrapper.**

### 4.2 Onda 1.2 — Registrar no Alpha (1h)

**Arquivo:** [src/lib/agent/agents/alpha/tools.ts](src/lib/agent/agents/alpha/tools.ts)

Adicionar antes do bloco de write tools existente:

```ts
import {
  listModulesForOpsTool,
  listPersonasForOpsTool,
  getStoryOverviewForOpsTool,
  createStoryForOpsTool,
  updateStoryForOpsTool,
  setStoryRefinementForOpsTool,
  approveModuleForOpsTool,
  proposeModulesForOpsTool,
  syncPersonasForOpsTool,
  manageStoryAcForOpsTool,
} from "@/lib/agent/tools/alpha-hierarchy";

// Leitura (sempre)
if (projectId) {
  tools.list_modules = listModulesForOpsTool(projectId);
  tools.list_personas = listPersonasForOpsTool(projectId);
  tools.get_story = getStoryOverviewForOpsTool(projectId);
  // list_stories: reusar listStoriesTool com null seria mais limpo, mas mantém wrapper pra Alpha
}

// Escrita (gated)
if (capabilities.writeTools && projectId) {
  tools.propose_modules = proposeModulesForOpsTool(projectId);
  tools.approve_module = approveModuleForOpsTool(projectId, capabilities.actorId);
  tools.sync_personas = syncPersonasForOpsTool(projectId);
  tools.create_user_story = createStoryForOpsTool(projectId, capabilities.actorId);
  tools.update_user_story = updateStoryForOpsTool(projectId);
  tools.set_story_refinement = setStoryRefinementForOpsTool(projectId);
  tools.manage_story_ac = manageStoryAcForOpsTool(projectId);
}
```

**Importante:** `tools.create_task` legacy **fica como está** nesse passo. Em Fase 1 ele continua criando task isolada. Em Fase 2 (planner), discutir se vincular a `userStoryId` opcional ou criar `create_task_with_story`.

### 4.3 Onda 1.3 — Context block taxonomia (lazy + condicional) (2h)

**Princípio crítico (gap V2):** o Alpha já tem context.ts com 1129 linhas. **Não dá pra carregar tudo sempre.**

**Estratégia:** taxonomia entra **só quando relevante**.

**Arquivos:**
- [src/lib/dal/story-hierarchy.ts](src/lib/dal/story-hierarchy.ts) — adicionar:

```ts
export async function getAlphaProjectSnapshot(projectId: string, opts?: {
  includeRecentStories?: boolean;
  recentStoriesLimit?: number;
}): Promise<{
  modules: Array<{ id: string; name: string; description: string | null; storyCount: number; approvedAt: string | null }>;
  personas: Array<{ id: string; name: string; description: string | null; storyCount: number }>;
  recentStories?: Array<{ reference: string; title: string; moduleId: string | null; refinementStatus: string }>;
  backlogReady: { taskCount: number; totalFp: number; byModule: Record<string, number> };
}>
```

- [src/lib/agent/agents/alpha/context.ts](src/lib/agent/agents/alpha/context.ts) — em `buildProjectFocus`:

```ts
// Heurística de relevância
const taxonomyHints = ['story', 'stor', 'módulo', 'modulo', 'persona', 'criar', 'refinar', 'backlog', 'feature', 'AC', 'aceitação', 'aceitacao'];
const userMessageLower = userMessage.toLowerCase();
const taxonomyLikelyRelevant = taxonomyHints.some(h => userMessageLower.includes(h));

if (taxonomyLikelyRelevant) {
  const snapshot = await getAlphaProjectSnapshot(projectId, {
    includeRecentStories: true,
    recentStoriesLimit: 20,
  });
  focusBlock += renderTaxonomyBlock(snapshot);
} else {
  // Fallback minimal: só counts (modules.length + stories totais), sem listar
  const counts = await getAlphaProjectSnapshot(projectId, { includeRecentStories: false });
  focusBlock += renderTaxonomyMinimal(counts);
}
```

`renderTaxonomyBlock` (versão completa, ~3kb):
```
## Taxonomia

Módulos (9):
- LOGIN — fluxos de auth (12 stories)
- BILLING — pagamento (8 stories)
...

Personas (3):
- cliente: usa o produto (15 stories)
- admin: administra a plataforma (5 stories)
- builder: implementa (3 stories)

Histórico recente (últimas 20):
- LOGIN-US-014 [refined]: Magic-link com expiração
...

Backlog pronto: 47 tasks, 312 FP
  por módulo: LOGIN (12), BILLING (18), AUDIT (10), outros (7)
```

`renderTaxonomyMinimal` (~150 chars):
```
## Taxonomia (resumo)
9 módulos, 3 personas, 23 stories, backlog 47 tasks. Use list_modules / list_stories pra detalhes.
```

**Métrica de sucesso:** prompt Alpha total **não cresce >2kb** em conversa não-hierárquica.

### 4.4 Onda 1.4 — Prompt: seção "Hierarquia" (1h)

**Arquivo:** [src/lib/agent/agents/alpha/prompt.ts](src/lib/agent/agents/alpha/prompt.ts)

Adicionar **após** a seção "Vocabulário básico — Task ≠ Todo":

```
---

## Hierarquia: Module → UserStory → Task → AC

Cada projeto tem uma taxonomia de produto:
- **Module:** agrupador funcional (LOGIN, BILLING, AUDIT_LOG). UPPERCASE_SNAKE.
- **UserStory:** "Como {persona}, quero {want}, para que {soThat}."
- **Task:** unidade técnica. Pode pertencer a uma story (`userStoryId`) ou ser isolada.
- **AcceptanceCriterion (AC):** binário, verificável. Story-level (negócio) ou Task-level (técnico).

Você recebe `## Taxonomia` no contexto quando o pedido envolve produto/feature.

### Regras

1. **CLASSIFICAÇÃO DE MÓDULO**
   - SEMPRE escolher módulo existente quando a story cabe.
   - Se nenhum cabe: `moduleId: null` + `proposedModuleName` em UPPERCASE_SNAKE. PM aprova via `approve_module`.

2. **PERSONA — você nunca inventa**
   - Use sempre id de persona existente (lista no contexto).
   - Se nenhuma persona cabe, **pare e pergunte** — não chute.

3. **NARRATIVA**
   - `title`: imperativo curto.
   - `want`: começa com verbo.
   - `soThat`: porquê de negócio. Opcional só se óbvio.

4. **AC — sempre verificáveis**
   - Story-level: comportamento de negócio ("usuário consegue X").
   - Task-level: aceitação técnica ("retorna 410 Gone").
   - Mau: "implementa endpoint REST". Bom: "GET /sessions retorna lista paginada com 25 itens default".

5. **TASKS por story**
   - 1–15 atômicas. `type` (feature/bugfix/refactor/setup/component/seed/management).
   - `scope × complexity` calcula FP automaticamente.

6. **ANTI-DUPLICAÇÃO**
   - Verifique `recentStories` do contexto antes de criar.
   - Se similar existe, mencione no `reasoning` e **sugira reutilizar**, NÃO crie. (O wrapper rejeita duplicata, mas você nem deve chegar lá.)

7. **REFINEMENT STATUS**
   - Toda story criada por você nasce `draft`.
   - PM marca `refined` (você só faz isso quando ele pedir explicitamente).
   - **Nunca** pular pra `committed`.

8. **AMBIGUIDADE**
   - Input vago ("melhorar dashboard")? Pergunte antes. Não gere stories vagas.

9. **REFINEMENT — você ITERA**
   - PM pode pedir "ajusta AC dessa story", "muda o título", "remove esse critério". Use `update_user_story` ou `manage_story_ac`.
   - Sempre mostre o diff em texto antes de aplicar (Regra 0).

10. **ANTI-ALUCINAÇÃO — adendo da auditoria 2026-05-05**
    Quando o usuário cita uma entidade que **você não vê no contexto** (uma story `XXX-US-NN`, um módulo `FOO`, uma persona, um status como `refined`), **NUNCA afirme que não existe**. A auditoria mostrou Alpha negando 4 entidades reais (ZRDN-US-002, ZRDN-US-003, status `refined`, personas) por falta de tool de leitura.
    Fluxo correto:
    a. Primeiro **chame a tool de leitura** apropriada (`list_modules`, `list_personas`, `get_story`).
    b. Se a tool retornar vazio: diga "não encontrei `X` — confirma a referência ou me passa o título?".
    c. **NUNCA** diga "essa referência não existe no sistema" sem ter checado.
    d. **NUNCA** use a ausência da entidade no contexto como prova de inexistência. O contexto é parcial.
```

### 4.5 Onda 1.5 — Calibração Fase 1 (3h)

**Cenários** — 5 hierarquia + 3 refinement, 5 runs cada (≠ 3 do V2 que era teatro estatístico):

| # | Input | Esperado |
|---|---|---|
| F1.1 | "criar story 'login com email'" | story em LOGIN existente, persona correta, 2-3 AC verificáveis |
| F1.2 | "criar story 'checkout completo'" | story em BILLING, 5+ AC bem escritos |
| F1.3 | "criar story 'auditoria de eventos do sistema'" | `moduleId: null` + `proposedModuleName: "AUDIT_LOG"` ou similar |
| F1.4 | "como tá o login?" (não-hierárquico, baseline) | resposta narrativa, 0 stories criadas, taxonomia mínima no contexto |
| F1.5 | "melhorar dashboard" (vago) | Alpha pergunta o que melhorar, NÃO gera |
| F1.6 | "essa story aqui (X-US-014) tá com AC fraco, melhora" | `manage_story_ac` com diff em texto antes |
| F1.7 | "quero refinar X-US-014 e marcar como refined" | iterar campos + `set_story_refinement` no fim |
| F1.8 | "essa story tá duplicada com Y-US-007, deleta uma" | Alpha **pergunta qual** (não chuta) ou apresenta diff comparativo |

**Régua objetiva** (escrever em `alpha-calibration-results.md`):
```
F1.1 — run 1/5: ✅ moduleId=LOGIN, persona=cliente, 3 AC ["1: ...", "2: ...", "3: ..."], reasoning OK
F1.1 — run 2/5: ❌ inventou módulo "AUTH" (deveria ter usado LOGIN existente)
F1.1 — run 3/5: ✅ ...
```

**Gate de aceite:** ≥ 4/5 acerto em CADA cenário (80%). Falhas viram tickets de prompt iteration.

### 4.6 Onda 1.6 — Smoke E2E + Ship Zordon (2h)

1. Em projeto Zordon real, abrir chat Alpha em `/projects/<zordonId>`
2. Criar 1 story nova ("auditoria de logs"), refinar 1 existente, marcar 1 como refined
3. Verificar via psql que estado bate
4. Commit por onda + PR
5. Ship pra Zordon. **Aguardar 1 semana com PM real usando.** Coletar feedback.

**Decisão de Fase 2:**
- ≥ 80% PM-satisfaction nas conversas reais → segue Fase 2
- 60–80% → 1 semana de iteração no prompt antes de seguir
- < 60% → revisita classificação da auditoria

---

## 5. Fase 2 — Sprint Planner Mode (10h)

**Pré-condição:** Fase 1 em prod 1+ semana sem regressão.

### 5.1 Onda 2.1 — RPC `bulk_update_tasks` (2h)

Idêntico ao V2 §6.2 (mantido — escopo correto, transação atômica, valida actor é manager+).

**Detalhe acrescentado:** logar em AgentUsage **dentro** do RPC ou via wrapper TS (decisão: TS, mais flexível pra schema).

### 5.2 Onda 2.2 — Tools planner (2h)

3 tools (idênticas ao V2 §6.3): `get_project_capacity`, `list_unplanned_tasks`, `bulk_update_tasks`.

### 5.3 Onda 2.3 — Gate condicional planner mode (1h)

**Diferença crítica vs V2:** planner block só carrega se **intent do turno** sugere planning, não só estado do projeto.

```ts
// Em buildProjectFocus
const plannerHints = ['organiz', 'aloca', 'planej', 'sprint', 'capacity', 'cabe', 'distribu', 'priori'];
const plannerIntent = plannerHints.some(h => userMessageLower.includes(h));

const hasReadyBacklog = backlogReady.taskCount >= 10;
const hasBuilders = members.some(m => m.fpAllocation > 0);

if (plannerIntent && hasReadyBacklog && hasBuilders) {
  focusBlock += renderPlannerCapacityBlock(snapshot, members, sprints);
}
```

**Resultado:** turno "como tá sprint?" não carrega 4kb de planner block. Turno "organiza o backlog" carrega.

### 5.4 Onda 2.4 — Prompt "Sprint Planning" (1h)

Idêntico ao V2 §6.4 (regras boas — 4 perguntas obrigatórias, dimensionamento, respeito de capacity, segmentação por assignee, proposta em texto + confirmação, status default `todo`, sem persistência de preferências).

**Adicionar no fim:**
```
8. ESCOPO DE PLANEJAMENTO
   Você só entra em planning mode quando:
   (a) o usuário pediu (palavra-chave detectada),
   (b) há ≥10 tasks no backlog ready (com FP e story),
   (c) há ProjectMembers com FP>0 alocados.
   Se faltar (b) ou (c), explique o que falta antes de prometer plano:
   "Tem 4 tasks no backlog ready. Antes de planejar, você quer que eu ajude a refinar mais stories ou a estimar tasks pendentes?"
```

### 5.5 Onda 2.5 — Calibração Fase 2 (3h)

**Cenários multi-turn** (use `--thread-id` reusado):

| # | Turn 1 | Turn 2 | Turn 3 | Esperado |
|---|---|---|---|---|
| F2.1 | "organiza o backlog em sprints" | (responde as 4 perguntas) | "manda" | Alpha pergunta as 4 → propõe em texto → executa bulk_update_tasks após confirma |
| F2.2 | "aloca tudo no Sprint 8" (estoura cap) | — | — | Alerta + propõe split (cria Sprint 9 via `create_sprint`) |
| F2.3 | "Lucas e Pedro só backend, João full" (em conversa de planning) | "manda" | — | Tasks de frontend NÃO vão pro Lucas/Pedro |
| F2.4 | Backlog 600 FP / cap total 390 | — | — | Alpha avisa "falta builder ou sprint extra?" — não força |
| F2.5 | "Ana de férias no Sprint 9" + "manda" | — | — | Cap recalculada sem Ana |
| F2.6 | "como tá o sprint?" (controle, não-planner) | — | — | Resposta narrativa, **sem** planner block carregado, 0 tools de bulk |

5 runs cada, mesma régua de 80%.

### 5.6 Onda 2.6 — Smoke E2E + Ship Zordon (1h)

Mesmo padrão da Fase 1. Smoke real no Zordon, commit, ship, 1 semana piloto.

---

## 6. Fase 3 — Rollout + Observability (4h)

### 6.1 Onda 3.1 — Kill switch por projeto (1h)

**Migration:** `Project.alphaHierarchyEnabled boolean default true`. Em `buildProjectFocus`, se `false`, pular taxonomia + planner. No registro de tools, gatear:

```ts
if (capabilities.writeTools && projectId && project.alphaHierarchyEnabled) {
  // Registra tools de hierarquia
}
```

**Razão:** se em prod o Alpha alucinar em projeto X (cliente sensível), desliga via UI/SQL sem rollback de código.

### 6.2 Onda 3.2 — `AgentQualityLog` (2h)

**Migration nova:**
```sql
CREATE TABLE "AgentQualityLog" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agentSlug" text NOT NULL DEFAULT 'alpha',
  "projectId" uuid REFERENCES "Project"(id) ON DELETE SET NULL,
  "memberId" uuid REFERENCES "Member"(id) ON DELETE SET NULL,
  "threadId" uuid REFERENCES "ChatThread"(id) ON DELETE SET NULL,
  -- Classificação
  category text NOT NULL,  -- 'story_created', 'module_classified', 'plan_proposed', 'plan_executed'
  payload jsonb NOT NULL,  -- { storyRef, moduleId, reasoning, confidence }
  -- Validação humana (preenchido depois pelo PM via UI / cron / heurística)
  "humanVerdict" text,  -- 'correct', 'wrong', 'edited', null
  "verdictAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_quality_log_agent_created
  ON "AgentQualityLog"("agentSlug", "createdAt" DESC);
CREATE INDEX agent_quality_log_unverified
  ON "AgentQualityLog"("agentSlug", "createdAt" DESC)
  WHERE "humanVerdict" IS NULL;
```

**Quem grava:** os wrappers da Fase 1/2 chamam `logAgentQuality(...)` em cada decisão estruturada.

**Quem valida:** heurística de detecção barata:
- `story_created` com `moduleId` X → 7 dias depois, se `Story.moduleId` ainda é X → `correct`. Se mudou → `wrong` (PM editou). Se story foi deletada → `edited`.
- `plan_proposed` → se `bulk_update_tasks` foi chamado nos próximos 10min → `correct` (PM confirmou). Se não → `wrong`.

Implementar como cron diário leve (já tem CronCreate).

### 6.3 Onda 3.3 — Dashboard mínimo (30min)

**Não criar página nova.** Adicionar 1 query no painel Ops:

```sql
-- Quality metrics, últimos 30d
SELECT
  category,
  count(*) FILTER (WHERE "humanVerdict" = 'correct') AS correct,
  count(*) FILTER (WHERE "humanVerdict" = 'wrong') AS wrong,
  count(*) FILTER (WHERE "humanVerdict" IS NULL) AS pending,
  round(
    100.0 * count(*) FILTER (WHERE "humanVerdict" = 'correct')
    / NULLIF(count(*) FILTER (WHERE "humanVerdict" IS NOT NULL), 0),
    1
  ) AS pct_correct
FROM "AgentQualityLog"
WHERE "agentSlug" = 'alpha'
  AND "createdAt" > now() - interval '30 days'
GROUP BY 1;
```

Exibir em página interna. Métrica de "≥ 90% das stories com moduleId correto" agora é **medível**, não chute.

### 6.4 Onda 3.4 — Rollout gradual (30min)

1. Ligar nos próximos 2 projetos (não-Zordon)
2. Aguardar 1 semana
3. Ligar nos demais
4. Manter kill switch como porta de saída

---

## 7. Runbook executável

### Passo 1 — Fase 0 auditoria (4h)
1. Setup ids (psql) — 5min
2. 15 prompts no alpha-cli — 2h (incluindo análise de output)
3. Heatmap de tools — 30min (opcional)
4. Documentar `docs/alpha-audit.md` + decisão go/no-go — 1h

**Gate:** decisão escrita no fim do doc. Se no-go, pausa V3.

### Passo 2 — Fase 1.1 wrappers (3h)
- Criar `src/lib/agent/tools/alpha-hierarchy.ts`
- Adicionar helpers de AC à DAL se faltarem
- `bunx tsc --noEmit`

### Passo 3 — Fase 1.2 registro Alpha (1h)
- Editar [agents/alpha/tools.ts](src/lib/agent/agents/alpha/tools.ts)
- Smoke: alpha-cli "lista módulos" → cita reais

### Passo 4 — Fase 1.3 context (2h)
- DAL `getAlphaProjectSnapshot`
- context.ts: `renderTaxonomyBlock` + `renderTaxonomyMinimal` + heurística de relevância
- Smoke: medir tamanho do prompt em conversa não-hierárquica vs hierárquica

### Passo 5 — Fase 1.4 prompt (1h)
- prompt.ts: seção "Hierarquia"

### Passo 6 — Fase 1.5 calibração (3h)
- 8 cenários × 5 runs = 40 invocações
- `docs/alpha-calibration-results.md`
- Gate: 80% por cenário, senão volta pro prompt

### Passo 7 — Fase 1.6 smoke + ship (2h)
- E2E manual no Zordon
- `bash scripts/sync-main.sh -m "ZRD-JM-NN: alpha — fase 1 hierarquia"`
- 1 semana piloto

**STOP.** Decisão go/no-go pra Fase 2 baseado em uso real.

### Passos 8–13 — Fase 2 (10h)
Análogos. Migration → tools → gate → prompt → calibração → ship → 1 semana piloto.

### Passos 14–17 — Fase 3 (4h)
Kill switch → AgentQualityLog → dashboard → rollout.

---

## 8. Métricas (medíveis, não aspiracionais)

| Métrica | Como medir | Gate |
|---|---|---|
| Story `moduleId` correto | `AgentQualityLog` `humanVerdict` | ≥ 90% após 30d |
| Story `personaId` correto | idem | ≥ 95% |
| AC vazio | query: stories sem AC criadas pelo Alpha | 0 |
| Plano de sprint rejeitado pelo PM | proposta sem `bulk_update_tasks` em 10min | ≤ 5% |
| Bulk parcial | impossível por design (RPC atômica) | 0 incidentes |
| Tamanho médio do prompt em conversa não-hierárquica | log do `buildOpsContext` | < 2kb crescimento vs hoje |

---

## 9. Riscos consolidados

| Risco | Mitigação | Fase |
|---|---|---|
| Auditoria revela problema diferente (prompt confuso, não hierarquia) | Gate Fase 0 obriga decisão escrita | 0 |
| Wrappers duplicam Vitor | Wrapper só usa DAL session-agnóstica; Vitor não toca | 1 |
| Context bloat estoura prompt | Carregamento condicional por intent + métrica de tamanho | 1 |
| Alpha confunde módulos sinônimos (AUTH/LOGIN) | Prompt regra 1 + recentStories + se persistir → `Module.aliases text[]` | 1 |
| Story duplicada criada | Wrapper bloqueia (`(projectId, title)` filtrado) + prompt regra 6 | 1 |
| Bulk falha no meio | RPC atômica, rollback total | 2 |
| Capacity stale (PM mudou ProjectMember) | RPC revalida em cada update | 2 |
| PM esquece restrição (férias, dedicação) | Prompt obriga as 4 perguntas | 2 |
| Planner mode polui conversa não-planner | Gate por intent + estado, não só estado | 2 |
| Prompt cresce demais (1500 linhas) e Alpha perde coerência | Métrica de tamanho + lazy loading | 1+2 |
| Comportamento ruim em projeto cliente sensível | Kill switch `Project.alphaHierarchyEnabled` | 3 |
| Métricas de qualidade sem dado humano | AgentQualityLog + heurística de auto-verdict | 3 |

---

## 10. Conventions (recap)

- Migrations via `psql "$DIRECT_URL" -f <path>`
- Após migration: regerar `database.types.ts` (`npx supabase gen types typescript --project-id <ref>`)
- `bunx tsc --noEmit` antes de cada commit
- Commits via `bash scripts/sync-main.sh -m "ZRD-JM-NN: <auto-summary>"`
- Calibração: 5 runs/cenário, régua objetiva escrita
- Sprints seg→dom, 7d (CHECK no DB)
- **Sem feature flag** pra carregamento condicional (heurística de intent é determinística)
- **COM kill switch** pra rollout (Project.alphaHierarchyEnabled)

---

## 11. Decisões V3 vs V2

| Item | V2 | V3 | Razão |
|---|---|---|---|
| Fase 0 auditoria | ❌ | ✅ 4h | Validar gargalo antes de empilhar prompt |
| Estender factory `sessionId: string \| null` | ✅ | ❌ — wrappers Alpha-only | Blast radius menor, não toca Vitor |
| Refinement tools (update_story / manage_story_ac) | ❌ | ✅ Fase 1 | Ciclo iterativo no chat — sem isso valor colapsa |
| Context loader sempre carrega tudo | ✅ | ❌ — condicional por intent | Evita bloat de 4kb em conversa não-hierárquica |
| Planner mode automático por estado | ✅ | ❌ — gate por intent + estado | Não polui conversas não-planner |
| Calibração 3 runs | ✅ | ❌ — 5 runs + régua objetiva | 3 runs com LLM = teatro estatístico |
| Ship monolítico | ✅ | ❌ — ship após Fase 1, depois Fase 2 | Validar em piloto antes de empilhar |
| Kill switch | ❌ | ✅ Fase 3 | Sem isso, rollback exige deploy |
| AgentQualityLog + dashboard | ❌ | ✅ Fase 3 | Métricas de aceite hoje são chute |
| Ribbon | ✅ Onda E | ❌ — sai pra doc próprio | Não é hierarquia, é feature paralela com economia diferente |
| Tempo total | 16h | 30h em 4 fases (com piloto entre) | Honesto |

---

## 12. Próximo passo concreto

1. Ler §0 (TL;DR) + §3 (Fase 0) — 10min
2. Setup ids (psql) — 5min
3. Rodar 15 prompts da auditoria — 2h
4. Documentar + decisão — 1h
5. **Se go:** seguir §4 (Fase 1) sequencial
6. **Após Fase 1:** ship Zordon, 1 semana piloto, decidir Fase 2
7. **Após Fase 2:** ship Zordon, 1 semana, decidir Fase 3

**Pontos de stop obrigatórios:**
- Gate Fase 0 (decisão go/no-go escrita)
- Gate Fase 1 (calibração 80% + 1 semana piloto)
- Gate Fase 2 (calibração 80% + 1 semana piloto)

**Sem atalhos.** Calibração com régua objetiva é o que separa "agente que parece funcionar" de "agente que funciona em prod".
