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

---

## 15. Sprint Planner Mode (Onda 8)

**Status:** plano · não iniciado
**Pré-requisito:** Ondas 1–5 completas (Alpha conhece Module/UserStory/Task/AC e o Vitor já fechou o backlog).
**Audience:** mesmo agente (humano ou IA) que tocar a calibragem.

### 15.0 Quando o modo dispara

Não tem flag, nem botão. **Entra automaticamente** quando o contexto do projeto satisfaz:

- ≥ 10 tasks com `status = 'backlog'` e `userStoryId IS NOT NULL` e `functionPoints IS NOT NULL` (backlog "pronto")
- ≥ 1 `ProjectMember` com `fpAllocation > 0`

Sem isso, Alpha continua no modo normal (chat + tools de leitura/escrita pontuais). Com isso, o context loader injeta o bloco "Capacidade do projeto" e o prompt habilita as regras de §15.5.

### 15.1 Princípio

PM diz "alpha, organiza o backlog" → Alpha:

1. Lê capacidade real (já existe no banco, não inventa).
2. **Pergunta** preferências (não persistidas — vivem só na sessão).
3. **Dimensiona** o projeto: estima quantos sprints precisam, propõe **criar os que faltam**.
4. Propõe alocação: cada task → (sprintId, assigneeId, status='todo').
5. Após confirmação do PM, executa **bulk atomic**.

Preferências de skill/disponibilidade são **conversa de sessão**, não vão pra banco. Se o PM repetir o pedido em outra sessão, repete a pergunta.

### 15.2 Capacity model — recap (já no banco, não criar)

| Camada | Tabela.coluna | Significado |
|---|---|---|
| Global | `Member.fpCapacity` | FP/sprint contratual do builder |
| Projeto | `ProjectMember.fpAllocation` | Quanto desse total vai pra ESTE projeto |
| Sprint | `SprintMember.fpAllocation` | Override por sprint (opcional) |

**Views já existindo (usar):**
- `member_commitment_overview` — capacity / committed / remaining / projectCount por member
- `sprint_member_capacity` — fp_allocation efetiva (COALESCE Sprint→Project) + fp_used + has_sprint_override por (sprint, member)

Assignment é M:N via `TaskAssignment(taskId, memberId)`. Não há `Task.assigneeId`.

### 15.3 Context loader — bloco "Capacidade do projeto"

Em `src/lib/agent/agents/alpha/context.ts`, quando o gate de §15.0 for true, injetar:

```markdown
## Capacidade do projeto (planning mode)

### Builders alocados (4)
- João Moraes (senior fullstack)
  fpCapacity: 500 · committed em outros projetos: 200 · disponível pra ESTE: 150
- Lucas Silva (mid backend)
  fpCapacity: 425 · committed: 0 · alocado neste projeto: 100
- ...

### Sprints existentes
- Sprint 7 (active, 2026-05-04 → 2026-05-10): 38 FP planejado, 12 done
- Sprint 8 (upcoming, 2026-05-11 → 2026-05-17): vazio
- (sem mais sprints criados)

### Backlog pronto pra alocar
- 47 tasks com status=backlog, userStory setado, FP estimado
- Distribuição por module: LOGIN (12) · BILLING (18) · AUDIT (10) · outros (7)
- Total FP: 312
- Capacidade total/sprint disponível: 390 FP (somando os 4 builders)
- Estimativa: ~ceil(312 / 390) = 1 sprint, com folga
  (mas se PM impuser restrições — férias, módulo prioritário —, recalcular)
```

Helper novo no DAL: `getPlanningSnapshot(projectId)` que retorna esse shape estruturado.

### 15.4 Tools novas

#### Leitura

| Tool | Args | Retorno |
|---|---|---|
| `get_project_capacity` | `projectId?` | members[] (com fpCapacity, projectAllocation, remaining) + sprints[] (com fpPlanned/fpCapacityTotal) — lê das views |
| `list_unplanned_tasks` | `projectId?` `moduleId?` `limit?` | tasks `backlog` sem sprintId, com FP / module / story / current assignees |

#### Escrita: `create_sprint` — **já existe** em `tools.ts:491`. Reusar.

#### Escrita nova: `bulk_update_tasks`

```ts
bulk_update_tasks({
  projectId: string,
  updates: Array<{
    taskRef: string,           // ex: "ZRDN-141"
    sprintId?: string | null,  // null = volta pro backlog (sem sprint)
    assigneeIds?: string[],    // M:N — substitui assignments existentes (set replace)
    status?: 'backlog' | 'todo' | 'doing' | 'review' | 'done',
  }>,
  reasoning: string,           // log/auditoria
})
```

**Comportamento:**
- Regra 0 (`alpha-calibration-plan.md`): propõe primeiro como **draft** com tabela em texto, PM confirma, aí executa.
- Validações server-side (no RPC):
  - `taskRef` pertence a `projectId`
  - cada `assigneeId` é `ProjectMember` ativo do `projectId`
  - `sprintId` (se presente) pertence ao `projectId`
- **Atomic:** vira RPC `bulk_update_tasks(p_project_id uuid, p_updates jsonb, p_actor_id uuid)`. Se qualquer item falhar, rollback total — retorna `{ ok: false, errors: [...] }`. PM revê e tenta de novo.
- `assigneeIds` semantics: **set replace**. Vazio `[]` = limpar todos. Ausente = não mexe em assignments.
- Loga em `AgentUsage` com count + reasoning.

**Por que tool única:** PM normalmente seta `(sprint, assignee, status)` de uma vez ("aloca essas 12 no Sprint 8 com Lucas, status todo"). 1 confirmação, 1 transação. Tools separadas geram N confirmações sequenciais e erro parcial é dor.

### 15.5 RPC

`supabase/migrations/<YYYYMMDD>_bulk_update_tasks.sql`:

```sql
CREATE OR REPLACE FUNCTION bulk_update_tasks(
  p_project_id uuid,
  p_updates jsonb,
  p_actor_id uuid
) RETURNS jsonb AS $$
DECLARE
  upd jsonb;
  v_task_id uuid;
  v_assignee_ids uuid[];
  v_results jsonb := '[]'::jsonb;
BEGIN
  FOR upd IN SELECT * FROM jsonb_array_elements(p_updates) LOOP
    -- 1) resolve taskRef → id, valida projectId
    SELECT id INTO v_task_id
    FROM "Task"
    WHERE reference = upd->>'taskRef' AND "projectId" = p_project_id;
    IF v_task_id IS NULL THEN
      RAISE EXCEPTION 'Task % não pertence ao projeto', upd->>'taskRef';
    END IF;

    -- 2) UPDATE Task (sprintId, status) — só os campos presentes
    UPDATE "Task" SET
      "sprintId" = CASE WHEN upd ? 'sprintId' THEN (upd->>'sprintId')::uuid ELSE "sprintId" END,
      status = CASE WHEN upd ? 'status' THEN upd->>'status' ELSE status END,
      "updatedAt" = now()
    WHERE id = v_task_id;

    -- 3) Replace TaskAssignment se assigneeIds presente
    IF upd ? 'assigneeIds' THEN
      DELETE FROM "TaskAssignment" WHERE "taskId" = v_task_id;
      v_assignee_ids := ARRAY(SELECT jsonb_array_elements_text(upd->'assigneeIds'))::uuid[];
      INSERT INTO "TaskAssignment" ("taskId", "memberId")
      SELECT v_task_id, unnest(v_assignee_ids)
      WHERE EXISTS (
        SELECT 1 FROM "ProjectMember"
        WHERE "projectId" = p_project_id AND "memberId" = ANY(v_assignee_ids)
      );
    END IF;

    v_results := v_results || jsonb_build_object('taskRef', upd->>'taskRef', 'ok', true);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'updated', jsonb_array_length(v_results), 'results', v_results);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;
```

(Esqueleto — refinar nomes de coluna conforme migration final.)

### 15.6 Prompt — seção nova "Sprint Planning"

Adicionar em `src/lib/agent/agents/alpha/prompt.ts`, após "Hierarquia de produto" (Onda 5):

```
## Sprint Planning

Quando o backlog está pronto e capacidade dos builders carregada
(ver "Capacidade do projeto" no contexto), você atua como sprint planner.

### Fluxo obrigatório

1. PERGUNTAS ANTES DE PROPOR
   Antes de qualquer alocação, faça estas 4 perguntas (uma mensagem só):
   - "Tem preferência de quem pega o quê? Ex: Lucas só backend, João full-stack."
   - "Quer priorizar algum module/feature primeiro?"
   - "Algum builder fora do ar / com capacidade reduzida em algum sprint?"
   - "Quer que eu cubra todo o backlog ou só os próximos N sprints?"
   NUNCA chute nenhuma das quatro.

2. DIMENSIONAMENTO
   Calcule: total_fp_backlog ÷ capacidade_efetiva_por_sprint = sprints_necessários.
   Capacidade efetiva considera as restrições do passo 1 (férias, dedicação parcial).
   Se sprints_necessários > sprints_existentes, **proponha criar** os que faltam
   via `create_sprint` (datas seg→dom, 7 dias, sequencial — ver memória).

3. RESPEITO DE CAPACIDADE
   - Soma de FP por (member, sprint) ≤ allocation efetiva (`sprint_member_capacity`).
   - Se não cabe, NUNCA force. Empurre tasks pro próximo sprint.
   - Se cap total < backlog mesmo com todos os sprints planejados, alerte:
     "Backlog ultrapassa capacidade — falta um builder ou sprint adicional?"

4. SEGMENTAÇÃO POR ASSIGNEE
   - Você não conhece skill por task. Use SÓ o que o PM disser nas preferências.
   - Sem preferência → distribua proporcional ao remaining FP de cada builder.
   - Tasks sem assignee óbvio: `assigneeIds: []`, PM resolve depois.
   - Múltiplos assignees por task são permitidos (M:N) — só use se o PM pedir.

5. PROPOSTA EM TEXTO + CONFIRMAÇÃO
   Mostre tabela em texto antes de chamar tools:
   ```
   Proposta — 2 sprints novos + 32 tasks alocadas

   [criar] Sprint 9 (2026-05-18 → 2026-05-24)
   [criar] Sprint 10 (2026-05-25 → 2026-05-31)

   Sprint 8 (existente):
     João — 145/150  → 8 tasks (LOGIN-1, LOGIN-2, ...)
     Lucas — 95/100  → 5 tasks (BILLING backend)
   Sprint 9:
     ...
   Sprint 10:
     ...

   Total: 312 FP em 32 tasks. 0 ficam no backlog.
   Confirma?
   ```
   Após "confirma": chame `create_sprint` (uma por sprint novo) → depois
   `bulk_update_tasks` (1 chamada com todos os 32 updates).

6. STATUS
   Em planejamento, status default vai pra `'todo'` (planejado, não iniciado).
   NUNCA mexa em status `doing/review/done` sem ordem direta do PM.
```

### 15.7 Sequência de uma sessão típica

```
PM: "alpha, o Vitor fechou o backlog. organiza tudo."

Alpha: [chama get_project_capacity + list_unplanned_tasks]
       "47 tasks (312 FP) no backlog. 4 builders neste projeto:
        João 150 · Lucas 100 · Pedro 80 · Ana 60 (FP/sprint disponíveis).
        Capacidade total: 390/sprint. Você tem o Sprint 7 ativo
        e o Sprint 8 vazio. Antes de propor, 4 perguntas:
        1. Preferências de quem pega o quê?
        2. Algum module pra priorizar?
        3. Alguém fora do ar em algum sprint?
        4. Cobrir todo o backlog ou só os próximos N sprints?"

PM: "Lucas e Pedro só backend. João e Ana qualquer coisa.
     Prioriza LOGIN. Ana de férias na semana do Sprint 9.
     Cobre tudo."

Alpha: "Beleza. Calculei: 312 FP ÷ ~330 FP/sprint efetivo = 1 sprint dá conta,
        mas com Ana fora no Sprint 9 (cap cai pra 270), preciso de 2 sprints
        pra distribuir confortável.

        Proposta:
          [criar] Sprint 9 (2026-05-18 → 2026-05-24)

          Sprint 8 (2026-05-11 → 2026-05-17):
            João — 148/150  → LOGIN frontend (8 tasks)
            Ana — 58/60     → AUDIT frontend (4 tasks)
            Lucas — 98/100  → BILLING backend (5 tasks)
            Pedro — 78/80   → LOGIN backend (4 tasks)
                              total: 382/390 FP, 21 tasks

          Sprint 9 (sem Ana):
            João — 142/150  → BILLING/AUDIT frontend (7 tasks)
            Lucas — 95/100  → BILLING backend resto (4 tasks)
            Pedro — 75/80   → AUDIT backend (3 tasks)
                              total: 312/330 FP, 14 tasks (-Ana férias)

          Backlog após: 0 tasks.

        Confirma?"

PM: "manda"

Alpha: [create_sprint Sprint 9]
       [bulk_update_tasks com 35 updates: sprint+assignees+status='todo']
       "Done. Sprint 9 criado. 35 tasks alocadas."
```

### 15.8 Cenários de calibração — adicionar à Onda 7

Acrescentar 5 cenários em §9.1, após o #8:

| # | Input | Output esperado |
|---|---|---|
| 9 | "organiza o backlog em sprints" | Alpha **pergunta** as 4 antes de propor — não pula |
| 10 | "aloca tudo no Sprint 8" (estoura cap) | Alpha alerta + propõe split em 2 sprints (cria Sprint 9) |
| 11 | "Lucas só backend, João full" | Tasks de frontend não vão pro Lucas na proposta |
| 12 | Backlog > capacidade total mesmo com N sprints | Alpha avisa "falta um builder ou sprint extra?" — NÃO força |
| 13 | "Ana de férias no próximo sprint" | Capacidade do Sprint X recalculada sem Ana; tasks redistribuídas |

### 15.9 Riscos

| Risco | Mitigação |
|---|---|
| Alpha aloca task fora do skill do builder | Prompt §4 (sem skill data, depende do PM dizer) + cenários 11/13 |
| Bulk falha no meio (task inválida) | RPC em transação; rollback total + erro retornado |
| PM esquece de mencionar férias | Pergunta #3 é obrigatória — Alpha não pula |
| Capacity stale durante sessão (PM editou ProjectMember) | RPC revalida `ProjectMember` em cada `bulk_update_tasks` |
| Alpha cria sprint com data errada (não-segunda) | CHECK constraint do DB rejeita; memória já registra Mon→Sun |
| Alpha decide "modo planner" em projeto pequeno (5 tasks) | Gate §15.0 exige ≥10 tasks backlog prontos — abaixo disso, modo normal |
| Múltiplos assignees viram zona cinza | Prompt §4 explícito — só com pedido do PM |

### 15.10 Definition of done (Onda 8)

- ✅ Migration `bulk_update_tasks` rodada via psql, smoke test ok
- ✅ Tools `get_project_capacity`, `list_unplanned_tasks`, `bulk_update_tasks` adicionadas em `tools.ts`
- ✅ Context loader injeta bloco "Capacidade do projeto" quando gate de §15.0 satisfeito
- ✅ Prompt seção "Sprint Planning" mergeada
- ✅ 5 cenários adicionais (9–13) passam ≥ 90% em 3 runs cada
- ✅ Smoke E2E em projeto piloto: backlog real é organizado em sprints, PM aprova, `bulk_update_tasks` aplica corretamente, `sprint_member_capacity` reflete a alocação

### 15.11 Tempo estimado

| Sub-onda | Escopo | Tempo |
|---|---|---|
| 8a | Migration RPC `bulk_update_tasks` + smoke | 1h |
| 8b | DAL `getPlanningSnapshot` + context loader | 1h |
| 8c | Tools `get_project_capacity` + `list_unplanned_tasks` + `bulk_update_tasks` | 2h |
| 8d | Prompt "Sprint Planning" + ajustes | 1h |
| 8e | Calibração 5 cenários novos | 2h |

**Total Onda 8:** ~7h. Pode rodar **em paralelo à Onda 6** (ribbon), depende só da Onda 4.
