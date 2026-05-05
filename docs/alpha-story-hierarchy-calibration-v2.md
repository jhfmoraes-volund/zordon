# Alpha — Story Hierarchy + Sprint Planner (V2)

**Status:** plano executável · supersede `alpha-story-hierarchy-calibration.md`
**Última atualização:** 2026-05-05
**Audience:** próximo agente (humano ou IA) que vai executar.

**Princípio orientador:** **reusar antes de criar**. A maior parte da plumbing necessária já existe — só não está plugada no Alpha. V2 corta tudo que duplica trabalho do Vitor e foca no que de fato falta.

---

## 0. TL;DR

| Pergunta | Resposta |
|---|---|
| O Vitor já gera Module/UserStory/Task/AC? | ✅ Sim — em produção |
| Tools de hierarquia existem? | ✅ Em [src/lib/agent/tools/](src/lib/agent/tools/) — 7 factories prontas |
| Alpha conhece elas? | ❌ Não — não estão em [src/lib/agent/agents/alpha/tools.ts](src/lib/agent/agents/alpha/tools.ts) |
| RPC `create_user_story_with_tasks` precisa? | ❌ DAL `createStory` + tool `create_task` já fazem o trabalho |
| RPC `suggest_fp` precisa? | ❌ É função TS pura em [src/lib/function-points.ts](src/lib/function-points.ts) |
| Capacity model existe? | ✅ 3 camadas + 2 views — pronto |
| Alpha lê capacity? | ✅ Parcial (`get_member_commitments`, `get_sprint_capacity` em tools.ts) |
| Bulk task update existe? | ❌ Falta — único item de banco que precisa criar |
| Sprint Ribbon Alpha pill é real? | ❌ Heurística pura, não chama agente |

**Resultado:** das 7 ondas do plano original, 3 já estão prontas (1, parte da 4) ou são unnecessary. As ondas reais são 5: **conectar tools existentes**, **prompt de hierarquia**, **planner mode**, **ribbon real**, **calibração**.

**Tempo estimado V2: 12h técnico + 3h calibração = ~15h** (vs 22h do V1).

---

## 1. Inventário pré-execução (snapshot 2026-05-05)

### 1.1 Schema/RPCs — o que já existe

| Item | Existe? | Path |
|---|---|---|
| Tabela `Module` | ✅ | [20260430_module.sql](supabase/migrations/20260430_module.sql) |
| Tabela `UserStory` | ✅ | [20260430_user_story.sql](supabase/migrations/20260430_user_story.sql) |
| Tabela `AcceptanceCriterion` | ✅ | (mesma migration) |
| Tabela `ProjectPersona` | ✅ | [20260430_project_persona.sql](supabase/migrations/20260430_project_persona.sql) |
| Tabela `TaskAssignment` (M:N) | ✅ | parte do schema base |
| RPC `next_user_story_reference` | ✅ | [20260430_user_story.sql](supabase/migrations/20260430_user_story.sql) |
| RPC `next_task_reference` | ✅ | [20260429_task_creator.sql](supabase/migrations/20260429_task_creator.sql) |
| RPC `task_acceptance_bulk_diff` | ✅ | [20260501_ac_bulk_diff_rpc.sql](supabase/migrations/20260501_ac_bulk_diff_rpc.sql) — **template para bulk_update_tasks** |
| View `member_commitment_overview` | ✅ | [20260423_fp_allocation_model.sql](supabase/migrations/20260423_fp_allocation_model.sql) |
| View `sprint_member_capacity` | ✅ | [20260430_fp_capacity_metrics.sql](supabase/migrations/20260430_fp_capacity_metrics.sql) |
| View `sprint_capacity_overview` | ✅ | mesma |
| RPC `bulk_update_tasks` | ❌ | **CRIAR** (única migration de Onda 8) |
| Tabela `AgentSuggestionCache` | ❌ | **CRIAR** (Onda Ribbon, opcional) |

### 1.2 Tools factories prontas em [src/lib/agent/tools/](src/lib/agent/tools/)

Todas exportam `(...args) => Tool`. Já registradas no agent legado em [src/lib/agent/tools.ts](src/lib/agent/tools.ts), **não no Alpha**.

| Factory | Arquivo | Reusável no Alpha? |
|---|---|---|
| `proposeModulesTool(projectId)` | [propose-modules.ts](src/lib/agent/tools/propose-modules.ts) | ✅ direto |
| `syncProjectPersonasTool(projectId)` | [sync-personas.ts](src/lib/agent/tools/sync-personas.ts) | ✅ direto |
| `createUserStoryTool(sessionId, projectId, createdById?)` | [create-user-story.ts](src/lib/agent/tools/create-user-story.ts) | ⚠️ exige `sessionId` — Alpha não tem design session, passar `null`/sentinela ou criar wrapper |
| `listStoriesTool(sessionId, projectId)` | [manage-stories.ts](src/lib/agent/tools/manage-stories.ts) | ⚠️ idem `sessionId` — wrapper |
| `approveModuleTool(projectId)` | [manage-stories.ts](src/lib/agent/tools/manage-stories.ts) | ✅ direto |
| `setStoryRefinementTool(projectId)` | [manage-stories.ts](src/lib/agent/tools/manage-stories.ts) | ✅ direto |
| `createTaskTool(sessionId, projectId, createdById?)` | [create-task.ts](src/lib/agent/tools/create-task.ts) | ⚠️ idem `sessionId` |

**Decisão sobre `sessionId`:** o Alpha cria tasks/stories **fora** de design session. Caminho: estender as factories pra aceitar `sessionId: string | null` e ajustar a constraint de idempotência (hoje (sessionId, userStoryId, title); pra Alpha vira (projectId, userStoryId, title, status='draft')). Alternativa: criar wrappers Alpha-only que chamam DAL diretamente. **Recomendação: estender factory existente** — menos código, mantém um único path canônico.

### 1.3 DAL helpers em [src/lib/dal/story-hierarchy.ts](src/lib/dal/story-hierarchy.ts)

Tudo prontinho, session-agnóstico:

- `getModulesForProject(projectId)`
- `getPersonasForProject(projectId)`
- `getRecentStoriesForProject(projectId, {limit})`
- `getStoriesForProject(projectId)` (com relations)
- `getStoryByReference(reference)`
- `createStory(input)` — chama RPC `next_user_story_reference`, insere story+AC
- `updateStory(id, patch)`
- `setStoryRefinement(id, status)`
- `validateStoryAc(id, memberId)`
- `normalizeModuleName(name)` (helper puro)
- `approveProposedModule(storyId, projectId, proposedName, approverId?)`
- `promoteTasksForModule(moduleId)` — bulk: draft→backlog + RPC pra cada task
- `revertTasksForModule(moduleId)`
- `getAcForStory(storyId)` / `getAcForTask(taskId)`
- `toggleAcCheck(id, memberId, checked)`

### 1.4 Alpha agent — estado atual

[src/lib/agent/agents/alpha/](src/lib/agent/agents/alpha/):

- **context.ts (~900 linhas):** `buildOpsContext` → baseline + project/sprint/meeting focus + global. **Zero menção a Module/Persona/UserStory.**
- **prompt.ts (~600 linhas):** zero menção a hierarquia ou planning.
- **tools.ts (~700 linhas):** 30+ tools de ops (sprint, task, member, capacity, meeting, alerts). **Nenhuma de hierarquia.** Já tem:
  - `get_member_commitments` ✅ (lê `member_commitment_overview`)
  - `get_sprint_capacity` ✅ (lê `sprint_member_capacity`)
  - `create_sprint` ✅
  - `create_task` ✅ (mas cria task isolada, sem `userStoryId`)
  - `assign_task` / `move_task_to_sprint` / `update_task_status` ✅ (granular, 1-task-por-call)

### 1.5 Sprint Ribbon

[src/components/sprint/sprint-ribbon/](src/components/sprint/sprint-ribbon/) — pill "Alpha" mostra `count` de alertas heurísticos (`sprintAlerts` em `helpers.ts`). **Não chama o agente.** Ornamento.

---

## 2. Plano V2 — 5 Ondas

| Onda | Escopo | Dep | Tempo |
|---|---|---|---|
| **A** | Plugar tools de hierarquia no Alpha (estender factories pra aceitar `sessionId: null`) | — | 2h |
| **B** | Context loader: bloco "Hierarquia do projeto" + helper `getAlphaProjectSnapshot` | A | 1h |
| **C** | Prompt: seção "Hierarquia de produto" (8 regras) | B | 1h + 2h calibração |
| **D** | Sprint Planner Mode: RPC `bulk_update_tasks` + tools `get_project_capacity` / `list_unplanned_tasks` / `bulk_update_tasks` + prompt "Sprint Planning" | C | 5h + 2h calibração |
| **E** | Sprint Ribbon Alpha pill real (lazy fetch + cache + drawer com sugestões) | C | 3h |

**Sequência crítica:** A → B → C → (D ‖ E) → Calibração final
**Total:** ~12h técnico + 4h calibração = **16h**.

E é opcional pra MVP — se apertar tempo, pula sem prejuízo do core (planner mode entrega o valor principal).

---

## 3. Onda A — Plugar tools de hierarquia no Alpha

**Objetivo:** Alpha enxerga e mexe na taxonomia. Reusar tudo que existe.

### 3.1 Adaptar factories pra aceitar `sessionId: null`

**Arquivos a editar:**
- [src/lib/agent/tools/create-user-story.ts](src/lib/agent/tools/create-user-story.ts:24)
- [src/lib/agent/tools/create-task.ts](src/lib/agent/tools/create-task.ts)
- [src/lib/agent/tools/manage-stories.ts](src/lib/agent/tools/manage-stories.ts:10) — só `listStoriesTool` toca em `sessionId`

**Mudança em `createUserStoryTool`:**

```ts
// ANTES
export function createUserStoryTool(
  sessionId: string,
  projectId: string,
  createdById?: string,
) { ... }

// DEPOIS
export function createUserStoryTool(
  sessionId: string | null,    // null = chamada fora de design session (Alpha)
  projectId: string,
  createdById?: string,
) {
  // Idempotência:
  // - se sessionId presente: (sessionId, userStoryId, title)
  // - se null: (projectId, title) WHERE refinementStatus IN ('draft','refined')
  ...
}
```

**Aplicar mesma adaptação em** `createTaskTool` e `listStoriesTool`. O resto (`proposeModulesTool`, `setStoryRefinementTool`, `approveModuleTool`, `syncProjectPersonasTool`) já é projectId-scoped — funciona sem mudança.

**Risco:** quebrar Vitor. **Mitigação:** sessionId continua opcional; comportamento atual preservado quando não-null. Rodar `vitor-cli.ts` antes de commitar.

### 3.2 Registrar no Alpha

Editar [src/lib/agent/agents/alpha/tools.ts](src/lib/agent/agents/alpha/tools.ts), adicionar antes de `// ─── Write tools ─────────────────`:

```ts
import {
  createUserStoryTool,
  listStoriesTool,
  proposeModulesTool,
  setStoryRefinementTool,
  approveModuleTool,
  syncProjectPersonasTool,
  createTaskTool,
} from "@/lib/agent/tools";  // (re-export central)

// Leitura — sempre disponível
tools.list_modules = ...     // novo: usa getModulesForProject
tools.list_personas = ...    // novo: usa getPersonasForProject
tools.get_story_overview = ...  // novo: usa getStoryByReference
tools.list_stories = listStoriesTool(null, projectId);

// Escrita — gated por capabilities.writeTools (Regra 0)
if (capabilities.writeTools) {
  tools.propose_modules = proposeModulesTool(projectId);
  tools.approve_module = approveModuleTool(projectId);
  tools.create_user_story = createUserStoryTool(null, projectId, capabilities.actorId);
  tools.set_story_refinement = setStoryRefinementTool(projectId);
  tools.sync_project_personas = syncProjectPersonasTool(projectId);
  // create_task existente passa a aceitar userStoryId opcional
}
```

**Nota:** `tools.create_task` em [agents/alpha/tools.ts:536](src/lib/agent/agents/alpha/tools.ts#L536) **já existe** com lógica própria (cria task isolada). Substituir por `createTaskTool(null, projectId, actorId)` extendido — comportamento "task isolada" ainda funciona quando `userStoryId` não é passado.

### 3.3 Tools novas leves (3, ~50 linhas cada)

`list_modules`, `list_personas`, `get_story_overview` — wrappers finos sobre DAL. Esqueleto:

```ts
tools.list_modules = tool({
  description: "Lista modules do projeto com count de stories.",
  inputSchema: z.object({
    projectId: z.string().uuid().optional()
      .describe("Default: projeto do contexto da rota"),
  }),
  execute: async ({ projectId: pid }) => {
    const targetId = pid ?? routeProjectId(route);
    if (!targetId) return { error: "Sem projectId no contexto" };
    const modules = await getModulesForProject(targetId);
    return { modules };
  },
});
```

### 3.4 Gate da Onda A

```bash
# 1. Tipos limpos
bunx tsc --noEmit

# 2. Vitor não regrediu (idempotência mantida)
npx tsx --require ./scripts/_server-only-shim.cjs scripts/vitor-cli.ts \
  --message "criar uma story de magic-link" \
  --session "<id de session de teste>"

# 3. Alpha enxerga taxonomia
npx tsx --require ./scripts/_server-only-shim.cjs scripts/alpha-cli.ts \
  --message "lista os modules e stories desse projeto" \
  --current-path "/projects/<zordonId>"
# esperado: cita 9 modules reais do Zordon, não inventa
```

---

## 4. Onda B — Context loader

**Objetivo:** Alpha **vê** modules/personas/stories no contexto de cada turno, sem precisar perguntar.

### 4.1 Helper DAL novo

[src/lib/dal/story-hierarchy.ts](src/lib/dal/story-hierarchy.ts) ganha:

```ts
export async function getAlphaProjectSnapshot(projectId: string): Promise<{
  modules: Array<{ id: string; name: string; description: string | null; storyCount: number; approvedAt: string | null }>;
  personas: Array<{ id: string; name: string; description: string | null; storyCount: number }>;
  recentStories: Array<{ reference: string; title: string; moduleId: string | null; refinementStatus: string }>;
  backlogReady: { taskCount: number; totalFp: number; byModule: Record<string, number> };
}> {
  // 1 query por bloco. Total <100ms em projeto típico.
  ...
}
```

`backlogReady` = tasks com `status='backlog' AND userStoryId IS NOT NULL AND functionPoints IS NOT NULL`.

### 4.2 Editar [src/lib/agent/agents/alpha/context.ts](src/lib/agent/agents/alpha/context.ts)

Em `buildProjectFocus(projectId)`, adicionar após o bloco de members/sprints:

```ts
const snapshot = await getAlphaProjectSnapshot(projectId);
focusBlock += renderTaxonomyBlock(snapshot);

// renderTaxonomyBlock produz markdown:
// ## Taxonomia
//
// Modules (9):
// - LOGIN — fluxos de auth (12 stories)
// - BILLING — pagamento (8 stories)
// ...
//
// Personas (3):
// - cliente: usa o produto
// ...
//
// Histórico recente (últimas 20):
// - LOGIN-US-014 [refined]: Magic-link com expiração
// ...
//
// Backlog pronto: 47 tasks, 312 FP
//   por module: LOGIN (12), BILLING (18), AUDIT (10), outros (7)
```

### 4.3 Gate da Onda B

```bash
npx tsx --require ./scripts/_server-only-shim.cjs scripts/alpha-cli.ts \
  --message "qual módulo a story 'magic-link' deveria entrar?" \
  --current-path "/projects/<zordonId>"
# esperado: Alpha cita LOGIN/AUTH específicos do projeto, não chuta
```

---

## 5. Onda C — Prompt de hierarquia

**Objetivo:** Alpha **classifica** corretamente.

### 5.1 Editar [src/lib/agent/agents/alpha/prompt.ts](src/lib/agent/agents/alpha/prompt.ts)

Adicionar seção **após Regra 0**, antes de seções existentes de ops:

```
## Hierarquia: Module → UserStory → Task → AC

Você opera num modelo de hierarquia. Quando o usuário descreve uma feature
ou demanda, você classifica e propõe — nunca cria taxonomia paralela.

### 1. CLASSIFICAÇÃO DE MÓDULO
Você recebe `modules` na Taxonomia do contexto.
- SEMPRE escolha um module existente se a story cabe num.
- Se NENHUM module cabe, deixe `moduleId: null` e proponha `proposedModuleName`
  em UPPERCASE_SNAKE (ex: "AUDIT_LOG", "REPORTS").
- PM aprova o novo module via `approve_module` antes da story virar oficial.

### 2. PERSONA — você nunca inventa
- Você recebe `personas` na Taxonomia.
- Sempre use o id de uma da lista.
- Se nenhuma persona cabe, **pare e pergunte** — não chute.

### 3. NARRATIVA
- `title`: imperativo, curto.
- `want`: começa com verbo ("receber link que expira").
- `soThat`: o porquê do negócio. Opcional só se óbvio.
- Formato final na UI: "Como {persona}, quero {want}, para que {soThat}."

### 4. ACCEPTANCE CRITERIA
- Story-level (1–8): comportamento de **negócio** ("usuário consegue X").
- Task-level (1–10): aceitação **técnica** ("retorna 410 Gone").
- Sempre verificáveis e específicos. Mau: "implementa endpoint REST".

### 5. TASKS
- 1–15 por story, atômicas.
- `type`: feature/bugfix/refactor/setup/component/seed/management.
- `scope` × `complexity`: matriz pra estimar FP. FP null = server calcula.

### 6. ANTI-DUPLICAÇÃO
- Você recebe `recentStories` (últimas 20).
- Antes de criar, verifique similar. Se sim, mencione no `reasoning`,
  NÃO crie. Sugira reutilizar/estender.

### 7. REFINEMENT STATUS
- Toda story criada por você entra como `draft`.
- PM marca `refined`. Nunca pular pra `committed` direto.

### 8. AMBIGUIDADE
- Input vago ("melhorar dashboard")? **Pergunte antes**, não gere stories vagas.
```

### 5.2 Calibração Onda C — 5 cenários

Roda 3× cada via `alpha-cli.ts`. Documentar em `docs/alpha-calibration-results.md`.

| # | Input | Esperado |
|---|---|---|
| C1 | "criar story 'login com email'" | 1 story em `LOGIN` (existente), persona Builder, 2-3 tasks |
| C2 | "criar story 'checkout completo'" | 1 story em `BILLING`, 5-8 tasks com AC verificáveis |
| C3 | "criar story 'auditoria de eventos'" | story `moduleId: null` + `proposedModuleName: "AUDIT_LOG"` |
| C4 | "como tá o login?" | resposta narrativa, 0 stories criadas |
| C5 | "melhorar dashboard" | Alpha pergunta o que melhorar, NÃO gera |

**≥ 90% acerto em 3 runs cada = ✅ Onda C.** Erro > 10% = ajustar prompt.

---

## 6. Onda D — Sprint Planner Mode

**Objetivo:** uma vez backlog pronto, Alpha organiza em sprints com awareness de capacity por builder.

### 6.1 Gate de ativação (automático)

Sem flag. Em `buildProjectFocus`, depois do snapshot da Onda B:

```ts
const plannerMode =
  snapshot.backlogReady.taskCount >= 10 &&
  members.some(m => m.fpAllocation > 0);

if (plannerMode) {
  focusBlock += renderPlannerCapacityBlock(snapshot, members, sprints);
}
```

`renderPlannerCapacityBlock` formato:

```markdown
## Capacidade do projeto (planning mode)

### Builders alocados (4)
- João Moraes (senior fullstack)
  fpCapacity 500 · committed total 200 · alocado neste projeto 150
- Lucas Silva (mid backend) — 425 · 0 · 100
- Pedro Costa (mid backend) — 425 · 50 · 80
- Ana Rocha (junior fullstack) — 350 · 0 · 60

### Sprints
- Sprint 7 (active, 2026-05-04→2026-05-10) — 38 FP planejado, 12 done
- Sprint 8 (upcoming, 2026-05-11→2026-05-17) — vazio
- (sem mais sprints criados)

### Backlog pronto pra alocar
- 47 tasks · 312 FP
- Por module: LOGIN (12) · BILLING (18) · AUDIT (10) · outros (7)
- Capacidade total/sprint disponível: 390 FP
- Estimativa: ~ceil(312/390) = 1 sprint, com folga
  (recalcular se PM impuser restrições)
```

### 6.2 Migration: RPC `bulk_update_tasks`

Template: [task_acceptance_bulk_diff](supabase/migrations/20260501_ac_bulk_diff_rpc.sql) (mesmo padrão de jsonb in, transação, rollback total em erro).

`supabase/migrations/<DATE>_bulk_update_tasks.sql`:

```sql
CREATE OR REPLACE FUNCTION bulk_update_tasks(
  p_project_id uuid,
  p_updates jsonb,    -- [{taskRef, sprintId?, assigneeIds?, status?}]
  p_actor_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  upd jsonb;
  v_task_id uuid;
  v_assignee_ids uuid[];
  v_results jsonb := '[]'::jsonb;
BEGIN
  -- Validar actor é membro do projeto (manager+)
  IF NOT EXISTS (
    SELECT 1 FROM "ProjectMember" pm
    JOIN "Member" m ON m.id = pm."memberId"
    WHERE pm."projectId" = p_project_id
      AND pm."memberId" = p_actor_id
      AND m.role IN ('manager','admin','principal')
  ) THEN
    RAISE EXCEPTION 'Actor sem permissão de planejamento neste projeto';
  END IF;

  FOR upd IN SELECT * FROM jsonb_array_elements(p_updates) LOOP
    -- Resolve taskRef → id
    SELECT id INTO v_task_id
    FROM "Task"
    WHERE reference = upd->>'taskRef' AND "projectId" = p_project_id;
    IF v_task_id IS NULL THEN
      RAISE EXCEPTION 'Task % não encontrada no projeto', upd->>'taskRef';
    END IF;

    -- Validar sprintId pertence ao projeto (se fornecido)
    IF upd ? 'sprintId' AND upd->>'sprintId' IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM "Sprint"
        WHERE id = (upd->>'sprintId')::uuid AND "projectId" = p_project_id
      ) THEN
        RAISE EXCEPTION 'Sprint % não pertence ao projeto', upd->>'sprintId';
      END IF;
    END IF;

    -- UPDATE Task — só campos presentes
    UPDATE "Task" SET
      "sprintId" = CASE
        WHEN upd ? 'sprintId' THEN
          NULLIF(upd->>'sprintId', '')::uuid
        ELSE "sprintId"
      END,
      status = CASE
        WHEN upd ? 'status' THEN upd->>'status'
        ELSE status
      END,
      "updatedAt" = now()
    WHERE id = v_task_id;

    -- Replace TaskAssignment se assigneeIds presente
    IF upd ? 'assigneeIds' THEN
      DELETE FROM "TaskAssignment" WHERE "taskId" = v_task_id;
      v_assignee_ids := ARRAY(SELECT jsonb_array_elements_text(upd->'assigneeIds'))::uuid[];
      INSERT INTO "TaskAssignment" ("taskId", "memberId")
      SELECT v_task_id, m_id
      FROM unnest(v_assignee_ids) m_id
      WHERE EXISTS (
        SELECT 1 FROM "ProjectMember"
        WHERE "projectId" = p_project_id AND "memberId" = m_id
      );
    END IF;

    v_results := v_results || jsonb_build_object('taskRef', upd->>'taskRef', 'ok', true);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'updated', jsonb_array_length(v_results),
    'results', v_results
  );
END;
$$;

GRANT EXECUTE ON FUNCTION bulk_update_tasks(uuid, jsonb, uuid) TO authenticated, service_role;
```

**Rodar:**
```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && \
  psql "$DIRECT_URL" -f supabase/migrations/<DATE>_bulk_update_tasks.sql
```

**Smoke test:**
```sql
-- Cria 2 tasks de teste
INSERT INTO "Task" (id, "projectId", title, status, "functionPoints", reference, ...)
VALUES (gen_random_uuid(), '<projId>', 'Smoke 1', 'backlog', 5, 'TEST-001', ...),
       (gen_random_uuid(), '<projId>', 'Smoke 2', 'backlog', 8, 'TEST-002', ...);

-- Roda bulk
SELECT bulk_update_tasks(
  '<projId>'::uuid,
  '[
    {"taskRef":"TEST-001","sprintId":"<sprintId>","status":"todo","assigneeIds":["<memId>"]},
    {"taskRef":"TEST-002","sprintId":"<sprintId>","status":"todo","assigneeIds":["<memId>"]}
  ]'::jsonb,
  '<actorId>'::uuid
);

-- Verifica
SELECT reference, "sprintId", status FROM "Task" WHERE reference LIKE 'TEST-%';
SELECT * FROM "TaskAssignment" WHERE "taskId" IN (SELECT id FROM "Task" WHERE reference LIKE 'TEST-%');

-- Cleanup
DELETE FROM "Task" WHERE reference LIKE 'TEST-%';
```

**Após migration:** regerar types
```bash
npx supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts
```

### 6.3 Tools novas no Alpha

Editar [src/lib/agent/agents/alpha/tools.ts](src/lib/agent/agents/alpha/tools.ts), adicionar antes do bloco `// ─── Write tools`:

#### `get_project_capacity` (leitura)

```ts
tools.get_project_capacity = tool({
  description: "Retorna capacity completa do projeto: members (allocation/remaining/committed) + sprints (planejado/disponível). Usar antes de planejar.",
  inputSchema: z.object({
    projectId: z.string().uuid().optional(),
  }),
  execute: async ({ projectId: pid }) => {
    const targetId = pid ?? routeProjectId(route);
    if (!targetId) return { error: "Sem projectId" };

    const [members, sprints] = await Promise.all([
      supabase.from("member_commitment_overview")
        .select("memberId, name, fpCapacity, committed, remaining, projectAllocation")
        .eq("projectId", targetId),
      supabase.from("sprint_capacity_overview")
        .select("sprintId, name, startDate, endDate, status, fpPlanned, fpCapacityTotal")
        .eq("projectId", targetId)
        .order("startDate"),
    ]);
    return { members: members.data, sprints: sprints.data };
  },
});
```

#### `list_unplanned_tasks` (leitura)

```ts
tools.list_unplanned_tasks = tool({
  description: "Lista tasks no backlog (sem sprint) prontas pra alocar. Filtra opcionalmente por module.",
  inputSchema: z.object({
    projectId: z.string().uuid().optional(),
    moduleId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(200).default(100),
  }),
  execute: async ({ projectId: pid, moduleId, limit }) => {
    const targetId = pid ?? routeProjectId(route);
    if (!targetId) return { error: "Sem projectId" };

    let q = supabase.from("Task")
      .select("reference, title, functionPoints, userStoryId, userStory:UserStory(reference, title, moduleId, module:Module(name))")
      .eq("projectId", targetId)
      .eq("status", "backlog")
      .is("sprintId", null)
      .not("userStoryId", "is", null)
      .not("functionPoints", "is", null)
      .limit(limit);
    if (moduleId) q = q.eq("userStory.moduleId", moduleId);

    const { data } = await q;
    return { tasks: data };
  },
});
```

#### `bulk_update_tasks` (escrita, gated)

```ts
if (capabilities.writeTools) {
  tools.bulk_update_tasks = tool({
    description: "Atualiza N tasks de uma vez (sprint, assignees, status). Atomic — rollback em qualquer erro. Use depois de PM confirmar plano em texto.",
    inputSchema: z.object({
      projectId: z.string().uuid(),
      updates: z.array(z.object({
        taskRef: z.string(),
        sprintId: z.string().uuid().nullable().optional(),
        assigneeIds: z.array(z.string().uuid()).optional(),
        status: z.enum(["backlog","todo","doing","review","done"]).optional(),
      })).min(1).max(100),
      reasoning: z.string().min(10),
    }),
    execute: async ({ projectId: pid, updates, reasoning }) => {
      const { data, error } = await supabase.rpc("bulk_update_tasks", {
        p_project_id: pid,
        p_updates: updates,
        p_actor_id: capabilities.actorId,
      });
      if (error) return { error: error.message };
      // Log em AgentUsage
      await logAgentAction("bulk_update_tasks", { count: updates.length, reasoning });
      return data;
    },
  });
}
```

### 6.4 Prompt: seção "Sprint Planning"

Adicionar em [prompt.ts](src/lib/agent/agents/alpha/prompt.ts), após "Hierarquia de produto" (Onda C):

```
## Sprint Planning

Quando aparece o bloco "Capacidade do projeto (planning mode)" no contexto,
você atua como sprint planner.

### Fluxo obrigatório

1. PERGUNTAS ANTES DE PROPOR
Antes de qualquer alocação, faça estas 4 perguntas em uma única mensagem:
   a. "Tem preferência de quem pega o quê? Ex: Lucas só backend, João full-stack."
   b. "Quer priorizar algum module/feature primeiro?"
   c. "Algum builder fora do ar / com capacidade reduzida em algum sprint?"
   d. "Quer que eu cubra todo o backlog ou só os próximos N sprints?"
NUNCA chute essas. Pergunte.

2. DIMENSIONAMENTO
Calcule: total_fp_backlog ÷ capacidade_efetiva_por_sprint = sprints_necessários.
Capacidade efetiva considera as restrições do passo 1 (férias, dedicação parcial).
Se sprints_necessários > sprints_existentes, **proponha criar** os que faltam
via `create_sprint`. Sprints são seg→dom, 7 dias, sequenciais (CHECK no DB
trava — respeite).

3. RESPEITO DE CAPACIDADE
- Soma de FP por (member, sprint) ≤ allocation efetiva.
- Se não cabe, NUNCA force. Empurre tasks pro próximo sprint.
- Se cap total < backlog mesmo com todos os sprints planejados, alerte:
  "Backlog ultrapassa capacidade total — falta um builder ou sprint adicional?"

4. SEGMENTAÇÃO POR ASSIGNEE
- Você não conhece skill por task. Use SÓ o que o PM disser nas preferências.
- Sem preferência → distribua proporcional ao remaining FP de cada builder.
- Tasks sem assignee óbvio: `assigneeIds: []`, PM resolve depois.
- Múltiplos assignees por task são permitidos (M:N) — só use se o PM pedir.

5. PROPOSTA EM TEXTO + CONFIRMAÇÃO
Mostre tabela em texto antes de chamar tools:
```
Proposta — 1 sprint novo + 35 tasks alocadas

[criar] Sprint 9 (2026-05-18→2026-05-24)

Sprint 8 (2026-05-11→2026-05-17, existente):
  João  148/150 → LOGIN frontend (8 tasks)
  Ana    58/60 → AUDIT frontend (4 tasks)
  Lucas  98/100 → BILLING backend (5 tasks)
  Pedro  78/80 → LOGIN backend (4 tasks)
                 total 382/390 FP, 21 tasks

Sprint 9 (sem Ana — férias):
  João  142/150 → BILLING/AUDIT frontend (7 tasks)
  Lucas  95/100 → BILLING backend resto (4 tasks)
  Pedro  75/80 → AUDIT backend (3 tasks)
                 total 312/330 FP, 14 tasks

Backlog após: 0 tasks. Confirma?
```
Após "confirma": chame `create_sprint` (1 chamada por sprint novo) e DEPOIS
`bulk_update_tasks` em UMA chamada com todos os updates.

6. STATUS DEFAULT
Em planejamento, status default vai pra `'todo'` (planejado, não iniciado).
NUNCA mexa em `doing/review/done` sem ordem direta do PM.

7. PREFERÊNCIAS NÃO PERSISTEM
As respostas das perguntas 1a–1d valem só pra esta sessão. Próxima sessão,
pergunte de novo. NÃO chame tools de "salvar preferência" — não existem.
```

### 6.5 Calibração Onda D — 5 cenários

| # | Input | Esperado |
|---|---|---|
| D1 | "organiza o backlog em sprints" (47 tasks, 4 builders) | Alpha **pergunta** as 4 antes de propor |
| D2 | "aloca tudo no Sprint 8" (estoura cap) | Alpha alerta + propõe split em 2 sprints (cria Sprint 9 via `create_sprint`) |
| D3 | "Lucas e Pedro só backend, João full" | Tasks de frontend NÃO vão pro Lucas/Pedro na proposta |
| D4 | Backlog 600 FP / cap total 390 (não cabe nem em 2) | Alpha avisa "falta um builder ou sprint extra?" — NÃO força |
| D5 | "Ana de férias no Sprint 9" | Cap do Sprint 9 recalculada sem Ana, tasks redistribuídas; proposta consistente |

**≥ 90% em 3 runs cada.**

---

## 7. Onda E — Sprint Ribbon Alpha pill (opcional, capricho)

**Objetivo:** transformar pill "Alpha" do ribbon em canal de sugestões reais.

### 7.1 Migration: cache

```sql
CREATE TABLE "AgentSuggestionCache" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId" uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  "sprintId" uuid REFERENCES "Sprint"(id) ON DELETE CASCADE,
  "agentSlug" text NOT NULL DEFAULT 'alpha',
  payload jsonb NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "expiresAt" timestamptz NOT NULL
);
CREATE INDEX agent_suggestion_lookup
  ON "AgentSuggestionCache"("projectId", "sprintId", "agentSlug", "expiresAt");

-- Trigger pra invalidar cache quando sprint/task muda
CREATE OR REPLACE FUNCTION invalidate_agent_suggestion_cache()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "AgentSuggestionCache"
  WHERE "projectId" = COALESCE(NEW."projectId", OLD."projectId");
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER cache_invalidate_on_task_change
  AFTER INSERT OR UPDATE OR DELETE ON "Task"
  FOR EACH ROW EXECUTE FUNCTION invalidate_agent_suggestion_cache();
```

### 7.2 API

`src/app/api/agents/alpha/suggestions/route.ts`:

```
GET ?projectId=X&sprintId=Y → {
  suggestions: Array<{
    id: string;
    severity: 'info' | 'warn';
    title: string;
    detail: string;
    action?: { kind: 'open_story' | 'open_task' | 'apply'; ref: string };
  }>;
  cachedAt: string;
}
```

Implementação: chama Alpha em modo restrito ("max 5 sugestões, JSON estruturado, foco em sprint X"). Output forçado via `responseFormat: zodSchema`. Cache 5min TTL no `AgentSuggestionCache`.

### 7.3 UI

- [ribbon-alerts-pill.tsx](src/components/sprint/sprint-ribbon/ribbon-alerts-pill.tsx) — lazy fetch quando drawer abre, loading state, refresh manual
- [ribbon-drawer.tsx](src/components/sprint/sprint-ribbon/ribbon-drawer.tsx) — 2ª seção "Sugestões do Alpha" após "Alertas". Cliques abrem deep-link ou aplicam ação.

### 7.4 Calibração 3 cenários

| # | Cenário | Esperado |
|---|---|---|
| E1 | Sprint com 3 tasks `done` sem AC validado | sugestão "valide AC pendente em ZRDN-141, ZRDN-142..." |
| E2 | Sprint 80% num module só | sugestão "desbalanço — story do module Y poderia entrar" |
| E3 | Story `refined` há 5+ dias | sugestão "ZRDN-US-014 madura pra committed?" |

---

## 8. Runbook executável (passo-a-passo)

Use este como to-do list. Cada passo tem **input**, **comando**, **gate**.

### Passo 1 — Onda A.1: estender factories de tools (45min)

**Arquivos:**
- [src/lib/agent/tools/create-user-story.ts](src/lib/agent/tools/create-user-story.ts) — `sessionId: string | null`
- [src/lib/agent/tools/create-task.ts](src/lib/agent/tools/create-task.ts) — `sessionId: string | null`
- [src/lib/agent/tools/manage-stories.ts](src/lib/agent/tools/manage-stories.ts) — `listStoriesTool` aceita `sessionId: string | null`

Em cada um, ajustar lógica de idempotência: quando `sessionId === null`, idempotência cai pra (projectId, title) com filtro `refinementStatus IN ('draft','refined')`.

**Gate:**
```bash
bunx tsc --noEmit
npx tsx --require ./scripts/_server-only-shim.cjs scripts/vitor-cli.ts \
  --message "criar uma story de teste" --session "<id>"
# Vitor não regrediu
```

### Passo 2 — Onda A.2: registrar tools no Alpha (45min)

**Arquivo:** [src/lib/agent/agents/alpha/tools.ts](src/lib/agent/agents/alpha/tools.ts)

Imports + registros conforme §3.2.

Adicionar 3 tools wrappers leves: `list_modules`, `list_personas`, `get_story_overview` (~50 linhas cada).

Substituir `tools.create_task` legacy pela versão extendida do `createTaskTool` (mantém comportamento "isolada" quando `userStoryId` ausente).

**Gate:**
```bash
bunx tsc --noEmit
npx tsx --require ./scripts/_server-only-shim.cjs scripts/alpha-cli.ts \
  --message "lista os modules e stories desse projeto" \
  --current-path "/projects/<zordonId>"
# Alpha cita modules/stories reais, não inventa
```

### Passo 3 — Onda B: context loader (1h)

**Arquivos:**
- [src/lib/dal/story-hierarchy.ts](src/lib/dal/story-hierarchy.ts) — adicionar `getAlphaProjectSnapshot(projectId)` (§4.1)
- [src/lib/agent/agents/alpha/context.ts](src/lib/agent/agents/alpha/context.ts) — em `buildProjectFocus`, adicionar `renderTaxonomyBlock` (§4.2)

**Gate:**
```bash
bunx tsc --noEmit
# Cenário: Alpha cita módulo correto sem perguntar
npx tsx --require ./scripts/_server-only-shim.cjs scripts/alpha-cli.ts \
  --message "qual módulo a story 'magic-link' deveria entrar?" \
  --current-path "/projects/<zordonId>"
```

### Passo 4 — Onda C.1: prompt de hierarquia (1h)

**Arquivo:** [src/lib/agent/agents/alpha/prompt.ts](src/lib/agent/agents/alpha/prompt.ts)

Inserir bloco "Hierarquia: Module → UserStory → Task → AC" após Regra 0 (§5.1).

**Gate:** rodar **calibração C** (§5.2 — 5 cenários × 3 runs).

### Passo 5 — Onda C.2: calibração 5 cenários (2h)

Rodar via `alpha-cli.ts` com prompts dos cenários C1–C5. Cada um 3×. Anotar em `docs/alpha-calibration-results.md`:

```markdown
## Story Hierarchy (Onda C) — 2026-MM-DD

### C1 — "criar story 'login com email'"
Run 1: ✅ moduleId=LOGIN, persona=Builder, 3 tasks
Run 2: ✅ ...
Run 3: ✅ ...

### C2 — ...
```

**Gate:** ≥ 90% acerto em todos os 5. Erro = ajustar prompt e rerodar.

### Passo 6 — Onda D.1: migration `bulk_update_tasks` (1h)

**Arquivo:** `supabase/migrations/<DATE>_bulk_update_tasks.sql` (§6.2)

```bash
# Aplicar
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && \
  psql "$DIRECT_URL" -f supabase/migrations/<DATE>_bulk_update_tasks.sql

# Smoke test (§6.2)
psql "$DIRECT_URL" -c "SELECT bulk_update_tasks(...);"

# Regerar types
npx supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts
```

**Gate:** smoke test passa, types regenerados, `bunx tsc --noEmit` limpo.

### Passo 7 — Onda D.2: tools planner (2h)

**Arquivo:** [src/lib/agent/agents/alpha/tools.ts](src/lib/agent/agents/alpha/tools.ts)

Adicionar 3 tools (§6.3):
- `get_project_capacity`
- `list_unplanned_tasks`
- `bulk_update_tasks` (gated por `capabilities.writeTools`)

**Gate:**
```bash
bunx tsc --noEmit
npx tsx --require ./scripts/_server-only-shim.cjs scripts/alpha-cli.ts \
  --message "qual a capacidade desse projeto?" \
  --current-path "/projects/<zordonId>"
# Alpha retorna numbers reais das views
```

### Passo 8 — Onda D.3: prompt "Sprint Planning" + gate planner mode (1h)

**Arquivos:**
- [src/lib/agent/agents/alpha/prompt.ts](src/lib/agent/agents/alpha/prompt.ts) — adicionar §6.4
- [src/lib/agent/agents/alpha/context.ts](src/lib/agent/agents/alpha/context.ts) — implementar gate (§6.1) que injeta `renderPlannerCapacityBlock` quando ≥10 backlog ready + ≥1 ProjectMember

**Gate:**
```bash
bunx tsc --noEmit
# Em projeto com backlog pronto, Alpha deve "entrar em planner mode"
npx tsx --require ./scripts/_server-only-shim.cjs scripts/alpha-cli.ts \
  --message "organiza o backlog em sprints" \
  --current-path "/projects/<zordonComBacklogId>"
# Esperado: Alpha faz as 4 perguntas — não pula
```

### Passo 9 — Onda D.4: calibração planner (2h)

Cenários D1–D5 (§6.5), 3× cada. Anotar em `docs/alpha-calibration-results.md`.

**Gate:** ≥ 90% acerto em todos os 5.

### Passo 10 — Onda E (opcional, 3h)

Se tempo permitir e PM pedir. Pode ficar pra próxima sprint.

### Passo 11 — Smoke E2E em projeto piloto (1h)

Projeto Zordon. Fluxo real:

1. Confirmar projeto tem backlog pronto (≥10 tasks, FP, story setados)
2. Abrir chat com Alpha em `/projects/<zordonId>`
3. Mensagem: "organiza o backlog"
4. Confirmar Alpha entra em planner mode (vê bloco de capacity no prompt)
5. Responder as 4 perguntas
6. Conferir proposta em texto
7. Confirmar "manda"
8. Verificar via psql:
   ```sql
   SELECT reference, "sprintId", status FROM "Task" WHERE "projectId" = '<zordonId>' AND "sprintId" IS NOT NULL;
   SELECT * FROM sprint_member_capacity WHERE "projectId" = '<zordonId>';
   ```
9. Comparar com proposta — bate? Se sim ✅. Se não, debugar.

### Passo 12 — Commits e PR

A cada onda completa:
```bash
bash scripts/sync-main.sh -m "ZRD-JM-NN: alpha — onda X (escopo)"
```

---

## 9. Métricas (após 30 dias em prod)

- ≥ 90% das stories geradas pelo Alpha com `moduleId` correto (PM não muda)
- ≥ 95% das stories com `personaId` correto
- 0 stories com AC vazio
- ≤ 5% de planos de sprint rejeitados pelo PM em "manda"
- Taxa de "ação" em sugestões do ribbon (se Onda E rodar): ≥ 30%
- 0 incidentes de `bulk_update_tasks` parcial (transação garante)

---

## 10. Riscos consolidados

| Risco | Mitigação | Onda |
|---|---|---|
| Estender factories quebra Vitor | Manter `sessionId` opcional, comportamento atual idêntico quando não-null. Rodar `vitor-cli.ts` antes de commitar. | A |
| Alpha confunde modules sinônimos (AUTH/LOGIN) | Prompt §1 + recentStories no contexto. Se persistir, adicionar `Module.aliases: text[]`. | C |
| Alpha gera story duplicada | Idempotência (projectId, title) + prompt §6 (anti-dup). | C |
| Bulk falha no meio | RPC atomic — rollback total + erro retornado por taskRef. | D |
| Capacity stale (PM mudou ProjectMember durante sessão) | RPC revalida `ProjectMember` em cada bulk. | D |
| PM esquece "Ana de férias" | Pergunta #3 obrigatória — Alpha não pula. | D |
| Alpha entra em planner mode em projeto pequeno | Gate §6.1 exige ≥10 tasks backlog ready. | D |
| Sprint criado com data errada | CHECK no DB (Mon→Sun, 7d). Alpha já sabe via memória. | D |
| Cache de sugestões fica stale | TTL 5min + trigger DB que invalida em mudança de Task/Sprint. | E |
| Sugestões do ribbon viram ruído | Limit 5 sugestões. Se PM ignorar consistentemente, recalibrar prompt. | E |

---

## 11. Conventions (recap rápido)

- Migrations via `psql "$DIRECT_URL" -f <path>` — nunca dashboard
- Após migration: regerar `database.types.ts`
- `bunx tsc --noEmit` limpo antes de cada commit
- Commits via `bash scripts/sync-main.sh -m "ZRD-JM-NN: <auto-summary>"`
- Calibração antes de prod: 3 runs por cenário, PM aprova
- Sprints são seg→dom, 7 dias (constraint DB)
- Não criar feature flag — modo planner detecta automaticamente

---

## 12. Resumo de decisões V2 vs V1

| Item | V1 plano | V2 (este) | Razão |
|---|---|---|---|
| Onda 1 (RPCs) | criar `suggest_fp` + `create_user_story_with_tasks` | **DELETED** | refs já existem; suggest_fp é função TS pura; createStory DAL faz o trabalho |
| Onda 4 (tools) | criar 5 tools novas | **REUSAR** factories existentes, estender `sessionId` | 7 tools já prontas em `src/lib/agent/tools/` |
| Bulk tool | tool única ✅ | **mantida** | template `task_acceptance_bulk_diff` confirma padrão |
| Tabela `AgentSuggestionCache` | só timed | **+ trigger invalidação** | cobre stale após mutação |
| Number de ondas | 7 | 5 (A–E) | consolidação de 1+3 em A, 4+5 em C |
| Tempo total | ~22h | **~16h** | reuso de plumbing |

---

## 13. Próximo passo concreto

Pra quem pega esse runbook:

1. Ler §0 (TL;DR) e §8 (Runbook) — 10min
2. **Passo 1 — estender factories** (45min)
3. **Passo 2 — registrar no Alpha** (45min)
4. **CLI test no Zordon** — gate de Onda A
5. Seguir Passos 3–9 sequencial
6. Passo 10 (Ribbon) opcional
7. Passo 11 (smoke E2E) é gate de produção — não pular
8. Passo 12 — commits incrementais por onda

**Não pulou nenhuma calibração.** Erros > 10% em qualquer cenário = volta pro prompt e rerroda. Sem atalhos.
