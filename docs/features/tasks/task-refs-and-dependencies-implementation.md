# Task References + Dependencies — Implementação

**Status:** implementado, 19/19 testes passando, typecheck limpo
**Data:** 2026-05-05
**Origem:** consolidação dos planos [task-reference-by-project-plan.md](task-reference-by-project-plan.md) e [task-dependencies-plan.md](task-dependencies-plan.md) num PR único, com 3 ajustes de produto feitos durante a implementação.

---

## Contexto

Duas dores no fluxo de tasks do Vitor:

1. **Refs misturadas entre projetos** (`TASK-125` podia ser de qualquer projeto) e drafts ficando sem ref alguma.
2. **Dependências armazenadas como JSON livre em `Task.dependencies`** — sem integridade, sem cycle check, sem distinção de tipo, e o Vitor frequentemente deixava o campo vazio em batches porque ter que tracking UUIDs mentalmente não escala.

---

## Decisões de produto (3 ajustes vs plano original)

### 1. Kind nas dependências (`blocks` vs `relates_to`)

Iteração:
- Proposta inicial: sem `kind` (toda dep é "bloqueia").
- Pushback do dono: precisa de kind, porque às vezes só quer linkar pra contexto sem implicar ordem.
- Sugestão de 3 kinds: `blocks` / `relates_to` / `duplicates`.
- Decisão final: cortar `duplicates`.

**Pousou em 2 kinds:**

| kind | Significado | Cycle check |
|---|---|---|
| `blocks` | A não pode começar até B terminar | Sim |
| `relates_to` | Só linka pra contexto, sem ordem | Não |

PK composta `(taskId, dependsOn, kind)` — mesmo par pode ter os 2 kinds. Trigger de ciclo só roda em `kind='blocks'`.

### 2. `dependsOn` aceita refs, não UUIDs (com shorthand)

A insight crucial: o agent operava em UUIDs e por isso falhava em batches. Agora o schema do tool aceita:

- **Shorthand**: `["EVZL-D-005", "EVZL-D-007"]` → todas viram `kind='blocks'`.
- **Forma completa**: `[{ ref: "EVZL-D-005", kind: "relates_to" }]`.

DAL [resolveDependencyInputs](../src/lib/dal/task-dependencies.ts) resolve ref textual → UUID, retorna `missing` separado pra erro útil.

### 3. Drafts em `D-NNN`, troca pra `T-NNN` na promoção

Problema observado: a draft `ZRDN-T-030` estava consumindo número da sequência principal. Se descartada, deixava buraco.

**Solução:** sequência separada `<KEY>-D-NNN` pra drafts. RPC `next_draft_task_reference(uuid)`. Promoção (`export/route.ts` e `promoteTasksForModule`) detecta ref `D-NNN` e **substitui por `T-NNN`**. A sequência T-NNN só é consumida quando a task vira oficial.

Backfill compactou Zordon: a única draft virou `ZRDN-D-001` e a sequência T ficou contígua `ZRDN-T-001..088` (o 30 voltou pra livre).

---

## Banco

### Migration 1 — refs por projeto + TaskDependency

[supabase/migrations/20260505_task_refs_and_dependencies.sql](../supabase/migrations/20260505_task_refs_and_dependencies.sql), tudo numa transação:

- Backups defensivos (`_backup_zordon_refs_20260505`, `_backup_task_dependencies_20260505`).
- Substituiu `next_task_reference()` global por `next_task_reference(uuid)` retornando `<KEY>-T-NNN`.
- Backfill Zordon: 89 tasks viraram `ZRDN-T-001..089` (depois compactado pra 88 na migration 2).
- Tabela `TaskDependency`:
  - `taskId` (FK CASCADE), `dependsOn` (FK RESTRICT), `kind`, `createdAt`.
  - PK composta com `kind`. CHECK no kind. CHECK anti self-loop.
  - Índice em `dependsOn` (reverse lookup).
  - RLS espelhando padrão de TaskTagAssignment (project-scoped via Task).
  - Trigger de cycle detection com CTE recursiva, filtrando `kind='blocks'`.
- Backfill JSON antigo (vazio na prática — as tasks com deps já tinham sido deletadas).
- Drop `Task.dependencies`.

### Migration 2 — drafts em D-NNN

[supabase/migrations/20260505_draft_task_references.sql](../supabase/migrations/20260505_draft_task_references.sql):

- RPC `next_draft_task_reference(uuid)` com regex `\-D\-`.
- Backfill: drafts existentes em T-NNN viram D-NNN.
- Compactação da sequência T-NNN do Zordon (88 contíguas).

### Schema final relevante

```sql
-- Task table: coluna `dependencies` removida.

CREATE TABLE "TaskDependency" (
  "taskId"    uuid NOT NULL REFERENCES "Task"(id) ON DELETE CASCADE,
  "dependsOn" uuid NOT NULL REFERENCES "Task"(id) ON DELETE RESTRICT,
  "kind"      text NOT NULL DEFAULT 'blocks'
    CHECK ("kind" IN ('blocks', 'relates_to')),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("taskId", "dependsOn", "kind"),
  CONSTRAINT taskdep_no_self_loop CHECK ("taskId" <> "dependsOn")
);

-- RPCs:
--   next_task_reference(p_project_id uuid)        → '<KEY>-T-NNN'
--   next_draft_task_reference(p_project_id uuid)  → '<KEY>-D-NNN'
```

---

## Código

### Backend

| Arquivo | Mudança |
|---|---|
| [src/lib/dal/task-dependencies.ts](../src/lib/dal/task-dependencies.ts) | **Novo.** DAL: `resolveDependencyInputs`, `setDependenciesForTask` (replace strategy), `addDependency`, `removeDependency`, `listDependenciesForTask`, `listDependentsOfTask`. |
| [src/lib/agent/tools/create-task.ts](../src/lib/agent/tools/create-task.ts) | Schema `dependsOn` polimórfico (string ou objeto). Gera ref via `next_draft_task_reference`. INSERT+UPDATE paths chamam `setDependenciesForTask`. Retorna `reference` na resposta. |
| [src/lib/agent/tools/manage-tasks.ts](../src/lib/agent/tools/manage-tasks.ts) | `listSessionTasksTool` hidrata deps com refs amigáveis. `updateTaskTool` aceita schema novo. |
| [src/app/api/tasks/[id]/dependencies/route.ts](../src/app/api/tasks/[id]/dependencies/route.ts) | **Novo.** GET retorna `{dependsOn, dependents}`, PUT replaceia o conjunto. Cycles surgem como 422. |
| [src/lib/agent/prompt.ts](../src/lib/agent/prompt.ts) | Vitor instruído a usar refs e escolher kind. Template do `notes` reescrito: **não duplicar deps**, reservado pra Risco/Validação/Tempo/Habilita-prosaico. |

**6 callers de `next_task_reference()` atualizados** pra passar `p_project_id`:
- [src/app/api/tasks/route.ts](../src/app/api/tasks/route.ts) (POST)
- [src/app/api/tasks/[id]/clone/route.ts](../src/app/api/tasks/[id]/clone/route.ts)
- [src/app/api/tasks/[id]/duplicate/route.ts](../src/app/api/tasks/[id]/duplicate/route.ts)
- [src/app/api/design-sessions/[id]/export/route.ts](../src/app/api/design-sessions/[id]/export/route.ts) — também detecta `D-NNN` e substitui
- [src/lib/dal/story-hierarchy.ts](../src/lib/dal/story-hierarchy.ts) (`promoteTasksForModule`) — também detecta `D-NNN` e substitui
- [src/lib/meetings/task-action-executor.ts](../src/lib/meetings/task-action-executor.ts)
- [src/lib/agent/agents/alpha/tools.ts](../src/lib/agent/agents/alpha/tools.ts)

### Frontend

| Arquivo | Mudança |
|---|---|
| [src/components/story-hierarchy/dependencies-block.tsx](../src/components/story-hierarchy/dependencies-block.tsx) | **Novo.** 3 seções: "Bloqueada por", "Bloqueia", "Relacionada". Input + select de kind. Status badge nos chips. Optimistic + refetch on PUT. |
| [src/components/story-hierarchy/task-sheet.tsx](../src/components/story-hierarchy/task-sheet.tsx) | Plug do bloco entre Notas e TaskFeed. |

### Types

| Arquivo | Mudança |
|---|---|
| [src/lib/supabase/database.types.ts](../src/lib/supabase/database.types.ts) | Adicionado `TaskDependency`. Removido `Task.dependencies`. Ambas RPCs (`next_task_reference` + `next_draft_task_reference`) com signature `(p_project_id: string)`. |

---

## Test harness

[scripts/test-task-deps-migration.ts](../scripts/test-task-deps-migration.ts) — 19 verificações end-to-end:

1. RPCs retornam formato correto (FRGE-T, ZRDN-T, FRGE-D).
2. Zordon T-NNN contígua sem buracos.
3. Drafts Zordon em D-NNN.
4. Tabela TaskDependency acessível.
5. `resolveDependencyInputs` lida com refs + UUIDs + missing.
6. `listDependenciesForTask` retorna kinds corretos.
7. `listDependentsOfTask` retorna reverse edge.
8. `setDependenciesForTask` replace strategy.
9. Self-loop rejeitado pela CHECK.
10. Cadeia blocks T1→T2→T3 OK.
11. Cycle em blocks rejeitado pelo trigger.
12. Cycle em relates_to permitido.
13. ON DELETE CASCADE no taskId.
14. Draft RPC gera D-NNN.
15. Promoção draft→backlog troca D-NNN por T-NNN.
16. ON DELETE RESTRICT no dependsOn.

(Os 19 incluem sub-asserts dentro dos 16 grupos acima.)

**Rodar:**

```bash
source <(grep -E '^(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' .env | sed 's/^/export /') && \
  npx tsx --require ./scripts/_server-only-shim.cjs scripts/test-task-deps-migration.ts
```

Cleanup automático das tasks de teste no FORGE. Re-rodável.

---

## Fluxo final do Vitor

**Antes:**

```
create_task({ ..., dependsOn: ["faccd26b-..."] })
  ← persiste JSON em Task.dependencies, sem validação
  ← Vitor tem que tracking UUIDs em batches → vazio na prática
```

**Depois:**

```
create_task({ ..., dependsOn: ["EVZL-D-001"] })       // shorthand = blocks
create_task({ ..., dependsOn: [{ ref: "EVZL-D-001", kind: "relates_to" }] })
  ← gera ref EVZL-D-NNN automaticamente
  ← grava em TaskDependency com kind, valida ciclo, FK enforce
  ← retorna `reference` na resposta pra próxima iteração

[promoção pelo dono via export route]
  ← EVZL-D-001 vira EVZL-T-001
  ← rows em TaskDependency seguem (FK por id, ref é só metadata)
```

UI mostra os 3 blocos na TaskSheet, com chips clicáveis e status badge. Add via input + dropdown de kind.

---

## Convivência com refs legadas

Eval-zelar, FORGE e Zelar mantêm tasks legadas com `TASK-NNN` global (sem prefixo de projeto). Conviventes. Não vale renumerar — são projetos pequenos/eval.

A regex `\-T\-(\d+)$` da função nova **não bate** em `TASK-NNN`, então a sequência por projeto reinicia limpa.

---

## Convenções pra próximas tasks

### Quem usa qual ref

- **Tasks criadas pelo agent** (Vitor) em design session → nascem em `<KEY>-D-NNN`.
- **Tasks criadas via API REST** (POST `/api/tasks`) → nascem em `<KEY>-T-NNN`.
- **Tasks promovidas via export route ou `promoteTasksForModule`** → ref D-NNN é trocada por T-NNN.

### Cycle detection escopo

Ciclos são bloqueados **somente em `kind='blocks'`**. Em `relates_to`, ciclos são permitidos (são informativos, sem implicação de ordem).

### Schema do tool `dependsOn`

```typescript
dependsOn: Array<
  | string                                       // shorthand → kind='blocks'
  | { ref: string; kind?: "blocks" | "relates_to" }
>
```

Refs aceitam tanto `<KEY>-T-NNN` quanto `<KEY>-D-NNN` quanto UUID. Resolução é case-sensitive na ref e scope-locked ao mesmo projeto.

### Higiene do campo `notes`

**Não duplicar deps em `notes`.** O campo é reservado pra:
- `**Habilita:**` (descrição prosaica do impacto, não lista de refs)
- `**Risco:**`
- `**Estratégia de validação:**`
- `**Ref:**` / `**Ref:research:**` / `**Ref:decision:**`
- `**Tempo estimado:**`

Refs de tasks que precisam estar prontas antes vão **só** no campo estruturado `dependsOn`.

---

## Rollback (se precisar)

### Migration 2 (drafts)

```sql
-- Reverter D-NNN pra T-NNN: precisa decisão por task. Não há rollback automático
-- porque a sequência T-NNN foi compactada. Restaurar via _backup_zordon_refs_20260505:
UPDATE "Task" t
SET reference = b.reference
FROM _backup_zordon_refs_20260505 b
WHERE t.id = b.id;

DROP FUNCTION public.next_draft_task_reference(uuid);
```

### Migration 1 (refs + deps)

```sql
-- Recriar Task.dependencies (text), reconstituir do TaskDependency:
ALTER TABLE "Task" ADD COLUMN dependencies text;
UPDATE "Task" t
SET dependencies = (
  SELECT jsonb_agg("dependsOn")::text
  FROM "TaskDependency"
  WHERE "taskId" = t.id
);

DROP TABLE "TaskDependency";
DROP FUNCTION public.taskdep_no_cycle();

-- Restaurar refs Zordon antigas (TASK-NNN globais):
UPDATE "Task" t
SET reference = b.reference
FROM _backup_zordon_refs_20260505 b
WHERE t.id = b.id;

-- E reverter o code change via git revert.
```

Backups ficam em `_backup_*_20260505`. Manter pelo menos 7 dias após confirmação.
