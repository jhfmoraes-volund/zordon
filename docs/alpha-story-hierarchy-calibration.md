# Alpha — Story Hierarchy Calibration & Sprint Ribbon Integration

**Status:** plano de execução · Wave 6 (única wave grande pendente do roadmap story-hierarchy)
**Última atualização:** 2026-05-01
**Audience:** agente (humano ou IA) implementando integração do Alpha com Module/UserStory/Task/AC + caprichando no ribbon Alpha pill.

**Documentos relacionados:**
- [story-hierarchy-execution-runbook.md](./story-hierarchy-execution-runbook.md) — status global das waves
- [story-hierarchy-plan.md](./story-hierarchy-plan.md) — schema-alvo V2
- [story-hierarchy-alpha-integration.md](./story-hierarchy-alpha-integration.md) — base conceitual (output schema, RPC, prompt rules)
- [alpha-calibration-plan.md](./alpha-calibration-plan.md) — calibração geral do Alpha (Regra 0, drafts, virtualização) — **complementar, não duplicar**
- [alpha-global-header-plan.md](./alpha-global-header-plan.md) — pattern de header global do Alpha

**Princípio:** este doc cobre o **específico da hierarquia + ribbon**. Calibragem geral (Regra 0, drafts batch, virtualização) está no `alpha-calibration-plan.md`. Não duplicar.

---

## 0. Contexto

### 0.1 Por que existe

A hierarquia Module → UserStory → Task → AC entrou em produção (waves 1–5 + cleanup A–D feitos). Agora falta **fazer o Alpha respeitar a taxonomia**:

- Hoje Alpha cria task isolada (`userStoryId: null`) via `create_task` tool
- Não conhece `Module`, `Persona`, `UserStory`, `AcceptanceCriterion`
- Não classifica, não anti-duplica, não propõe módulo novo
- Sprint Ribbon mostra alertas heurísticos locais (`sprintAlerts` em `helpers.ts`), mas **a pill "Alpha" é só ornamento** — não consulta o agente

Resultado: novas tasks geradas pelo Alpha continuam órfãs como antes do backfill, e a oportunidade de Alpha agir como **PM-junior** (sugerir, validar, alertar com contexto rico) está sub-aproveitada.

### 0.2 O que **não** faz parte deste plano

- Calibragem genérica do Alpha (Regra 0, output volumoso, drafts) — `alpha-calibration-plan.md`
- Drop de `Task.type/scope` — depende de decisão sobre FP matrix, fora de escopo
- Refactor do `task-sheet.tsx` legacy do `/design-sessions/[id]/review` — fora de escopo

---

## 1. Audit do estado atual (snapshot 2026-05-01)

### 1.1 Schema/RPCs existentes

| RPC | Existe? | Onde |
|---|---|---|
| `next_user_story_reference(projectId)` | ✅ | `20260430_user_story.sql` |
| `next_task_reference()` | ✅ | usado pelos endpoints atuais |
| `seed_project_personas()` | ✅ | trigger em Project insert |
| `sync_task_done_at` | ✅ | trigger Task |
| **`create_user_story_with_tasks`** | ❌ | **CRIAR (Onda 1)** |
| **`suggest_fp(scope, complexity)`** | ❌ | **CRIAR (Onda 1)** |

### 1.2 Alpha código

| Arquivo | Conhece hierarquia? |
|---|---|
| `src/lib/agent/agents/alpha/context.ts` | ❌ — carrega project/members/sprints, não modules/personas/stories |
| `src/lib/agent/agents/alpha/prompt.ts` | ❌ — zero menção a story/module/persona |
| `src/lib/agent/agents/alpha/tools.ts` | ❌ — 26 tools, **nenhuma** de story/module/persona |
| `src/lib/agent/tools/create-task.ts` | ❌ — cria task draft sem `userStoryId` |
| `src/lib/agent/tools/manage-tasks.ts` | ❌ — atualiza task sem awareness de hierarquia |

### 1.3 Sprint Ribbon

`src/components/sprint/sprint-ribbon/`:

- `sprint-ribbon.tsx` — barra sticky com 5 pills: Identity • Pulse • Capacity • **Alpha (alerts)** • Burndown
- `ribbon-alerts-pill.tsx` — pill "Alpha" mostra `count` de alertas
- Source dos alertas: `sprintAlerts(sprint, tasks, capacities, planned)` em `helpers.ts:488` — **heurística local pura** (deploy gap, AC pendente, no-assignee, overcommit). Não chama agente.
- `ribbon-drawer.tsx` — drawer abaixo do ribbon, recebe os alertas e renderiza

**Diagnóstico:** pill chama "Alpha" mas é só lógica determinística. Capricho = realmente conectar ao agente.

---

## 2. Estratégia: 7 Ondas

| Onda | Escopo | Dep | Tempo | Risco |
|---|---|---|---|---|
| **1** | RPC `suggest_fp` + `create_user_story_with_tasks` (SQL) | — | 1h | baixo |
| **2** | Context loader: modules/personas/recentStories no `loadContext` | 1 | 1h | baixo |
| **3** | Output schema Zod + persistência TS (`persistAlphaStories`) | 1, 2 | 1h | baixo |
| **4** | Tools novas: `get_story_overview`, `create_user_story`, `update_story_refinement`, `validate_story_ac`, `propose_module` | 2, 3 | 2h | médio |
| **5** | System prompt: regras de classificação Module/Persona, anti-duplicação, narrativa, AC verificável | 4 | 1h | médio (calibração necessária) |
| **6** | Sprint Ribbon Alpha pill — server-side `getAlphaSuggestions(projectId, sprintId)` + drawer "Sugestões do Alpha" | 4 | 3h | médio |
| **7** | Calibração — 8 cenários (5 do plano original + 3 novos para ribbon) | 5, 6 | 2h | crítico (gate de produção) |

**Sequência crítica:** 1 → 2 → 3 → 4 → 5 (calibração inicial) → 6 (ribbon) → 7 (calibração final).

Ondas 5 e 6 podem rodar em paralelo após Onda 4 estar pronta.

**Total:** ~11h de trabalho técnico + tempo de revisão PM.

---

## 3. Onda 1 — RPC `suggest_fp` + `create_user_story_with_tasks`

**Objetivo:** dar ao Alpha o "ponto de entrega" atomic. Sem isso, persistir hierarquia exige múltiplas chamadas TS (não-atomic, 5 ida/voltas DB).

### 3.1 Migration

**Arquivo:** `supabase/migrations/<YYYYMMDD>_alpha_story_rpc.sql`

```sql
-- 1. suggest_fp: espelha FP_MATRIX_DEFAULT (src/lib/function-points.ts)
CREATE OR REPLACE FUNCTION suggest_fp(p_scope text, p_complexity text)
RETURNS int AS $$
BEGIN
  RETURN CASE p_scope
    WHEN 'micro' THEN
      CASE p_complexity WHEN 'trivial' THEN 3 WHEN 'low' THEN 4 WHEN 'medium' THEN 5 WHEN 'high' THEN 7 ELSE 5 END
    WHEN 'small' THEN
      CASE p_complexity WHEN 'trivial' THEN 4 WHEN 'low' THEN 5 WHEN 'medium' THEN 7 WHEN 'high' THEN 10 ELSE 7 END
    WHEN 'medium' THEN
      CASE p_complexity WHEN 'trivial' THEN 5 WHEN 'low' THEN 7 WHEN 'medium' THEN 10 WHEN 'high' THEN 15 ELSE 10 END
    WHEN 'large' THEN
      CASE p_complexity WHEN 'trivial' THEN 7 WHEN 'low' THEN 10 WHEN 'medium' THEN 15 WHEN 'high' THEN 21 ELSE 15 END
    ELSE 7
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. create_user_story_with_tasks: atomic insert hierarquia completa
-- Conteúdo SQL completo em docs/story-hierarchy-alpha-integration.md §5.1.
-- Ajustes vs doc original:
--   - Drop coluna `area` (já dropada)
--   - Drop `acceptanceCriteria` text do INSERT em Task (coluna dropada)
--   - Validar `personaId` existe e pertence ao projeto antes do INSERT
```

### 3.2 Validação

```sql
-- suggest_fp existe e bate com TS:
SELECT suggest_fp('small', 'medium');  -- deve retornar 7
SELECT suggest_fp('large', 'high');    -- 21

-- create_user_story_with_tasks: smoke test com payload mínimo
SELECT * FROM create_user_story_with_tasks(
  '<projectId>'::uuid,
  '{"moduleId":null,"proposedModuleName":"TEST","personaId":"<id>","title":"Smoke","want":"validar RPC","soThat":null,"acceptanceCriteria":[{"text":"funciona"}],"tasks":[{"title":"task1","type":"feature","scope":"small","complexity":"low","description":null,"acceptanceCriteria":[{"text":"AC1"}]}]}'::jsonb,
  '<memberId>'::uuid,
  true
);

-- Cleanup do smoke:
DELETE FROM "UserStory" WHERE title = 'Smoke';
```

---

## 4. Onda 2 — Context loader: modules/personas/recentStories

**Objetivo:** dar ao Alpha **awareness** da taxonomia do projeto. Sem isso, ele cria taxonomia paralela ou ignora a existente.

### 4.1 Editar `src/lib/agent/agents/alpha/context.ts`

Adicionar ao `buildProjectFocus(projectId)`:

```ts
import {
  getModulesForProject,
  getPersonasForProject,
  getRecentStoriesForProject,
} from "@/lib/dal/story-hierarchy";

const [modules, personas, recentStories] = await Promise.all([
  getModulesForProject(projectId),
  getPersonasForProject(projectId),
  getRecentStoriesForProject(projectId, { limit: 20 }),
]);

const taxonomyBlock = renderTaxonomy({ modules, personas, recentStories });
```

`renderTaxonomy` retorna markdown:

```markdown
## Taxonomia do projeto

### Modules existentes (8)
- LOGIN — fluxos de autenticação
- BILLING — pagamento e assinaturas
- AUDIT_LOG — rastreamento de eventos
- ... (mostrar todos)

### Personas (3)
- cliente: Cliente final, paga e usa o produto
- admin: Operador interno, gerencia conteúdo
- builder: Time de produto, configura

### Histórico recente (últimas 20 stories)
- LOGIN-US-014 [refined]: Magic-link com expiração
- BILLING-US-007 [draft]: Reembolso parcial
- ... (mostrar todos com refinement status)
```

Bloco vai pro `focusBlock` quando route é `kind: "project"`.

### 4.2 Helper novo no DAL

`src/lib/dal/story-hierarchy.ts` adicionar:

```ts
export async function getRecentStoriesForProject(
  projectId: string,
  opts: { limit: number },
): Promise<{ reference: string; title: string; moduleId: string | null; refinementStatus: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("UserStory")
    .select("reference, title, moduleId, refinementStatus")
    .eq("projectId", projectId)
    .order("createdAt", { ascending: false })
    .limit(opts.limit);
  return data ?? [];
}
```

### 4.3 Validação

CLI Alpha em projeto Zordon (que tem 30 stories curadas):
```bash
npx tsx --require ./scripts/_server-only-shim.cjs scripts/alpha-cli.ts \
  --message "lista os modules e stories desse projeto" \
  --current-path "/projects/6f9b7443-547e-418e-b0a5-6f3bb38d762f"
```

Esperado: Alpha cita os 9 modules + 4 personas + algumas stories recentes do contexto. Se inventar, contexto não chegou.

---

## 5. Onda 3 — Output schema Zod + persistência

**Objetivo:** ter o "shape" formal do que Alpha pode produzir + função TS que persiste via RPC.

### 5.1 Schema

`src/lib/agent/agents/alpha/output-schemas.ts` (criar):

Conteúdo completo em [story-hierarchy-alpha-integration.md §3.1](./story-hierarchy-alpha-integration.md#31-schema-completo).

Ajustes pra estado atual (post-cleanup):
- ~~`area`~~ — dropada, **remover do schema**
- `tasks[].acceptanceCriteria` — sempre vai pra tabela `AcceptanceCriterion` (não mais coluna text)

### 5.2 Persistência

`src/lib/agent/agents/alpha/persist-stories.ts` (criar):

Conteúdo em [story-hierarchy-alpha-integration.md §5.2](./story-hierarchy-alpha-integration.md#52-caller-ts).

Diferença: **drop fallback "TS sem RPC"** (§5.3). RPC já estável — usa só essa.

### 5.3 Validação

Unit test (mocked):
```ts
const output = alphaStoryGenerationOutput.parse({
  stories: [{
    moduleId: "<uuid>",
    proposedModuleName: null,
    personaId: "<uuid>",
    title: "Magic-link com expiração",
    want: "receber link que expira em 10 min",
    soThat: "se o link vazar, não fica eternamente válido",
    acceptanceCriteria: [{ text: "Reusar link expirado mostra mensagem clara" }],
    tasks: [/* ... */],
  }],
});
// schema valida sem throw
```

---

## 6. Onda 4 — Tools novas no Alpha

**Objetivo:** dar ferramentas pro Alpha **ler** e **escrever** na hierarquia.

### 6.1 Tools de leitura (sem confirmação)

Adicionar em `src/lib/agent/agents/alpha/tools.ts`:

| Tool | Argumentos | Retorno |
|---|---|---|
| `get_story_overview` | `storyRef?: string` | story + AC + tasks vinculadas + counts |
| `list_stories` | `projectId?` `moduleId?` `refinementStatus?` `limit?` | array sumarizado |
| `list_modules` | `projectId?` | modules do projeto + count de stories |
| `list_personas` | `projectId?` | personas do projeto + count de stories |

Padrão: respeitar `route` — quando há `routeProjectId(route)`, não exigir argumento; usa esse.

### 6.2 Tools de escrita (Regra 0 obrigatória)

| Tool | Argumentos | Comportamento |
|---|---|---|
| `create_user_story` | `projectId` `output: AlphaStoryGenerationOutput` | chama `persistAlphaStories`. Sempre `refinementStatus = 'draft'`. |
| `update_story_refinement` | `storyRef` `status: 'draft'\|'refined'\|'committed'` | atualiza coluna; valida que AC validados se vai pra `committed`. |
| `validate_story_ac` | `storyRef` | seta `acValidatedAt`/`acValidatedBy = currentMember`. Requer member.role >= manager. |
| `propose_module` | `projectId` `name` `description` | INSERT em Module (a partir de uma story aprovada). |
| `link_task_to_story` | `taskRef` `storyRef \| null` | atualiza `userStoryId`. Útil pra tasks órfãs legacy. |

### 6.3 Decisão: drafts batch?

`alpha-calibration-plan.md §3` propõe `draft_task_batch` pra ops em batch. **Replicar pra story?**

Recomendação: **não criar `draft_story_batch` nesta onda.** Stories são output discreto e curto (1–10 por sessão). Alpha deve propor em texto e chamar `create_user_story` direto após confirmação. Se virar gargalo (ex: replanejamento de roadmap), adicionar depois.

### 6.4 Validação

Cenários (rodar via CLI):
- "lista os modules do projeto Zordon" → `list_modules` retorna 9 entries
- "qual o estado da story ZRDN-US-014?" → `get_story_overview` retorna detalhe
- "marca a story X como refined" → propõe → confirmação → `update_story_refinement`

---

## 7. Onda 5 — System prompt: regras de classificação

**Objetivo:** ensinar Alpha a usar a taxonomia certo.

### 7.1 Editar `src/lib/agent/agents/alpha/prompt.ts`

Adicionar seção nova **Hierarquia de produto** (após Regra 0, antes de Roam):

```
## Hierarquia: Module → UserStory → Task → AC

Você opera num modelo de hierarquia. Quando o usuário descreve uma feature ou
demanda, você classifica e propõe — nunca cria taxonomia paralela.

### Regras

1. CLASSIFICAÇÃO DE MÓDULO
   - Você recebe `modules` (lista do projeto, ver Taxonomia no contexto).
   - SEMPRE escolha um module existente se a story cabe num.
   - Se NENHUM module cabe, deixe `moduleId: null` e proponha `proposedModuleName`
     em UPPERCASE_SNAKE (ex: "AUDIT_LOG", "REPORTS").
   - PM aprova o novo module via `propose_module` antes da story virar oficial.

2. PERSONA — você nunca inventa
   - Você recebe `personas` (lista do projeto).
   - Sempre use o id de uma da lista.
   - Se nenhuma persona cabe, **pare e pergunte** — não chute.

3. NARRATIVA
   - `title`: imperativo, curto.
   - `want`: começa com verbo. "receber link que expira"
   - `soThat`: o porquê do negócio. Opcional só se óbvio.
   - Formato final na UI: "Como {persona}, quero {want}, para que {soThat}."

4. ACCEPTANCE CRITERIA
   - Story-level (1–8): comportamento de **negócio** ("usuário consegue X").
   - Task-level (1–10): aceitação **técnica** ("retorna 410 Gone").
   - Sempre verificáveis e específicos. Mau: "implementa endpoint REST".

5. TASKS
   - 1–15 por story, atômicas.
   - `type`: feature/bugfix/refactor/setup/component/seed/management.
   - `scope` × `complexity`: matriz pra estimar FP. FP null = server calcula.

6. ANTI-DUPLICAÇÃO
   - Você recebe `recentStories` (últimas 20).
   - Antes de criar, verifique similar. Se sim, mencione no `reasoning`,
     NÃO crie. Sugira reutilizar/estender.

7. REFINEMENT STATUS
   - Toda story criada por você entra como `draft`.
   - PM marca `refined`. Nunca pular pra `committed` direto.

8. AMBIGUIDADE
   - Input vago ("melhorar dashboard")? **Pergunte antes**, não gere stories vagas.
```

### 7.2 Validação

Re-rodar cenários da Onda 4 + cenários da §10 deste plano (8 cenários de calibração).

---

## 8. Onda 6 — Sprint Ribbon Alpha pill (capricho)

**Objetivo:** transformar a pill "Alpha" do ribbon de **ornamento** em **canal de sugestões reais do agente**.

### 8.1 Estado atual

```tsx
// sprint-ribbon.tsx:84-91
const alerts = useMemo(
  () => sprintAlerts(sprint, tasks, capacities, planned),
  [sprint, tasks, capacities, planned],
);
const severity: "warn" | "info" | "ok" = alerts.some(...) ? "warn" : alerts.length > 0 ? "info" : "ok";

<RibbonAlertsPill count={alerts.length} severity={severity} ... />
```

`sprintAlerts` é determinístico (4 tipos: deploy gap, AC pendente, no-assignee, overcommit).

### 8.2 Estado-alvo

**Manter** alertas heurísticos (cobrem casos óbvios, custo zero) +
**Adicionar** "Sugestões do Alpha" abaixo no drawer:

```
[Alpha pill] → drawer abre com 2 seções:
   Alertas (heurísticos, instantâneos)
     - Deploy pendente
     - 3 tasks done sem AC completo
     - 2 membros acima da alocação
   Sugestões do Alpha (lazy load)
     [⏳ Carregando sugestões...]
     ↓ (após ~2s)
     - Story ZRDN-US-014 está há 5 dias em 'refined' — pronta pra committed?
     - Sprint tem 12 tasks no module SPRINTS, 3 no AGENT — desbalanço.
       Considerar pull de stories do AGENT.
     - Task ZRDN-141 está committed mas Alpha vê escopo amplo demais.
       Sugiro quebrar em 2.
```

### 8.3 Implementação

#### a. API `/api/agents/alpha/suggestions`

`src/app/api/agents/alpha/suggestions/route.ts` (criar):

```ts
GET /api/agents/alpha/suggestions?projectId=X&sprintId=Y
→ {
    suggestions: Array<{
      id: string;
      severity: 'info' | 'warn';
      title: string;
      detail: string;
      action?: { kind: 'open_story' | 'open_task' | 'apply'; ref: string };
    }>,
    cachedAt: string;
  }
```

Implementação server-side: chama Alpha com prompt restrito ("analise sprint X do projeto Y, gere sugestões em formato JSON estruturado, max 5"). Output forçado via `responseFormat: zodSchema`.

**Cache:** resultado guardado em `AgentSuggestionCache` (tabela nova, TTL 5min). Evita rodar Alpha a cada hover de pill.

```sql
CREATE TABLE "AgentSuggestionCache" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId" uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  "sprintId" uuid REFERENCES "Sprint"(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "expiresAt" timestamptz NOT NULL
);
CREATE INDEX "agent_suggestion_lookup" ON "AgentSuggestionCache"("projectId", "sprintId", "expiresAt");
```

#### b. Pill component

`ribbon-alerts-pill.tsx` ganha:
- Lazy fetch quando drawer abre (não no render do ribbon)
- Loading state ("⏳ Alpha analisando...")
- Refresh manual button no drawer (busta cache)

#### c. Drawer

`ribbon-drawer.tsx` ganha 2ª seção "Sugestões do Alpha" após "Alertas". Cada sugestão clicável:
- `open_story` → navega `/projects/X?tab=stories&story=<ref>` (deep-link já existe via Onda B)
- `open_task` → navega `/projects/X?tab=tasks&task=<ref>` (idem)
- `apply` → tools dentro do Alpha (ex: `update_story_refinement`)

### 8.4 Considerações

- **Custo de tokens:** cada análise gasta ~2k input tokens (contexto + sprint state) + ~500 output. Cache 5min reduz drasticamente. Em 50 sprints ativos = $0.50/dia. Aceitável.
- **Latência:** Alpha leva 3–10s pra responder. Drawer abre instantâneo (alertas heurísticos), Alpha aparece após.
- **Privacy:** sugestões podem mencionar nomes de members (overcommit, etc). RLS da rota: só PM/Admin/membro do projeto vê.

### 8.5 Validação

- Abrir um sprint com 15+ tasks → drawer carrega, 3–5 sugestões aparecem em ~5s
- Refresh manual → cache busta, nova análise
- Sem internet/Alpha down → fallback gracioso ("Sugestões do Alpha indisponíveis"), alertas heurísticos continuam

---

## 9. Onda 7 — Calibração

**Objetivo:** validar comportamento end-to-end antes de habilitar pra time real.

### 9.1 Cenários

5 da [story-hierarchy-alpha-integration.md §6.1](./story-hierarchy-alpha-integration.md#61-cenários-de-teste):

| # | Input | Output esperado |
|---|---|---|
| 1 | DS com 1 feature simples ("login com email") | 1 story em `LOGIN`, persona `Builder`, 2-3 tasks |
| 2 | DS com 1 feature complexa ("checkout completo") | 1 story em `BILLING`, 5-8 tasks |
| 3 | DS com módulo novo ("auditoria") | story com `moduleId: null` + `proposedModuleName: "AUDIT_LOG"` |
| 4 | Chat: "como tá o login?" | resposta narrativa, sem stories |
| 5 | DS ambígua ("melhorar dashboard") | Alpha pergunta, não gera |

3 novos pra cobrir Onda 6:

| # | Input | Output esperado |
|---|---|---|
| 6 | Abrir ribbon Alpha pill em sprint com tasks done sem AC | sugestão "valide AC pendente em ZRDN-141, ZRDN-142..." |
| 7 | Sprint com 80% tasks num module só | sugestão "desbalanço — story do module Y poderia entrar" |
| 8 | Story 'refined' há 5+ dias sem virar 'committed' | sugestão "ZRDN-US-014 madura pra committed?" |

### 9.2 Procedimento

Cada cenário rodado **3×** (consistência). Documentar em `docs/alpha-calibration-results.md` na seção `## Story Hierarchy + Ribbon (2026-MM-DD)`.

PM revisa: módulo correto? persona correta? AC verificáveis? sugestões úteis ou ruído?

**Erro > 10% em qualquer cenário = ajustar prompt e rerodar.**

### 9.3 Definition of done

- ✅ 8 cenários passam (≥ 90% acerto em 3 runs cada)
- ✅ `bunx tsc --noEmit` limpo
- ✅ Smoke test em projeto piloto (Zordon) — Alpha gera 3 stories, PM aprova, sugestões do ribbon batem com realidade
- ✅ Cache do ribbon funciona (segunda abertura é instant)
- ✅ Métricas registradas em AgentUsage

---

## 10. Rollout

| Etapa | Quando |
|---|---|
| Onda 1 (RPCs) | Imediato |
| Onda 2 (context) | Imediato após 1 |
| Onda 3 (schema/persist) | Imediato após 2 |
| Onda 4 (tools) | Imediato após 3 |
| Onda 5 (prompt) | Calibração inicial após 4 |
| Onda 6 (ribbon) | Paralelo a 5, dependente só de 4 |
| Onda 7 (calibração) | Gate de produção — só liberar se passar |

**Feature flag:** **não criar.** Alpha respeita Module/Persona/Story sempre que existirem; se um projeto não tem (ainda), Alpha cai no fluxo legacy de criar task isolada. Comportamento progressivo, sem flag.

(Diferente do `useStoryHierarchy` que dropamos — aquela flag era de UI; aqui o agente adapta-se ao estado do projeto.)

---

## 11. Riscos

| Risco | Mitigação |
|---|---|
| Alpha confunde modules quando há sinônimos (ex: AUTH vs LOGIN) | Prompt §1 + recentStories ajudam. Se persistir, adicionar `aliases: string[]` no Module. |
| Sugestões do ribbon viram ruído (PM ignora) | Calibrar limit a 3 sugestões. Adicionar feedback ("útil"/"ignorar") na pill, ajustar prompt. |
| Custo de tokens explode com muitos sprints ativos | Cache 5min é primeira linha. Se ainda alto, throttle por user (1 sugestão/projeto/hora). |
| Story criada com persona errada | Prompt §2 (não inventa) + Zod (`personaId: uuid`) + RPC valida FK. Se passar pelas 3, PM corrige na UI. |
| Alpha gera 10 stories por sessão (overproduction) | Schema `stories.max(10)` + prompt §6 (anti-dup). Se ainda vier muito, cap a 5 no schema. |
| Cache de sugestões fica stale após mudança de sprint | TTL 5min + invalidação manual no DELETE/UPDATE de Sprint/Task (trigger DB). |

---

## 12. Métricas (após 30 dias)

- ≥ 90% das stories geradas com `moduleId` correto (PM não muda)
- ≥ 95% das stories com `personaId` correto
- 0 stories com AC vazio (Zod garante, mas medir mesmo assim)
- ≤ 5% de stories rejeitadas pelo PM
- Tempo médio Design Session → stories `committed`: meta < 2 dias
- **Taxa de "ação" em sugestões do ribbon:** quantas sugestões viraram clique/aplicação. Meta ≥ 30%.

---

## 13. Convenções (recap)

- **Migrations** via `psql "$DIRECT_URL" -f ...`
- **Commits** via `bash scripts/sync-main.sh -m "ZRD-JM-NN: <msg>"`
- **Após migration:** regerar `src/lib/supabase/database.types.ts`
- **Calibragem antes de prod:** sempre 3 runs, sempre PM aprova

---

## 14. Próximo passo concreto

Pra quem pega esse runbook:

1. Ler seções 0–2 (~10min)
2. Executar Onda 1 (migration RPC) — 1h
3. Validar smoke test
4. Onda 2 (context) — 1h
5. CLI test no Zordon antes de seguir
6. Ondas 3 → 4 → 5 sequencial
7. Onda 6 (ribbon) em paralelo após 4
8. Onda 7 (calibração) é gate — não pular
