---
status: draft
owner: João Moraes
date: 2026-05-31
domain: agents / vitor / prd-authoring
codenames:
  - vitor-prd-quality   # rigor de geração de PRDs em todos os caminhos
  - forge-ready-prd     # bar mínima pra PRD ser consumido pela Forja
related_prds:
  - docs/prd/backlog/prd-vitor-output-as-prd.md   # define a entidade PRD; este aqui define a QUALIDADE do conteúdo
  - docs/prd/backlog/prd-forge-from-vitor.md      # consumidor downstream
references:
  - src/lib/agent/agents/vitor/prd-schemas.ts
  - src/lib/agent/prompt.ts                       # sub-fase PRD_DRAFTING (Inception)
  - src/lib/agent/vitor/prompts/prd-quickask.ts   # Quick-Ask isolado
  - src/lib/sessions/prd-session/jobs.ts          # persist path Quick-Ask
  - src/lib/forge/prd-fs.ts                       # consumidor Forja
---

# PRD — Vitor produz PRDs prontos pra Forja, em todos os caminhos

> **TL;DR:** Hoje Vitor produz PRDs por dois caminhos (Quick-Ask e Inception briefing) com **schemas e rigor diferentes**, e o Quick-Ask em particular gera shells com 70% dos campos vazios. A Forja consome esses PRDs e precisa de spec sólida pra rodar autônoma — sem isso, vira retrabalho humano. Este PRD unifica o **schema, validação e rigor de conteúdo** entre os dois caminhos, define a barra **Forge-Ready**, e instrumenta o pipeline pra que todo PRD que sair do Vitor passe nessa barra antes de chegar ao Builder.

---

## 1. Problema

### 1.1 Estado real (auditoria 2026-05-31)

Auditoria nos 10 PRDs gerados na DS `f3488548-…` ("clonar o calendly") revelou:

- **PRD-001 e PRD-002**: ricos (3.5 KB markdown, 7 AC Given/When/Then, 5 user journeys, 4 métricas, 5 out-of-scope, 4 riscos, technicalNotes denso). Foram **editados manualmente** após a geração inicial.
- **PRD-003 a PRD-010**: shells (~700 B markdown). `oneLiner` vazio, `goal` vazio, `userJourney=[]`, `successMetrics=[]`, `outOfScope=[]`, `risksAndAssumptions=[]`, `technicalNotes=""`. AC armazenado como `string[]` simples (não `{given, when, then}`), o que faz o trigger `prd_render_markdown` produzir `**Given** **When** **Then**` vazio.

A causa raiz é arquitetural — **dois pipelines paralelos com schemas inconsistentes**:

| Caminho | Arquivo | Schema do output | Validação |
|---|---|---|---|
| **Inception briefing** (sub-fase PRD_DRAFTING) | [src/lib/agent/agents/vitor/prd-schemas.ts](src/lib/agent/agents/vitor/prd-schemas.ts) | `ProposePrdInput` — 11 campos, AC `{given,when,then}`, journey, metrics, risks | Zod: `problem.min(50)`, `goal.min(20)`, `AC.min(3)` — **frouxo** |
| **Quick-Ask** (PRD Session sub-kind) | [src/lib/agent/vitor/prompts/prd-quickask.ts:20](src/lib/agent/vitor/prompts/prd-quickask.ts#L20) | `prdItemSchema` — 5 campos, AC `string[]`, sem journey/metrics/risks | Zod: só presença, sem `.min()` em texto |

Quick-Ask roda Haiku single-shot pra gerar até 10 PRDs num turno — o modelo não tem capacidade de produzir 10× a estrutura completa de qualidade. Inception roda em sub-fase dedicada com brainstorm + decisões + personas como contexto, mas a validação Zod aceita PRD pobre (`problem.min(50)` permite uma frase rasa).

### 1.2 Por que isso quebra a Forja

A Forja (loop autônomo) consome PRD via [src/lib/forge/prd-fs.ts](src/lib/forge/prd-fs.ts) e espera material pra:

1. **Inferir schema/RLS**: precisa de `technicalNotes` denso + AC que mencionem tabelas/policies.
2. **Inferir contratos de API**: precisa de AC em Given/When/Then descrevendo endpoint/status/payload.
3. **Inferir critério de parada**: precisa de `successMetrics` com instrumento (query, dashboard).
4. **Inferir DAG**: precisa de `dependencies` resolvidas (PRD-A `blocks` PRD-B).

PRD shell entrega só `title + problem + AC plana`. Builder fica inventando schema/contratos/métricas — o que já se observou em runs de Forja anteriores (gera código que não bate com a intenção do PM).

### 1.3 Princípio do user

> "Quero ter o Vitor produzindo PRDs com o rigor que precisamos."
> — João, 2026-05-31

E o rigor que precisamos é o que o [/tmp/calendly-prds.sql](/tmp/calendly-prds.sql) (versão rica dos 10 PRDs reescrita manualmente em 2026-05-31) representa. Esse SQL vira a referência gold-standard pro Vitor.

---

## 2. Solução em uma frase

**Unificar o schema de PRD entre Quick-Ask e Inception, instituir uma barra "Forge-Ready" verificável server-side, e instrumentar o Vitor (via reference library + 2-stage deepening + validators) pra que todo PRD chegue à Forja com problem/goal/journey/AC/metrics/risks/dependencies preenchidos com densidade suficiente.**

---

## 3. Não-objetivos

- **Não** reescrever a UI de revisão de PRD — ela já existe em `/projects/[id]/prds/[id]` (ver `prd-vitor-output-as-prd.md` Fase 2).
- **Não** mudar a entidade `ProductRequirement` ou suas FKs — schema da tabela já está bom (auditoria DB 2026-05-31 confirmou: 17 campos, trigger `prd_render_markdown` cobre o render). Mudanças aqui são **só** em pipelines de escrita.
- **Não** introduzir agente novo. Vitor continua sendo o único PRD author. "Deepening" é um modo do próprio Vitor (Sonnet), não um agente separado.
- **Não** retroativamente reescrever PRDs já aprovados em projetos vivos (ex: Zelar). Bar nova aplica em PRDs `status IN ('draft', 'review')` criados após Fase 1.
- **Não** acoplar a barra Forge-Ready à aprovação humana. PM pode aprovar PRD que não passe na barra (com aviso); a barra só **bloqueia** a Forja, não o aprovador humano.
- **Não** adicionar campo novo em `ProductRequirement` (todos campos necessários já existem na tabela).

---

## 4. Personas e jornada

### 4.1 João (PM, autor de DS Inception)

> "Rodo DS de Inception. Vitor cria 8-12 PRDs do brainstorm. Eu reviso na árvore lateral. Hoje, metade dos PRDs vem com `userJourney` vazio e métricas faltando — eu preencho na mão. Quero que o Vitor entregue o PRD **completo** já no draft. Se ficar com lacuna, quero ver um badge 'incompleto' explícito, não descobrir só quando a Forja falhar."

### 4.2 João (PM rodando Quick-Ask)

> "Mando 'clone calendly' no Quick-Ask e recebo 10 PRDs em 30 segundos. Hoje, dois saem ricos e oito vazios. Quero que **todos** os 10 saiam com a estrutura básica (problem 2 parágrafos, ≥5 AC Given/When/Then, ≥3 journey steps, ≥3 métricas com instrumento). Aceito pagar mais latência (até 90s) se isso significa que posso mandar pra Forja sem revisar campo por campo."

### 4.3 Forja (consumidor downstream)

> "Recebo PRD via [src/lib/forge/prd-fs.ts](src/lib/forge/prd-fs.ts). Pra rodar bem, preciso de: AC com Given/When/Then explícitos (consigo gerar testes), `technicalNotes` com schema/RLS sugerido, `dependencies` resolvidas (sei a ordem de execução), `successMetrics` com instrumento (sei quando parar). PRD que não tem isso vira retrabalho — eu invento decisão arquitetural que o PM não validou."

### 4.4 Vitor (PRD author)

> "Hoje rodo Haiku single-shot no Quick-Ask, e mesmo no Inception meu prompt não me cobra densidade real. Preciso de: (a) reference PRDs concretos como few-shot, (b) validador server-side que rejeita meu output pobre antes de salvar, (c) modo deepening (Sonnet) que pega meu shell e enriquece — separando 'descoberta' de 'escrita densa'."

### 4.5 Sponsor / Builder externo (futuro)

> "Vou consumir PRD via API export. Pra eu confiar, preciso garantir que **todos** os PRDs publicados passaram numa barra mínima — não posso depender de quem leu/aprovou. Quero badge `forge_ready=true` no JSON exportado."

---

## 5. Decisões fixadas

| ID | Decisão | Escolha | Por quê |
|---|---|---|---|
| **D1** | Schema unificado entre Quick-Ask e Inception | Os dois caminhos passam pelo mesmo `ProposePrdInput` (schema canônico em `prd-schemas.ts`) | Eliminar drift; Quick-Ask passa a produzir o mesmo shape que Inception |
| **D2** | Estratégia Quick-Ask | **2-stage**: stage A = Haiku gera *outline* (title + oneLiner + problem + 3 AC genéricas + dependencies); stage B = Sonnet pega cada outline + brief e *deepen* pros campos restantes (journey, metrics, risks, technicalNotes, AC ricas) | Haiku barato faz triagem; Sonnet caro faz só o que importa, paralelizável |
| **D3** | Stage B paralelo | Cada outline vira um job Sonnet em paralelo (até 10 simultâneos), com timeout 90s/PRD | Latência total ~90-120s ao invés de N×Sonnet sequencial |
| **D4** | Reference library | `docs/agents/vitor/reference-prds/*.md` contém 3 PRDs gold-standard (Calendly auth, Calendly booking, Zelar matching), incluídos no prompt do stage B via cache breakpoint | Few-shot concreto >> instrução abstrata; cache breakpoint ($0 reuso) |
| **D5** | Barra Forge-Ready | Função pura `assertForgeReady(prd) → { ok, missing[] }` validando: oneLiner≥30c, problem≥200c, goal≥80c, ≥1 personaId, ≥3 journey steps, ≥5 AC GWT, ≥2 metrics com `target` não-vazio, ≥3 outOfScope, ≥2 risks, technicalNotes≥150c, dependencies sem ciclo | Barra é função pura testável; UI badge consome; Forja gate antes de aceitar |
| **D6** | Bloqueio de `approve_prd` | `approve_prd` chama `assertForgeReady`. Se falha, retorna 422 com lista de campos faltantes; PM precisa `update_prd` antes ou usar `approve_prd_force` (anti-pattern, registra `dismissedAt` razão) | Aprovação humana é o gate; sem cobrir a barra, agente downstream sabe que é PRD "best-effort" |
| **D7** | Personas obrigatórias | Tool `propose_prd` passa a exigir `personaIds.min(1)`. Auto-bind via `inferPersonasFromBrief` (heurística + LLM call) quando ausente no input do agente | PRD sem persona é instanceless — não dá pra inferir critério de sucesso por ator |
| **D8** | Dependencies como DAG | Validador server-side roda Kahn's algorithm em `dependencies[].prdId` (mesma DS); rejeita ciclos. `kind ∈ {'depends_on', 'blocks', 'enables', 'shares-data'}` | Forja executa em ordem topológica; ciclo = deadlock no loop autônomo |
| **D9** | Hard cap Quick-Ask | 10 PRDs (já existe) — mantido. Stage B aplica em paralelo limit 10. | Custo + latência controlados; >10 indica brief mal-recortado, Vitor sinaliza |
| **D10** | Migração PRD shell | PRDs `status='draft'` existentes ficam como estão (sem auto-deepening retroativo); UI mostra badge "shell — deepen now" pra disparar stage B manualmente | Não tocar produção sem trigger humano; trigger barato (1 click) |
| **D11** | Reference library = parte do produto | Reference PRDs versionados no repo (`docs/agents/vitor/reference-prds/`) e testados (snapshot: cada reference passa em `assertForgeReady`) | Reference que regrida derruba CI; testagem como qualquer código |
| **D12** | Telemetria | Tabela existente `AgentCalibrationCapture` recebe rows quando `assertForgeReady` falha em produção (categoria `prd-shallow-output`) | Loop de calibração canônico (ver `docs/runbooks/agent-audits/`) — não inventar pipeline novo |

---

## 6. Arquitetura

### 6.1 Pipeline unificado

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       INPUT (qualquer caminho)                           │
│  Inception briefing: brainstorm + decisions + personas + module context  │
│  Quick-Ask:         brief curto do PM (1-3 parágrafos)                   │
└──────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌──────────────────────────────────────────────────────────────────────────┐
│                       STAGE A — Outline (Haiku)                          │
│  Produz N outlines: {title, oneLiner, problem(curto), 3 AC, deps}        │
│  Schema: PrdOutlineSchema (subset de ProposePrdInput)                    │
│  Quick-Ask: 1 chamada generateObject → N outlines                        │
│  Inception: 1 outline por functionality identificada no brainstorm       │
└──────────────────────────────────────────────────────────────────────────┘
                                  ↓ (N outlines em paralelo)
┌──────────────────────────────────────────────────────────────────────────┐
│                STAGE B — Deepen (Sonnet, paralelo)                       │
│  Input: outline + contexto (brief / brainstorm / personas / refs)        │
│  Output: ProposePrdInput completo (todos campos preenchidos)             │
│  Few-shot: 1-2 reference PRDs do diretório docs/agents/vitor/refs/       │
│  Timeout: 90s/PRD; falha → outline persistido com flag needs_deepening   │
└──────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌──────────────────────────────────────────────────────────────────────────┐
│              SERVER-SIDE VALIDATOR (Zod refinements)                     │
│  assertForgeReady(prd) → { ok, missing[] }                               │
│  Aplicado em insert via Zod refinement (não em DB trigger)               │
└──────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌──────────────────────────────────────────────────────────────────────────┐
│                    DB: ProductRequirement insert                         │
│  Campo computed `forgeReady: boolean` (não persistido, derivado em read) │
└──────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌──────────────────────────────────────────────────────────────────────────┐
│        UI: badge "Forge-Ready ✓" / "Shell — deepen now" / "approved"     │
│  Approve flow: PM clica → server roda assertForgeReady → 422 se falha    │
└──────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌──────────────────────────────────────────────────────────────────────────┐
│   FORJA: lê PRD via prd-fs; checa forgeReady=true; senão, bloqueia       │
└──────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Componentes a criar / modificar

| Componente | Arquivo | Ação |
|---|---|---|
| Schema outline | `src/lib/agent/agents/vitor/prd-schemas.ts` | Adicionar `PrdOutlineSchema` (subset de `ProposePrdInput`) |
| Validator | `src/lib/agent/agents/vitor/forge-ready.ts` (novo) | `assertForgeReady(prd) → Result`; export do shape mínimo |
| Deepening prompt | `src/lib/agent/vitor/prompts/prd-deepen.ts` (novo) | System prompt Sonnet + few-shot inline |
| Reference library | `docs/agents/vitor/reference-prds/{calendly-auth,calendly-booking,zelar-matching}.md` | Conteúdo curado, baseado em VOLU-PRD-001/005 + 1 Zelar |
| Quick-Ask reescrito | `src/lib/agent/vitor/prompts/prd-quickask.ts` | Vira `prd-outline.ts`; chama deepen em paralelo |
| Persist | `src/lib/sessions/prd-session/jobs.ts` | Roda Stage A → fan-out Stage B → insert |
| Inception prompt | `src/lib/agent/prompt.ts` (sub-fase PRD_DRAFTING) | Update few-shot pra apontar `docs/agents/vitor/reference-prds/` |
| Tool `propose_prd` | (consumido em `tools.ts`) | Adicionar refinement Zod → `assertForgeReady` |
| Tool `approve_prd` | (consumido em `tools.ts`) | Bloquear se `assertForgeReady=false`; expor `approve_prd_force` |
| UI badge | `src/components/prd/prd-status-badge.tsx` (novo) | "Forge-Ready ✓ / Shell — deepen now / Incomplete" |
| Deepen action | `src/app/api/prds/[id]/deepen/route.ts` (novo) | POST → roda Stage B isolado num PRD shell existente |
| Telemetria | `src/lib/agent/agents/vitor/forge-ready.ts` | Em fail, insere `AgentCalibrationCapture` row |

### 6.3 Reference PRDs — conteúdo

Cada reference é um `.md` no formato exato dos PRDs DB (frontmatter com slug + campos jsonb serializáveis). Servem dois propósitos:

1. **Few-shot inline no prompt do stage B** — incluído via cache breakpoint (custo $0 a partir do 2º request).
2. **Snapshot test** — `pnpm test prd-references` carrega cada `.md`, parseia, roda `assertForgeReady`, espera `ok=true`.

Lista mínima da v1:
- `calendly-auth.md` — baseado em VOLU-PRD-001 (auth, RLS denso, OAuth)
- `calendly-booking.md` — baseado em VOLU-PRD-005 (endpoint público, race, timezone)
- `zelar-matching.md` — baseado em 1 PRD futuro do Zelar v2 (domínio diferente, persona PRESTADOR/CLIENTE)

---

## 7. Schema (delta)

**Nenhum DDL novo.** Schema da tabela `ProductRequirement` cobre tudo (auditado 2026-05-31). Mudanças são em código TypeScript + reference files.

### 7.1 Novos shapes Zod

```typescript
// src/lib/agent/agents/vitor/prd-schemas.ts (delta)

export const PrdOutlineSchema = z.object({
  title: z.string().min(3).max(140),
  oneLiner: z.string().min(30).max(200),
  problem: z.string().min(80),               // outline aceita problem curto
  goal: z.string().min(40),                  // outline aceita goal curto
  acceptanceCriteria: z.array(PrdAcceptanceCriterion).min(3),
  dependencies: z.array(PrdDependency).default([]),
  sourceCardIds: z.array(z.string()).default([]),
  moduleId: z.string().uuid().optional(),
});

// ProposePrdInput existente RECEBE refinement novo:
export const ProposePrdInput = ProposePrdBaseInput.superRefine((prd, ctx) => {
  const result = assertForgeReady(prd);
  if (!result.ok) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `PRD não atende Forge-Ready bar: ${result.missing.join(", ")}`,
    });
  }
});
```

### 7.2 Função `assertForgeReady`

```typescript
// src/lib/agent/agents/vitor/forge-ready.ts

export type ForgeReadyResult =
  | { ok: true }
  | { ok: false; missing: string[] };

export function assertForgeReady(prd: ProductRequirementLike): ForgeReadyResult {
  const missing: string[] = [];
  if (!prd.oneLiner || prd.oneLiner.length < 30) missing.push("oneLiner≥30c");
  if (!prd.problem || prd.problem.length < 200) missing.push("problem≥200c");
  if (!prd.goal || prd.goal.length < 80) missing.push("goal≥80c");
  if (!prd.personaIds || prd.personaIds.length < 1) missing.push("personaIds≥1");
  if (!prd.userJourney || prd.userJourney.length < 3) missing.push("journey≥3");
  if (!prd.acceptanceCriteria || prd.acceptanceCriteria.length < 5) missing.push("AC≥5");
  if (!prd.successMetrics || prd.successMetrics.filter(m => m.target?.trim()).length < 2) missing.push("metrics≥2");
  if (!prd.outOfScope || prd.outOfScope.length < 3) missing.push("outOfScope≥3");
  if (!prd.risksAndAssumptions || prd.risksAndAssumptions.length < 2) missing.push("risks≥2");
  if (!prd.technicalNotes || prd.technicalNotes.length < 150) missing.push("technicalNotes≥150c");
  if (hasDependencyCycle(prd.dependencies, prd.id)) missing.push("deps:no-cycle");
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
```

### 7.3 DAG validator

```typescript
export function hasDependencyCycle(
  deps: { prdId: string; kind: string }[],
  selfId?: string
): boolean {
  // Kahn's algorithm sobre o set de PRDs da mesma DS, fetched do DB
  // (impl: src/lib/agent/agents/vitor/dag.ts)
}
```

---

## 8. APIs

| Método | Path | Contrato | Mudança |
|---|---|---|---|
| Tool agentic | `propose_prd` | Input: `ProposePrdInput` (Zod refined com `assertForgeReady`); 422 se falha | **Refinement novo** |
| Tool agentic | `update_prd` | Input: `UpdatePrdInput.partial`; **NÃO** roda `assertForgeReady` (permite refinement gradual) | sem mudança |
| Tool agentic | `approve_prd` | Input: `{prdId}`; server roda `assertForgeReady`; se falha, 422 com `missing[]` | **Gate novo** |
| Tool agentic | `approve_prd_force` | Input: `{prdId, reason: string}`; bypass + grava `dismissedAt` + razão | **Tool novo** |
| Tool agentic | `deepen_prd` | Input: `{prdId}`; roda Stage B sobre PRD shell existente | **Tool novo** |
| HTTP | `POST /api/prds/[id]/deepen` | 202 + `jobId` (job assíncrono); client polla `GET /api/jobs/[jobId]` | **Endpoint novo** |
| HTTP | `GET /api/prds/[id]/forge-ready` | 200 `{ok, missing[]}` (read-only, derivado) | **Endpoint novo** |
| HTTP | Quick-Ask `POST /api/design-sessions/[id]/prds` | já existe; agora retorna `202 + jobId` (era síncrono) | **Mudança contrato — assíncrono** |

---

## 9. UX

### 9.1 Árvore de PRDs (Inception briefing review)

```
┌── PRDs da DS ─────────────────────────────────┐
│  ✓ VOLU-PRD-001  Auth                  approved│
│  ✓ VOLU-PRD-002  Profile               approved│
│  ✓ VOLU-PRD-003  Calendar              forge-ready ✓│
│  ⚠ VOLU-PRD-004  Calendar UI           shell — [Deepen]│
│  ✗ VOLU-PRD-005  Booking               incomplete (4 fields)│
│      └─ missing: journey≥3, metrics≥2, risks≥2, technicalNotes≥150c│
└────────────────────────────────────────────────┘
```

- **forge-ready ✓** (verde): passou `assertForgeReady`, pronto pra Forja.
- **shell — [Deepen]** (amarelo): outline existente, botão dispara Stage B.
- **incomplete** (vermelho): passou Stage B mas ficou abaixo da barra; lista os campos faltantes.

### 9.2 Quick-Ask result page

```
┌── Quick-Ask Result ───────────────────────────────────┐
│  Brief: "clonar o calendly"                           │
│  10 PRDs gerados em 87s (Haiku outline → Sonnet deep) │
│                                                       │
│  ✓ 8 forge-ready                                      │
│  ⚠ 2 incomplete  → [Review missing fields]            │
│                                                       │
│  [Open PRD tree]                                      │
└───────────────────────────────────────────────────────┘
```

### 9.3 Modal de aprovação bloqueada

Quando PM tenta aprovar PRD que falhou `assertForgeReady`:

```
┌── Não consigo aprovar este PRD ───────────────────────┐
│  Este PRD não atende a barra mínima pra Forja:        │
│                                                       │
│  • journey: 1 step (mínimo 3)                         │
│  • metrics: nenhuma com target preenchido             │
│  • risks: 0 (mínimo 2)                                │
│  • technicalNotes: 42 chars (mínimo 150)              │
│                                                       │
│  Opções:                                              │
│    [Re-deepen com Vitor]  [Editar manualmente]        │
│    [Aprovar mesmo assim (registra razão)]             │
└───────────────────────────────────────────────────────┘
```

---

## 10. Integrações

| Sistema | Integração |
|---|---|
| **Forja** ([src/lib/forge/prd-fs.ts](src/lib/forge/prd-fs.ts)) | Antes de aceitar PRD, checa `forgeReady=true` em `GET /api/prds/[id]/forge-ready`. Se false, registra erro estruturado e não inicia loop. |
| **Wiki composer** (prd-project-wiki) | Renderiza badge Forge-Ready ao listar PRDs. |
| **Calibration loop** (`docs/runbooks/agent-audits/`) | Categoria nova `prd-shallow-output` no vocabulary; `AgentCalibrationCapture` row criada toda vez que `assertForgeReady` falha em produção. |
| **Eval harness** (`src/eval/vitor/`) | Cases novos: pra cada reference PRD, snapshot test que valida estabilidade do output (Sonnet) sobre o mesmo outline. |

---

## 11. Faseamento

| Fase | Entrega | Critério de aceite |
|---|---|---|
| **1 — Validator + reference library** | `forge-ready.ts` + 3 reference PRDs + UI badge + endpoint read-only | `pnpm test forge-ready` passa; cada reference passa `assertForgeReady`; UI renderiza badge nos 10 PRDs da DS calendly |
| **2 — Quick-Ask 2-stage** | Stage A (Haiku outline) + Stage B (Sonnet deepening paralelo); endpoint POST `/api/prds/[id]/deepen`; tool agentic `deepen_prd` | Re-rodar Quick-Ask "clonar calendly" produz 10 PRDs com ≥8 `forge-ready=true` em < 120s |
| **3 — Gate no approve_prd** | Refinement Zod em `ProposePrdInput`; `approve_prd` bloqueia se !forge-ready; `approve_prd_force` com razão | PM tenta aprovar shell → recebe 422 + missing fields; PM aprova force → row tem `dismissedAt` razão |
| **4 — Inception update** | Sub-fase PRD_DRAFTING usa few-shot atualizado apontando reference library; auto-bind de persona se Vitor esquece | PRDs gerados em Inception nova têm `forge-ready=true` na primeira tentativa ≥ 80% das vezes |
| **5 — Telemetria + calibration** | `AgentCalibrationCapture` em fail; dashboard simples em `/admin/agent-quality` mostra rate de Forge-Ready por semana | Capturas geradas auto; dashboard mostra ≥1 row da DS de teste |

Fase 1 entrega **mais** que o sistema atual: hoje não existe **nenhuma** validação de densidade; já em Fase 1 toda revisão de PRD ganha badge visível + endpoint de check. Fases 2-5 endurecem progressivamente.

---

## 12. Riscos

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| Stage B (Sonnet) ficar caro/lento — 10 PRDs × Sonnet = $$$ + latência | Média | Alta | Cache breakpoint nos reference PRDs (custo cai 70% do 2º request); paralelismo limitado a 10; medir custo em piloto |
| Reference PRDs viram fonte de viés (modelo copia frases literal) | Média | Média | Snapshot test detecta cópia literal (>30% overlap por TF-IDF); rotacionar 3 references diferentes ciclicamente |
| Validador frouxo demais (PRD passa mas ainda é pobre semanticamente) | Alta | Média | Bar inicia agressiva (números atuais); calibrar via telemetria semana 2; bar evolui em PR |
| Validador apertado demais (Sonnet não consegue passar nem 50%) | Média | Alta | Eval baseline em Fase 2 mede pass-rate; se < 70%, afrouxar bar antes de Fase 3 |
| PM começa a usar `approve_prd_force` toda hora (vira default) | Alta | Alta | Telemetria: rate de force > 30% dispara alerta interno; UI fricciona (modal explícito com razão obrigatória) |
| Migração: PRDs shell existentes em produção (10 PRDs calendly DS) ficam visualmente "ruins" no UI | Baixa | Baixa | Botão "Deepen now" 1-click resolve; comunicar em changelog |
| Forja passa a bloquear PRDs hoje aceitos, derrubando runs em curso | Baixa | Alta | Fase 1 só introduz read-only; Forja não checa forgeReady até Fase 3 explicitamente |
| Vitor (Inception) regressa em qualidade pq Zod fica mais estrito | Média | Alta | Fase 4 cobre prompt update; canary 1 projeto novo antes de habilitar gate Inception |

---

## 13. Métricas de sucesso

| Métrica | Instrumento | Baseline | Target v1 |
|---|---|---|---|
| % PRDs novos com `forgeReady=true` no primeiro draft | Query `SELECT COUNT(*) FILTER (WHERE forge_ready) / COUNT(*) FROM "ProductRequirement" WHERE "createdAt" > <fase4-deploy>` | 20% (manual audit 2026-05-31) | ≥ 80% |
| Tempo médio Quick-Ask: brief → N PRDs forge-ready | Métrica em `PrdQuickAskJob.completedAt - createdAt` | ~25s (PRDs shell) | < 120s (PRDs forge-ready) |
| Custo médio por PRD gerado (USD) | `agent_quality_log` agregação por sessão | ~$0.01 (Haiku-only) | < $0.08 (Haiku + Sonnet com cache) |
| Rate de `approve_prd_force` em PRDs gerados pós-Fase 3 | `SELECT COUNT(*) FILTER (WHERE "dismissedAt" IS NOT NULL) / total` | n/a | < 10% |
| `AgentCalibrationCapture` rows abertos `category=prd-shallow-output` / mês | Query no calibration loop | n/a (sem categoria) | Trending down após Fase 5 |
| % Forja runs que bloqueiam em "PRD shell" | Log estruturado da Forja em [src/lib/forge/prd-fs.ts](src/lib/forge/prd-fs.ts) | ~30% (estimativa observação 05/2026) | < 5% |

---

## 14. Open questions

Idealmente nenhuma — todas decisões fixadas. Lacuna conhecida pra revisitar pós-Fase 2:

1. **Reference library tamanho** — 3 PRDs cobrem 80% dos casos? Ou precisa 5-8 organizados por domínio? **Quem resolve:** revisão pós-Fase 2, com 30 dias de telemetria. **Fase:** 5.
2. **Auto-deepen on draft** — quando Vitor cria PRD no Inception, deve auto-disparar Stage B (mais caro) ou aguardar trigger manual do PM? **Quem resolve:** A/B test em Fase 4. **Fase:** 4.

---

## 15. Referências

- [docs/prd/backlog/prd-vitor-output-as-prd.md](docs/prd/backlog/prd-vitor-output-as-prd.md) — define a entidade PRD (já em backlog).
- [docs/prd/backlog/prd-forge-from-vitor.md](docs/prd/backlog/prd-forge-from-vitor.md) — consumidor downstream.
- [docs/runbooks/agent-audits/README.md](docs/runbooks/agent-audits/README.md) — vocabulary do calibration loop (categoria nova `prd-shallow-output`).
- [src/lib/agent/agents/vitor/prd-schemas.ts](src/lib/agent/agents/vitor/prd-schemas.ts) — schema canônico atual.
- [src/lib/agent/vitor/prompts/prd-quickask.ts](src/lib/agent/vitor/prompts/prd-quickask.ts) — Quick-Ask atual (a refatorar).
- [src/lib/agent/prompt.ts](src/lib/agent/prompt.ts#L471) — sub-fase PRD_DRAFTING (Inception).
- [/tmp/calendly-prds.sql](/tmp/calendly-prds.sql) — gold standard manual escrita em 2026-05-31 (vira reference library).
- Memory: `project_vitor_as_pm` (Vitor reposicionado).

---

## 16. Stories implementáveis

```yaml
- id: VRD-001
  title: forge-ready validator + DAG check
  description: |
    Função pura `assertForgeReady(prd)` com 11 checks de densidade (oneLiner, problem,
    goal, journey, AC, metrics, outOfScope, risks, technicalNotes, personaIds, DAG-no-cycle).
    DAG check via Kahn em set de PRDs da mesma DS.
  acceptanceCriteria:
    - "Arquivo src/lib/agent/agents/vitor/forge-ready.ts exporta assertForgeReady e hasDependencyCycle"
    - "Teste vitest cobre 11 cenários (1 por campo) + 3 cenários de DAG (linear, branch, cycle)"
    - "Função é pura (sem I/O, sem await); recebe ProductRequirementLike + opcional set de irmãos"
    - "Retorna { ok: true } ou { ok: false, missing: string[] } com slugs estáveis (ex: 'AC≥5')"
  verifiable:
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "exit 0"
    - kind: lint
      command_or_query: "pnpm vitest run src/lib/agent/agents/vitor/forge-ready.test.ts"
      expected: "all tests pass"
  dependsOn: []
  estimateMinutes: 25
  touches:
    - src/lib/agent/agents/vitor/forge-ready.ts
    - src/lib/agent/agents/vitor/forge-ready.test.ts
    - src/lib/agent/agents/vitor/dag.ts

- id: VRD-002
  title: reference PRD library (3 PRDs gold-standard)
  description: |
    Criar docs/agents/vitor/reference-prds/ com 3 PRDs (calendly-auth, calendly-booking,
    zelar-matching). Conteúdo derivado dos PRDs ricos do DB. Frontmatter com slug + jsonb
    fields serializáveis. Loader em runtime via fs.readFileSync no boot.
  acceptanceCriteria:
    - "Diretório docs/agents/vitor/reference-prds/ contém 3 arquivos .md com frontmatter válido"
    - "Loader src/lib/agent/agents/vitor/reference-loader.ts lê os 3 e retorna ParsedReferencePrd[]"
    - "Snapshot test garante que cada reference passa assertForgeReady com ok=true"
  verifiable:
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "exit 0"
    - kind: lint
      command_or_query: "pnpm vitest run src/lib/agent/agents/vitor/reference-loader.test.ts"
      expected: "all 3 references pass forge-ready"
  dependsOn: [VRD-001]
  estimateMinutes: 30
  touches:
    - docs/agents/vitor/reference-prds/calendly-auth.md
    - docs/agents/vitor/reference-prds/calendly-booking.md
    - docs/agents/vitor/reference-prds/zelar-matching.md
    - src/lib/agent/agents/vitor/reference-loader.ts
    - src/lib/agent/agents/vitor/reference-loader.test.ts

- id: VRD-003
  title: deepen prompt + Stage B (Sonnet)
  description: |
    Prompt Sonnet em src/lib/agent/vitor/prompts/prd-deepen.ts: recebe outline +
    contexto (brief OU brainstorm bundle) + 1 reference PRD (rotacionado por idx),
    devolve ProposePrdInput completo. Cache breakpoint na reference (Anthropic prompt-caching).
  acceptanceCriteria:
    - "Função deepenPrd({outline, context, referenceIdx}) retorna Promise<ProposePrdInput>"
    - "Prompt inclui reference PRD via system message com cache_control={type:'ephemeral'}"
    - "Output passa Zod ProposePrdInput sem throw em smoke test (1 PRD calendly real)"
    - "Timeout 90s; se exceder, throw DeepenTimeoutError"
  verifiable:
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "rodar pnpm tsx scripts/smoke/deepen-prd.ts com outline VOLU-PRD-003"
      expected: "saída JSON válida, forge-ready=true"
  dependsOn: [VRD-001, VRD-002]
  estimateMinutes: 25
  touches:
    - src/lib/agent/vitor/prompts/prd-deepen.ts
    - scripts/smoke/deepen-prd.ts

- id: VRD-004
  title: Quick-Ask refatorado em 2-stage (outline + parallel deepen)
  description: |
    Reescrever src/lib/agent/vitor/prompts/prd-quickask.ts em duas fases. Stage A
    devolve Outline[]; Stage B roda deepenPrd em paralelo (Promise.allSettled, limit 10);
    persistência usa o resultado de Stage B (com fallback pra outline se Stage B falhar
    com flag needs_deepening=true).
  acceptanceCriteria:
    - "Função generatePrdsFromBrief retorna ProposePrdInput[] (não mais ParsedPrd[])"
    - "Stage B roda em paralelo via Promise.allSettled; falhas não derrubam outros PRDs"
    - "Latência total < 120s p95 medida em smoke com brief 'clonar calendly'"
    - "Cada PRD persistido tem forgeReady=true (≥80% dos 10) OU flag needs_deepening=true"
  verifiable:
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "Quick-Ask em /design-sessions/new com brief 'clonar calendly'; verificar DB"
      expected: "10 PRDs criados, ≥8 com assertForgeReady=ok em < 120s"
  dependsOn: [VRD-003]
  estimateMinutes: 30
  touches:
    - src/lib/agent/vitor/prompts/prd-quickask.ts
    - src/lib/sessions/prd-session/jobs.ts

- id: VRD-005
  title: Zod refinement em ProposePrdInput + tool approve_prd gate
  description: |
    Adicionar superRefine em ProposePrdInput → assertForgeReady; tool approve_prd
    chama assertForgeReady antes de UPDATE status=approved (retorna 422 com missing[]);
    tool approve_prd_force adicionado pra bypass (registra dismissedAt+reason).
  acceptanceCriteria:
    - "ProposePrdInput.parse() rejeita PRD shell com mensagem específica"
    - "approve_prd retorna 422 quando assertForgeReady falha (testado via Supertest)"
    - "approve_prd_force aceita {prdId, reason: string.min(20)}; grava dismissedAt e reason"
    - "update_prd NÃO roda assertForgeReady (refine não bloqueia drafts em progresso)"
  verifiable:
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "exit 0"
    - kind: http
      command_or_query: "POST /api/agent/tool/approve_prd com PRD shell → status 422"
      expected: "{ error: 'forge_not_ready', missing: [...] }"
  dependsOn: [VRD-001]
  estimateMinutes: 25
  touches:
    - src/lib/agent/agents/vitor/prd-schemas.ts
    - src/lib/agent/tools/manage-prds.ts

- id: VRD-006
  title: UI badge + deepen action
  description: |
    Componente PrdStatusBadge (src/components/prd/prd-status-badge.tsx) com 3 estados
    visuais (forge-ready ✓ / shell — deepen / incomplete). Endpoint POST
    /api/prds/[id]/deepen retorna 202+jobId e roda Stage B em background. Badge "Deepen"
    chama esse endpoint e exibe progress.
  acceptanceCriteria:
    - "Badge renderiza 3 estados com cores distintas (verde/amarelo/vermelho)"
    - "Tooltip no estado 'incomplete' lista missing[] preciso"
    - "POST /api/prds/[id]/deepen retorna 202 + jobId; client polla GET /api/jobs/[jobId]"
    - "Após deepen com sucesso, badge atualiza otimisticamente via useOptimisticCollection"
  verifiable:
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "Abrir /projects/76c38471-.../design-sessions/f3488548-.../steps/0 e clicar 'Deepen' no PRD-004"
      expected: "badge muda amarelo→verde em <120s sem reload"
  dependsOn: [VRD-003, VRD-005]
  estimateMinutes: 30
  touches:
    - src/components/prd/prd-status-badge.tsx
    - src/app/api/prds/[id]/deepen/route.ts
    - src/app/api/prds/[id]/forge-ready/route.ts

- id: VRD-007
  title: Inception PRD_DRAFTING prompt update + auto-bind persona
  description: |
    Sub-fase PRD_DRAFTING em src/lib/agent/prompt.ts ganha few-shot inline apontando
    pra reference-loader (não inline literal — carregar via cache breakpoint).
    Helper inferPersonasFromBrief(brief, projectPersonas) chamado se Vitor produzir
    PRD com personaIds vazio.
  acceptanceCriteria:
    - "Prompt PRD_DRAFTING inclui reference PRDs via cache_control"
    - "Função inferPersonasFromBrief retorna uuid[] válidos da ProjectPersona"
    - "Em smoke (DS Inception fresh), Vitor gera PRD com personaIds.length≥1 100% das vezes"
  verifiable:
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "SELECT COUNT(*) FILTER (WHERE array_length(personaIds,1)>=1)::float / COUNT(*) FROM ProductRequirement WHERE createdAt > now() - interval '1 day'"
      expected: ">= 1.0 em smoke"
  dependsOn: [VRD-002, VRD-005]
  estimateMinutes: 25
  touches:
    - src/lib/agent/prompt.ts
    - src/lib/agent/agents/vitor/infer-personas.ts

- id: VRD-008
  title: Telemetria + calibration loop integration
  description: |
    Em assertForgeReady, quando ok=false durante uma operação real (não dry-run),
    inserir row em AgentCalibrationCapture com category='prd-shallow-output',
    sintomas=missing[], evidência=prd snapshot. Dashboard simples /admin/agent-quality
    consulta rate de Forge-Ready últimos 7d.
  acceptanceCriteria:
    - "Helper recordShallowOutput(prd, missing) insere row em AgentCalibrationCapture"
    - "Página /admin/agent-quality lista metric: PRDs forge-ready / total (último 7d)"
    - "Categoria 'prd-shallow-output' adicionada em docs/runbooks/agent-audits/README.md"
  verifiable:
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "SELECT 1 FROM AgentCalibrationCapture WHERE category='prd-shallow-output' LIMIT 1"
      expected: "≥1 row após smoke"
  dependsOn: [VRD-005]
  estimateMinutes: 25
  touches:
    - src/lib/agent/agents/vitor/forge-ready.ts
    - src/app/(admin)/admin/agent-quality/page.tsx
    - docs/runbooks/agent-audits/README.md
```

**Total estimado:** 215 minutos (~3h35min) — 8 stories, cabem em 8 context windows do Claude.

**DAG:**

```
VRD-001 ─┬─ VRD-002 ─┬─ VRD-003 ── VRD-004
         │           └─ VRD-007
         └─ VRD-005 ─┬─ VRD-006
                     └─ VRD-008
```

Fase 1 = VRD-001 + VRD-002. Fase 2 = VRD-003 + VRD-004. Fase 3 = VRD-005 + VRD-006. Fase 4 = VRD-007. Fase 5 = VRD-008.
