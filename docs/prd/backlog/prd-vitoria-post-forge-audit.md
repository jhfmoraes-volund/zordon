# PRD — Vitoria Post-Forge Audit (gap detection + Task/Sprint delegation)

> Status: `backlog` · Owner: João · Created: 2026-05-31 · Target: 1 loop Ralph (~3h30min)

---

## 0 · Posicionamento

Terceiro PRD da **Forjanova v1**. Os 2 anteriores plumbam o caminho `Vitor → PRD → Forge`. Este PRD plumba `Forge done → Vitoria audita → Tasks pros builders`.

Modelo operacional Zordon (memory `project_zordon_ops_pipeline`): **Vitoria é copilot do PM** que opera **pós-Forge**. Não cria PRDs (Vitor faz). Não cria User Stories (não existem no Modelo A). **Cria Tasks** ligadas a `(PRD, AC, diagnóstico)`, agrupadas em Sprint pros builders humanos finalizarem o que Forge não fechou.

Reusa fortemente o subagent stack já merged em PlanningSession (PLAN-001 a PLAN-011), redirecionando-o de "pre-Forge sprint composition" pra "post-Forge audit + delegation".

---

## 1 · Problema

Forge entrega **first batch** — 80-90% de um PRD implementado em 4-20h, com PR no `github.com/volund-projects/<slug>`. Memória `project_zordon_ops_pipeline` D7: *"Builder audita output do Forge, completa o que falta (10-20%)."*

Mas hoje, **três gaps explícitos** impedem o handoff Forge → Builder:

1. **Sem detecção de gap automatizada.** Forge marca `ForgeRun.status='done'` quando todas as stories do `prd.json` passaram. Mas isso não significa que **as AC do PRD** foram satisfeitas — story passa por `verifiable` automatizado (typecheck/sql/http), não por *semântica de produto*. Um endpoint `POST /api/auth/login` pode passar tsc + retornar 200, mas faltar tratamento de account-locked, faltar audit log, faltar rate limit. PRD original menciona; Forge cumpre estrutura, não substância. Builder hoje descobre lendo PRD + repo manualmente.

2. **Sem geração de Task que herde o "porquê".** Builders trabalham hoje com Tasks criadas mão-a-mão por humano que viu o gap. Sem ligação clara entre Task ↔ PRD ↔ AC específica, o builder precisa re-ler o PRD todo pra entender prioridade.

3. **Sem composição de Sprint pós-Forge.** Vitoria foi desenhada (PlanningSession PRD) pra montar sprints **pré-Forge** — escolher quais PRDs entram na próxima sprint. Modelo Zordon novo (memory item 4) inverte isso: sprints pós-Forge agrupam Tasks-de-gap pros builders. Os 11 stories PLAN-001..011 já merged construíram **o kernel** disso: CodebaseAuditor, DepResolver, Capacity, StoryDecomposer, Consolidator subagents — mas estão configurados pra fluxo errado (pre-Forge).

**Fonte:**
- [memory `project_zordon_ops_pipeline.md` § Próximos passos item 4 e item 8](../../../.claude/memory/project_zordon_ops_pipeline.md)
- [prd-planning-session.md](../ready/prd-planning-session.md) — PRD que entregou subagents reusáveis, mas pra contexto pre-Forge
- DB hoje: `Task.productRequirementId nullable`, sem constraint XOR com `userStoryId`, sem FK direto pra `AcceptanceCriterion`
- `AcceptanceCriterion` table não tem `productRequirementId` — só linka via UserStory (legado) ou Task (orphan), nunca direto ao PRD

## 2 · Solução em uma frase

**Endpoint + UI + subagent pipeline em que Vitoria detecta gaps semânticos comparando AC do PRD com estado do repo pós-Forge, gera Tasks-draft ligadas a `(PRD, AC, evidência)`, compõe Sprint via reuso do Consolidator (PLAN-007/011), e apresenta proposta pro PM aprovar — materialização atômica cria Sprint + Tasks no DB pros builders pegarem.**

## 3 · Não-objetivos

- ❌ **Não criar PRDs.** Vitoria nunca cria `ProductRequirement`. Cliente quer feature nova → novo DS com Vitor.
- ❌ **Não criar User Stories.** Modelo A (memory D5) usa PRD + AC + Task. Story só sobrevive pra fluxo Zelar legacy.
- ❌ **Não auto-merge / auto-deploy.** Vitoria propõe; PM aprova; builders fazem o trabalho manual.
- ❌ **Não tocar `prd-planning-session`.** Subagents existentes são reusados; PRD original continua na ready/ até ser explicitamente revisitado.
- ❌ **Não exigir migration destrutiva** de Story → PRD em projetos legacy (Zelar). Convenção, não esquema.
- ❌ **Não detectar gaps em runtime** (testes E2E ao vivo). Detecção é estática: lê PRD + lê repo (clonado).
- ❌ **Não fazer Sprint planning multi-PRD** v1. 1 audit = 1 PRD = 1 Sprint draft. Multi-batch é Phase 2.
- ❌ **Não publicar audit results pro cliente.** Builders consomem; cliente vê só produto final.
- ❌ **Não fazer webhook GitHub PR-opened v1.** Trigger v1 = botão manual no Volund. Webhook é Phase 2.

## 4 · Personas e jornada

**Vitoria (agent):**
> "PM clicou 'Audit with Vitoria' num PRD que tem `ForgeRun.status='done'`. Eu clono o repo, leio o PRD (markdown + AC Json + §16 stories), pra cada AC eu chamo o subagent verifier passando o trecho do repo relevante. Recebo verdict (done / partial / missing) + evidence (linhas de código, ou ausência delas). Persisto em `ForgeAuditResult`. Pego os gaps, gero Task drafts com title, description, scope, priority. Mando pro Consolidator que estima FP, agrupa por capacity, compõe Sprint draft. Retorno proposta pro PM revisar."

**PM (João):**
> "Notificação: '🟢 Forge entregou prd-X — Vitoria preparou audit, 12 AC, 3 gaps detectados, 4 Tasks propostas, ~12 FP, ~2 dias de builder.' Clico, vejo o panel: ✅ ACs done com evidência (path + linha), 🔧 ACs parciais, ❌ ACs faltando. Vejo as 4 Tasks propostas com descrição, scope, FP estimado. Edito 1, aprovo. Click 'Materialize Sprint'. Sprint criada, 4 Tasks no workspace dos builders."

**Builder:**
> "Abro meu workspace. Vejo Sprint 17 — 4 Tasks. Cada Task tem PRD reference (`/projects/X/prds/Y`), AC específica (`AC 6: account-locked retorna 423`), evidência da Vitoria (`código atual em src/app/api/auth/login/route.ts:42 ignora flag accountLockedAt`), priority. Abro Cursor no repo, fecho a Task, PR direto pro main do `volund-projects/<slug>`."

## 5 · Decisões fixadas

| Dn | Decisão | Por quê |
|---|---|---|
| D1 | Vitoria gera **apenas Tasks**, nunca PRDs ou User Stories | Memory `project_zordon_ops_pipeline` D5 (Modelo A) + D7 (builders consomem Tasks). Vitoria é audit + delegate, não product manager. |
| D2 | AC source-of-truth = `ProductRequirement.acceptanceCriteria` (Json) primário; §16 `userStories[].acceptanceCriteria[]` secundário (via bridge VTF-001 quando disponível) | Vitor escreve `acceptanceCriteria` Json no PRD direto via `create_prd` tool. §16 stories AC são granularidade-de-execução; PRD AC top-level são granularidade-de-produto. Vitoria audita a segunda. |
| D3 | Nova tabela `ForgeAuditResult` (audit row por PRD-run) com children `ForgeAuditAcResult` (verdict por AC) | Audit é entidade persistida, não pure-derived. Permite re-execução com diff, histórico, evidence linkada. |
| D4 | AC verifier = Claude Code subagent (subagent_type=Explore) com prompt customizado por verdict-target | Reusa infra existente; Explore lê arquivos read-only (sandbox-safe). Não bota Vitoria como Anthropic SDK direto v1. |
| D5 | Verdict per AC = `done` \| `partial` \| `missing` \| `unverifiable` (4 estados) | `unverifiable` cobre AC sobre integração externa, ux subjetiva, infra — vira Task com tag `manual_qa`. |
| D6 | Task gerada tem **`productRequirementId` obrigatório + `acceptanceCriterionRef` (text)**. `userStoryId` SEMPRE null no fluxo Zordon-Forge. | XOR enforcement (D8). `acceptanceCriterionRef` é índice/hash do AC dentro do Json (não FK porque AC vive em Json field, não em row). |
| D7 | Reusa Consolidator + StoryDecomposer subagents do PlanningSession (PLAN-007/011) com prompts redirecionados pra "Task composition pós-audit" | Não reinventa kernel. Memory item 4 confirma reuso. |
| D8 | Migration adiciona CHECK constraint em Task: `((userStoryId IS NULL) <> (productRequirementId IS NULL))` — exatamente um dos dois | Garante coerência: Task vive em UMA hierarquia (legacy Story OU novo PRD), nunca ambas, nunca nenhuma. Migration tolerante: Tasks legacy com ambos null ganham fix manual antes do constraint. |
| D9 | Trigger v1 = botão manual no PRD detail ("Audit with Vitoria"). Habilitado se PRD tem `ForgeRun.status='done'` linkado. Webhook PR-opened é Phase 2. | YAGNI. Manual permite PM controlar quando audit roda (custa LLM tokens). Automation vem quando volume justificar. |
| D10 | Materialize é atômico (transação SQL): Sprint + Tasks + AC↔Task links no mesmo commit. Falha em qualquer = rollback total. | Memory `project_task_draft_lifecycle` — operações de criação cascata devem ser atômicas. |
| D11 | Audit não modifica repo. Read-only no clone. Diff lives in `ForgeAuditResult.evidence` Json. | Vitoria é auditor; modifications acontecem via Builder → PR → review. Separação de poderes. |
| D12 | Materialize não auto-cria branches/issues no GH. Tasks ficam no Volund DB; integração GitHub Issue é Phase 2 (PRD `prd-forge-github-handoff`). | Forjanova v1 fecha no Volund. GH é endgame mas tem PRD próprio. |

## 6 · Arquitetura

```
                 Forge Engine (prd-forge-engine + prd-forge-autopilot)
                         │
                         │  ForgeRun.status = 'done'
                         │  PR aberto em volund-projects/<slug>
                         ▼
   PM clicks 'Audit with Vitoria'
                         │
                         ▼
   POST /api/forge/audits  { productRequirementId, forgeRunId }
                         │
                         ▼
   ┌───────────────────────────────────────────────────────────────┐
   │  DAL  src/lib/dal/vitoria-audit.ts                            │
   │                                                               │
   │  1. read ProductRequirement (dal/product-requirements)        │
   │  2. read ForgeRun (dal/forge-run) → repo URL + branch         │
   │  3. clone repo to .forge-audits/<auditId>/repo/  (read-only)  │
   │  4. parseAcList(prd) → flat list { index, text, source }      │
   │  5. for each AC, spawn verifier subagent:                     │
   │      Agent(subagent_type=Explore,                             │
   │            prompt='verify AC against repo at <path>')         │
   │      → { verdict, evidence: [{path, lines}], notes }          │
   │  6. persist ForgeAuditResult + ForgeAuditAcResult rows        │
   │  7. for each gap (verdict != 'done'):                         │
   │       draftTask = TaskGenerator.fromGap(prd, ac, evidence)    │
   │  8. invoke Consolidator (reuse PLAN-011):                     │
   │       group draftTasks → Sprint draft + capacity estimate     │
   │  9. return { auditId, status, draftSprint, draftTasks[] }     │
   └───────────────────────────────────────────────────────────────┘
                         │
                         ▼
   UI panel renders audit summary
                         │
                         │  PM reviews + edits + approves
                         ▼
   POST /api/forge/audits/[id]/materialize
                         │
                         ▼
   Transação SQL atomica:
     INSERT Sprint (status='planning')
     INSERT Tasks (productRequirementId, acceptanceCriterionRef, sprintId)
     UPDATE ForgeAuditResult.materializedAt
                         │
                         ▼
   Builder workspace mostra Sprint + Tasks (Phase ∞ — outro PRD)
```

**Componentes (cada caixa = arquivo real):**

| Componente | Path | Responsabilidade |
|---|---|---|
| AC parser | `src/lib/forge/audit/parse-ac-list.ts` | Lê PRD; extrai AC flat list de Json + §16; retorna `{ index, text, source: 'json' \| 'story:<id>' }` |
| Verifier subagent | `src/lib/forge/audit/verifier.ts` | Spawn Agent Explore com prompt verdict; parseia output structured |
| Audit DAL | `src/lib/dal/vitoria-audit.ts` | Orquestra clone + verify + persist |
| Task generator | `src/lib/forge/audit/task-generator.ts` | Gap → Task draft (title, description, scope, priority, FP estimate) |
| Sprint composer | `src/lib/forge/audit/sprint-composer.ts` | Reuso Consolidator subagent; agrupa Tasks por capacity |
| API endpoints | `src/app/api/forge/audits/*` | POST create, GET detail, POST materialize |
| UI panel | `src/components/prd/vitoria-audit-panel.tsx` | Render audit + Task drafts + Sprint draft + approve button |
| Repo cloner | `src/lib/forge/audit/repo-cloner.ts` | Shallow clone, lock to `.forge-audits/<auditId>/`, cleanup hook |

## 7 · Schema (DDL + migrations atômicas)

**Migration 1 — `ForgeAuditResult` table:**

```sql
-- supabase/migrations/20260531a_forge_audit_result.sql
CREATE TABLE "ForgeAuditResult" (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "productRequirementId" uuid NOT NULL REFERENCES "ProductRequirement"(id) ON DELETE CASCADE,
  "forgeRunId"        uuid REFERENCES "ForgeRun"(id) ON DELETE SET NULL,
  "projectId"         uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  "createdBy"         uuid NOT NULL REFERENCES "Member"(id),
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','running','ready','materialized','failed')),
  "repoCommitSha"     text,
  "acTotal"           int NOT NULL DEFAULT 0,
  "acDone"            int NOT NULL DEFAULT 0,
  "acPartial"         int NOT NULL DEFAULT 0,
  "acMissing"         int NOT NULL DEFAULT 0,
  "acUnverifiable"    int NOT NULL DEFAULT 0,
  "draftSprintJson"   jsonb,
  "materializedSprintId" uuid REFERENCES "Sprint"(id) ON DELETE SET NULL,
  "materializedAt"    timestamptz,
  "errorMessage"      text,
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  "updatedAt"         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "ForgeAuditResult_prd_idx"
  ON "ForgeAuditResult"("productRequirementId", "createdAt" DESC);
CREATE INDEX "ForgeAuditResult_status_idx"
  ON "ForgeAuditResult"(status) WHERE status IN ('pending','running');

ALTER TABLE "ForgeAuditResult" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ForgeAuditResult_select" ON "ForgeAuditResult"
  FOR SELECT USING (
    public.is_manager()
    OR public.can_view_project("projectId")
  );

CREATE POLICY "ForgeAuditResult_mutate" ON "ForgeAuditResult"
  FOR ALL USING (
    public.is_manager()
    OR public.can_edit_project("projectId")
  ) WITH CHECK (
    public.is_manager()
    OR public.can_edit_project("projectId")
  );

ALTER PUBLICATION supabase_realtime ADD TABLE "ForgeAuditResult";
```

**Migration 2 — `ForgeAuditAcResult` (per-AC verdict rows):**

```sql
-- supabase/migrations/20260531b_forge_audit_ac_result.sql
CREATE TABLE "ForgeAuditAcResult" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "auditId"       uuid NOT NULL REFERENCES "ForgeAuditResult"(id) ON DELETE CASCADE,
  "acIndex"       int NOT NULL,
  "acText"        text NOT NULL,
  "acSource"      text NOT NULL CHECK ("acSource" IN ('json','story')),
  "acSourceRef"   text,
  verdict         text NOT NULL CHECK (verdict IN ('done','partial','missing','unverifiable')),
  evidence        jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes           text,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("auditId", "acIndex")
);

CREATE INDEX "ForgeAuditAcResult_audit_idx"
  ON "ForgeAuditAcResult"("auditId", "acIndex");
CREATE INDEX "ForgeAuditAcResult_verdict_idx"
  ON "ForgeAuditAcResult"(verdict) WHERE verdict != 'done';

ALTER TABLE "ForgeAuditAcResult" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ForgeAuditAcResult_select" ON "ForgeAuditAcResult"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "ForgeAuditResult" r
      WHERE r.id = "ForgeAuditAcResult"."auditId"
        AND (public.is_manager() OR public.can_view_project(r."projectId"))
    )
  );

CREATE POLICY "ForgeAuditAcResult_mutate" ON "ForgeAuditAcResult"
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM "ForgeAuditResult" r
      WHERE r.id = "ForgeAuditAcResult"."auditId"
        AND (public.is_manager() OR public.can_edit_project(r."projectId"))
    )
  );
```

**Migration 3 — Task gains `acceptanceCriterionRef` + XOR constraint:**

```sql
-- supabase/migrations/20260531c_task_pr_xor_constraint.sql
ALTER TABLE "Task"
  ADD COLUMN "acceptanceCriterionRef" text;

CREATE INDEX "Task_acRef_idx"
  ON "Task"("productRequirementId", "acceptanceCriterionRef")
  WHERE "productRequirementId" IS NOT NULL;

-- XOR enforcement: Task vive em EXATAMENTE uma hierarquia
-- Tasks legacy com ambos NULL precisam de fix manual antes de aplicar:
--   SELECT id, title FROM "Task" WHERE "userStoryId" IS NULL AND "productRequirementId" IS NULL;
-- (esperado: 0 rows após cleanup; senão, atribuir userStoryId ou productRequirementId)
ALTER TABLE "Task"
  ADD CONSTRAINT "Task_hierarchy_xor"
  CHECK (("userStoryId" IS NULL) <> ("productRequirementId" IS NULL));
```

**Pós-migration:** regenerar `src/lib/supabase/database.types.ts` via `npm run db:types`.

## 8 · APIs

| Método | Path | Async? | Contrato |
|---|---|---|---|
| POST | `/api/forge/audits` | **async (202+auditId)** | body: `{ productRequirementId, forgeRunId? }` → 202 `{ auditId }`. Backend roda audit; status muda via realtime |
| GET | `/api/forge/audits/[id]` | sync | → 200 `{ audit, acResults[], draftSprint?, draftTasks[] }` |
| POST | `/api/forge/audits/[id]/materialize` | sync (transação) | body: `{ taskEdits?: TaskEdit[], sprintTitle? }` → 200 `{ sprintId, taskIds[] }` |
| POST | `/api/forge/audits/[id]/cancel` | sync | → 200 `{ ok }` (cancel running audit, cleanup clone) |
| GET | `/api/forge/audits?productRequirementId=X` | sync | → 200 `{ audits[] }` (lista por PRD) |

**Erros:**
- 400 — body Zod
- 403 — sem `can_edit_project`
- 404 — PRD ou audit não existe
- 409 — audit `status='running'` em curso pro mesmo PRD (não permite paralelo)
- 422 — PRD não tem `ForgeRun.status='done'` linkado (sem batch pra auditar)

**Eventos realtime:**
- `ForgeAuditResult:*` — status change (pending→running→ready→materialized)
- `ForgeAuditAcResult:*` — append durante verify loop (UI streama verdicts)

## 9 · UX

**Tela 1 — PRD detail (`/projects/[id]/prds/[prdId]`) — extensão do card existente:**

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚒  Forge Status                                                    │
│  ✅ Emitted · last run: done (12 stories passed, $4.20, 7h12m)      │
│  PR: github.com/volund-projects/auth-service/pull/3                 │
│                                                                     │
│  ─── Vitoria Audit ──────────────────────────────────────────       │
│                                                                     │
│  Estado A — sem audit:                                              │
│  [ 🔍 Audit with Vitoria ]                                          │
│                                                                     │
│  Estado B — audit running:                                          │
│  ⏳ Auditing... 8/15 AC verified · $0.42 spent                      │
│  [ View live ]                                                      │
│                                                                     │
│  Estado C — audit ready:                                            │
│  ✅ Audit complete · 15 AC · 11 ✅ · 2 🔧 · 2 ❌                    │
│  4 Tasks propostas · ~12 FP · ~2 dias de builder                    │
│  [ Review proposal ]   [ Re-audit ]                                 │
│                                                                     │
│  Estado D — materializado:                                          │
│  ✅ Sprint 17 created · 4 Tasks pros builders                       │
│  → /projects/X/sprints/17                                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Tela 2 — Audit Review (ResponsiveSheet, size="lg"):**

```
┌───── Vitoria Audit · prd-auth-service · 2026-05-31 ─────────────────┐
│                                                                     │
│  Resumo: 15 AC · ✅ 11 · 🔧 2 · ❌ 2 · ❓ 0                          │
│  ─────────────────────────────────────────────────                  │
│                                                                     │
│  AC RESULTS                                                         │
│                                                                     │
│  ✅ AC1 · "User pode registrar via email+senha"                     │
│     evidence: src/app/api/auth/register/route.ts:14-58              │
│                                                                     │
│  ✅ AC2 · "Senha é bcrypt-hashed antes do storage"                  │
│     evidence: src/app/api/auth/register/route.ts:34 (bcrypt.hash)   │
│                                                                     │
│  🔧 AC6 · "Account locked retorna 423 + Retry-After header"         │
│     partial: status 423 implementado em login/route.ts:42           │
│              MAS sem header Retry-After                             │
│     → Task proposta: "Add Retry-After header to 423 response"       │
│                                                                     │
│  ❌ AC9 · "Audit log de tentativas de login"                        │
│     missing: nenhuma escrita em AuthEvent table no flow             │
│     → Task proposta: "Implement auth audit log"                     │
│                                                                     │
│  ❌ AC13 · "Rate limit por IP (5 tentativas / 15min)"               │
│     missing: nenhum middleware de rate limit                        │
│     → Task proposta: "Add rate limit middleware to auth routes"     │
│                                                                     │
│  🔧 AC14 · "Email verification flow"                                │
│     partial: token gerado, mas sem endpoint de confirmação          │
│     → Task proposta: "Implement /api/auth/verify-email endpoint"    │
│                                                                     │
│  ─────────────────────────────────────────────────                  │
│                                                                     │
│  PROPOSED SPRINT · "Auth gaps post-Forge"                           │
│                                                                     │
│  Task 1 [edit]  Add Retry-After header                              │
│           scope: bug  · FP: 1  · priority: medium                   │
│                                                                     │
│  Task 2 [edit]  Implement auth audit log                            │
│           scope: feature · FP: 5 · priority: high                   │
│                                                                     │
│  Task 3 [edit]  Add rate limit middleware                           │
│           scope: feature · FP: 3 · priority: high                   │
│                                                                     │
│  Task 4 [edit]  Implement verify-email endpoint                     │
│           scope: feature · FP: 3 · priority: medium                 │
│                                                                     │
│  Total: 12 FP · ~2 dias builder                                     │
│                                                                     │
│  [ Cancel ]                              [ Materialize Sprint ]     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

Padrões UI obrigatórios (memory `project_ui_patterns`):
- `ResponsiveSheet` size="lg" pro panel (não `Sheet` raw)
- `ConfirmDialog` pra "Materialize" (decisão custosa de reverter)
- `useOptimisticCollection` pro estado das Tasks editadas inline
- Erros via Sonner toast
- Sub-component editor de Task usa `Field` compound API

## 10 · Integrações

| Sistema | Integração | Direção |
|---|---|---|
| ProductRequirement DAL | Read PRD + AC | DAL → audit |
| ForgeRun DAL | Read run + repo URL | DAL → audit |
| Git | Shallow clone read-only de `volund-projects/<slug>` (auth via GitHub App token) | audit → git |
| Claude Code Agent | Subagent_type=Explore pra verifier per-AC | audit → Anthropic |
| PlanningSession subagents | Reuso Consolidator + StoryDecomposer (PLAN-007/011) | audit → consolidator |
| Sprint + Task DAL | Materialize cria rows atomically | audit → DAL |
| Supabase Realtime | `ForgeAuditResult`/`ForgeAuditAcResult` channels | DB → UI |
| `prd-forge-engine` | Lê `ForgeRun.status='done'` como pré-req | audit ← Forge |
| `prd-forge-from-vitor` | PRD que Vitor emitiu serve de input | audit ← bridge (indireto via DB) |
| `prd-forge-autopilot` | Cost tracking pode emit `audit_cost_warn` se audit caro | autopilot ← audit |

## 11 · Faseamento

**Fase 1 (este PRD)** — audit end-to-end:
- 8 stories, ~3h30min
- Trigger manual (botão UI)
- Verifier via Claude Code subagent Explore
- Repo clone local em `.forge-audits/<auditId>/`
- Materialize Sprint + Tasks
- Sem GitHub Issue mirror; Sem builder workspace UI (esse é outro PRD)

**Fase 2 (PRDs futuros):**
- `prd-forge-github-handoff`: PR webhook auto-trigger audit
- `prd-builder-workspace`: UI dos builders consumindo Sprints/Tasks
- Re-audit incremental (só ACs com verdict != done na vez anterior)
- Audit cross-PRD em batch (ex: 3 PRDs entregues juntos)

**Fase ∞:**
- Vitoria proativa: scan periódico de PRDs com `ForgeRun.status='done'` sem audit recente
- Audit incremental por PR diff (não clone full)
- Aprendizado: `acceptanceCriteria` que sempre voltam como gap viram pattern flag pro Vitor refinar PRDs futuros

**Fase 1 entrega mais que o sistema atual** porque hoje **não há sistema** — gap detection é 100% manual humana, sem ligação Task↔AC, sem audit history. Fase 1 entrega esse loop fechado.

## 12 · Riscos

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| AC parser inconsistente entre Json e §16 (formatos divergem) | Alta | Alto | D2: source-of-truth = Json primário. §16 secundário só se Json vazio. Story VPA-002 documenta priority. |
| Verifier subagent retorna verdict incorreto (false done OR false missing) | Alta | Alto | Verifier prompt exige `evidence` (path + linhas); PM revê no panel; verdict `unverifiable` é fallback seguro. Aceitamos accuracy ~75% v1; Sprint draft é proposta, não auto-merge. |
| Clone repo demora demais (>2min) | Média | Médio | Shallow clone (`--depth 1`), cache layer em `.forge-audits/<projectSlug>/` reusável entre audits. |
| Materialize race (2 PMs aprovam o mesmo audit simultâneo) | Baixa | Médio | D10 transação atomica + advisory lock por auditId. |
| Constraint XOR fail em migration (Tasks legacy com ambos null) | Média | Catastrófico | Migration 3 documenta SELECT de pre-check. Se >0, abortar migration, gerar list de Tasks pra fix manual. Não aplica CHECK até DB limpo. |
| Audit custa $5+ em PRD com 30+ AC (cada AC = 1 subagent call) | Média | Médio | Batch ACs por arquivo afetado: 1 subagent call analisa N ACs do mesmo arquivo. Cap cost via mecanismo do `prd-forge-autopilot` (cost-caps.ts reusável). |
| GitHub clone falha (auth expired) | Média | Alto | Health check no início do audit: try `git ls-remote`; falha → audit status='failed' + erro acionável. |
| `acceptanceCriteria` Json field do PRD vazio (Vitor não preencheu) | Média | Alto | D2 fallback pra §16 stories. Se ambos vazios, audit status='failed' com message 'PRD has no AC to verify'. |
| Subagent infinite loop / não termina | Baixa | Alto | Timeout per AC = 90s; total cap = 30min. Process kill (SIGTERM) reusa pattern de `prd-forge-autopilot` FAP-002. |
| Materialize gera Task duplicada de audit anterior já materializado | Média | Médio | UPSERT por `(productRequirementId, acceptanceCriterionRef)`: existe → skip + warn 'X tasks dedup'. PM vê na review. |
| Consolidator subagent (PLAN-011 reuse) tem prompt fortemente pre-Forge | Alta | Médio | Story VPA-006 inclui adaptação do prompt: substitui "compose pre-Forge sprint" por "compose post-Forge gap-closing sprint". Estimativa de FP heurística mantida. |

## 13 · Métricas de sucesso

| Métrica | Instrumento | Target |
|---|---|---|
| Audit success rate | `% audits com status='ready' (não failed)` | ≥ 90% |
| Tempo médio de audit | `avg(updatedAt - createdAt) WHERE status='ready'` | < 8min p50 |
| Custo médio por audit | `avg(meta->>'costUsd')` em ForgeAuditResult | < $1.50 p50 |
| AC verdict accuracy | Manual sample: PM marca verdict correto após review | ≥ 75% concordância |
| Gap detection rate | `(acPartial + acMissing) / acTotal` por audit | tracking only — target depende do PRD |
| Materialize rate | `% audits ready que viram materialized` (vs descartados) | ≥ 70% |
| Re-audit rate | `% PRDs com 2+ audits` (PM achou primeiro audit ruim) | < 20% |
| Task↔AC link rate | `% Tasks criadas pós-materialize com acceptanceCriterionRef NOT NULL` | 100% (constraint enforced) |
| Tempo PRD-done → Sprint-materialized | `avg(materializedSprintId IS NOT NULL) - ForgeRun.endedAt` | < 1 hora p50 |
| Cost-effectiveness | `avg(audit cost USD) / avg(builder hours saved estimate)` | < $5 / hour (audit barato vs trabalho que evita) |

## 14 · Open questions

- **OQ1**: AC parser priority Json vs §16 — decidir na story VPA-002 se Json é primary OU se §16 e Json se complementam (union). *(decide em VPA-002)*
- **OQ2**: Verifier subagent isolation — Agent `subagent_type=Explore` permite acesso write? Precisa garantir read-only (não deve modificar repo). *(decide em VPA-003 — provavelmente flag `isolation: 'readonly'` se existir; senão worktree separada)*
- **OQ3**: Consolidator reuse vs rewrite — reusar literal PLAN-011 com prompt swap, OU fork em `src/lib/forge/audit/consolidator.ts`? *(decide em VPA-006 — depende de quanto o prompt original assume pre-Forge contexto)*

## 15 · Referências

- [docs/prd/backlog/prd-forge-engine.md](prd-forge-engine.md) — Forge motor
- [docs/prd/backlog/prd-forge-from-vitor.md](prd-forge-from-vitor.md) — bridge Vitor→Forge
- [docs/prd/backlog/prd-forge-autopilot.md](prd-forge-autopilot.md) — autopilot gates (cost-caps reusável)
- [docs/prd/ready/prd-planning-session.md](../ready/prd-planning-session.md) — subagents reusáveis (Consolidator, StoryDecomposer)
- [src/lib/dal/planning-session.ts](../../../src/lib/dal/planning-session.ts) — DAL existente
- [src/lib/dal/product-requirements.ts](../../../src/lib/dal/product-requirements.ts) — DAL read PRD
- Memory `project_zordon_ops_pipeline` — modelo operacional canônico (D5 Modelo A, item 4 reuso PLAN-001..011)
- Memory `project_task_draft_lifecycle` — operações atomic cascata
- Memory `project_ui_patterns` — ResponsiveSheet, ConfirmDialog, Field, useOptimisticCollection
- AGENTS.md — bloco "PRDs — escrever pra Ralph" + UI patterns

## 16 · Stories implementáveis

```yaml
- id: VPA-001
  title: Migrations ForgeAuditResult + ForgeAuditAcResult + Task XOR constraint
  description: |
    3 migrations atômicas (1 ALTER/CREATE por arquivo) conforme §7. Aplicar via
    psql DIRECT_URL. Pre-check da migration 3: query Tasks com ambos
    userStoryId+productRequirementId NULL; se >0, abortar com mensagem clara
    listando IDs. Regenerar database.types.ts. Smoke RLS com 2 usuários.
  acceptanceCriteria:
    - "supabase/migrations/20260531a_forge_audit_result.sql aplicado, tabela ForgeAuditResult existe"
    - "supabase/migrations/20260531b_forge_audit_ac_result.sql aplicado, tabela ForgeAuditAcResult existe com FK + UNIQUE(auditId, acIndex)"
    - "supabase/migrations/20260531c_task_pr_xor_constraint.sql adicionou acceptanceCriterionRef + CHECK XOR"
    - "Pre-check SELECT documentado em comentário da migration 3"
    - "RLS de ForgeAuditResult: can_view_project gate funciona (usuário sem acesso retorna 0 rows)"
    - "Realtime publication inclui ForgeAuditResult"
    - "src/lib/supabase/database.types.ts regenerado com novas tables + Task.acceptanceCriterionRef"
    - "Smoke: tentativa INSERT Task com ambos null retorna constraint violation"
    - "Smoke: tentativa INSERT Task com ambos NOT null retorna constraint violation"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('ForgeAuditResult','ForgeAuditAcResult')"
      expected: "2"
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.check_constraints WHERE constraint_name='Task_hierarchy_xor'"
      expected: "1"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 30
  touches:
    - supabase/migrations/20260531a_forge_audit_result.sql
    - supabase/migrations/20260531b_forge_audit_ac_result.sql
    - supabase/migrations/20260531c_task_pr_xor_constraint.sql
    - src/lib/supabase/database.types.ts
  agentProfile: db

- id: VPA-002
  title: AC parser uniforme (Json field + §16 fallback)
  description: |
    src/lib/forge/audit/parse-ac-list.ts: exporta parseAcList(prd: ProductRequirement):
    Promise<{ acs: AcEntry[]; sources: { json: number; story: number } }>.
    AcEntry = { index: number; text: string; source: 'json' | 'story'; sourceRef?: string }.
    Política (D2):
      1. Primary: prd.acceptanceCriteria (Json) — esperado array<string> ou array<{text}>
         - Se Json não-vazio: enumera index 0..N-1, source='json'
      2. Secondary fallback: parse §16 do prd.markdown via parse-prd-stories (VTF-001)
         - Se Json vazio E §16 tem stories: extrai stories[].acceptanceCriteria[]
           ofstacked em order, source='story', sourceRef=storyId
      3. Se ambos vazios: throw 'PRD has no AC to verify'
    AcEntry.index é global within audit (não per-story).
  acceptanceCriteria:
    - "src/lib/forge/audit/parse-ac-list.ts exporta parseAcList"
    - "Json não-vazio retorna source='json' pra todos AC"
    - "Json vazio + §16 com stories retorna source='story' com sourceRef preenchido"
    - "Ambos vazios: throw com message 'PRD has no AC to verify'"
    - "Test: PRD com 3 AC em Json + 5 AC em §16 → 3 AC source='json' (não union, só Json)"
    - "Test: PRD com Json vazio + 5 AC em §16 → 5 AC source='story'"
    - "Index é sequencial 0..N-1, mesmo entre stories"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [VPA-001]
  estimateMinutes: 25
  touches:
    - src/lib/forge/audit/parse-ac-list.ts
    - src/lib/forge/audit/parse-ac-list.test.ts
  agentProfile: api

- id: VPA-003
  title: AC verifier subagent (Claude Code Agent + parser de verdict)
  description: |
    src/lib/forge/audit/verifier.ts: exporta verifyAc(ac, repoPath, timeoutMs?):
    Promise<AcVerdict>.
    AcVerdict = { verdict: 'done'|'partial'|'missing'|'unverifiable';
                  evidence: { path: string; lines?: [number, number]; excerpt?: string }[];
                  notes?: string; costUsd?: number }.
    Implementação:
      - Spawn Claude Code Agent via internal Anthropic SDK (model: Sonnet 4.6
        for cost balance) com prompt template:
        "You are verifying if AC is satisfied in this repo.
         AC: <ac.text>
         Repo path: <repoPath>
         Return JSON: { verdict, evidence[], notes }.
         Use Read tool to inspect files. Do NOT use Edit/Write/Bash.
         If you cannot determine: verdict='unverifiable'."
      - Tool restriction: allowedTools=['Read', 'Grep', 'Glob']
      - Timeout default 90s (env FORGE_AUDIT_VERIFIER_TIMEOUT_MS); on timeout return verdict='unverifiable' + notes='timeout'
      - Parse last assistant message as JSON; recovery se malformed → unverifiable
      - Captura cost via stream-json (reuso cost-parser.ts de FE-008 quando disponível;
        fallback: usage do retorno)
  acceptanceCriteria:
    - "src/lib/forge/audit/verifier.ts exporta verifyAc"
    - "Allowed tools restritos a Read + Grep + Glob (sem Edit/Write/Bash)"
    - "Timeout default 90s; on timeout: verdict='unverifiable', notes contém 'timeout'"
    - "Malformed JSON response: verdict='unverifiable', notes contém 'parse error'"
    - "evidence shape: array de { path, lines?, excerpt? }"
    - "costUsd preenchido (mesmo que estimativa)"
    - "Test: mock repo with known AC met → verifier retorna verdict='done' + evidence non-empty"
    - "Test: mock repo without AC implementation → verifier retorna verdict='missing'"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [VPA-002]
  estimateMinutes: 30
  touches:
    - src/lib/forge/audit/verifier.ts
    - src/lib/forge/audit/verifier.test.ts
  agentProfile: api

- id: VPA-004
  title: Audit DAL — orquestra clone + verify + persist
  description: |
    src/lib/dal/vitoria-audit.ts: exporta startAudit(prdId, forgeRunId?, opts?):
    Promise<{ auditId }>, runAudit(auditId): Promise<void> (background-safe),
    getAudit(auditId): Promise<AuditView>.
    Pipeline runAudit:
      1. INSERT ForgeAuditResult { status: 'pending' }
      2. UPDATE status='running'; emit realtime
      3. read PRD via dal/product-requirements
      4. read ForgeRun via dal/forge-run; get repo URL + commitSha
      5. clone via src/lib/forge/audit/repo-cloner.ts shallow em .forge-audits/<auditId>/
      6. parseAcList(prd) (VPA-002)
      7. for each ac, verifyAc (VPA-003) → INSERT ForgeAuditAcResult; emit realtime per AC
      8. agrega counts (acDone, acPartial, ...) → UPDATE ForgeAuditResult
      9. cleanup clone se opts.keepClone !== true
      10. UPDATE status='ready'
    Erros: try-catch global → status='failed' + errorMessage; cleanup clone sempre.
    src/lib/forge/audit/repo-cloner.ts: clone(repoUrl, sha, destPath): Promise<void>
    + cleanup(destPath); shallow `--depth 1`; auth via GitHub App token (env GH_APP_TOKEN).
  acceptanceCriteria:
    - "src/lib/dal/vitoria-audit.ts exporta startAudit + runAudit + getAudit"
    - "startAudit é sync: insert row + return auditId em <1s"
    - "runAudit é background-safe (called via worker ou setImmediate); status updates emit realtime"
    - "src/lib/forge/audit/repo-cloner.ts shallow clone com --depth 1"
    - "Cleanup garantido em finally (mesmo em erro)"
    - "Status flow: pending → running → ready (ou failed)"
    - "ForgeAuditAcResult inserido com UPSERT por (auditId, acIndex) — idempotent"
    - "Counts (acDone, acPartial, acMissing, acUnverifiable) agregados corretamente"
    - "Smoke: startAudit + sleep 5min + getAudit retorna status='ready' com >0 AC results"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [VPA-003]
  estimateMinutes: 30
  touches:
    - src/lib/dal/vitoria-audit.ts
    - src/lib/forge/audit/repo-cloner.ts
    - src/lib/forge/audit/repo-cloner.test.ts
  agentProfile: api

- id: VPA-005
  title: Task generator — gap → TaskDraft com PRD+AC linkage
  description: |
    src/lib/forge/audit/task-generator.ts: exporta generateTaskDrafts(audit, prd):
    Promise<TaskDraft[]>.
    TaskDraft = { title; description; scope: 'bug'|'feature'|'manual_qa';
                  priority: number; estimatedFp: number;
                  productRequirementId; acceptanceCriterionRef: string;
                  notes? }.
    Lógica:
      - Para cada AC com verdict != 'done':
        - title: derivado do AC text (max 80 chars, action verb)
        - description: AC text completo + evidence summary + verdict + notes
        - scope: 'bug' if verdict='partial', 'feature' if 'missing', 'manual_qa' if 'unverifiable'
        - priority: 1 (critical) if missing, 2 (high) if partial, 3 (medium) if unverifiable
        - estimatedFp: heurística simple: bug=1, feature=3 if evidence.length=0 else 5, manual_qa=2
        - acceptanceCriterionRef: `audit:<auditId>:ac:<acIndex>` (rastreável)
    Reuse Anthropic call (Haiku 4.5) opcional pra refinar title se AC text >80 chars.
  acceptanceCriteria:
    - "src/lib/forge/audit/task-generator.ts exporta generateTaskDrafts"
    - "TaskDraft shape documentado em type export"
    - "verdict='partial' → scope='bug', priority=2, estimatedFp=1"
    - "verdict='missing' → scope='feature', priority=1, estimatedFp ∈ {3,5}"
    - "verdict='unverifiable' → scope='manual_qa', priority=3, estimatedFp=2"
    - "AC com verdict='done' NÃO gera Task"
    - "acceptanceCriterionRef formato: 'audit:<uuid>:ac:<int>'"
    - "Title truncated to 80 chars + action verb prefix"
    - "Test: audit com 5 AC (3 done, 1 partial, 1 missing) → 2 TaskDrafts"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [VPA-004]
  estimateMinutes: 25
  touches:
    - src/lib/forge/audit/task-generator.ts
    - src/lib/forge/audit/task-generator.test.ts
  agentProfile: api

- id: VPA-006
  title: Sprint composer (reuso Consolidator PLAN-011 com prompt adapter)
  description: |
    src/lib/forge/audit/sprint-composer.ts: exporta composeSprintDraft(tasks,
    projectId): Promise<SprintDraft>.
    SprintDraft = { title: string; description: string;
                    estimatedDays: number; totalFp: number;
                    tasksOrdered: TaskDraft[] }.
    Lógica:
      - Reusa Consolidator subagent de PlanningSession se acessível
        (src/lib/agent/agents/vitoria/pm-review.ts ou equivalente)
      - Prompt adapter: substitui contexto pre-Forge por "post-Forge gap-closing"
        - Input: TaskDraft[] + projectId + capacity hint (project capacity overview)
        - Output: { title, description, ordering rationale }
      - Title default: '<PRD slug> — post-Forge gaps'
      - Estimate days: sum(estimatedFp) / 8 (heurística 8 FP = 1 dia builder)
      - Ordering: prioritize bug → manual_qa → feature; within scope, priority asc
    Se Consolidator não disponível (fallback): ordering puro + title default.
  acceptanceCriteria:
    - "src/lib/forge/audit/sprint-composer.ts exporta composeSprintDraft"
    - "Sem Consolidator: fallback retorna SprintDraft funcional"
    - "Title default: '<PRD reference> — post-Forge gaps'"
    - "estimatedDays = ceil(sum(estimatedFp) / 8)"
    - "tasksOrdered ordering: bugs first, manual_qa second, features third"
    - "Within scope: priority ascendente (1 antes de 3)"
    - "Test: 5 TaskDrafts (2 bug, 2 feature, 1 qa) → tasksOrdered ordem [bug, bug, qa, feature, feature]"
    - "Smoke: SprintDraft com 5 tasks, totalFp=12 → estimatedDays=2"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [VPA-005]
  estimateMinutes: 25
  touches:
    - src/lib/forge/audit/sprint-composer.ts
    - src/lib/forge/audit/sprint-composer.test.ts
  agentProfile: api

- id: VPA-007
  title: API endpoints (POST audits / GET / materialize / cancel / list)
  description: |
    5 routes Next 16 App Router em src/app/api/forge/audits/:
      POST /api/forge/audits/route.ts
        body Zod: { productRequirementId: uuid; forgeRunId?: uuid }
        auth: can_edit_project; 422 se PRD não tem ForgeRun status=done
        409 se audit em curso pra mesmo PRD
        chama startAudit → background runAudit
        response: 202 { auditId }
      GET /api/forge/audits/[id]/route.ts
        retorna AuditView { audit, acResults[], draftSprint?, draftTasks[] }
      POST /api/forge/audits/[id]/materialize/route.ts
        body Zod: { taskEdits?: { ref, fields }[]; sprintTitle? }
        SQL transação atomica:
          INSERT Sprint
          INSERT Tasks (productRequirementId + acceptanceCriterionRef)
          UPDATE ForgeAuditResult.materializedSprintId + materializedAt
        UPSERT por (productRequirementId, acceptanceCriterionRef): dedup automático
        response: { sprintId, taskIds[], duplicatesSkipped: number }
      POST /api/forge/audits/[id]/cancel/route.ts
        Marca status='failed' + cleanup clone
        response: { ok }
      GET /api/forge/audits/route.ts?productRequirementId=X
        Lista paginated (limit 20)
    Schemas Zod em src/lib/forge/audit/api-schemas.ts.
  acceptanceCriteria:
    - "src/app/api/forge/audits/route.ts: POST + GET (list)"
    - "src/app/api/forge/audits/[id]/route.ts: GET (detail)"
    - "src/app/api/forge/audits/[id]/materialize/route.ts: POST"
    - "src/app/api/forge/audits/[id]/cancel/route.ts: POST"
    - "POST audit sem ForgeRun done → 422"
    - "POST com audit em curso pra mesmo PRD → 409"
    - "Materialize é transação atomica (rollback em qualquer falha)"
    - "UPSERT de Tasks por (productRequirementId, acceptanceCriterionRef) — dedup"
    - "Materialize response inclui duplicatesSkipped count"
    - "Cancel cleanup clone via repo-cloner.cleanup"
    - "Zod schemas em src/lib/forge/audit/api-schemas.ts"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: http
      command_or_query: "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/forge/audits"
      expected: "401"
  dependsOn: [VPA-006]
  estimateMinutes: 30
  touches:
    - src/app/api/forge/audits/route.ts
    - src/app/api/forge/audits/[id]/route.ts
    - src/app/api/forge/audits/[id]/materialize/route.ts
    - src/app/api/forge/audits/[id]/cancel/route.ts
    - src/lib/forge/audit/api-schemas.ts
  agentProfile: api

- id: VPA-008
  title: UI Vitoria Audit Panel + trigger button + smoke E2E
  description: |
    1. src/components/prd/vitoria-audit-panel.tsx:
       - 4 estados (no-audit / running / ready / materialized) conforme §9 Tela 1
       - Botão "Audit with Vitoria" só renderiza se PRD tem ForgeRun.status='done'
       - Estado running: subscribe ForgeAuditResult realtime
    2. src/components/prd/audit-review-sheet.tsx:
       - ResponsiveSheet size="lg" pra review
       - Lista AC results agrupados por verdict (✅ done collapse default)
       - Task draft editor inline (Field compound API)
       - Botão "Materialize Sprint" com ConfirmDialog
    3. Integração em /projects/[id]/prds/[prdId]/page.tsx existente
    4. Smoke E2E em package.json script test:vitoria-audit-e2e:
       - Mock PRD seed + mock ForgeRun done
       - Trigger audit via API
       - Assert: audit row criado, status muda pra running, async finaliza
    5. Append docs/runbooks/forge-runbook.md seção "Vitoria post-Forge audit"
  acceptanceCriteria:
    - "src/components/prd/vitoria-audit-panel.tsx renderiza 4 estados"
    - "Botão 'Audit with Vitoria' só visível se ForgeRun done linkado"
    - "src/components/prd/audit-review-sheet.tsx usa ResponsiveSheet (não Sheet raw)"
    - "Task draft editor usa Field compound API"
    - "Materialize button confirma via ConfirmDialog (não window.confirm)"
    - "Realtime subscription pra ForgeAuditResult durante running"
    - "Sonner toasts pra erros"
    - "script test:vitoria-audit-e2e roda + asserta status flow"
    - "docs/runbooks/forge-runbook.md ganha seção 'Vitoria post-Forge audit' (≥3 parágrafos)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "grep -r 'VitoriaAuditPanel' 'src/app/(dashboard)/projects' | head -1"
      expected: "non-empty match"
  dependsOn: [VPA-007]
  estimateMinutes: 30
  touches:
    - src/components/prd/vitoria-audit-panel.tsx
    - src/components/prd/audit-review-sheet.tsx
    - src/app/(dashboard)/projects/[id]/prds/[prdId]/page.tsx
    - package.json
    - docs/runbooks/forge-runbook.md
  agentProfile: ui
```

---

```
╔════════════════════════════════════════════════════════════╗
║  END OF PRD · Vitoria fecha o ciclo Forjanova v1.          ║
║  Forge entrega · Vitoria audita · Builders concluem.       ║
╚════════════════════════════════════════════════════════════╝
```
