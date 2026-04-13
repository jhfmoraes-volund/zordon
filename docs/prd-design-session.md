# PRD — Design Session

> Feature do Volund (AgentOps) para captura estruturada de requisitos com clientes,
> com geracao inteligente de tasks via IA.

---

## 1. Problema

Hoje tasks nascem sem rastreabilidade. Ninguem sabe responder com certeza:
- "O cliente pediu isso exatamente assim?"
- "O que ficou de fora do escopo?"
- "Por que essa task existe?"

O resultado e retrabalho, escopo mal definido, e decisoes baseadas em memoria — nao em registro.

## 2. Solucao

**Design Session** e um wizard guiado por steps tematicos, vinculado a um projeto. O facilitador conduz o cliente por cada etapa, capturando requisitos de forma estruturada. Ao final, uma IA analisa tudo e gera tasks prontas para o backlog.

Otimizado para software house agentica — foco em entender o problema e gerar inputs ricos para desenvolvimento com IA.

## 3. Usuarios

| Persona | Papel na Session |
|---|---|
| **Head de Ops / Facilitador** | Cria a session, conduz os steps, registra items, valida tasks geradas |
| **Builder** | Participa para entender contexto tecnico, contribui nos steps |
| **Cliente (Stakeholder)** | Apresenta necessidades, valida priorizacao, aprova escopo |

## 4. Tipos de Session

### 4.1 Inception

Para projetos novos que estao comecando do zero.

**Objetivo:** Entender o problema, mapear personas e jornadas, levantar solucoes, priorizar e sequenciar entregas.

**Duracao:** 1.5-2.5 horas (6 steps)

**Quando usar:** Primeiro contato tecnico com o cliente. O projeto ainda nao tem backlog.

### 4.2 Continuous Improvement

Para projetos em andamento que precisam de novas features ou correcoes.

**Objetivo:** Alinhar demandas pontuais, priorizar, gerar tasks para o proximo sprint.

**Duracao:** 1-2 horas (5 steps)

**Quando usar:** Reuniao recorrente de alinhamento. O projeto ja tem historico.

---

## 5. Wizard — Steps por Tipo

### Arquitetura do Wizard

- **WizardLayout** compartilhado com header, progress bar e drawer de navegacao
- Cada step e uma pagina/rota independente (`/design-sessions/[id]/steps/[step]`)
- Navegacao via `onNext` / `onPrevious` + drawer lateral para pular steps
- Steps sao opcionais — usuario pode avancar sem preencher tudo
- Auto-save com debounce de 500ms

### 5.1 Inception — 6 Steps

```
Step 0: Visao do Produto
Step 1: Personas & Jornadas (AS-IS + TO-BE)
Step 2: Brainstorm de Solucoes
Step 3: Priorizacao & Escopo (MVP / Next / Out)
Step 4: Sequenciamento (Fases/Releases)
Step 5: Briefing + Geracao de Tasks
```

#### Step 0 — Visao do Produto

**Objetivo:** Estabelecer por que o produto precisa existir e como e o sucesso.

**UI:** Dois cards — "O Problema" e "Visao de Sucesso"

| Campo | Tipo | Exemplo |
|---|---|---|
| problem | textarea | "Gestores de vendas perdem leads por falta de visibilidade no pipeline" |
| whoSuffers | input | "Gestores de vendas em empresas B2B de medio porte" |
| consequences | textarea | "Leads esfriam, taxa de conversao cai 30%" |
| successVision | textarea | "Dashboard em tempo real com leads rankeados por probabilidade" |
| impactMetrics | textarea | "Reducao de 50% no tempo de resposta a leads" |

**Preview:** Texto consolidado ao vivo.

#### Step 1 — Personas & Jornadas

**Objetivo:** Mapear quem sofre com o problema e como vive isso hoje vs como sera com a solucao.

**UI:** Lista de Persona Cards. Cada persona tem:

| Secao | Conteudo |
|---|---|
| **Info** | Nome, papel, contexto |
| **Jornada AS-IS** | Passos numerados + pain points (dor/frustracao em cada passo) |
| **Jornada TO-BE** | Passos numerados + gains (ganho em cada passo) |

**Dinamica:**
- Adicionar personas via form inline
- Para cada persona, mapear passos da jornada atual e futura
- Pain points e gains geram inputs para brainstorm e priorizacao

**Formato de dados:**
```json
{
  "personas": [
    {
      "id": "...",
      "name": "Maria",
      "role": "Gestora de vendas B2B",
      "context": "Gerencia equipe de 8 vendedores...",
      "asIsSteps": [
        { "id": "...", "description": "Abre planilha", "painOrGain": "Perde 40min/dia filtrando" }
      ],
      "toBeSteps": [
        { "id": "...", "description": "Abre dashboard", "painOrGain": "Foco em leads quentes" }
      ]
    }
  ]
}
```

#### Step 2 — Brainstorm de Solucoes

**Objetivo:** Gerar ideias sem filtro. Divergir antes de convergir.

**UI:** Grid de Solution Cards (amarelos, estilo post-it)

| Campo | Tipo |
|---|---|
| title | input — nome da solucao |
| howItSolves | textarea — como resolve o problema |
| targetPersona | badge selector — pra qual persona |

**Dinamica:**
- Adicionar ideias livremente
- Cada card vincula a uma persona (do step anterior)
- Sem filtro — tudo e valido neste momento

**IA opcional (futuro):** Botao "Sugerir solucoes com IA" — analisa visao + personas + jornadas e sugere.

#### Step 3 — Priorizacao & Escopo

**Objetivo:** Filtrar solucoes em 3 buckets simples.

**UI:** Grid 3 colunas com cards moviveis:

| Bucket | Cor | Descricao |
|---|---|---|
| **MVP** | Verde | Entra agora. Essencial pro primeiro release. |
| **Next** | Azul | Proximo ciclo. Importante, mas nao pra agora. |
| **Out** | Cinza | Fora do escopo. Documentado pra futuro. |

**Dinamica:**
- Solucoes do brainstorm entram automaticamente no MVP
- Facilitador move pra Next ou Out conforme alinhamento com cliente
- Botoes de mover entre buckets (drag & drop futuro)

**Por que 3 buckets em vez de MoSCoW (4):**
- Menos debate, mais velocidade
- "Out" cobre o "Won't Have" + "Nao E/Nao Faz"
- Binary decision: "entra agora ou nao?" e mais rapido que 4 niveis

#### Step 4 — Sequenciamento

**Objetivo:** Organizar items MVP em fases/releases com ordem de entrega.

**UI:** Colunas horizontais (fases), cada uma com lista de items.

**Dinamica:**
- Items MVP do step anterior entram numa unica fase "Release 1"
- Facilitador cria novas fases e redistribui
- Move items entre fases via botoes
- Cada fase = um bloco de entrega independente

**Por que sequenciamento como step explicito:**
- Da a IA contexto de **ordem**, nao so prioridade
- Tasks da fase 1 devem ser granulares (max 1 dia)
- Tasks da fase 2+ podem ser mais abrangentes

#### Step 5 — Briefing + Geracao de Tasks

**Objetivo:** Consolidar tudo e gerar tasks para o backlog.

**UI em 2 fases:**

**Fase 1 — Briefing (read-only)**
Documento agregado com todas as secoes anteriores:
1. Visao do produto (Step 0)
2. Personas & jornadas (Step 1)
3. Solucoes levantadas (Step 2)
4. Priorizacao MVP/Next/Out (Step 3)
5. Sequenciamento em fases (Step 4)

**Fase 2 — Geracao de Tasks (futuro)**
Botao "Gerar Tasks com IA" → loading → preview → confirmar.

---

### 5.2 Continuous Improvement — 5 Steps

```
Step 0: Retrospectiva
Step 1: Novas Demandas
Step 2: Priorizacao (MoSCoW)
Step 3: Refinamento Tecnico
Step 4: Briefing + Geracao de Tasks
```

*(Sem alteracoes — mantido conforme versao anterior)*

---

## 6. Modelo de Dados

### 6.1 DesignSession

| Campo | Tipo | Descricao |
|---|---|---|
| id | cuid | PK |
| projectId | FK → Project | Projeto vinculado |
| type | string | `inception` \| `continuous_improvement` |
| status | string | `draft` \| `in_progress` \| `completed` \| `cancelled` |
| title | string | Nome descritivo |
| description | text? | Contexto geral |
| currentStep | int | Step atual do wizard (0-indexed) |
| totalSteps | int | Total de steps (6 inception, 5 CI) |
| scheduledAt | datetime? | Data/hora agendada |
| completedAt | datetime? | Quando foi finalizada |
| actualDurationMin | int? | Duracao real em minutos |
| createdBy | string? | FK → Member |
| createdAt | datetime | |
| updatedAt | datetime | |

### 6.2 DesignSessionParticipant

| Campo | Tipo | Descricao |
|---|---|---|
| id | cuid | PK |
| sessionId | FK → DesignSession | |
| memberId | FK → Member? | Participante interno |
| externalName | string? | Participante externo |
| externalEmail | string? | Email externo |
| externalRole | string? | Cargo externo |
| role | string | `facilitator` \| `technical` \| `stakeholder` \| `decider` \| `observer` |

### 6.3 DesignSessionStepData

Dados de cada step, armazenados como JSON flexivel.

| Campo | Tipo | Descricao |
|---|---|---|
| id | cuid | PK |
| sessionId | FK → DesignSession | |
| stepIndex | int | Qual step (0, 1, 2...) |
| stepKey | string | Chave semantica |
| data | JSON | Dados do step |
| updatedAt | datetime | |

**Formato do `data` por step key:**

**`product_vision`:**
```json
{
  "problem": "...",
  "whoSuffers": "...",
  "consequences": "...",
  "successVision": "...",
  "impactMetrics": "..."
}
```

**`personas_journeys`:**
```json
{
  "personas": [
    {
      "id": "...",
      "name": "...",
      "role": "...",
      "context": "...",
      "asIsSteps": [{ "id": "...", "description": "...", "painOrGain": "..." }],
      "toBeSteps": [{ "id": "...", "description": "...", "painOrGain": "..." }]
    }
  ]
}
```

**`brainstorm`:**
```json
{
  "solutions": [
    { "id": "...", "title": "...", "howItSolves": "...", "targetPersona": "..." }
  ]
}
```

**`prioritization`:**
```json
{
  "items": [
    { "id": "...", "title": "...", "howItSolves": "...", "targetPersona": "...", "bucket": "mvp|next|out" }
  ]
}
```

**`sequencing`:**
```json
{
  "phases": [
    {
      "id": "...",
      "name": "Release 1",
      "items": [{ "id": "...", "title": "...", "targetPersona": "..." }]
    }
  ]
}
```

### 6.4 DesignSessionItem

Items consolidados para geracao de tasks.

| Campo | Tipo | Descricao |
|---|---|---|
| id | cuid | PK |
| sessionId | FK → DesignSession | |
| title | string | Nome curto |
| description | text | Descricao detalhada |
| type | string | `feature` \| `bugfix` \| `improvement` \| `rule` \| `constraint` |
| priority | string | `must` \| `should` \| `could` \| `wont` |
| sourceStep | string | De qual step veio |
| aiGenerated | boolean | Se foi sugerido pela IA |
| orderIndex | int | |

---

## 7. Componentes de UI

### PersonaJourneyBoard

Board para mapear personas com jornadas AS-IS e TO-BE.

```
Props:
- personas: Persona[]
- onAdd(persona)
- onUpdate(personaId, data)
- onDelete(personaId)
- onAddJourneyStep(personaId, type, step)
- onUpdateJourneyStep(personaId, type, stepId, step)
- onDeleteJourneyStep(personaId, type, stepId)
```

### SolutionCardBoard

Grid de solution cards para brainstorm.

```
Props:
- solutions: SolutionCard[]
- onAdd(solution)
- onUpdate(id, data)
- onDelete(id)
- personaNames: string[]
```

### PriorityBoard

Grid 3 colunas (MVP / Next / Out) para priorizacao.

```
Props:
- items: PrioritizedItem[]
- onMove(itemId, toBucket)
- onDelete(itemId)
```

### SequencingBoard

Colunas horizontais para organizar items em fases.

```
Props:
- phases: Phase[]
- onAddPhase(phase)
- onDeletePhase(phaseId)
- onRenamePhase(phaseId, name)
- onMoveItem(itemId, fromPhaseId, toPhaseId)
- onRemoveItem(phaseId, itemId)
```

### PostItBoard

Grid de PostIt notes editaveis. Usado em steps de CI.

```
Props:
- sections: { key, title, color, items[] }
- onAdd(sectionKey, text)
- onUpdate(sectionKey, itemId, text)
- onDelete(sectionKey, itemId)
- columns: 2 | 3 | 4
```

### WizardLayout

Layout compartilhado do wizard.

```
Props:
- currentStep: number
- totalSteps: number
- steps: StepDef[]
- onNext()
- onPrevious()
- onStepClick(index)
- sessionTitle: string
- sessionType: string
- saving: boolean
```

---

## 8. Geracao de Tasks via IA (futuro)

### 8.1 Prompt

O prompt sera enriquecido com dados de personas e jornadas:

```
Voce e um gerente de projetos tecnico de uma software house especializada
em desenvolvimento agentico (IA + humanos).

## Visao do Produto
Problema: {product_vision.problem}
Quem sofre: {product_vision.whoSuffers}
Visao de sucesso: {product_vision.successVision}

## Personas & Jornadas
{para cada persona:}
  Persona: {nome} — {role}
  AS-IS: {passos com pain points}
  TO-BE: {passos com gains}
  Delta: {o que precisa mudar}

## Solucoes Priorizadas (MVP)
{items com bucket === "mvp", com contexto de howItSolves e targetPersona}

## Sequenciamento
Fase 1: {items da fase 1}
Fase 2: {items da fase 2}
...

## Instrucoes
Gere tasks tecnicas respeitando a ordem das fases.
- Tasks da fase 1: granulares (max 1 dia cada)
- Tasks da fase 2+: podem ser mais abrangentes
- Cada task: title, description, complexity, scope, sourcePhase
- O delta AS-IS → TO-BE deve guiar o que cada task precisa implementar
```

---

## 9. Regras de Negocio

| Regra | Detalhe |
|---|---|
| Steps sao opcionais | Usuario pode avancar sem preencher |
| Navegacao livre | Pode pular steps via drawer |
| Seed automatico | Priorizacao puxa do brainstorm; Sequenciamento puxa do MVP |
| Out nao gera tasks | Ficam documentados mas excluidos |
| Session read-only | Ao completar, fica read-only. Pode reabrir. |
| Multiplas sessions | 1 projeto pode ter N sessions |
| Auto-save | Dados salvos automaticamente com debounce 500ms |

---

## 10. Plano de Implementacao

### Fase A — Schema + Steps base (concluido)
- Tabelas Prisma
- API routes CRUD
- Step definitions (6 inception, 5 CI)
- WizardLayout com navegacao

### Fase B — Novos componentes de inception (concluido)
- ProductVisionStep
- PersonaJourneyBoard (AS-IS + TO-BE)
- SolutionCardBoard (brainstorm)
- PriorityBoard (MVP/Next/Out)
- SequencingBoard (fases)
- BriefingStep (consolidado read-only)

### Fase C — Geracao de Tasks via IA (pendente)
- Integracao OpenAI/Claude API
- Prompt builder com dados de personas e jornadas
- TaskPreview com edicao inline
- Criacao em lote no backlog

### Fase D — Continuous Improvement (pendente)
- Steps especificos de CI
- Puxar tasks done automaticamente
- Reutilizar priorizacao e briefing

### Fase E — Polish (pendente)
- IA sugestiva nos steps (sugerir solucoes, sugerir fases)
- Timer visual
- Export PDF
- Templates pre-configurados
