# Workflow Volund

> Guia operacional da esteira de desenvolvimento agentico da Volund.
> Publico: time interno, novos membros, clientes, diretoria.

---

## 1. O Fluxo

```
Cliente → Projeto → Design Session (Inception)
                         │
                         ▼
               Briefing consolidado
                         │
                         ▼
              IA gera Tasks com spec
                         │
                         ▼
            PM revisa, ajusta, confirma
                         │
                         ▼
          Tasks distribuidas em Sprints (15 dias)
                         │
                         ▼
        Squad executa (Builders + Agentes IA)
                         │
                         ▼
          Tech Specialist audita codigo
                         │
                         ▼
           PM valida → Demo → Entrega
                         │
                         ▼
           Proximo ciclo (Melhoria Continua)
```

Cada passo gera artefatos que alimentam o proximo. Nada e verbal — tudo fica registrado no Zordon.

---

## 2. Design Sessions

Uma Design Session e uma reuniao estruturada que transforma uma ideia vaga em requisitos executaveis. O output nao e um documento de 40 paginas — e um briefing conciso que uma IA consegue consumir.

### Inception (projeto novo)

Usada no inicio de cada projeto. 7 steps sequenciais:

| Step | Nome | O que captura | Output |
|------|------|---------------|--------|
| 1 | Visao do Produto | Problema, quem sofre, consequencias, visao de sucesso, metricas | Texto estruturado |
| 2 | Personas & Jornadas | Quem usa, como vive hoje (AS-IS), como sera (TO-BE) | Personas com jornadas mapeadas |
| 3 | Brainstorm | Ideias de solucao livres, sem filtro. Solution cards. | Lista de solucoes com persona-alvo |
| 4 | Priorizacao | Classificar solucoes em MVP / Next / Out | 3 buckets priorizados |
| 5 | Sequenciamento | Organizar MVP em fases/releases | Timeline de releases |
| 6 | Specs Tecnicas | Stack, integracoes, restricoes, regras | Documento tecnico |
| 7 | Briefing | Consolidacao automatica de todos os steps | Briefing pronto pra IA |

**O briefing e o artefato mais importante.** Ele resume em 1 pagina tudo que foi decidido nos 6 steps anteriores. E o input que a IA usa pra gerar tasks.

### Melhoria Continua (CI)

Usada apos a primeira entrega. Steps adaptados:

| Step | Nome | O que captura |
|------|------|---------------|
| 1 | Retrospectiva | O que funcionou, o que nao funcionou, o que mudar |
| 2 | Novas Demandas | Features pedidas pelo cliente ou identificadas pelo time |
| 3 | Repriorização | Reordenar backlog com novas demandas |
| 4 | Specs Tecnicas | Ajustes de stack, novas integracoes |
| 5 | Briefing | Consolidacao pra gerar novas tasks |

**Regra:** toda mudanca de escopo passa por uma Design Session CI. Nao existe "me adiciona isso aqui rapidinho" fora do processo.

---

## 3. De Briefing a Tasks

### Como a IA gera tasks

O Zordon tem um gerador de tasks que recebe o briefing e produz tasks completas. O fluxo:

1. PM clica "Gerar Tasks" no step de Briefing
2. Sistema envia pra IA (OpenAI):
   - Briefing consolidado (visao, personas, solucoes, priorizacao, sequenciamento, specs)
   - Contexto do projeto (stack, restricoes)
   - Template de task esperado
3. IA retorna lista de tasks com:
   - Titulo e descricao/objetivo
   - Acceptance criteria (checklist)
   - Technical notes (snippets, queries)
   - Business context (motivacao)
   - Out of scope (o que NAO fazer)
   - UI guidance (referencias visuais)
   - Scope e complexity sugeridos
   - Dependencias entre tasks
4. PM ve preview, pode editar qualquer campo, incluir/excluir tasks
5. PM confirma → tasks criadas no backlog do projeto

### O que torna isso diferente

Em uma empresa tradicional, o PO escreve user stories vagas ("como usuario, quero X") e o dev interpreta. Aqui:

- A **spec e completa o suficiente pra um agente IA executar** sem perguntar nada
- As **acceptance criteria sao checklist verificavel** — nao e prosa, e lista de sim/nao
- As **technical notes tem codigo** — queries Prisma, payloads JSON, estrutura de dados
- O **business context explica o porque** — o agente entende a motivacao, nao so a tarefa

Isso elimina o telefone-sem-fio entre PO → dev. A spec e o contrato.

---

## 4. Anatomia de uma Task

```
┌─────────────────────────────────────────────────────┐
│ TASK-013          Feature         13 SP              │
│ Pipeline visual — Kanban de Deals                    │
│                                                      │
│ Depende de: TASK-002, TASK-006, TASK-009            │
│ Prazo: 30 abr     Sprint: Sprint 2                  │
│ Atribuido: Rafael Oliveira                           │
│ Mode: Agent                                          │
├─────────────────────────────────────────────────────┤
│                                                      │
│ OBJETIVO                                             │
│ Pagina de pipeline com Kanban onde cada coluna e     │
│ um stage e cada card e um deal.                      │
│                                                      │
│ ACCEPTANCE CRITERIA                                  │
│ - [ ] Usa componente KanbanBoard (TASK-006)         │
│ - [ ] Drag-and-drop atualiza deal.stageId           │
│ - [ ] Header mostra nome + count + soma valores     │
│ - [ ] Filtros: owner, valor, busca                  │
│ - [ ] Click no card abre slide-over com detalhes    │
│ ...                                                  │
│                                                      │
│ TECHNICAL NOTES                                      │
│ PATCH de deal deve registrar Activity automatica:    │
│ "Deal movido de {fromStage} para {toStage}"         │
│ ...                                                  │
│                                                      │
│ BUSINESS CONTEXT                                     │
│ Pipeline visual e o core do CRM para o time de      │
│ vendas. Rafael move deals entre stages conforme     │
│ avanca negociacao.                                   │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### Campos

| Campo | Obrigatorio | Descricao |
|-------|-------------|-----------|
| Reference | Sim | Identificador unico (TASK-001) |
| Titulo | Sim | Nome curto e descritivo |
| Descricao | Nao | Objetivo da task em 1-2 frases |
| Tipo | Sim | setup, feature, component, seed, bugfix, refactor, management |
| Scope | Sim | micro, small, medium, large |
| Complexity | Sim | trivial, low, medium, high |
| Story Points | Auto | Sugerido por scope x complexity (fibonacci), editavel |
| Dependencies | Nao | Lista de references que precisam estar done antes |
| Due Date | Nao | Prazo de entrega dentro do sprint |
| Execution Mode | Sim | agent (IA executa) ou manual (humano executa) |
| Acceptance Criteria | Recomendado | Checklist de criterios verificaveis |
| Technical Notes | Recomendado | Snippets, queries, payloads, estrutura de dados |
| Business Context | Recomendado | Porque essa task existe, qual persona se beneficia |
| Out of Scope | Nao | O que explicitamente NAO deve ser feito |
| UI Guidance | Nao | Referencias visuais, componentes a usar, layout |

### Tipos de task

| Tipo | Cor | Descricao | Exemplo |
|------|-----|-----------|---------|
| setup | Roxo | Infraestrutura, config, CI/CD | Setup Next.js + Prisma |
| feature | Azul | Funcionalidade de negocio | CRUD de Contatos |
| component | Teal | Componente reutilizavel | DataTable, KanbanBoard |
| seed | Ambar | Dados mock, populacao de banco | Seed de dados mock |
| bugfix | Vermelho | Correcao de bug | Fix hydration error |
| refactor | Cinza | Melhoria tecnica sem mudanca funcional | Padronizar containers |
| management | Rosa | Gestao, alinhamento, QA de aceite | Kickoff com cliente |

### Status flow

```
backlog → todo → in_progress → review → approved → done
                      │                     │
                      ├→ changes_requested ──┘
                      ├→ merge_conflict
                      └→ staging_failed
```

---

## 5. Sprints

### Modelo

- **Duracao fixa:** 15 dias (2 semanas uteis)
- **Cada sprint pertence a 1 projeto**
- **Nomenclatura:** "Sprint N — Tema" (ex: "Sprint 1 — Fundacao")

### Distribuicao de tasks

Tasks sao atribuidas a sprints com base em:

1. **Dependencias** — se TASK-010 depende de TASK-005, ambas no mesmo sprint ou TASK-005 no sprint anterior
2. **Capacity** — soma dos SP das tasks atribuidas a um membro nao pode exceder seu capacity
3. **Prioridade** — tasks MVP antes de Next
4. **Due date** — prazo de entrega respeita a ordem de dependencias dentro do sprint

### Board

Kanban com 8 colunas: Backlog, To Do, In Progress, Review, Changes Req., Approved, Staging, Done.

Drag-and-drop move tasks entre colunas. Cada movimento valida a transicao (nao pode pular de Backlog pra Done).

---

## 6. Capacity

### A filosofia

Na Volund, **Story Points sao a metrica universal de producao.** Tudo se mede em SP: tasks, sprints, membros, projetos. SP nao e tempo — e esforco relativo. Mas quando calibrado corretamente, SP se torna a forma mais confiavel de prever o que o time consegue entregar.

Nosso objetivo e encontrar o **Sweet Spot**: a intersecao entre estimar tasks com precisao e entender o quanto cada Volunder produz por sprint. Quanto mais acertamos os dois lados, mais previsivel e a operacao.

```
         Estimativa de SP          Capacity do membro
         (quanto custa)            (quanto produz)
              │                          │
              ▼                          ▼
        ┌───────────┐            ┌───────────────┐
        │ scope ×   │            │ velocity real  │
        │ complexity │            │ media movel    │
        │ + spec    │            │ dos ultimos    │
        │ analysis  │            │ 3 sprints      │
        └─────┬─────┘            └───────┬───────┘
              │                          │
              └──────────┬───────────────┘
                         │
                         ▼
                   SWEET SPOT
              Planejamento confiavel
         "Esse sprint cabe. Esse nao."
```

### O modelo

```
Capacity do membro = SP que ele consegue entregar por sprint (descoberto via velocity)
Alocacao = soma dos SP das tasks ativas atribuidas a ele
Disponivel = capacity - alocacao
Utilizacao = alocacao / capacity (%)
```

### Capacity por role e nivel

Cada role tem uma faixa de capacity diferente. Dentro de cada role, o nivel de senioridade influencia:

| Role | Junior | Pleno | Senior | Notas |
|------|--------|-------|--------|-------|
| **UI/UX Builder** | 50-65 SP | 65-85 SP | 85-100 SP | Output visual, componentes |
| **Backend/QA Builder** | 50-65 SP | 65-85 SP | 85-100 SP | APIs, logica, testes |
| **Fullstack** | 55-70 SP | 70-90 SP | 90-110 SP | Range maior pela versatilidade |
| **Tech Specialist** | — | 40-50 SP | 50-70 SP | Foco em review, nao volume. So pleno+ |
| **PM** | — | 30-35 SP | 35-45 SP | Tasks de gestao. So pleno+ |

**Porque o range importa:** um Backend Junior entrega ~55 SP de features simples. O mesmo Backend Senior entrega ~90 SP porque resolve tasks complexas mais rapido e com menos iteracoes. O SP da task e o mesmo — o que muda e quantos SP o membro consegue absorver por sprint.

**Baseline inicial:** quando um membro novo entra, usamos o meio da faixa do nivel dele. Ex: Backend Pleno = 75 SP. Apos 3 sprints, o numero real substitui o baseline.

### Capacity de Sprints e Design Sessions

Nao sao apenas membros que tem capacity. **Sprints e Design Sessions tambem tem teto de SP:**

**Sprint:**
```
SP maximo do sprint = soma do capacity disponivel de todos os membros alocados

Exemplo:
  Lucas (Fullstack Pleno):    85 SP disponiveis
  Camila (UI/UX Pleno):       75 SP disponiveis
  Rafael (Backend Pleno):     75 SP disponiveis
  Ana (PM Pleno):             35 SP disponiveis
                              ─────────────────
  Capacity do sprint:         270 SP

  Alocacao recomendada: 270 × 0.85 = ~230 SP (buffer de 15%)
```

O PM nao deve alocar mais que 85% do capacity do sprint. Se o backlog tem 300 SP e o sprint suporta 230 SP, as tasks sobram pro proximo sprint.

**Design Session:**
```
Inception gera entre 150-300 SP de tasks (tipico pra MVP)
  → Se o squad tem capacity de ~230 SP/sprint
  → MVP cabe em 1-2 sprints (15-30 dias)

CI Session gera entre 50-150 SP (melhorias e novas features)
  → Cabe em 1 sprint na maioria dos casos
```

Isso permite estimar **antes da session** quanto tempo o projeto vai levar: "temos um squad de 4 com ~230 SP/sprint, o escopo parece ~400 SP, serao 2 sprints (~30 dias)."

### Estimativa de SP: o outro lado do Sweet Spot

Capacity so funciona se a estimativa de SP for precisa. Nosso modelo:

**1. Matriz scope × complexity (sugestao automatica)**

|  | trivial | low | medium | high |
|--|---------|-----|--------|------|
| micro | 1 | 2 | 3 | 5 |
| small | 2 | 3 | 5 | 8 |
| medium | 3 | 5 | 8 | 13 |
| large | 5 | 8 | 13 | 21 |

**2. Task-ancora pra calibracao**

CRUD simples (listagem + create + edit + delete, 1 entidade, 5-6 campos, API + pagina) = **5 SP**

Toda estimativa e relativa a essa ancora: "essa task e ~3x um CRUD simples = 13 SP."

**3. Spec como indicador de complexidade**

Quanto mais detalhada a spec, mais precisa a estimativa:
- Muitos acceptance criteria + integracoes externas → SP mais alto
- CRUD simples com poucos criteria → SP mais baixo
- Keywords de complexidade (drag-and-drop, real-time, parsing) → ajuste pra cima

**4. Calibracao continua**

Apos cada sprint, comparamos SP estimado vs esforco real:
- Se tasks de 8 SP consistentemente levam o mesmo tempo que tasks de 13 SP → recalibrar
- Se um tipo de task sempre subestima → ajustar o peso na matriz
- Meta: erro medio de estimativa < 20% apos 3 sprints

### Calibracao de capacity

O baseline e hipotese. A velocity real calibra:

| Fase | Quando | O que acontece |
|------|--------|----------------|
| **Baseline** | Membro novo | Usa meio da faixa do role+nivel. Ex: Backend Pleno = 75 SP |
| **Sprint 1** | Primeiro sprint | Mede velocity real. Nao cobra meta. Aloca ~60% do baseline |
| **Sprint 2-3** | Calibracao | `capacity = velocity media × 1.15` (margem de crescimento) |
| **Sprint 4+** | Estavel | `capacity = media movel dos ultimos 3 sprints`. Sem margem artificial |
| **Trimestral** | A cada 6 sprints | Review: membro melhorou? Mudou de stack? Burnout? Ajusta |

**O numero e do membro, nao da empresa.** Dois Backend Plenos podem ter capacities diferentes (72 vs 88). Isso e normal — reflete experiencia, contexto, stack.

### Multi-projeto

Um Volunder pode estar em mais de 1 projeto. O Zordon cruza alocacao total:

```
Lucas — Fullstack Pleno — Capacity: 85 SP/sprint
  Projeto CRM:     37 SP (44%)
  Projeto Portal:  40 SP (47%)
  Total:           77 SP (91%) ⚠️ acima de 85%

Camila — UI/UX Pleno — Capacity: 75 SP/sprint
  Projeto CRM:     44 SP (59%)
  Total:           44 SP (59%) ✓
```

**Regras:**
- ⚠️ Alerta quando total > 85% — PM deve redistribuir
- 🔴 Bloqueio quando total > 100% — impossivel de entregar, sprint vai estourar
- Os 15% de buffer cobrem: bugs urgentes, code review, overhead de comunicacao, context switching entre projetos

### O Sweet Spot na pratica

Quando estimativa e capacity estao calibrados, o PM consegue responder com confianca:

| Pergunta | Resposta |
|----------|---------|
| Cabe mais 1 feature nesse sprint? | "Temos 23 SP disponiveis, a feature e ~13 SP. Cabe." |
| Quando entregamos o MVP? | "Faltam 180 SP, temos 230 SP/sprint. ~1 sprint (15 dias)." |
| Podemos absorver outro projeto? | "Lucas esta em 44%, Camila em 59%. Tem espaco." |
| Quanto custa esse projeto? | "~400 SP × R$47/SP = ~R$18.800 em mao de obra." |

Isso e o Sweet Spot: **planejamento baseado em dados, nao em feeling.**

---

## 7. Roles

### Como o time opera

A Volund opera com squads pequenos (3-5 pessoas) que combinam humanos e agentes IA.

| Role | Coda? | Relacao com IA | Responsabilidade principal |
|------|-------|----------------|---------------------------|
| PM | Nao | Define prioridades pra agentes | Coordenar time e alinhar com cliente |
| UI/UX Builder | Sim | Escreve UI guidance, valida output visual | Interface e design system |
| Backend/QA Builder | Sim | Escreve tech notes, faz code review do agente | APIs, logica, qualidade |
| Fullstack | Sim | Atua em ambos os lados | End-to-end, coringa |
| Tech Specialist | Pouco | Audita codigo humano e de agentes | Homologacao final, gate de producao |

### O Tech Specialist como gate

Nenhum codigo vai pra producao sem passar pelo Tech Specialist. Ele:
- Audita seguranca (OWASP top 10, injecao, XSS)
- Verifica performance (queries N+1, bundle size)
- Checa padroes (naming, arquitetura, design system)
- Valida que o output do agente IA e producao-ready

Isso e especialmente critico na esteira agentica — agentes geram volume alto de codigo que pode ter alucinacoes sutis.

---

## 8. Agentes IA

### Como funcionam

Agentes sao modelos de IA (Claude, GPT-4) que executam tasks automaticamente.

**Fluxo de execucao:**

```
Task com mode "agent"
    │
    ▼
Zordon monta prompt com spec da task
(AC + tech notes + UI guidance + context)
    │
    ▼
Agente gera codigo
    │
    ▼
Resultado salvo como TaskIteration
(prompt, resultado, tokens, sucesso/falha)
    │
    ▼
Builder responsavel faz code review
    │
    ▼
Tech Specialist audita
    │
    ▼
Merge
```

### O que o agente recebe

O agente recebe a spec da task como prompt. Quanto mais completa a spec, melhor o output:

- **Acceptance criteria** → o agente sabe exatamente o que entregar
- **Technical notes** → o agente sabe como implementar (queries, estrutura)
- **UI guidance** → o agente sabe como deve ficar visualmente
- **Dependencies** → o agente sabe quais componentes ja existem pra reusar
- **Out of scope** → o agente sabe o que NAO fazer (evita over-engineering)

### Iteracoes

Se o output do agente falha no review, uma nova iteracao e disparada:

- **Tipo:** revision (ajuste pos-review), merge_fix (conflito de merge)
- **Trigger:** review_feedback (humano pediu mudanca), merge_conflict (automatico)

Cada iteracao e rastreada com: prompt enviado, tokens consumidos, resultado, custo.

---

## 9. Nivel de Atencao

O Zordon calcula automaticamente o nivel de atencao de cada projeto.

| Nivel | Indicador | Criterios |
|-------|-----------|-----------|
| 🟢 Baixo | Dot verde | 0 tasks atrasadas, sprint no ritmo |
| 🟡 Medio | Dot amarelo | 1-3 tasks atrasadas OU sprint atrasado <20% |
| 🔴 Alto | Dot vermelho | 4+ tasks atrasadas OU sprint atrasado >=20% |
| 🚨 Urgencia | Dot vermelho pulsante | Deadline <7 dias com progresso <80% OU membro acima de 100% |

O PM ve isso na overview do projeto e na overview global. Nao precisa perguntar "como esta o projeto?" — o sistema responde.

---

## 10. Glossario

| Termo | Definicao |
|-------|-----------|
| **Design Session** | Reuniao estruturada que captura requisitos |
| **Inception** | Primeiro Design Session de um projeto (7 steps) |
| **CI (Melhoria Continua)** | Design Session de ciclos subsequentes |
| **Briefing** | Documento consolidado gerado pela session |
| **Task** | Unidade de trabalho com spec completa |
| **SP (Story Points)** | Medida de esforco relativo |
| **Sprint** | Ciclo de 15 dias de execucao |
| **Capacity** | Quantidade de SP que um membro entrega por sprint |
| **Velocity** | SP realmente entregues por sprint (medido, nao estimado) |
| **Spec-driven** | Task com spec detalhada o suficiente pra execucao sem reuniao |
| **Task-ancora** | CRUD simples = 5 SP. Referencia de calibracao |
| **Board** | Kanban de um sprint com drag-and-drop |
| **Surface** | Padrao visual de containers (bg-card + ring sutil) |
| **Agent** | Modelo de IA que executa tasks automaticamente |
| **Iteration** | Cada execucao de um agente em uma task |
| **Tech Specialist** | Senior que audita codigo antes de producao |
| **Attention Level** | Indicador automatico de saude do projeto |
