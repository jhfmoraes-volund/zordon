---
status: draft
owner: João Moraes
date: 2026-05-29
domain: agents / release planning
codenames:
  - planning-session     # novo tipo de Session, paralelo a DesignSession
  - project-roadmap      # entidade output versionada
  - release-orchestrator # subagentes pre-meeting que produzem o draft
references:
  - docs/prd/backlog/prd-vitor-output-as-prd.md
  - docs/features/meetings/planning-ceremony-plan.md
  - docs/agents/vitor/vitor-runbook-end-to-end.md
  - docs/runbooks/ralph-process.md
  - project_planning_session (memory)
  - project_vitor_as_pm (memory)
  - project_planning_ceremony (memory)
---

# PRD — Planning Session: Release Planning como Session de 1ª classe

> **TL;DR:** Hoje, depois que Vitor cospe N PRDs a partir da DS Inception, **ninguém decide formalmente em que ordem rodar** — Ralph pega o próximo `ready/` aleatório, e a Planning Ceremony semanal (Vitoria) opera só em horizonte de sprint. Esta proposta cria **PlanningSession**, um novo tipo de Session paralelo conceitual à Design Session, que produz **ProjectRoadmap** versionado (phases + PRDs ordenados + milestones pro cliente). Owner do projeto dirige. Vitor (que gerou os PRDs) consulta. **4 subagentes pré-meeting** (DependencyResolver, RiskAnalyzer, CapacityAllocator, MilestoneProposer) entregam um draft ao iniciar a session — humano abre a sessão com proposta na mesa, não com canvas em branco. Re-roda em transições de fase produzindo v2, v3 da mesma session com audit trail completo.

---

## 1. Problema

### 1.1 Hoje (estado real)

Pipeline atual do Volund:

```
DS Inception
   ↓ Vitor (briefing step / PRD generation)
N PRDs em docs/prd/backlog/
   ↓ ???
PRDs movem pra docs/prd/ready/ (sem ordem definida)
   ↓ Ralph
PRDs executam em ordem aleatória dentro de ready/
   ↓ Vitoria (Planning Ceremony semanal)
Tasks dentro do PRD em execução compõem sprint
```

O **"???"** é onde mora a decisão estratégica que falta. Não existe rito formal pra:

- Decidir quais PRDs entram em MVP vs Phase 2 vs backlog
- Sequenciar PRDs respeitando `dependsOn` declarado em §16 de cada PRD
- Estimar quantos sprints cada PRD leva dado o headcount do squad
- Definir milestones de cliente ("Demo MVP", "GA Release") com datas
- Versionar essa decisão (v1 → v2 quando muda escopo) com audit trail

### 1.2 Quatro dores

1. **Ralph executa fila aleatória.** Comando `bash scripts/ralph/next.sh` pega o primeiro PRD em `ready/` alfabético. Ordem real de execução depende de quem moveu pra `ready/` quando. Sem critério estratégico, PRDs com dependsOn quebrado entram e travam o loop.

2. **Cliente assina contrato sem ver roadmap.** Owner do projeto fecha contrato, roda DS Inception, gera PRDs — mas o **briefing executivo** (quando demo, quais marcos, qual ordem) é improvisado em email ou planilha. Não fica no Zordon, não é versionado, não é auditável.

3. **Sem horizonte release no sistema.** Planning Ceremony (Vitoria) opera em sprint (7d). Não há **superlayer** que olha o projeto inteiro em phases. Quando a sprint 4 termina, ninguém pergunta "estamos no caminho do MVP?" porque não há roadmap pra comparar.

4. **Re-planejamento informal vira chaos.** Cliente mudou escopo no meio do projeto: hoje, owner edita PRDs ad-hoc, move arquivos entre `backlog/`/`ready/` sem registro. Não há "snapshot v1 era assim, v2 ficou assim, e a razão da mudança foi X". Em projeto corporate, isso quebra.

### 1.3 Princípio do user

> **"A primeira planning é um contrato com o contratante. Isso é industria corporate level. Não podemos falhar."**
> — João, 2026-05-29

Decorrência: **artefato persistente, versionado, com approver formal, com audit trail completo, com share pro cliente.** Não pode ser ad-hoc em Slack ou notion.

---

## 2. Solução em uma frase

**Criar PlanningSession (novo tipo de Session, paralelo à Design Session) que produz ProjectRoadmap versionado — uma session é dirigida pelo owner do projeto, consulta Vitor (gerou os PRDs) e 4 subagentes pré-meeting (Dep/Risk/Capacity/Milestone), gera v1 na fundação do projeto, e re-roda produzindo v2/v3 em transições de fase, com audit trail completo e share controlado pro cliente.**

---

## 3. Não-objetivos

- **Não** substitui Planning Ceremony da Vitoria. Vitoria continua copilotando sprint planning semanal — operando **dentro** de uma phase do roadmap aprovado, não acima dela.
- **Não** aloca devs específicos por PRD. v1 trabalha em granularidade de **squad**, não de indivíduo. Atribuição de dev fica em sprint planning (já existente).
- **Não** gerencia execução dos PRDs. Quando aprovado, PRD vai pra `ready/` na ordem do roadmap. Quem roda é o Ralph (já existente).
- **Não** cria interface de assinatura digital pro cliente. v1 = share read-only com link assinado. Approval formal de cliente fica fora de escopo (futuro feature).
- **Não** refaz discovery. Se cliente quer pivotar fortemente, owner roda nova DS Inception → novos PRDs → nova PlanningSession (replanning). PlanningSession não substitui descoberta.
- **Não** toca em tasks. Vitor opera no nível de PRD, Vitoria no de task — PlanningSession opera no de **PRD-em-phase**, intermediário.
- **Não** depreca markdown PRD em git. Filesystem (`docs/prd/{state}/`) continua sendo SSOT do **conteúdo** do PRD. PlanningSession só decide **ordem + agrupamento em phases**.
- **Não** automatiza re-planejamento. Owner aperta botão "Re-plan (v2)" conscientemente. Sistema não decide sozinho quando re-planejar.

---

## 4. Personas e jornada

### 4.1 PM / Owner do projeto (João)

> "Cliente assinou contrato. Rodei DS Inception com o cliente — 1h30 de descoberta, saíram módulos/personas/decisões. Vitor leu a DS e gerou 14 PRDs em `backlog/`. Agora eu preciso **propor um plano de release ao cliente** — em que ordem vamos atacar, em quantos sprints cada um, quando ele vai ver o MVP, quando GA. Antes do PlanningSession isso era email no Notion improvisado. Agora abro a session no Zordon, vejo o draft que os 4 subagentes prepararam (já com phases + ordering + milestones sugeridos), ajusto onde discordo, debato com o Vitor 'se eu adiar PRD-X 1 sprint, isso quebra o que?', aprovo a v1. Cliente recebe link de share read-only do roadmap. Em 6 sprints, quando MVP entregar, eu venho e aperto 'Re-plan (v2)' pra montar Phase 2 com novo escopo. v1 fica como histórico — se o cliente perguntar 'mas a gente combinou X', eu mostro a v1 aprovada e o motivo do replan."

### 4.2 Vitor (agente PM)

> "Eu gerei os 14 PRDs. Conheço o `dependsOn` de cada um, o `estimateMinutes` somado das stories, os módulos que cada PRD toca. Quando o owner abrir a PlanningSession, eu pré-processei: rodei Dep/Risk/Capacity/Milestone subagentes em paralelo, consolidei tudo em um draft de roadmap (phases sugeridas + PRDs ordenados + milestones). Durante o meeting eu fico no chat lateral — owner pergunta 'se eu mover PRD-7 pra Phase 2, o que quebra?' eu respondo 'PRD-9 e PRD-12 dependem de PRD-7 via §6, então também precisam ir pra Phase 2 ou aceitar dependência quebrada (não recomendo)'. Não decido nada — só apresento consequências."

### 4.3 Cliente (contratante)

> "Recebi o link de share do roadmap aprovado v1 do meu projeto. Vejo timeline visual: Phase 1 MVP (6 sprints, demo dia 13/jul), Phase 2 GA (4 sprints, lançamento dia 10/ago). Cada PRD com badge 'em execução' ou 'aguardando'. Não vejo PRDs internos (audienceType='internal') — só os marcos que importam pra mim (audienceType='client'). Se o owner re-planejar pra v2, eu recebo notificação 'roadmap atualizado pra v2' com diff resumido (X PRD movido, Y milestone adiado)."

### 4.4 Squad (devs/builders)

> "Quero saber em que ordem vamos rodar. Antes era 'pega o próximo do ready/'. Agora abro o roadmap do projeto, vejo a phase ativa (Phase 1 MVP), os PRDs alocados pro squad nessa phase em ordem. Ralph respeita essa ordem quando puxa `next.sh`. Se eu acho que a ordem tá errada (ex: PRD-3 depende de algo que ainda não foi feito), eu sinalizo no Slack do squad — owner decide se re-planeja."

---

## 5. Decisões fixadas

| # | Decisão | Justificativa |
|---|---------|---------------|
| D1 | **Tipo = Session** (não Ritual nem Meeting) | One-shot longa, gera artefato persistente, opera em horizonte release (não sprint). Paralelo conceitual à Design Session. |
| D2 | **1:N com Project** | Cada projeto pode ter múltiplas sessions (uma por replan). Última approved = roadmap atual. |
| D3 | **Versionada (v1, v2, v3...)** | Cada PlanningSession aprovada produz `version` int incremental por projeto. Roadmaps anteriores ficam `superseded`. |
| D4 | **Owner = único approver** | PM interno (`access_level=manager`+) que é owner do Project clica approve. Não há dual-approval com cliente em v1. |
| D5 | **Output = ProjectRoadmap (tabela SQL própria)** | Não markdown. Precisa de queries (totals/phase, JOIN sprints/squads, share controlado). Snapshot imutável por versão. |
| D6 | **Vitor é o agente principal** | Ele gerou os PRDs, conhece `dependsOn`/`estimateMinutes` de cada. Vitoria fica de fora (ela opera em sprint). |
| D7 | **4 subagentes pré-meeting** | DependencyResolver (DAG + critical path), RiskAnalyzer (matriz §12 consolidada), CapacityAllocator (sprints por PRD vs headcount), MilestoneProposer (marcos sugeridos). Rodam **pré**, não live. |
| D8 | **Subagentes async, com timeout** | Despachados quando session é criada. Timeout 5min cada. Se travar, session abre sem recomendação (manual). |
| D9 | **Re-planejamento = nova PlanningSession** | Owner aperta "Re-plan (v2)". Cria nova session vinculada à anterior (`parentSessionId`). Não muta a antiga. |
| D10 | **Cada versão = snapshot completo** | Não diff incremental — duplica phases/PRDs/milestones em rows novas. Roadmap inteiro versionado. |
| D11 | **PRDs movem `backlog/` → `ready/` na ordem aprovada** | Filesystem stays SSOT do conteúdo. PlanningSession decide ordem + agrupamento, e `closeout-on-approve` move arquivos atomicamente. |
| D12 | **UI espelha padrão Design Session** | Board (phases como colunas, PRDs como cards), chat lateral com Vitor, botões complete/reopen, comments. Reusa primitives de `src/components/design-session/board/`. |
| D13 | **Aba dedicada `/projects/[id]/planning`** | Tier igual a Wiki/Backlog/Sprints/Reuniões. Sempre visível. Lista versions; última approved é a default view. |
| D14 | **Share cliente via signed URL + audienceType** | Roadmap exposto via `/roadmap/share/[token]` filtra fields por `audienceType='client'`. Sem login. Token revoga em revoke. |
| D15 | **Conflict detection bloqueia approve** | Se `dependsOn` declarado entre PRDs viola ordem do roadmap (PRD-A depende de PRD-B mas A está antes), approve falha com erro. Owner ajusta ou força-aprovação com justification. |
| D16 | **`MeetingType` NÃO ganha valor novo** | PlanningSession é Session (não Meeting). Não pollui `MeetingType` enum. Tabela própria. |

---

## 6. Arquitetura

### 6.1 Diagrama de alto nível

```
┌──────────────────────────────────────────────────────────────────────┐
│  PROJECT LIFECYCLE                                                   │
│                                                                      │
│  Contrato                                                            │
│    ↓                                                                 │
│  [DesignSession kind='inception']  ──→ modules / personas / decisões │
│    ↓                                                                 │
│  [Vitor as PM] (lê DS)             ──→ N PRDs em docs/prd/backlog/   │
│    ↓                                                                 │
│  [Owner cria PlanningSession v1]                                     │
│    │                                                                 │
│    ├─ TRIGGER: orchestrate (async job)                               │
│    │   ├─ DependencyResolver  ──→ DAG                                │
│    │   ├─ RiskAnalyzer        ──→ risk matrix                        │
│    │   ├─ CapacityAllocator   ──→ sprints/PRD vs headcount           │
│    │   └─ MilestoneProposer   ──→ marcos sugeridos                   │
│    │   ↓                                                             │
│    │   Vitor consolida → agentRecommendationsJsonb                   │
│    │                                                                 │
│    ├─ UI: /projects/[id]/planning/[sessionId]                        │
│    │   ├─ Board: phases (colunas) × PRDs (cards)                     │
│    │   ├─ Sidebar: PRDs unassigned + milestones                      │
│    │   ├─ Chat lateral com Vitor (what-if queries)                   │
│    │   └─ Approve (owner only)                                       │
│    │                                                                 │
│    └─ ON APPROVE:                                                    │
│        ├─ ProjectRoadmap row criada (version=1)                      │
│        ├─ Snapshot freeze: phases/PRDs/milestones imutáveis          │
│        ├─ PRDs movem backlog/ → ready/ na ordem                      │
│        ├─ Notificação cliente (share token gerado)                   │
│        └─ Wiki v2 atualiza seção Roadmap                             │
│                                                                      │
│  [Sprint cycles começam]                                             │
│    ├─ Ralph puxa próximo PRD respeitando ordem do roadmap            │
│    └─ Vitoria opera Planning Ceremony semanal dentro da phase        │
│                                                                      │
│  [Fim de phase OU mudança de escopo]                                 │
│    ↓                                                                 │
│  [Owner cria PlanningSession v2 (parentSessionId=v1)]                │
│    ↓                                                                 │
│  Loop                                                                │
└──────────────────────────────────────────────────────────────────────┘
```

### 6.2 Componentes

| Caixa | Tipo | Onde mora | Endpoint/função |
|---|---|---|---|
| Trigger orchestrate | API route async | `src/app/api/planning-sessions/[id]/orchestrate/route.ts` | POST → cria job, retorna jobId |
| Job orchestrator | Background worker | `src/lib/agent/agents/planning-orchestrator/index.ts` | invoca subagentes em paralelo, consolida via Vitor |
| DependencyResolver | Subagent | `src/lib/agent/agents/planning-orchestrator/subagents/dependency-resolver.ts` | lê PRDs §16, retorna DAG + critical path |
| RiskAnalyzer | Subagent | `src/lib/agent/agents/planning-orchestrator/subagents/risk-analyzer.ts` | lê PRDs §12, retorna matriz consolidada |
| CapacityAllocator | Subagent | `src/lib/agent/agents/planning-orchestrator/subagents/capacity-allocator.ts` | soma `estimateMinutes` por PRD, divide por sprint capacity |
| MilestoneProposer | Subagent | `src/lib/agent/agents/planning-orchestrator/subagents/milestone-proposer.ts` | sugere marcos baseado em fim de phase + audiência |
| Vitor (consolidator) | Existing agent (extended) | `src/lib/agent/agents/vitor/` | recebe outputs dos 4 subagentes, produz `agentRecommendationsJsonb` |
| Board UI | React component | `src/components/planning-session/board.tsx` | espelha DesignSessionBoard |
| Chat lateral (Vitor) | React component | `src/components/planning-session/vitor-chat.tsx` | reusa connector chat |
| Share view | Public route | `src/app/roadmap/share/[token]/page.tsx` | filtra fields por audienceType |
| Closeout (on approve) | Server action | `src/lib/dal/planning-session.ts:approveSession` | snapshot freeze + move PRDs |

### 6.3 Stack alinhado com convenções do repo

- **API**: async para qualquer chamada de LLM (D8). `POST /orchestrate` → `202 + jobId`. Polling em `GET /jobs/[jobId]`. Cliente espera com optimistic UI.
- **Form**: Field compound API. Não criar form customizado novo.
- **Mutação**: `useOptimisticCollection` pra board drag/drop (mover PRD entre phases é mutation atômica).
- **Sheet/Dialog**: `ResponsiveSheet` pra detail view de PRD/milestone dentro do board. `ConfirmDialog` pra "Approve" (irreversível).
- **Markdown**: `Markdown` component pra render PRD §1-§3 dentro do detail sheet.

---

## 7. Schema (DDL completo)

### 7.1 Tabelas novas

**Migration 1: `supabase/migrations/20260601a_planning_session.sql`**

```sql
-- ============================================================
-- PlanningSession: instância de rito de release planning
-- 1:N com Project (uma por replan), versionada
-- ============================================================

CREATE TABLE "PlanningSession" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId" uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  version int NOT NULL,
  status text NOT NULL CHECK (status IN (
    'draft',          -- criada, aguardando orchestrate
    'orchestrating',  -- subagentes rodando
    'in-review',      -- draft pronto, owner revisando
    'approved',       -- aprovada (terminal pra v_N atual)
    'superseded',     -- substituída por versão mais nova
    'abandoned'       -- owner desistiu antes de aprovar
  )),
  title text NOT NULL,
  rationale text,                  -- por quê dessa versão (preenchido em replans)
  "facilitatorId" uuid NOT NULL REFERENCES "Member"(id),
  "parentSessionId" uuid REFERENCES "PlanningSession"(id),  -- fork de replan
  "agentRecommendationsJsonb" jsonb,  -- output dos 4 subagentes consolidado pelo Vitor
  "orchestrateJobId" uuid,          -- FK lógico pra Job table
  "startedAt" timestamptz NOT NULL DEFAULT now(),
  "approvedAt" timestamptz,
  "approvedBy" uuid REFERENCES "Member"(id),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("projectId", version),
  CHECK (
    -- only one approved per project at a time
    (status != 'approved') OR ("approvedAt" IS NOT NULL AND "approvedBy" IS NOT NULL)
  )
);

CREATE INDEX idx_planning_session_project ON "PlanningSession"("projectId", version DESC);
CREATE INDEX idx_planning_session_parent ON "PlanningSession"("parentSessionId") WHERE "parentSessionId" IS NOT NULL;
CREATE INDEX idx_planning_session_status ON "PlanningSession"("projectId", status) WHERE status IN ('approved', 'in-review');

-- partial unique: garante no máximo 1 approved por projeto
CREATE UNIQUE INDEX idx_planning_session_one_approved
  ON "PlanningSession"("projectId") WHERE status = 'approved';

ALTER TABLE "PlanningSession" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planning_session_read"
  ON "PlanningSession" FOR SELECT
  USING (can_view_project("projectId"));

CREATE POLICY "planning_session_insert"
  ON "PlanningSession" FOR INSERT
  WITH CHECK (can_lead_project("projectId"));

CREATE POLICY "planning_session_update"
  ON "PlanningSession" FOR UPDATE
  USING (can_lead_project("projectId"));

CREATE POLICY "planning_session_delete"
  ON "PlanningSession" FOR DELETE
  USING (is_manager());

CREATE TRIGGER set_planning_session_updated_at
  BEFORE UPDATE ON "PlanningSession"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

**Migration 2: `supabase/migrations/20260601b_project_roadmap.sql`**

```sql
-- ============================================================
-- ProjectRoadmap: snapshot imutável produzido por PlanningSession aprovada
-- 1:1 com PlanningSession (só existe se session foi aprovada)
-- ============================================================

CREATE TABLE "ProjectRoadmap" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "planningSessionId" uuid UNIQUE NOT NULL REFERENCES "PlanningSession"(id) ON DELETE CASCADE,
  "projectId" uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  version int NOT NULL,            -- duplicate de PlanningSession.version (denorm pra query)
  "approvedAt" timestamptz NOT NULL,
  "shareToken" text UNIQUE,        -- URL-safe random token, gerado on-approve
  "shareTokenRevokedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_project_roadmap_project ON "ProjectRoadmap"("projectId", version DESC);
CREATE INDEX idx_project_roadmap_share ON "ProjectRoadmap"("shareToken")
  WHERE "shareTokenRevokedAt" IS NULL;

ALTER TABLE "ProjectRoadmap" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_roadmap_read"
  ON "ProjectRoadmap" FOR SELECT
  USING (can_view_project("projectId"));

CREATE POLICY "project_roadmap_insert"
  ON "ProjectRoadmap" FOR INSERT
  WITH CHECK (can_lead_project("projectId"));

CREATE POLICY "project_roadmap_update"
  ON "ProjectRoadmap" FOR UPDATE
  USING (can_lead_project("projectId"));
```

**Migration 3: `supabase/migrations/20260601c_roadmap_phase.sql`**

```sql
-- ============================================================
-- RoadmapPhase: agrupador ordenado dentro de um roadmap
-- ============================================================

CREATE TABLE "RoadmapPhase" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "roadmapId" uuid NOT NULL REFERENCES "ProjectRoadmap"(id) ON DELETE CASCADE,
  "order" int NOT NULL,
  name text NOT NULL,               -- "MVP", "Phase 2 GA", "Backlog"
  goal text,                        -- "Validar uso interno"
  "targetStartDate" date,
  "targetEndDate" date,
  "audienceType" text NOT NULL DEFAULT 'internal'
    CHECK ("audienceType" IN ('internal', 'client')),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("roadmapId", "order")
);

CREATE INDEX idx_roadmap_phase_roadmap ON "RoadmapPhase"("roadmapId", "order");

ALTER TABLE "RoadmapPhase" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roadmap_phase_read"
  ON "RoadmapPhase" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "ProjectRoadmap" r
    WHERE r.id = "RoadmapPhase"."roadmapId"
      AND can_view_project(r."projectId")
  ));

-- writes só via server action (não cliente direto) — só manager+
CREATE POLICY "roadmap_phase_write"
  ON "RoadmapPhase" FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());
```

**Migration 4: `supabase/migrations/20260601d_roadmap_phase_prd.sql`**

```sql
-- ============================================================
-- RoadmapPhasePRD: M:N entre phase e PRD (filesystem-anchored)
-- ============================================================

CREATE TABLE "RoadmapPhasePRD" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "phaseId" uuid NOT NULL REFERENCES "RoadmapPhase"(id) ON DELETE CASCADE,
  "prdSlug" text NOT NULL,           -- "planning-session", "project-wiki" — aponta pra docs/prd/<state>/prd-<slug>.md
  "order" int NOT NULL,
  "estimatedSprints" int CHECK ("estimatedSprints" > 0 AND "estimatedSprints" <= 12),
  "assignedSquadId" uuid REFERENCES "Squad"(id),
  "agentJustification" text,         -- por quê do subagente colocar aqui
  "ownerOverride" text,              -- por quê do owner mover (se moveu)
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("phaseId", "prdSlug"),
  UNIQUE ("phaseId", "order")
);

CREATE INDEX idx_roadmap_phase_prd_phase ON "RoadmapPhasePRD"("phaseId", "order");
CREATE INDEX idx_roadmap_phase_prd_slug ON "RoadmapPhasePRD"("prdSlug");

ALTER TABLE "RoadmapPhasePRD" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roadmap_phase_prd_read"
  ON "RoadmapPhasePRD" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "RoadmapPhase" p
    JOIN "ProjectRoadmap" r ON r.id = p."roadmapId"
    WHERE p.id = "RoadmapPhasePRD"."phaseId"
      AND can_view_project(r."projectId")
  ));

CREATE POLICY "roadmap_phase_prd_write"
  ON "RoadmapPhasePRD" FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());
```

**Migration 5: `supabase/migrations/20260601e_roadmap_milestone.sql`**

```sql
-- ============================================================
-- RoadmapMilestone: marcos pro cliente ou internos
-- ============================================================

CREATE TABLE "RoadmapMilestone" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "roadmapId" uuid NOT NULL REFERENCES "ProjectRoadmap"(id) ON DELETE CASCADE,
  "phaseId" uuid REFERENCES "RoadmapPhase"(id) ON DELETE SET NULL,
  name text NOT NULL,                -- "Demo MVP", "GA Release"
  description text,
  "targetDate" date NOT NULL,
  "audienceType" text NOT NULL DEFAULT 'internal'
    CHECK ("audienceType" IN ('internal', 'client', 'public')),
  "order" int NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_roadmap_milestone_roadmap ON "RoadmapMilestone"("roadmapId", "targetDate");
CREATE INDEX idx_roadmap_milestone_phase ON "RoadmapMilestone"("phaseId") WHERE "phaseId" IS NOT NULL;

ALTER TABLE "RoadmapMilestone" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roadmap_milestone_read"
  ON "RoadmapMilestone" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "ProjectRoadmap" r
    WHERE r.id = "RoadmapMilestone"."roadmapId"
      AND can_view_project(r."projectId")
  ));

CREATE POLICY "roadmap_milestone_write"
  ON "RoadmapMilestone" FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());
```

**Migration 6: `supabase/migrations/20260601f_planning_session_auto_supersede.sql`**

```sql
-- ============================================================
-- Trigger: quando uma PlanningSession nova é aprovada,
-- as anteriores aprovadas viram 'superseded' automaticamente
-- ============================================================

CREATE OR REPLACE FUNCTION supersede_previous_planning_sessions()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status != 'approved' THEN
    UPDATE "PlanningSession"
    SET status = 'superseded'
    WHERE "projectId" = NEW."projectId"
      AND id != NEW.id
      AND status = 'approved';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_supersede_previous_planning_sessions
  AFTER UPDATE ON "PlanningSession"
  FOR EACH ROW EXECUTE FUNCTION supersede_previous_planning_sessions();
```

### 7.2 Tabelas modificadas — nenhuma

(Decisão D16: não polui MeetingType nem DesignSession.)

### 7.3 Convenções de RLS

- **Read** depende de `can_view_project()` — viewer ou superior do projeto
- **Write** PlanningSession depende de `can_lead_project()` — lead ou superior
- **Write** Roadmap*  depende de `is_manager()` — só manager+ (escrita só via server action, não cliente direto)
- **Share público via token** bypassa RLS via server route que valida token e expõe campos com `audienceType IN ('client', 'public')`

---

## 8. APIs

| Método | Path | Contrato | Notas |
|--------|------|----------|-------|
| POST | `/api/projects/:projectId/planning-sessions` | `{ title, parentSessionId? }` → `{ sessionId, version }` | Cria session em status=draft, version=next |
| POST | `/api/planning-sessions/:id/orchestrate` | `{}` → `202 { jobId }` | Dispara 4 subagentes async; status vira `orchestrating` |
| GET | `/api/jobs/:jobId` | → `{ status, result?, error? }` | Poll padrão (já existe no projeto) |
| GET | `/api/planning-sessions/:id` | → `{ session, draftRoadmap }` | Hidrata board com state atual (rascunho ou approved) |
| PUT | `/api/planning-sessions/:id/phases` | `{ phases: [{ name, order, ... }] }` | Salva edição manual de phases (status=in-review apenas) |
| PUT | `/api/planning-sessions/:id/phases/:phaseId/prds` | `{ prds: [{ slug, order, estimatedSprints, squadId, ownerOverride? }] }` | Reorder PRDs dentro de phase |
| POST | `/api/planning-sessions/:id/milestones` | `{ phaseId?, name, targetDate, audienceType }` | Cria milestone |
| POST | `/api/planning-sessions/:id/approve` | `{ rationale? }` → `{ roadmapId, shareToken }` | Owner-only. Valida conflict (D15). Move PRDs filesystem. |
| POST | `/api/planning-sessions/:id/replan` | `{}` → `{ newSessionId }` | Fork da approved atual; status vira `in-review` na nova; antiga continua approved até nova ser aprovada |
| POST | `/api/planning-sessions/:id/abandon` | `{}` → `{ ok }` | Status vira `abandoned`. Não muta roadmap atual. |
| GET | `/api/projects/:projectId/roadmap/current` | → `{ roadmap, phases, milestones }` | Atalho pra última approved |
| GET | `/api/projects/:projectId/roadmap/versions` | → `[{ version, approvedAt, ... }]` | Lista histórico |
| GET | `/api/projects/:projectId/roadmap/diff?from=1&to=2` | → `{ added: [], removed: [], moved: [] }` | Diff entre versions (pra cliente notification) |
| GET | `/roadmap/share/:token` | HTML response (não JSON) | Página pública filtrada por audienceType |
| POST | `/api/roadmaps/:id/share/revoke` | `{}` → `{ ok }` | Revoga shareToken (owner-only) |
| POST | `/api/planning-sessions/:id/vitor/chat` | `{ message, context }` → SSE stream | Chat lateral com Vitor (consulta what-if). Reusa connector chat. |

### 8.1 Contrato do orchestrate job

Output esperado (formato de `agentRecommendationsJsonb`):

```jsonc
{
  "schemaVersion": "1.0",
  "generatedAt": "2026-06-01T12:00:00Z",
  "subagents": {
    "dependencyResolver": {
      "dag": [{ "from": "auth", "to": "wiki", "kind": "blocks" }],
      "criticalPath": ["auth", "wiki", "billing"],
      "stronglyConnectedComponents": []
    },
    "riskAnalyzer": {
      "matrix": [
        { "prdSlug": "billing", "risks": [{ "name": "Stripe latency", "prob": "med", "impact": "high" }] }
      ]
    },
    "capacityAllocator": {
      "totalSprints": 14,
      "perPRD": [{ "prdSlug": "auth", "estimatedSprints": 2 }]
    },
    "milestoneProposer": {
      "suggested": [
        { "name": "Demo MVP", "afterPhase": "Phase 1", "audienceType": "client" }
      ]
    }
  },
  "vitorConsolidation": {
    "draftPhases": [
      {
        "name": "Phase 1 — MVP",
        "order": 1,
        "audienceType": "internal",
        "prds": [{ "slug": "auth", "order": 1, "estimatedSprints": 2, "justification": "..." }]
      }
    ],
    "draftMilestones": [...],
    "warnings": ["Risco 'Stripe latency' não tem mitigation no §12 do prd-billing.md"]
  }
}
```

---

## 9. UX

### 9.1 Entrada — aba "Planning" no projeto

```
┌── /projects/[id] ─────────────────────────────────────────┐
│ [Wiki] [Backlog] [Sprints] [Reuniões] [Planning] ◀──      │
│                                                            │
│ ┌── /projects/[id]/planning ──────────────────────────┐   │
│ │ Roadmap atual: v1 (approved 2026-06-01)             │   │
│ │ ┌────────────────────────────────────────────────┐  │   │
│ │ │ Phase 1 — MVP (6 sprints, até 13/jul)          │  │   │
│ │ │  ☐ PRD-001 Wiki         [2 sprints] [squad A]  │  │   │
│ │ │  ☐ PRD-002 Auth         [2 sprints] [squad A]  │  │   │
│ │ │  → Milestone: Demo interna (13/jul)            │  │   │
│ │ │                                                │  │   │
│ │ │ Phase 2 — GA (4 sprints, até 10/ago)           │  │   │
│ │ │  ☐ PRD-003 Billing      [3 sprints] [squad B]  │  │   │
│ │ │  → Milestone: Demo cliente (10/ago)            │  │   │
│ │ └────────────────────────────────────────────────┘  │   │
│ │                                                      │   │
│ │ Backlog (não priorizado): 4 PRDs                    │   │
│ │ [Re-plan (v2)] [Histórico] [Compartilhar com cliente]│   │
│ └──────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

### 9.2 Editor de session (board mode)

```
┌── /projects/[id]/planning/sessions/[sessionId] (in-review) ─┐
│                                                               │
│ ┌── Board ────────────────────┐  ┌── Chat com Vitor ─────┐   │
│ │                              │  │                       │   │
│ │ ┌── Phase 1 — MVP ─────┐    │  │ Vitor:                │   │
│ │ │ + PRD                │    │  │ Pré-processei 14 PRDs.│   │
│ │ │ ┌─────────────────┐  │    │  │ Sugiro 2 phases.      │   │
│ │ │ │ auth      [2s] X│  │    │  │ Critical path:        │   │
│ │ │ │ ↕               │  │    │  │ auth → wiki → billing │   │
│ │ │ └─────────────────┘  │    │  │                       │   │
│ │ │ ┌─────────────────┐  │    │  │ ┌─ você ────────────┐ │   │
│ │ │ │ wiki      [2s] X│  │    │  │ │ se eu mover billing│ │   │
│ │ │ └─────────────────┘  │    │  │ │ pra phase 1?       │ │   │
│ │ └──────────────────────┘    │  │ └────────────────────┘ │   │
│ │ ┌── Phase 2 — GA ──────┐    │  │ Vitor:                │   │
│ │ │ ┌─────────────────┐  │    │  │ Adiciona 3 sprints à │   │
│ │ │ │ billing   [3s] X│  │    │  │ phase 1 (capacity    │   │
│ │ │ └─────────────────┘  │    │  │ excede headcount).   │   │
│ │ └──────────────────────┘    │  │ Recomendo manter.    │   │
│ │ ┌── Backlog ──────────┐    │  │                       │   │
│ │ │ + 4 PRDs            │    │  │ [enviar]              │   │
│ │ └──────────────────────┘    │  └───────────────────────┘   │
│ │                              │                              │
│ │ Milestones:                  │                              │
│ │  ◆ Demo MVP (13/jul) cliente │                              │
│ │  ◆ GA Release (10/ago) public│                              │
│ │  [+ milestone]               │                              │
│ │                              │                              │
│ │ [Approve v1]  [Salvar draft] │                              │
│ └──────────────────────────────┘                              │
└───────────────────────────────────────────────────────────────┘
```

### 9.3 PRD detail sheet (clicar num card)

`ResponsiveSheet` lateral mostra:
- §1 Problema (markdown render)
- §2 Solução em uma frase
- §11 Faseamento (do PRD)
- §16 Stories (count + dependencies)
- "Justificativa do agente" (porquê esse PRD foi alocado nessa phase)
- "Override do owner" (textarea, se moveu manualmente)

### 9.4 Approve flow (ConfirmDialog)

```
┌── Aprovar Roadmap v1? ──────────────────────────┐
│                                                  │
│ Você está aprovando o roadmap v1 do projeto X.  │
│                                                  │
│ Ações automáticas:                              │
│   ✓ 14 PRDs movem backlog/ → ready/             │
│   ✓ Link de share gerado pro cliente            │
│   ✓ Wiki v2 atualiza seção Roadmap              │
│   ✓ Notificação pro squad                       │
│                                                  │
│ Após aprovar, mudanças exigem re-plan (v2).     │
│                                                  │
│ Rationale (opcional):                           │
│ [textarea]                                       │
│                                                  │
│ [Cancelar] [Confirmar aprovação]                │
└──────────────────────────────────────────────────┘
```

### 9.5 Share view pro cliente (público via token)

```
┌── Roadmap — Project X (v1, atualizado 01/jun) ──────────┐
│                                                          │
│ Phase 1 — MVP                                            │
│   Sprints 1-6, demo prevista 13/jul                     │
│   ◆ Demo interna 13/jul (não exibido pro cliente)       │
│   ◆ Demo MVP 13/jul ← exibido (audienceType=client)     │
│                                                          │
│ Phase 2 — GA                                             │
│   Sprints 7-10, lançamento 10/ago                       │
│   ◆ GA Release 10/ago ← exibido                         │
│                                                          │
│ PRDs não são mostrados (são detalhes internos).         │
│                                                          │
│ Atualizado por: Owner do projeto                        │
│ Versão: 1                                                │
└──────────────────────────────────────────────────────────┘
```

---

## 10. Integrações

| Sistema | Direção | Como integra |
|---------|---------|--------------|
| Design Session (Inception) | input | Subagentes lêem `DesignSession` joined com modules/personas/decisions pra context. |
| Vitor as PM | input + agent | Vitor é o orchestrator dos subagentes; já tem connector próprio (chat lateral). |
| PRDs em `docs/prd/{backlog,ready}/` | filesystem r/w | `approveSession` move arquivos atomicamente respeitando ordem aprovada. |
| Ralph process | output | Ralph já lê `docs/prd/ready/` — passa a respeitar `RoadmapPhasePRD.order` consultando roadmap atual via API antes de pegar próximo. |
| Planning Ceremony (Vitoria) | downstream | Vitoria opera sprint planning **dentro** da phase ativa do roadmap. Ganha bloco no prompt: "phase atual = X, PRDs em execução = Y". |
| Wiki v2 | downstream | Seção "Roadmap" da Wiki v2 puxa current roadmap via API. Read-only embed. |
| Project page header | downstream | Header mostra "Phase 1/2 — MVP (sprint 4 de 6)" baseado em current roadmap. |
| Cliente (share) | downstream público | Token signed URL, sem login. RLS bypass via server route. |
| AgentUsage telemetry | output | Cada chamada a subagent gera row com `agentSlug` correspondente. Já existe schema. |

---

## 11. Faseamento

Princípio: **cada fase entrega valor sozinha**. Fase 1 entrega mais que o sistema atual (que não tem nada de release planning), mesmo sem agentes.

### Fase 1 — Schema + read-only display (semana 1)

**Entrega**: tabelas criadas. Aba `/projects/[id]/planning` lista roadmaps existentes (vazio inicialmente). Owner pode criar PlanningSession manual (sem agentes), preencher phases/PRDs/milestones via API ou SQL. Approve funciona, share gera token. Wiki v2 mostra current roadmap.

**Valor**: Owner pode documentar manualmente um roadmap pro cliente. Já é mais do que existe hoje.

**Stories**: 5 stories (F1-S01..S05)

### Fase 2 — Editor UI (drag/drop, sem agentes) (semana 2-3)

**Entrega**: board com drag/drop de PRDs entre phases, milestones com targetDate, owner override com justification. PRD detail sheet com markdown render. Approve com ConfirmDialog + closeout (move PRDs filesystem).

**Valor**: Owner monta roadmap fluentemente via UI, sem precisar SQL.

**Stories**: 6 stories (F2-S06..S11)

### Fase 3 — Vitor + 4 subagentes pré-meeting (semana 4-5)

**Entrega**: orchestrate endpoint async com job tracking. 4 subagentes implementados (Dep/Risk/Capacity/Milestone). Vitor consolidator. `agentRecommendationsJsonb` hidrata board ao abrir session. Chat lateral com Vitor pra what-if.

**Valor**: Draft automático em <5min ao invés de canvas em branco. Multi-agent corporate-grade.

**Stories**: 7 stories (F3-S12..S18)

### Fase 4 — Re-planning versionado + diff (semana 6)

**Entrega**: "Re-plan (v2)" botão, fork da approved atual. Histórico de versions na UI. Diff endpoint + view. Notification pro cliente de "roadmap atualizado".

**Valor**: Audit trail completo entre versions. Owner pode justificar mudanças.

**Stories**: 4 stories (F4-S19..S22)

### Fase 5 — Share cliente + audit log polido (semana 7)

**Entrega**: rota pública `/roadmap/share/[token]`, filtro `audienceType`, revoga token, audit log completo (quem aprovou v_N, quando, com que rationale).

**Valor**: Cliente vê roadmap formal, owner pode revogar link após renegociação.

**Stories**: 3 stories (F5-S23..S25)

---

## 12. Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Subagentes timeout em projetos com 30+ PRDs | Médio | Médio | Timeout 5min por subagent. Se falhar, session abre sem recomendação (manual). Worker tem retry 1× automático. |
| PRD em `dependsOn` declarado mas slug não bate com filesystem | Alto | Alto | Validador no orchestrate roda antes — se slug inexistente em `docs/prd/{backlog,ready}/`, retorna warning + session abre com PRDs órfãos isolados em backlog do roadmap. |
| Approve dispara closeout (move PRDs) que falha mid-way | Médio | Alto | Closeout em transaction: rollback move arquivos + rollback DB. Operação atômica. |
| Cliente ganha acesso a info confidencial via share | Médio | Crítico | Server route valida `audienceType IN ('client', 'public')` em **todo** field exposto. Code review obrigatório em PR que toca share route. Token expira em 90d (renovável). |
| Replan v2 dispara enquanto v1 ainda tem sprints em execução | Alto | Médio | Replan não muta v1 — só cria v2 paralela. Status v1 vira `superseded` só quando v2 é aprovada. Squads continuam tocando v1 até v2 estar live. |
| Conflict detection (D15) tem false positive (não detecta dependsOn implícito) | Alto | Médio | Conflict só bloqueia se `dependsOn` EXPLÍCITO no §16 do PRD. Implícito vira warning, não block. Owner pode forçar approve com `forceConflict=true` + rationale obrigatório. |
| Multi-agent pré-processing fica caro (cost spike) | Médio | Médio | Cache 24h em `agentRecommendationsJsonb` por hash dos PRDs (`SHA256(prdContents)`). Re-orchestrate só se PRDs mudaram. Métrica de cost por session. |
| UI drag/drop quebra acessibilidade | Médio | Médio | Reusar primitive de DesignSessionBoard que já tem keyboard nav + aria-grabbed/dropped. Test em fase 2 obrigatório. |

---

## 13. Métricas de sucesso

| Métrica | Instrumento (SQL/evento) |
|---------|--------------------------|
| **Aderência ao plano**: % PRDs entregues na phase planejada | `SELECT (count(*) FILTER (WHERE p.completedAt BETWEEN ph."targetStartDate" AND ph."targetEndDate")::float / count(*)) FROM "RoadmapPhasePRD" rp JOIN "RoadmapPhase" ph ON ph.id = rp."phaseId" JOIN "Project" p ON p.id = ph.<derived> WHERE r.version = (current_approved_version)` |
| **Aceitação do agente**: % do draft que o owner aceitou sem alterar | `SELECT count(*) FILTER (WHERE "ownerOverride" IS NULL)::float / count(*) FROM "RoadmapPhasePRD"` (por roadmap aprovado) |
| **Velocidade do rito**: mediana de tempo entre `startedAt` e `approvedAt` | `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("approvedAt" - "startedAt"))) FROM "PlanningSession" WHERE status='approved'` |
| **Frequência de replan**: replans por projeto por trimestre | `SELECT "projectId", count(*) FROM "PlanningSession" WHERE "parentSessionId" IS NOT NULL AND "createdAt" > now() - interval '3 months' GROUP BY "projectId"` |
| **Cobertura share cliente**: % de roadmaps approved que tiveram share token ativado em <7d | `SELECT count(*) FILTER (WHERE "shareToken" IS NOT NULL AND r."createdAt" - ps."approvedAt" < interval '7 days')::float / count(*) FROM "ProjectRoadmap" r JOIN "PlanningSession" ps ON ps.id = r."planningSessionId"` |
| **Custo médio por session**: USD em `AgentUsage` por orchestrate | `SELECT avg(cost_usd) FROM "AgentUsage" WHERE agentSlug IN ('planning-orchestrator', 'dep-resolver', 'risk-analyzer', 'capacity-allocator', 'milestone-proposer')` (agrupado por jobId via metadata) |
| **Time-to-first-PRD-execution**: dias entre approve e primeiro PR mergeado em PRD do roadmap | `SELECT avg(<first_merge_at> - ps."approvedAt") FROM ...` (depende de wiring Ralph→git) |

### 13.1 Health do agente

Se **aceitação do agente < 50%** consistentemente (3+ sessions), agente entra em [/calibrate](.claude/skills/calibrate/SKILL.md) com category `prompt-confuso` ou `modelo-alucina`.

---

## 14. Open questions

(Idealmente vazio. Os que ficam são marcados pra fase futura — sem bloquear Fase 1.)

- **Q1**: Como exatamente PRD marca-se como "completed" pra calcular aderência? — resolvido em Fase 5 (precisa wiring Ralph→update `PRDExecutionStatus` quando merge final acontecer). Não bloqueia Fases 1-4.
- **Q2**: Cliente login pra ver share — escopo de outra feature (Auth pra cliente externo). Por enquanto, token-only.

---

## 15. Referências

### Código vivo

- [src/lib/agent/agents/vitor/](../../../src/lib/agent/agents/vitor/) — Vitor as PM (será extended pra orchestrator)
- [src/components/design-session/board/](../../../src/components/design-session/board/) — primitives a reusar (BoardColumn, StickyCard, BoardSection)
- [src/lib/dal/planning.ts](../../../src/lib/dal/planning.ts) — DAL pattern de Planning Ceremony (reusar pattern)
- [scripts/ralph/](../../../scripts/ralph/) — Ralph process (downstream consumer)
- [src/lib/supabase/database.types.ts](../../../src/lib/supabase/database.types.ts) — regenerar após migrations

### Docs

- [docs/prd/backlog/prd-vitor-output-as-prd.md](prd-vitor-output-as-prd.md) — Vitor como PM (input desta feature)
- [docs/features/meetings/planning-ceremony-plan.md](../../features/meetings/planning-ceremony-plan.md) — Planning Ceremony (downstream consumer)
- [docs/runbooks/ralph-process.md](../../runbooks/ralph-process.md) — Ralph (downstream consumer)
- [docs/runbooks/agent-audits/README.md](../../runbooks/agent-audits/README.md) — vocabulary de calibração (subagentes entram no loop)

### Memories

- `project_planning_session` (este)
- `project_vitor_as_pm`
- `project_planning_ceremony`
- `project_design_session` + `project_design_session_normalization`
- `project_ralph_process`
- `project_wiki_v2`
- `project_ui_patterns`

---

## 16. Stories implementáveis

### Fase 1 — Schema + read-only display

```yaml
- id: PLANNING-001
  title: Criar 5 migrations de schema da PlanningSession
  description: |
    Cria 6 migrations atômicas em supabase/migrations/ (20260601a..20260601f) conforme §7.
    Cada migration tem 1 CREATE TABLE ou 1 trigger. Inclui CHECK constraints, RLS policies,
    índices, e trigger de auto-supersede.
  acceptanceCriteria:
    - "6 arquivos em supabase/migrations/20260601*_*.sql existem"
    - "psql roda todas em ordem sem erro"
    - "SELECT typname FROM pg_type WHERE typname LIKE 'PlanningSession%' retorna >= 1"
    - "RLS habilitada em todas 5 tabelas"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_tables WHERE tablename IN ('PlanningSession','ProjectRoadmap','RoadmapPhase','RoadmapPhasePRD','RoadmapMilestone');"
      expected: "5"
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename IN ('PlanningSession','ProjectRoadmap','RoadmapPhase','RoadmapPhasePRD','RoadmapMilestone');"
      expected: ">= 10"
  dependsOn: []
  estimateMinutes: 30
  touches:
    - supabase/migrations/20260601a_planning_session.sql
    - supabase/migrations/20260601b_project_roadmap.sql
    - supabase/migrations/20260601c_roadmap_phase.sql
    - supabase/migrations/20260601d_roadmap_phase_prd.sql
    - supabase/migrations/20260601e_roadmap_milestone.sql
    - supabase/migrations/20260601f_planning_session_auto_supersede.sql

- id: PLANNING-002
  title: Atualizar database.types.ts com novas tabelas
  description: |
    Regenerar src/lib/supabase/database.types.ts via supabase gen types após rodar migrations.
    Verificar que as 5 tabelas aparecem como TypeScript interfaces.
  acceptanceCriteria:
    - "TypeScript types pra PlanningSession, ProjectRoadmap, RoadmapPhase, RoadmapPhasePRD, RoadmapMilestone existem"
    - "tsc não quebra"
  verifiable:
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "no errors"
    - kind: lint
      command_or_query: "grep -c 'PlanningSession' src/lib/supabase/database.types.ts"
      expected: ">= 1"
  dependsOn: [PLANNING-001]
  estimateMinutes: 10
  touches:
    - src/lib/supabase/database.types.ts

- id: PLANNING-003
  title: DAL de PlanningSession (read + create básico)
  description: |
    Criar src/lib/dal/planning-session.ts com fns: getCurrentRoadmap(projectId), listSessions(projectId),
    getSession(sessionId), createSession(projectId, title, parentSessionId?). Hidrata joins de
    phases/PRDs/milestones quando relevante.
  acceptanceCriteria:
    - "src/lib/dal/planning-session.ts exporta as 4 fns acima"
    - "Cada fn respeita RLS (não faz bypass)"
    - "getCurrentRoadmap retorna null se não há approved version"
  verifiable:
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit src/lib/dal/planning-session.ts"
      expected: "no errors"
    - kind: lint
      command_or_query: "grep -E '^export (async )?function (getCurrentRoadmap|listSessions|getSession|createSession)' src/lib/dal/planning-session.ts | wc -l"
      expected: "4"
  dependsOn: [PLANNING-002]
  estimateMinutes: 25
  touches:
    - src/lib/dal/planning-session.ts

- id: PLANNING-004
  title: API routes básicas (GET roadmap, POST session, GET session)
  description: |
    Criar 3 routes em src/app/api/projects/[id]/planning-sessions/ e
    src/app/api/planning-sessions/[id]/. Validação via Zod. Auth via existing proxy.ts middleware.
  acceptanceCriteria:
    - "POST /api/projects/:id/planning-sessions retorna 201 com sessionId"
    - "GET /api/projects/:projectId/roadmap/current retorna roadmap atual ou 404"
    - "GET /api/planning-sessions/:id retorna session com phases/PRDs/milestones inline"
    - "Lead+ é exigido pra POST"
  verifiable:
    - kind: http
      command_or_query: "curl -X POST http://localhost:3000/api/projects/$TEST_PROJECT_ID/planning-sessions -H 'cookie: ...' -d '{\"title\":\"v1\"}'"
      expected: "201 status code"
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "no errors"
  dependsOn: [PLANNING-003]
  estimateMinutes: 30
  touches:
    - src/app/api/projects/[id]/planning-sessions/route.ts
    - src/app/api/projects/[id]/roadmap/current/route.ts
    - src/app/api/planning-sessions/[id]/route.ts

- id: PLANNING-005
  title: Página /projects/[id]/planning (read-only listing)
  description: |
    Server component renderizando current roadmap se existe (phases/PRDs/milestones), ou
    empty state "Nenhum roadmap aprovado ainda. [Criar PlanningSession]". Mostra histórico de
    versions com hyperlink.
  acceptanceCriteria:
    - "Página /projects/[id]/planning renderiza sem 500"
    - "Mostra current roadmap se existe"
    - "Mostra empty state se não existe"
    - "Lista histórico de versions abaixo"
  verifiable:
    - kind: manual_browser
      command_or_query: "Visit /projects/[test-id]/planning"
      expected: "renders without 500; shows empty state or roadmap"
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "no errors"
  dependsOn: [PLANNING-004]
  estimateMinutes: 25
  touches:
    - src/app/(dashboard)/projects/[id]/planning/page.tsx
```

### Fase 2 — Editor UI (drag/drop)

```yaml
- id: PLANNING-006
  title: Board primitive — phases as columns
  description: |
    Criar src/components/planning-session/board.tsx reusando BoardColumn/StickyCard de
    design-session/board/. Phases viram colunas; PRDs viram cards. Sidebar com PRDs não alocados +
    milestones.
  acceptanceCriteria:
    - "Componente renderiza N phases como colunas + 1 sidebar"
    - "Cada PRD card mostra slug + estimatedSprints + assignedSquad badge"
    - "Reusa primitives existentes (não duplica BoardColumn)"
  verifiable:
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit src/components/planning-session/board.tsx"
      expected: "no errors"
    - kind: lint
      command_or_query: "grep -c 'BoardColumn' src/components/planning-session/board.tsx"
      expected: ">= 1"
  dependsOn: [PLANNING-005]
  estimateMinutes: 30
  touches:
    - src/components/planning-session/board.tsx
    - src/components/planning-session/prd-card.tsx

- id: PLANNING-007
  title: Drag/drop entre phases com useOptimisticCollection
  description: |
    Implementar drag/drop usando useOptimisticCollection. Mutation `move_prd` move PRD entre
    phases ou reordena dentro de phase. Optimistic UI, persist via PUT
    /api/planning-sessions/:id/phases/:phaseId/prds.
  acceptanceCriteria:
    - "Drag PRD card de phase A pra phase B atualiza UI instantaneamente"
    - "PUT request sai pro backend; em erro, reverte"
    - "Reorder dentro da mesma phase funciona"
    - "Keyboard nav (Up/Down + Enter) funciona"
  verifiable:
    - kind: manual_browser
      command_or_query: "Arrastar PRD card entre 2 phases"
      expected: "card move; reload mantém"
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "no errors"
  dependsOn: [PLANNING-006]
  estimateMinutes: 30
  touches:
    - src/components/planning-session/board.tsx
    - src/app/api/planning-sessions/[id]/phases/[phaseId]/prds/route.ts

- id: PLANNING-008
  title: PRD detail sheet (ResponsiveSheet)
  description: |
    Clicar num PRD card abre ResponsiveSheet lateral com §1/§2/§11/§16 do PRD renderizados
    (markdown) + campo "ownerOverride" (textarea) salvando em RoadmapPhasePRD.
  acceptanceCriteria:
    - "Click no card abre sheet (desktop side, mobile bottom)"
    - "Sheet mostra markdown do PRD"
    - "Textarea de override persiste via API"
  verifiable:
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "no errors"
    - kind: manual_browser
      command_or_query: "Click em card → sheet abre"
      expected: "sheet visível"
  dependsOn: [PLANNING-007]
  estimateMinutes: 25
  touches:
    - src/components/planning-session/prd-detail-sheet.tsx

- id: PLANNING-009
  title: Milestones CRUD
  description: |
    UI pra adicionar/editar/remover milestone via dialog. Campos: name, targetDate, audienceType
    (radio), phaseId (select). Persist via POST /api/planning-sessions/:id/milestones.
  acceptanceCriteria:
    - "Botão '+ milestone' abre ResponsiveDialog"
    - "Form valida targetDate obrigatório, audienceType obrigatório"
    - "Milestone aparece embaixo da phase associada após salvar"
  verifiable:
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "no errors"
  dependsOn: [PLANNING-007]
  estimateMinutes: 25
  touches:
    - src/components/planning-session/milestone-dialog.tsx
    - src/app/api/planning-sessions/[id]/milestones/route.ts

- id: PLANNING-010
  title: Conflict detection on approve (D15)
  description: |
    Validador rodando server-side no POST /approve: lê todos PRDs do roadmap, parsa §16 de cada
    pra extrair dependsOn explícito, valida que se PRD-A.dependsOn=[PRD-B] então B está em phase
    anterior OU mesma phase com order menor. Bloqueia approve se conflict, retorna 422 com
    detalhes.
  acceptanceCriteria:
    - "Approve retorna 422 se conflict detectado"
    - "422 body inclui lista de conflicts: [{from, to, reason}]"
    - "Force-approve via body {forceConflict:true, rationale:'...'} bypassa (com rationale obrigatório)"
  verifiable:
    - kind: http
      command_or_query: "POST /api/planning-sessions/<id-com-conflict>/approve"
      expected: "422 status"
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "no errors"
  dependsOn: [PLANNING-008]
  estimateMinutes: 30
  touches:
    - src/lib/planning-session/conflict-detector.ts
    - src/app/api/planning-sessions/[id]/approve/route.ts

- id: PLANNING-011
  title: Approve flow + closeout (move PRDs filesystem)
  description: |
    POST /approve em transaction: marca session=approved, cria ProjectRoadmap row + shareToken,
    move arquivos `docs/prd/backlog/prd-<slug>.md` → `docs/prd/ready/` na ordem aprovada.
    ConfirmDialog na UI antes. Roda via server action que executa node fs ops + DB em mesma tx.
  acceptanceCriteria:
    - "Approve move PRDs sem deixar órfãos"
    - "Erro mid-way reverte tudo (DB rollback + arquivos voltam)"
    - "shareToken gerado é cryptographically random (32+ bytes)"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM \"ProjectRoadmap\" WHERE \"shareToken\" IS NOT NULL"
      expected: ">= 1 após approve test"
    - kind: manual_browser
      command_or_query: "Approve em test session → verificar docs/prd/ready/ tem novos PRDs"
      expected: "PRDs movidos"
  dependsOn: [PLANNING-010]
  estimateMinutes: 30
  touches:
    - src/lib/planning-session/closeout.ts
    - src/app/api/planning-sessions/[id]/approve/route.ts
```

### Fase 3 — Multi-agent pré-meeting

```yaml
- id: PLANNING-012
  title: DependencyResolver subagent
  description: |
    Cria src/lib/agent/agents/planning-orchestrator/subagents/dependency-resolver.ts. Lê PRDs do
    projeto, parsa §16 de cada pra extrair dependsOn explícito, monta DAG em JSON, calcula
    critical path via topological sort. Output schema validado por Zod.
  acceptanceCriteria:
    - "Função resolve(prdSlugs[]) retorna {dag, criticalPath, scc}"
    - "DAG inclui arestas {from, to, kind}"
    - "criticalPath é array ordenado de slugs"
    - "Detecta ciclo (SCC com >1 node) e flagga em warnings"
  verifiable:
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit src/lib/agent/agents/planning-orchestrator/subagents/dependency-resolver.ts"
      expected: "no errors"
    - kind: lint
      command_or_query: "grep -c 'topological\\|criticalPath' src/lib/agent/agents/planning-orchestrator/subagents/dependency-resolver.ts"
      expected: ">= 2"
  dependsOn: [PLANNING-011]
  estimateMinutes: 30
  touches:
    - src/lib/agent/agents/planning-orchestrator/subagents/dependency-resolver.ts

- id: PLANNING-013
  title: RiskAnalyzer subagent
  description: |
    Cria risk-analyzer.ts. Lê §12 de cada PRD, extrai risks {name, prob, impact, mitigation},
    consolida em matriz por phase. Output Zod-validated.
  acceptanceCriteria:
    - "Função analyze(prdSlugs[]) retorna matrix:[{prdSlug, risks:[]}]"
    - "Parser ignora risks malformados (warning, não throw)"
    - "Risk severity é prob × impact"
  verifiable:
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit src/lib/agent/agents/planning-orchestrator/subagents/risk-analyzer.ts"
      expected: "no errors"
  dependsOn: [PLANNING-011]
  estimateMinutes: 25
  touches:
    - src/lib/agent/agents/planning-orchestrator/subagents/risk-analyzer.ts

- id: PLANNING-014
  title: CapacityAllocator subagent
  description: |
    Cria capacity-allocator.ts. Lê §16 stories de cada PRD, soma estimateMinutes, divide por
    sprint capacity (default 40h × headcount). Retorna sprints estimados por PRD.
  acceptanceCriteria:
    - "Função allocate(prdSlugs[], squadHeadcount) retorna [{prdSlug, estimatedSprints}]"
    - "Capacity calculo é (sum(estimateMinutes)/60) / (40*headcount), arredondado pra cima"
    - "PRD sem stories visíveis retorna estimatedSprints:1 com warning"
  verifiable:
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit src/lib/agent/agents/planning-orchestrator/subagents/capacity-allocator.ts"
      expected: "no errors"
  dependsOn: [PLANNING-011]
  estimateMinutes: 25
  touches:
    - src/lib/agent/agents/planning-orchestrator/subagents/capacity-allocator.ts

- id: PLANNING-015
  title: MilestoneProposer subagent
  description: |
    Cria milestone-proposer.ts. Recebe phases sugeridas + dates, propõe marcos {name, targetDate,
    audienceType, afterPhase}. Heurística: fim de phase = milestone interna; phases marcadas
    audienceType='client' = milestone cliente.
  acceptanceCriteria:
    - "Função propose(phases[]) retorna milestones[]"
    - "Sempre tem pelo menos 1 milestone por phase"
    - "audienceType bate com da phase ou é 'internal' default"
  verifiable:
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit src/lib/agent/agents/planning-orchestrator/subagents/milestone-proposer.ts"
      expected: "no errors"
  dependsOn: [PLANNING-011]
  estimateMinutes: 20
  touches:
    - src/lib/agent/agents/planning-orchestrator/subagents/milestone-proposer.ts

- id: PLANNING-016
  title: Vitor consolidator
  description: |
    Extende Vitor com modo 'orchestrator': recebe outputs dos 4 subagentes + DS Inception, gera
    agentRecommendationsJsonb consolidado. Usa Sonnet 4.6 (não Haiku). Reasoning via adaptive
    thinking. Output validado por Zod (schema em §8.1).
  acceptanceCriteria:
    - "Função consolidate(subagentOutputs, dsContext) retorna agentRecommendationsJsonb"
    - "Schema validation com Zod"
    - "Warnings: items que Vitor flag mas não bloqueia"
  verifiable:
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit src/lib/agent/agents/planning-orchestrator/index.ts"
      expected: "no errors"
    - kind: lint
      command_or_query: "grep -c 'anthropic/claude-sonnet-4.6' src/lib/agent/agents/planning-orchestrator/index.ts"
      expected: ">= 1"
  dependsOn: [PLANNING-012, PLANNING-013, PLANNING-014, PLANNING-015]
  estimateMinutes: 30
  touches:
    - src/lib/agent/agents/planning-orchestrator/index.ts

- id: PLANNING-017
  title: Orchestrate API + job worker
  description: |
    POST /api/planning-sessions/:id/orchestrate cria Job row, retorna 202 + jobId. Worker em
    src/lib/jobs/planning-orchestrate.ts roda os 4 subagentes em paralelo (Promise.all com
    timeout 5min cada), invoca Vitor consolidator, salva agentRecommendationsJsonb. Reusa job
    infra existente.
  acceptanceCriteria:
    - "POST retorna 202 com jobId"
    - "Status job=running → done com agentRecommendationsJsonb populado"
    - "Timeout 5min/subagent honra; falha de 1 não derruba os outros"
    - "Polling em GET /api/jobs/:jobId funciona"
  verifiable:
    - kind: http
      command_or_query: "POST /api/planning-sessions/<id>/orchestrate"
      expected: "202 + jobId"
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "no errors"
  dependsOn: [PLANNING-016]
  estimateMinutes: 30
  touches:
    - src/app/api/planning-sessions/[id]/orchestrate/route.ts
    - src/lib/jobs/planning-orchestrate.ts

- id: PLANNING-018
  title: Chat lateral Vitor (what-if)
  description: |
    Reusa connector chat (web) com agentSlug='vitor'. Bloco no system prompt: "Você está em chat
    lateral de PlanningSession. PM pergunta what-if. Responda com consequências concretas
    baseadas no DAG/risk matrix já em agentRecommendationsJsonb. Não modifique nada."
  acceptanceCriteria:
    - "Chat renderiza em side panel do board"
    - "Mensagens persistem em ChatThread com kind='planning-session'"
    - "Vitor responde em <30s pra perguntas simples"
  verifiable:
    - kind: manual_browser
      command_or_query: "Mandar 'se eu mover X pra Phase 2?'"
      expected: "Vitor responde com consequências"
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "no errors"
  dependsOn: [PLANNING-017]
  estimateMinutes: 25
  touches:
    - src/components/planning-session/vitor-chat.tsx
    - src/lib/agent/agents/vitor/planning-mode-prompt.ts
```

### Fase 4 — Re-planning versionado

```yaml
- id: PLANNING-019
  title: Replan endpoint + fork de versão
  description: |
    POST /api/planning-sessions/:id/replan cria nova session (version+1, parentSessionId=current
    approved), duplica phases/PRDs/milestones da current pra nova, status='in-review'.
    Approve nova → trigger faz current.status='superseded'.
  acceptanceCriteria:
    - "Replan retorna newSessionId"
    - "Nova session tem fields duplicados de phases/PRDs/milestones (não compartilha rows)"
    - "parentSessionId aponta correto"
    - "Approve da nova marca anterior como superseded (trigger §7.f roda)"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM \"PlanningSession\" WHERE \"parentSessionId\" IS NOT NULL"
      expected: ">= 1 após replan test"
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "no errors"
  dependsOn: [PLANNING-018]
  estimateMinutes: 30
  touches:
    - src/app/api/planning-sessions/[id]/replan/route.ts
    - src/lib/dal/planning-session.ts

- id: PLANNING-020
  title: UI de histórico de versions
  description: |
    Aba /projects/[id]/planning lista versions na sidebar (v1, v2, v3 com status badge). Click em
    versão mostra read-only view daquela. Botão "Re-plan (v2)" no top right.
  acceptanceCriteria:
    - "Sidebar lista todas versions ordem desc"
    - "Click em versão mostra estado daquela versão"
    - "Botão Re-plan aparece só se há current approved"
  verifiable:
    - kind: manual_browser
      command_or_query: "Ver lista de versions em /projects/[id]/planning"
      expected: "lista visível"
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "no errors"
  dependsOn: [PLANNING-019]
  estimateMinutes: 25
  touches:
    - src/app/(dashboard)/projects/[id]/planning/page.tsx
    - src/components/planning-session/version-sidebar.tsx

- id: PLANNING-021
  title: Diff endpoint + view
  description: |
    GET /api/projects/:id/roadmap/diff?from=1&to=2 retorna {added, removed, moved} a nível de
    PRDs em phases + milestones. UI mostra diff em modal "O que mudou da v1 pra v2?"
  acceptanceCriteria:
    - "Endpoint retorna 3 arrays"
    - "Modal renderiza diff legível (PRD-X moveu de Phase 1 → Phase 2)"
  verifiable:
    - kind: http
      command_or_query: "GET /api/projects/:id/roadmap/diff?from=1&to=2"
      expected: "200 com {added, removed, moved}"
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "no errors"
  dependsOn: [PLANNING-020]
  estimateMinutes: 25
  touches:
    - src/app/api/projects/[id]/roadmap/diff/route.ts
    - src/components/planning-session/diff-modal.tsx

- id: PLANNING-022
  title: Notification cliente em replan
  description: |
    Quando v_N+1 é aprovada, se shareToken da v_N existia, gera notification record em
    NotificationLog (ou usa Slack/email existente) com diff resumido. Não envia email
    automaticamente em v1 — só replans.
  acceptanceCriteria:
    - "Approve de v2+ gera 1 row em NotificationLog (ou equivalent)"
    - "Body inclui resumo do diff"
    - "Não dispara em v1 (primeira approval)"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM \"NotificationLog\" WHERE kind='roadmap-replan'"
      expected: ">= 1 após replan test"
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "no errors"
  dependsOn: [PLANNING-021]
  estimateMinutes: 20
  touches:
    - src/lib/planning-session/notifications.ts
```

### Fase 5 — Share cliente + audit

```yaml
- id: PLANNING-023
  title: Página pública /roadmap/share/[token]
  description: |
    Server component renderizando current roadmap filtrado por audienceType IN ('client',
    'public'). Sem login. Token validado via DB (não JWT) — revogável instantâneo. 404 se token
    revogado ou inválido.
  acceptanceCriteria:
    - "GET /roadmap/share/<valid-token> renderiza phases (audienceType client/public) + milestones (mesmo filtro)"
    - "PRDs nunca aparecem na share view"
    - "Token revogado → 404"
  verifiable:
    - kind: manual_browser
      command_or_query: "Abrir /roadmap/share/<token-gerado-em-test>"
      expected: "página renderiza sem auth"
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "no errors"
  dependsOn: [PLANNING-022]
  estimateMinutes: 30
  touches:
    - src/app/roadmap/share/[token]/page.tsx
    - src/lib/dal/roadmap-share.ts

- id: PLANNING-024
  title: Revoke share token
  description: |
    POST /api/roadmaps/:id/share/revoke seta shareTokenRevokedAt. UI tem botão "Revogar link" no
    detalhe do roadmap (owner only). ConfirmDialog antes.
  acceptanceCriteria:
    - "Revoke seta timestamp"
    - "Páginas /roadmap/share/<revoked> retornam 404"
    - "Owner pode gerar novo token via 'Compartilhar' botão"
  verifiable:
    - kind: http
      command_or_query: "POST /api/roadmaps/<id>/share/revoke"
      expected: "200 ok"
    - kind: sql
      command_or_query: "SELECT \"shareTokenRevokedAt\" IS NOT NULL FROM \"ProjectRoadmap\" WHERE id='<id>'"
      expected: "true após revoke"
  dependsOn: [PLANNING-023]
  estimateMinutes: 20
  touches:
    - src/app/api/roadmaps/[id]/share/revoke/route.ts
    - src/components/planning-session/share-controls.tsx

- id: PLANNING-025
  title: Audit log polido + métricas
  description: |
    View administrativa em /admin/audit/planning-sessions: lista approvals com {who, when,
    sessionId, rationale, diff link}. Métricas §13 expostas em /admin/metrics/planning-sessions.
  acceptanceCriteria:
    - "Página /admin/audit/planning-sessions só admin+"
    - "Lista approvals com facilitatorId + approvedBy"
    - "Métricas §13 (aderência, aceitação, velocidade) renderizadas"
  verifiable:
    - kind: manual_browser
      command_or_query: "Visit /admin/audit/planning-sessions"
      expected: "página renderiza com lista"
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "no errors"
  dependsOn: [PLANNING-024]
  estimateMinutes: 25
  touches:
    - src/app/(admin)/admin/audit/planning-sessions/page.tsx
    - src/app/(admin)/admin/metrics/planning-sessions/page.tsx
```

---

## Resumo de stories — 25 stories, ~640min total (~10.5h)

| Fase | Stories | Total min | Cumulative |
|------|---------|-----------|------------|
| F1 | PLANNING-001..005 (5) | 120 | 120 |
| F2 | PLANNING-006..011 (6) | 165 | 285 |
| F3 | PLANNING-012..018 (7) | 175 | 460 |
| F4 | PLANNING-019..022 (4) | 100 | 560 |
| F5 | PLANNING-023..025 (3) | 75 | 635 |
| **Total** | **25** | **635 min** | **~10.5h** |

Estimativa otimista. Realista com debugging + integração: **6-7 semanas calendário** (~25-30h efetivas spread out).

---

## Auto-checklist (do AGENTS.md)

- [x] §5 tem Decisões fixadas com 16 entradas e zero TBD
- [x] §7 tem DDL completo com RLS, separado em 6 migrations atômicas
- [x] §8 tem todos os endpoints com método + path + contrato
- [x] §11 Fase 1 entrega mais que o sistema atual (manual roadmap > nenhum roadmap)
- [x] §13 cada métrica tem query SQL nomeada
- [x] §14 está com 2 open questions, todas marcadas pra Fase 5
- [x] §16 tem 25 stories, todas com verifiable automatizável, todas ≤ 30min
- [ ] `scripts/ralph/features/planning-session/prd.json` espelhando §16 (próximo passo)

---

**Próximo passo:** gerar `prd.json` espelhando §16; rodar `bash scripts/ralph/intake.sh planning-session` pra promover de `backlog/` pra `ready/`.
