# Vitor Runbook — End-to-End `__eval__zelar`

**Data inicial:** 2026-05-05
**Sessão Vitor:** `58d05f55-57c6-4b26-86c4-9199a8f67f34` ("Inception Zelar [eval]")
**Projeto:** `__eval__zelar` (referenceKey: `EVZL`, projectId via SQL)
**Owner do runbook:** João Moraes (member_id descobrir via SQL — ver § Pré-requisitos)

## Objetivo

Conduzir Vitor end-to-end nos 6 módulos restantes do `__eval__zelar`, gerando stories + tasks alinhadas ao brainstorm (94 cards, 56 únicos), e produzir um relatório de cobertura que sirva de blueprint pro futuro **Alpha-orquestrador**.

## Done

- 8/8 módulos com `approvedAt IS NOT NULL`
- Todos os 56 cards únicos do brainstorm cobertos por ≥1 story (ou justificadamente fora-de-escopo)
- Backlog T-NNN consolidado, dependências inter-módulo identificadas
- Relatório final preenchido em "§ Audit final" abaixo
- Aprendizados de orquestração capturados em "§ Aprendizados pro Alpha-orquestrador"

---

## Pré-requisitos (LEIA ANTES DE COMEÇAR)

Este runbook é executado **diretamente pelo agente Claude via CLI** — não há humano-no-loop colando prompts em UI web. Vitor é invocado como subprocess.

### Separação de papéis (LEIA PRIMEIRO)

- **Vitor é o executor.** Toda mutação de dados de domínio (módulos, stories, tasks, ACs, dependências, refinement status) acontece via **tools dele**, não via SQL. Se você está prestes a rodar `INSERT/UPDATE/DELETE` em `Module`, `UserStory`, `Task`, `TaskDependency`, `AcceptanceCriterion`, `TaskTagAssignment` — pare. Isso é trabalho do Vitor. Mande um turn pedindo pra ele fazer.
- **Orquestrador (Claude) é o validador + gatilho de aprovação.** Você pode/deve:
  - Rodar SQL **read-only** pra validar estado entre turns.
  - Disparar o **endpoint HTTP de aprovação** (`POST /api/modules/[id]/approve`) — esse é o stand-in legítimo do humano clicando "Aprovar" no UI; ele cascateia `Module.approvedAt` E promove `tasks draft→backlog` numa única transação.
  - Ler logs do CLI pra decidir o próximo turn.
- **Anti-padrão:** rodar SQL `INSERT INTO Module` ou `UPDATE Task SET status='backlog'` direto. Isso pula auditoria (`ModuleActivity`), pula validações de domínio, e mais importante — **destrói o aprendizado do Vitor sobre o ciclo completo**, que é justamente o que estamos coletando pro Alpha-orquestrador.

### Tools de mutação que o Vitor tem (use estas, não SQL)

| Operação | Tool do Vitor |
|---|---|
| Propor módulos novos em batch | `propose_modules` |
| Criar story | `create_user_story` (aceita `moduleId` ou `proposedModuleName`) |
| Editar story (title/want/soThat/moduleId/personaId) | `update_user_story` |
| Criar task | `create_task` (com `userStoryId`, `dependsOn`, tags) |
| Editar task | `update_task` |
| Adicionar/editar/remover AC | `manage_story_ac` |
| Mudar refinement status | `set_story_refinement` |
| Promover proposedModuleName → Module aprovado (sem promover tasks) | `approve_module` |

**Nota sobre `approve_module`**: marca `Module.approvedAt=now()` e linka stories pendentes, mas **não promove tasks draft→backlog**. A promoção só acontece via endpoint HTTP (próxima seção). Use a sequência: Vitor cria/aprova módulo → orquestrador chama endpoint pra promover tasks. Ou, mais simples: deixe Vitor criar módulo via `propose_modules` (draft) e o orquestrador chama o endpoint, que faz `approvedAt=now() + promote tasks` numa transação só.

### Aprovação cascata via endpoint (o "clique humano" simulado)

```bash
# Substitua <MODULE_ID> pelo id obtido via SQL read-only
curl -sS -X POST "http://localhost:3000/api/modules/<MODULE_ID>/approve" \
  -H "Cookie: $(cat /tmp/vitor-runbook/auth-cookie.txt)" | jq .
```

Esse endpoint requer auth MANAGER+. Quando estiver rodando local sem servidor de pé, alternativa: chamar diretamente a função DAL via um pequeno script, OU usar o endpoint exposto pela rotina `vitor-cli` se houver. **O importante é não substituir o ciclo por SQL ad-hoc** — preserva a Activity, o cascade, e o aprendizado.



### Como invocar Vitor

Existe um CLI completo em [scripts/vitor-cli.ts](../scripts/vitor-cli.ts) que espelha exatamente o connector web (mesmas tools, mesmo prompt, mesma persistência em `ChatThread`/`ChatMessage`).

**Comando padrão:**

```bash
bun x tsx --require ./scripts/_server-only-shim.cjs scripts/vitor-cli.ts \
  --session 58d05f55-57c6-4b26-86c4-9199a8f67f34 \
  --message "<prompt aqui>"
```

Para mensagens longas (ex: prompt com brainstorm completo):
```bash
echo "<prompt longo>" > /tmp/prompt.txt
bun x tsx --require ./scripts/_server-only-shim.cjs scripts/vitor-cli.ts \
  --session 58d05f55-57c6-4b26-86c4-9199a8f67f34 \
  --message-file /tmp/prompt.txt
```

**Flags úteis:**
- `--advance-to <stepIndex>` — só usar se precisar trocar de step (ex: voltar pra brainstorm). Ver § "Steps da sessão".
- O output do CLI inclui: tool calls com input/output preview, texto do Vitor, resumo final.

### Steps da sessão atual

```
0 → pre_work       (skipped)
1 → product_vision
2 → scope_definition
3 → personas_journeys
4 → brainstorm     (94 cards aqui)
5 → risks_gaps
6 → prioritization
7 → technical_specs
8 → hypotheses
9 → briefing       ← step atual, onde criar stories+tasks acontece
```

`currentStep=9` (briefing) é o único que habilita `createTasks: true` no capabilities. **Não voltar pra outro step durante o runbook.**

### Antes do primeiro turn

Rodar 4 queries iniciais via psql (já feito uma vez — valores documentados aqui):

| Item | Valor |
|---|---|
| **memberId (João Moraes)** | `dc4d91f5-0d29-453a-b11e-d42dd6a7b158` |
| **projectId EVZL** | `ccdd93ec-cf7f-4cc3-bce8-d8a359b3f652` |
| **sessionId** | `58d05f55-57c6-4b26-86c4-9199a8f67f34` |
| **Status sessão** | `in_progress` |
| **currentStep** | `9` (briefing) |

Reconfirmar via SQL antes de começar (estado pode ter mudado entre runs):

```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql "$DIRECT_URL" -t -c "
SELECT m.name, m.\"approvedAt\" IS NOT NULL AS approved,
  count(DISTINCT us.id) AS stories,
  count(DISTINCT t.id) AS tasks,
  COALESCE(sum(t.\"functionPoints\"), 0) AS fp
FROM public.\"Module\" m
LEFT JOIN public.\"UserStory\" us ON us.\"moduleId\" = m.id
LEFT JOIN public.\"Task\" t ON t.\"userStoryId\" = us.id
JOIN public.\"Project\" p ON p.id = m.\"projectId\"
WHERE p.\"referenceKey\" = 'EVZL'
GROUP BY m.name, m.\"approvedAt\"
ORDER BY m.name;
"
```

### Contexto do sistema (essencial)

- **Refs de tasks são `<KEY>-T-NNN`** (ex: `EVZL-T-001`) **desde a criação**. Status flutua draft→backlog→todo→… mas a ref nunca muda.
- **Vitor cria tasks via tool `create_task`** com `userStoryId` obrigatório. Tasks nascem em `status='draft'`.
- **Aprovar módulo** flipa `Module.approvedAt` E muda tasks `draft → backlog` em massa via [promoteTasksForModule](../src/lib/dal/story-hierarchy.ts). Pode ser feito via UI ou SQL direto (ver § Fase D).
- **Dependências** vivem em `TaskDependency` com `kind ∈ {blocks, relates_to}`. `blocks` tem cycle detection no DB. `relates_to` é informativo.
- **Brainstorm** é `stepKey='brainstorm'` da sessão, `data->'solutions'` é array de 94 cards. Cada card tem `id`, `title` (com tag `[MODULO][PERSONA]`), `userFlows`, `keyScreens`, `howItSolves`, `painPointRef`, `targetPersona`, `technicalNotes`. Vitor lê via tool `get_step_data('brainstorm')`.
- **Prompt do Vitor**: [src/lib/agent/prompt.ts](../src/lib/agent/prompt.ts). Sub-fases: `module_discovery`, `story_tree`, `task_breakdown`.

### Quando interromper o loop e pedir input do usuário

Apesar de automatizado, há decisões que **podem** requerer input humano. No modo "100% autônomo", o orquestrador toma essas decisões com base em contexto do projeto (design session, brainstorm, módulos já aprovados). Pause apenas quando:

- **Vitor produzir output anômalo repetido** (granularidade errada após 2+ turns, alucinação grave, FP=null sistemático).
- **Conflito interno** (ex: 2 módulos têm o mesmo nome, ou uma story já aprovada precisa ser refeita).
- **Operação destrutiva** que sai do happy path (ex: renomear módulo já aprovado).

Decisões que **NÃO** precisam pausar em modo autônomo (orquestrador decide):
- Renomear/criar módulo proposto pelo Vitor (ex: KYC vs PERFIL_PRESTADOR).
- Unificar/separar módulos (ex: SOLICITACAO_PAGAMENTO + FINANCEIRO_DO_PRESTADOR).
- Justificar card como fora-de-escopo MVP (com base em prioritization/MoSCoW da própria sessão).

**Regra geral:** se a decisão pode ser inferida do brainstorm/prioritization/personas da sessão, decida. Senão, pause.

### Comportamento esperado em erro

- **Refs órfãs em `dependsOn`**: Vitor retorna `error: "Refs de dependsOn nao encontradas..."` — ele se recupera sozinho.
- **23505 (UNIQUE collision em ref)**: handled internamente com retry de 5 tentativas.
- **Cycle detection**: Vitor detecta antes de chamar a tool; caso passe, o trigger do DB rejeita.
- **Agent timeout no CLI**: aumentar `timeout` da Bash call. Default 2min é apertado pra batches grandes — usar 5-10min.

---

## Estado inicial

| Módulo                          | Approved | Stories | Tasks | FP   | Cards (único) |
| ------------------------------- | -------- | ------- | ----- | ---- | ------------- |
| AUTENTICACAO_ONBOARDING         | ✅       | 9       | 23    | 121  | 9 (ONBOARDING) |
| MATCHING_ALOCACAO               | ✅       | 4       | 11    | 115  | 5 (MATCHING)   |
| KYC_VERIFICACAO_DE_PRESTADORES  | ❌       | 0       | 0     | 0    | 4 (PERFIL)     |
| EXECUCAO_DO_SERVICO             | ❌       | 0       | 0     | 0    | 13 (SERVIÇO) + 2 (SERVIÇOS) + 1 (HOME) + 1 (AVALIAÇÃO) |
| SOLICITACAO_PAGAMENTO           | ❌       | 0       | 0     | 0    | 2 (SOLICITAÇÃO) |
| FINANCEIRO_DO_PRESTADOR         | ❌       | 0       | 0     | 0    | 3 (FINANCEIRO) |
| COMUNICACAO_NOTIFICACOES        | ❌       | 0       | 0     | 0    | 6 (NOTIFICAÇÃO) |
| ADMIN_OPERACOES                 | ❌       | 0       | 0     | 0    | 6 (BACKOFFICE) |
| _Distribuir_                    | -        | -       | -     | -    | 4 (GERAL/SUPORTE/GROWTH/etc) |

**Pronto na largada:** 2 de 8 módulos aprovados (AUTENTICACAO_ONBOARDING + MATCHING_ALOCACAO). 34 tasks já em backlog, 236 FP.

**A fazer:** 6 módulos × ~4 stories × ~3 tasks = **~72 tasks novas, ~700 FP estimados**.

**Cards-órfãos a redistribuir manualmente (na fase 7):**
- `[GERAL]` 2 cards — provavelmente transversais (auth/UI shell)
- `[SUPORTE]` 1 — pode ir pra ADMIN_OPERACOES
- `[GROWTH]` 1 — pode ser fora-de-escopo MVP

## Mapa de cobertura (queries de validação)

```sql
-- 1) Cards do brainstorm com tag de módulo
WITH cards AS (
  SELECT DISTINCT
    elem->>'id' AS card_id,
    elem->>'title' AS title,
    substring(elem->>'title' FROM '\[([^\]]+)\]') AS module_tag
  FROM public."DesignSessionStepData",
       jsonb_array_elements(data->'solutions') AS elem
  WHERE "sessionId" = '58d05f55-57c6-4b26-86c4-9199a8f67f34'
    AND "stepKey" = 'brainstorm'
)
SELECT module_tag, count(*) AS unique_cards
FROM cards
GROUP BY module_tag
ORDER BY unique_cards DESC;

-- 2) Stories do projeto agrupadas por módulo
SELECT m.name AS module, count(us.id) AS stories
FROM public."Module" m
LEFT JOIN public."UserStory" us ON us."moduleId" = m.id
JOIN public."Project" p ON p.id = m."projectId"
WHERE p."referenceKey" = 'EVZL'
GROUP BY m.name
ORDER BY m.name;

-- 3) Cobertura grosseira: existe ≥1 story por módulo esperado?
SELECT m.name,
  m."approvedAt" IS NOT NULL AS approved,
  count(us.id) AS stories,
  count(t.id) AS tasks,
  COALESCE(sum(t."functionPoints"), 0) AS fp
FROM public."Module" m
LEFT JOIN public."UserStory" us ON us."moduleId" = m.id
LEFT JOIN public."Task" t ON t."userStoryId" = us.id
JOIN public."Project" p ON p.id = m."projectId"
WHERE p."referenceKey" = 'EVZL'
GROUP BY m.name, m."approvedAt"
ORDER BY m.name;
```

---

## Loop de execução por módulo

Cada módulo passa por 4 fases. Use os prompts abaixo na chat do Vitor (sub-fase `task_breakdown` ou `module_discovery` conforme estado).

### Template por módulo (3 turns + 1 SQL)

Cada módulo segue uma rotina de **3 turns do Vitor + 1 transação de aprovação SQL**. Substituir `<MODULE_NAME>` e `<TAG>` conforme a seção do módulo.

#### Turn 1 — Discovery (sem criar nada)

```bash
bun x tsx --require ./scripts/_server-only-shim.cjs scripts/vitor-cli.ts \
  --session 58d05f55-57c6-4b26-86c4-9199a8f67f34 \
  --message "Vamos trabalhar no módulo <MODULE_NAME>. Use get_step_data('brainstorm') e filtre os cards com tag [<TAG>]. Liste títulos dos cards e me proponha as user stories (INVEST) que cobrem cada card. NÃO crie nada ainda — só proposta. Para cada story proposta, indique quais card_ids ela cobre."
```

**Validar manualmente o output:**
- 3-7 stories por módulo (típico)
- Cada card aparece em ≥1 story
- Stories no formato "Como {persona}, quero {want}, para que {soThat}"
- Sem prefixo de camada nos títulos

Se OK → Turn 2. Se não → repetir Turn 1 com correção específica.

#### Turn 2 — Criar stories + task breakdown completo

```bash
bun x tsx --require ./scripts/_server-only-shim.cjs scripts/vitor-cli.ts \
  --session 58d05f55-57c6-4b26-86c4-9199a8f67f34 \
  --message "Aprovado. Crie as stories e faça o task_breakdown completo agora. Fluxo: create_user_story (com moduleId existente do <MODULE_NAME>) → para cada story, create_task em ordem topológica (raízes primeiro) com dependsOn citando refs EVZL-T-NNN retornadas anteriormente → set_story_refinement(committed) ao final de cada story. Tags: Front/Back/Bug/etc. Antes de começar, list_tasks pra ver o que já existe em outros módulos (matching e onboarding) e identificar inter-story deps relates_to."
```

**Pode ser que precise múltiplos turns** (Vitor pode pausar entre stories). Continue chamando o CLI com mensagens curtas tipo "continue" se ele indicar progresso parcial.

**Validar via SQL após Turn 2:**

```bash
psql "$DIRECT_URL" -t -c "
SELECT us.reference, us.title, us.\"refinementStatus\",
  count(t.id) AS tasks, COALESCE(sum(t.\"functionPoints\"), 0) AS fp
FROM public.\"UserStory\" us
JOIN public.\"Module\" m ON m.id = us.\"moduleId\"
LEFT JOIN public.\"Task\" t ON t.\"userStoryId\" = us.id
WHERE m.name = '<MODULE_NAME>'
GROUP BY us.id, us.reference, us.title, us.\"refinementStatus\"
ORDER BY us.\"createdAt\";
"
```

Esperado: todas stories com `refinementStatus='committed'`, ≥2 tasks por story, FP > 0.

#### Turn 3 — Self-audit do módulo (opcional mas recomendado)

```bash
bun x tsx --require ./scripts/_server-only-shim.cjs scripts/vitor-cli.ts \
  --session 58d05f55-57c6-4b26-86c4-9199a8f67f34 \
  --message "Self-audit do módulo <MODULE_NAME>: liste cada card de [<TAG>] no brainstorm e confirme qual story cobre cada um. Algum card não foi coberto? Justifique se for fora-de-escopo MVP. Algum risco visível (story muito grande, task com FP=null, dependência inter-story faltando)?"
```

#### Aprovação do módulo (endpoint HTTP, NÃO SQL)

**Por que não SQL ad-hoc:** ignora `ModuleActivity`, pula validação de DAL, e — mais importante — não simula o ciclo real do produto, que é "humano clica Aprovar no UI". O endpoint faz tudo numa transação só (set `approvedAt`, promove tasks `draft→backlog`, insere `ModuleActivity` com `type='approved'`).

**Como aprovar:**

1. Pegar o `moduleId` via SQL **read-only**:
```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && \
psql "$DIRECT_URL" -t -c "
SELECT id FROM public.\"Module\"
WHERE name = '<MODULE_NAME>'
  AND \"projectId\" = 'ccdd93ec-cf7f-4cc3-bce8-d8a359b3f652';
"
```

2. Chamar o endpoint:
```bash
curl -sS -X POST "http://localhost:3000/api/modules/<MODULE_ID>/approve" \
  -H "Cookie: $(cat /tmp/vitor-runbook/auth-cookie.txt)" | jq .
```

3. Validar a resposta — esperado: `{"id":"...","name":"...","approvedAt":"...","promoted":N,"totalFp":NN}`.

**Se o servidor Next não estiver de pé**, levantar com `bun run dev` em background antes de aprovar. Nunca usar SQL como fallback — perde-se Activity, cascade, e o aprendizado do ciclo.

---

## Ordem dos módulos

### 1. AUTENTICACAO_ONBOARDING — ✅ DONE (aprovado em 2026-05-05)

Estado final: 9 stories committed, 23 tasks em backlog, 121 FP. Aprovado via UI.

_Pular pra Módulo 2._

---

### 2. KYC_VERIFICACAO_DE_PRESTADORES — 4 cards `[PERFIL]`

Cards relevantes:
- `4gfh9us` Perfil Público do Prestador com Rating Ponderado
- `6qiftzu` Configuração de Janela de Disponibilidade Semanal
- `7mnciq9` Dashboard de Performance do Prestador
- `otghg28` Badge de Prestador Verificado

⚠️ **DECISÃO DE PRODUTO necessária:** alguns cards `[PERFIL]` parecem mais "perfil do prestador em ops" do que "KYC strict". O Turn 1 deve perguntar isso e **pausar pra input do usuário** antes de seguir.

**Turn 1 — Discovery + decisão:**
```bash
bun x tsx --require ./scripts/_server-only-shim.cjs scripts/vitor-cli.ts \
  --session 58d05f55-57c6-4b26-86c4-9199a8f67f34 \
  --message "Módulo KYC_VERIFICACAO_DE_PRESTADORES. get_step_data('brainstorm') e filtra cards com [PERFIL][PRESTADOR]. Importante: o nome do módulo no DB é KYC, mas pelos títulos os 4 cards parecem mais 'perfil público do prestador'. Me diga: (a) os 4 cards cabem aqui ou faz sentido criar módulo PERFIL_PRESTADOR separado e deixar KYC só pra documentos/facematch? (b) caso B, que cards de outros módulos (ex: [ONBOARDING][PRESTADOR] cards de upload de documento) deveriam migrar pra KYC? (c) propostas de stories pra cada arranjo. NÃO CRIE NADA, só análise."
```

---

### 3. EXECUCAO_DO_SERVICO — 13 `[SERVIÇO]` + 2 `[SERVIÇOS]` + 1 `[HOME]` + 1 `[AVALIAÇÃO]`

Maior módulo. ~17 cards, ~6-8 stories esperadas.

**Turn 1:**
```bash
bun x tsx --require ./scripts/_server-only-shim.cjs scripts/vitor-cli.ts \
  --session 58d05f55-57c6-4b26-86c4-9199a8f67f34 \
  --message "Módulo EXECUCAO_DO_SERVICO (maior módulo, ~17 cards). list_tasks primeiro pra ver o que já existe em outros módulos. get_step_data('brainstorm') → filtra cards com tags [SERVIÇO], [SERVIÇOS], [HOME], [AVALIAÇÃO]. Agrupa por jornada (busca → solicitação → execução → avaliação) e propõe 6-8 stories. Cite quais card_ids cada story cobre. NÃO CRIE NADA."
```

---

### 4. SOLICITACAO_PAGAMENTO + FINANCEIRO_DO_PRESTADOR — unificar?

Cards: 2 `[SOLICITAÇÃO]` + 3 `[FINANCEIRO]` = 5 cards.

⚠️ **DECISÃO DE PRODUTO necessária:** unificar num único módulo `FINANCEIRO` (mais simples, 5 cards) ou manter separado (cliente paga vs prestador recebe)?

**Turn 1 — Discovery + decisão:**
```bash
bun x tsx --require ./scripts/_server-only-shim.cjs scripts/vitor-cli.ts \
  --session 58d05f55-57c6-4b26-86c4-9199a8f67f34 \
  --message "Módulos SOLICITACAO_PAGAMENTO e FINANCEIRO_DO_PRESTADOR. get_step_data('brainstorm') e filtra [SOLICITAÇÃO] e [FINANCEIRO]. São 5 cards. Decisão de produto: (a) manter separados (cliente paga vs prestador recebe — 2 atores diferentes, fluxos diferentes)? (b) unificar em FINANCEIRO_TRANSACOES (são opostos da mesma transação)? Me dá os pros/cons e propõe stories pra cada cenário. NÃO CRIE NADA."
```

---

### 5. COMUNICACAO_NOTIFICACOES — 6 `[NOTIFICAÇÃO]`

Módulo **transversal**. Stories aqui terão `relates_to` apontando pra tasks de outros módulos (ex: notificação dispara em "matching escolhido", "pagamento aprovado").

**Turn 1:**
```bash
bun x tsx --require ./scripts/_server-only-shim.cjs scripts/vitor-cli.ts \
  --session 58d05f55-57c6-4b26-86c4-9199a8f67f34 \
  --message "Módulo COMUNICACAO_NOTIFICACOES (transversal — serve os outros). list_tasks primeiro pra mapear gatilhos de notificação que já existem em tasks de outros módulos (ex: 'avisar prestador que foi escolhido', 'notificar cliente sobre pagamento'). get_step_data('brainstorm') e filtra [NOTIFICAÇÃO]. Propõe stories agrupando por canal (push/email/in-app) ou por gatilho — você decide o que faz mais sentido. Cada story deve listar quais tasks de outros módulos vão ter dep relates_to apontando pra cá. NÃO CRIE NADA."
```

---

### 6. ADMIN_OPERACOES — 6 `[BACKOFFICE]` + 1 `[SUPORTE]`

Último módulo. Ferramentas internas (aprovar prestador, ver financeiro, suporte).

**Turn 1:**
```bash
bun x tsx --require ./scripts/_server-only-shim.cjs scripts/vitor-cli.ts \
  --session 58d05f55-57c6-4b26-86c4-9199a8f67f34 \
  --message "Módulo ADMIN_OPERACOES (backoffice/ops, último módulo). get_step_data('brainstorm') e filtra [BACKOFFICE] e [SUPORTE] (7 cards). Como é o último, faça também list_tasks pra ver se há gaps em ações ops que outros módulos pressupõem mas não têm UI (ex: 'aprovar prestador KYC' precisa de tela admin). Propõe stories. NÃO CRIE NADA."
```

---

### 7. Cards-órfãos — distribuir

Cards `[GERAL]` (2), `[GROWTH]` (1), `[SUPORTE]` (1) — decidir caso a caso. Pode ter sido absorvido nos módulos anteriores; rodar **só se sobrar gap após módulos 1-6**.

**Turn 1:**
```bash
bun x tsx --require ./scripts/_server-only-shim.cjs scripts/vitor-cli.ts \
  --session 58d05f55-57c6-4b26-86c4-9199a8f67f34 \
  --message "Restam 4 cards órfãos: 2 [GERAL], 1 [SUPORTE], 1 [GROWTH]. get_step_data('brainstorm') e leia esses 4. Para cada um: (a) já está coberto por alguma story existente? (list_tasks pra confirmar), (b) pertence a qual módulo existente, (c) é fora-de-escopo MVP (justifique). Não crie nada."
```

---

## Audit final

> Esta seção é preenchida ao término do runbook. É o output principal — base do score e do blueprint Alpha.

### Cobertura por módulo

| Módulo                          | Approved | Stories | Tasks | FP   | Cards esperados | Cards cobertos | %  |
| ------------------------------- | -------- | ------- | ----- | ---- | --------------- | -------------- | -- |
| AUTENTICACAO_ONBOARDING         | ✅ 2026-05-05 | 9 | 23 | 121 | 9         | _              | _  |
| MATCHING_ALOCACAO               | ✅ pré-existente | 4 | 11 | 115 | 5         | _              | _  |
| KYC_VERIFICACAO_DE_PRESTADORES  | _ |  _ |  _ |  _  | 4               | _              | _  |
| EXECUCAO_DO_SERVICO             | _ |  _ |  _ |  _  | 17              | _              | _  |
| SOLICITACAO_PAGAMENTO           | _ |  _ |  _ |  _  | 2               | _              | _  |
| FINANCEIRO_DO_PRESTADOR         | _ |  _ |  _ |  _  | 3               | _              | _  |
| COMUNICACAO_NOTIFICACOES        | _ |  _ |  _ |  _  | 6               | _              | _  |
| ADMIN_OPERACOES                 | _ |  _ |  _ |  _  | 7 (+ SUPORTE)   | _              | _  |
| **Total**                       |          |         |       |      | **53**          |                |    |

### Cards não-cobertos (gap)

| Card ID | Title | Decisão |
|---------|-------|---------|
| _ | _ | _ |

### Cards fora-de-escopo justificados

| Card ID | Title | Justificativa |
|---------|-------|---------------|
| _ | _ | _ |

### Dependências inter-módulo identificadas

```sql
-- Preencher após fim: deps que cruzam módulos (relates_to ou blocks)
SELECT
  src_us.reference || ' (' || src_m.name || ')' AS source,
  dep.kind,
  tgt_us.reference || ' (' || tgt_m.name || ')' AS target
FROM public."TaskDependency" dep
JOIN public."Task" src_t ON src_t.id = dep."taskId"
JOIN public."Task" tgt_t ON tgt_t.id = dep."dependsOn"
JOIN public."UserStory" src_us ON src_us.id = src_t."userStoryId"
JOIN public."UserStory" tgt_us ON tgt_us.id = tgt_t."userStoryId"
JOIN public."Module" src_m ON src_m.id = src_us."moduleId"
JOIN public."Module" tgt_m ON tgt_m.id = tgt_us."moduleId"
WHERE src_m.id <> tgt_m.id
  AND src_t."projectId" = (SELECT id FROM public."Project" WHERE "referenceKey" = 'EVZL')
ORDER BY src_m.name, src_us.reference;
```

### FP total e distribuição

```sql
-- Esperado: ~700-1000 FP total
SELECT m.name, sum(t."functionPoints") AS fp
FROM public."Module" m
JOIN public."UserStory" us ON us."moduleId" = m.id
JOIN public."Task" t ON t."userStoryId" = us.id
JOIN public."Project" p ON p.id = m."projectId"
WHERE p."referenceKey" = 'EVZL'
GROUP BY m.name
ORDER BY fp DESC;
```

---

## Aprendizados pro Alpha-orquestrador

> Esta seção é onde o **valor real** do runbook fica. À medida que rodamos, capturar: o que Vitor faz bem sozinho, o que precisa de humano-no-loop, fricções repetitivas, padrões de erro, prompts que funcionaram melhor.
>
> **Como o Alpha-orquestrador usaria isto:** o Alpha leria este `.md` (ou uma versão estruturada dele) como playbook. Cada aprendizado vira uma regra ou heurística que o Alpha aplica ao orquestrar Vitor sem humano.

### Observações por fase

#### Fase A — Discovery
_Preencher: Vitor consegue agrupar cards em stories sem ajuda? Onde tropeça? Que prompts funcionam melhor?_

**Padrões pra capturar:**
- Vitor agrupa naturalmente por persona, por jornada, ou por tela?
- Granularidade default tende a ser alta (muitas stories pequenas) ou baixa (poucas stories grandes)?
- Como ele lida com cards ambíguos que poderiam ir em 2 módulos?

#### Fase B — Confirmação
_Preencher: quanto humano interfere em média? É feedback estrutural ou só ortografia?_

**Padrões pra capturar:**
- Em quantos % dos módulos a confirmação foi "ok pode seguir" sem ajuste?
- Quando tem ajuste, qual a natureza (renomear, dividir, mesclar, fora-de-escopo)?
- Esses ajustes são derivam de regras que o Alpha pode automatizar?

#### Fase C — Task breakdown
_Preencher: tasks geradas batem com expectativa? Tags estão certas? FP coerentes? Dependências inter-story identificadas?_

**Padrões pra capturar:**
- Vitor cita refs corretas em batch (T-NNN encadeadas)?
- Inter-story deps: identifica sozinho ou precisa lembrete?
- FP distribuição: tende a sub ou super-estimar?
- Naming: respeita a regra (verbo no infinitivo, sem prefixo de camada)?

#### Fase D — Aprovação
_Preencher: precisa intervenção?_

**Padrões pra capturar:**
- A aprovação é sempre direta ou tem pre-flight blocking?
- Audit trail (`ModuleActivity`) tá registrando corretamente?

### Padrões automatizáveis (regras pro Alpha)

_Listar regras concretas que o Alpha pode aplicar sem humano:_

- _Ex: "Se um card tem tag `[GROWTH]`, marcar como fora-de-escopo MVP automaticamente"_
- _Ex: "Se Vitor propõe mais de 8 stories num módulo, pedir agrupamento sem perguntar"_
- _Ex: "Se cobertura < 80% após task_breakdown, rodar self-audit"_

### Pontos onde humano é essencial (não automatizar)

_Listar decisões que Alpha sozinho não deve tomar:_

- _Ex: "Decisão de unificar 2 módulos (ex: SOLICITACAO_PAGAMENTO + FINANCEIRO_DO_PRESTADOR)"_
- _Ex: "Justificar que um card é fora-de-escopo MVP — precisa contexto de produto"_
- _Ex: "Nomear módulo novo baseado em cards (ex: KYC vs PERFIL_PRESTADOR)"_

### Critérios de "pronto" mensuráveis

_Preencher: as métricas que o Alpha pode usar pra decidir se Vitor entregou ok:_

- [ ] Cobertura ≥ 90% dos cards do brainstorm
- [ ] Todas stories com `refinementStatus = 'committed'`
- [ ] 0 tasks com `functionPoints` IS NULL
- [ ] 0 tasks com title começando em prefixo de camada (regex `^(Frontend|Backend|Migration|Infra):`)
- [ ] Inter-story deps existem (não 0) — sinaliza que tasks não estão isoladas
- [ ] Inter-module deps documentadas em `relates_to`

### Custo aproximado (tokens) — formato resumido

_Preencher por módulo, somar no final:_

| Módulo | Total tokens (in+out) | USD aproximado |
|---|---|---|
| AUTENTICACAO_ONBOARDING | _ | _ |
| MATCHING_ALOCACAO | _ | _ |
| KYC_... | _ | _ |
| **Total** | _ | _ |

### Tempo de wall-clock por fase

| Fase | Mediana (min) | P95 (min) |
|---|---|---|
| A — Discovery | _ | _ |
| B — Confirmação | _ | _ |
| C — Task breakdown | _ | _ |
| D — Aprovação | _ | _ |

### Gap fundamental se Alpha-orquestrador for construído

_Preencher: qual o maior obstáculo conceitual pra automatizar isto? Listas as 1-3 coisas que travariam o Alpha sem humano (ex: "saber a diferença entre KYC e PERFIL exige conhecimento do domínio que não vive em código nem brainstorm")._

---

## Métricas a coletar por módulo (preencher conforme avança)

Logo após aprovar cada módulo, rodar:

```sql
SELECT
  m.name,
  m."approvedAt",
  count(DISTINCT us.id) AS stories,
  count(DISTINCT t.id) AS tasks,
  COALESCE(sum(t."functionPoints"), 0) AS fp,
  count(DISTINCT dep.id) FILTER (WHERE dep.kind = 'blocks') AS blocks_deps,
  count(DISTINCT dep.id) FILTER (WHERE dep.kind = 'relates_to') AS relates_deps
FROM public."Module" m
LEFT JOIN public."UserStory" us ON us."moduleId" = m.id
LEFT JOIN public."Task" t ON t."userStoryId" = us.id
LEFT JOIN public."TaskDependency" dep ON dep."taskId" = t.id
WHERE m.name = '<MODULE_NAME>'
GROUP BY m.name, m."approvedAt";
```

E preencher uma linha:

| Módulo | Stories | Tasks | FP | Deps blocks | Deps relates_to | Cards cobertos | Tempo (min) | Tokens in | Tokens out |
|---|---|---|---|---|---|---|---|---|---|
| AUTENTICACAO_ONBOARDING | 9 | 23 | 121 | _ | _ | 9/9 | _ | _ | _ |
| MATCHING_ALOCACAO | 4 | 11 | 115 | _ | _ | 5/5 | _ | _ | _ |
| KYC_VERIFICACAO_DE_PRESTADORES | _ | _ | _ | _ | _ | _ | _ | _ | _ |
| EXECUCAO_DO_SERVICO | _ | _ | _ | _ | _ | _ | _ | _ | _ |
| SOLICITACAO_PAGAMENTO | _ | _ | _ | _ | _ | _ | _ | _ | _ |
| FINANCEIRO_DO_PRESTADOR | _ | _ | _ | _ | _ | _ | _ | _ | _ |
| COMUNICACAO_NOTIFICACOES | _ | _ | _ | _ | _ | _ | _ | _ | _ |
| ADMIN_OPERACOES | _ | _ | _ | _ | _ | _ | _ | _ | _ |

**Como contar "cards cobertos":** depois que Vitor cria as stories de um módulo, perguntar a ele:
> "Liste cada card do brainstorm desse módulo (`get_step_data('brainstorm')` filtrado por tag) e cite qual story que você criou cobre cada um. Se algum não foi coberto, justifique."

Marcar `N/M` onde N = cobertos, M = total no módulo.

---

## Como rodar este runbook (instruções pro agente CLI)

> Esta seção é o "manual" pra um agente Claude novo, com contexto limpo, executar o runbook **automatizado via CLI**.

### Modelo mental

Você é o **orquestrador**. Vitor é o **executor**. Cada chamada do CLI é 1 turn do Vitor — ele lê histórico do thread, executa tools, persiste mensagem assistente. Você dispara a próxima chamada baseado no que ele fez.

```
você (Claude orquestrador)
   ↓ Bash(vitor-cli.ts --message "...")
Vitor (subprocess, agent SDK)
   ↓ tool calls + persiste em ChatThread
banco (postgres)
   ↑ você valida via SQL
você decide próximo turn ou avança módulo
```

Não há humano-no-loop **exceto** quando uma decisão muda escopo de produto (ver § "Quando interromper o loop").

### Setup (1 vez no início)

1. Ler este runbook inteiro, especialmente §Pré-requisitos e §Ordem dos módulos.
2. Rodar a query do estado atual (último bloco do §Pré-requisitos) pra confirmar onde está.
3. Identificar a "fronteira" — primeiro módulo na ordem que tem `approved=f`.
4. Anunciar plano ao usuário em 1 frase: "Vou rodar do módulo X ao Y via CLI. ~Z minutos. Confirma que pode rodar autonomamente?"
5. Aguardar OK do usuário.

### Loop por módulo (repetir 6x)

Para cada módulo na ordem (§ "Ordem dos módulos"):

**Step 1 — Turn 1 (Discovery)**
```bash
bun x tsx --require ./scripts/_server-only-shim.cjs scripts/vitor-cli.ts \
  --session 58d05f55-57c6-4b26-86c4-9199a8f67f34 \
  --message "<prompt da Fase A do módulo>"
```
Timeout: 5min (`timeout: 300000`).

Ler output: stories propostas, cobertura de cards.

**Step 2 — Decidir:**
- Se proposta OK (granularidade 3-7 stories, cards cobertos, INVEST seguido) → Step 3.
- Se borderline (1-2 ajustes pequenos) → outro turn pedindo refino.
- Se ruim (5+ problemas, alucinação, mudança de escopo) → **pausar e perguntar usuário**.

**Step 3 — Turn 2 (Criação)**
```bash
bun x tsx --require ./scripts/_server-only-shim.cjs scripts/vitor-cli.ts \
  --session 58d05f55-57c6-4b26-86c4-9199a8f67f34 \
  --message "<prompt da Fase C — criação>"
```
Timeout: 10min (`timeout: 600000`) — pode ser batch grande.

Validar via SQL (query de § Turn 2). Se Vitor parou no meio, mandar "continue".

**Step 4 — Turn 3 (Self-audit, opcional)**
```bash
bun x tsx --require ./scripts/_server-only-shim.cjs scripts/vitor-cli.ts \
  --session 58d05f55-57c6-4b26-86c4-9199a8f67f34 \
  --message "<prompt do self-audit>"
```

Se identificar gaps → mandar criar stories complementares antes de aprovar.

**Step 5 — Aprovação via endpoint HTTP**

Não rodar SQL de mutação. Disparar o endpoint `POST /api/modules/[id]/approve` (ver seção "Aprovação do módulo"). Esse endpoint cascateia: marca módulo aprovado + promove tasks `draft→backlog` + insere `ModuleActivity`.

Validar:
```bash
psql "$DIRECT_URL" -t -c "
SELECT m.name, m.\"approvedAt\" IS NOT NULL AS approved,
  count(t.id) FILTER (WHERE t.status='backlog') AS in_backlog,
  count(t.id) FILTER (WHERE t.status='draft') AS still_draft
FROM public.\"Module\" m
LEFT JOIN public.\"UserStory\" us ON us.\"moduleId\" = m.id
LEFT JOIN public.\"Task\" t ON t.\"userStoryId\" = us.id
WHERE m.name = '<MODULE_NAME>'
GROUP BY m.name, m.\"approvedAt\";
"
```
Esperado: `approved=t`, `still_draft=0`.

**Step 6 — Capturar métricas**

Rodar query de § "Métricas a coletar". Preencher uma linha na tabela. Adicionar observação curta na seção "Aprendizados pro Alpha-orquestrador".

**Step 7 — Atualizar runbook**

Marcar o módulo como ✅ DONE na § "Ordem dos módulos" e na tabela "Cobertura por módulo".

→ Próximo módulo.

### Audit final (após 6º módulo aprovado)

1. Rodar todas queries da § "Audit final" e preencher tabelas.

2. Sweep final via Vitor:
   ```bash
   bun x tsx --require ./scripts/_server-only-shim.cjs scripts/vitor-cli.ts \
     --session 58d05f55-57c6-4b26-86c4-9199a8f67f34 \
     --message "Audit final: todos os módulos estão aprovados. get_step_data('brainstorm') + list_tasks. Cruze cada um dos ~56 cards únicos contra as stories existentes. Me dê output em 3 listas: (a) cards 100% cobertos com refs T-NNN, (b) cards parcialmente cobertos com gaps, (c) cards não-cobertos. Para não-cobertos, classifique: 'criar story complementar' OU 'fora-de-escopo MVP justificado'."
   ```

3. Preencher seções "Cards não-cobertos" e "Cards fora-de-escopo justificados".

4. **Se houver não-cobertos que devem ser criados:** rodar mais 1 turn no Vitor pra completar.

5. **Concluir a sessão:**
   ```bash
   psql "$DIRECT_URL" -c "
   UPDATE public.\"DesignSession\"
   SET status = 'completed', \"completedAt\" = now(), \"updatedAt\" = now()
   WHERE id = '58d05f55-57c6-4b26-86c4-9199a8f67f34';
   "
   ```

6. Preencher § "Aprendizados pro Alpha-orquestrador" com **observações concretas** capturadas durante a execução. Se ficou vazio, você não tava prestando atenção — relê os outputs dos CLI calls e extrai padrões.

### Critério de "Done" (quando parar)

- [ ] 8/8 módulos com `approvedAt IS NOT NULL`
- [ ] 0 tasks com `status='draft'` no projeto EVZL
- [ ] Cobertura ≥ 90% dos cards do brainstorm (ou justificativa fora-de-escopo)
- [ ] Tabela "Métricas a coletar por módulo" preenchida
- [ ] Tabelas "Audit final" preenchidas
- [ ] Seção "Aprendizados pro Alpha-orquestrador" preenchida com observações concretas
- [ ] Sessão `58d05f55...` com `status='completed'`

Quando todos ✅, comitar:
```bash
bash scripts/sync-main.sh -m "ZRD-JM-XX: docs — runbook EVZL completo + aprendizados Alpha"
```

### Heurísticas operacionais

- **Quando rodar um turn longo:** `timeout: 600000` (10min) é ok. Vitor com 30+ tool calls em batch pode levar 5-7min reais.
- **Output muito longo no CLI:** redirecionar pra arquivo e ler com Read tool: `... 2>&1 | tee /tmp/turn-out.log`.
- **Vitor parar no meio do batch:** mandar "continue" como mensagem. Ele tem o histórico.
- **Erro de cycle detection:** Vitor já se recupera — só ler o erro e ver se faz sentido.
- **Tokens custos:** ~50k tokens por turn rico. Self-audit ~30k. ~6 módulos × 3 turns × 50k = ~900k tokens total. Custo aproximado em Sonnet 4.6: ~$3-5.
- **Antes do primeiro turn de cada módulo:** rodar `list_tasks` e `list_stories` mentalmente via SQL pra Vitor saber o estado. Ele tem `list_tasks` como tool, mas você pode injetar contexto adicional no prompt se identificar.

---

## Reset (caso precise recomeçar do zero)

⚠️ **Destrutivo.** Roda só se quiser limpar tudo (mantendo MATCHING_ALOCACAO já validado).

```sql
BEGIN;

-- Delete em ordem de FK
DELETE FROM public."TaskTagAssignment"
WHERE "taskId" IN (
  SELECT t.id FROM public."Task" t
  JOIN public."UserStory" us ON us.id = t."userStoryId"
  JOIN public."Module" m ON m.id = us."moduleId"
  JOIN public."Project" p ON p.id = m."projectId"
  WHERE p."referenceKey" = 'EVZL'
    AND m.name <> 'MATCHING_ALOCACAO'
);

DELETE FROM public."TaskDependency"
WHERE "taskId" IN (
  SELECT t.id FROM public."Task" t
  JOIN public."UserStory" us ON us.id = t."userStoryId"
  JOIN public."Module" m ON m.id = us."moduleId"
  JOIN public."Project" p ON p.id = m."projectId"
  WHERE p."referenceKey" = 'EVZL'
    AND m.name <> 'MATCHING_ALOCACAO'
);

DELETE FROM public."AcceptanceCriterion"
WHERE "taskId" IN (
  SELECT t.id FROM public."Task" t
  JOIN public."UserStory" us ON us.id = t."userStoryId"
  JOIN public."Module" m ON m.id = us."moduleId"
  JOIN public."Project" p ON p.id = m."projectId"
  WHERE p."referenceKey" = 'EVZL'
    AND m.name <> 'MATCHING_ALOCACAO'
);

DELETE FROM public."Task"
WHERE id IN (
  SELECT t.id FROM public."Task" t
  JOIN public."UserStory" us ON us.id = t."userStoryId"
  JOIN public."Module" m ON m.id = us."moduleId"
  JOIN public."Project" p ON p.id = m."projectId"
  WHERE p."referenceKey" = 'EVZL'
    AND m.name <> 'MATCHING_ALOCACAO'
);

DELETE FROM public."AcceptanceCriterion"
WHERE "userStoryId" IN (
  SELECT us.id FROM public."UserStory" us
  JOIN public."Module" m ON m.id = us."moduleId"
  JOIN public."Project" p ON p.id = m."projectId"
  WHERE p."referenceKey" = 'EVZL'
    AND m.name <> 'MATCHING_ALOCACAO'
);

DELETE FROM public."UserStory"
WHERE id IN (
  SELECT us.id FROM public."UserStory" us
  JOIN public."Module" m ON m.id = us."moduleId"
  JOIN public."Project" p ON p.id = m."projectId"
  WHERE p."referenceKey" = 'EVZL'
    AND m.name <> 'MATCHING_ALOCACAO'
);

ROLLBACK; -- transformar em COMMIT só após confirmar que delete está correto
```
