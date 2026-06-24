# Vitória — Plano de Inteligência v2 (evolução pós-staging)

> Sucede [`staging-rewrite-plan.md`](staging-rewrite-plan.md) (já executado em parte). Foco aqui: deixar a Vitória **útil de verdade** num planning real — contexto rico do projeto, estimativa fundamentada, AC e descrições padrão SDD, awareness de bloqueios e adaptação ao estilo do facilitador — **com custo de tokens controlado e visível**.
>
> Inspiração direta no padrão de sub-agente do Alpha ([`extract_meeting_actions`](../../../src/lib/agent/agents/alpha/tools.ts) → [`extractActions()`](../../../src/lib/agent/agents/alpha/extractors/actions.ts)) — single-shot, schema Zod, contexto hidratado em batch.
>
> **Mudanças do v1 → v2**: nova Camada F (telemetria + painel de custos na nav), seção de otimização de tokens com prompt caching e tiering Haiku/Sonnet, métricas de sucesso quantificadas, fase F1.5 inserida antes de F3 (caro), Top-500 substituído por escopo dinâmico, feedback loop de aprovações pros sub-agentes.

## Motivação

Pós-reescrita staging-commit, Vitória opera no modelo certo (conversa contínua, propostas em rascunho, commit atômico). Mas a **qualidade do que ela propõe** ainda é fraca:

1. Não conhece tasks fora da sprint corrente → propõe duplicatas.
2. Não estima FP fundamentadamente → chuta default.
3. Não adapta tom ao PM/facilitador → todo projeto parece igual.
4. Não enxerga grafo de bloqueios → propõe sem ordenar dependências.
5. AC nascem fracos ou ausentes (não há regra dura no prompt).
6. Description não segue padrão SDD nem grounded em código real.
7. **Custo de tokens é invisível** — sub-agentes Haiku queimam $$ sem ninguém ver.

Este plano resolve as 7 dores em **camadas reusáveis** (não 7 features separadas).

## Estado atual (snapshot 2026-05-29)

| Componente | Status |
|------------|--------|
| Modelo staging-commit no banco/API/UI | ✅ executado |
| Vitória prompt rewrite (sem fases) | ✅ executado |
| `dismiss_proposal` tool | ✅ existe (rename pendente em F0) |
| `update_proposed_action` tool | ❌ falta (F0) |
| `loadContext` com `pendingActions` populadas | ❌ ainda traz só count (F0) |
| `transition_phase` removido | ❌ ainda existe (F0) |
| Project Profile rico | ❌ não existe (F1) |
| Telemetria + painel de custos | ❌ não existe (F1.5) |
| Sub-agentes (extract / estimate / enrich) | ❌ não existem (F3-F5) |

## Princípios de design (novos no v2)

1. **Tudo que entra em todo turno deve estar em prompt cache** — system prompt + ProjectProfile resumido + style profile + repoManifest. Marcar com `cache_control` (TTL 5min Anthropic).
2. **Sub-agente caro deve ter cap e budget** — `extract_proposals` só dispara em evento (transcript novo / pedido explícito). Budget por sessão: `maxSubAgentCalls = 20`.
3. **Tiering por sub-agente** — Haiku é default; Sonnet só onde qualidade justifica (B2 enrich SDD).
4. **Cache event-based, não TTL puro** — ProjectProfile invalida em `task done`, `sprint created`, `story refined`. TTL 5min é fallback.
5. **Tudo medido** — toda chamada de modelo passa por `wrapWithUsage()` → `AgentUsage` row. Sem isso, decisão é fé.
6. **Feedback loop** — outcome da proposta (aceita / editada / deletada) volta como sinal pros sub-agentes (telemetria + fine-tune futuro).

## Arquitetura em camadas

### Camada A — Project Knowledge

`buildProjectProfile(projectId, scope)` em `src/lib/agent/agents/vitoria/profile.ts`. Hidrata sob demanda; cacheado em Redis ou Supabase com **invalidação por evento** (TTL 5min fallback).

| Bloco | Conteúdo | Quando |
|-------|----------|--------|
| **Core** (sempre) | US ativas (id/ref/title/persona/status), Members do squad (id/name/role/fpCapacity/fpPlanned), Sprints próximas (next 3) | `loadContext` todo turno |
| **Sprint scope** | Tasks da sprint atual + próxima (ref/title/status/scope/complexity/FP/type/assignees/AC count) + grafo de bloqueios (1 hop) | `loadContext` todo turno |
| **Project scope** | Tasks ativas do projeto inteiro (sem deps detalhadas) — paginado em chunks de 100 com cursor | Tool `list_project_tasks(filter)` sob demanda |
| **Full profile** | Tudo acima + description preview de cada task + AC | Passado pros sub-agentes B1/B2 quando rodam |

**Decisão**: ❌ "Top 500 tasks" (v1) → ✅ escopo dinâmico. Sprint scope cabe em ~3-5k tokens. Project scope é tool call separada.

**Cache**:
- Redis key: `vitoria:profile:{projectId}:{block}:{versionHash}`
- Invalidação por trigger Postgres + canal `pg_notify('project_changed', projectId)` consumido por worker que invalida a key.
- Fallback: TTL 5min.

### Camada B — Sub-agentes

Três sub-agentes em `src/lib/agent/agents/vitoria/extractors/`. Padrão idêntico ao Alpha — `generateObject` + schema Zod + prompt PT-BR com regras duras.

| Sub-agente | Modelo default | Justificativa |
|-----------|----------------|---------------|
| B1 `extractPlanningProposals` | **Haiku 4.5** | Classificação + extração estruturada, padrão. |
| B2 `enrichTaskProposal` | **Sonnet 4.6** | SDD com grounding em repo + AC observáveis exige raciocínio. Vale o custo. |
| B3 `estimateTask` | **Haiku 4.5** | Padrão de matching contra exemplares. |

**Reavaliar** com dados reais (após F4.5 telemetria estar online): se B1 errar muito classificação, sobe pra Sonnet.

#### B1. `extractPlanningProposals`

**Entrada**: transcripts linkados + `ProjectProfile` (sprint + project scope) + style profile do facilitador (camada C2).

**Saída**:
```ts
{
  creates: [{
    title, draftDescription, acceptanceCriteria[],
    suggestedDependencies: [{ taskRef, kind: "blocks" | "informs" }],
    suggestedAssignee, scope, complexity,
    sourceQuote, reasoning, confidence
  }],
  updates: [{ taskRef, patch, reason, sourceQuote }],
  moves: [{ taskRef, targetSprintRef, reason }],
  deletes: [{ taskRef, reason }],
  signals: [{
    kind: "capacity_risk" | "scope_creep" | "blocker" | "dependency",
    content, sourceQuote
  }],
  skipped: [{ description, reason }]
}
```

Vitória orquestra: recebe → executa `propose_task_action` por item em paralelo + `add_context_note` pros signals.

**Regra dura no prompt** (espelhando Alpha): "ao linkar transcript novo, sempre chama `extract_proposals` antes de propor manualmente". Sem essa regra, ela ignora a tool.

#### B2. `enrichTaskProposal`

**Entrada**: 1 proposta `create` (rascunho) + `ProjectProfile` completo + style profile + `repoManifest`.

**Saída**: payload final com:
- `description` no **padrão SDD completo** (Objetivo / Contexto / Estado atual / O que criar — com caminhos do `repoManifest` / Constraints / Convenções) — ver [`docs/task-gen/01-task-generation-rules.md §8`](../../task-gen/01-task-generation-rules.md)
- AC refinados (mínimo 3, testáveis, observáveis)
- Dependências confirmadas (cita REFs do grafo, não inventa)
- Estimativa final (chama B3 internamente OU recebe estimativa pré-computada)

Chamado **sob demanda** via chat: PM diz "detalha a VLD-105" → Vitória chama `enrich_proposal(actionId)`. Default das `create` é leve (B1 já gera draftDescription + AC mínimos).

#### B3. `estimateTask`

**Entrada**: `{ title, description, type }` + **top 30 tasks completas similares** do projeto (mesmo type, ordenadas por similaridade de scope/complexity) + matriz FP do projeto.

**Saída**: `{ scope, complexity, fp, confidence, exemplars: [{ref, title, fp}], reasoning }`.

Usado por B1 (estimativa rápida nos creates) e B2 (estimativa refinada no enrich).

### Camada C — Aprendizado

#### C1. `ProjectFpMatrix` (per-projeto)

Hoje [`FpMatrix`](../../../src/lib/function-points.ts) é por agente. Projetos têm perfis muito diferentes — IA/frontend/infra estimam diferente.

**Decisão default**: **nova tabela `ProjectFpMatrix`** (não reusar tabela global do Alpha).
```sql
CREATE TABLE "ProjectFpMatrix" (
  "projectId" uuid PRIMARY KEY REFERENCES "Project"(id) ON DELETE CASCADE,
  value jsonb NOT NULL,           -- record<type, record<scope, record<complexity, number>>>
  "computedAt" timestamptz NOT NULL DEFAULT now(),
  "sampleSize" int NOT NULL,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
```

**Recálculo** (v2 muda de cron pra event-based):
- Trigger Postgres em `Task` UPDATE WHEN `status` muda pra `'done'` → enfileira `recompute_project_fp_matrix(projectId)` via `pg_notify`.
- Worker debounce 30s (evita recálculo a cada task).
- Cron diário 03:00 UTC como safety net.
- Pega últimas 90 dias de tasks `done`, agrupa por (type, scope, complexity), median FP.
- Fallback: matriz global do Alpha se `sampleSize < 10`.

#### C2. Style profile do facilitador

Sem tabela nova. Função `loadAuthorStyle(memberId)` em runtime, **cacheada 24h** em Redis (muda devagar):

1. Busca últimas 20 tasks criadas por esse member (`Task.createdById`)
2. Calcula heurísticos: `{ avgDescriptionLength, usesH2Sections, snippetStyle, tone }`
3. Pega **3 exemplares completos** (ref + title + description) — Haiku copia estilo bem de poucos exemplos

Injetado em B2 como bloco "estilo do autor para imitar".

#### C3. Outcome feedback (novo v2)

Toda decisão do PM sobre proposta vira sinal:

```sql
CREATE TABLE "AgentProposalOutcome" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "proposalId" uuid REFERENCES "MeetingTaskAction"(id) ON DELETE CASCADE,
  "extractorRun" text,                 -- ex 'extract_proposals:<runId>'
  decision text NOT NULL,              -- 'accepted' | 'edited' | 'deleted' | 'expired'
  "editsJson" jsonb,                   -- diff antes/depois quando edited
  "fpError" int,                       -- |fpEstimated - fpReal| pra estimate
  "decidedAt" timestamptz NOT NULL DEFAULT now()
);
```

Capturado em `MeetingTaskActionExecutor` (commit) + nos endpoints de `update_proposed_action` / `delete_proposed_action`. Usado em telemetria + futuro fine-tune.

### Camada D — Tools da Vitória

| Tool | Tipo | Modelo | Propósito | Status |
|------|------|--------|-----------|--------|
| `propose_task_action` | mutação | — | Schema discriminado (Zod union: create/update/move/delete). AC obrigatório em create. | refatorar em F2 |
| `update_proposed_action` | mutação | — | Edita payload/AC/reasoning de pending. | criar em F0 |
| `delete_proposed_action` | mutação | — | Rename de `dismiss_proposal`. | renomear em F0 |
| `extract_proposals` | sub-agente | Haiku | Wrapper B1. Cap: 1 por transcript novo OU pedido explícito. | criar em F3 |
| `enrich_proposal(actionId)` | sub-agente | Sonnet | Wrapper B2. Aplica SDD + AC refinados. | criar em F5 |
| `estimate_task` | sub-agente | Haiku | Wrapper B3. Cita FP exemplares no reasoning. | criar em F4 |
| `list_project_sprints` | leitura | — | IDs/names das 3 próximas sprints. | criar em F1 |
| `list_project_tasks(filter)` | leitura | — | Project-wide busca paginada (substitui Top-500 sempre quente). | criar em F1 |
| `get_sprint_capacity` | leitura | — | FP planejado vs capacity dos members. | criar em F1 |
| `get_task_detail(ref)` | leitura | — | 1 task com AC + assignees + deps + iterações. | criar em F1 |
| `get_dependency_graph(sprintId)` | leitura | — | Grafo bloqueia/depende da sprint. | criar em F1 |
| `check_repo_manifest_freshness` | leitura | — | Avisa PM se manifest > 30d. | criar em F5 |
| `add_context_note` | mutação | — | Mantém. | ok |
| `read_transcript_content` | leitura | — | Mantém. | ok |
| `transition_phase` | — | — | Remover. | remover em F0 |

**Validação de schema (decisão v2)**: erros do Zod em `propose_task_action` **devem voltar pro modelo** como mensagem estruturada (`"AC obrigatório em create. Você passou 0 AC. Mínimo: 3."`). Sem isso, vira loop de retry silencioso.

### Camada E — Repo awareness (SDD com fundamento)

| Opção | Como | Custo | Profundidade | Quando |
|-------|------|-------|--------------|--------|
| E1 | Nova coluna `Project.repoManifest text` + `repoManifestUpdatedAt timestamptz`. PM cola manual. | trivial | rasa | **default** — entra em F5 |
| E2 | Cron diário gera manifest do repo: `{fileTree, agentsMd, packageScripts, keyDirs}`. | médio | média | backlog opcional |

E1 + freshness check (`check_repo_manifest_freshness` tool) é o suficiente. E2 só se manutenção manual virar fardo.

### Camada F — Telemetria & Cost Control (novo v2)

Transversal a **todos os agentes** (Vitória, Alpha, futuros). Não é Vitória-específico, mas o consumo dela justifica abrir agora.

#### F.1 Schema

```sql
CREATE TABLE "AgentUsage" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agentSlug" text NOT NULL,             -- 'vitoria' | 'alpha' | ...
  "sessionId" uuid,                       -- ChatThread.id
  "projectId" uuid REFERENCES "Project"(id) ON DELETE SET NULL,
  "userId" uuid REFERENCES "Member"(id),
  model text NOT NULL,                    -- 'claude-haiku-4-5' | 'claude-sonnet-4-6' | ...
  "callKind" text NOT NULL,               -- 'turn' | 'extract' | 'enrich' | 'estimate'
  "inputTokens" int NOT NULL,
  "cachedInputTokens" int DEFAULT 0,
  "cacheCreationTokens" int DEFAULT 0,
  "outputTokens" int NOT NULL,
  "costUsd" numeric(10,6) NOT NULL,
  "latencyMs" int,
  metadata jsonb,                         -- ex {"proposalCount": 5, "transcriptIds": [...]}
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON "AgentUsage" ("projectId", "createdAt" DESC);
CREATE INDEX ON "AgentUsage" ("sessionId");
CREATE INDEX ON "AgentUsage" ("agentSlug", "createdAt" DESC);
```

RLS: `is_manager()` lê tudo; member lê só do próprio projeto via `ProjectAccess`.

#### F.2 Captura — wrapper único

`src/lib/agent/usage.ts`:
```ts
export async function wrapWithUsage<T>(
  ctx: { agentSlug: string; sessionId?: string; projectId?: string; userId?: string; callKind: string; metadata?: unknown },
  call: () => Promise<{ result: T; usage: TokenUsage; model: string }>,
): Promise<T>
```

**Toda** chamada de modelo (turno principal + B1 + B2 + B3) passa por aqui. Pricing table em `src/lib/agent/pricing.ts` (Haiku/Sonnet/Opus 4.x). Insert na `AgentUsage` é fire-and-forget (não bloqueia resposta).

#### F.3 Budget por sessão

`src/lib/agent/budget.ts`:
- Tracker in-memory durante turno: `{ subAgentCalls, costUsd }`.
- Cap default: `maxSubAgentCalls = 20`, `maxCostUsdPerSession = 2.00`.
- Atingiu? Tools sub-agente devolvem erro estruturado pro modelo: `"Budget atingido (20 calls / $2.00). Continue com tools de leitura ou peça aprovação do PM pra elevar."`
- Reset por sessão (não por turno).

#### F.4 UI — Painel global

Rota nova `/admin/agent-usage` (gate `is_manager`):
- Cards: custo 24h / 7d / 30d, total por agente, # de sessions
- Gráfico: custo por dia (últimos 30) stack por agente
- Tabela: top 20 sessions caras (link pro ChatThread)
- Filtros: agente, projeto, callKind, date range

Item na nav `Sidebar` ("Custos de agentes") com ícone `Coins`, abaixo de "Admin". Visível só pra `access_level in (admin, manager)`.

#### F.5 UI — Per-session

Dentro do `PlanningSheet` (e futuros `RitualSheet`):
- Badge discreto no header: `💸 $0.12 · 24 calls` (atualiza após cada turno via revalidate)
- Click → drawer com timeline de calls (callKind, model, tokens in/out, cost, latency)
- Pra `access_level < manager`: badge oculto, só interno

#### F.6 Cost guardrails

- Alert quando session passa 80% do budget → toast pro PM ("Sessão custou $1.60 de $2.00, considere finalizar")
- Daily digest interno (email/slack opcional): top 5 sessions caras do dia

## Otimização de tokens — estratégia explícita (novo v2)

### 1. Prompt caching (Anthropic `cache_control`)

Marcadores estáveis ordenados do menos pro mais volátil:

| Bloco | Cache TTL | Quando muda |
|-------|-----------|-------------|
| System prompt Vitória | 5min (sempre cacheado) | só em deploy de novo prompt |
| `ProjectProfile.core` (US ativas + members + sprints) | 5min | task done / sprint criada / story refined → invalida |
| `ProjectProfile.sprintScope` | 5min | task da sprint muda |
| Style profile (3 exemplares + heurísticos) | 24h | tasks novas do member |
| `repoManifest` | até update manual | PM edita campo |
| Mensagens da conversa | não cacheia | volátil |

Implementação: blocks de system prompt com `cache_control: { type: "ephemeral" }`. Métrica `cachedInputTokens / inputTokens` no painel.

### 2. Tiering de modelo por sub-agente

Ver tabela em Camada B. Default Haiku; Sonnet só onde provado necessário. Revalidar após 30 dias com dados reais (% aceite, fpError).

### 3. Budget por sessão

Ver F.3 acima. Cap duro + erro estruturado pro modelo entender.

### 4. Sub-agentes opt-in

`extract_proposals` só dispara em:
- (a) PM linkou transcript novo desde a última extração, OU
- (b) PM pediu explicitamente ("extrai propostas dessa transcript")

`enrich_proposal` sempre opt-in via chat ("detalha a X"). Default das `create` é leve.

### 5. Escopo dinâmico de profile

Sprint scope no turno (~3-5k tokens). Project scope via `list_project_tasks(filter)` paginado. Full profile (com descriptions) só pros sub-agentes.

### 6. Estimativa de custo (baseline)

| Cenário | Modelo | Tokens in / out | Cache hit | Custo |
|---------|--------|-----------------|-----------|-------|
| Turno simples (sem sub-agente) | Sonnet 4.6 | 8k / 500 | 80% | ~$0.005 |
| Turno + `estimate_task` | Sonnet + Haiku | 8k+15k / 500+300 | 80% | ~$0.01 |
| Turno + `extract_proposals` (1 transcript) | Sonnet + Haiku | 8k+30k / 500+2k | 80% | ~$0.03 |
| Planning completo (3 transcripts, 5 enriches) | Sonnet + Sonnet | ~150k input total | 75% | ~$0.30 |

Cap `$2.00/session` deixa folga grande mesmo em planning pesado. Painel valida no real.

## Métricas de sucesso (novo v2)

"Útil de verdade" precisa de número. Definidos antes de F3:

| Métrica | Como medir | Meta inicial |
|---------|------------|--------------|
| **% propostas aceitas** | `AgentProposalOutcome.decision='accepted' / total` | ≥ 60% |
| **# edições no payload** | media de campos editados antes de aceitar | ≤ 2 |
| **FP error médio** | `|fpEstimated - fpReal|` quando task vira `done` | ≤ 2 FP |
| **Cache hit ratio** | `cachedInputTokens / inputTokens` | ≥ 70% |
| **Custo médio por planning** | `sum(costUsd) per sessionId` | ≤ $0.50 |
| **% de plannings com extract chamado** | sessions com `callKind='extract'` ≥ 1 | ≥ 80% (quando há transcript) |

Painel F.4 mostra essas métricas com filtro por agente. Sem hit nas metas após 30 dias → revisita modelo/prompt/cap.

## Schema deltas (v2)

| Mudança | Razão | Risco | Fase |
|---------|-------|-------|------|
| `AgentUsage` table | F.1 telemetria | nenhum | F1.5 |
| `AgentProposalOutcome` table | C3 feedback loop | nenhum | F1.5 |
| `Project.repoManifest text` + `repoManifestUpdatedAt timestamptz` | E1 | nenhum | F5 |
| `ProjectFpMatrix` table | C1 | baixo | F4 |
| Trigger `Task.status='done'` → `pg_notify` | C1 recompute | baixo | F4 |
| ~~`TaskDependency`~~ | já existe | — | — |
| ~~`AcceptanceCriterion`~~ | já existe | — | — |

Total: 3 tabelas + 2 colunas + 1 trigger. Tudo aditivo.

## Fases de implementação (v2)

Ordem reorganizada: F1.5 entra **antes** de F3 — telemetria precede chamadas caras.

### F0 — Fechar gap do `staging-rewrite-plan.md` (~45min)

| Arquivo | Mudança |
|---------|---------|
| `src/lib/agent/agents/vitoria/tools.ts` | Remove `transition_phase`. Rename `dismiss_proposal` → `delete_proposed_action`. Adiciona `update_proposed_action` (edita payload/aiReasoning/targetSprintId/aiConfidence). |
| `src/lib/agent/agents/vitoria/index.ts` (`loadContext`) | Substitui `pendingActionCount: int` por `pendingActions: Array<{id, type, taskId, payload, aiReasoning, aiConfidence}>`. Adiciona `status: "open" \| "closed"`. |
| `src/lib/agent/agents/vitoria/prompt.ts` | Bloco volátil lista propostas atuais. Documenta `delete_proposed_action` + `update_proposed_action`. |

**Smoke**: PM pede "remove a proposta da VLD-105" → `delete_proposed_action` chamada com ID correto.

### F1 — Project Profile + tools de leitura (~3h)

| Arquivo | Mudança |
|---------|---------|
| `src/lib/agent/agents/vitoria/profile.ts` (NOVO) | `buildProjectProfile(projectId, scope)` retorna blocos da camada A. Cache Redis + invalidação por evento. |
| `src/lib/agent/cache/profile-cache.ts` (NOVO) | Wrapper Redis com fallback TTL + listener de `pg_notify('project_changed')`. |
| `src/lib/agent/agents/vitoria/index.ts` (`loadContext`) | Hidrata core + sprintScope. Marca blocks com `cache_control`. |
| `src/lib/agent/agents/vitoria/tools.ts` | Adiciona `list_project_sprints`, `list_project_tasks`, `get_sprint_capacity`, `get_task_detail`, `get_dependency_graph`. |
| `src/lib/agent/agents/vitoria/prompt.ts` | Bloco volátil ganha "Sprints próximas" + "Bloqueios na sprint atual". Regra: "antes de propor `move`, use `list_project_sprints`". |
| `supabase/migrations/<date>_project_changed_notify.sql` | Triggers em `Task`/`UserStory`/`Sprint` que disparam `pg_notify('project_changed', projectId)`. |

**Smoke**: PM pergunta "que tasks estão bloqueadas?" — Vitória chama `get_dependency_graph` e cita REFs corretos.

### F1.5 — Telemetria + Painel (~4h) ⭐ novo no v2

| Arquivo | Mudança |
|---------|---------|
| `supabase/migrations/<date>_agent_usage.sql` | Tabelas `AgentUsage` + `AgentProposalOutcome` + RLS. |
| `src/lib/agent/usage.ts` (NOVO) | `wrapWithUsage()` + pricing table + insert fire-and-forget. |
| `src/lib/agent/budget.ts` (NOVO) | Tracker per-session, cap + erro estruturado. |
| `src/lib/agent/agents/vitoria/index.ts` | Turno principal envolto em `wrapWithUsage({callKind: 'turn'})`. |
| `src/lib/agent/agents/alpha/extractors/actions.ts` | (Bonus) Envolve `extractActions` em `wrapWithUsage` — Alpha também ganha medição. |
| `src/lib/meetings/task-action-executor.ts` | Insere `AgentProposalOutcome` ao commitar/dismissar proposta. |
| `src/app/(dashboard)/admin/agent-usage/page.tsx` (NOVO) | Painel global: cards + gráfico + tabela top sessions. |
| `src/components/admin/agent-usage-table.tsx` (NOVO) | Tabela com filtros. |
| `src/components/planning/planning-cost-badge.tsx` (NOVO) | Badge `💸 $X · N calls` no `PlanningSheet`. Click → drawer timeline. |
| `src/components/layout/sidebar.tsx` | Item "Custos de agentes" gate `is_manager`. |

**Smoke**: rodar 1 planning completo → painel mostra todas as calls do turno principal + sub-agentes (ainda 0 sub-agentes nesta fase, então só `callKind='turn'`). Cache hit ratio aparece. Badge no sheet bate com soma na tabela.

### F2 — `propose_task_action` discriminado (~1.5h)

| Arquivo | Mudança |
|---------|---------|
| `src/lib/agent/agents/vitoria/tools.ts` | Discriminated union: `create | update | move | delete`. `create` exige `acceptanceCriteria.length >= 1`, etc. Erros do Zod viram mensagem estruturada de volta pro modelo. |
| `src/lib/agent/agents/vitoria/prompt.ts` | Regra dura: "em `create`, sempre ≥3 AC testáveis. Se não conseguir, `aiConfidence < 0.5`." |

**Smoke**: PM pede "cria task de login social". Vitória gera ≥3 AC observáveis. Schema rejeita create sem AC com erro legível.

### F3 — `extract_planning_proposals` (B1) (~5h)

Recalibrado: realista 5h (v1 dizia 3h).

| Arquivo | Mudança |
|---------|---------|
| `src/lib/agent/agents/vitoria/extractors/proposals.ts` (NOVO) | `extractPlanningProposals(input)` — espelha `extractActions`. Schema Zod completo. Envolto em `wrapWithUsage({callKind: 'extract'})`. |
| `src/lib/agent/agents/vitoria/tools.ts` | Adiciona `extract_proposals`. Hidrata profile completo (full) + transcripts. Checa budget antes de chamar. |
| `src/lib/agent/agents/vitoria/prompt.ts` | Regra dura: "Ao ver transcript novo no contexto, SEMPRE chama `extract_proposals` antes de propor manualmente. Não duplique trabalho." |

**Smoke**: linkar transcript de daily em planning. Vitória chama `extract_proposals` → 5 creates + 2 updates + 1 signal. Executa 7 `propose_task_action` em paralelo + 1 `add_context_note`. Cada proposta tem `sourceQuote`. Painel mostra 1 row `callKind='extract'` com custo + tokens.

### F4 — `estimate_task` (B3) + `ProjectFpMatrix` (~3h)

| Arquivo | Mudança |
|---------|---------|
| `supabase/migrations/<date>_project_fp_matrix.sql` | Tabela + RLS + função `recompute_project_fp_matrix(projectId)`. |
| `supabase/migrations/<date>_project_fp_matrix_trigger.sql` | Trigger em `Task` UPDATE WHEN `status='done'` → `pg_notify('fp_matrix_recompute', projectId)`. Worker debounce 30s. Cron diário 03:00 UTC como safety. |
| `src/lib/agent/agents/vitoria/extractors/estimate.ts` (NOVO) | `estimateTask(input)` — Haiku via `generateObject`. Envolto em `wrapWithUsage({callKind: 'estimate'})`. |
| `src/lib/agent/agents/vitoria/tools.ts` | Adiciona `estimate_task`. Embute resultado no `aiReasoning`. |
| `src/lib/function-points.ts` | `loadProjectFpMatrix(projectId)` com fallback global quando `sampleSize < 10`. |
| `src/workers/fp-matrix-recompute.ts` (NOVO) | Listener `pg_notify('fp_matrix_recompute')` com debounce. |

**Smoke**: nova proposta. Vitória chama `estimate_task` → cita 3 exemplares ("similar à TASK-042 que foi 5 FP"). FP bate com matriz do projeto, não default. `AgentProposalOutcome.fpError` populado quando task vira done.

### F5 — `enrich_task_proposal` (B2) + style + manifest (~5h)

Recalibrado: realista 5h (v1 dizia 3h).

| Arquivo | Mudança |
|---------|---------|
| `supabase/migrations/<date>_project_repo_manifest.sql` | `ALTER TABLE "Project" ADD COLUMN "repoManifest" text, "repoManifestUpdatedAt" timestamptz`. |
| `src/lib/agent/agents/vitoria/style.ts` (NOVO) | `loadAuthorStyle(memberId)` — heurísticos + 3 exemplares. Cache Redis 24h. |
| `src/lib/agent/agents/vitoria/extractors/enrich.ts` (NOVO) | `enrichTaskProposal(input)` — **Sonnet 4.6** via `generateObject`. Envolto em `wrapWithUsage({callKind: 'enrich'})`. |
| `src/lib/agent/agents/vitoria/tools.ts` | Adiciona `enrich_proposal(actionId)` + `check_repo_manifest_freshness`. |
| `src/lib/agent/agents/vitoria/prompt.ts` | Documenta enrich opt-in + freshness check no início do planning. |
| `src/components/planning/proposal-card.tsx` | Botão "✨ Detalhar com Vitória" pra `create` pending. |
| Settings UI | Campo de texto pra editar `Project.repoManifest` (com indicador de freshness). |

**Smoke**: PM diz "detalha a VLD-107". Vitória chama `enrich_proposal`. Description final tem H2 sections, cita 2-3 paths do `repoManifest`, AC observáveis (mín 5 em scope=medium), tom imita exemplares.

## Roadmap visual

```
F0 (0.75h) → F1 (3h) → F1.5 (4h) ⭐ → F2 (1.5h) → F3 (5h) → F4 (3h) → F5 (5h)
                          │
                          └─ painel + telemetria ativa ANTES das chamadas caras
```

**Total realista**: ~22h (v1 dizia 11h — irrealista; F3 e F5 individualmente passam 3h).

## Decisões e defaults baked-in (v2)

| # | Decisão | Default escolhido | Onde revisitar |
|---|---------|-------------------|----------------|
| 1 | FpMatrix per-projeto vs global | **Nova tabela `ProjectFpMatrix`** | F4 |
| 2 | Style profile: exemplares vs fingerprint | **3 exemplares completos** + heurísticos | F5 |
| 3 | Cap de sub-agentes | **Opt-in** + budget `$2.00/session` + `20 calls/session` | F3 |
| 4 | Enrich em create | **Opt-in via chat**, default leve | F5 |
| 5 | Repo awareness | **E1 (manifest manual)** + freshness check | F5 |
| 6 | **Modelo dos sub-agentes** | **B1 Haiku / B2 Sonnet / B3 Haiku** | revisitar após 30d com painel |
| 7 | **Cache strategy** | **Prompt caching Anthropic + Redis event-based + TTL fallback** | F1 |
| 8 | **Telemetria** | **Tabela `AgentUsage` + wrapper único + painel `/admin/agent-usage`** | F1.5 |
| 9 | **Recompute FpMatrix** | **Trigger + debounce 30s** (não cron semanal) | F4 |
| 10 | **Project scope** | **Sprint+next via `loadContext`; project-wide via tool paginada** | F1 |

## Riscos (v2)

1. **Custo de tokens em F3.** Painel F.4 + budget per-session mitigam. Cap `$2.00` deixa folga.
2. **Drift entre prompt e tools.** Sempre que adicionar tool nova, atualizar prompt **junto**.
3. **`repoManifest` desatualizado.** Mitigação: `check_repo_manifest_freshness` tool + warning na UI quando > 30 dias. E2 fica como backlog se manutenção manual virar fardo.
4. **`ProjectFpMatrix` sample pequeno.** Fallback global quando `sampleSize < 10`. Threshold calibrável via painel.
5. **Style profile vazio (facilitador novo).** `loadAuthorStyle` retorna < 3 exemplares → enricher genérico. OK pra MVP.
6. **Cache invalidation race.** Trigger `pg_notify` pode chegar depois de turno já em andamento → turno usa profile levemente stale. Aceitável (5min TTL é safety).
7. **Insert de telemetria fire-and-forget perde rows.** Aceitável pra primeiro mês; se taxa de perda > 5%, mover pra queue (Inngest/Trigger.dev).
8. **Sonnet em B2 dobra custo do enrich.** Painel mostra impacto real após 30 dias; cair pra Haiku se qualidade não justifica.

## Testes manuais (smoke geral pós-F5)

Numa planning real:

1. PM cria planning, linka transcript de daily. Vitória chama `extract_proposals`. Resumo "4 creates, 1 update, 2 signals". Cards inline na UI. **Badge `$0.04 · 3 calls` aparece.**
2. PM clica num create, sheet abre com title + 3 AC + draft. Grounded em transcript.
3. PM diz "detalha essa". Vitória chama `enrich_proposal`. Sheet atualiza com description SDD, paths do repo, AC refinados, assignee sugerido. **Badge sobe pra `$0.18`.**
4. PM diz "qual relação com TASK-042?". Vitória chama `get_task_detail` + `get_dependency_graph`.
5. PM diz "estima task X". Vitória chama `estimate_task` → 3 exemplares.
6. PM diz "não, essa não". `delete_proposed_action`. **`AgentProposalOutcome.decision='deleted'` row criada.**
7. PM diz "muda prioridade pra alta". `update_proposed_action`.
8. PM clica "Concluir planning". Aplica em cascata. **Painel `/admin/agent-usage` mostra session com custo total + breakdown por callKind.**
9. Após 7 dias com tasks done, voltar e ver `ProjectFpMatrix` populada. `estimate_task` cita projeto, não global.

## Dependências externas

- F1 depende de Redis disponível (ou fallback in-memory aceitável pra dev).
- F1.5 depende só de Postgres + Next API routes (sem deps externas).
- F4 depende de `pg_cron` + worker de notifications (já existe pattern em projeto?). Sem worker, fica só com cron diário.
- F5 depende de `Project.repoManifest` preenchido em ≥1 projeto pra smoke real.

## Fora de escopo

- **Vitor MCP / Volund v2 / E3** — adiar até harness maduro.
- **RAG semântico sobre código** — pesado, depois de E1+E2.
- **Fine-tune com `AgentProposalOutcome`** — coletar 3 meses antes.
- **UI nova além do painel** — surface continua `MeetingTaskActionSheet` + `SprintTaskList` + badge novo.
- **Migração de plannings antigas** — `ProjectFpMatrix` é forward-only.
- **Alerting fora do app** (Slack/email) — backlog se daily digest virar dor.
