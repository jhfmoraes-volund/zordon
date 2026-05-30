---
status: draft
owner: João Moraes
date: 2026-05-29
domain: agents / vitoria
codenames:
  - vitoria-consult-vitor
  - asymmetric-agent-consultation
references:
  - docs/prd/backlog/prd-vitor-output-as-prd.md
  - docs/prd/backlog/prd-planning-session.md
  - src/lib/agent/agents/vitor/index.ts
  - src/lib/agent/agents/vitoria/
  - src/components/ui/responsive-sheet.tsx
---

# PRD — Vitoria consulta Vitor (MVP)

> **TL;DR:** Vitoria (Product Engineer) é quem decide **o que fazer** (sprint, capacity, ordering, cortes de escopo). Quando ela esbarra em dúvida sobre o **porquê do produto** (persona, dor, jornada, criticidade de AC), hoje ela decide sozinha ou o humano vira tradutor entre Vitoria e Vitor manualmente. Este PRD dá pra Vitoria uma **ferramenta `consult_vitor`** que ela invoca quando tem dúvida — Vitor responde em isolamento (sem ver o estado da Vitoria, sem tools de mutação), Vitoria integra a opinião na resposta dela ao humano. Side-sheet pulsante mostra a consulta ao vivo. Audit trail completo. **Assimétrico:** Vitor não tem reciprocidade — não consulta Vitoria. MVP enxuto pra validar antes de evoluir pra debate completo (synthesis arbiter etc.).

---

## 1. Problema

### 1.1 Estado atual

- **Vitoria** opera Planning Ceremony, decisões de sprint, materialização de PRD em tasks. Trabalha sozinha com `ProjectProfile` (sprints, US, blockers).
- **Vitor** produziu os PRDs upstream (DS Inception). Tem todo o "porquê" (problem, persona, journey, AC) em sua cabeça/contexto. Depois que PRD sai aprovado, Vitor sai de cena.
- Quando Vitoria precisa cortar escopo ("PRD-7 excede capacity, cortar 2 AC quais?"), ela **não tem acesso fácil** ao raciocínio de produto do Vitor. Ela decide sozinha (errado, podendo cortar AC crítica) ou pede pro humano (PM) traduzir manualmente — lento.

### 1.2 Três dores concretas

1. **Vitoria corta AC sem grounding de produto.** Quando capacity força corte, ela escolhe AC pelo critério dela (FP baixo, dependência fraca). Mas a AC com FP baixo pode ser crítica pra persona principal. Sem consultar Vitor, ela decide errado.
2. **Humano vira ponte manual.** PM cola pergunta da Vitoria no chat do Vitor, traz resposta de volta, cola no chat da Vitoria. Tempo: 3-5min por consulta. Não-rastreável.
3. **Decisões de Vitoria sem audit do "porquê do produto".** Cliente pergunta "por que vocês cortaram AC#4 do PRD-7?", PM não consegue mostrar trail. Hoje a justificativa fica no chat da Vitoria mas SEM amarração ao raciocínio de produto.

### 1.3 Princípio

> **"A ideia seria Vitoria saber bem o que fazer."** — João, 2026-05-29

Vitoria precisa de capability de **consultar especialista** (Vitor) quando ela esbarra em dúvida fora do domínio dela. Assimétrico de propósito: ela é a executora; ele é o consultor estratégico.

---

## 2. Solução em uma frase

**Adicionar ao toolset da Vitoria uma tool `consult_vitor(topic, contextPrdRefs, yourCurrentThinking)` que dispara uma consulta isolada (1 LLM call) ao Vitor com role debate-only (sem tools de mutação), persiste em `AgentConsultation` table, abre side-sheet pulsante ao vivo no UI, e devolve pra Vitoria a opinião do Vitor pra ela integrar na resposta ao humano.**

---

## 3. Não-objetivos

- **Não** é debate simétrico. Vitor NÃO ganha tool `consult_vitoria`. Assimetria é decisão.
- **Não** é multi-round. 1 consulta = 1 call ao Vitor. Sem follow-up automático. Vitoria pode consultar de novo se quiser, mas é nova consulta.
- **Não** tem arbiter / synthesis. Vitoria recebe a opinião do Vitor e SINTETIZA SOZINHA na sua resposta. Sem 3a via gerada por LLM.
- **Não** funciona fora de chat da Vitoria. Consult é tool da Vitoria — só ativa quando ela está em flight (Planning Ceremony chat lateral, Daily, PM Review).
- **Não** dá pro Vitor mudar PRD. Modo consultor é **read-only**: só `position + rationale + confidence` JSON. Sem tools de mutação.
- **Não** automatiza decisão. Vitoria recebe opinião e decide sozinha (ou pede aprovação do humano). Vitor é consultor, não decisor.
- **Não** é "agent autonomous chat". Sempre human-observable via side-sheet.
- **Não** suporta consulta a outros agentes. v1 só `consult_vitor`. v2 pode generalizar (`consult_alpha`, etc.).

---

## 4. Personas e jornada

### 4.1 Vitoria (consultante)

> "Estou em Planning Ceremony, PM perguntou: 'cabe PRD-7 em Phase 1?'. Olho capacity: 52 FP, sprint capacity 35 FP/squad/sprint. Não cabe sem 2 sprints. Cortar AC pode liberar — mas eu não sei qual AC do PRD-7 é crítica pra persona X. Aí eu (Vitoria) invoco `consult_vitor({ topic: 'Quais AC do PRD-7 são críticas pra persona X?', contextPrdRefs: ['EVZL-PRD-007'], yourCurrentThinking: 'Capacity excede em 17 FP. Considero cortar AC#2 ou AC#4 (FP baixo) mas preciso saber se quebra persona X.' })`. Vitor responde em ~5s: 'AC#1 e AC#3 são críticas pra persona X (jornada principal). AC#2 e AC#4 servem persona Y que só entra em Phase 2 — podem ser cortadas sem quebrar promise do MVP.' Eu integro na minha resposta ao PM: 'Cabe se cortarmos AC#2 e AC#4. Persona X mantém suporte. Confirmação: Vitor.'"

### 4.2 Vitor (consultado)

> "Sou chamado em modo consultor. Recebo um topic + contextPrdRefs + a linha de raciocínio da Vitoria. Não vejo o chat dela com o humano. Não tenho acesso a sprint/capacity/squad. Devolvo JSON: `{ position, rationale, confidence }`. Sem tools — só opinião pura. Meu role neste modo é defender persona/dor/jornada/criticidade de AC. Foco produto, não execução."

### 4.3 PM (humano observador)

> "Estou no chat da Vitoria. Faço pergunta complexa. Ela responde 'um momento, vou consultar o Vitor' — side-sheet abre na direita pulsando 🟡 'Vitoria consultando Vitor sobre: AC críticas do PRD-7'. Em ~5s sheet mostra resposta do Vitor estruturada (position + rationale + confidence). Vitoria continua a resposta dela ao meu pergunta integrando o input. Consigo ver os 2 passos lado-a-lado — chat da Vitoria + sheet da consulta. Se quiser auditar depois, abro `/projects/[id]/consultations` e vejo histórico."

### 4.4 Dev/Auditor

> "Cliente pergunta 'por que cortamos AC#4 do PRD-7?'. Abro `/projects/[id]/consultations`, filtro por contexto PlanningSession da Phase 1, encontro a consulta. Vejo: tópico, raciocínio inicial da Vitoria, opinião do Vitor, e a decisão final que Vitoria comunicou. Audit-grade."

---

## 5. Decisões fixadas

| ID | Decisão | Por quê |
|---|---|---|
| **D1** | Assimétrico — só Vitoria consulta Vitor | Vitoria executa; Vitor é especialista upstream. Reciprocidade simétrica não tem caso de uso claro. |
| **D2** | Tool `consult_vitor` no toolset da Vitoria | Padrão AgentDefinition do repo. Vitoria invoca via toolset normal. |
| **D3** | Vitor em modo consultor = ISOLADO + sem tools | Sem ver chat da Vitoria. Sem create_*/update_*. Pura opinião JSON via `generateObject`. |
| **D4** | 1 LLM call por consulta (sem rounds, sem follow-up) | MVP. Se Vitoria precisa de mais, faz outra consulta. |
| **D5** | Output schema-driven (Zod) | `{ position min 20 max 500, rationale min 50 max 2000, confidence 0-1 }`. Forces concretude. |
| **D6** | Vitor consultor usa modelo `claude-haiku-4-5` | Consultor produz opinião curta + estruturada. Não precisa de opus. Custo ~$0.02-0.05/consulta. |
| **D7** | Side-sheet auto-open via polling | UI da Vitoria polla `/api/consultations?inProgress=true` a cada 2s. Quando detecta consulta in-flight, abre sheet automaticamente. |
| **D8** | Pulse visual 🟡 enquanto `status='in-progress'` | CSS keyframe, respeita `prefers-reduced-motion`. |
| **D9** | Audit imutável — `AgentConsultation` rows sem UPDATE policy (depois de fechada) | UPDATE só permitido em transição `in-progress → completed/error`. Após terminal, imutável. |
| **D10** | RLS: read=viewer do projeto, write=manager+ | Consult custa $$. Só manager pode triggerar (via Vitoria que roda em chat manager-only). |
| **D11** | Trigger: autonomous (Vitoria decide invocar) — sem botão humano em MVP | Vitoria decide quando consultar baseado no prompt. v2 pode adicionar trigger humano manual. |
| **D12** | Cost cap hard por consulta: $0.10 USD | Pré-invoke verifica token estimate. Se exceder, tool retorna erro pra Vitoria. |
| **D13** | Vitor consultor ganha `consultantProfile` em AgentDefinition (não `debateRole`) | Naming reflete o papel. v2 pode generalizar. |
| **D14** | Contexto polimórfico (`contextType` + `contextId`) — começa com `planning_session` | Forward-compatible. v2 pode adicionar `design_session`, `wiki`, etc. |

---

## 6. Arquitetura

### 6.1 Diagrama

```
┌─ Humano (PM) ────────────────────────────────────────────┐
│  Chat com Vitoria em Planning Ceremony                   │
│  "Cabe PRD-7 em Phase 1?"                                │
└───────────────┬──────────────────────────────────────────┘
                ↓
┌─ Vitoria (agent) ────────────────────────────────────────┐
│  Lê capacity, percebe dúvida sobre criticidade de AC     │
│  Invoca tool: consult_vitor({                            │
│    topic: "Quais AC do PRD-7 são críticas pra persona X?"│
│    contextPrdRefs: ["EVZL-PRD-007"],                     │
│    yourCurrentThinking: "..."                            │
│  })                                                       │
└───────────────┬──────────────────────────────────────────┘
                ↓ tool execute
┌─ src/lib/agent/agents/vitoria/tools/consult-vitor.ts ────┐
│  1. createConsultation(...) → AgentConsultation row      │
│     status='in-progress'                                  │
│  2. invokeConsultation(consultationId) → async           │
│     (UI da Vitoria polla, side-sheet abre)               │
│  3. await Vitor response (~5s)                            │
│  4. saveConsultationResponse(consultationId, response)   │
│     status='completed'                                    │
│  5. return { consultationId, vitorOpinion } pra Vitoria  │
└───────────────┬──────────────────────────────────────────┘
                ↓ invokeConsultation (LLM call isolated)
┌─ src/lib/agent/consultation/invoke.ts ───────────────────┐
│  - model: claude-haiku-4-5                                │
│  - schema: ConsultationResponse (Zod)                    │
│  - system: buildConsultantPrompt(vitor.consultantProfile)│
│  - user: topic + PRD content (loaded) + yourCurrentThink │
│  - NO TOOLS (debate-only)                                │
└───────────────┬──────────────────────────────────────────┘
                ↓
        Vitor → { position, rationale, confidence }
                ↓
┌─ UI: src/components/agent/consultation/consultation-sheet.tsx
│  ResponsiveSheet pulsante                                │
│  Header: "Vitoria consultando Vitor sobre: ..."          │
│  Body: spinner → response card                            │
│  Pulse 🟡 enquanto in-progress                            │
└──────────────────────────────────────────────────────────┘
```

### 6.2 Componentes

| Caixa | Tipo | Onde mora |
|---|---|---|
| Tool `consult_vitor` | TS tool (AI SDK) | `src/lib/agent/agents/vitoria/tools/consult-vitor.ts` |
| `invokeConsultation` | TS fn | `src/lib/agent/consultation/invoke.ts` |
| `buildConsultantPrompt` | TS fn | `src/lib/agent/consultation/prompt.ts` |
| `ConsultationResponse` Zod | Zod schema | `src/lib/agent/consultation/schemas.ts` |
| `consultantProfile` em Vitor | TS field | `src/lib/agent/agents/vitor/index.ts` (extend) |
| DAL | TS module | `src/lib/dal/agent-consultation.ts` |
| API routes | Next.js | `src/app/api/consultations/...` |
| UI sheet | React | `src/components/agent/consultation/consultation-sheet.tsx` |
| Tabela | SQL | `supabase/migrations/20260601a_agent_consultation.sql` |

### 6.3 Stack convencional

- **API async (AGENTS.md)**: `POST /api/consultations` → cria row + dispara job; cliente polla `GET /api/consultations/:id`.
- **UI**: `ResponsiveSheet size="md"` (D7+D8).
- **Tool execute**: bloqueante na perspectiva da Vitoria (`await` o response). Mas a partir do UI, é via polling.

---

## 7. Schema (DDL completo)

### 7.1 Migration única

**`supabase/migrations/20260601a_agent_consultation.sql`**

```sql
-- ============================================================
-- AgentConsultation: 1 consulta de um agente a outro
-- v1: assimétrico — só Vitoria consulta Vitor
-- ============================================================

CREATE TABLE "AgentConsultation" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "contextType" text NOT NULL CHECK ("contextType" IN (
    'planning_session', 'design_session', 'wiki', 'standalone'
  )),
  "contextId" uuid,
  "projectId" uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  "consultingAgent" text NOT NULL,         -- 'vitoria' (v1)
  "consultedAgent" text NOT NULL,          -- 'vitor' (v1)
  topic text NOT NULL CHECK (char_length(topic) BETWEEN 20 AND 300),
  "contextPrdRefs" text[] NOT NULL DEFAULT '{}',
  "yourCurrentThinking" text,
  "initiatedBy" uuid NOT NULL REFERENCES "Member"(id),
  status text NOT NULL DEFAULT 'in-progress' CHECK (status IN (
    'in-progress', 'completed', 'aborted', 'error'
  )),
  -- Response do consulted agent (preenchido on-complete)
  "responsePosition" text,
  "responseRationale" text,
  "responseConfidence" numeric(3,2) CHECK (
    "responseConfidence" IS NULL
    OR ("responseConfidence" >= 0 AND "responseConfidence" <= 1)
  ),
  "responseRawJsonb" jsonb,                -- output completo do modelo
  "tokensUsed" int NOT NULL DEFAULT 0,
  "costUsd" numeric(10,4) NOT NULL DEFAULT 0,
  "model" text,
  "errorMessage" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "completedAt" timestamptz,
  CHECK (
    status != 'completed' OR (
      "responsePosition" IS NOT NULL
      AND "responseRationale" IS NOT NULL
      AND "responseConfidence" IS NOT NULL
      AND "completedAt" IS NOT NULL
    )
  )
);

CREATE INDEX idx_agent_consultation_context
  ON "AgentConsultation"("contextType", "contextId");
CREATE INDEX idx_agent_consultation_project
  ON "AgentConsultation"("projectId", "createdAt" DESC);
CREATE INDEX idx_agent_consultation_in_progress
  ON "AgentConsultation"("projectId", status)
  WHERE status = 'in-progress';

ALTER TABLE "AgentConsultation" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_consultation_read"
  ON "AgentConsultation" FOR SELECT
  USING (can_view_project("projectId"));

CREATE POLICY "agent_consultation_insert"
  ON "AgentConsultation" FOR INSERT
  WITH CHECK (is_manager() AND can_lead_project("projectId"));

CREATE POLICY "agent_consultation_update_in_progress"
  ON "AgentConsultation" FOR UPDATE
  USING (is_manager() AND status = 'in-progress')
  WITH CHECK (is_manager());

-- IMPORTANTE: sem UPDATE policy pra rows com status terminal.
-- Após status='completed'/'aborted'/'error', a row é imutável.

CREATE TRIGGER set_agent_consultation_updated_at
  BEFORE UPDATE ON "AgentConsultation"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

### 7.2 Tipos atualizados

- `src/lib/agent/types.ts` — adicionar interface `ConsultantProfile` e campo opcional `consultantProfile?: ConsultantProfile` em `AgentDefinition`
- `src/lib/agent/agents/vitor/index.ts` — adicionar `consultantProfile`

```typescript
export interface ConsultantProfile {
  /** Domínio de expertise. */
  domain: string;
  /** O que o agente DEVE focar quando consultado. */
  must: string;
  /** O que o agente NÃO PODE falar (fora do escopo). */
  cant: string;
  /** Modelo recomendado pra consulta (default sonnet). */
  recommendedModel?: 'haiku' | 'sonnet' | 'opus';
  /** Few-shot examples. */
  examples?: Array<{ topic: string; position: string; rationale: string }>;
}
```

---

## 8. APIs

| Método | Path | Contrato | Notas |
|---|---|---|---|
| POST | `/api/consultations` | `{ contextType, contextId?, projectId, consultedAgent, topic, contextPrdRefs[], yourCurrentThinking }` → `202 { consultationId, jobId }` | Cria row + dispara job async |
| GET | `/api/consultations/:id` | → `{ consultation }` (com response inline se completed) | Polling pra UI |
| GET | `/api/consultations?projectId=&status=in-progress` | → `[{ consultation }]` | UI da Vitoria polla esse pra abrir side-sheet quando in-flight |
| GET | `/api/consultations?contextType=&contextId=` | → `[{ consultation }]` | Lista por contexto (audit) |
| POST | `/api/consultations/:id/abort` | `{}` → `{ status: 'aborted' }` | Manager+ apenas |

### 8.1 Contrato `ConsultationResponse` (Zod schema)

```typescript
// src/lib/agent/consultation/schemas.ts
export const ConsultationResponse = z.object({
  position: z.string().min(20).max(500)
    .describe("Posição direta sobre o tópico, 1-3 frases"),
  rationale: z.string().min(50).max(2000)
    .describe("Raciocínio detalhado citando refs concretas (PRD-N, AC#N, persona X)"),
  confidence: z.number().min(0).max(1)
    .describe("0.0 = chute, 1.0 = certeza alta. Penaliza-se inflação."),
});
```

### 8.2 Contrato tool `consult_vitor` (Zod input)

```typescript
// src/lib/agent/agents/vitoria/tools/consult-vitor.ts
inputSchema: z.object({
  topic: z.string().min(20).max(300)
    .describe("Pergunta específica e fechada. Não use pra capacity/sprint."),
  contextPrdRefs: z.array(z.string()).min(1)
    .describe("PRD refs que dão contexto (ex: ['EVZL-PRD-007'])"),
  yourCurrentThinking: z.string().min(20).max(1000)
    .describe("Sua linha de raciocínio atual e onde precisa do input do Vitor"),
})
```

---

## 9. UX

### 9.1 Estado inicial (consulta inicia)

```
┌── Chat da Vitoria (Planning Ceremony) ────┐  ┌── ConsultationSheet (auto-open) ──┐
│ PM: Cabe PRD-7 em Phase 1?                 │  │ 🟡 Vitoria consultando Vitor       │
│                                            │  │ ────────────────────────────────── │
│ Vitoria: Um momento — preciso checar a     │  │ Tópico:                            │
│ criticidade de AC do PRD-7 com o Vitor.    │  │ "Quais AC do PRD-7 são críticas    │
│ [...consultando Vitor...]                  │  │  pra persona X?"                   │
│                                            │  │                                    │
│ 🔄                                          │  │ Raciocínio da Vitoria:             │
│                                            │  │ "Capacity excede 17 FP. Considero  │
│                                            │  │  cortar AC#2 ou AC#4 mas preciso   │
│                                            │  │  saber se quebra persona X."       │
│                                            │  │                                    │
│                                            │  │ Vitor (haiku-4-5):                 │
│                                            │  │ 🔄 pensando...                      │
│                                            │  │                                    │
│                                            │  │ $0.00 / $0.10 · 0/8k tokens        │
└────────────────────────────────────────────┘  └────────────────────────────────────┘
```

### 9.2 Estado final (Vitor respondeu, Vitoria sintetizou)

```
┌── Chat da Vitoria ─────────────────────────┐  ┌── ConsultationSheet ───────────────┐
│ PM: Cabe PRD-7 em Phase 1?                 │  │ ✅ Consulta concluída              │
│                                            │  │ ────────────────────────────────── │
│ Vitoria: Cabe se cortarmos AC#2 e AC#4.    │  │ Tópico: ...                        │
│ Persona X mantém suporte (AC#1+#3 servem   │  │ Raciocínio: ...                    │
│ jornada principal). Confirmação: Vitor.    │  │                                    │
│                                            │  │ Resposta do Vitor (88%):           │
│ Aplicar? [✓ Sim] [Pivotar]                 │  │ ❝ AC#1 e AC#3 são críticas pra    │
│                                            │  │   persona X (jornada principal).   │
│                                            │  │   AC#2 e AC#4 servem persona Y    │
│                                            │  │   que só entra em Phase 2 — podem │
│                                            │  │   ser cortadas sem quebrar        │
│                                            │  │   promise do MVP. ❞                │
│                                            │  │                                    │
│                                            │  │ Confidence: 88%                    │
│                                            │  │ Tokens: 1.2k · $0.03               │
│                                            │  │                                    │
│                                            │  │ [Ver detalhes] [Fechar]            │
└────────────────────────────────────────────┘  └────────────────────────────────────┘
```

### 9.3 Pulse + polling

- UI da Vitoria (chat) polla `GET /api/consultations?projectId=X&status=in-progress` a cada 2s
- Se retornar ≥1 consultation → abre `<ConsultationSheet />` com aquela consultation
- Sheet polla `GET /api/consultations/:id` a cada 2s até status terminal
- Pulse keyframe enquanto `status='in-progress'` (`animate-pulse` tailwind)
- `prefers-reduced-motion`: desliga keyframe, mantém cor

### 9.4 Listing/audit page

```
/projects/[id]/consultations
─────────────────────────────────────────────────────
Histórico de consultas — Project Acme

[Filtrar: Context=Planning Session v1 ▼]  [Agent=Vitor ▼]

✅ "Quais AC do PRD-7 são críticas pra persona X?"
   2026-05-29 14:32 · 88% confidence · $0.03
   Iniciado por: Vitoria (durante Planning Session v1)

✅ "PRD-3 e PRD-5 podem rodar em paralelo do produto?"
   2026-05-29 14:18 · 75% confidence · $0.04
   Iniciado por: Vitoria

⚠ "Cortar AC#1 do PRD-12 quebra MVP?"  
   2026-05-29 13:55 · ABORTED ($0.00)
─────────────────────────────────────────────────────
```

---

## 10. Integrações

| Sistema | Direção | Como |
|---|---|---|
| **Vitoria's chat (Planning Ceremony)** | consumer principal | UI polla in-progress, abre `<ConsultationSheet />` quando detecta |
| **Vitoria's toolset** | tool host | `consult_vitor` é adicionado ao return de `vitoriaAgent.buildTools()` |
| **Vitor** | consulted party | Ganha `consultantProfile`. Chamado via `invokeConsultation`, sem toolset (debate-only). |
| **AgentUsage telemetry** | output | Cada consulta registra row em `AgentUsage` com `agentSlug='vitor'`, `mode='consultation'`, `consultationId` no metadata |
| **Calibration** (`/calibrate`) | health | Bug em consultor (ex: alucina AC inexistente) vira capture cat `consultation-hallucination` |
| **Job system** (`/api/jobs/`) | infra | Cada consulta dispara job; cliente polla |
| **Planning Session UI** (futuro) | downstream | Card de PRD pode mostrar "✅ Vitor consultou 3× sobre este PRD" |

---

## 11. Faseamento

**Fase única — MVP.** Slice atômico, 8 stories, ~2.5h.

Pós-MVP (fora do escopo deste PRD):
- v2: Synthesis arbiter (3a via)
- v3: Multi-round follow-up (Vitoria pode pedir clarification)
- v4: Trigger manual humano (botão no UI sem precisar Vitoria invocar)
- v5: Generalizar pra outros agentes (`consult_alpha`, etc.)

A Fase 1 entrega **muito mais que o sistema atual** (que tem 0 consulta estruturada). Mesmo sem arbiter/synthesis, dá:
- ✅ Vitoria não corta AC sem grounding
- ✅ Audit trail por consulta
- ✅ Cost visível e controlado
- ✅ UI ao vivo (side-sheet pulsante)

---

## 12. Riscos

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| Vitor consultor alucina (cita AC#9 que não existe) | Média | Alto | Prompt do consultor exige refs concretas verificáveis. `responseRawJsonb` permite eval batch detection. Calibration loop captura. |
| Vitoria abusa do tool (consulta pra tudo, custo explode) | Média | Médio | Prompt da Vitoria explicita quando USAR vs quando NÃO usar. Cost cap $0.10 hard por consulta. Limite implícito: max 5 consultas por chat session (verificável via query). |
| Side-sheet pulsante incomoda usuário | Baixa | Baixo | `prefers-reduced-motion` desliga. Sheet fecha clicando fora. |
| Polling overhead na UI | Baixa | Baixo | 2s polling em endpoint cached. Para quando user fecha. Suspende quando tab inativo. |
| RLS update policy permite mexer em row terminal | Média | Médio | CHECK no DB: `status='in-progress'` na condição USING. Após terminal, UPDATE bloqueia. |
| Vitor consultor responde fora do role (fala de capacity) | Média | Médio | `consultantProfile.cant` explicito + Zod refinement validando "position" não contém palavras-chave de capacity (FP/sprint/squad). |
| Cliente vê consultas internas via leak de RLS | Baixa | Crítico | RLS testada via integration test. Sem rota pública pra `/api/consultations`. |
| Modelo retorna JSON inválido | Baixa | Médio | `generateObject` do AI SDK retry automático 1× em parse fail. Se falhar, status='error'. |

---

## 13. Métricas de sucesso

| Métrica | Instrumento | Baseline | Target v1 |
|---|---|---|---|
| **Taxa de adoção** | `SELECT count(*) FROM "AgentConsultation" WHERE "createdAt" > now() - interval '30 days'` | 0 | ≥10 por projeto ativo |
| **Custo médio por consulta** | `SELECT avg("costUsd") FROM "AgentConsultation" WHERE status='completed'` | n/a | ≤$0.05 |
| **Confidence média do Vitor** | `SELECT avg("responseConfidence") FROM "AgentConsultation" WHERE status='completed'` | n/a | ≥0.75 (alta = útil) |
| **Aceite tácito (Vitoria integra a resposta na sua resposta final)** | Evento custom `consultation_integrated`; baseline=0 | n/a | ≥80% das consultas geram integração |
| **Tempo médio até resposta** | `SELECT avg(EXTRACT(EPOCH FROM ("completedAt" - "createdAt"))) FROM "AgentConsultation" WHERE status='completed'` | n/a | ≤8s |
| **Taxa de erro / abort** | `SELECT count(*) FILTER (WHERE status IN ('error','aborted'))::float / count(*) FROM "AgentConsultation"` | n/a | ≤5% |
| **Bugs de calibration** | `SELECT count(*) FROM "AgentCalibrationCapture" WHERE category IN ('consultation-hallucination','role-leak') AND createdAt > deploy_date` | 0 | ≤2 por 100 consultas |

---

## 14. Open questions

(vazio — todas resolvidas em §5)

---

## 15. Referências

### Código vivo
- [src/lib/agent/agents/vitor/index.ts](../../../src/lib/agent/agents/vitor/index.ts) — ganha `consultantProfile`
- [src/lib/agent/agents/vitoria/](../../../src/lib/agent/agents/vitoria/) — ganha tool `consult_vitor`
- [src/lib/agent/types.ts](../../../src/lib/agent/types.ts) — interface a estender
- [src/components/ui/responsive-sheet.tsx](../../../src/components/ui/responsive-sheet.tsx) — UI base
- [src/app/api/jobs/](../../../src/app/api/jobs/) — job system reusado

### Docs
- [docs/prd/backlog/prd-vitor-output-as-prd.md](prd-vitor-output-as-prd.md) — Vitor como PM
- [docs/prd/backlog/prd-planning-session.md](prd-planning-session.md) — primeiro consumer principal
- [docs/runbooks/agent-audits/README.md](../../runbooks/agent-audits/README.md) — vocabulary `consultation-hallucination`

---

## 16. Stories implementáveis

```yaml
- id: CSULT-001
  title: Migration AgentConsultation com RLS e CHECK terminal-imutável
  description: |
    Criar supabase/migrations/20260601a_agent_consultation.sql conforme §7.1.
    Inclui tabela AgentConsultation, indexes, RLS (read=can_view_project,
    insert=manager+can_lead, update só permitido em status='in-progress'),
    trigger updatedAt, CHECK constraint que força response fields populados
    quando status='completed'. Rodar via psql $DIRECT_URL.
  acceptanceCriteria:
    - "Arquivo supabase/migrations/20260601a_agent_consultation.sql existe"
    - "psql roda sem erro"
    - "Tabela AgentConsultation existe com RLS habilitada"
    - "Policy update_in_progress condicionada a status='in-progress'"
    - "Indexes em (contextType, contextId), (projectId, createdAt), partial in-progress"
  verifiable:
    - kind: sql
      command_or_query: "test -f supabase/migrations/20260601a_agent_consultation.sql && echo ok"
      expected: "ok"
    - kind: sql
      command_or_query: "psql \"$DIRECT_URL\" -tAc \"SELECT count(*) FROM pg_tables WHERE tablename='AgentConsultation';\""
      expected: "1"
    - kind: sql
      command_or_query: "psql \"$DIRECT_URL\" -tAc \"SELECT count(*) FROM pg_policies WHERE tablename='AgentConsultation';\""
      expected: ">=3"
  dependsOn: []
  estimateMinutes: 25
  touches:
    - supabase/migrations/20260601a_agent_consultation.sql

- id: CSULT-002
  title: Regenerar database.types.ts + interface ConsultantProfile em AgentDefinition
  description: |
    1) Atualizar src/lib/supabase/database.types.ts pra incluir AgentConsultation.
    2) Em src/lib/agent/types.ts: adicionar interface ConsultantProfile
       (domain, must, cant, recommendedModel?, examples?) e campo opcional
       consultantProfile?: ConsultantProfile em AgentDefinition.
    3) Em src/lib/agent/agents/vitor/index.ts: adicionar consultantProfile com
       domain='produto/discovery/persona', must (focar persona/dor/journey/AC
       criticality), cant (não falar capacity/sprint/squad/FP),
       recommendedModel='haiku', 2 examples realistas.
  acceptanceCriteria:
    - "database.types.ts contém type AgentConsultation"
    - "src/lib/agent/types.ts exporta ConsultantProfile"
    - "AgentDefinition tem consultantProfile?: ConsultantProfile"
    - "vitorAgent.consultantProfile populado com domain/must/cant"
    - "tsc passes"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "grep -cE 'AgentConsultation' src/lib/supabase/database.types.ts"
      expected: ">=1"
    - kind: sql
      command_or_query: "grep -cE 'interface ConsultantProfile|consultantProfile\\??:' src/lib/agent/types.ts"
      expected: ">=2"
    - kind: sql
      command_or_query: "grep -cE 'consultantProfile\\s*:' src/lib/agent/agents/vitor/index.ts"
      expected: ">=1"
  dependsOn: [CSULT-001]
  estimateMinutes: 20
  touches:
    - src/lib/supabase/database.types.ts
    - src/lib/agent/types.ts
    - src/lib/agent/agents/vitor/index.ts

- id: CSULT-003
  title: Zod schemas (ConsultationResponse, CreateConsultationInput)
  description: |
    Criar src/lib/agent/consultation/schemas.ts:
    - ConsultationResponse (position min 20 max 500, rationale min 50 max 2000,
      confidence 0-1) — schema do Zod usado em generateObject
    - CreateConsultationInput (contextType enum, contextId? uuid, projectId,
      consultedAgent enum ['vitor'], topic min 20 max 300, contextPrdRefs array
      min 1, yourCurrentThinking min 20 max 1000)
    - Type exports correspondentes
  acceptanceCriteria:
    - "Arquivo src/lib/agent/consultation/schemas.ts existe"
    - "Exporta ConsultationResponse e CreateConsultationInput como Zod schemas"
    - "tsc passes"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "grep -cE 'export const (ConsultationResponse|CreateConsultationInput)' src/lib/agent/consultation/schemas.ts"
      expected: "2"
    - kind: sql
      command_or_query: "grep -cE 'z\\.object|z\\.string|z\\.number|z\\.enum' src/lib/agent/consultation/schemas.ts"
      expected: ">=6"
  dependsOn: [CSULT-002]
  estimateMinutes: 15
  touches:
    - src/lib/agent/consultation/schemas.ts

- id: CSULT-004
  title: invokeConsultation + buildConsultantPrompt (LLM call isolated)
  description: |
    1) src/lib/agent/consultation/prompt.ts: fn buildConsultantPrompt(
       consultantProfile, topic, prdContext, yourCurrentThinking) que monta
       system prompt rigoroso ("você é Vitor em modo consultor. Foque em
       PRODUTO. Não fale de capacity. Output JSON ConsultationResponse.")
       + user prompt com topic + PRD content + raciocínio.
    2) src/lib/agent/consultation/invoke.ts: fn invokeConsultation(
       consultationId, consultantSlug, topic, contextPrdRefs, yourCurrentThinking)
       que:
       - Carrega PRDs referenciados via DAL existente (getPrdById)
       - Chama AI SDK generateObject com schema ConsultationResponse
       - Modelo: claude-haiku-4-5 (D6)
       - Retorna { position, rationale, confidence, tokensUsed, costUsd, model }
       - Sem tools — pure opinion via generateObject
  acceptanceCriteria:
    - "Arquivos prompt.ts e invoke.ts em src/lib/agent/consultation/ existem"
    - "invokeConsultation retorna Promise<ConsultationResponse & meta>"
    - "Sem chamada a runAgent ou tools (só generateObject puro)"
    - "tsc passes"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "test -f src/lib/agent/consultation/prompt.ts && test -f src/lib/agent/consultation/invoke.ts && echo ok"
      expected: "ok"
    - kind: sql
      command_or_query: "grep -cE 'generateObject' src/lib/agent/consultation/invoke.ts"
      expected: ">=1"
    - kind: sql
      command_or_query: "grep -cE 'haiku|claude-haiku' src/lib/agent/consultation/invoke.ts"
      expected: ">=1"
  dependsOn: [CSULT-003]
  estimateMinutes: 30
  touches:
    - src/lib/agent/consultation/prompt.ts
    - src/lib/agent/consultation/invoke.ts

- id: CSULT-005
  title: DAL agent-consultation (create, getById, complete, fail, listByContext, listInProgress)
  description: |
    src/lib/dal/agent-consultation.ts com fns:
    - createConsultation(input): insere row status='in-progress'
    - getConsultation(id): retorna row
    - completeConsultation(id, response, tokens, cost, model): update status
      ='completed' + response fields. Falha se row já estiver em status terminal
      (CHECK do DB pega, mas validar antes).
    - failConsultation(id, error): update status='error' + errorMessage
    - listByContext(contextType, contextId): lista pra audit page
    - listInProgress(projectId): pra polling do UI da Vitoria
    Tudo respeitando RLS.
  acceptanceCriteria:
    - "src/lib/dal/agent-consultation.ts exporta as 6 fns acima"
    - "Sem uso de service_role bypass"
    - "tsc passes"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "grep -cE 'export (async )?function (createConsultation|getConsultation|completeConsultation|failConsultation|listByContext|listInProgress)' src/lib/dal/agent-consultation.ts"
      expected: "6"
    - kind: sql
      command_or_query: "grep -cE 'service_role|SERVICE_ROLE' src/lib/dal/agent-consultation.ts"
      expected: "0"
  dependsOn: [CSULT-002]
  estimateMinutes: 25
  touches:
    - src/lib/dal/agent-consultation.ts

- id: CSULT-006
  title: Tool consult_vitor no toolset da Vitoria + integração no buildTools
  description: |
    1) src/lib/agent/agents/vitoria/tools/consult-vitor.ts: AI SDK tool com
       inputSchema (topic min 20 max 300, contextPrdRefs[] min 1,
       yourCurrentThinking min 20). Execute:
       - Cost cap pre-check (estimar tokens, abort se >$0.10)
       - createConsultation(...) → consultationId
       - invokeConsultation(consultationId, 'vitor', ...) (D4: 1 call)
       - completeConsultation(consultationId, response)
       - Return { consultationId, position, rationale, confidence }
    2) Em src/lib/agent/agents/vitoria/index.ts (ou onde Vitoria buildTools mora):
       adicionar consult_vitor ao return de buildTools quando projectId
       presente. Description rigorosa: USAR quando dúvida sobre produto/AC
       criticality, NÃO USAR pra capacity/sprint.
  acceptanceCriteria:
    - "Arquivo src/lib/agent/agents/vitoria/tools/consult-vitor.ts existe"
    - "Tool tem inputSchema Zod + execute function"
    - "Vitoria buildTools inclui consult_vitor quando vitor.consultantProfile presente"
    - "Description menciona quando NÃO usar (capacity/sprint)"
    - "tsc passes"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "test -f src/lib/agent/agents/vitoria/tools/consult-vitor.ts && echo ok"
      expected: "ok"
    - kind: sql
      command_or_query: "grep -cE 'consult_vitor' src/lib/agent/agents/vitoria/index.ts"
      expected: ">=1"
    - kind: sql
      command_or_query: "grep -cE 'NÃO USE|NÃO use|capacity|sprint' src/lib/agent/agents/vitoria/tools/consult-vitor.ts"
      expected: ">=2"
  dependsOn: [CSULT-004, CSULT-005]
  estimateMinutes: 30
  touches:
    - src/lib/agent/agents/vitoria/tools/consult-vitor.ts
    - src/lib/agent/agents/vitoria/index.ts

- id: CSULT-007
  title: API routes (POST create, GET single, GET list, POST abort)
  description: |
    Routes em src/app/api/consultations/:
    - route.ts: POST cria + dispara job (202 + jobId) + GET list por
      ?projectId&status&contextType&contextId
    - [id]/route.ts: GET hidrata row com response inline
    - [id]/abort/route.ts: POST muda status='aborted' (só se in-progress)
    Validation via Zod (CreateConsultationInput). Auth via proxy.ts.
    Job worker em src/lib/jobs/consultation-job.ts (invoca runConsultation
    helper que internamente chama invokeConsultation + completeConsultation).
  acceptanceCriteria:
    - "3 arquivos route.ts criados conforme paths acima"
    - "POST /api/consultations retorna 202 com consultationId e jobId"
    - "GET /api/consultations?projectId=...&status=in-progress retorna lista"
    - "tsc passes"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "ls src/app/api/consultations/route.ts src/app/api/consultations/[id]/route.ts src/app/api/consultations/[id]/abort/route.ts 2>&1 | grep -c 'route.ts'"
      expected: "3"
    - kind: sql
      command_or_query: "test -f src/lib/jobs/consultation-job.ts && echo ok"
      expected: "ok"
  dependsOn: [CSULT-006]
  estimateMinutes: 30
  touches:
    - src/app/api/consultations/route.ts
    - src/app/api/consultations/[id]/route.ts
    - src/app/api/consultations/[id]/abort/route.ts
    - src/lib/jobs/consultation-job.ts

- id: CSULT-008
  title: UI ConsultationSheet (ResponsiveSheet + pulse + polling auto-open)
  description: |
    Componente em src/components/agent/consultation/consultation-sheet.tsx:
    - ResponsiveSheet size="md" (D7+D8)
    - Header com PulseDot 🟡 + título "Vitoria consultando Vitor sobre: {topic}"
    - Body: 3 seções (Tópico, Raciocínio da Vitoria, Resposta do Vitor)
    - Resposta do Vitor: spinner enquanto in-progress, card com position+
      rationale+confidence quando completed
    - Cost meter visível ($X / $0.10 · Yk/8k tokens)
    - Footer: [Ver detalhes] [Fechar] quando completed; [Abortar] quando
      in-progress
    - Polling: useEffect com setInterval 2s, fetch GET /api/consultations/:id
      até status terminal. Para quando sheet fecha.
    - PulseDot subcomponent em pulse-dot.tsx — CSS keyframe respeitando
      prefers-reduced-motion (motion-reduce:animate-none tailwind)
    - Hook useInProgressConsultations(projectId) em
      src/hooks/use-in-progress-consultations.ts — polla list endpoint,
      retorna primeira in-progress. Vitoria's chat UI usa pra auto-open sheet.
  acceptanceCriteria:
    - "Arquivo consultation-sheet.tsx existe e usa ResponsiveSheet"
    - "Arquivo pulse-dot.tsx existe e respeita motion-reduce"
    - "Hook use-in-progress-consultations.ts existe"
    - "Polling implementado via setInterval + cleanup"
    - "tsc passes"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "ls src/components/agent/consultation/consultation-sheet.tsx src/components/agent/consultation/pulse-dot.tsx src/hooks/use-in-progress-consultations.ts 2>&1 | grep -cE '\\.(tsx|ts)$'"
      expected: "3"
    - kind: sql
      command_or_query: "grep -cE 'ResponsiveSheet' src/components/agent/consultation/consultation-sheet.tsx"
      expected: ">=1"
    - kind: sql
      command_or_query: "grep -cE 'motion-reduce|prefers-reduced-motion' src/components/agent/consultation/pulse-dot.tsx"
      expected: ">=1"
  dependsOn: [CSULT-007]
  estimateMinutes: 30
  touches:
    - src/components/agent/consultation/consultation-sheet.tsx
    - src/components/agent/consultation/pulse-dot.tsx
    - src/hooks/use-in-progress-consultations.ts
```

Total: 8 stories, 205min (~3h25min). Paralelizáveis após CSULT-002 (destrava 003, 005).
