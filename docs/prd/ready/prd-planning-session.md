---
status: draft
owner: João Moraes
date: 2026-05-29
domain: agents / release planning
codenames:
  - planning-session-mvp
  - vitoria-cascade
runtime: volund-web-app  # NÃO Ralph. Ralph apenas BUILDA esta feature.
references:
  - docs/prd/backlog/prd-vitor-output-as-prd.md
  - docs/prd/archive/prd-planning-session-vision-20260529.md
  - .claude/skills/task-gen-story/ (blueprint a portar pra TS server-side)
  - src/lib/agent/agents/vitoria/index.ts
  - src/components/hierarchy-tree/
---

# PRD — PlanningSession + Cascata da Vitoria

> **TL;DR:** Volund precisa transformar **PRDs aprovados** (output do Vitor) em **release plan executável** (Modules + UserStories + Tasks SDD-ready no hierarchy tree). Hoje isso é manual em Notion/Slack — 6-8h de trabalho do PM por release. Este PRD entrega `PlanningSession` (novo módulo web) com um botão **"Gerar plano"** que dispara uma **cascata de 7 stages no servidor Volund** (Node.js + OpenRouter), produzindo: PRDs ordenados em ≤12 sprints + UserStories + Tasks com SDD spec copy-paste-ready. Fatiado em **v1 (PRDs em sprints) → v2 (+ tasks) → v3 (+ SDD polish)**. Ralph builda essa feature; depois ela roda dentro do Volund web app.

---

## 1. Problema

Pipeline atual:

```
Vitor (DS) → PRDs aprovados em docs/prd/ready/
   ↓ (GAP MANUAL)
PM monta release plan manualmente em Notion/Slack
   ↓
PM cria Modules + UserStories + Tasks no Zordon manualmente
   ↓
Builders/Ralph executam tasks
```

O **gap manual** é onde mora 6-8h de trabalho do PM por release. Dores:

1. **Sem ordenação automática.** Ralph pega o próximo PRD em `ready/` alfabético — pode quebrar dependências declaradas em §16.
2. **Tasks desconectadas dos PRDs.** PM cria task no Zordon que perde o "porquê" do PRD. Builders executam sem ground truth de produto.
3. **SDD spec ausente.** Builders (humanos ou AI agents) recebem task com 1 linha de descrição. Sem files/patterns/AC estruturados, qualidade do output cai 50%+.
4. **Sem capacity awareness.** PM chuta quantos sprints o release leva. Não há cálculo baseado em `estimateMinutes` × headcount.

## 2. Solução em uma frase

**Owner clica "Gerar plano" no projeto → Volund server roda cascata de 7 stages (tree-sitter local + 4 subagentes OpenRouter) → produz draft com PRDs ordenados em ≤12 sprints + Modules/UserStories/Tasks SDD-ready persistidos no hierarchy tree existente.**

## 3. Não-objetivos

- **Não** roda no Ralph nem no Claude Code CLI. Cascata é runtime do Volund web app.
- **Não** invoca `.claude/skills/task-gen-story/` — porta a lógica pra TS server-side.
- **Não** suporta multi-projeto, replan v2, share com cliente. v1 cobre 1 PlanningSession por projeto.
- **Não** inclui agent debate (Vitor↔Vitoria) — PRD separado já existe.
- **Não** muda PRDs aprovados. PRD content é input read-only.
- **Não** edita código. Output é spec markdown que builder lê.
- **Não** suporta `>` 12 sprints. Acima = abre nova PlanningSession (out of MVP).
- **Não** automatiza criação de Sprint rows reais (sprint da Vitoria/Planning Ceremony). Cascata sugere allocation; persistir Sprint rows = trabalho de outra feature.

## 4. Personas e jornada

### 4.1 Owner (João)

> "Cliente assinou. Rodei DS Inception com Vitor — saíram 5 PRDs aprovados em `ready/`. Abro `/projects/[id]/planning`, clico "Gerar plano de release". Lateral abre side-sheet pulsando 🟡 com 4 lights: ✅ Indexando codebase → ✅ Auditando PRDs → 🔄 Decomposing stories → ⏳ Polishing tasks. Em ~2min, board mostra 6 sprints com 5 PRDs distribuídos + 15 user stories + 60 tasks copy-paste-ready. Ajusto drag/drop onde discordo. Aprovo. PRDs movem `backlog/→ready/` na ordem. Hierarchy tree do projeto populou com tudo. Cliente vê na demo da próxima semana."

### 4.2 Vitoria (orchestrator strict)

> "Recebo trigger via API. Consulto cache de CodebaseIndex (SHA do git HEAD). Disparo subagentes em paralelo onde posso. Recebo outputs JSON estruturados. NÃO opino — apenas ordeno respeitando DAG + capacity. Devolvo draftRoadmap pra owner aprovar."

### 4.3 Builder (humano ou AI agent)

> "Abro task no Zordon. Vejo `sddSpec` markdown com 7 seções: Context, Type, Files, Patterns, Steps, AC Gherkin, Dependencies. Copio inteiro, colo no Claude Code. Builder executa sem precisar perguntar. Edit final em 30min em vez de 2h."

## 5. Decisões fixadas

| ID | Decisão | Por quê |
|---|---|---|
| **D1** | Cascata 7 stages no Volund server (Next.js Node.js runtime) | Centralizado, monitorável, persiste no Supabase. NÃO Claude Code CLI. |
| **D2** | LLM gateway: OpenRouter (mesmo pattern de Vitor/Alpha) | Zero infra nova. Reusa lib `@openrouter/ai-sdk-provider`. |
| **D3** | Vitoria é orchestrator STRICT (não opina) | Determinístico-ish. Subagentes têm opinion; Vitoria só consolida. |
| **D4** | Tree-sitter via `tree-sitter-wasm` no Node server | Aider-style repo map. ~8k tokens compactos. Lib npm, zero infra externa. |
| **D5** | Cache CodebaseIndex por SHA(git_HEAD) | Re-uso 24h. Invalidado em commit. |
| **D6** | Cache PRDIndex por SHA(prd_files concatenados) | Re-orchestrate só se PRDs mudaram. |
| **D7** | Modelos mistos: haiku-4-5 (estruturado) + sonnet-4.6 (raciocínio) | Custo balanceado. ~$0.30 v1, ~$1.15 v3. |
| **D8** | Default 6 sprints, range 1-12, hard cap 12 | Cobre MVP→release de 3 meses. Acima = nova PlanningSession. |
| **D9** | TaskGen é função TS server-side (porta blueprint da skill `/task-gen-story`) | Mesma lógica, mas roda em runtime do Volund via OpenRouter. NÃO invoca Claude Code CLI. |
| **D10** | Reusa entidades existentes: Module / Persona / UserStory / Task / AC / TaskDependency | Não inventa abstrações. PlanningSession popula tabelas existentes. |
| **D11** | Nova coluna `Task.sddSpec text` pra SDD markdown | Builder copia daí. Renderizado em ResponsiveSheet via `Markdown` component. |
| **D12** | SDD spec markdown segue 7-section fixo: Context / Type / Files / Patterns / Steps / AC / Dependencies | Builder consistency. Spec Kit-style. |
| **D13** | Stage 3 (TaskGen) chama OpenRouter 1× por US em paralelo | Custo previsível, wall-clock baixo. |
| **D14** | Stage 4 (SDD Polish) chama OpenRouter 1× por Task em paralelo | Enriquece task com files/patterns extraídos do CodebaseIndex. |
| **D15** | Approve = transação Postgres atômica | Tudo persiste OU rollback. Sem state intermediário. |
| **D16** | Filesystem PRDs movem `backlog/` → `ready/` na ordem aprovada | Mantém Ralph downstream funcionando. |
| **D17** | Cost cap hard: $3.00 USD por orchestrate | Pré-flight estima. Abort se excede. |
| **D18** | Sem versionamento v1/v2 da PlanningSession (1 por projeto) | MVP. Replan = trabalho futuro. |
| **D19** | Hierarchy tree atual é o destino — UI da PlanningSession é só temporária pra approve | Após approve, owner usa tab "Stories" normal. |
| **D20** | Job system existente (`/api/jobs/`) cobre async | Cascata = job longo. Cliente polla via GET existente. |

## 6. Arquitetura

### 6.1 Diagrama

```
┌─ Volund Web App (Next.js) ─────────────────────────────────────────┐
│                                                                     │
│  Owner UI → POST /api/planning-sessions/[id]/orchestrate             │
│              ↓                                                       │
│  Job worker (Node.js server-side, em src/lib/jobs/)                  │
│              ↓                                                       │
│  runCascade(planningSessionId)                                       │
│  ├─ Stage 0: buildCodebaseIndex (tree-sitter local)                  │
│  ├─        : buildPrdIndex (read filesystem)                         │
│  ├─ Stage 1A: callOpenRouter('claude-sonnet-4.6', CodebaseAuditor)   │
│  ├─ Stage 1B: callOpenRouter('claude-haiku-4-5', DependencyResolver) │
│  ├─ Stage 2: callOpenRouter('claude-sonnet-4.6', StoryDecomposer)    │
│  ├─ Stage 3 (v2): per US → callOpenRouter('sonnet', TaskGen)         │
│  ├─ Stage 4 (v3): per Task → callOpenRouter('sonnet', SDDPolish)     │
│  ├─ Stage 5: callOpenRouter('sonnet', TaskGraphResolver)             │
│  ├─ Stage 6: callOpenRouter('sonnet', CapacityAllocator)             │
│  └─ Stage 7: callOpenRouter('sonnet', VitoriaConsolidator)           │
│              ↓                                                       │
│  Persiste em Supabase:                                               │
│    PlanningSession + PlanningSessionPRD (draft jsonb)                │
│              ↓                                                       │
│  UI polla GET /api/planning-sessions/[id] → renderiza board         │
│              ↓                                                       │
│  Owner drag/drop ajusta → PUT /api/planning-sessions/[id]/prds      │
│              ↓                                                       │
│  Owner clica "Aprovar" → POST /api/planning-sessions/[id]/approve   │
│              ↓                                                       │
│  Transação Postgres:                                                 │
│    ├─ Cria Module rows (greenfield)                                  │
│    ├─ Cria UserStory rows (FK PRD)                                   │
│    ├─ Cria Task rows (FK US, com sddSpec)                            │
│    ├─ Cria AcceptanceCriterion rows                                  │
│    ├─ Cria TaskDependency rows                                       │
│    └─ Marca PlanningSession.status='approved'                        │
│              ↓                                                       │
│  Filesystem move: PRDs vão de backlog/ → ready/ na ordem             │
│              ↓                                                       │
│  Hierarchy tree populado. Ralph downstream pega ordem certa.        │
└─────────────────────────────────────────────────────────────────────┘

NOTA: Ralph NÃO participa do runtime. Ralph apenas BUILDA esta feature.
      Após PR mergeado, Ralph some do fluxo. Volund web app + OpenRouter
      cuidam de tudo em produção.
```

### 6.2 Componentes (todos rodam dentro do Volund Next.js)

| Componente | Onde | Tipo |
|---|---|---|
| `runCascade(sessionId)` | `src/lib/agent/planning/cascade.ts` | TS fn server-side |
| `buildCodebaseIndex(repoRoot)` | `src/lib/agent/planning/codebase-index.ts` | TS fn (tree-sitter-wasm) |
| `buildPrdIndex(prdDir)` | `src/lib/agent/planning/prd-index.ts` | TS fn (fs.readdir + frontmatter parse) |
| `CodebaseAuditorAgent` | `src/lib/agent/planning/subagents/codebase-auditor.ts` | Função que chama OpenRouter |
| `DependencyResolverAgent` | `src/lib/agent/planning/subagents/dep-resolver.ts` | Idem |
| `StoryDecomposerAgent` | `src/lib/agent/planning/subagents/story-decomposer.ts` | Idem |
| `TaskGenAgent` (v2) | `src/lib/agent/planning/subagents/task-gen.ts` | Idem — porta da skill `/task-gen-story` |
| `SDDPolishAgent` (v3) | `src/lib/agent/planning/subagents/sdd-polish.ts` | Idem |
| `CapacityAllocatorAgent` | `src/lib/agent/planning/subagents/capacity.ts` | Idem |
| `VitoriaConsolidator` | `src/lib/agent/planning/subagents/consolidator.ts` | Idem |
| Job runner | `src/lib/jobs/planning-orchestrate-job.ts` | Reusa job system existente |
| API routes | `src/app/api/planning-sessions/...` | Next.js |
| Board UI | `src/components/planning-session/board.tsx` | React |
| DAL | `src/lib/dal/planning-session.ts` | TS DAL |

## 7. Schema (DDL atômico)

### Migration 1: `supabase/migrations/20260601a_planning_session.sql`

```sql
CREATE TABLE "PlanningSession" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId" uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'orchestrating', 'in-review', 'approved', 'aborted', 'error'
  )),
  title text NOT NULL,
  "facilitatorId" uuid REFERENCES "Member"(id),
  "sprintCount" int NOT NULL DEFAULT 6 CHECK ("sprintCount" >= 1 AND "sprintCount" <= 12),
  "codebaseIndexSha" text,
  "prdIndexSha" text,
  "draftRoadmapJsonb" jsonb,
  "agentOutputsJsonb" jsonb,
  "orchestrateJobId" uuid,
  "tokensUsed" int NOT NULL DEFAULT 0,
  "costUsd" numeric(10,4) NOT NULL DEFAULT 0,
  "errorMessage" text,
  "approvedAt" timestamptz,
  "approvedBy" uuid REFERENCES "Member"(id),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT one_active_planning_per_project EXCLUDE USING gist (
    "projectId" WITH =
  ) WHERE (status IN ('draft', 'orchestrating', 'in-review'))
);

CREATE INDEX idx_planning_session_project ON "PlanningSession"("projectId", "createdAt" DESC);
CREATE INDEX idx_planning_session_status ON "PlanningSession"("projectId", status) WHERE status IN ('approved', 'in-review');

ALTER TABLE "PlanningSession" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planning_session_read" ON "PlanningSession" FOR SELECT USING (can_view_project("projectId"));
CREATE POLICY "planning_session_insert" ON "PlanningSession" FOR INSERT WITH CHECK (can_lead_project("projectId"));
CREATE POLICY "planning_session_update" ON "PlanningSession" FOR UPDATE USING (can_lead_project("projectId"));

CREATE TRIGGER set_planning_session_updated_at
  BEFORE UPDATE ON "PlanningSession"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

### Migration 2: `supabase/migrations/20260601b_planning_session_prd.sql`

```sql
CREATE TABLE "PlanningSessionPRD" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "planningSessionId" uuid NOT NULL REFERENCES "PlanningSession"(id) ON DELETE CASCADE,
  "prdSlug" text NOT NULL,
  "sprintStart" int NOT NULL CHECK ("sprintStart" >= 1 AND "sprintStart" <= 12),
  "sprintCount" int NOT NULL DEFAULT 1 CHECK ("sprintCount" >= 1 AND "sprintCount" <= 6),
  "order" int NOT NULL,
  "assignedSquadId" uuid REFERENCES "Squad"(id),
  "agentJustification" text,
  "ownerOverride" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("planningSessionId", "prdSlug"),
  UNIQUE ("planningSessionId", "sprintStart", "order")
);

CREATE INDEX idx_planning_session_prd_session ON "PlanningSessionPRD"("planningSessionId", "sprintStart", "order");

ALTER TABLE "PlanningSessionPRD" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planning_session_prd_read" ON "PlanningSessionPRD" FOR SELECT USING (EXISTS (
  SELECT 1 FROM "PlanningSession" s WHERE s.id = "PlanningSessionPRD"."planningSessionId" AND can_view_project(s."projectId")
));

CREATE POLICY "planning_session_prd_write" ON "PlanningSessionPRD" FOR ALL
  USING (EXISTS (SELECT 1 FROM "PlanningSession" s WHERE s.id = "PlanningSessionPRD"."planningSessionId" AND can_lead_project(s."projectId")))
  WITH CHECK (EXISTS (SELECT 1 FROM "PlanningSession" s WHERE s.id = "PlanningSessionPRD"."planningSessionId" AND can_lead_project(s."projectId")));
```

### Migration 3 (v3): `supabase/migrations/20260601c_task_sdd_spec.sql`

```sql
-- Adiciona coluna sddSpec na Task existente. Apenas v3 precisa.
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "sddSpec" text;
CREATE INDEX idx_task_sdd_spec_not_null ON "Task"("id") WHERE "sddSpec" IS NOT NULL;
```

## 8. APIs

| Método | Path | Contrato | Notas |
|---|---|---|---|
| POST | `/api/planning-sessions` | `{ projectId, title, sprintCount? }` → `201 { sessionId }` | Cria draft. Manager+. |
| POST | `/api/planning-sessions/:id/orchestrate` | `{ targetVersion?: 'v1'|'v2'|'v3' }` → `202 { jobId }` | Dispara cascata async. Default `v1`. |
| GET | `/api/planning-sessions/:id` | → `{ session, prds[], status, jobStatus }` | Hidrata board |
| PUT | `/api/planning-sessions/:id/prds/:prdId` | `{ sprintStart, sprintCount, order, ownerOverride? }` | Drag/drop update |
| POST | `/api/planning-sessions/:id/approve` | `{}` → `{ ok, hierarchyTreeUpdated: true }` | Transação atômica, move PRDs filesystem |
| POST | `/api/planning-sessions/:id/abort` | `{}` → `{ status: 'aborted' }` | Owner cancela |
| GET | `/api/jobs/:jobId` | (já existe) | Polling do cascade job |

## 9. UX

### 9.1 Página `/projects/[id]/planning`

```
┌── /projects/[id]/planning ────────────────────────────────┐
│ Planning Session — Project Acme                            │
│ Status: draft · 0 PRDs em ready/ · 5 em backlog/          │
│                                                            │
│ Sprints: [6 ▼]  (1-12)                                    │
│                                                            │
│  ┌────────────────────────────────────────────────────┐   │
│  │  🪄 Gerar plano de release                          │   │
│  │  Custo estimado: ~$0.30 (v1) · ~2min                │   │
│  └────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

### 9.2 Side-sheet durante cascade (pulse)

```
┌── 🟡 Gerando plano... ──────────────────────────────┐
│ Job: cascade-abc123                                  │
│                                                      │
│ Stage 0 Indexing codebase    ✅ 2s                  │
│ Stage 1 CodebaseAuditor      ✅ 8s                  │
│ Stage 1 DependencyResolver   ✅ 4s                  │
│ Stage 2 Story decomposition  🔄 in-flight            │
│ Stage 5 Task graph           ⏳ pending              │
│ Stage 6 Capacity             ⏳ pending              │
│ Stage 7 Vitoria consolidator ⏳ pending              │
│                                                      │
│ $0.12 / $3.00 · 4.2k/30k tokens                      │
│                                                      │
│ [⏹ Cancelar]                                         │
└──────────────────────────────────────────────────────┘
```

### 9.3 Board após cascade (status='in-review')

```
┌── Board: 6 sprints ──────────────────────────────────────────────┐
│ Sprint 1   Sprint 2   Sprint 3   Sprint 4   Sprint 5   Sprint 6  │
│ ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐    │
│ │ AUTH │  │ AUTH │  │ WIKI │  │ WIKI │  │ BILL │  │      │    │
│ │ (2sp)│  │ (2sp)│  │ (2sp)│  │ (2sp)│  │ (1sp)│  │      │    │
│ └──────┘  └──────┘  └──────┘  └──────┘  └──────┘  └──────┘    │
│ ┌──────┐                                                        │
│ │ ONBD │                                                        │
│ │ (1sp)│                                                        │
│ └──────┘                                                        │
│                                                                  │
│ Backlog: 0 PRDs unassigned                                      │
│                                                                  │
│ [Aprovar e mover PRDs] [Pivotar] [Re-orchestrate]              │
└──────────────────────────────────────────────────────────────────┘
```

### 9.4 Task detail sheet com SDD (v3)

```
┌── Task: TASK-AUTH-001 Migration users table ──────┐
│ Type: backend · Scope: medium · Sprint: 1          │
│                                                    │
│ ## Context                                         │
│ PRD: EVZL-PRD-001 (Login)                          │
│ User Story: US-002 "Login via email"               │
│ Module: auth (greenfield)                          │
│                                                    │
│ ## Files to touch                                  │
│ - supabase/migrations/20260615_users.sql           │
│ - src/lib/dal/users.ts                             │
│                                                    │
│ ## Patterns to follow                              │
│ - DAL: src/lib/dal/projects.ts:43                  │
│ - Migration: 20260530c_product_requirement.sql     │
│                                                    │
│ [...]                                              │
│                                                    │
│ [📋 Copiar SDD spec inteiro]                       │
└────────────────────────────────────────────────────┘
```

## 10. Integrações

| Sistema | Como integra |
|---|---|
| **Vitor (DS agent)** | Upstream — produz PRDs em `docs/prd/{state}/`. PlanningSession consome read-only. |
| **Hierarchy tree** | Destino final — populado via approve transaction. `src/components/hierarchy-tree/` renderiza. |
| **Ralph (dev-time)** | NÃO toca runtime. Apenas builda esta feature. Após PR, Ralph consome PRDs em `ready/` (já ordenados pela PlanningSession). |
| **OpenRouter** | LLM gateway (já configurado). Cada Stage faz 1+ chamadas. |
| **Tree-sitter** | Lib npm rodando em Node server pra parse TS/TSX → AST. |
| **Skill `/task-gen-story`** | Blueprint (dev-time). Lógica portada pra `src/lib/agent/planning/subagents/task-gen.ts`. |
| **Vitoria agent existente** | NÃO modificado em v1. Cascata é módulo novo `planning/`. Vitoria poderá chamar como tool em v2+ (out of scope). |
| **AgentUsage telemetry** | Cada chamada OpenRouter registra row com `agentSlug=planning-<stage>`. |
| **Calibration** (`/calibrate`) | Cada subagent vira target — capture/fix loop pós-ship. |

## 11. Faseamento

### v1 — PRDs ordenados em sprints (sem tasks)

**Entrega:** Owner clica botão, em ~30s vê board com PRDs distribuídos em ≤12 sprints respeitando deps + capacity. Aprova → PRDs movem `backlog/`→`ready/` na ordem.

**Stages incluídos:** 0, 1A, 1B, 2 (só extract user stories básicas, persistidas como rascunho), 5, 6, 7.

**Valor:** PM economiza ~3-4h vs planejamento manual. Audit trail. Ralph downstream funciona com ordem certa.

**Stories:** 10 (PLAN-001 a PLAN-010)

### v2 — Tasks geradas via server-side TaskGen

**Entrega:** Approve adicional cria UserStory + Task rows no hierarchy tree, geradas por TaskGen agent (port da skill `/task-gen-story`).

**Stages:** + Stage 3.

**Valor:** Hierarchy tree popula automaticamente. Builder vê tasks no projeto sem intervenção do PM.

**Stories:** 2 (PLAN-011, PLAN-012)

### v3 — SDD spec markdown copy-paste-ready

**Entrega:** Cada Task ganha campo `sddSpec` markdown 7-section. UI mostra botão "Copiar SDD spec inteiro".

**Stages:** + Stage 4.

**Valor:** Builder copy-paste pra Claude Code / Cursor → executa sem perguntar.

**Stories:** 2 (PLAN-013, PLAN-014)

## 12. Riscos

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| Cascade falha mid-flight (1 stage trava) | Média | Alto | Job retry 1× automático. Status='error' + errorMessage visível. Owner re-orchestrate. |
| Cost explode em projeto grande (>20 PRDs) | Média | Médio | Cost cap $3.00 hard (D17). Pre-flight estima. Abort se excede. |
| LLM alucina filePaths em SDD spec | Alta | Médio | SDDPolish exige refs verificáveis (file existe no CodebaseIndex). Calibration loop pega regressões. |
| Tree-sitter parse falha em arquivo TSX edge case | Baixa | Baixo | Try/catch por arquivo. Skip + warning. Index parcial é OK. |
| Quality dos tasks baixa primeira run (precisa rewrite) | Alta | Médio | Documentar como "draft" no UI. Owner sabe que vai precisar revisar. Calibration 2-3 semanas. |
| Concurrent orchestrate em mesma session | Baixa | Médio | EXCLUDE constraint no DB (one_active_planning_per_project) bloqueia. |
| Aprovação mid-transaction fails | Baixa | Alto | Transação Postgres atômica. Rollback completo se qualquer step fail. |
| Ralph builda v1 mas v2/v3 fica metade | Média | Baixo | Cada v entrega valor sozinha. v1 já é ganho. |

## 13. Métricas de sucesso

| Métrica | Instrumento | Target v1 |
|---|---|---|
| Tempo de geração de plano | `SELECT avg(EXTRACT(EPOCH FROM ("approvedAt" - "createdAt"))) FROM "PlanningSession" WHERE status='approved'` | ≤180s (3min) |
| Custo médio por orchestrate | `SELECT avg("costUsd") FROM "PlanningSession" WHERE status IN ('approved','aborted')` | ≤$0.50 (v1), ≤$1.50 (v3) |
| Taxa de aceite do draft (sem override) | `SELECT count(*) FILTER (WHERE "ownerOverride" IS NULL)::float / count(*) FROM "PlanningSessionPRD"` | ≥60% |
| PRDs ordenados sem dep violation | Query custom checando DAG vs ordem | 100% (CHECK hard) |
| Tasks copy-paste sem edit (v3) | Evento `task_sdd_spec_copied_no_edit` em telemetry | ≥40% |
| Bugs calibration nos primeiros 30 dias | `SELECT count(*) FROM "AgentCalibrationCapture" WHERE agentSlug LIKE 'planning-%' AND createdAt > deploy_date` | <20 |

## 14. Open questions

(vazio — todas resolvidas em §5)

## 15. Referências

- [.claude/skills/task-gen-story/SKILL.md](../../../.claude/skills/task-gen-story/SKILL.md) — blueprint a portar
- [src/lib/agent/agents/vitoria/index.ts](../../../src/lib/agent/agents/vitoria/index.ts) — pattern OpenRouter
- [src/components/hierarchy-tree/](../../../src/components/hierarchy-tree/) — destino final
- [docs/prd/archive/prd-planning-session-vision-20260529.md](../archive/prd-planning-session-vision-20260529.md) — visão original (replan, share, etc.)
- [docs/prd/backlog/prd-vitor-output-as-prd.md](prd-vitor-output-as-prd.md) — upstream do pipeline
- Spec Kit format (GitHub): https://github.com/github/spec-kit — referência SDD

## 16. Stories implementáveis

```yaml
# ─── v1 — PRDs ordenados em sprints ───────────────────────────────

- id: PLAN-001
  title: Migrations PlanningSession + PlanningSessionPRD (schema + RLS)
  description: |
    Criar supabase/migrations/20260601a_planning_session.sql e
    20260601b_planning_session_prd.sql conforme §7. Inclui CHECK constraints,
    RLS, indexes, EXCLUDE constraint one-active-per-project, trigger updatedAt.
    Rodar via psql $DIRECT_URL.
  acceptanceCriteria:
    - "2 arquivos migration em supabase/migrations/ criados"
    - "psql roda sem erro"
    - "Tabelas PlanningSession e PlanningSessionPRD existem com RLS"
    - "EXCLUDE constraint bloqueia 2 sessions ativas mesmo projeto"
  verifiable:
    - kind: sql
      command_or_query: "ls supabase/migrations/20260601a_planning_session.sql supabase/migrations/20260601b_planning_session_prd.sql 2>&1 | grep -c 'planning'"
      expected: "2"
    - kind: sql
      command_or_query: "psql \"$DIRECT_URL\" -tAc \"SELECT count(*) FROM pg_tables WHERE tablename IN ('PlanningSession','PlanningSessionPRD');\""
      expected: "2"
  dependsOn: []
  estimateMinutes: 25
  touches:
    - supabase/migrations/20260601a_planning_session.sql
    - supabase/migrations/20260601b_planning_session_prd.sql

- id: PLAN-002
  title: database.types.ts regen + DAL planning-session (CRUD básico)
  description: |
    Atualizar src/lib/supabase/database.types.ts. Criar src/lib/dal/planning-session.ts
    com: createSession, getSession (com prds inline), listForProject, updateStatus,
    updatePrdAssignment, listPrds. Tudo respeitando RLS.
  acceptanceCriteria:
    - "database.types.ts contém PlanningSession e PlanningSessionPRD"
    - "DAL exporta 6 fns"
    - "tsc passes"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "grep -cE 'PlanningSession|PlanningSessionPRD' src/lib/supabase/database.types.ts"
      expected: ">=2"
    - kind: sql
      command_or_query: "grep -cE 'export (async )?function (createSession|getSession|listForProject|updateStatus|updatePrdAssignment|listPrds)' src/lib/dal/planning-session.ts"
      expected: "6"
  dependsOn: [PLAN-001]
  estimateMinutes: 25
  touches:
    - src/lib/supabase/database.types.ts
    - src/lib/dal/planning-session.ts

- id: PLAN-003
  title: buildCodebaseIndex via tree-sitter-wasm + cache por SHA
  description: |
    Adicionar dep tree-sitter-wasm + tree-sitter-typescript (npm). Criar
    src/lib/agent/planning/codebase-index.ts com fn buildCodebaseIndex(repoRoot):
    - Walk src/**/*.{ts,tsx}
    - Parse com tree-sitter, extrai: exports (function/const/class), interface names,
      DB tables de migrations (regex CREATE TABLE), API routes (filesystem-based)
    - Output JSON estruturado {files: [{path, exports, ...}], dbTables, apiRoutes}
    - Cache em /tmp/volund-codebase-index/<sha>.json (SHA = git rev-parse HEAD)
    - Re-uso se cache hit; rebuild se SHA novo
  acceptanceCriteria:
    - "Arquivo src/lib/agent/planning/codebase-index.ts existe"
    - "Função buildCodebaseIndex retorna objeto com files/dbTables/apiRoutes"
    - "Cache hit em segunda chamada (mesmo SHA)"
    - "tsc passes"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "test -f src/lib/agent/planning/codebase-index.ts && echo ok"
      expected: "ok"
    - kind: sql
      command_or_query: "grep -cE 'tree-sitter' package.json"
      expected: ">=1"
  dependsOn: []
  estimateMinutes: 30
  touches:
    - src/lib/agent/planning/codebase-index.ts
    - package.json

- id: PLAN-004
  title: buildPrdIndex (parse frontmatter + extract §1-§3 + §16 metadata)
  description: |
    src/lib/agent/planning/prd-index.ts:
    - Ler docs/prd/{backlog,ready}/prd-*.md
    - Parse YAML frontmatter (gray-matter ou js-yaml)
    - Extrair: slug, title, oneLiner (de §2), problemSummary (1ª linha de §1),
      dependsOn (de §16 yaml), estimateMinutesTotal (sum de §16), personaIds,
      riskLevel (max de §12)
    - Cache por SHA(prd_files concat) em /tmp/volund-prd-index/
    - Output array de PrdIndexEntry
  acceptanceCriteria:
    - "Arquivo src/lib/agent/planning/prd-index.ts existe"
    - "Função buildPrdIndex retorna array de PrdIndexEntry"
    - "Cache hit em segunda chamada"
    - "tsc passes"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "test -f src/lib/agent/planning/prd-index.ts && echo ok"
      expected: "ok"
    - kind: sql
      command_or_query: "grep -cE 'export (async )?function buildPrdIndex' src/lib/agent/planning/prd-index.ts"
      expected: ">=1"
  dependsOn: []
  estimateMinutes: 25
  touches:
    - src/lib/agent/planning/prd-index.ts

- id: PLAN-005
  title: Subagents CodebaseAuditor + DependencyResolver (OpenRouter calls)
  description: |
    src/lib/agent/planning/subagents/codebase-auditor.ts:
    - Function callCodebaseAuditor(prdIndex, codebaseIndex) → callOpenRouter
      claude-sonnet-4.6 com prompt rigoroso + Zod schema AuditorOutput
      { perPRD: [{prdSlug, classification: 'greenfield'|'brownfield', affectedFiles[],
        existingPatterns[], gapAnalysis }] }
    src/lib/agent/planning/subagents/dep-resolver.ts:
    - Function callDependencyResolver(prdIndex) → claude-haiku-4-5 + Zod schema
      DAGOutput { nodes[], edges[], criticalPath[] }
    Ambos usam mesmo pattern de OpenRouter via @openrouter/ai-sdk-provider já em uso.
  acceptanceCriteria:
    - "2 arquivos subagent em src/lib/agent/planning/subagents/ existem"
    - "Cada exporta uma fn de call + Zod schema de output"
    - "Modelos corretos: sonnet (auditor), haiku (dep)"
    - "tsc passes"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "ls src/lib/agent/planning/subagents/codebase-auditor.ts src/lib/agent/planning/subagents/dep-resolver.ts 2>&1 | grep -c subagents"
      expected: "2"
    - kind: sql
      command_or_query: "grep -cE 'claude-sonnet|sonnet' src/lib/agent/planning/subagents/codebase-auditor.ts"
      expected: ">=1"
    - kind: sql
      command_or_query: "grep -cE 'claude-haiku|haiku' src/lib/agent/planning/subagents/dep-resolver.ts"
      expected: ">=1"
  dependsOn: [PLAN-003, PLAN-004]
  estimateMinutes: 30
  touches:
    - src/lib/agent/planning/subagents/codebase-auditor.ts
    - src/lib/agent/planning/subagents/dep-resolver.ts

- id: PLAN-006
  title: Subagents StoryDecomposer + CapacityAllocator + VitoriaConsolidator
  description: |
    3 subagents OpenRouter (sonnet) em src/lib/agent/planning/subagents/:
    - story-decomposer.ts: per PRD extrai UserStories matched a personas/modules existentes
    - capacity.ts: aloca PRD → sprintStart/sprintCount respeitando estimateMinutes + headcount
    - consolidator.ts: Vitoria strict — recebe outputs anteriores, produz draftRoadmap final
    Cada um com Zod schema de output. Pattern consistente.
  acceptanceCriteria:
    - "3 arquivos subagent criados"
    - "Cada exporta fn + Zod schema"
    - "Consolidator é strict (sem opinião, só ordena)"
    - "tsc passes"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "ls src/lib/agent/planning/subagents/story-decomposer.ts src/lib/agent/planning/subagents/capacity.ts src/lib/agent/planning/subagents/consolidator.ts 2>&1 | grep -c .ts"
      expected: "3"
  dependsOn: [PLAN-005]
  estimateMinutes: 30
  touches:
    - src/lib/agent/planning/subagents/story-decomposer.ts
    - src/lib/agent/planning/subagents/capacity.ts
    - src/lib/agent/planning/subagents/consolidator.ts

- id: PLAN-007
  title: runCascade orchestrator + job runner + cost cap
  description: |
    src/lib/agent/planning/cascade.ts: fn runCascade(sessionId, targetVersion='v1')
    - Stage 0 (build indexes — cache hits comuns)
    - Stage 1A+1B paralelos (Promise.all)
    - Stage 2 sequencial
    - Stage 5+6+7 sequenciais
    - Cost pre-flight (estima tokens), abort se >$3.00
    - Persiste agentOutputsJsonb a cada stage (recovery)
    - Atualiza tokensUsed/costUsd na PlanningSession
    src/lib/jobs/planning-orchestrate-job.ts: job worker que invoca runCascade
    e atualiza job status no sistema existente.
  acceptanceCriteria:
    - "Arquivo cascade.ts exporta runCascade"
    - "Arquivo planning-orchestrate-job.ts registrado no dispatcher"
    - "Cost cap implementado pre-flight"
    - "tsc passes"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "test -f src/lib/agent/planning/cascade.ts && test -f src/lib/jobs/planning-orchestrate-job.ts && echo ok"
      expected: "ok"
    - kind: sql
      command_or_query: "grep -cE 'export (async )?function runCascade' src/lib/agent/planning/cascade.ts"
      expected: ">=1"
  dependsOn: [PLAN-006]
  estimateMinutes: 30
  touches:
    - src/lib/agent/planning/cascade.ts
    - src/lib/jobs/planning-orchestrate-job.ts

- id: PLAN-008
  title: API routes (POST create, orchestrate, GET, PUT prds, POST abort)
  description: |
    Routes em src/app/api/planning-sessions/:
    - route.ts: POST cria session + GET list por ?projectId
    - [id]/route.ts: GET hidrata session + prds + jobStatus
    - [id]/orchestrate/route.ts: POST → 202 { jobId } dispara cascade
    - [id]/prds/[prdId]/route.ts: PUT drag/drop update (sprintStart/order/ownerOverride)
    - [id]/abort/route.ts: POST status='aborted'
    Validation Zod. Auth via proxy.ts existente.
  acceptanceCriteria:
    - "5 arquivos route.ts em src/app/api/planning-sessions/"
    - "POST /api/planning-sessions retorna 201 com sessionId"
    - "POST /:id/orchestrate retorna 202 com jobId"
    - "tsc passes"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "find src/app/api/planning-sessions -name 'route.ts' | wc -l | tr -d ' '"
      expected: ">=5"
  dependsOn: [PLAN-007]
  estimateMinutes: 30
  touches:
    - src/app/api/planning-sessions/route.ts
    - src/app/api/planning-sessions/[id]/route.ts
    - src/app/api/planning-sessions/[id]/orchestrate/route.ts
    - src/app/api/planning-sessions/[id]/prds/[prdId]/route.ts
    - src/app/api/planning-sessions/[id]/abort/route.ts

- id: PLAN-009
  title: UI Board com sprint columns + drag/drop optimistic
  description: |
    src/components/planning-session/board.tsx: board reutilizando primitives de
    src/components/design-session/board/. N colunas baseado em sprintCount.
    Cards de PRD posicionados conforme draftRoadmap. Drag/drop via
    useOptimisticCollection — mover PRD entre sprints persiste via PUT.
    src/app/(dashboard)/projects/[id]/planning/page.tsx: página renderiza board
    + side-sheet pulsante de progress quando job in-flight.
  acceptanceCriteria:
    - "src/components/planning-session/board.tsx existe e usa BoardColumn"
    - "src/app/(dashboard)/projects/[id]/planning/page.tsx existe"
    - "Drag/drop usa useOptimisticCollection (não setState direto)"
    - "tsc passes"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "test -f src/components/planning-session/board.tsx && test -f 'src/app/(dashboard)/projects/[id]/planning/page.tsx' && echo ok"
      expected: "ok"
    - kind: sql
      command_or_query: "grep -cE 'useOptimisticCollection' src/components/planning-session/board.tsx"
      expected: ">=1"
  dependsOn: [PLAN-008]
  estimateMinutes: 30
  touches:
    - src/components/planning-session/board.tsx
    - src/app/(dashboard)/projects/[id]/planning/page.tsx

- id: PLAN-010
  title: Approve flow (transação atômica + filesystem move backlog→ready)
  description: |
    src/app/api/planning-sessions/[id]/approve/route.ts: POST handler que:
    - Valida session.status='in-review'
    - Inicia transação Postgres:
      - Update session.status='approved' + approvedAt + approvedBy
      - (v1) Apenas atualiza PlanningSessionPRD (sem criar UserStory/Task ainda)
    - Após commit DB, executa filesystem move via fs.rename:
      - Pra cada PRD em order, move docs/prd/backlog/<slug>.md → docs/prd/ready/
    - Atomicidade: se filesystem move falha, log warning (DB já committed, manual fix)
    UI: ConfirmDialog antes de chamar approve.
  acceptanceCriteria:
    - "Route src/app/api/planning-sessions/[id]/approve/route.ts existe"
    - "Transação Postgres em block try/catch com rollback"
    - "Filesystem move executado após commit DB"
    - "ConfirmDialog na UI antes do POST"
    - "tsc passes"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "test -f 'src/app/api/planning-sessions/[id]/approve/route.ts' && echo ok"
      expected: "ok"
    - kind: sql
      command_or_query: "grep -cE 'fs\\.(rename|promises\\.rename)' 'src/app/api/planning-sessions/[id]/approve/route.ts'"
      expected: ">=1"
  dependsOn: [PLAN-009]
  estimateMinutes: 30
  touches:
    - src/app/api/planning-sessions/[id]/approve/route.ts
    - src/components/planning-session/approve-dialog.tsx

# ─── v2 — Tasks geradas via server-side TaskGen ──────────────────

- id: PLAN-011
  title: TaskGen server-side function (porta blueprint de /task-gen-story)
  description: |
    src/lib/agent/planning/subagents/task-gen.ts: fn callTaskGen(userStory,
    codebaseAuditorOutput) → OpenRouter sonnet com prompt portado de
    .claude/skills/task-gen-story/SKILL.md. Output Zod schema TaskGenOutput
    { tasks: [{title, type: backend|frontend|integration|test|migration,
    scope, complexity, acceptanceCriteria[] (Gherkin), filesEstimate[]}] }.
    Reusar lógica do skill mas executando server-side com OpenRouter.
  acceptanceCriteria:
    - "Arquivo task-gen.ts existe em planning/subagents/"
    - "Função callTaskGen retorna Promise<TaskGenOutput>"
    - "Prompt referencia padrões do skill .claude/skills/task-gen-story/"
    - "tsc passes"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "test -f src/lib/agent/planning/subagents/task-gen.ts && echo ok"
      expected: "ok"
    - kind: sql
      command_or_query: "grep -cE 'task-gen-story|TaskGen' src/lib/agent/planning/subagents/task-gen.ts"
      expected: ">=1"
  dependsOn: [PLAN-007]
  estimateMinutes: 30
  touches:
    - src/lib/agent/planning/subagents/task-gen.ts

- id: PLAN-012
  title: Stage 3 integration + approve persiste UserStory/Task/AC/TaskDependency
  description: |
    Estender runCascade pra incluir Stage 3 quando targetVersion='v2' ou 'v3':
    - Per US extraída em Stage 2, callTaskGen em paralelo (Promise.all)
    - Output salvo em agentOutputsJsonb
    Estender approve route pra (quando v2+):
    - Criar Module rows greenfield
    - Criar UserStory rows com FK PRD
    - Criar Task rows com FK US (sddSpec NULL ainda em v2)
    - Criar AcceptanceCriterion rows
    - Criar TaskDependency rows do DAG
    Tudo dentro da transação atômica existente.
  acceptanceCriteria:
    - "Cascade Stage 3 implementado em cascade.ts quando v2+"
    - "Approve route cria rows em Module/UserStory/Task/AC/TaskDependency"
    - "Transação atômica preservada"
    - "tsc passes"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "grep -cE 'callTaskGen' src/lib/agent/planning/cascade.ts"
      expected: ">=1"
    - kind: sql
      command_or_query: "grep -cE 'UserStory|Task|AcceptanceCriterion' 'src/app/api/planning-sessions/[id]/approve/route.ts'"
      expected: ">=3"
  dependsOn: [PLAN-010, PLAN-011]
  estimateMinutes: 30
  touches:
    - src/lib/agent/planning/cascade.ts
    - src/app/api/planning-sessions/[id]/approve/route.ts

# ─── v3 — SDD spec markdown copy-paste-ready ─────────────────────

- id: PLAN-013
  title: Migration Task.sddSpec column
  description: |
    supabase/migrations/20260601c_task_sdd_spec.sql: ALTER TABLE Task ADD COLUMN
    sddSpec text. Index opcional WHERE sddSpec IS NOT NULL. Rodar via psql.
    Regenerar database.types.ts.
  acceptanceCriteria:
    - "Migration 20260601c_task_sdd_spec.sql existe"
    - "psql roda sem erro"
    - "Column Task.sddSpec existe"
    - "database.types.ts atualizado"
    - "tsc passes"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "test -f supabase/migrations/20260601c_task_sdd_spec.sql && echo ok"
      expected: "ok"
    - kind: sql
      command_or_query: "psql \"$DIRECT_URL\" -tAc \"SELECT count(*) FROM information_schema.columns WHERE table_name='Task' AND column_name='sddSpec';\""
      expected: "1"
  dependsOn: [PLAN-012]
  estimateMinutes: 15
  touches:
    - supabase/migrations/20260601c_task_sdd_spec.sql
    - src/lib/supabase/database.types.ts

- id: PLAN-014
  title: SDDPolish subagent + Stage 4 integration + UI render markdown + copy button
  description: |
    src/lib/agent/planning/subagents/sdd-polish.ts: fn callSDDPolish(task,
    codebaseAuditorOutput) → OpenRouter sonnet, output Zod
    { sddSpec: string } onde sddSpec é markdown 7-section (Context / Type /
    Files / Patterns / Steps / AC Gherkin / Dependencies).
    Estender runCascade pra Stage 4 quando targetVersion='v3'.
    Estender approve route pra salvar Task.sddSpec.
    UI: src/components/hierarchy-tree/task-row.tsx ganha botão "📋 Copiar SDD"
    quando task.sddSpec presente. Detail sheet renderiza via Markdown component
    existente.
  acceptanceCriteria:
    - "Arquivo sdd-polish.ts existe"
    - "Stage 4 incluído em cascade.ts quando v3"
    - "Botão 'Copiar SDD' em task-row.tsx quando sddSpec presente"
    - "tsc passes"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "test -f src/lib/agent/planning/subagents/sdd-polish.ts && echo ok"
      expected: "ok"
    - kind: sql
      command_or_query: "grep -cE 'sddSpec|SDD' src/components/hierarchy-tree/task-row.tsx"
      expected: ">=1"
    - kind: sql
      command_or_query: "grep -cE 'callSDDPolish' src/lib/agent/planning/cascade.ts"
      expected: ">=1"
  dependsOn: [PLAN-013]
  estimateMinutes: 30
  touches:
    - src/lib/agent/planning/subagents/sdd-polish.ts
    - src/lib/agent/planning/cascade.ts
    - src/app/api/planning-sessions/[id]/approve/route.ts
    - src/components/hierarchy-tree/task-row.tsx
```

Total: 14 stories, 395min (~6h30) estimado. v1 = 10 stories (~5h), v2 = 2 stories (~1h), v3 = 2 stories (~45min).
