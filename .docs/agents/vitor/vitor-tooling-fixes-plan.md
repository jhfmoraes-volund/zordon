# Plano de Correção — Vitor Tooling Gaps (Críticos + Altos)

**Data:** 2026-05-06
**Origem:** [vitor-orchestration-audit.md](vitor-orchestration-audit.md) — Achados #1, #2, #3
**Objetivo:** desbloquear Alpha-orquestrador corrigindo os 3 gaps que impedem ciclos de refinamento autônomo.
**Esforço estimado:** 4-6h dev + 1h auditoria de regressão.

---

## Resumo executivo

3 achados, 1 PR único:

| # | Achado | Severidade | Arquivos | Esforço |
|---|--------|-----------|----------|---------|
| 1 | Vitor não tem `update_user_story`/`manage_story_ac`/`delete_user_story` | CRÍTICO | `tools.ts` + nova fn em `manage-stories.ts` | 1h |
| 2 | `approve_module` do Vitor não promove tasks `draft→backlog` | ALTO | `manage-stories.ts` + `tools.ts` | 2h |
| 3 | `list_project_tasks` quebrado (FK `Task.designSessionId` ausente) | ALTO | 1 migration + regenerar `database.types.ts` | 30min |

Após correção, **re-rodar EVZL ou rodar projeto novo do zero** com mesmo perfil de runbook pra validar regressão zero (§Auditoria de regressão).

---

## Achado #1 — CRÍTICO — Tools de edição/exclusão de story pro Vitor

### Problema

Vitor expõe apenas:
- `create_user_story` (idempotente por título — se passar título novo, cria duplicata)
- `set_story_refinement` (transição draft→refined→committed)

Quando PM pede "renomeie esta story" ou "remove LGPD do título de US-003", Vitor cai em fallback de `create_user_story(novo título)` — cria **duplicata silenciosamente**.

Tools que **já existem** no codebase mas só são registradas pro Alpha (`assembleAlphaTools` em [src/lib/agent/agents/alpha/tools.ts:536](../src/lib/agent/agents/alpha/tools.ts#L536)):
- `updateStoryForOpsTool` (em [alpha-hierarchy.ts:289](../src/lib/agent/tools/alpha-hierarchy.ts#L289)) — atualiza title/want/soThat/moduleId/personaId
- `manageStoryAcForOpsTool` (em [alpha-hierarchy.ts:440](../src/lib/agent/tools/alpha-hierarchy.ts#L440)) — add/edit/remove AC

Tool que **não existe pra ninguém** (mas DAL já existe):
- `delete_user_story` — DAL `deleteStory(id)` em [story-hierarchy.ts:316](../src/lib/dal/story-hierarchy.ts#L316) é uma linha (`delete().eq("id", id)`)

### Plano de correção

#### 1.1. Reusar `updateStoryForOpsTool` e `manageStoryAcForOpsTool` pro Vitor

**Decisão de design:** as tools do Alpha funcionam por `reference` (`EVZL-US-NNN`) e validam `projectId`. **Idênticas ao que Vitor precisa.** Não precisa nova fn.

Em [src/lib/agent/tools.ts:196-203](../src/lib/agent/tools.ts) (bloco `if (capabilities?.createTasks && capabilities?.projectId)`), adicionar:

```ts
// near line 13 — adicionar imports
import {
  updateStoryForOpsTool,
  manageStoryAcForOpsTool,
} from "./tools/alpha-hierarchy";

// dentro do bloco createTasks:
tools.update_user_story = updateStoryForOpsTool(capabilities.projectId);
tools.manage_story_ac = manageStoryAcForOpsTool(capabilities.projectId);
```

**Atenção ao naming dos arquivos:** `alpha-hierarchy.ts` virou nome equivocado — as fns ali são reutilizáveis pelos 2 agentes. Se quiser limpar, mover pra `manage-stories.ts` num PR separado (não bloqueante).

#### 1.2. Criar `deleteUserStoryTool` (novo)

Adicionar em [src/lib/agent/tools/manage-stories.ts](../src/lib/agent/tools/manage-stories.ts):

```ts
export function deleteUserStoryTool(projectId: string) {
  return tool({
    description:
      "Deleta uma story que NUNCA teve tasks aprovadas. Use APENAS após confirmar com o usuário (Regra 0). Refuses se a story tem tasks com status != 'draft' — caller deve mover/deletar tasks primeiro.",
    inputSchema: z.object({
      reference: z.string().min(3),
      reasoning: z.string().min(10),
    }),
    execute: async ({ reference }) => {
      const story = await getStoryByReference(reference);
      if (!story) {
        return { success: false, notFound: true, message: `Story ${reference} não encontrada.` };
      }
      if (story.projectId !== projectId) {
        return { success: false, message: "Story pertence a outro projeto." };
      }

      // Pre-flight: bloqueia se tem tasks fora de 'draft'
      const supabase = db();
      const { data: nonDraftTasks } = await supabase
        .from("Task")
        .select("reference, status")
        .eq("userStoryId", story.id)
        .neq("status", "draft");
      if (nonDraftTasks && nonDraftTasks.length > 0) {
        return {
          success: false,
          message: `Story tem ${nonDraftTasks.length} task(s) não-draft: ${nonDraftTasks.map(t => `${t.reference}(${t.status})`).join(", ")}. Mova ou delete antes.`,
          blocking: nonDraftTasks,
        };
      }

      // Deleta tasks draft em cascata, depois story (FK ON DELETE SET NULL não aciona cascata aqui — limpamos explicitamente)
      const { data: draftTasks } = await supabase
        .from("Task").select("id").eq("userStoryId", story.id);
      if (draftTasks && draftTasks.length > 0) {
        await supabase.from("Task").delete().in("id", draftTasks.map(t => t.id));
      }

      await deleteStory(story.id);
      return { success: true, deletedStoryRef: reference, deletedTasks: draftTasks?.length ?? 0 };
    },
  });
}
```

E registrar em `tools.ts` no bloco createTasks:

```ts
tools.delete_user_story = deleteUserStoryTool(capabilities.projectId);
```

**Decisão:** ao deletar uma story, deletar tasks `draft` em cascata. Pre-flight bloqueia se há task não-draft (essas precisam ser movidas via UI/Alpha antes — proteção contra perda de trabalho de sprint ativo).

**Nota:** essa tool **não cobre o caso "mover task pra outra story"** — gap separado endereçado se necessário em PR pós-Alpha. Por enquanto, se PM precisa unificar 2 stories, faz: (a) deletar tasks draft da story velha, (b) `update_user_story` com título consolidado, (c) recriar tasks na story consolidada via `create_task`. Não ideal mas funciona.

#### 1.3. Atualizar prompt do Vitor

Em [src/lib/agent/prompt.ts](../src/lib/agent/prompt.ts), na seção de tools/Regra 0 do `task_breakdown`, adicionar:

```
EDIÇÃO de stories:
- Pra alterar título/want/soThat/moduleId/personaId de uma story existente, use `update_user_story(reference, patch)`. NÃO use `create_user_story` com título novo (cria duplicata).
- Pra alterar AC, use `manage_story_ac(reference, operations)`.
- Pra deletar uma story sem tasks aprovadas, use `delete_user_story(reference)`.
- Antes de qualquer dessas: mostre o diff em texto e confirme com o PM.
```

### Critério de done — Achado #1

- [ ] `tools.update_user_story`, `tools.manage_story_ac`, `tools.delete_user_story` registrados pro Vitor
- [ ] `deleteUserStoryTool` implementada com pre-flight de tasks não-draft
- [ ] Prompt do Vitor atualizado com instruções de edição
- [ ] Smoke-test manual: rodar V14-equivalente em projeto novo (`update_user_story` muda título sem criar duplicata)

---

## Achado #2 — ALTO — `approve_module_full` consolidada

### Problema

Hoje há **2 caminhos divergentes** pra aprovar um módulo:

1. **Endpoint HTTP** `POST /api/modules/[id]/approve` ([route.ts](../src/app/api/modules/[id]/approve/route.ts)) — faz tudo certo: `approvedAt + promoteTasksForModule + ModuleActivity`. Requer auth MANAGER.
2. **Tool `approve_module`** do Vitor ([manage-stories.ts:92](../src/lib/agent/tools/manage-stories.ts#L92)) — só faz `approvedAt + linka stories pendentes`. **Não promove tasks `draft→backlog`**. Não insere `ModuleActivity`.

Inconsistência herdada. No runbook EVZL, criei `scripts/approve-module-cli.ts` como workaround pra simular o endpoint HTTP em CLI. Solução boa pra CLI, ruim pro Alpha-orquestrador.

### Plano de correção

#### 2.1. Renomear/refatorar `approveModuleTool` pra ser completa

Decisão de design: **renomear `approveModuleTool` pra `approveModuleFullTool` e fazer ela cascadear**, em vez de criar tool nova. Motivos:

- A tool atual já marca `approvedAt`. Adicionar promoteTasks + ModuleActivity não muda contrato externo (só o efeito).
- Quem chama hoje: só Vitor (registrado em `tools.ts:196`). Risco de regressão zero.

Edição em [src/lib/agent/tools/manage-stories.ts:92-194](../src/lib/agent/tools/manage-stories.ts#L92):

```ts
import { promoteTasksForModule } from "@/lib/dal/story-hierarchy";

export function approveModuleTool(projectId: string, approverId: string) {
  return tool({
    description:
      "Promove um proposedModuleName em Module aprovado E PROMOVE tasks draft→backlog em cascata. Use APENAS após confirmação explícita do PM. Insere ModuleActivity para auditoria.",
    inputSchema: z.object({
      proposedName: z.string().min(1),
      finalName: z.string().optional(),
    }),
    execute: async ({ proposedName, finalName }) => {
      const supabase = db();
      const moduleName = finalName ?? proposedName;

      // 1. Find or create the Module (lógica atual mantida)
      const existingMod = await supabase.from("Module").select("id, name, approvedAt")
        .eq("projectId", projectId).eq("name", moduleName).maybeSingle();
      if (existingMod.error) return { success: false, error: existingMod.error.message };

      let moduleId: string;
      const nowIso = new Date().toISOString();
      let moduleAlreadyExisted = false;
      if (existingMod.data) {
        moduleId = existingMod.data.id;
        moduleAlreadyExisted = true;
        if (!existingMod.data.approvedAt) {
          await supabase.from("Module").update({
            approvedAt: nowIso, approvedBy: approverId, updatedAt: nowIso
          }).eq("id", moduleId);
        }
      } else {
        const { data: created, error } = await supabase.from("Module").insert({
          projectId, name: moduleName, approvedAt: nowIso, approvedBy: approverId
        }).select("id").single();
        if (error) return { success: false, error: error.message };
        moduleId = created!.id;
      }

      // 2. Linka stories pendentes (lógica atual)
      const candidates = await supabase.from("UserStory").select("id")
        .eq("projectId", projectId).eq("proposedModuleName", proposedName);
      const storyIds = (candidates.data ?? []).map((s) => s.id);
      if (storyIds.length > 0) {
        await supabase.from("UserStory").update({
          moduleId, proposedModuleName: null, updatedAt: nowIso
        }).in("id", storyIds);
      }

      // 3. NOVO: promove tasks draft → backlog
      const { promoted, totalFp } = await promoteTasksForModule(moduleId);

      // 4. NOVO: insere ModuleActivity
      await supabase.from("ModuleActivity").insert({
        moduleId, type: "approved",
        payload: { promoted, totalFp, viaTool: "approve_module" },
        actorMemberId: approverId,
      });

      return {
        success: true,
        moduleId,
        moduleName,
        moduleAlreadyExisted,
        storiesPromoted: storyIds.length,
        tasksPromoted: promoted,
        totalFp,
      };
    },
  });
}
```

#### 2.2. Atualizar registro em `tools.ts`

A signature mudou (`approverId` agora é parâmetro). Em [src/lib/agent/tools.ts:196](../src/lib/agent/tools.ts#L196):

```ts
// antes: tools.approve_module = approveModuleTool(capabilities.projectId);
// depois:
tools.approve_module = approveModuleTool(capabilities.projectId, capabilities.memberId);
```

#### 2.3. Aposentar `scripts/approve-module-cli.ts`

Após validação, marcar como deprecated (manter por backward-compat de 1 sprint, depois deletar). Usuários que faziam `bun x tsx scripts/approve-module-cli.ts ...` agora podem chamar via Vitor: "aprova o módulo X".

### Critério de done — Achado #2

- [ ] `approveModuleTool` faz cascade completo (approvedAt + linka + promoteTasksForModule + ModuleActivity)
- [ ] `tools.ts` passa `capabilities.memberId` como `approverId`
- [ ] Endpoint HTTP `POST /api/modules/[id]/approve` continua funcional (regressão UI)
- [ ] Smoke-test: rodar `bun x tsx scripts/vitor-cli.ts ... --message "aprova o módulo XYZ"` — ver `tasksPromoted > 0`

---

## Achado #3 — ALTO — FK `Task.designSessionId → DesignSession.id` ausente

### Problema

`list_project_tasks` ([manage-tasks.ts:63](../src/lib/agent/tools/manage-tasks.ts#L63)) faz join Supabase:

```ts
.select("reference, title, status, designSessionId, designSession:DesignSession(title)")
```

Erro retornado: `Could not find a relationship between 'Task' and 'DesignSession' in the schema cache`.

**Causa raiz** (verificada via psql):

```sql
SELECT conname FROM pg_constraint
WHERE conrelid = 'public."Task"'::regclass AND contype = 'f';
-- Retorna apenas: createdById, projectId, sprintId, userStoryId
-- FK Task.designSessionId NÃO existe no DB.
```

A coluna `Task.designSessionId UUID` existe, mas sem FK. PostgREST não consegue inferir o JOIN.

### Plano de correção

#### 3.1. Migration — adicionar FK

Criar `supabase/migrations/20260506_task_designsession_fk.sql`:

```sql
-- Adiciona FK Task.designSessionId → DesignSession.id (faltava no schema, quebrava list_project_tasks via PostgREST)
-- ON DELETE SET NULL: se uma DesignSession for deletada, tasks órfãs ficam sem session reference (não derruba histórico de tasks)

-- Pre-flight: garantir que não há orphans antes de criar FK
DELETE FROM public."Task" t
WHERE t."designSessionId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public."DesignSession" ds WHERE ds.id = t."designSessionId"
  );
-- (Se houver orphans, o DELETE acima limpa. Em produção esperamos 0 — verificar antes de rodar.)

ALTER TABLE public."Task"
  ADD CONSTRAINT "Task_designSessionId_fkey"
  FOREIGN KEY ("designSessionId")
  REFERENCES public."DesignSession"(id)
  ON DELETE SET NULL;

-- Notify PostgREST a recarregar schema cache
NOTIFY pgrst, 'reload schema';
```

#### 3.2. Aplicar via psql conforme convenção do projeto

```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && \
psql "$DIRECT_URL" -f supabase/migrations/20260506_task_designsession_fk.sql
```

#### 3.3. Regenerar `database.types.ts`

Conforme [AGENTS.md](../../../AGENTS.md):

```bash
# (comando depende do setup do projeto — provavelmente)
bun run supabase:types
# ou:
bunx supabase gen types typescript --linked > src/lib/supabase/database.types.ts
```

#### 3.4. Validar

```bash
# Restart Next dev server (PostgREST cache pode precisar reload)
# Testar via vitor-cli:
bun x tsx --require ./scripts/_server-only-shim.cjs scripts/vitor-cli.ts \
  --session <uma_session_inception_qualquer> \
  --message "list_project_tasks pra ver tasks de outras sessions"
# Esperado: success:true, tasks com sessionTitle preenchido
```

### Critério de done — Achado #3

- [ ] Migration aplicada via psql
- [ ] `database.types.ts` regenerado e committed
- [ ] `list_project_tasks` retorna `success:true` com `sessionTitle` preenchido
- [ ] 0 orphans no pre-flight (verificar antes de rodar a migration; se houver, investigar antes)

---

## Auditoria de regressão (processo)

Após aplicar os 3 fixes, **rodar projeto novo do zero** com runbook similar ao EVZL pra validar que nada quebrou e que os gaps fecharam. Reuso o framework de categorias do [vitor-orchestration-audit.md](vitor-orchestration-audit.md).

### Setup do teste

**Não usar EVZL** (estado já contaminado). Criar projeto eval novo:

```sql
-- Criar projeto teste
INSERT INTO public."Project" (name, "referenceKey", "ownerMemberId")
VALUES ('Eval Vitor Tooling Fix', 'EVTF', 'dc4d91f5-0d29-453a-b11e-d42dd6a7b158')
RETURNING id;
```

Criar nova DesignSession inception, ir até step 9 (briefing), com pelo menos 8-10 cards mock no brainstorm que cubram:
- 2 cards que precisam ser unificados (mesmas tags, jornada contínua) — testa #1
- 1 card "fora-de-escopo" pra testar `delete_user_story`
- 1 card com integração externa "A VALIDAR" pra testar `add_open_question`

Cards mock podem ser inseridos via SQL na `DesignSessionStepData` se mais rápido que via UI.

### Roteiro de auditoria (8 turns no Vitor)

| # | Prompt-tipo | O que valida | Critério de pass |
|---|-------------|--------------|------------------|
| R1 | Discovery do módulo X com cards mock | Baseline funcional após fixes — Vitor lê brainstorm + propõe stories | Output em formato esperado, propõe N stories |
| R2 | "Crie as stories e tasks" | `create_user_story` + `create_task` em cascade | Stories committed, tasks com FP |
| R3 | "Renomeie US-001 pra título Y" | **Achado #1**: `update_user_story` chamada, sem duplicata | DB tem 1 story (não 2) com título Y |
| R4 | "Adicione AC novo em US-002 e remova o AC#3" | **Achado #1**: `manage_story_ac` chamada com ops add+remove | AC count atualizado, ordem preservada |
| R5 | "Delete US-003 (não tem tasks ainda)" | **Achado #1**: `delete_user_story` chamada com sucesso | Story sumiu do DB |
| R6 | "List_project_tasks pra mapear inter-deps" | **Achado #3**: list_project_tasks retorna success | success:true, array de tasks |
| R7 | "Aprova o módulo" | **Achado #2**: `approve_module` faz cascade completo | tasksPromoted > 0, ModuleActivity inserida, status backlog |
| R8 | "Há cards bucket=mvp não cobertos?" | Self-audit final, sanity geral | Output cobertura ≥ 90% |

### Métricas de pass/fail

Pra cada turn, marcar:

| # | Tools chamadas | Categoria (espelho do audit) | Pass? |
|---|---------------|------------------------------|-------|
| R1 | _ | _ | _ |
| R2 | _ | _ | _ |
| ... | | | |

**Critérios de aprovação global:**

- [ ] **8/8 turns categoria ≠ fora-do-scope** (no audit original era 1/15 fora-do-scope; meta agora é 0)
- [ ] **0 stories zumbis no DB ao final** (meta = 0; baseline EVZL tinha 4)
- [ ] **`list_project_tasks` retorna success em pelo menos 1 turn** (R6)
- [ ] **`tasksPromoted > 0` em `approve_module` em R7**
- [ ] **0 falhas de tool não auto-recuperadas**
- [ ] **Cobertura MVP ≥ 90%** no R8

### Regressões a verificar (não-fixes)

Validar que **nada quebrou** no que já funcionava:

- [ ] `create_user_story` ainda funciona (R2)
- [ ] `create_task` ainda funciona com `dependsOn` (R2)
- [ ] Endpoint HTTP `/api/modules/[id]/approve` ainda funciona pelo UI (botão Aprovar)
- [ ] `set_story_refinement` ainda transiciona draft → refined → committed (R2)
- [ ] Aprovação via UI continua produzindo `ModuleActivity` (não duplicada vs aprovação via Vitor)

### Output esperado

Salvar resultado em `docs/vitor-tooling-fix-validation.md` com mesmo formato do `alpha-audit.md`:

- Tabela de turns R1-R8 com tools chamadas + categoria + pass/fail
- Tally final
- Decisão **GO Alpha Fase 1** (ou listar gaps remanescentes)

---

## Cronograma sugerido

| Etapa | Esforço | Quem |
|-------|--------|------|
| 1. Achado #3 (FK migration) | 30min | Engenheiro |
| 2. Achado #1 (registrar tools + delete + prompt) | 1h | Engenheiro |
| 3. Achado #2 (refactor approve_module + tools.ts) | 2h | Engenheiro |
| 4. Smoke-tests manuais por achado | 30min | Engenheiro |
| 5. Setup projeto EVTF + cards mock | 30min | PM/Engenheiro |
| 6. Auditoria de regressão (R1-R8) | 1h | PM (orquestrador) |
| 7. Escrever `vitor-tooling-fix-validation.md` | 30min | PM |
| **Total** | **~6h** | |

---

## Critério final de "GO Alpha Fase 1"

Após este plano executado e auditoria de regressão passar, considera-se Vitor pronto pra ser orquestrado pelo Alpha. Pré-requisitos:

- [x] Achado #1 — Vitor edita stories sem criar duplicatas
- [x] Achado #2 — `approve_module` faz cascade completo
- [x] Achado #3 — `list_project_tasks` retorna sem erro
- [x] Auditoria de regressão R1-R8 com 0 falhas categoria fora-do-scope
- [x] 0 stories zumbis no projeto de validação
- [x] Cobertura MVP ≥ 90% no projeto de validação
- [ ] (Bonus, não bloqueante) — Achados #4 (autoConfirm capability), #6 (open_question hint), #8 (add_task_dependency tool)

Quando todos checked → **iniciar prototype Alpha-orquestrador**, alimentando-o com:

- 10 heurísticas automatizáveis ([vitor-orchestration-audit.md §Padrões automatizáveis](vitor-orchestration-audit.md))
- 7 critérios de "pronto" mensuráveis
- 5 pontos onde humano permanece essencial (escalation list)

---

## Próximos passos imediatos

1. **Revisar este plano com PM** (você) — confirmar que Achado #1 cobertura adequada, Achado #2 abordagem (refactor vs nova tool), Achado #3 estratégia da migration.
2. **Criar branch `vitor-tooling-fixes`** e fazer 3 commits separados (1 por achado) pra facilitar revert isolado.
3. **Rodar auditoria de regressão** (R1-R8) ao final.
4. **Atualizar `vitor-orchestration-audit.md`** com link pro `vitor-tooling-fix-validation.md` e mudar status do go/no-go pra "GO Fase 1 ✅".
