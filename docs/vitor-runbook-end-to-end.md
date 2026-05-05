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

Este runbook é executado em duas mãos: **um agente humano** (Claude num chat fresh, contexto limpo) **conduzindo o usuário**, que por sua vez interage com o **Vitor** (agente de design session que vive na UI web em `/design-sessions/<id>/chat`).

O agente humano (Claude) **não consegue chamar Vitor diretamente**. O loop é:

```
Claude (este runbook) → produz prompt
    ↓
usuário cola prompt no chat web do Vitor
    ↓
Vitor responde (cria stories/tasks no banco)
    ↓
usuário relata o resultado pra Claude (ou Claude valida via SQL)
    ↓
Claude decide próximo prompt
```

### Antes do primeiro prompt

1. **Descobrir o memberId do usuário** (necessário pra aprovação de módulo via SQL):
   ```sql
   SELECT id, name, "userId"
   FROM public."Member"
   WHERE name ILIKE '%joão%' OR name ILIKE '%moraes%';
   ```

2. **Confirmar projectId do EVZL**:
   ```sql
   SELECT id FROM public."Project" WHERE "referenceKey" = 'EVZL';
   ```

3. **Confirmar estado atual** (rodar todas as 3 queries em § "Mapa de cobertura" abaixo).

4. **Garantir que a sessão está ativa** (não completed):
   ```sql
   SELECT id, title, status, "currentStep" FROM public."DesignSession"
   WHERE id = '58d05f55-57c6-4b26-86c4-9199a8f67f34';
   ```
   `status` deve ser `in_progress`.

### Contexto do sistema que o agente precisa saber

- **Refs de tasks são `<KEY>-T-NNN`** (ex: `EVZL-T-001`) **desde a criação**, status flutua draft→backlog→todo→… mas a ref nunca muda.
- **Vitor cria tasks via tool `create_task`** com `userStoryId` obrigatório. Tasks nascem em `status='draft'`.
- **Aprovar módulo** (UI ou SQL — ver § Fase D) flipa `Module.approvedAt` E muda tasks `draft → backlog` em massa via [promoteTasksForModule](../src/lib/dal/story-hierarchy.ts).
- **Dependências** vivem em `TaskDependency` com `kind ∈ {blocks, relates_to}`. `blocks` tem cycle detection no DB. `relates_to` é informativo.
- **Brainstorm** é o `stepKey='brainstorm'` da sessão, `data->'solutions'` é array de 94 cards. Cada card tem `id`, `title` (com tag `[MODULO][PERSONA]`), `userFlows`, `keyScreens`, `howItSolves`, `painPointRef`, `targetPersona`, `technicalNotes`. Vitor lê via tool `get_step_data('brainstorm')`.
- **Prompt do Vitor**: ver [src/lib/agent/prompt.ts](../src/lib/agent/prompt.ts). Sub-fases relevantes pra este runbook: `module_discovery`, `story_tree`, `task_breakdown`.

### Quando intervir manualmente

Vitor é capaz de conduzir sozinho a maior parte. Intervenha quando:
- Ele propor mais de 8 stories num módulo (granularidade errada — pedir agrupamento)
- Ele criar task com FP=null ou title começando com prefixo de camada (`Frontend:`, `Backend:`)
- Ele citar UUID em vez de ref textual em `dependsOn`
- Ele tentar criar antes de você confirmar (Fase B)

### Comportamento esperado em erro

- **Refs órfãs em `dependsOn`**: Vitor retorna `error: "Refs de dependsOn nao encontradas..."` — ele se recupera sozinho.
- **23505 (UNIQUE collision em ref)**: handled internamente com retry de 5 tentativas.
- **Cycle detection**: Vitor detecta antes de chamar a tool (ele tem o grafo em memória da batch); caso passe, o trigger do DB rejeita.

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

### Template por módulo

#### Fase A — Discovery (se módulo vazio)

> "Vitor, vamos trabalhar no módulo **`<MODULE_NAME>`**. Use `get_step_data('brainstorm')` e filtre os cards com tag `[<TAG>]`. Liste os títulos e me proponha as user stories (tipo INVEST) que cobrem cada card. **Não crie nada ainda** — só liste a proposta de stories e quais cards cada uma cobre."

#### Fase B — Confirmação humana

Eu vou revisar a lista, dizer "ok pode criar" ou "ajusta X".

#### Fase C — Story creation + task breakdown

> "Pode criar as stories e fazer o task_breakdown completo. Use o fluxo padrão (`create_user_story` → `set_story_refinement(refined)` → `create_task` por story → `set_story_refinement(committed)` no final). Tasks com tags `Front`/`Back`/`Bug`/etc. Dependências inter-story citem refs `EVZL-T-NNN`."

#### Fase D — Aprovação do módulo

Via UI (botão "Aprovar módulo") ou SQL direto:

```sql
UPDATE public."Module"
SET "approvedAt" = now(), "approvedBy" = '<member_uuid>', "updatedAt" = now()
WHERE name = '<MODULE_NAME>'
  AND "projectId" = (SELECT id FROM public."Project" WHERE "referenceKey" = 'EVZL');

-- Promove draft → backlog (refs T-NNN já são estáveis)
UPDATE public."Task" t
SET status = 'backlog', "updatedAt" = now()
WHERE t."userStoryId" IN (
  SELECT id FROM public."UserStory"
  WHERE "moduleId" = (SELECT id FROM public."Module" WHERE name = '<MODULE_NAME>')
)
AND t.status = 'draft';
```

---

## Ordem dos módulos

### 1. AUTENTICACAO_ONBOARDING — ✅ DONE (aprovado em 2026-05-05)

Estado final: 9 stories committed, 23 tasks em backlog, 121 FP. Aprovado via UI.

_Pular pra Módulo 2._

---

### 2. KYC_VERIFICACAO_DE_PRESTADORES — 4 cards `[PERFIL]`

Cards relevantes (recheck via SQL):
- `4gfh9us` Perfil Público do Prestador com Rating Ponderado
- `6qiftzu` Configuração de Janela de Disponibilidade Semanal
- `7mnciq9` Dashboard de Performance do Prestador
- `otghg28` Badge de Prestador Verificado

⚠️ **Observação:** alguns cards `[PERFIL]` parecem mais "perfil do prestador em ops" do que "KYC strict". Ver se faz sentido renomear o módulo pra `PERFIL_PRESTADOR` ou se esses cards vão pra outro lugar (ADMIN_OPERACOES?).

**Prompt fase A:**
> "Vitor, módulo **`KYC_VERIFICACAO_DE_PRESTADORES`**. `get_step_data('brainstorm')` → filtra `[PERFIL][PRESTADOR]`. Note: o nome do módulo no DB é KYC, mas os cards são sobre perfil público + dashboard. Me diga: (a) os 4 cards cabem nesse módulo ou faz sentido criar um módulo `PERFIL_PRESTADOR` separado? (b) que stories você proporia."

---

### 3. EXECUCAO_DO_SERVICO — 13 `[SERVIÇO]` + 2 `[SERVIÇOS]` + 1 `[HOME]` + 1 `[AVALIAÇÃO]`

Maior módulo. ~17 cards, ~6-8 stories esperadas.

**Prompt fase A:**
> "Vitor, módulo **`EXECUCAO_DO_SERVICO`**. `get_step_data('brainstorm')` → filtra `[SERVIÇO]`, `[SERVIÇOS]`, `[HOME]`, `[AVALIAÇÃO]`. Esse é o maior módulo (~17 cards). Agrupa por jornada (busca → solicitação → execução → avaliação) e me propõe ~6-8 stories. Lembre `list_tasks` antes de propor — pode haver coisas em outros módulos que tocam aqui."

---

### 4. SOLICITACAO_PAGAMENTO + FINANCEIRO_DO_PRESTADOR — unificar?

Cards: 2 `[SOLICITAÇÃO]` + 3 `[FINANCEIRO]` = 5 cards.

⚠️ **Decisão de produto:** unificar num único módulo `FINANCEIRO` (mais simples, 5 cards é pouco) ou manter separado (cliente paga vs prestador recebe)?

**Prompt fase A:**
> "Vitor, módulos **`SOLICITACAO_PAGAMENTO`** e **`FINANCEIRO_DO_PRESTADOR`**. `get_step_data('brainstorm')` → filtra `[SOLICITAÇÃO]` e `[FINANCEIRO]`. Me diga: (a) faz sentido manter separado? Os 2 módulos são opostos da mesma transação (cliente paga, prestador recebe). (b) Stories propostas pra cada arranjo."

---

### 5. COMUNICACAO_NOTIFICACOES — 6 `[NOTIFICAÇÃO]`

Módulo transversal. Vitor já viu tasks dos outros módulos via `list_tasks`.

**Prompt fase A:**
> "Vitor, módulo **`COMUNICACAO_NOTIFICACOES`** (transversal). `get_step_data('brainstorm')` → `[NOTIFICAÇÃO]`. Como esse módulo serve os outros, faça `list_tasks` antes — algumas tasks de outros módulos já podem implicar notificações (ex: 'avisar prestador que foi escolhido'). Identifique deps `relates_to` quando disparar de outra story. Stories propostas?"

---

### 6. ADMIN_OPERACOES — 6 `[BACKOFFICE]` + 1 `[SUPORTE]`

Último módulo. Ferramentas internas (aprovar prestador, ver financeiro, etc).

**Prompt fase A:**
> "Vitor, módulo **`ADMIN_OPERACOES`** (backoffice/ops). `get_step_data('brainstorm')` → `[BACKOFFICE]` e `[SUPORTE]`. Esse é o último — aproveita pra fechar gaps. Stories propostas?"

---

### 7. Cards-órfãos — distribuir

Cards `[GERAL]` (2), `[GROWTH]` (1) — decidir caso a caso. Provável que `GERAL` seja transversal (UI shell, navegação) e `GROWTH` seja fora-de-escopo MVP.

**Prompt:**
> "Vitor, restaram 4 cards: 2 `[GERAL]`, 1 `[SUPORTE]`, 1 `[GROWTH]`. `get_step_data('brainstorm')` e leia esses 4 — pra cada um me diga: (a) pertence a qual módulo já existente, (b) é fora-de-escopo MVP (justifique). Não crie story ainda."

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

## Como rodar este runbook (instruções pro próximo agente)

> Esta seção é o "manual" pra um agente Claude novo, com contexto limpo, executar o runbook.

### Setup (1 vez no início da sessão)

1. **Ler este runbook inteiro**, incluindo §Pré-requisitos.
2. Rodar as 3 queries de § "Mapa de cobertura" pra confirmar estado atual.
3. Identificar a "fronteira" — primeiro módulo na ordem que ainda não está aprovado.
4. **Anunciar o plano ao usuário**: "Vou te conduzir do módulo X ao módulo Y, em ordem. Pra cada módulo, você vai colar prompts no chat do Vitor e me reportar o resultado. Eu valido via SQL e geramos próximo prompt. Topa?"

### Loop por módulo (repetir 6x, na ordem § "Ordem dos módulos")

**Fase A — gerar prompt de discovery:**

```
Pegar o template do módulo atual (já tem prompt pronto na seção dele).
Mostrar pro usuário, pedir pra colar no chat web do Vitor.
```

**Fase B — receber resposta da discovery:**

```
Usuário cola o que Vitor respondeu.
Você analisa:
  - Stories propostas fazem sentido pra cobertura dos cards?
  - Granularidade ok (3-7 stories por módulo no típico)?
  - Cobre todos os cards do módulo?

Se sim: dizer ao usuário "ok pode mandar Vitor criar — cola o prompt da Fase C".
Se não: refinar o prompt, pedir pra Vitor reagrupar/dividir.
```

**Fase C — task breakdown:**

```
Mostrar prompt da Fase C (template padrão).
Usuário cola, Vitor cria stories + tasks com deps.
Usuário relata progresso (ex: "criou 5 stories, 18 tasks, 95 FP").
```

**Fase D — aprovar:**

```
Mostrar query SQL de aprovação (substituindo <MODULE_NAME> e <member_uuid>).
Usuário roda OU usa UI.

Validar via SQL:
  SELECT m."approvedAt", count(t.id) FILTER (WHERE t.status='backlog')
  FROM "Module" m JOIN "UserStory" us ON us."moduleId"=m.id
  JOIN "Task" t ON t."userStoryId"=us.id
  WHERE m.name = '<MODULE_NAME>'
  GROUP BY m."approvedAt";

Esperado: approvedAt IS NOT NULL, todas tasks em backlog (status flipped).
```

**Pós-fase D — capturar métrica:**

```
Rodar query da seção "Métricas a coletar".
Preencher a linha do módulo na tabela.
Anotar observações em "§ Aprendizados pro Alpha-orquestrador".
```

### Audit final (após 6º módulo aprovado)

1. Rodar todas queries da § "Audit final" e preencher tabelas.
2. Pedir ao Vitor um sweep final de gaps:
   > "Vitor, agora todos os módulos estão aprovados. Faça `get_step_data('brainstorm')` e cruze cada um dos 56 cards únicos contra as stories existentes (`list_tasks` + `list_stories`). Me dê: (a) cards 100% cobertos, (b) cards parcialmente cobertos, (c) cards não-cobertos. Para os não-cobertos, sugira: criar story complementar OU justificar fora-de-escopo MVP."

3. Preencher seção "Cards não-cobertos" e "Cards fora-de-escopo justificados".

4. **Concluir a sessão**:
   ```sql
   UPDATE public."DesignSession"
   SET status = 'completed', "completedAt" = now(), "updatedAt" = now()
   WHERE id = '58d05f55-57c6-4b26-86c4-9199a8f67f34';
   ```

5. Preencher § "Aprendizados pro Alpha-orquestrador" com tudo que foi observado.

### Critério de "Done" (quando parar)

- [ ] 8/8 módulos com `approvedAt IS NOT NULL`
- [ ] 0 tasks com status='draft' no projeto EVZL
- [ ] Cobertura ≥ 90% dos cards do brainstorm (ou justificativa de fora-de-escopo pros restantes)
- [ ] Tabela "Métricas a coletar" preenchida
- [ ] Tabelas "Audit final" preenchidas
- [ ] Seção "Aprendizados pro Alpha-orquestrador" preenchida com observações concretas
- [ ] Sessão `58d05f55...` com status='completed'

Quando todos esses ✅, **comitar o runbook atualizado**:
```bash
bash scripts/sync-main.sh -m "ZRD-JM-XX: docs — runbook EVZL completo + aprendizados Alpha"
```

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
