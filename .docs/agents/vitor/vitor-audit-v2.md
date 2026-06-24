# Vitor v2 — Auditoria End-to-End de Design Session (pós-normalização)

**Data:** _(rodar — base 2026-05-13)_
**Resultado:** _(preencher — alvo 55+/60)_
**Plano de referência:** [vitor-normalization-plan-v2.md](vitor-normalization-plan-v2.md), [task-refs-and-dependencies-implementation.md](../../features/tasks/task-refs-and-dependencies-implementation.md), [vitor-hierarchy-calibration-plan.md](vitor-hierarchy-calibration-plan.md)
**Substitui:** [vitor-audit.md](../../archive/vitor-audit.md) (audit v1 de 2026-05-05, 58/60).

## O que mudou da v1

| v1 (audit antigo) | v2 (este) |
|---|---|
| Projeto `__eval__zelar` (`ccdd93ec...`) | Projeto novo `__eval__vitor_sql` (`5d3dc8e1-1bfd-4794-8f2e-640744626f2f`), sessão a criar |
| Vitor escreve em `DesignSessionStepData` JSON | Vitor escreve nas 9 tabelas normalizadas |
| Tools genéricas: `get_step_data`, `set_field`, `add_item`, `update_item`, `delete_item` | Tools por entidade: `read_X` + `write_X` (discriminated union) |
| Sub-fase em `DesignSessionStepData[briefing].data.subPhase` | Coluna `DesignSession.briefingSubPhase` |
| `targetStoryId` em JSON | Coluna `DesignSession.briefingTargetStoryId` |
| Sem realtime — UI espelha state local | Realtime nas 9 tabelas; UI e Vitor são pares |
| Categoria nova: `state-pollution` (sub-fases) | Adicionar categoria: `realtime-drift` (UI não reflete write do Vitor em <500ms) |

**Objetivo:** mesma vara da audit v1 — Vitor leva projeto fresh do zero até backlog Alpha-ready. Adiciona verificação que (1) writes vão pras tabelas certas (não step_data), (2) reads usam tools por entidade com filtros (sem inflar contexto), (3) realtime espelha mudanças entre tabs em <500ms.

---

## Setup

### Identificadores

```bash
export VITOR_PROJECT="5d3dc8e1-1bfd-4794-8f2e-640744626f2f"   # __eval__vitor_sql
export VITOR_PROJECT_KEY="EVS"   # confirmar com SELECT "referenceKey" pós-criar
```

**Sessão:** ainda não existe. Criar uma Inception fresh via UI ou:

```sql
INSERT INTO "DesignSession" (id, "projectId", title, type, status, "createdBy", "currentStep", "totalSteps", "updatedAt")
VALUES (
  gen_random_uuid(),
  '5d3dc8e1-1bfd-4794-8f2e-640744626f2f',
  'Eval Vitor v2',
  'inception',
  'active',
  (SELECT id FROM "Member" WHERE "userId" = (SELECT id FROM auth.users WHERE email = 'joao.moraes@volund.com.br')),
  0,
  10,
  now()
)
RETURNING id;
-- anotar UUID:
export VITOR_SESSION="<UUID>"
```

### Estado base esperado (sessão fresh)

```sql
SELECT
  (SELECT count(*) FROM "UserStory" WHERE "projectId" = '5d3dc8e1-1bfd-4794-8f2e-640744626f2f') AS stories,
  (SELECT count(*) FROM "Task" WHERE "projectId" = '5d3dc8e1-1bfd-4794-8f2e-640744626f2f') AS tasks,
  (SELECT count(*) FROM "Module" WHERE "projectId" = '5d3dc8e1-1bfd-4794-8f2e-640744626f2f') AS modules,
  (SELECT count(*) FROM "ProjectPersona" WHERE "projectId" = '5d3dc8e1-1bfd-4794-8f2e-640744626f2f') AS personas,
  -- v2: sub-fase em coluna escalar
  (SELECT "briefingSubPhase" FROM "DesignSession" WHERE id = :'VITOR_SESSION') AS sub_phase,
  -- Confirmar que tabelas normalizadas estão vazias pra essa sessão
  (SELECT count(*) FROM "DesignSessionPersona" WHERE "sessionId" = :'VITOR_SESSION') AS ds_personas,
  (SELECT count(*) FROM "DesignSessionBrainstormFeature" WHERE "sessionId" = :'VITOR_SESSION') AS ds_brainstorm,
  (SELECT count(*) FROM "DesignSessionPriorityItem" WHERE "sessionId" = :'VITOR_SESSION') AS ds_priority;
```

**Esperado:** tudo 0, `sub_phase = NULL` (default). Pre-fill mínimo dos steps pré-briefing **DEVE** ser feito antes (product_vision, scope, personas, brainstorm, prioritization, technical_specs) — pode usar fixtures de `__eval__zelar` adaptadas, ou prompt do Vitor em modo pre_work.

Se não estiver fresh, rodar bloco [Reset](#reset-completo) no fim do doc.

### Template de comando

```bash
npx tsx --require ./scripts/_server-only-shim.cjs scripts/vitor-cli.ts \
  --session "$VITOR_SESSION" \
  --message "<PROMPT>"
```

**Atenção:** Vitor usa **única thread** — flow inteiro num só contexto.

---

## Categorias de falha

| Cat | Significado | Implicação |
|---|---|---|
| **sem-tool** | Tool ausente do toolset Vitor | Adicionar tool |
| **sem-contexto** | Tool existe, mas Vitor não vê a entidade no system prompt | Ajustar `loadContext` |
| **prompt-confuso** | Tool + contexto OK, regra ambígua → Vitor erra escolha | Reescrever passo no `prompt.ts` |
| **modelo-alucina** | Tudo correto, Vitor inventa | Few-shot ou modelo |
| **schema-rejeita** | Tool input schema rejeita o que Vitor passou | Ajustar zod refine ou descrição |
| **state-pollution** | State entre sub-fases inconsistente (briefingSubPhase / briefingTargetStoryId) | Bug de orquestração UI |
| **realtime-drift** | UI não reflete write do Vitor em <500ms (ou eco re-renderiza no meio do typing) | Bug no `useDesignSessionRealtime` ou supressão de echo |
| **legacy-write** | Vitor escreve em `DesignSessionStepData` em vez da tabela normalizada | Bug nas write tools — não deveria mais acontecer |
| **correto** | Comportamento esperado | ✅ |

---

## Resultados

> Cada cenário tem: **Prompt enviado**, **Thread**, **Resultado observado**, **Tools chamadas**, **SQL de validação**, **Falha?**, **Categoria**, **Notas**.

### V0 — Pré-flight: confirma tools novas

**Setup:** sessão criada, pre-work pre-fillado mínimo (product_vision + 3 personas + 5-6 brainstorm features + 3-5 priority items MVP).

**Prompt:**
```
me lista as personas que ja existem aqui e os 3 itens MVP da priorizacao. nao escreve nada ainda.
```

**Esperado:**
- Chama `read_persona({})` (não `get_step_data`)
- Chama `read_priority({ buckets: ["mvp"] })` (não `get_step_data`)
- Responde texto. Zero writes.

**Tools esperadas (heatmap):**
- `read_persona` x1
- `read_priority` x1

**SQL de validação:**
```sql
-- Confirma que NADA foi escrito
SELECT count(*) FROM "DesignSessionStepData" WHERE "sessionId" = :'VITOR_SESSION' AND "updatedAt" > now() - interval '1 minute';
-- Esperado: 0 (ou row pré-existente sem mudança).
```

- **Falha?** [ ] sim / [ ] não
- **Categoria:** [ ] sem-tool / [ ] sem-contexto / [ ] prompt-confuso / [ ] modelo-alucina / [ ] correto
- **Notas:**

---

### V1 — MODULE_DISCOVERY: descoberta inicial

**Setup SQL:**
```sql
UPDATE "DesignSession"
SET "briefingSubPhase" = 'module_discovery', "briefingTargetStoryId" = NULL
WHERE id = :'VITOR_SESSION';
```

**Prompt:**
```
vamos começar o briefing. mapeie os módulos do produto e sincronize as personas.
```

**Esperado:**
- Vitor lê via `read_brainstorm({})`, `read_persona({ includeJourney: true })`, `read_scope({})`, `read_priority({})`, `read_tech_specs({})` — **NÃO** chama `get_step_data` (removido)
- Apresenta no chat: lista de módulos + personas a sincronizar (sem chamar write tool ainda)
- Pergunta `"Posso persistir?"`

**Critérios anti-regressão v2:**
- [ ] Zero chamadas a `get_step_data` (tool não existe mais)
- [ ] Zero chamadas a `set_field`/`add_item`/`update_item`/`delete_item`
- [ ] Reads usam **filtros** (não `read_X({})` em tudo se a info já está no system prompt)

- **Resultado:**
- **Tools chamadas:**
- **Falha?** [ ]
- **Categoria:**
- **Notas:**

---

### V1.1 — Confirmação de MODULE_DISCOVERY

**Prompt:** `pode persistir.`

**SQL de validação:**
```sql
SELECT name, description, "approvedAt" IS NOT NULL AS approved
  FROM "Module"
  WHERE "projectId" = :'VITOR_PROJECT'
  ORDER BY name;

SELECT name, LEFT(description, 80) AS description
  FROM "ProjectPersona"
  WHERE "projectId" = :'VITOR_PROJECT'
  ORDER BY name;

-- v2: NÃO deve ter row escrita em DesignSessionStepData
SELECT count(*) AS legacy_writes FROM "DesignSessionStepData"
  WHERE "sessionId" = :'VITOR_SESSION' AND "updatedAt" > now() - interval '5 minutes';
```

**Critérios:**
- [ ] 8-12 modules em status draft (`approvedAt IS NULL`)
- [ ] Nomes em UPPERCASE_SNAKE
- [ ] Cada module tem `description` não-NULL
- [ ] 3 personas com description
- [ ] Vitor não chamou `create_user_story` nem `create_task`
- [ ] **`legacy_writes = 0`** (nenhuma escrita em step_data) ← v2

- **Falha?** [ ]
- **Categoria:**
- **Notas:**

---

### V2 — STORY_TREE: módulo greenfield

**Setup SQL (v2 — coluna escalar):**
```sql
UPDATE "DesignSession"
SET "briefingSubPhase" = 'story_tree'
WHERE id = :'VITOR_SESSION';
```

**Prompt:**
```
vamos para o primeiro módulo. faça story_tree completo: stories nascem refined com persona + AC de produto. detecte lacunas estruturais.
```

**Esperado:**
- `list_stories(scope: "session")` (vazio)
- Filtra cards MVP do brainstorm via `read_brainstorm({ ids?, fields: ['painPointRef','targetPersona'] })` — ler **só os fields necessários**, não tudo
- **Identifica gaps estruturais**
- Apresenta resumo enxuto
- Pergunta confirmação

**Tools esperadas:**
- `read_brainstorm` (com fields, não default)
- `read_persona` (com fields ou includeJourney conforme necessário)
- `list_stories` x1

- **Resultado:**
- **Tools chamadas:**
- **Falha?** [ ]
- **Categoria:**
- **Notas:**

---

### V2.1 — Confirmação STORY_TREE

**Prompt:** `pode persistir.`

**SQL de validação:**
```sql
SELECT
  s.reference,
  LEFT(s.title, 60) AS title,
  s."refinementStatus" AS status,
  p.name AS persona,
  m.name AS module,
  (SELECT count(*) FROM "AcceptanceCriterion" ac WHERE ac."userStoryId" = s.id) AS ac_count
FROM "UserStory" s
LEFT JOIN "ProjectPersona" p ON p.id = s."personaId"
LEFT JOIN "Module" m ON m.id = s."moduleId"
WHERE s."projectId" = :'VITOR_PROJECT'
ORDER BY s.reference;
```

**Critérios:**
- [ ] 5-10 stories criadas
- [ ] **TODAS** com `refinementStatus = 'refined'`
- [ ] **TODAS** com `personaId` real
- [ ] **TODAS** com `moduleId` real (não `proposedModuleName`)
- [ ] Cada story tem 3-7 AC de produto
- [ ] AC verificáveis pelo PM
- [ ] Pelo menos 1 story = lacuna estrutural

- **Falha?** [ ]
- **Categoria:**
- **Notas:**

---

### V3 — TASK_BREAKDOWN: story-única

**Setup SQL (v2):**
```sql
-- Pegar primeira story refined
SELECT id, reference, title FROM "UserStory"
  WHERE "projectId" = :'VITOR_PROJECT' AND "refinementStatus" = 'refined'
  ORDER BY reference LIMIT 1;
-- Anotar UUID:

UPDATE "DesignSession"
SET "briefingSubPhase" = 'task_breakdown',
    "briefingTargetStoryId" = '<UUID_STORY>'
WHERE id = :'VITOR_SESSION';
```

**Prompt:**
```
decompõe a story alvo em tasks técnicas. proponha primeiro com tags e dependências, espero ok pra criar.
```

**Esperado:** `list_stories`, `list_tasks`, `list_project_tags` → propor → pedir ok.

- **Resultado:**
- **Tools chamadas:**
- **Falha?** [ ]
- **Categoria:**
- **Notas:**

---

### V3.1 — Confirmação task_breakdown story-única

**Prompt:** `pode criar.`

**SQL de validação:**
```sql
WITH target AS (SELECT id FROM "UserStory" WHERE id = '<UUID_STORY>')
SELECT
  t.reference,
  LEFT(t.title, 60) AS title,
  t.complexity, t.scope, t."functionPoints" AS fp, t.status,
  string_agg(DISTINCT tt.name, ', ') AS tags,
  string_agg(DISTINCT dep.reference || ' (' || td.kind || ')', ', ') AS depends_on
FROM "Task" t
LEFT JOIN "TaskTagAssignment" tta ON tta."taskId" = t.id
LEFT JOIN "TaskTag" tt ON tt.id = tta."tagId"
LEFT JOIN "TaskDependency" td ON td."taskId" = t.id
LEFT JOIN "Task" dep ON dep.id = td."dependsOn"
WHERE t."userStoryId" = (SELECT id FROM target)
GROUP BY t.id, t.reference, t.title, t.complexity, t.scope, t."functionPoints", t.status, t."createdAt"
ORDER BY t."createdAt";
```

**Critérios:**
- [ ] 3-5 tasks criadas, refs `EVS-D-NNN` (não NULL, não TASK-NNN)
- [ ] **TODAS** em `status = 'draft'`
- [ ] Cada task tem 1-3 tags
- [ ] **TODAS** com `functionPoints`
- [ ] T2/T3 com `dependsOn` apontando pra T1 — `kind=blocks`
- [ ] Story alvo virou `refinementStatus = 'committed'`
- [ ] AC técnico distinto do AC de produto
- [ ] Description em markdown denso

- **Falha?** [ ]
- **Categoria:**
- **Notas:**

---

### V4 — TASK_BREAKDOWN: batch módulo inteiro (stress)

**Setup SQL (v2):**
```sql
UPDATE "DesignSession"
SET "briefingTargetStoryId" = NULL
WHERE id = :'VITOR_SESSION';
```

**Prompt:**
```
decompõe as stories restantes do módulo (todas que ainda estão refined). proponha agregado primeiro — apenas títulos + tags + complexity + scope agrupados por story, com dependências entre tasks de stories diferentes quando aplicável. crie em ordem topológica e marque cada story como committed após sua última task.
```

**Esperado:**
- `list_stories` (N refined)
- `list_tasks` (vê refs V3)
- `list_project_tags` (reusa)
- Propõe N tasks agrupadas com deps inter-story
- Pergunta confirmação

- **Resultado:**
- **Tools chamadas:**
- **Falha?** [ ]
- **Categoria:**
- **Notas:**

---

### V4.1 — Confirmação batch

**Prompt:** `pode criar.`

**SQL de validação:** _(idêntico ao v1, ver Anexos)_

**Critérios:**
- [ ] **TODAS** as stories do módulo committed
- [ ] Cada story tem 2-5 tasks
- [ ] Refs `EVS-D-NNN` contíguas
- [ ] **Pelo menos 1 dep INTER-STORY**
- [ ] **5+ deps INTRA-STORY**
- [ ] Zero ciclos
- [ ] Mix de kinds: 80%+ `blocks`
- [ ] Tags consistentes

- **Falha?** [ ]
- **Categoria:**
- **Notas:**

---

### V5 — Cenário adversarial: deps inter-story EXPLÍCITA

_(idêntico v1, ver runbook anterior)_

- **Falha?** [ ]
- **Categoria:**
- **Notas:**

---

### V6 — Stress: módulo de complexidade técnica alta

**Setup (v2):**
```sql
UPDATE "DesignSession"
SET "briefingSubPhase" = 'story_tree', "briefingTargetStoryId" = NULL
WHERE id = :'VITOR_SESSION';
```

Repete fluxo V2-V4.1 pro segundo módulo (idealmente com Edge Functions / lógica densa).

---

### V7 — Promoção: drafts → backlog

_(idêntico v1, SQL de validação igual — Module / Task / TaskDependency não mudaram com v2)_

---

### V8 — Sanity: pergunta de inspeção

**Prompt:**
```
me dá um resumo do que ficou pronto: quantos módulos aprovados, quantas stories committed, quantas tasks no backlog, FP total.
```

**Esperado:** Vitor responde via `list_stories` + `list_tasks`, sem criar nada.

**Critério v2:** narrativa enxuta, **FP somado bate** com soma real (v1 errou 222 vs 236).

---

### V9 — Adversarial: pedido fora do escopo

_(idêntico v1)_

---

### V10 — Adversarial: ciclo manual

_(idêntico v1)_

---

### V11 — NOVO: Realtime entre tabs

**Setup:** abrir 2 tabs no mesmo step (`/design-sessions/<id>/steps/personas_journeys`).

**Ação:**
1. Tab A: pedir pro Vitor criar uma persona via chat: `cria uma persona chamada "Operador SAC" papel "atendente de suporte"`.
2. Tab B: observar **sem refresh**.

**Esperado:**
- Tab B vê a persona aparecer no board em <500ms.
- Não há flicker / dupla renderização.
- Se Tab B estiver digitando no campo `context` de outra persona, **não perde** o que está sendo digitado (echo guard).

**Critérios:**
- [ ] Tab B atualiza em <500ms (cronometrar com browser network panel)
- [ ] Sem dupla renderização (mesma persona aparece 1x)
- [ ] Sem perda de input local (echo guard funciona)

- **Falha?** [ ]
- **Categoria:** [ ] realtime-drift / [ ] correto
- **Notas:**

---

### V12 — NOVO: Anti-regressão — Vitor escreve só em tabelas

**Após V1.1 e V2.1, validar:**

```sql
-- Nada escrito em DesignSessionStepData durante a sessão atual
SELECT
  "stepKey",
  count(*) AS rows,
  MAX("updatedAt") AS last_write
FROM "DesignSessionStepData"
WHERE "sessionId" = :'VITOR_SESSION'
GROUP BY "stepKey";
-- Esperado: vazio OU rows pré-fillados antes do briefing (sem updates DURANTE o briefing)

-- Tabelas normalizadas povoadas
SELECT
  (SELECT count(*) FROM "DesignSessionPersona" WHERE "sessionId" = :'VITOR_SESSION') AS personas,
  (SELECT count(*) FROM "DesignSessionBrainstormFeature" WHERE "sessionId" = :'VITOR_SESSION') AS brainstorm,
  (SELECT count(*) FROM "DesignSessionPriorityItem" WHERE "sessionId" = :'VITOR_SESSION') AS priority,
  (SELECT count(*) FROM "DesignSessionRisk" WHERE "sessionId" = :'VITOR_SESSION') AS risks,
  (SELECT count(*) FROM "DesignSessionGap" WHERE "sessionId" = :'VITOR_SESSION') AS gaps,
  (SELECT count(*) FROM "DesignSessionHypothesis" WHERE "sessionId" = :'VITOR_SESSION') AS hypotheses;
```

**Critérios:**
- [ ] `step_data` SEM updates durante a sessão (writes só em pre_fill, se houve)
- [ ] Tabelas normalizadas têm rows
- [ ] briefingFirstMessageAt setado na primeira mensagem do step briefing

- **Falha?** [ ]
- **Categoria:** [ ] legacy-write / [ ] correto
- **Notas:**

---

## Heatmap de tool usage (v2)

```sql
WITH vitor_msgs AS (
  SELECT cm.parts
  FROM "ChatMessage" cm
  JOIN "ChatThread" ct ON ct.id = cm."threadId"
  WHERE ct."sessionId" = :'VITOR_SESSION'
    AND cm.parts IS NOT NULL
)
SELECT
  part->>'toolName' AS tool_name,
  count(*) AS calls
FROM vitor_msgs,
     LATERAL jsonb_array_elements(parts) part
WHERE part->>'type' = 'tool-call'
GROUP BY 1
ORDER BY 2 DESC;
```

| Tool | Calls esperadas em flow saudável |
|---|---|
| `read_persona` | 3-5 (default seco, includeJourney só quando precisar) |
| `read_brainstorm` | 3-5 (filtros por ids/fields) |
| `read_priority` | 1-2 (filtra por bucket=mvp) |
| `read_scope` / `read_tech_specs` / `read_product_vision` | 0-1 cada (info já no system prompt) |
| `read_files` / `read_file_text` | 0-1 (se houver pre_work) |
| `propose_modules` | 1 |
| `sync_project_personas` | 1 |
| `list_stories` | ≥3 |
| `list_tasks` | ≥2 |
| `list_project_tags` | ≥2 |
| `create_user_story` | = N stories |
| `create_task` | = N tasks |
| `set_story_refinement` | = N stories committed |
| `write_persona` / `write_brainstorm` / `write_priority` / ... | conforme escopo da sessão (v2 substituem add_item legado) |

**Tools que NÃO devem aparecer:**
- ❌ `get_step_data` — não existe mais (PR 2)
- ❌ `set_field`, `add_item`, `update_item`, `delete_item` — removidas (PR 2)
- ❌ `web_search` (a menos que peça benchmark explícito)
- ❌ Tools de Alpha

**Sinais de alerta v2:**
1. **Qualquer chamada a tool removida** → bug crítico (registry desatualizado ou rollback acidental)
2. **`read_X({})` sem filtros >5 vezes** → token hygiene falhando, prompt não está orientando
3. **`read_persona({ includeJourney: true })` em todas as chamadas** → modelo não está usando default seco
4. **`write_X` zero usos com `list_*` >0** → reads OK mas writes não acionados (regressão)
5. **`step_array_add`/`step_array_update` aparecendo em logs SQL** → Vitor (ou algum legado) ainda escreve em step_data

---

## Scorecard (60 pontos, 6 dimensões) — RESULTADO

### D1 — Discovery (Module + Personas)

| Item | Score (target) | Evidência |
|---|---|---|
| Módulos UPPERCASE_SNAKE consistente | _/2 | _ |
| Cada module com descrição clara | _/2 | _ |
| 3 personas sincronizadas sem polução | _/2 | _ |
| Vitor não chamou `get_step_data` (removida) | _/2 | _ |
| Chat enxuto após confirmação | _/2 | _ |

**Subtotal D1: _ / 10**

### D2 — Story Tree

| Item | Score | Evidência |
|---|---|---|
| Stories nasceram refined | _/3 | _ |
| 100% personaId preenchido | _/2 | _ |
| 100% moduleId real | _/2 | _ |
| AC verificáveis pelo PM | _/2 | _ |
| Detecção de gap estrutural | _/1 | _ |

**Subtotal D2: _ / 10**

### D3 — Task Breakdown

| Item | Score | Evidência |
|---|---|---|
| Refs `EVS-D-NNN` corretas | _/2 | _ |
| Granularidade adequada | _/2 | _ |
| Naming segue regra | _/2 | _ |
| AC técnico distinto do AC produto | _/2 | _ |
| Description em markdown denso | _/2 | _ |

**Subtotal D3: _ / 10**

### D4 — Dependências

| Item | Score | Evidência |
|---|---|---|
| `dependsOn` em ≥60% das tasks aplicáveis | _/2 | _ |
| Refs textuais (não UUIDs) | _/2 | _ |
| ≥1 dep INTER-STORY | _/2 | _ |
| Mix de kinds | _/2 | _ |
| Zero ciclos inesperados | _/2 | _ |

**Subtotal D4: _ / 10**

### D5 — Tags

| Item | Score | Evidência |
|---|---|---|
| `list_project_tags` chamado antes de criar | _/3 | _ |
| Reuso de tags canônicas | _/3 | _ |
| Limite 1-3 por task | _/2 | _ |
| Tones inferidos visualmente OK | _/2 | _ |

**Subtotal D5: _ / 10**

### D6 — Promoção e Integridade

| Item | Score | Evidência |
|---|---|---|
| D-NNN → T-NNN sem perda | _/3 | _ |
| TaskDependency íntegro pós-promoção | _/3 | _ |
| Sequência T-NNN contígua | _/2 | _ |
| Backlog Alpha-ready | _/2 | _ |

**Subtotal D6: _ / 10**

### D7 — NOVO: Normalização v2 (bônus / gate)

> Dimensão extra que **gateeia produção**. Falhar qualquer item aqui derruba a audit pra <55, independente do total.

| Item | Score | Evidência |
|---|---|---|
| Zero writes em `DesignSessionStepData` durante briefing | _/3 | V12 |
| Vitor usa `read_X` com filtros (`fields`, `ids`, `buckets`) em ≥50% das reads | _/2 | heatmap |
| Realtime: tab B vê tab A em <500ms (V11) | _/3 | V11 |
| Zero chamadas a tools removidas (`get_step_data`/`add_item`/...) | _/2 | heatmap |

**Subtotal D7: _ / 10 (gate)**

### Total

```
D1 + D2 + D3 + D4 + D5 + D6 = _ / 60
D7 (gate) = _ / 10  ←  DEVE ser ≥8 pra liberar prod
```

---

## Decisão go/no-go (v2)

| Faixa principal | D7 | Status |
|---|---|---|
| 55-60 | ≥8 | ✅ **Pronto pra produção** |
| 55-60 | <8 | ⚠️ **Regressão na normalização** — não promover, corrigir antes |
| 45-54 | qualquer | ⚠️ **Ajustes pontuais** |
| 30-44 | qualquer | ⚠️ **Calibração necessária** |
| < 30 | qualquer | ❌ **Não pronto** |

### Diagnóstico fino (preencher após rodar)

1. **State (sub-fases via colunas):** ✅ / ⚠️ — sub-fase trocada via `UPDATE DesignSession SET "briefingSubPhase"`, Vitor leu correto?
2. **Padrão de alucinação:** _
3. **Refinement loop:** _
4. **Sanity (V8):** _
5. **Heatmap (compare contra alvo v2):** _
6. **Adversarial:** _
7. **NOVO — Token hygiene:** Vitor usou filtros nas reads? Default seco respeitado?
8. **NOVO — Realtime (V11):** drift, eco, perda de input?
9. **NOVO — Legacy write (V12):** zero linhas em step_data? Tabelas normalizadas povoadas?

---

## Anexos

### Reset completo (v2)

```sql
BEGIN;

DELETE FROM "TaskTagAssignment"
WHERE "taskId" IN (SELECT id FROM "Task" WHERE "projectId" = :'VITOR_PROJECT');

DELETE FROM "TaskDependency"
WHERE "taskId" IN (SELECT id FROM "Task" WHERE "projectId" = :'VITOR_PROJECT');

DELETE FROM "AcceptanceCriterion"
WHERE "taskId" IN (SELECT id FROM "Task" WHERE "projectId" = :'VITOR_PROJECT');

DELETE FROM "DesignSessionItem" WHERE "sessionId" = :'VITOR_SESSION';
DELETE FROM "Task" WHERE "projectId" = :'VITOR_PROJECT';

DELETE FROM "AcceptanceCriterion"
WHERE "userStoryId" IN (SELECT id FROM "UserStory" WHERE "projectId" = :'VITOR_PROJECT');

DELETE FROM "UserStory" WHERE "projectId" = :'VITOR_PROJECT';
DELETE FROM "Module" WHERE "projectId" = :'VITOR_PROJECT';
DELETE FROM "ProjectPersona" WHERE "projectId" = :'VITOR_PROJECT';
DELETE FROM "TaskTag" WHERE "projectId" = :'VITOR_PROJECT';

DELETE FROM "ChatMessage"
WHERE "threadId" IN (SELECT ct.id FROM "ChatThread" ct WHERE ct."sessionId" = :'VITOR_SESSION');
DELETE FROM "ChatThread" WHERE "sessionId" = :'VITOR_SESSION';

-- v2: limpar tabelas normalizadas (eram step_data antes)
DELETE FROM "DesignSessionPersona" WHERE "sessionId" = :'VITOR_SESSION';
DELETE FROM "DesignSessionBrainstormFeature" WHERE "sessionId" = :'VITOR_SESSION';
DELETE FROM "DesignSessionPriorityItem" WHERE "sessionId" = :'VITOR_SESSION';
DELETE FROM "DesignSessionRisk" WHERE "sessionId" = :'VITOR_SESSION';
DELETE FROM "DesignSessionGap" WHERE "sessionId" = :'VITOR_SESSION';
DELETE FROM "DesignSessionHypothesis" WHERE "sessionId" = :'VITOR_SESSION';
DELETE FROM "DesignSessionScope" WHERE "sessionId" = :'VITOR_SESSION';
DELETE FROM "DesignSessionProductVision" WHERE "sessionId" = :'VITOR_SESSION';
DELETE FROM "DesignSessionTechnicalSpecs" WHERE "sessionId" = :'VITOR_SESSION';

-- v2: zerar colunas briefing*
UPDATE "DesignSession"
SET "briefingSubPhase" = NULL,
    "briefingTargetStoryId" = NULL,
    "briefingFirstMessageAt" = NULL
WHERE id = :'VITOR_SESSION';

-- step_data antigo (se ainda existir — drop em PR 3): zera só pra garantir
DELETE FROM "DesignSessionStepData" WHERE "sessionId" = :'VITOR_SESSION';

COMMIT;
```

### Diagnóstico de sintomas comuns (v2)

| Sintoma | Causa provável | Categoria | Onde olhar |
|---|---|---|---|
| Vitor chama `get_step_data` | Registry desatualizado ou prompt cache stale | sem-tool | confirma deploy do PR 2; restart Vitor |
| Vitor escreve em step_data | write tool internamente quebrada | legacy-write | `src/lib/agent/tools/ds-entities-write.ts` |
| Tab B não atualiza após write Vitor | Realtime channel não subscribe ou filter errado | realtime-drift | `src/hooks/use-design-session-realtime.ts` |
| Input local some quando Vitor escreve | Echo guard quebrado nos hooks 1:1 | realtime-drift | `use-product-vision.ts`/`use-scope.ts`/`use-technical-specs.ts` |
| `briefingSubPhase` inconsistente | UI não setou via `/sub-phase` POST | state-pollution | `src/app/api/design-sessions/[id]/sub-phase/route.ts` |
| Story sem `personaId` | UUID inválido passado pelo Vitor | sem-contexto | Hierarchy block do prompt |
| Task `reference: NULL` | RPC `next_draft_task_reference` falhou | schema-rejeita | `create-task.ts` |
| `dependsOn` vazio em batch | Vitor não usou ref retornada | prompt-confuso | passo 6 do task_breakdown |
| `read_persona({})` sem filtros >5x | Token hygiene falhando | prompt-confuso | bloco TOKEN HYGIENE do prompt |
| Tag duplicada | Não chamou `list_project_tags` | sem-contexto | logs do turn |

### Logs úteis (v2)

```sql
-- Tool calls da sessão, cronologicamente — agora inclui read_X / write_X
SELECT
  cm."createdAt"::timestamp(0) AS at,
  part->>'toolName' AS tool,
  LEFT(part->>'input', 80) AS input_preview
FROM "ChatMessage" cm
JOIN "ChatThread" ct ON ct.id = cm."threadId"
CROSS JOIN LATERAL jsonb_array_elements(cm.parts) part
WHERE ct."sessionId" = :'VITOR_SESSION'
  AND part->>'type' = 'tool-call'
ORDER BY cm."createdAt", part->>'index';

-- v2: detectar uso de tools removidas (deve dar zero)
SELECT
  part->>'toolName' AS tool,
  count(*) AS calls
FROM "ChatMessage" cm
JOIN "ChatThread" ct ON ct.id = cm."threadId"
CROSS JOIN LATERAL jsonb_array_elements(cm.parts) part
WHERE ct."sessionId" = :'VITOR_SESSION'
  AND part->>'type' = 'tool-call'
  AND part->>'toolName' IN ('get_step_data','set_field','add_item','update_item','delete_item')
GROUP BY 1;
-- Esperado: 0 rows

-- v2: tamanho dos prompts — comparar com baseline v1 (esperado: queda 30%+)
SELECT
  cm.role,
  cm."createdAt"::timestamp(0) AS at,
  length(cm.content) AS content_chars,
  jsonb_array_length(coalesce(cm.parts, '[]'::jsonb)) AS parts_count
FROM "ChatMessage" cm
JOIN "ChatThread" ct ON ct.id = cm."threadId"
WHERE ct."sessionId" = :'VITOR_SESSION'
ORDER BY cm."createdAt";
```

---

## Resumo executivo (v2)

Audit end-to-end do **Vitor v2** (pós-normalização do design session em 9 tabelas + tools por entidade + realtime). Mantém estrutura da v1 (`module_discovery → story_tree → task_breakdown → promoção` + 3 adversariais), e adiciona 3 cenários novos:

- **V11 (realtime):** 2 tabs vendo write do Vitor em <500ms, sem perder input local.
- **V12 (anti-regressão):** confirmar que Vitor **não** escreve em `DesignSessionStepData` durante o briefing — só nas tabelas normalizadas.
- **D7 (dimensão extra):** gate de 10 pontos que **bloqueia produção** se houver legacy-write ou realtime-drift, mesmo com 60/60 nas dimensões originais.

Categorias novas:
- `realtime-drift` — UI fora de sincronia.
- `legacy-write` — Vitor regrediu pra step_data (não deveria acontecer pós-PR 2).

Faixa alvo: **55+/60 nas D1-D6 _e_ D7 ≥8** pra liberar pra PMs reais.
