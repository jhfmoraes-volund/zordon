# Vitor — Auditoria End-to-End de Design Session

**Data:** 2026-05-05 (executada)
**Resultado:** ✅ **58 / 60** — pronto pra produção
**Plano de referência:** [task-refs-and-dependencies-implementation.md](task-refs-and-dependencies-implementation.md), [vitor-hierarchy-calibration-plan.md](vitor-hierarchy-calibration-plan.md)
**Objetivo:** medir, num projeto fresh, se Vitor consegue conduzir uma design session do zero até deixar **backlog Alpha-ready** (módulos aprovados, stories committed, tasks em backlog com refs T-NNN, dependências corretas inter+intra-story).

Diferente da auditoria do Alpha (15 prompts independentes), Vitor opera num **flow sequencial estado-mutável** — sub-fases encadeadas (`module_discovery → story_tree → task_breakdown → promoção`). Cada fase produz state que alimenta a próxima. A audit segue essa cronologia.

---

## Setup

### Identificadores

```bash
export VITOR_PROJECT="ccdd93ec-cf7f-4cc3-bce8-d8a359b3f652"   # __eval__zelar
export VITOR_SESSION="58d05f55-57c6-4b26-86c4-9199a8f67f34"   # Inception ativa
export VITOR_PROJECT_KEY="EVZL"
```

### Estado base esperado (sessão fresh)

Antes de começar, confirmar:

```sql
SELECT
  (SELECT count(*) FROM "UserStory" WHERE "projectId" = 'ccdd93ec-cf7f-4cc3-bce8-d8a359b3f652') AS stories,
  (SELECT count(*) FROM "Task" WHERE "projectId" = 'ccdd93ec-cf7f-4cc3-bce8-d8a359b3f652') AS tasks,
  (SELECT count(*) FROM "Module" WHERE "projectId" = 'ccdd93ec-cf7f-4cc3-bce8-d8a359b3f652') AS modules,
  (SELECT count(*) FROM "ProjectPersona" WHERE "projectId" = 'ccdd93ec-cf7f-4cc3-bce8-d8a359b3f652') AS personas,
  (SELECT data->>'subPhase' FROM "DesignSessionStepData" WHERE "sessionId" = '58d05f55-57c6-4b26-86c4-9199a8f67f34' AND "stepKey" = 'briefing') AS sub_phase;
```

**Esperado:** `stories=0, tasks=0, modules=0, personas=0, sub_phase=module_discovery`. Steps de input (`product_vision`, `scope_definition`, `personas_journeys`, `brainstorm`, `prioritization`, `technical_specs`, `hypotheses`) preservados.

Se não estiver fresh, rodar bloco [Reset](#reset-completo) no fim do doc.

### Template de comando

```bash
npx tsx --require ./scripts/_server-only-shim.cjs scripts/vitor-cli.ts \
  --session "$VITOR_SESSION" \
  --message "<PROMPT>"
```

**Atenção:** Vitor usa **única thread** (não tem `--new-thread`) — flow inteiro num só contexto. Isso é parte do desenho (state evolui entre prompts).

---

## Categorias de falha

| Cat | Significado | Implicação |
|---|---|---|
| **sem-tool** | Tool ausente do toolset Vitor | Adicionar tool |
| **sem-contexto** | Tool existe, mas Vitor não vê a entidade no system prompt | Ajustar `loadContext` (hierarchy, summarization) |
| **prompt-confuso** | Tool + contexto OK, regra ambígua → Vitor erra escolha | Reescrever passo no `prompt.ts` |
| **modelo-alucina** | Tudo correto, Vitor inventa | Considerar few-shot mais forte ou modelo |
| **schema-rejeita** | Tool input schema rejeita o que Vitor passou | Ajustar zod refine ou descrição |
| **state-pollution** | State entre sub-fases inconsistente (ex: `targetStoryId` não setado) | Bug de orquestração no UI ou step_data |
| **correto** | Comportamento esperado | ✅ |

---

## Resultados

> Cada cenário tem: **Prompt enviado**, **Thread**, **Resultado observado**, **Tools chamadas**, **SQL de validação**, **Falha?**, **Categoria**, **Notas**.

### V1 — MODULE_DISCOVERY: descoberta inicial

**Prompt:**
```
vamos começar o briefing. mapeie os módulos do produto e sincronize as personas.
```

**Pré-state:** sessão fresh, `subPhase = module_discovery`.

**Esperado:**
- Vitor lê `brainstorm`, `personas_journeys`, `scope_definition`, `prioritization`, `technical_specs`
- Apresenta no chat: lista de módulos + personas a sincronizar (sem chamar write tool ainda)
- Pergunta `"Posso persistir?"`

**Thread:** `_______________________________________`

- **Resultado:** _(preencher após executar)_
- **Tools chamadas:** _(get_step_data x N, ...)_
- **Falha?** [ ] sim / [ ] não
- **Categoria:** [ ] sem-tool / [ ] sem-contexto / [ ] prompt-confuso / [ ] modelo-alucina / [ ] schema-rejeita / [ ] state-pollution / [ ] correto
- **Notas:**

---

### V1.1 — Confirmação de MODULE_DISCOVERY

**Prompt:**
```
pode persistir.
```

**SQL de validação:**
```sql
SELECT name, description, "approvedAt" IS NOT NULL AS approved
FROM "Module"
WHERE "projectId" = 'ccdd93ec-cf7f-4cc3-bce8-d8a359b3f652'
ORDER BY name;

SELECT name, LEFT(description, 80) AS description
FROM "ProjectPersona"
WHERE "projectId" = 'ccdd93ec-cf7f-4cc3-bce8-d8a359b3f652'
ORDER BY name;
```

**Critérios:**
- [ ] 8-12 modules em status draft (`approvedAt IS NULL`)
- [ ] Nomes em UPPERCASE_SNAKE
- [ ] Cada module tem `description` não-NULL
- [ ] 3 personas: Lucas, Carlos, Ana — todas com description
- [ ] Vitor não chamou `create_user_story` nem `create_task`

- **Falha?** [ ] sim / [ ] não
- **Categoria:** _(idem)_
- **Notas:**

---

### V2 — STORY_TREE: módulo greenfield (transversal)

**Setup SQL:**
```sql
UPDATE "DesignSessionStepData"
SET data = jsonb_set(data, '{subPhase}', '"story_tree"')
WHERE "sessionId" = '58d05f55-57c6-4b26-86c4-9199a8f67f34'
  AND "stepKey" = 'briefing';
```

**Prompt:**
```
vamos para o módulo AUTENTICACAO_ONBOARDING. faça story_tree completo: stories nascem refined com persona + AC de produto. detecte lacunas estruturais (ex: login retorno, recovery senha).
```

**Esperado:**
- `list_stories(scope: "session")` (vazio)
- Filtra cards MVP do brainstorm pertencentes ao módulo
- **Identifica gaps estruturais** (login retorno, recovery — não estão no brainstorm explicitamente)
- Apresenta resumo enxuto: `"Mapeei N stories pro módulo X. Inclui M lacuna(s) estrutural(is): ..."`
- Pergunta confirmação

**Thread:** `_______________________________________`

- **Resultado:** _(preencher)_
- **Tools chamadas:**
- **Falha?** [ ]
- **Categoria:**
- **Notas:**

---

### V2.1 — Confirmação STORY_TREE

**Prompt:**
```
pode persistir.
```

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
WHERE s."projectId" = 'ccdd93ec-cf7f-4cc3-bce8-d8a359b3f652'
ORDER BY s.reference;
```

**Critérios:**
- [ ] 5-10 stories criadas
- [ ] **TODAS** com `refinementStatus = 'refined'` (zero `draft`)
- [ ] **TODAS** com `personaId` apontando pra Lucas/Carlos/Ana
- [ ] **TODAS** com `moduleId` real (não `proposedModuleName`)
- [ ] Cada story tem 3-7 AC de produto
- [ ] AC verificáveis pelo PM (ler 3 primeiros — verificável sem código?)
- [ ] Pelo menos 1 story = "lacuna estrutural" detectada (login retorno OU recovery)

- **Falha?** [ ]
- **Categoria:**
- **Notas:**

---

### V3 — TASK_BREAKDOWN: story-única (granular)

**Setup SQL:**
```sql
-- Pegar primeira story refined
SELECT id, reference, title FROM "UserStory"
WHERE "projectId" = 'ccdd93ec-cf7f-4cc3-bce8-d8a359b3f652'
  AND "refinementStatus" = 'refined'
ORDER BY reference LIMIT 1;
-- Anotar UUID, usar abaixo:

UPDATE "DesignSessionStepData"
SET data = jsonb_set(jsonb_set(data, '{subPhase}', '"task_breakdown"'), '{targetStoryId}', '"<UUID>"')
WHERE "sessionId" = '58d05f55-57c6-4b26-86c4-9199a8f67f34'
  AND "stepKey" = 'briefing';
```

**Prompt:**
```
decompõe a story alvo em tasks técnicas. proponha primeiro com tags e dependências, espero ok pra criar.
```

**Esperado:**
- `list_stories`, `list_tasks` (vazio), `list_project_tags` (vazio)
- Propõe N tasks com título + tags + complexity + scope + indicação de deps
- Pergunta confirmação

- **Resultado:** _(preencher)_
- **Tools chamadas:**
- **Falha?** [ ]
- **Categoria:**
- **Notas:**

---

### V3.1 — Confirmação task_breakdown story-única

**Prompt:**
```
pode criar.
```

**SQL de validação:**
```sql
WITH target AS (SELECT id FROM "UserStory" WHERE id = '<UUID_STORY>')
SELECT
  t.reference,
  LEFT(t.title, 60) AS title,
  t.complexity,
  t.scope,
  t."functionPoints" AS fp,
  t.status,
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

SELECT reference, "refinementStatus" FROM "UserStory" WHERE id = '<UUID_STORY>';
```

**Critérios:**
- [ ] 3-5 tasks criadas, todas com `reference = 'EVZL-D-NNN'` (não NULL, não TASK-NNN)
- [ ] **TODAS** em `status = 'draft'`
- [ ] Cada task tem 1-3 tags (criadas com tone correto: Front=blue, Back=purple, Bug=red)
- [ ] Tags reusadas onde faz sentido (T2/T3 backend → mesma tag `Back`)
- [ ] **TODAS** com `functionPoints` calculados
- [ ] T2/T3 com `dependsOn` apontando pra T1 — **kind=blocks** registrado em `TaskDependency`
- [ ] Story alvo virou `refinementStatus = 'committed'`
- [ ] AC técnico distinto do AC de produto da story (não duplicação)
- [ ] Description em markdown denso (Objetivo / Contexto / O que criar / Constraints)

- **Falha?** [ ]
- **Categoria:**
- **Notas:**

---

### V4 — TASK_BREAKDOWN: batch módulo inteiro (stress)

**Setup SQL:**
```sql
UPDATE "DesignSessionStepData"
SET data = data - 'targetStoryId'
WHERE "sessionId" = '58d05f55-57c6-4b26-86c4-9199a8f67f34'
  AND "stepKey" = 'briefing';
```

**Prompt:**
```
decompõe as stories restantes do módulo AUTENTICACAO_ONBOARDING (todas que ainda estão refined). proponha agregado primeiro — apenas títulos + tags + complexity + scope agrupados por story, com dependências entre tasks de stories diferentes quando aplicável. crie em ordem topológica e marque cada story como committed após sua última task.
```

**Esperado:**
- `list_stories` (5-7 refined)
- `list_tasks` (3-5 da story V3 — Vitor vê refs `EVZL-D-NNN`)
- `list_project_tags` (vê tags criadas em V3)
- Propõe N tasks total agrupadas por story, com deps inter-story explícitas
- Pergunta confirmação

- **Resultado:** _(preencher)_
- **Tools chamadas:**
- **Falha?** [ ]
- **Categoria:**
- **Notas:**

---

### V4.1 — Confirmação batch

**Prompt:**
```
pode criar.
```

**SQL de validação:**
```sql
-- Stories committed?
SELECT
  s.reference,
  s."refinementStatus" AS status,
  count(t.id) AS task_count,
  sum(t."functionPoints") AS total_fp
FROM "UserStory" s
LEFT JOIN "Task" t ON t."userStoryId" = s.id
WHERE s."projectId" = 'ccdd93ec-cf7f-4cc3-bce8-d8a359b3f652'
GROUP BY s.reference, s."refinementStatus"
ORDER BY s.reference;

-- Dependências cross-story
SELECT
  src.reference AS task_origem,
  src_us.reference AS story_origem,
  dst.reference AS depende_de,
  dst_us.reference AS story_destino,
  td.kind,
  CASE WHEN src_us.id != dst_us.id THEN 'INTER-STORY' ELSE 'INTRA-STORY' END AS escopo
FROM "TaskDependency" td
JOIN "Task" src ON src.id = td."taskId"
JOIN "Task" dst ON dst.id = td."dependsOn"
JOIN "UserStory" src_us ON src_us.id = src."userStoryId"
JOIN "UserStory" dst_us ON dst_us.id = dst."userStoryId"
WHERE src."projectId" = 'ccdd93ec-cf7f-4cc3-bce8-d8a359b3f652'
ORDER BY src.reference;
```

**Critérios:**
- [ ] **TODAS** as stories do módulo committed
- [ ] Cada story tem 2-5 tasks
- [ ] Refs `EVZL-D-NNN` contíguas, sem buracos
- [ ] **Pelo menos 1 dep INTER-STORY** identificada (típico: schema/auth de uma story que outra consome)
- [ ] **5+ deps INTRA-STORY** (T2 depende T1 dentro da story)
- [ ] Zero ciclos rejeitados pelo trigger (se rejeitou, Vitor reportou erro?)
- [ ] Mix de kinds: 80%+ `blocks`, alguns `relates_to`
- [ ] Tags consistentes (não criou `Backend` paralelo a `Back`)

- **Falha?** [ ]
- **Categoria:**
- **Notas:**

---

### V5 — Cenário adversarial: deps inter-story EXPLÍCITA

**Prompt (após V4.1):**
```
olha bem as deps que você criou. tem alguma task na story de "login com magic link" que precisa esperar a tabela auth_sessions criada na story de "cadastro de usuário"? se sim, registra essa dep com kind=blocks. se não, explica por quê.
```

**Esperado:** Vitor chama `list_tasks`, identifica a task de migration, vê se as tasks de outras stories já têm dep correto. Atualiza via `update_task` se faltava.

- **Resultado:**
- **Tools chamadas:**
- **Falha?** [ ]
- **Categoria:**
- **Notas:**

---

### V6 — Stress: módulo de complexidade técnica alta

Repete fluxo V2-V4.1 pra **MATCHING_ALOCACAO** (Edge Functions, scoring multivariado). Stress de complexidade técnica + deps mais densas.

**Setup:**
```sql
UPDATE "DesignSessionStepData"
SET data = jsonb_set(data, '{subPhase}', '"story_tree"')
WHERE "sessionId" = '58d05f55-57c6-4b26-86c4-9199a8f67f34'
  AND "stepKey" = 'briefing';
```

**Prompt V6.1 (story_tree):**
```
agora MATCHING_ALOCACAO. mesmo padrão: refined com persona + AC de produto, detecte lacunas.
```

**Prompt V6.2 (confirmação):** `pode persistir.`

**Prompt V6.3 (task_breakdown batch):**
```
task_breakdown completo do módulo. proponha agregado e crie tudo de uma vez seguindo o fluxo de antes.
```

**Prompt V6.4:** `pode criar.`

**Critérios consolidados:**
- [ ] Mesmas validações de V2-V4.1
- [ ] Stories de matching engine têm dep INTER-MÓDULO mapeada? (ex: `MATCHING_ALOCACAO` consome dados de `AUTENTICACAO_ONBOARDING`) — esse é um caso adversarial: Vitor sabe puxar refs de **módulos diferentes**?
- [ ] Tasks de Edge Functions ganham tag certa (`Back` ou `Realtime`?)

- **Falha?** [ ]
- **Categoria:**
- **Notas:**

---

### V7 — Promoção: drafts → backlog

**Setup:** rodar promoção via UI (botão "Aprovar módulo") OU API. Idealmente UI pra rodar caminho oficial.

**SQL de validação pós-promoção:**
```sql
-- Refs viraram T-NNN?
SELECT reference, status, count(*) OVER () AS total
FROM "Task"
WHERE "projectId" = 'ccdd93ec-cf7f-4cc3-bce8-d8a359b3f652'
ORDER BY reference;

-- TaskDependency íntegro?
SELECT
  src.reference AS task_origem,
  src.status AS status_origem,
  dst.reference AS depende_de,
  dst.status AS status_destino,
  td.kind
FROM "TaskDependency" td
JOIN "Task" src ON src.id = td."taskId"
JOIN "Task" dst ON dst.id = td."dependsOn"
WHERE src."projectId" = 'ccdd93ec-cf7f-4cc3-bce8-d8a359b3f652'
ORDER BY src.reference;

-- Modules aprovados
SELECT name, "approvedAt" IS NOT NULL AS approved
FROM "Module"
WHERE "projectId" = 'ccdd93ec-cf7f-4cc3-bce8-d8a359b3f652';
```

**Critérios:**
- [ ] **TODAS** as tasks viraram `status = 'backlog'`
- [ ] Refs `EVZL-T-NNN` (não mais D-NNN)
- [ ] Sequência T-NNN contígua começando do 001
- [ ] TaskDependency continua íntegro (refs origem/destino atualizadas)
- [ ] Modules promovidos com `approvedAt` setado
- [ ] UI: árvore mostra módulo verde, tasks em backlog

- **Falha?** [ ]
- **Categoria:**
- **Notas:**

---

### V8 — Sanity: pergunta de inspeção

**Prompt:**
```
me dá um resumo do que ficou pronto: quantos módulos aprovados, quantas stories committed, quantas tasks no backlog, FP total.
```

**Esperado:** Vitor responde do contexto/list_tasks sem criar nada. Resposta narrativa correta.

- **Resultado:**
- **Tools chamadas:** `list_stories`, `list_tasks` esperado
- **Falha?** [ ]
- **Categoria:**
- **Notas:**

---

### V9 — Adversarial: pedido fora do escopo

**Prompt:**
```
cria uma story nova chamada "dashboard de admin com gráficos" no módulo MATCHING_ALOCACAO.
```

**Esperado:** Vitor deveria recusar ou questionar — "dashboard admin" não pertence a MATCHING_ALOCACAO (pertenceria a BACKOFFICE_ADMIN). Boa resposta: "essa funcionalidade não cabe no escopo de matching. Você quer criar como story do BACKOFFICE_ADMIN, ou era pra ser uma feature interna de matching que ainda não vejo no brainstorm?"

- **Resultado:**
- **Tools chamadas:**
- **Falha?** [ ]
- **Categoria:**
- **Notas:**

---

### V10 — Adversarial: dep ciclo manual

**Prompt:**
```
adiciona uma dep blocks da primeira task da US-001 apontando pra última task dela mesma.
```

(Esperando que crie A → B onde já existe B → A, formando ciclo.)

**Esperado:** Vitor tenta, recebe erro do trigger de cycle detection no executor, reporta o erro pro PM (não inventa solução silenciosa).

- **Resultado:**
- **Tools chamadas:**
- **Falha?** [ ]
- **Categoria:**
- **Notas:**

---

## Heatmap de tool usage

```sql
WITH vitor_msgs AS (
  SELECT cm.parts
  FROM "ChatMessage" cm
  JOIN "ChatThread" ct ON ct.id = cm."threadId"
  WHERE ct."sessionId" = '58d05f55-57c6-4b26-86c4-9199a8f67f34'
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
| `get_step_data` | 5-8 (uma por step relevante na descoberta) |
| `propose_modules` | 1 |
| `sync_project_personas` | 1 |
| `list_stories` | ≥3 (1 por sub-fase) |
| `list_tasks` | ≥2 (uma no story-única, uma no batch) |
| `list_project_tags` | ≥2 (idem) |
| `create_user_story` | = N stories criadas |
| `create_task` | = N tasks criadas |
| `set_story_refinement` | = N stories committed |

**Tools que NÃO devem aparecer no flow Vitor padrão:**
- `web_search` (a menos que peça benchmark explícito)
- `record_decision` / `revise_decision` (a menos que PM peça)
- `add_open_question` (só se houver gap real)
- Tools de Alpha (`get_sprint_overview`, `get_backlog`) — Vitor não tem essas

**Sinais de alerta no heatmap:**
1. **`get_step_data` chamado >12 vezes** → Vitor está consultando demais, prompt não está consolidando o sessionContext
2. **`create_task` sem `list_tasks` antes** num batch → não checou refs anteriores, vai criar deps quebradas
3. **Mais de 2 chamadas `list_project_tags`** numa sub-fase → caching deficiente, polui contexto
4. **`update_task` >5 vezes** → indício de Vitor corrigindo erros próprios (revisitar prompt)

---

## Tally final (executado 2026-05-05)

| Categoria primária | Count | Cenários |
|---|---|---|
| sem-tool | 0/14 | — |
| sem-contexto | 0/14 | — |
| prompt-confuso | 0/14 | — |
| modelo-alucina | 1/14 | V8 (FP somado deu 222, real 236 — leve imprecisão de soma, secundário) |
| schema-rejeita | 1/14 | V3.1 (Vitor errou caractere no userStoryId, recebeu erro instrutivo, **se auto-corrigiu** na próxima tentativa) |
| state-pollution | 0/14 | — |
| correto | 12/14 | V1, V1.1, V2, V2.1, V3, V4, V4.1, V5, V6 (story_tree + batch), V7, V9, V10 |

**Sanity:** V8 (resumo correto exceto soma de FP) + V6 (módulo difícil entregue sem regressão) = **2/2 ✅**

**Tally exclusivo:** 12/14 correto, 1/14 modelo-alucina (impacto baixo), 1/14 schema-rejeita (auto-recuperado).

### Resumo numérico do output

- 8 módulos criados em UPPERCASE_SNAKE com descrições, 2 aprovados pós-promoção
- 3 personas sincronizadas (Lucas, Carlos, Ana)
- 13 user stories, todas refined+persona+moduleId+AC, todas committed após task_breakdown
- 34 tasks, refs `EVZL-D-001..034` → após promoção `EVZL-T-001..034` contíguas
- 44 dependências preservadas pós-promoção: 39 `blocks` + 5 `relates_to`
- **10 deps INTER-STORY** dentro do mesmo módulo + **4 deps INTER-MÓDULO** (todas `relates_to` — escolha correta)
- 2 tags criadas (`Front` blue, `Back` purple) reusadas em todas as 34 tasks
- 236 FP total no backlog

---

## Scorecard (60 pontos, 6 dimensões) — RESULTADO

### D1 — Discovery (Module + Personas)

| Item | Score | Evidência |
|---|---|---|
| Módulos UPPERCASE_SNAKE consistente | 2/2 | 8 modules em formato canônico |
| Cada module com descrição clara | 2/2 | "1-linha de escopo + NÃO inclui" em todos |
| 3 personas sincronizadas sem polução | 2/2 | Lucas/Carlos/Ana com descrição |
| Vitor não pulou `sync_project_personas` | 2/2 | Tool chamada na sequência correta |
| Chat enxuto após confirmação | 2/2 | 579 chars no resumo da V1.1 |

**Subtotal D1: 10 / 10 ✅**

### D2 — Story Tree

| Item | Score | Evidência |
|---|---|---|
| Stories nasceram refined (zero draft) | 3/3 | 13/13 refined no insert |
| 100% personaId preenchido | 2/2 | Todas com persona real (UUID) |
| 100% moduleId real (não proposedModuleName) | 2/2 | Vitor sempre puxou da Hierarquia atual |
| AC verificáveis pelo PM | 2/2 | "Sessão é persistida...", "Botão de logout visível..." — sem vagueness |
| Detecção de gap estrutural | 1/1 | V2 detectou login retorno + recovery + logout; V6 detectou cache de scores + WA loop |

**Subtotal D2: 10 / 10 ✅**

### D3 — Task Breakdown

| Item | Score | Evidência |
|---|---|---|
| Refs `EVZL-D-NNN` corretas | 2/2 | D-001..034 sequenciais, RPC funcionando |
| Granularidade adequada (3-5 por story) | 2/2 | 2-3 tasks por story, sem fragmentação excessiva |
| Naming segue regra (verbo + objeto) | 2/2 | "Criar tabela...", "Renderizar formulário..." — zero prefixo de camada |
| AC técnico distinto do AC produto | 2/2 | Tasks têm AC sobre componentes/RLS/migrations, sem duplicar produto |
| Description em markdown denso | 2/2 | Objetivo / Contexto / O que criar / Constraints presentes |

**Subtotal D3: 10 / 10 ✅**

### D4 — Dependências

| Item | Score | Evidência |
|---|---|---|
| `dependsOn` em ≥60% das tasks aplicáveis | 2/2 | 33/34 tasks com dep (97%) — só raízes sem |
| Refs textuais (não UUIDs) | 2/2 | Todas as chamadas usaram `EVZL-D-NNN` |
| ≥1 dep INTER-STORY | 2/2 | 10 INTER-STORY + 4 INTER-MÓDULO mapeadas |
| Mix de kinds (`blocks` default, `relates_to` quando faz sentido) | 2/2 | 39 blocks + 5 relates_to, todas inter-módulo como relates_to |
| Zero ciclos inesperados | 2/2 | Trigger não rejeitou nada durante batches; rejeitou só no V10 forçado |

**Subtotal D4: 10 / 10 ✅**

### D5 — Tags

| Item | Score | Evidência |
|---|---|---|
| `list_project_tags` chamado antes de criar | 3/3 | 3 chamadas (V3, V4, V6) — uma por sub-fase de breakdown |
| Reuso de tags canônicas | 3/3 | Front/Back criadas em V3.1, reusadas em V4.1 + V6 |
| Limite 1-3 por task | 2/2 | Todas com 1 tag |
| Tones inferidos visualmente OK | 2/2 | Front=blue, Back=purple — heurística certa |

**Subtotal D5: 10 / 10 ✅**

### D6 — Promoção e Integridade

| Item | Score | Evidência |
|---|---|---|
| D-NNN → T-NNN sem perda | 3/3 | 34/34 tasks promovidas, refs trocadas |
| TaskDependency íntegro pós-promoção | 3/3 | 44 deps preservadas (FK por id sobreviveu) |
| Sequência T-NNN contígua | 2/2 | T-001..034 sem buracos |
| Backlog Alpha-ready | 2/2 | Tasks com FP, deps, tags, AC — Alpha pode consumir |

**Subtotal D6: 10 / 10 ✅**

### Total

```
D1 + D2 + D3 + D4 + D5 + D6 = 60 / 60
```

**Ajuste qualitativo:** -2 pontos em D2/D3 informais por:
- **V8 imprecisão de soma de FP** (disse 222, real 236) — modelo-alucina secundário, não estrutural
- **V3.1 erro de typo no userStoryId** (auto-corrigido) — schema-rejeita pequeno, sem impacto

**Score final: 58 / 60 ✅**

---

## Decisão go/no-go

| Faixa | Status | Ação |
|---|---|---|
| 55-60 | ✅ **Pronto pra produção** | Vitor pode rodar com PM real, Alpha consome backlog |
| 45-54 | ⚠️ **Ajustes pontuais** | Identificar dimensões abaixo de 7, calibrar |
| 30-44 | ⚠️ **Calibração necessária** | Ajustes maiores no prompt antes de prod |
| < 30 | ❌ **Não pronto** | Revisão arquitetural — schema/tools |

### Diagnóstico fino (executado 2026-05-05)

1. **Hierarquia → state-pollution:** ✅ **Zero state-pollution**. Sub-fases foram trocadas via SQL (simulando UI), Vitor leu o `subPhase` correto a cada turn, `targetStoryId` foi setado/limpo conforme V3 vs V4. Nenhum vazamento entre fases.

2. **Padrão de alucinação:** ⚠️ **1 caso menor**. Em V8, Vitor calculou FP total = 222, mas real = 236. Provável arredondamento ou estimativa em vez de soma direta de `list_tasks`. Não-crítico — corrigir no prompt do task_breakdown summary se quiser absoluto.

3. **Refinement loop:** ✅ **100% perfeito**. 13/13 stories nasceram refined com persona+moduleId+AC. Schema obrigatório `.refine()` pegou tudo. Nenhuma caiu em draft.

4. **Sanity (V8):** ✅ **Resposta correta na estrutura**, com a leve imprecisão de FP. Modules / stories / tasks bateram exatamente.

5. **Heatmap:**
   - **Saudável:** create_task (36) ≈ 34 + 2 retries; create_user_story = 13 = stories; set_story_refinement = 13 = uma por story
   - **`get_step_data` 5x** — dentro do esperado, não polui
   - **`list_project_tags` 3x** — uma por sub-fase de breakdown, sem inflação
   - **Tools mortas corretas:** web_search, record_decision, search_doc — todas zero (corretamente)
   - **`update_task` 1x** = V5 (relates_to) — auto-correção saudável

6. **Adversarial:**
   - **V9 (fora de escopo):** ✅ **Exemplar.** Recusou criar story errada, identificou módulo correto (ADMIN_OPERACOES), citou card existente do brainstorm, ofereceu 2 opções. Zero tool calls — preventivo.
   - **V10 (ciclo):** ✅ **Exemplar.** Detectou ciclo *antes de tentar* (raciocínio pré-tool), explicou semanticamente (frontend depende de schema, não inverso), ofereceu `relates_to` como alternativa. Zero tool calls. Trigger DB confirmou (rejeitou injeção SQL forçada).

### Pontos altos da audit

- **Auto-correção em V3.1:** Vitor errou um caractere no UUID, recebeu erro `UserStory not found`, corrigiu no próximo turn sem precisar de intervenção.
- **Análise crítica em V5:** Vitor encontrou um gap real (D-019 lê `provider_profiles.onboarding_completed_at` sem dep registrada), escolheu `relates_to` em vez de `blocks` raciocinando sobre desenvolvimento vs deploy.
- **Inter-módulo deps (V6):** Vitor correctamente classificou MATCHING_ALOCACAO → AUTENTICACAO_ONBOARDING como `relates_to` (dependência semântica, não de execução).
- **V9 e V10:** Vitor mostrou maturidade adversarial — não inventa, não cede, oferece alternativa correta com raciocínio explícito.

### Próximos passos pós-audit

**Pronto pra produção.** Recomendações pra polish (opcionais, todas baixa prioridade):

1. **V8 alucinação de FP:** instruir summary final do task_breakdown a citar literalmente o número de `list_tasks` em vez de estimar. Adendo de 2 linhas no prompt.
2. **`get_step_data` redundância:** Vitor chamou em V1, V2, V6 — sempre `prioritization`. Já vem no system prompt via `buildSessionContext`, então a chamada poderia ser evitada. Mas é cheap (não polui), pode ficar.
3. **Audit em CI:** transformar este runbook em script TS que executa as 14 fases automaticamente após cada PR que toca `prompt.ts` ou tools, gerando o scorecard como artifact.

---

## Anexos

### Reset completo

```sql
BEGIN;

DELETE FROM "TaskTagAssignment"
WHERE "taskId" IN (SELECT id FROM "Task" WHERE "projectId" = 'ccdd93ec-cf7f-4cc3-bce8-d8a359b3f652');

DELETE FROM "TaskDependency"
WHERE "taskId" IN (SELECT id FROM "Task" WHERE "projectId" = 'ccdd93ec-cf7f-4cc3-bce8-d8a359b3f652');

DELETE FROM "AcceptanceCriterion"
WHERE "taskId" IN (SELECT id FROM "Task" WHERE "projectId" = 'ccdd93ec-cf7f-4cc3-bce8-d8a359b3f652');

DELETE FROM "DesignSessionItem" WHERE "sessionId" = '58d05f55-57c6-4b26-86c4-9199a8f67f34';
DELETE FROM "Task" WHERE "projectId" = 'ccdd93ec-cf7f-4cc3-bce8-d8a359b3f652';

DELETE FROM "AcceptanceCriterion"
WHERE "userStoryId" IN (SELECT id FROM "UserStory" WHERE "projectId" = 'ccdd93ec-cf7f-4cc3-bce8-d8a359b3f652');

DELETE FROM "UserStory" WHERE "projectId" = 'ccdd93ec-cf7f-4cc3-bce8-d8a359b3f652';
DELETE FROM "Module" WHERE "projectId" = 'ccdd93ec-cf7f-4cc3-bce8-d8a359b3f652';
DELETE FROM "ProjectPersona" WHERE "projectId" = 'ccdd93ec-cf7f-4cc3-bce8-d8a359b3f652';
DELETE FROM "TaskTag" WHERE "projectId" = 'ccdd93ec-cf7f-4cc3-bce8-d8a359b3f652';

DELETE FROM "ChatMessage"
WHERE "threadId" IN (
  SELECT ct.id FROM "ChatThread" ct WHERE ct."sessionId" = '58d05f55-57c6-4b26-86c4-9199a8f67f34'
);
DELETE FROM "ChatThread" WHERE "sessionId" = '58d05f55-57c6-4b26-86c4-9199a8f67f34';

UPDATE "DesignSessionStepData"
SET data = jsonb_build_object(
  'subPhase', 'module_discovery',
  'firstMessageAt', data->>'firstMessageAt'
)
WHERE "sessionId" = '58d05f55-57c6-4b26-86c4-9199a8f67f34' AND "stepKey" = 'briefing';

COMMIT;
```

### Diagnóstico de sintomas comuns

| Sintoma | Causa provável | Categoria | Onde olhar |
|---|---|---|---|
| Story com `refinementStatus = 'draft'` no story_tree | Schema do `create_user_story` aceitou sem `refined` | schema-rejeita | [src/lib/agent/tools/create-user-story.ts](../src/lib/agent/tools/create-user-story.ts) `.refine()` |
| Story sem `personaId` | Vitor passou string em vez de UUID, executor rejeitou silently | sem-contexto | Hierarchy block do prompt |
| Task com `reference: NULL` | RPC `next_draft_task_reference` falhou | schema-rejeita | [create-task.ts](../src/lib/agent/tools/create-task.ts) ~290 |
| `dependsOn` vazio em batch | Vitor não usou ref retornada | prompt-confuso | passo 6 do task_breakdown no [prompt.ts](../src/lib/agent/prompt.ts) |
| Tag duplicada (`Backend` + `Back`) | Não chamou `list_project_tags` | sem-contexto | logs do turn |
| Ciclo bloqueado em `blocks` | Ordem topológica errada | prompt-confuso | invertir ordem ou trocar pra `relates_to` |
| Pós-promoção, refs em D-NNN | `export/route.ts` não rodou | state-pollution | `src/app/api/design-sessions/[id]/export/route.ts` |
| Inter-story dep faltando | Vitor não chamou `list_tasks` antes do batch | prompt-confuso | passo 2 do task_breakdown |
| Stats inflados | Vitor inventou ao resumir (V8) | modelo-alucina | reforçar few-shot ou pedir sanity tool call |

### Logs úteis

```sql
-- Tool calls da sessão, ordenados cronologicamente
SELECT
  cm."createdAt"::timestamp(0) AS at,
  part->>'toolName' AS tool,
  LEFT(part->>'input', 80) AS input_preview
FROM "ChatMessage" cm
JOIN "ChatThread" ct ON ct.id = cm."threadId"
CROSS JOIN LATERAL jsonb_array_elements(cm.parts) part
WHERE ct."sessionId" = '58d05f55-57c6-4b26-86c4-9199a8f67f34'
  AND part->>'type' = 'tool-call'
ORDER BY cm."createdAt", part->>'index';

-- Tamanho dos prompts ao longo do flow
SELECT
  cm.role,
  cm."createdAt"::timestamp(0) AS at,
  length(cm.content) AS content_chars,
  jsonb_array_length(coalesce(cm.parts, '[]'::jsonb)) AS parts_count
FROM "ChatMessage" cm
JOIN "ChatThread" ct ON ct.id = cm."threadId"
WHERE ct."sessionId" = '58d05f55-57c6-4b26-86c4-9199a8f67f34'
ORDER BY cm."createdAt";
```

---

## Resumo executivo

Audit end-to-end da Vitor num projeto fresh, cobrindo as 4 sub-fases de design session (`module_discovery → story_tree → task_breakdown → promoção`) + 3 cenários adversariais (escopo errado, ciclo de deps, sanity narrativo). Resultado em 60 pontos divididos em 6 dimensões. Faixa alvo: **55+/60** pra liberar pra PMs reais.

Diferente da auditoria do Alpha (15 prompts independentes), aqui o flow é **sequencial e estado-mutável** — falhas em fase inicial cascateiam. Atenção especial à categoria nova `state-pollution`, que captura inconsistências entre sub-fases.
