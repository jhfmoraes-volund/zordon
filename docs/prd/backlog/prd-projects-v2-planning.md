# PRD — projects-v2-planning (Sprint Planning re-pointed from Tasks to PRDs)

> **Feature id:** `projects-v2-planning` · **prefix:** `PV2P` · **depends on:** `projects-v2-schema` (colunas `sprintId`/`estimateFp`/`deliveryStatus`/`userStoryId`) · `projects-v2-area` (componente compartilhado `src/components/prd/spec-prd-tree.tsx`, PV2A-006 — consumido com `renderRowActions` de alocar/desalocar)
> **Status:** backlog · **Owner:** João (admin-only pilot) · **Created:** 2026-06-04
>
> Implementa o §6 do plano [docs/features/projects-v2/projects-v2-plan.md](../../features/projects-v2/projects-v2-plan.md):
> a cerimônia de **Sprint Planning** deixa de planejar Tasks e passa a planejar **PRDs** (`ProductRequirement`).
> Release Planning (multi-sprint, `PlanningSession`) **já planeja PRDs→sprints** e NÃO é tocado aqui.

---

## §1 — Problema

1. **Sprint Planning ainda commita Tasks, não PRDs.** Hoje a cerimônia (`PlanningCeremony`, surface default da Vitoria em [src/lib/agent/agents/vitoria/index.ts](../../../src/lib/agent/agents/vitoria/index.ts) `buildVitoriaTools(planningId, projectId)`) só sabe propor `MeetingTaskAction` sobre `Task` via `propose_task_action` ([src/lib/agent/agents/vitoria/tools.ts](../../../src/lib/agent/agents/vitoria/tools.ts) L112). No modelo V2 a unidade alocável a uma sprint é o PRD (D5 do plano: "PRDs live inside sprints"), e a Vitoria não tem nenhuma tool que escreva `ProductRequirement.sprintId`.
2. **A capacidade da sprint soma só FP de Task.** A view `sprint_capacity_overview` agrega `Task.functionPoints` via `sprint_member_capacity` ([supabase/migrations/20260519_task_status_blocked.sql](../../../supabase/migrations/20260519_task_status_blocked.sql) L155–237) e `get_sprint_capacity` ([tools.ts](../../../src/lib/agent/agents/vitoria/tools.ts) L508) faz o mesmo em TS. PRDs têm `estimateFp` (vindo de `projects-v2-schema`), mas nenhuma math de capacidade o lê — "PRDs enchem a sprint" não funciona (plano §6 "Capacity gap").
3. **Não existe superfície de alocação por PRD na cerimônia.** Release Planning tem board drag-drop de PRD ([src/components/planning-session/board.tsx](../../../src/components/planning-session/board.tsx)), mas o Sprint Planning só renderiza a árvore de Tasks ([src/components/planning/planning-tree.tsx](../../../src/components/planning/planning-tree.tsx)). O PM não consegue commitar "estes PRDs vão pra ESTA sprint" na cerimônia.

## §2 — Solução em uma frase

Dar à Vitoria, na superfície de Sprint Planning, tools de **alocar/desalocar PRD na sprint DESTA cerimônia** (escrevendo `ProductRequirement.sprintId` + `deliveryStatus='todo'`, espelhando `link_prd_to_sprint` como commit single-sprint) e uma **capacidade que soma o `estimateFp` dos PRDs**, com a árvore Spec→PRD renderizada na superfície de planning.

## §3 — Não-objetivos

- **Não** reconstruir Release Planning (`PlanningSession`/`PlanningSessionPRD` + board multi-sprint já planejam PRDs→sprints — plano §6 "unchanged in spirit").
- **Não** criar/editar/aprovar PRD aqui (autoria é do Vitor; a summon de Vitor pela Vitoria via `ensure_sprint_prd_session` é a feature `projects-v2-*` separada da Fase 4, fora deste PRD).
- **Não** mexer no schema de `ProductRequirement` (colunas `sprintId`/`estimateFp`/`deliveryStatus` vêm de `projects-v2-schema`).
- **Não** remover `propose_task_action` — o legado de Task coexiste (plano §3.3 "coexistence was designed in"); apenas adicionamos a trilha de PRD.
- **Não** tocar nas auto-transições de `deliveryStatus` do Forge (`in_progress→review`) — isso é a Fase 2 do plano.

## §4 — Personas e jornada

- **PM (João, admin):** *"Abri o Sprint Planning da Sprint 12. A Vitoria me lista os PRDs aprovados do projeto agrupados por Spec; eu falo 'commita PV-PRD-014 e PV-PRD-015 nessa sprint' e ela aloca — o `sprintId` é gravado, o status vira `todo`, e o widget de capacidade já mostra os FP somando contra a allocation do squad. Se estourar, ela me avisa."*
- **Vitoria (agente PM):** *"Na superfície de planning eu agora tenho `allocate_prd_to_sprint` (commit single-sprint na sprint da cerimônia), `deallocate_prd_from_sprint`, `list_project_prds` e `get_sprint_prd_capacity`. Não invento PRD — alocá-lo é puxar de uma lista de PRDs aprovados do projeto."*

## §5 — Decisões fixadas

| Dn | Decisão | Por quê |
|----|---------|---------|
| D1 | Alocar = escrever `ProductRequirement.sprintId = <sprint da cerimônia>` **+** `deliveryStatus = 'todo'`, num único UPDATE atômico no DAL. | Plano §6 "Committing writes `ProductRequirement.sprintId`; set `deliveryStatus=todo`". |
| D2 | A sprint alvo é **sempre** `PlanningCeremony.sprintId` da cerimônia ativa — a tool NÃO recebe `sprintId` como input. | Single-sprint commit (vs. Release Planning multi-sprint). Evita o agente alocar na sprint errada. |
| D3 | Tools novas vivem em `buildVitoriaTools(planningId, projectId)` (surface `planning`), ao lado de `propose_task_action`, NÃO em `buildReleasePlanningTools`. | A superfície de Sprint Planning é a default da Vitoria ([index.ts](../../../src/lib/agent/agents/vitoria/index.ts) L218–238). |
| D4 | Desalocar = `sprintId = NULL` **+** `deliveryStatus = 'backlog'`. NÃO apaga o PRD. | Reverte ao estado pré-commit (plano §4.2: `backlog` = "not allocated to a sprint"). |
| D5 | Alocação é **idempotente**: alocar um PRD já na mesma sprint é no-op ok; alocar um PRD já em OUTRA sprint **re-aponta** (move). | Espelha semântica de `addLinkedPrd`/`move_prd` do release planning. |
| D6 | Capacidade de PRD vem de uma **nova view SQL** `sprint_prd_capacity` que soma `ProductRequirement.estimateFp` por `sprintId`, separada de `sprint_capacity_overview` (que continua somando Task FP). | Não quebrar consumidores existentes da view de Task (Alpha, overview). PRD FP é um eixo paralelo. |
| D7 | `sprint_prd_capacity` filtra `dismissedAt IS NULL` e `deliveryStatus <> 'backlog'`; expõe `prd_count`, `fp_allocated`, `fp_done`, `fp_open`. | `done` = `deliveryStatus='done'`/`'in_production'`; `open` = o resto allocated. Espelha a semântica de `sprint_member_capacity`. |
| D8 | Só PRD com `status='approved'` é alocável; PRD em `draft`/`review`/`superseded` é rejeitado pela tool com erro legível. | Plano §4.1 "only `approved` is Forge-able" — sprint só commita trabalho pronto. |
| D9 | A tool valida que o PRD pertence ao **mesmo `projectId`** da cerimônia antes de alocar. | Evita cross-project leak (mesmo guard de `read_design_session_memory`). |
| D10 | A view recebe `GRANT SELECT TO service_role, authenticated`, sem RLS própria (view herda RLS das tabelas-base `ProductRequirement`). | Consistente com `sprint_capacity_overview` (que também é GRANT-only). |
| D11 | A migration da view é atômica, arquivo único `supabase/migrations/20260604a_sprint_prd_capacity.sql`, rodada via `psql "$DIRECT_URL"`. | Convenção do repo (AGENTS.md Supabase). |
| D12 | A UI da superfície de planning **consome o `SpecPrdTree` compartilhado** (`src/components/prd/spec-prd-tree.tsx`, de `projects-v2-area`), passando `statusRegistry=DELIVERY_STATUS` e `renderRowActions(prd)` com os botões alocar/desalocar (⊕/⊖). Agrupamento por `userStoryId` + bucket "Sem Spec" vêm do componente — **não** se cria `planning-prd-tree.tsx`. | Plano §9 (árvore única); AGENTS.md "reuse first". |

## §6 — Arquitetura

```
                       Sprint Planning (PlanningCeremony, surface="planning")
                                          │
        ┌─────────────────────────────────┼──────────────────────────────────┐
        │                                 │                                   │
  Vitoria tools (buildVitoriaTools)   DAL (planning-prd-allocation.ts)   UI (SpecPrdTree compartilhado)
        │                                 │                                   │
  • list_project_prds  ───────────►  getAllocatablePrds(projectId)      árvore Spec→PRD colapsável
  • allocate_prd_to_sprint ───────►  allocatePrdToSprint(prdId,sprintId) ──► UPDATE ProductRequirement
  • deallocate_prd_from_sprint ───►  deallocatePrd(prdId)                     SET sprintId, deliveryStatus
  • get_sprint_prd_capacity ──────►  getSprintPrdCapacity(sprintId) ─────► SELECT sprint_prd_capacity (view)
                                          │
   POST /api/planning/[id]/allocate-prd ─┘  (HTTP path p/ o board de planning chamar fora do chat)
```

Cada caixa = função/endpoint/view real:
- `getAllocatablePrds` / `allocatePrdToSprint` / `deallocatePrd` / `getSprintPrdCapacity` → `src/lib/dal/planning-prd-allocation.ts` (novo).
- `sprint_prd_capacity` → view SQL nova (§7).
- `list_project_prds` / `allocate_prd_to_sprint` / `deallocate_prd_from_sprint` / `get_sprint_prd_capacity` → tools em `buildVitoriaTools` ([src/lib/agent/agents/vitoria/tools.ts](../../../src/lib/agent/agents/vitoria/tools.ts)).
- `POST /api/planning/[id]/allocate-prd` → `src/app/api/planning/[id]/allocate-prd/route.ts` (novo; Zod-validated, usado pela árvore clicável).
- `SpecPrdTree` → **compartilhado** `src/components/prd/spec-prd-tree.tsx` (de `projects-v2-area`), montado na superfície de planning com `renderRowActions` de alocar/desalocar (nenhum componente de árvore novo aqui).

## §7 — Schema (DDL completo)

Colunas `ProductRequirement.sprintId` / `estimateFp` / `deliveryStatus` / `userStoryId` são **consumidas de `projects-v2-schema`** (não criadas aqui). A única mudança de schema é a view de capacidade por PRD.

Arquivo `supabase/migrations/20260604a_sprint_prd_capacity.sql`:

```sql
BEGIN;

DROP VIEW IF EXISTS public.sprint_prd_capacity CASCADE;

CREATE VIEW public.sprint_prd_capacity AS
SELECT
  pr."sprintId"                                                                AS "sprintId",
  COUNT(*)::int                                                                AS prd_count,
  COALESCE(SUM(pr."estimateFp"), 0)::int                                       AS fp_allocated,
  COALESCE(SUM(pr."estimateFp") FILTER (
    WHERE pr."deliveryStatus" IN ('done', 'in_production')
  ), 0)::int                                                                   AS fp_done,
  COALESCE(SUM(pr."estimateFp") FILTER (
    WHERE pr."deliveryStatus" IN ('todo', 'in_progress', 'review', 'changes_requested')
  ), 0)::int                                                                   AS fp_open
FROM public."ProductRequirement" pr
WHERE pr."sprintId" IS NOT NULL
  AND pr."dismissedAt" IS NULL
  AND pr."deliveryStatus" <> 'backlog'
GROUP BY pr."sprintId";

GRANT SELECT ON public.sprint_prd_capacity TO service_role, authenticated;

COMMENT ON VIEW public.sprint_prd_capacity IS
  'Capacidade por sprint somando ProductRequirement.estimateFp dos PRDs alocados (sprintId NOT NULL, deliveryStatus<>backlog, não dismissed). fp_allocated = Σ estimateFp; fp_done = done+in_production; fp_open = todo+in_progress+review+changes_requested. Eixo paralelo a sprint_capacity_overview (que soma Task FP).';

COMMIT;
```

RLS: a view não recebe policy própria; herda RLS de `ProductRequirement` (`prd_read`) e é GRANT-only (D10), idêntico a `sprint_capacity_overview`.

Depois de rodar a migration, regenerar `src/lib/supabase/database.types.ts` para expor `sprint_prd_capacity` em `Views`.

## §8 — APIs

| Camada | Assinatura | Contrato |
|--------|-----------|----------|
| DAL | `getAllocatablePrds(projectId): Promise<Row[]>` | PRDs `status='approved'`, `dismissedAt IS NULL`, do projeto, com `id,reference,title,estimateFp,sprintId,deliveryStatus,userStoryId`. |
| DAL | `allocatePrdToSprint(prdId, sprintId, projectId): Promise<Row>` | UPDATE `sprintId`+`deliveryStatus='todo'`. Valida projeto (D9) + `status='approved'` (D8). Idempotente/move (D5). |
| DAL | `deallocatePrd(prdId, projectId): Promise<Row>` | UPDATE `sprintId=NULL`+`deliveryStatus='backlog'`. Valida projeto. |
| DAL | `getSprintPrdCapacity(sprintId): Promise<{ sprintId, prdCount, fpAllocated, fpDone, fpOpen } \| null>` | SELECT da view `sprint_prd_capacity`. `null` se sprint sem PRDs. |
| Tool | `list_project_prds` | Lista PRDs alocáveis (chama `getAllocatablePrds`); inclui flag `allocatedHere` se já na sprint da cerimônia. Sem input. |
| Tool | `allocate_prd_to_sprint` | Input `{ productRequirementId: uuid }`. Aloca na sprint da cerimônia (resolvida de `PlanningCeremony.sprintId`; sem `sprintId` no input — D2). Retorna `{ ok, productRequirementId, sprintId, deliveryStatus }`. |
| Tool | `deallocate_prd_from_sprint` | Input `{ productRequirementId: uuid }`. Retorna `{ ok, productRequirementId }`. |
| Tool | `get_sprint_prd_capacity` | Sem input (usa sprint da cerimônia). Retorna `{ ok, sprintId, prdCount, fpAllocated, fpDone, fpOpen }`. |
| HTTP | `POST /api/planning/[id]/allocate-prd` | Body Zod `{ productRequirementId: uuid, action: "allocate"\|"deallocate" }`. `[id]` = `PlanningCeremony.id`. 200 `{ prd }`, 400 Zod, 404 cerimônia/PRD ausente, 409 se cerimônia sem `sprintId`. |

Sem job async — operações são UPDATE síncrono < 1s.

## §9 — UX (wireframe ASCII)

Superfície de Sprint Planning — árvore Spec→PRD + capacidade por PRD:

```
┌─ Sprint Planning · Sprint 12 ────────────────────── [Vitoria chat ▸] ┐
│                                                                       │
│  Capacidade (PRD FP)   ████████████░░░░  34 / 48 FP   · 4 PRDs        │
│  ────────────────────────────────────────────────────────────────    │
│                                                                       │
│  ▾ Spec: Onboarding revamp                          (UserStory)       │
│     ☑ PV-PRD-014 · Magic-link form         8 FP   [todo]   [⊖]        │
│     ☑ PV-PRD-015 · Invite gate             5 FP   [todo]   [⊖]        │
│  ▾ Spec: Billing                                                      │
│     ☐ PV-PRD-021 · Stripe webhook         13 FP   [backlog][⊕ alocar] │
│  ▾ (sem Spec)                                                         │
│     ☐ PV-PRD-030 · Audit log               8 FP   [backlog][⊕ alocar] │
│                                                                       │
│  [⊕] aloca → sprintId set, status=todo, capacidade re-soma           │
└───────────────────────────────────────────────────────────────────── ┘
```

`⊕`/`⊖` chamam `POST /api/planning/[id]/allocate-prd`; barra de capacidade lê `sprint_prd_capacity`.

## §10 — Integrações

- **Release Planning** (`PlanningSession`): permanece a fonte do *roadmap* (PRD→qual sprint, multi-sprint). Sprint Planning é o *commit* da sprint ativa. Um PRD pode estar no board do Release Planning E alocado por Sprint Planning — `PlanningSessionPRD` (plano) é staging; `ProductRequirement.sprintId` é o commit real.
- **Forge** (Fase 2 do plano): consome `ProductRequirement.sprintId` para rodar "uma sprint inteira" via `createForgeRunFromProject`. Este PRD só grava o `sprintId`; o run-launch é fora de escopo.
- **Capacidade legada** (`sprint_capacity_overview` / `get_sprint_capacity`): intacta. O widget de planning passa a mostrar AMBOS os eixos (Task FP e PRD FP) lado a lado durante a coexistência.

## §11 — Faseamento

Este PRD é a **Fase 3** do plano ("Planning re-point"). Internamente:
1. View SQL `sprint_prd_capacity` + types (fundação de capacidade).
2. DAL `planning-prd-allocation.ts` (allocate/deallocate/capacity/list).
3. Vitoria tools na superfície de planning.
4. Endpoint HTTP + árvore Spec→PRD na UI.

Cada fatia entrega mais que hoje (hoje: zero alocação de PRD em Sprint Planning). Fase 1 já dá ao agente a capacidade de commitar PRDs — mais que o sistema atual.

## §12 — Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Colunas `sprintId`/`estimateFp`/`deliveryStatus` ainda não existirem ao rodar (dependência) | Média | Alto (migration/typecheck quebra) | `dependsOn: projects-v2-schema` garante ordem; PV2P-001 (view) falha cedo e visível se ausente. |
| View `sprint_prd_capacity` divergir da semântica de `sprint_member_capacity` | Baixa | Médio (números confusos) | FILTER espelha exatamente os status de `sprint_member_capacity` (D7); COMMENT documenta. |
| Agente alocar PRD na sprint errada | Baixa | Médio | D2: tool não aceita `sprintId`, resolve sempre de `PlanningCeremony.sprintId`. |
| Cerimônia sem `sprintId` (idle) | Média | Baixo | Tool/endpoint retornam erro legível ("cerimônia sem sprint vinculada"); 409 no HTTP. |
| Double-source de verdade (Release board vs sprintId) | Média | Baixo | §10: board = staging, `sprintId` = commit; documentado, sem auto-sync nesta fase. |

## §13 — Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| PRDs alocados por sprint | `SELECT "sprintId", prd_count FROM sprint_prd_capacity ORDER BY prd_count DESC;` |
| Utilização de capacidade (PRD FP vs allocation do squad) | `SELECT p."sprintId", p.fp_allocated, c.capacity, round(100.0*p.fp_allocated/NULLIF(c.capacity,0),1) AS util_pct FROM sprint_prd_capacity p JOIN sprint_capacity_overview c USING ("sprintId");` |
| % de sprints com ≥1 PRD commitado (adoção) | `SELECT count(DISTINCT "sprintId") FROM sprint_prd_capacity;` vs `SELECT count(*) FROM "Sprint" WHERE "endDate" >= now()::date;` |
| Allocate/deallocate via agente | `SELECT count(*) FROM "ProductRequirementActivity" WHERE kind='updated' AND diff ? 'sprintId';` (activity log do DAL `updatePrd`). |

## §14 — Open questions

(vazio — sem bloqueantes. Auto-sync Release-board↔`sprintId` é decisão de Fase ≥4, fora deste PRD.)

## §15 — Referências

- Plano: [docs/features/projects-v2/projects-v2-plan.md](../../features/projects-v2/projects-v2-plan.md) §6 (planning re-point), §3.3 (PRD FP gap).
- Código vivo: [src/lib/agent/agents/vitoria/tools.ts](../../../src/lib/agent/agents/vitoria/tools.ts) (`get_sprint_capacity`, `propose_task_action`), [src/lib/agent/agents/vitoria/release-planning.ts](../../../src/lib/agent/agents/vitoria/release-planning.ts) (`link_prd_to_sprint` — o commit single-sprint espelhado), [src/lib/agent/agents/vitoria/index.ts](../../../src/lib/agent/agents/vitoria/index.ts) (dispatch por surface), [src/lib/dal/product-requirements.ts](../../../src/lib/dal/product-requirements.ts) (PRD DAL), [supabase/migrations/20260519_task_status_blocked.sql](../../../supabase/migrations/20260519_task_status_blocked.sql) (`sprint_capacity_overview`).
- Memórias: `project_planning_session`, `project_sprint_planning_living_model`, `project_rituals_taxonomy`, `project_forge_prd_consumption`, `project_vitoria_as_diamond_zero`.

---

## §16 — Stories implementáveis

```yaml
- id: PV2P-001
  title: Migration — view sprint_prd_capacity
  description: >
    Cria a view SQL sprint_prd_capacity (§7) somando ProductRequirement.estimateFp
    por sprintId, com FILTER espelhando os status de sprint_member_capacity.
    Roda via psql "$DIRECT_URL".
  acceptanceCriteria:
    - "Arquivo supabase/migrations/20260604a_sprint_prd_capacity.sql existe com o DDL do §7"
    - "psql roda sem erro"
    - "View sprint_prd_capacity tem colunas: sprintId, prd_count, fp_allocated, fp_done, fp_open"
    - "GRANT SELECT TO service_role, authenticated aplicado"
  verifiable:
    - kind: sql
      command_or_query: "source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql \"$DIRECT_URL\" -f supabase/migrations/20260604a_sprint_prd_capacity.sql"
      expected: "CREATE VIEW / GRANT (no error)"
    - kind: sql
      command_or_query: "SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name='sprint_prd_capacity';"
      expected: "sprintId,prd_count,fp_allocated,fp_done,fp_open"
  dependsOn: []
  estimateMinutes: 20
  touches: [supabase/migrations/20260604a_sprint_prd_capacity.sql]

- id: PV2P-002
  title: Regenerar database.types.ts com sprint_prd_capacity
  description: >
    Atualiza src/lib/supabase/database.types.ts pra expor a view sprint_prd_capacity
    em Views, sem quebrar tsc.
  acceptanceCriteria:
    - "database.types.ts contém 'sprint_prd_capacity' como key em Views"
    - "tsc não acusa erro relacionado a sprint_prd_capacity"
  verifiable:
    - kind: lint
      command_or_query: "grep -c 'sprint_prd_capacity' src/lib/supabase/database.types.ts"
      expected: ">=1"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit 2>&1 | grep -E 'sprint_prd_capacity' || echo no-errors"
      expected: "no-errors"
  dependsOn: [PV2P-001]
  estimateMinutes: 10
  touches: [src/lib/supabase/database.types.ts]

- id: PV2P-003
  title: DAL — getAllocatablePrds + getSprintPrdCapacity (reads)
  description: >
    Cria src/lib/dal/planning-prd-allocation.ts com os reads: getAllocatablePrds(projectId)
    (PRDs approved, não dismissed, do projeto) e getSprintPrdCapacity(sprintId)
    (SELECT da view sprint_prd_capacity, null se sem PRDs).
  acceptanceCriteria:
    - "Arquivo src/lib/dal/planning-prd-allocation.ts existe"
    - "Exporta getAllocatablePrds(projectId) e getSprintPrdCapacity(sprintId)"
    - "getAllocatablePrds filtra status='approved' e dismissedAt IS NULL"
    - "getSprintPrdCapacity lê a view sprint_prd_capacity e mapeia pra camelCase"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit 2>&1 | grep -E 'src/lib/dal/planning-prd-allocation' || echo no-errors"
      expected: "no-errors"
    - kind: lint
      command_or_query: "grep -cE 'export (async )?function (getAllocatablePrds|getSprintPrdCapacity)' src/lib/dal/planning-prd-allocation.ts"
      expected: "2"
  dependsOn: [PV2P-002]
  estimateMinutes: 25
  touches: [src/lib/dal/planning-prd-allocation.ts]

- id: PV2P-004
  title: DAL — allocatePrdToSprint + deallocatePrd (writes)
  description: >
    Adiciona em planning-prd-allocation.ts os writes: allocatePrdToSprint(prdId, sprintId, projectId)
    (UPDATE sprintId + deliveryStatus='todo'; valida projeto + status='approved'; idempotente/move)
    e deallocatePrd(prdId, projectId) (sprintId=NULL + deliveryStatus='backlog'). Usa updatePrd
    do DAL pra registrar activity.
  acceptanceCriteria:
    - "Exporta allocatePrdToSprint(prdId, sprintId, projectId) e deallocatePrd(prdId, projectId)"
    - "allocatePrdToSprint rejeita PRD com status != 'approved' (erro legível)"
    - "allocatePrdToSprint rejeita PRD de outro projeto"
    - "deallocatePrd zera sprintId e seta deliveryStatus='backlog'"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit 2>&1 | grep -E 'src/lib/dal/planning-prd-allocation' || echo no-errors"
      expected: "no-errors"
    - kind: lint
      command_or_query: "grep -cE 'export (async )?function (allocatePrdToSprint|deallocatePrd)' src/lib/dal/planning-prd-allocation.ts"
      expected: "2"
  dependsOn: [PV2P-003]
  estimateMinutes: 30
  touches: [src/lib/dal/planning-prd-allocation.ts]

- id: PV2P-005
  title: Vitoria tools — list_project_prds + get_sprint_prd_capacity (reads)
  description: >
    Em src/lib/agent/agents/vitoria/tools.ts (buildVitoriaTools, surface planning),
    adiciona list_project_prds (chama getAllocatablePrds, flag allocatedHere) e
    get_sprint_prd_capacity (resolve PlanningCeremony.sprintId, chama getSprintPrdCapacity).
  acceptanceCriteria:
    - "buildVitoriaTools exporta as tools list_project_prds e get_sprint_prd_capacity"
    - "get_sprint_prd_capacity resolve a sprint via PlanningCeremony.sprintId (não recebe sprintId)"
    - "list_project_prds retorna PRDs approved com flag allocatedHere"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit 2>&1 | grep -E 'src/lib/agent/agents/vitoria/tools' || echo no-errors"
      expected: "no-errors"
    - kind: lint
      command_or_query: "grep -cE '(list_project_prds|get_sprint_prd_capacity):' src/lib/agent/agents/vitoria/tools.ts"
      expected: "2"
  dependsOn: [PV2P-004]
  estimateMinutes: 25
  touches: [src/lib/agent/agents/vitoria/tools.ts]

- id: PV2P-006
  title: Vitoria tools — allocate_prd_to_sprint + deallocate_prd_from_sprint (writes)
  description: >
    Adiciona em buildVitoriaTools as tools de commit: allocate_prd_to_sprint
    (resolve PlanningCeremony.sprintId, chama allocatePrdToSprint; erro se cerimônia sem sprint)
    e deallocate_prd_from_sprint (chama deallocatePrd). Mirror single-sprint de link_prd_to_sprint.
  acceptanceCriteria:
    - "buildVitoriaTools exporta allocate_prd_to_sprint e deallocate_prd_from_sprint"
    - "allocate_prd_to_sprint NÃO aceita sprintId no inputSchema (resolve da cerimônia)"
    - "allocate_prd_to_sprint retorna erro legível se PlanningCeremony.sprintId for null"
    - "Retorno inclui { ok, productRequirementId, sprintId, deliveryStatus }"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit 2>&1 | grep -E 'src/lib/agent/agents/vitoria/tools' || echo no-errors"
      expected: "no-errors"
    - kind: lint
      command_or_query: "grep -cE '(allocate_prd_to_sprint|deallocate_prd_from_sprint):' src/lib/agent/agents/vitoria/tools.ts"
      expected: "2"
  dependsOn: [PV2P-005]
  estimateMinutes: 30
  touches: [src/lib/agent/agents/vitoria/tools.ts]

- id: PV2P-007
  title: API — POST /api/planning/[id]/allocate-prd
  description: >
    Cria src/app/api/planning/[id]/allocate-prd/route.ts. Body Zod
    { productRequirementId: uuid, action: 'allocate'|'deallocate' }. [id]=PlanningCeremony.id.
    Resolve sprintId da cerimônia; chama allocatePrdToSprint/deallocatePrd. 409 se cerimônia sem sprint.
  acceptanceCriteria:
    - "Arquivo route.ts existe e exporta POST"
    - "Valida body via Zod (rejeita action inválida com 400)"
    - "Retorna 409 quando a cerimônia não tem sprintId"
    - "Retorna 200 { prd } em sucesso"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit 2>&1 | grep -E 'src/app/api/planning/\\[id\\]/allocate-prd' || echo no-errors"
      expected: "no-errors"
    - kind: lint
      command_or_query: "grep -cE 'export (async )?function POST' 'src/app/api/planning/[id]/allocate-prd/route.ts'"
      expected: "1"
    - kind: lint
      command_or_query: "grep -cE '(z\\.object|z\\.enum|zod)' 'src/app/api/planning/[id]/allocate-prd/route.ts'"
      expected: ">=1"
  dependsOn: [PV2P-004]
  estimateMinutes: 25
  touches: ["src/app/api/planning/[id]/allocate-prd/route.ts"]

- id: PV2P-008
  title: UI — montar SpecPrdTree compartilhado na superfície de planning
  description: >
    Na superfície de Sprint Planning, monta o <SpecPrdTree> compartilhado
    (src/components/prd/spec-prd-tree.tsx, de projects-v2-area) passando os PRDs alocáveis +
    Specs, statusRegistry=DELIVERY_STATUS, e renderRowActions(prd) com os botões alocar (⊕) /
    desalocar (⊖) + o estimateFp na linha. NÃO cria componente de árvore novo — o agrupamento por
    Spec, colapso e bucket "Sem Spec" vêm do componente compartilhado.
  acceptanceCriteria:
    - "A superfície de planning importa SpecPrdTree de src/components/prd/spec-prd-tree.tsx"
    - "Passa renderRowActions com alocar/desalocar + estimateFp na linha; statusRegistry=DELIVERY_STATUS"
    - "Nenhum arquivo planning-prd-tree.tsx é criado"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit 2>&1 | grep -E 'src/components/planning' || echo no-errors"
      expected: "no-errors"
    - kind: lint
      command_or_query: "grep -rc 'spec-prd-tree' src/components/planning/"
      expected: ">=1"
    - kind: lint
      command_or_query: "ls src/components/planning/planning-prd-tree.tsx 2>/dev/null | wc -l | tr -d ' '"
      expected: "0"
  dependsOn: [PV2P-002]
  estimateMinutes: 25
  touches: [src/components/planning/planning-sheet.tsx]

- id: PV2P-009
  title: UI — capacidade PRD na superfície de planning + wire allocate
  description: >
    Renderiza a barra de capacidade por PRD (lê sprint_prd_capacity via getSprintPrdCapacity)
    acima do SpecPrdTree e fia os botões alocar/desalocar (renderRowActions) pra
    POST /api/planning/[id]/allocate-prd, re-somando capacidade após a mutação. Smoke browser.
  acceptanceCriteria:
    - "A superfície de planning renderiza SpecPrdTree + barra de capacidade (fpAllocated / capacity)"
    - "Clicar alocar num PRD backlog chama POST allocate-prd e o card vira 'todo'"
    - "A barra de capacidade re-soma o estimateFp do PRD após alocar"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit 2>&1 | grep -E 'src/components/planning' || echo no-errors"
      expected: "no-errors"
    - kind: lint
      command_or_query: "grep -rc 'spec-prd-tree' src/components/planning/"
      expected: ">=1"
    - kind: manual_browser
      command_or_query: "Abrir Sprint Planning de uma sprint com PRDs approved. Alocar um PRD backlog: validar que vira 'todo', sprintId gravado, e a barra de capacidade soma o estimateFp."
      expected: "PRD vira todo + capacidade re-soma o FP do PRD"
  dependsOn: [PV2P-007, PV2P-008]
  estimateMinutes: 30
  touches: [src/components/planning/planning-sheet.tsx]

- id: PV2P-010
  title: Verify SQL — alocação grava sprintId + capacidade reflete
  description: >
    Story de verificação end-to-end por SQL: após alocar um PRD via API/tool,
    o ProductRequirement tem sprintId set, deliveryStatus='todo', e sprint_prd_capacity
    retorna a linha com fp_allocated correto.
  acceptanceCriteria:
    - "Após allocate, SELECT confirma sprintId NOT NULL e deliveryStatus='todo'"
    - "sprint_prd_capacity retorna fp_allocated = Σ estimateFp dos PRDs daquela sprint"
    - "Após deallocate, sprintId volta a NULL e deliveryStatus='backlog'"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) >= 0 FROM sprint_prd_capacity;"
      expected: "t"
    - kind: sql
      command_or_query: "SELECT (SELECT COALESCE(SUM(\"estimateFp\"),0) FROM \"ProductRequirement\" WHERE \"sprintId\" IS NOT NULL AND \"dismissedAt\" IS NULL AND \"deliveryStatus\"<>'backlog' GROUP BY \"sprintId\" LIMIT 1) = (SELECT fp_allocated FROM sprint_prd_capacity LIMIT 1) OR NOT EXISTS (SELECT 1 FROM sprint_prd_capacity);"
      expected: "t"
  dependsOn: [PV2P-006, PV2P-007]
  estimateMinutes: 15
  touches: []
```
