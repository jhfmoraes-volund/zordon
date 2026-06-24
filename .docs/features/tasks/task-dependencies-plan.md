# Task Dependencies — Plano de Migração e Implementação

**Status:** pronto pra execução
**Owner:** agente delegado
**Data do plano:** 2026-05-05
**Pré-requisito:** [task-reference-by-project-plan.md](task-reference-by-project-plan.md) precisa estar APLICADO antes desta migração (depende do formato `<KEY>-T-NNN` estar em produção).

---

## Contexto

Hoje `Task.dependencies` é uma coluna `text` que armazena `JSON.stringify(string[])` — array opaco de strings, geralmente UUIDs. Limitações:

1. **Sem integridade referencial**: UUIDs apontam pra tasks que podem ter sido deletadas — o JSON fica órfão e silencioso.
2. **Sem query reversa eficiente**: "quais tasks dependem de T1?" exige scan + parse de todos os JSON da tabela.
3. **Sem detecção de ciclo**: nada impede A → B → A.
4. **Ilegível**: UUIDs não dizem nada — quando o agent registra `dependsOn: ["faccd26b-..."]` o PM não consegue ler.
5. **Vitor frequentemente deixa vazio em batches** porque não tem UUID em mãos quando cria múltiplas tasks numa transação mental (ver "Estado atual observado" abaixo).

**Objetivo:** trocar o JSON-text por uma tabela relacional `TaskDependency`, aceitar refs `<KEY>-T-NNN` como input do agent (em vez de UUIDs), e expandir capacidade pra dependências inter-story.

---

## Estado atual observado (medido em 2026-05-05)

Inspeção do que Vitor de fato persistiu durante a calibração na sessão eval-zelar:

| Story | Tasks | Tasks com `dependencies` preenchido | Formato |
|---|---|---|---|
| EVZL-US-033 (story-única) | 3 | 2 | UUIDs ✅ |
| EVZL-US-028 (story-única tags) | 4 | 3 | UUIDs ✅ |
| EVZL-US-034..038 (batch módulo) | 13 | 0 | vazio ❌ |

**Padrão claro:**
- **Story-única**: Vitor preenche `dependsOn` corretamente — porque ao criar T2, o UUID de T1 já voltou no resultado do `create_task`.
- **Batch módulo**: vazio. Vitor descreveu as deps no chat ("US-034.T1 bloqueia US-035, US-036") mas **não persistiu nenhuma**. Isso porque (a) ele tenta planejar todas como conjunto, (b) refs inter-story exigiriam tracking não-trivial.

**Conclusão**: a lógica de dependência do Vitor está **conceitualmente correta** mas a API atual (`dependsOn: string[]` aceitando UUIDs) **força o agent a fazer book-keeping mental** que não escala em batches.

---

## Visão de produto (estado-alvo)

1. **`Task.dependencies` (text/JSON) é REMOVIDA** — substituída por tabela `TaskDependency`.
2. **Agent passa REFS no input**, não UUIDs: `dependsOn: ["EVZL-T-001", "EVZL-T-002"]`.
3. **Backfill** dos JSONs existentes: parse → criar rows na tabela nova.
4. **Validação no executor**: ref inexistente → erro claro. Ciclo detectado → erro claro.
5. **UI consegue resolver** dependências bidirecionalmente: "esta task depende de X" e "X depende desta task".

**Fora de escopo desta migração** (planejado pra depois, em fases futuras):
- Tool `bulk_create_tasks` com placeholders (`localId: "T1"`) pra criar tasks com deps inter-batch numa transação atômica
- UI visual de grafo de dependências
- Inferência automática de "ready to start" baseado em status das deps

---

## Plano de execução

Igual ao plano de task-reference: 2 migrations + code change entre elas pra zero downtime.

### Resumo das fases

1. **Migration #1**: cria tabela `TaskDependency` + RLS policies + backfill do JSON antigo. Coluna antiga `dependencies` continua existindo.
2. **Code change**: atualiza `create_task` (agent), API endpoints, e qualquer outro caller pra usar a tabela nova. Aceita refs como input. Coluna antiga não é mais escrita.
3. **Migration #2**: dropa coluna `dependencies` da tabela `Task`.

---

## Migration #1 — `supabase/migrations/<YYYYMMDD>_task_dependencies_step1.sql`

```sql
-- Step 1: cria tabela TaskDependency + backfill do JSON antigo.
-- Pré-requisito: task-reference-by-project-plan já aplicado (refs <KEY>-T-NNN).
-- Coluna Task.dependencies (text/JSON) continua viva pra retrocompat — será dropada na step2.

BEGIN;

-- 1. Tabela relacional
CREATE TABLE public."TaskDependency" (
  "taskId"    uuid NOT NULL REFERENCES public."Task"(id) ON DELETE CASCADE,
  "dependsOn" uuid NOT NULL REFERENCES public."Task"(id) ON DELETE RESTRICT,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("taskId", "dependsOn"),
  CONSTRAINT taskdep_no_self_loop CHECK ("taskId" <> "dependsOn")
);

-- 2. Index pra query reversa ("quais tasks dependem de X?")
CREATE INDEX taskdep_dependson_idx ON public."TaskDependency" ("dependsOn");

-- 3. RLS espelhando o padrão de TaskTagAssignment
ALTER TABLE public."TaskDependency" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manager_or_viewer_select" ON public."TaskDependency"
  FOR SELECT TO authenticated
  USING (
    is_manager() OR EXISTS (
      SELECT 1 FROM public."Task" t
      WHERE t.id = "TaskDependency"."taskId"
        AND can_view_project(t."projectId")
    )
  );

CREATE POLICY "manager_or_editor_insert" ON public."TaskDependency"
  FOR INSERT TO authenticated
  WITH CHECK (
    is_manager() OR EXISTS (
      SELECT 1 FROM public."Task" t
      WHERE t.id = "TaskDependency"."taskId"
        AND can_edit_tasks(t."projectId")
    )
  );

CREATE POLICY "manager_or_editor_delete" ON public."TaskDependency"
  FOR DELETE TO authenticated
  USING (
    is_manager() OR EXISTS (
      SELECT 1 FROM public."Task" t
      WHERE t.id = "TaskDependency"."taskId"
        AND can_edit_tasks(t."projectId")
    )
  );

-- 4. Trigger de cycle detection (recursive CTE)
CREATE OR REPLACE FUNCTION public.taskdep_no_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_has_path boolean;
BEGIN
  -- Procura caminho NEW.dependsOn → ... → NEW.taskId.
  -- Se existe, inserir NEW criaria ciclo.
  WITH RECURSIVE path AS (
    SELECT "dependsOn" AS node FROM public."TaskDependency"
      WHERE "taskId" = NEW."dependsOn"
    UNION
    SELECT td."dependsOn" FROM public."TaskDependency" td
    JOIN path p ON p.node = td."taskId"
  )
  SELECT EXISTS (SELECT 1 FROM path WHERE node = NEW."taskId")
  INTO v_has_path;

  IF v_has_path THEN
    RAISE EXCEPTION 'Cycle detected: task % cannot depend on % (would create cycle)',
      NEW."taskId", NEW."dependsOn";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER taskdep_cycle_check
  BEFORE INSERT OR UPDATE ON public."TaskDependency"
  FOR EACH ROW EXECUTE FUNCTION public.taskdep_no_cycle();

-- 5. Backfill do JSON antigo
-- Estratégia: parse Task.dependencies como JSONB, extrai array de strings,
-- pra cada string tenta resolver como UUID válido na tabela Task.
-- Strings que não resolvem (UUIDs órfãos de tasks deletadas) são DESCARTADAS
-- silenciosamente — log via RAISE NOTICE.

DO $$
DECLARE
  v_task RECORD;
  v_dep_uuid uuid;
  v_dep_str text;
  v_inserted int := 0;
  v_orphaned int := 0;
BEGIN
  FOR v_task IN
    SELECT id, dependencies::jsonb AS deps
    FROM public."Task"
    WHERE dependencies IS NOT NULL
      AND dependencies <> 'null'
      AND dependencies <> '[]'
  LOOP
    FOR v_dep_str IN SELECT jsonb_array_elements_text(v_task.deps)
    LOOP
      -- Try cast to UUID; skip if invalid
      BEGIN
        v_dep_uuid := v_dep_str::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        v_orphaned := v_orphaned + 1;
        CONTINUE;
      END;

      -- Verifica se a task referenciada existe
      IF NOT EXISTS (SELECT 1 FROM public."Task" WHERE id = v_dep_uuid) THEN
        v_orphaned := v_orphaned + 1;
        CONTINUE;
      END IF;

      -- Insert (ON CONFLICT DO NOTHING evita duplicatas se backfill rodar 2x)
      BEGIN
        INSERT INTO public."TaskDependency" ("taskId", "dependsOn")
        VALUES (v_task.id, v_dep_uuid)
        ON CONFLICT DO NOTHING;
        v_inserted := v_inserted + 1;
      EXCEPTION WHEN OTHERS THEN
        -- Cycle, self-loop, ou outra constraint: pula e loga
        v_orphaned := v_orphaned + 1;
        RAISE NOTICE 'Skipped dep % → % (constraint): %',
          v_task.id, v_dep_uuid, SQLERRM;
      END;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Backfill TaskDependency: % rows inseridas, % orphaned/skipped',
    v_inserted, v_orphaned;
END $$;

-- 6. Sanity check: distribution
DO $$
DECLARE
  v_total int;
  v_with_deps int;
BEGIN
  SELECT count(DISTINCT "taskId") INTO v_with_deps FROM public."TaskDependency";
  SELECT count(*) INTO v_total FROM public."Task";
  RAISE NOTICE 'TaskDependency table: % tasks com deps de % total', v_with_deps, v_total;
END $$;

COMMIT;
```

**Como rodar:**

```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && \
  psql "$DIRECT_URL" -f supabase/migrations/<YYYYMMDD>_task_dependencies_step1.sql
```

**Pós-execução, validar:**

```sql
-- Tabela existe e tem rows
SELECT count(*) FROM "TaskDependency";

-- Cycle detection funciona (deve dar erro)
DO $$
DECLARE v_a uuid; v_b uuid;
BEGIN
  SELECT id INTO v_a FROM "Task" LIMIT 1;
  SELECT id INTO v_b FROM "Task" WHERE id <> v_a LIMIT 1;
  INSERT INTO "TaskDependency" ("taskId", "dependsOn") VALUES (v_a, v_b);
  -- Tentando criar B → A, deve falhar
  BEGIN
    INSERT INTO "TaskDependency" ("taskId", "dependsOn") VALUES (v_b, v_a);
    RAISE EXCEPTION 'Cycle detection FAILED — should have rejected';
  EXCEPTION WHEN raise_exception THEN
    -- limpa o teste
    DELETE FROM "TaskDependency" WHERE "taskId" = v_a AND "dependsOn" = v_b;
    RAISE NOTICE 'Cycle detection OK';
  END;
END $$;

-- Verificar que UUIDs órfãos não criaram rows
-- (compara o número de UUIDs no JSON antigo vs rows na tabela nova)
WITH old_count AS (
  SELECT count(*) AS n
  FROM "Task" t,
       LATERAL jsonb_array_elements_text(t.dependencies::jsonb) AS dep_id
  WHERE t.dependencies IS NOT NULL AND t.dependencies <> '[]'
)
SELECT
  (SELECT n FROM old_count) AS old_json_entries,
  (SELECT count(*) FROM "TaskDependency") AS new_table_rows;
-- Esperado: new_table_rows <= old_json_entries (descartou órfãos)
```

---

## Code change (entre as duas migrations)

### Arquivos a editar

#### 1. `src/lib/dal/task-dependencies.ts` — CRIAR (novo)

DAL helpers pra resolver refs ↔ UUIDs e fazer upsert/delete idempotente.

```typescript
import "server-only";
import { db } from "@/lib/db";

export type TaskDependency = {
  taskId: string;
  dependsOn: string;
};

/**
 * Resolve uma lista de refs (formato `<KEY>-T-NNN`) para UUIDs reais.
 * Aceita também UUIDs (passa direto). Retorna mapa ref/uuid → UUID resolvido.
 * Refs não encontradas viram erro com mensagem clara.
 */
export async function resolveTaskRefsOrIds(
  projectId: string,
  refs: string[],
): Promise<{ resolved: Record<string, string>; missing: string[] }> {
  if (refs.length === 0) return { resolved: {}, missing: [] };

  const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const uuids = refs.filter((r) => looksLikeUuid.test(r));
  const refStrings = refs.filter((r) => !looksLikeUuid.test(r));

  const resolved: Record<string, string> = {};
  const missing: string[] = [];

  if (uuids.length > 0) {
    const { data, error } = await db()
      .from("Task")
      .select("id")
      .eq("projectId", projectId)
      .in("id", uuids);
    if (error) throw error;
    const found = new Set((data ?? []).map((r) => r.id));
    for (const u of uuids) {
      if (found.has(u)) resolved[u] = u;
      else missing.push(u);
    }
  }

  if (refStrings.length > 0) {
    const { data, error } = await db()
      .from("Task")
      .select("id, reference")
      .eq("projectId", projectId)
      .in("reference", refStrings);
    if (error) throw error;
    const byRef = new Map((data ?? []).map((r) => [r.reference, r.id]));
    for (const ref of refStrings) {
      const id = byRef.get(ref);
      if (id) resolved[ref] = id;
      else missing.push(ref);
    }
  }

  return { resolved, missing };
}

/**
 * Replace strategy: substitui completamente o set de dependências de uma task.
 * Usa diff entre current e desired pra minimizar writes — mesma estratégia de
 * setTagsForTask em task-tags.ts.
 */
export async function setDependenciesForTask(
  taskId: string,
  dependsOnIds: string[],
): Promise<void> {
  const desired = Array.from(new Set(dependsOnIds.filter((id) => id !== taskId)));

  const { data: currentRows, error: readErr } = await db()
    .from("TaskDependency")
    .select("dependsOn")
    .eq("taskId", taskId);
  if (readErr) throw readErr;

  const current = new Set((currentRows ?? []).map((r) => r.dependsOn));
  const next = new Set(desired);

  const toAdd = desired.filter((id) => !current.has(id));
  const toRemove = [...current].filter((id) => !next.has(id));

  if (toRemove.length > 0) {
    const { error } = await db()
      .from("TaskDependency")
      .delete()
      .eq("taskId", taskId)
      .in("dependsOn", toRemove);
    if (error) throw error;
  }

  if (toAdd.length > 0) {
    const { error } = await db()
      .from("TaskDependency")
      .insert(toAdd.map((dependsOn) => ({ taskId, dependsOn })));
    if (error) throw error;
  }
}

/**
 * Lê dependências de uma task com refs amigáveis (não só UUID).
 */
export async function listDependenciesForTask(
  taskId: string,
): Promise<Array<{ id: string; reference: string | null; title: string }>> {
  const { data, error } = await db()
    .from("TaskDependency")
    .select("dependsOn, Task!TaskDependency_dependsOn_fkey(id, reference, title)")
    .eq("taskId", taskId);
  if (error) throw error;
  return (data ?? [])
    .map((r) => r.Task as { id: string; reference: string | null; title: string } | null)
    .filter((t): t is { id: string; reference: string | null; title: string } => Boolean(t));
}

/**
 * Lê tasks que dependem desta (reverse lookup, indexed).
 */
export async function listDependentsOfTask(
  taskId: string,
): Promise<Array<{ id: string; reference: string | null; title: string }>> {
  const { data, error } = await db()
    .from("TaskDependency")
    .select("taskId, Task!TaskDependency_taskId_fkey(id, reference, title)")
    .eq("dependsOn", taskId);
  if (error) throw error;
  return (data ?? [])
    .map((r) => r.Task as { id: string; reference: string | null; title: string } | null)
    .filter((t): t is { id: string; reference: string | null; title: string } => Boolean(t));
}
```

#### 2. `src/lib/agent/tools/create-task.ts` — ALTERAR

Atualizar o input schema do `dependsOn` pra aceitar refs e UUIDs, e usar o DAL novo no executor.

**Schema (zod):**

```typescript
dependsOn: z
  .array(z.string().min(1))
  .max(10)
  .optional()
  .describe(
    "Refs de tasks que precisam estar prontas antes (formato preferido: '<KEY>-T-NNN', ex: 'EVZL-T-001'). " +
    "ACEITA também UUIDs como retrocompat. Toda ref passada DEVE existir no MESMO projeto desta task — " +
    "tasks de outros projetos NÃO são aceitas. Use refs retornadas em chamadas anteriores de create_task " +
    "(o campo `reference` vem no resultado do tool).",
  ),
```

**Executor (depois do insert da Task, antes do return):**

```typescript
import {
  resolveTaskRefsOrIds,
  setDependenciesForTask,
} from "@/lib/dal/task-dependencies";

// ... dentro do execute, depois de criar a task com sucesso:

let depsResult: { added: string[]; missing: string[] } = { added: [], missing: [] };
if (dependsOn && dependsOn.length > 0) {
  const { resolved, missing } = await resolveTaskRefsOrIds(projectId, dependsOn);
  if (missing.length > 0) {
    return {
      success: false,
      error: `Refs de dependsOn não encontradas neste projeto: ${missing.join(", ")}. Verifique que as tasks foram criadas e use a ref retornada (campo 'reference').`,
    };
  }
  const resolvedIds = Object.values(resolved);
  await setDependenciesForTask(task.id, resolvedIds);
  depsResult = { added: dependsOn, missing: [] };
}

return {
  success: true,
  id: task.id,
  reference: task.reference,
  title: task.title,
  functionPoints: task.functionPoints,
  acCount: trimmedAc.length,
  tags: { ... },
  dependsOn: depsResult.added,  // ← novo
  alreadyExisted: false,
};
```

**Remover:** linhas 165 e 240 que faziam `dependencies: dependsOn?.length ? JSON.stringify(dependsOn) : null`. Não escrever mais na coluna antiga.

#### 3. `src/app/api/tasks/route.ts` (POST) — ALTERAR

O endpoint REST de criação manual de task também aceita `dependsOn`. Aplicar a mesma lógica do agent: resolver refs/UUIDs, gravar na tabela nova.

```typescript
// Onde hoje recebe body.dependsOn (provavelmente):
if (body.dependsOn?.length) {
  const { resolved, missing } = await resolveTaskRefsOrIds(projectId, body.dependsOn);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Dependencies não encontradas: ${missing.join(", ")}` },
      { status: 422 },
    );
  }
  await setDependenciesForTask(newTask.id, Object.values(resolved));
}

// REMOVER qualquer escrita em task.dependencies (coluna antiga).
```

#### 4. `src/app/api/tasks/[id]/route.ts` (PATCH) — ALTERAR

Idem: se o PATCH aceita `dependsOn`, resolver e usar `setDependenciesForTask` (que faz diff/replace).

#### 5. Tools do Alpha agent — VERIFICAR e ATUALIZAR

```bash
grep -n "dependsOn\|dependencies" src/lib/agent/agents/alpha/tools.ts
```

Se Alpha cria/edita tasks com dependsOn, aplicar mesmo padrão.

#### 6. Cloning/duplication endpoints — ATUALIZAR

```bash
grep -rn "dependencies" src/app/api/tasks/[id]/clone/route.ts src/app/api/tasks/[id]/duplicate/route.ts
```

Se copiam `task.dependencies` (JSON), trocar por copiar rows de `TaskDependency` referentes à task original.

#### 7. Leitura — encontrar e atualizar consumers de `task.dependencies`

```bash
grep -rn "task.dependencies\|\\.dependencies" src/ --include="*.ts" --include="*.tsx" | grep -v "TaskDependency"
```

Tudo que lê o campo antigo precisa migrar pra `listDependenciesForTask(taskId)`. Provavelmente:
- TaskSheet (UI que mostra deps)
- Listings que renderizam chip de "depende de"
- Export/print de tasks

#### 8. Atualizar prompt do Vitor — `src/lib/agent/prompt.ts`

No bloco `task_breakdown`, perto do passo 6 (`dependsOn` na lista de campos do create_task):

```
- `dependsOn` se houver dependencia. Use as REFS retornadas pelas tasks
  anteriores (campo `reference` no resultado do create_task), formato
  `<KEY>-T-NNN`. Ex: ["EVZL-T-001", "EVZL-T-002"]. NUNCA cite UUID.
  IMPORTANTE: ao criar tasks em sequencia, GUARDE mentalmente a `reference`
  de cada uma e use ela em `dependsOn` das proximas. Se a task referenciada
  ainda nao foi criada, NAO inclua em dependsOn — adicione depois via
  update_task se necessario.
```

#### 9. `src/lib/supabase/database.types.ts` — REGENERAR

Após migration #1, regenerar pra incluir `TaskDependency`. Se não tem script, edição manual:

```typescript
TaskDependency: {
  Row: { taskId: string; dependsOn: string; createdAt: string };
  Insert: { taskId: string; dependsOn: string; createdAt?: string };
  Update: { taskId?: string; dependsOn?: string; createdAt?: string };
  Relationships: [
    { foreignKeyName: "TaskDependency_taskId_fkey"; columns: ["taskId"]; referencedRelation: "Task"; referencedColumns: ["id"]; },
    { foreignKeyName: "TaskDependency_dependsOn_fkey"; columns: ["dependsOn"]; referencedRelation: "Task"; referencedColumns: ["id"]; },
  ];
},
```

#### 10. Typecheck

```bash
npx tsc --noEmit -p tsconfig.json
```

Tem que passar limpo. Se algum lugar ainda lê `task.dependencies` (text), o type vira `string | null` mas o código provavelmente espera `string[]` — vai estourar e mostrar onde falta migrar.

---

## Migration #2 — `supabase/migrations/<YYYYMMDD>_task_dependencies_step2.sql`

```sql
-- Step 2: dropa coluna Task.dependencies (text/JSON) que virou código morto.
-- Pré-requisito: todos os callers TS migrados pra TaskDependency table.

BEGIN;

-- 1. Sanity check: garantir que ninguém escreveu na coluna antiga recentemente.
-- Esta migration assume que após o code change a coluna não recebe mais writes.
-- Se algum write recente ainda existe, é sinal de caller esquecido.

DO $$
DECLARE
  v_recent_writes int;
BEGIN
  SELECT count(*) INTO v_recent_writes
  FROM public."Task"
  WHERE dependencies IS NOT NULL
    AND dependencies <> 'null'
    AND dependencies <> '[]'
    AND "updatedAt" > now() - interval '1 hour';

  IF v_recent_writes > 0 THEN
    RAISE WARNING 'Coluna Task.dependencies tem % writes na ultima hora. Verifique callers antes de prosseguir.',
      v_recent_writes;
  END IF;
END $$;

-- 2. Drop da coluna antiga
ALTER TABLE public."Task" DROP COLUMN dependencies;

COMMIT;
```

**Como rodar:**

```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && \
  psql "$DIRECT_URL" -f supabase/migrations/<YYYYMMDD>_task_dependencies_step2.sql
```

**Pós-execução, regenerar/atualizar `database.types.ts`** removendo o campo `dependencies` da Row/Insert/Update de Task.

---

## Validação ponta a ponta (após tudo aplicado)

### 1. Backfill confirmado

```sql
-- Stories com tasks que tinham deps no JSON antigo
SELECT s.reference,
       count(td.*) AS deps_persisted_in_new_table
FROM "UserStory" s
JOIN "Task" t ON t."userStoryId" = s.id
LEFT JOIN "TaskDependency" td ON td."taskId" = t.id
WHERE s."projectId" = 'ccdd93ec-cf7f-4cc3-bce8-d8a359b3f652'
GROUP BY s.reference
ORDER BY s.reference;
```

Esperado: US-033 e US-028 (story-única) com deps, US-034..038 (batch) sem deps (Vitor não preencheu na época).

### 2. Cycle detection ao vivo

```sql
DO $$
DECLARE v_t1 uuid; v_t2 uuid; v_t3 uuid;
BEGIN
  SELECT id INTO v_t1 FROM "Task" WHERE reference = 'EVZL-T-001';
  SELECT id INTO v_t2 FROM "Task" WHERE reference = 'EVZL-T-002';
  SELECT id INTO v_t3 FROM "Task" WHERE reference = 'EVZL-T-003';
  -- T2 → T1, T3 → T2 (OK)
  INSERT INTO "TaskDependency" ("taskId", "dependsOn") VALUES (v_t2, v_t1);
  INSERT INTO "TaskDependency" ("taskId", "dependsOn") VALUES (v_t3, v_t2);
  -- Agora T1 → T3 deveria fechar ciclo (T1 → T3 → T2 → T1)
  BEGIN
    INSERT INTO "TaskDependency" ("taskId", "dependsOn") VALUES (v_t1, v_t3);
    RAISE EXCEPTION 'Cycle detection FAILED';
  EXCEPTION WHEN raise_exception THEN
    -- Cleanup
    DELETE FROM "TaskDependency" WHERE "taskId" IN (v_t2, v_t3);
    RAISE NOTICE 'Cycle detection OK ✓';
  END;
END $$;
```

### 3. Vitor cria task com deps via ref

Pegar uma sessão ativa, garantir uma task já criada (digamos `EVZL-T-040`), pedir nova task com dep:

```bash
npx tsx --require ./scripts/_server-only-shim.cjs scripts/vitor-cli.ts \
  --session 58d05f55-57c6-4b26-86c4-9199a8f67f34 \
  --message "cria uma task de teste pra US-029 que depende de EVZL-T-040. proponha primeiro."
```

Depois validar:

```sql
SELECT t.reference, t.title, dep.reference AS depends_on_ref
FROM "Task" t
LEFT JOIN "TaskDependency" td ON td."taskId" = t.id
LEFT JOIN "Task" dep ON dep.id = td."dependsOn"
WHERE t."createdAt" > now() - interval '5 minutes'
ORDER BY t."createdAt" DESC;
```

Esperado: a task nova aparece com `depends_on_ref = 'EVZL-T-040'`.

### 4. Ref inexistente retorna erro claro

```bash
# Tentar passar uma ref que não existe
# (o agent NÃO faria isso, mas o teste valida o erro)
```

```sql
-- Simular via API direta:
INSERT INTO "TaskDependency" ("taskId", "dependsOn") VALUES (
  (SELECT id FROM "Task" LIMIT 1),
  '00000000-0000-0000-0000-000000000000'
);
-- Esperado: erro de FK
```

### 5. UI

Abrir TaskSheet de uma task com deps. UI deve mostrar chips clicáveis das tasks de que depende, e seção "tasks que dependem desta" preenchida.

---

## Rollback

### Rollback da Migration #1 (antes da #2)

```sql
BEGIN;
DROP TABLE IF EXISTS public."TaskDependency";
DROP FUNCTION IF EXISTS public.taskdep_no_cycle();
COMMIT;
```

A coluna antiga `Task.dependencies` continua intacta — sistema volta ao estado original.

### Rollback da Migration #2

Não trivial: a coluna `dependencies` foi dropada, e os dados estão na tabela nova. Pra reverter:

```sql
BEGIN;

-- Recriar coluna
ALTER TABLE public."Task" ADD COLUMN dependencies text;

-- Reconstituir JSON a partir da tabela nova
UPDATE public."Task" t
SET dependencies = (
  SELECT jsonb_agg("dependsOn")::text
  FROM public."TaskDependency"
  WHERE "taskId" = t.id
)
WHERE EXISTS (
  SELECT 1 FROM public."TaskDependency" WHERE "taskId" = t.id
);

COMMIT;
```

E reverter o code change (git revert).

---

## Checklist de execução

- [ ] **Pré-requisito**: confirmar que `task-reference-by-project-plan.md` foi APLICADO (refs `<KEY>-T-NNN` em produção)
- [ ] **Pré-trabalho**: backup da coluna antiga
  ```sql
  CREATE TABLE _backup_task_dependencies_<data> AS
  SELECT id, dependencies FROM "Task" WHERE dependencies IS NOT NULL;
  ```
- [ ] Criar `supabase/migrations/<YYYYMMDD>_task_dependencies_step1.sql` com conteúdo da seção "Migration #1"
- [ ] Rodar migration #1 via psql
- [ ] Validar SELECTs pós-migration #1 (cycle detection, count de backfill)
- [ ] Criar `src/lib/dal/task-dependencies.ts` com helpers
- [ ] Atualizar `src/lib/agent/tools/create-task.ts` (schema + executor)
- [ ] Atualizar `src/app/api/tasks/route.ts` (POST)
- [ ] Atualizar `src/app/api/tasks/[id]/route.ts` (PATCH se aceita dependsOn)
- [ ] Verificar/atualizar `src/lib/agent/agents/alpha/tools.ts`
- [ ] Atualizar clone/duplicate routes
- [ ] Encontrar consumers via grep e migrar pra `listDependenciesForTask`
- [ ] Atualizar prompt do Vitor em `src/lib/agent/prompt.ts` (instrução pra usar refs em dependsOn)
- [ ] Editar `database.types.ts` pra incluir `TaskDependency`
- [ ] Rodar `npx tsc --noEmit -p tsconfig.json` — passar limpo
- [ ] Rodar `grep -rn "\\.dependencies" src/ --include="*.ts"` — só pode aparecer em context de migration/backfill
- [ ] Validar end-to-end: criar task via Vitor com `dependsOn: ["EVZL-T-XXX"]`, ver row em TaskDependency
- [ ] Aguardar 1 hora (ou monitor de writes) pra confirmar que coluna antiga não recebe mais escritas
- [ ] Criar `supabase/migrations/<YYYYMMDD>_task_dependencies_step2.sql`
- [ ] Rodar migration #2 (drop column)
- [ ] Atualizar `database.types.ts` removendo o campo `dependencies` de `Task`
- [ ] Typecheck final
- [ ] Commit `ZRD-JM-NN: tasks/deps — migra dependencies pra tabela TaskDependency com refs`

---

## Notas finais

### Por que tabela e não JSON?

| Aspecto | JSON (atual) | Tabela (novo) |
|---|---|---|
| Integridade referencial | ❌ órfãos silenciosos | ✅ FK CASCADE/RESTRICT |
| Query "depende de X" | scan + parse | `WHERE taskId = X` indexado |
| Query reversa "quem depende de Y" | full scan + parse | `WHERE dependsOn = Y` indexado |
| Cycle detection | manual no app | trigger PostgreSQL |
| Histórico/audit | não tem | `createdAt` por linha |
| Limite 10/task | manual no app | trivial via constraint se quiser |

### Refs vs UUIDs no input do agent

A escolha de aceitar **refs como entrada** do `create_task` é a chave que faz a coisa toda funcionar pro agent. Hoje Vitor opera assim:

```
create_task({ title: "T1" })
  ← { id: "uuid-1", reference: "EVZL-T-040" }
create_task({ title: "T2", dependsOn: ["uuid-1"] })  ← Vitor tem que tracking UUID
```

Com refs:
```
create_task({ title: "T1" })
  ← { id: "uuid-1", reference: "EVZL-T-040" }
create_task({ title: "T2", dependsOn: ["EVZL-T-040"] })  ← legível, auditável
```

A diferença parece pequena mas é enorme em batch — o agent fala "linguagem ref" no chat, no plano, e nas chamadas. UUID vira detalhe interno.

### Dependências inter-story

Vitor já mostra no chat que sabe mapear deps inter-story ("US-035.T1 depende de US-034.T1"). Após este plano + o de refs por projeto, basta o prompt instruir:

> Antes de criar tasks de uma story que depende de tasks de outra story já decomposta, chame `list_tasks` pra ver as refs daquela story anterior, e use essas refs no `dependsOn`.

A infraestrutura toda já estará lá.

### Concorrência

Mesma situação de `setTagsForTask`: replace strategy não é atômica entre o read e o diff/write. Em prática, `create_task` cria 1 task por vez e ninguém edita em paralelo, então OK. Pra endpoints REST com edição concorrente, considerar `SELECT ... FOR UPDATE` na primeira leitura — fora do escopo desta migração.

---

## Resumo executivo (1 parágrafo)

Substituir `Task.dependencies` (text/JSON) por uma tabela `TaskDependency` relacional com FK, cycle detection via trigger e queries indexadas. Backfill do JSON antigo descartando UUIDs órfãos. API do agent (`create_task`) passa a aceitar refs `<KEY>-T-NNN` (depende do plano de refs por projeto estar aplicado), tornando o input legível e auditável. Code change em ~7 arquivos TS + migration em duas fases pra zero downtime. Resultado: dependências consistentes inter-story, cycle-free, e o Vitor passa a "falar a mesma língua" no chat e na persistência.
