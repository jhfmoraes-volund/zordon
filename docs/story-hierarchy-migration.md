# Story Hierarchy — Plano de Migração (sandbox → produção)

**Status:** plano de execução
**Data:** 2026-04-30
**Autor:** João + Alpha
**Substitui:** abas atuais `SprintsTab`, `ScheduleTab`, `TasksTab` em `/projects/[id]`
**Documentos relacionados:**
- [story-hierarchy-plan.md](./story-hierarchy-plan.md) — V2 do schema-alvo
- [story-hierarchy-backfill.md](./story-hierarchy-backfill.md) — backfill de projetos antigos (escopo separado)
- [story-hierarchy-alpha-integration.md](./story-hierarchy-alpha-integration.md) — integração com agente Alpha (escopo separado)

---

## 0. Premissas

- **Sandbox de referência:** `/dev/stories` em [src/app/(dashboard)/dev/stories/page.tsx](../src/app/(dashboard)/dev/stories/page.tsx). Componentes em [src/components/story-hierarchy/](../src/components/story-hierarchy/) e [src/components/sprint/](../src/components/sprint/) já estão prontos pra reuso.
- **Convenções do repo** (per `AGENTS.md`):
  - Migrations rodam via `psql "$DIRECT_URL" -f supabase/migrations/<file>.sql` (nunca pelo dashboard).
  - Após cada migration, regerar `src/lib/supabase/database.types.ts`.
  - Commits via `bash scripts/sync-main.sh -m "ZRD-JM-NN: ..."`.
- **Rollout estratégia:** feature-flag **por projeto** via `Project.useStoryHierarchy boolean default false`. Tabs novas só aparecem quando o flag está ON. Garante rollback granular sem reverter migrations.
- **Backfill é separado.** Este plano cobre **apenas a infra** + **nova page** + **rollout vazio**. Backfill de tasks legacy / AC text / etc → ver doc próprio.

---

## 1. Visão geral das fases

| Fase | Conteúdo | Reversível? | Bloqueia próxima? |
|---|---|---|---|
| 1 | Migrations forward-only (DDL nullable + tabelas novas) | sim | sim |
| 2 | Regen types + RLS policies | sim | sim |
| 3 | DAL (helpers de leitura/escrita) | sim | sim |
| 4 | API route handlers | sim | sim |
| 5 | Feature flag + nova page (tabs novas atrás do flag) | sim | sim |
| 6 | Backfill por projeto + flip flag (executado por doc separado) | sim por projeto | — |
| 7 | Cleanup (drop columns deprecated) | **não** | — |

**Alpha integration** (prompt + persistência atomic) sai num plano paralelo: [story-hierarchy-alpha-integration.md](./story-hierarchy-alpha-integration.md). Não bloqueia rollout — pode rodar antes ou depois da Fase 5, em qualquer ponto após Fase 4.

**Tempo estimado:** Fases 1-5 em ~2 sprints (10 dias úteis) com 1 dev FT. Fase 6 é per-projeto (ver doc backfill). Fase 7 espera 100% dos projetos migrados. Alpha integration corre em paralelo, ~3-5 dias.

---

## 2. Fase 1 — Schema migrations

Cada migration vai num arquivo separado em `supabase/migrations/` e roda em ordem. **Forward-only**: nenhuma migration aqui faz `DROP` ou `ALTER ... DROP COLUMN`. Todas as colunas novas são nullable ou têm default — código antigo continua funcionando até a Fase 7.

### 2.1 `20260501_project_reference_key_and_dod.sql`

```sql
ALTER TABLE "Project"
  ADD COLUMN "referenceKey"     text,
  ADD COLUMN "definitionOfDone" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "useStoryHierarchy" boolean NOT NULL DEFAULT false;

-- referenceKey constraint só após backfill (ver Fase 6).
-- Por enquanto fica nullable.

CREATE INDEX "project_use_story_hierarchy_idx"
  ON "Project"("useStoryHierarchy")
  WHERE "useStoryHierarchy" = true;
```

**Risco:** zero. Colunas nullable + flag default false.

### 2.2 `20260501_project_persona.sql`

```sql
CREATE TABLE "ProjectPersona" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId"  uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  "updatedAt"  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "persona_unique_per_project" UNIQUE ("projectId", name)
);

CREATE INDEX "project_persona_project_idx" ON "ProjectPersona"("projectId");

-- Trigger: seed automático ao criar projeto novo
CREATE OR REPLACE FUNCTION seed_project_personas()
RETURNS trigger AS $$
BEGIN
  INSERT INTO "ProjectPersona" ("projectId", name, description) VALUES
    (NEW.id, 'Builder',  'Membro do time que executa tasks'),
    (NEW.id, 'PM',       'Gestor do projeto, define prioridades e valida entregas'),
    (NEW.id, 'Cliente',  'Stakeholder externo / usuário final do produto');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "project_seed_personas_trigger"
AFTER INSERT ON "Project"
FOR EACH ROW EXECUTE FUNCTION seed_project_personas();
```

**Atenção:** projetos **existentes** não recebem personas via trigger (só novos). Backfill cobre os antigos.

### 2.3 `20260501_module.sql`

```sql
CREATE TABLE "Module" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId"  uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  "updatedAt"  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "module_name_format" CHECK (name ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT "module_unique_per_project" UNIQUE ("projectId", name)
);

CREATE INDEX "module_project_idx" ON "Module"("projectId");
```

### 2.4 `20260501_user_story.sql`

```sql
CREATE TABLE "UserStory" (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId"           uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  "moduleId"            uuid REFERENCES "Module"(id) ON DELETE SET NULL,
  "proposedModuleName"  text,
  reference             text NOT NULL,

  title                 text NOT NULL,
  "personaId"           uuid REFERENCES "ProjectPersona"(id),
  want                  text NOT NULL,
  "soThat"              text,

  "refinementStatus"    text NOT NULL DEFAULT 'draft'
                        CHECK ("refinementStatus" IN ('draft','refined','committed')),

  "acValidatedAt"       timestamptz,
  "acValidatedBy"       uuid REFERENCES "Member"(id),

  "designSessionId"     uuid REFERENCES "DesignSession"(id),
  "designSessionItemId" uuid REFERENCES "DesignSessionItem"(id),

  "createdByAgent"      boolean NOT NULL DEFAULT false,
  "createdById"         uuid REFERENCES "Member"(id),
  "createdAt"           timestamptz NOT NULL DEFAULT now(),
  "updatedAt"           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "user_story_reference_unique" UNIQUE (reference),
  CONSTRAINT "user_story_ac_validation_consistent" CHECK (
    ("acValidatedAt" IS NULL  AND "acValidatedBy" IS NULL) OR
    ("acValidatedAt" IS NOT NULL AND "acValidatedBy" IS NOT NULL)
  )
);

CREATE INDEX "user_story_project_idx"    ON "UserStory"("projectId");
CREATE INDEX "user_story_module_idx"     ON "UserStory"("moduleId") WHERE "moduleId" IS NOT NULL;
CREATE INDEX "user_story_refinement_idx" ON "UserStory"("refinementStatus");
CREATE INDEX "user_story_ds_item_idx"    ON "UserStory"("designSessionItemId") WHERE "designSessionItemId" IS NOT NULL;

-- Sequencer per-project (CRM-US-001, CRM-US-002, ...)
CREATE OR REPLACE FUNCTION next_user_story_reference(p_project_id uuid)
RETURNS text AS $$
DECLARE
  v_key text;
  v_seq int;
BEGIN
  SELECT "referenceKey" INTO v_key FROM "Project" WHERE id = p_project_id;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Project % is missing referenceKey', p_project_id;
  END IF;

  SELECT COALESCE(MAX(
    CAST(SUBSTRING(reference FROM '\-US\-(\d+)$') AS int)
  ), 0) + 1
  INTO v_seq
  FROM "UserStory"
  WHERE "projectId" = p_project_id;

  RETURN v_key || '-US-' || LPAD(v_seq::text, 3, '0');
END;
$$ LANGUAGE plpgsql;
```

### 2.5 `20260501_acceptance_criterion.sql`

```sql
CREATE TABLE "AcceptanceCriterion" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userStoryId" uuid REFERENCES "UserStory"(id) ON DELETE CASCADE,
  "taskId"      uuid REFERENCES "Task"(id) ON DELETE CASCADE,
  text          text NOT NULL,
  "order"       integer NOT NULL DEFAULT 0,
  "checkedAt"   timestamptz,
  "checkedBy"   uuid REFERENCES "Member"(id),
  "createdAt"   timestamptz NOT NULL DEFAULT now(),
  "updatedAt"   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "ac_owner_exclusive" CHECK (
    ("userStoryId" IS NOT NULL AND "taskId" IS NULL) OR
    ("userStoryId" IS NULL AND "taskId" IS NOT NULL)
  ),
  CONSTRAINT "ac_check_consistent" CHECK (
    ("checkedAt" IS NULL  AND "checkedBy" IS NULL) OR
    ("checkedAt" IS NOT NULL AND "checkedBy" IS NOT NULL)
  )
);

CREATE INDEX "ac_user_story_idx" ON "AcceptanceCriterion"("userStoryId") WHERE "userStoryId" IS NOT NULL;
CREATE INDEX "ac_task_idx"       ON "AcceptanceCriterion"("taskId")      WHERE "taskId"      IS NOT NULL;
```

### 2.6 `20260501_task_extensions.sql`

```sql
ALTER TABLE "Task"
  ADD COLUMN "userStoryId" uuid REFERENCES "UserStory"(id) ON DELETE SET NULL,
  ADD COLUMN "area"        text,
  ADD COLUMN "doneAt"      timestamptz;

ALTER TABLE "Task"
  ADD CONSTRAINT "task_area_valid" CHECK (
    "area" IS NULL OR "area" IN ('front','back','infra','ops','mixed')
  );

CREATE INDEX "task_user_story_idx" ON "Task"("userStoryId") WHERE "userStoryId" IS NOT NULL;
CREATE INDEX "task_done_at_idx"    ON "Task"("doneAt")      WHERE "doneAt"      IS NOT NULL;

-- Trigger: setar doneAt em transições para/de 'done', cobrindo INSERT e UPDATE
CREATE OR REPLACE FUNCTION sync_task_done_at()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'done' AND NEW."doneAt" IS NULL THEN
      NEW."doneAt" := now();
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done' THEN
      NEW."doneAt" := now();
    ELSIF NEW.status IS DISTINCT FROM 'done' AND OLD.status = 'done' THEN
      NEW."doneAt" := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "task_done_at_trigger"
BEFORE INSERT OR UPDATE ON "Task"
FOR EACH ROW EXECUTE FUNCTION sync_task_done_at();
```

**Atenção:** trigger **não** preenche `doneAt` retroativamente em tasks já `done` antes da migration. Backfill cuida disso.

### 2.7 `20260501_user_story_overview_view.sql`

```sql
CREATE OR REPLACE VIEW user_story_overview AS
SELECT
  us.id                                                                           AS "userStoryId",
  us."projectId",
  us."moduleId",
  us.reference,
  us.title,
  us."refinementStatus",
  us."acValidatedAt",
  COUNT(t.id)                                                                     AS "totalTasks",
  COUNT(t.id) FILTER (WHERE t.status = 'done')                                    AS "doneTasks",
  COALESCE(SUM(t."functionPoints"), 0)                                            AS "totalFunctionPoints",
  COALESCE(SUM(t."functionPoints") FILTER (WHERE t.status = 'done'), 0)           AS "doneFunctionPoints",
  CASE
    WHEN COUNT(t.id) = 0
      THEN 'pending'
    WHEN COUNT(t.id) FILTER (WHERE t.status = 'done') = COUNT(t.id)
         AND us."acValidatedAt" IS NOT NULL
      THEN 'done'
    WHEN COUNT(t.id) FILTER (WHERE t.status = 'done') = COUNT(t.id)
      THEN 'tasks_complete'
    WHEN COUNT(t.id) FILTER (WHERE t.status IN ('done','in_progress','review')) > 0
      THEN 'in_progress'
    ELSE 'pending'
  END                                                                             AS "computedStatus"
FROM "UserStory" us
LEFT JOIN "Task" t ON t."userStoryId" = us.id
GROUP BY us.id;
```

### 2.8 Execução

```bash
# Carregar DIRECT_URL
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /')

# Rodar em ordem
psql "$DIRECT_URL" -f supabase/migrations/20260501_project_reference_key_and_dod.sql
psql "$DIRECT_URL" -f supabase/migrations/20260501_project_persona.sql
psql "$DIRECT_URL" -f supabase/migrations/20260501_module.sql
psql "$DIRECT_URL" -f supabase/migrations/20260501_user_story.sql
psql "$DIRECT_URL" -f supabase/migrations/20260501_acceptance_criterion.sql
psql "$DIRECT_URL" -f supabase/migrations/20260501_task_extensions.sql
psql "$DIRECT_URL" -f supabase/migrations/20260501_user_story_overview_view.sql
```

**Validação pós-execução:**

```sql
-- Tabelas existem?
\dt "Module" "ProjectPersona" "UserStory" "AcceptanceCriterion"

-- Indexes?
\di "user_story_*" "module_*" "ac_*" "task_user_story_*" "task_done_at_*"

-- View?
\d user_story_overview

-- Funções?
\df next_user_story_reference seed_project_personas sync_task_done_at

-- Trigger?
SELECT tgname FROM pg_trigger WHERE tgrelid IN ('"Project"'::regclass, '"Task"'::regclass);
```

---

## 3. Fase 2 — Regen types + RLS

### 3.1 Regenerar types

```bash
bunx supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts
```

(Ajustar comando ao gerador atual do projeto — o usado nos commits anteriores.)

### 3.2 RLS policies

**Convenção:** reusar os helpers que já existem em [supabase/migrations/20260427_project_access.sql](../supabase/migrations/20260427_project_access.sql) e [20260423_member_roles_access.sql](../supabase/migrations/20260423_member_roles_access.sql).

| Helper | Significado |
|---|---|
| `public.is_manager()` | bypass total — pm/head-ops/ceo |
| `public.can_view_project(projectId)` | qualquer member alocado ao projeto pode ler |
| `public.can_edit_tasks(projectId)` | builder ou superior alocado ao projeto pode escrever em conteúdo do projeto |
| `public.can_edit_sessions(projectId)` | escrita em design-sessions especificamente |
| `public.is_allocated_to(projectId)` | member tem ProjectMember row |

> Não criar `is_project_member` ou `is_project_pm_or_admin` — usar os existentes.

#### 3.2.1 `Module`, `ProjectPersona`

```sql
ALTER TABLE "Module" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectPersona" ENABLE ROW LEVEL SECURITY;

-- SELECT: qualquer member com acesso ao projeto
CREATE POLICY "module_select" ON "Module"
  FOR SELECT TO authenticated
  USING (public.is_manager() OR public.can_view_project("projectId"));

CREATE POLICY "persona_select" ON "ProjectPersona"
  FOR SELECT TO authenticated
  USING (public.is_manager() OR public.can_view_project("projectId"));

-- INSERT/UPDATE/DELETE: apenas manager (pm/head-ops/ceo)
CREATE POLICY "module_write" ON "Module"
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());

CREATE POLICY "persona_write" ON "ProjectPersona"
  FOR ALL TO authenticated
  USING (public.is_manager())
  WITH CHECK (public.is_manager());
```

> Decisão: gestão de taxonomia (modules/personas) é **manager-only**. Builder não cria/edita. Se quiser permitir builder também, trocar `is_manager()` por `can_edit_tasks("projectId")`.

#### 3.2.2 `UserStory`

```sql
ALTER TABLE "UserStory" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "story_select" ON "UserStory"
  FOR SELECT TO authenticated
  USING (public.is_manager() OR public.can_view_project("projectId"));

-- INSERT: manager OU builder alocado (Alpha-server-role bypassa RLS)
CREATE POLICY "story_insert" ON "UserStory"
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_manager() OR public.can_edit_tasks("projectId")
  );

-- UPDATE: manager sempre. Builder alocado pode atualizar campos não-críticos
-- (refinementStatus, want, soThat). PM-only para acValidatedAt/By é tratado via
-- coluna policy ou WITH CHECK adicional — ver 3.2.5.
CREATE POLICY "story_update" ON "UserStory"
  FOR UPDATE TO authenticated
  USING (public.is_manager() OR public.can_edit_tasks("projectId"))
  WITH CHECK (public.is_manager() OR public.can_edit_tasks("projectId"));

CREATE POLICY "story_delete" ON "UserStory"
  FOR DELETE TO authenticated
  USING (public.is_manager());
```

#### 3.2.3 `AcceptanceCriterion`

```sql
ALTER TABLE "AcceptanceCriterion" ENABLE ROW LEVEL SECURITY;

-- SELECT: ler se tem acesso ao projeto da story/task dona
CREATE POLICY "ac_select" ON "AcceptanceCriterion"
  FOR SELECT TO authenticated
  USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM "UserStory" us
      WHERE us.id = "AcceptanceCriterion"."userStoryId"
        AND public.can_view_project(us."projectId")
    )
    OR EXISTS (
      SELECT 1 FROM "Task" t
      WHERE t.id = "AcceptanceCriterion"."taskId"
        AND public.can_view_project(t."projectId")
    )
  );

-- INSERT/UPDATE/DELETE: manager sempre. Builder pode CRUDar AC se está
-- alocado ao projeto da story/task.
CREATE POLICY "ac_write" ON "AcceptanceCriterion"
  FOR ALL TO authenticated
  USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM "UserStory" us
      WHERE us.id = "AcceptanceCriterion"."userStoryId"
        AND public.can_edit_tasks(us."projectId")
    )
    OR EXISTS (
      SELECT 1 FROM "Task" t
      WHERE t.id = "AcceptanceCriterion"."taskId"
        AND public.can_edit_tasks(t."projectId")
    )
  )
  WITH CHECK (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM "UserStory" us
      WHERE us.id = "AcceptanceCriterion"."userStoryId"
        AND public.can_edit_tasks(us."projectId")
    )
    OR EXISTS (
      SELECT 1 FROM "Task" t
      WHERE t.id = "AcceptanceCriterion"."taskId"
        AND public.can_edit_tasks(t."projectId")
    )
  );
```

#### 3.2.4 `Task` — sem mudança

`userStoryId` e `area` são nullable e não afetam regra de acesso. As policies existentes em `Task` continuam válidas. Validar smoke test após Fase 1 só pra garantir.

#### 3.2.5 AC validation = manager-only (camada de aplicação)

`acValidatedAt`/`acValidatedBy` na `UserStory` deveriam ser write-only para manager. PostgreSQL não tem column-level RLS facilmente — solução pragmática: **a API valida**, não o RLS.

```ts
// /api/stories/[ref]/validate-ac/route.ts
// Verifica role do caller antes de chamar DAL
if (!member.role.canManage) return new Response("forbidden", { status: 403 });
```

DB aceita o update; API garante quem pode fazer. Aceitável — superfície de ataque restrita a quem já é authenticated + alocado ao projeto.

---

## 4. Fase 3 — DAL (helpers)

Adicionar a [src/lib/dal.ts](../src/lib/dal.ts) ou criar [src/lib/dal/story-hierarchy.ts](../src/lib/dal/story-hierarchy.ts) (preferível pra escopo limpo):

```ts
// src/lib/dal/story-hierarchy.ts

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export async function getModulesForProject(projectId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("Module")
    .select("*")
    .eq("projectId", projectId)
    .order("name");
  return data ?? [];
}

export async function getPersonasForProject(projectId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ProjectPersona")
    .select("*")
    .eq("projectId", projectId)
    .order("name");
  return data ?? [];
}

export async function getStoriesForProject(
  projectId: string,
  filter?: {
    moduleId?: string | null;
    refinementStatus?: "draft" | "refined" | "committed";
    sprintId?: string;
  },
) {
  const supabase = await createClient();
  let q = supabase
    .from("UserStory")
    .select(`
      *,
      acceptanceCriteria:AcceptanceCriterion!userStoryId(*),
      module:Module(id, name),
      persona:ProjectPersona(id, name),
      overview:user_story_overview!userStoryId(*)
    `)
    .eq("projectId", projectId);

  if (filter?.moduleId !== undefined) {
    if (filter.moduleId === null) q = q.is("moduleId", null);
    else q = q.eq("moduleId", filter.moduleId);
  }
  if (filter?.refinementStatus) {
    q = q.eq("refinementStatus", filter.refinementStatus);
  }

  const { data } = await q.order("createdAt", { ascending: false });
  return data ?? [];
}

export async function getStoryWithFullDetail(storyRef: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("UserStory")
    .select(`
      *,
      acceptanceCriteria:AcceptanceCriterion!userStoryId(*),
      module:Module(*),
      persona:ProjectPersona(*),
      tasks:Task!userStoryId(
        *,
        assignments:TaskAssignment(member:Member(id, name)),
        acceptanceCriteria:AcceptanceCriterion!taskId(*)
      ),
      overview:user_story_overview!userStoryId(*)
    `)
    .eq("reference", storyRef)
    .single();
  return data;
}

export async function approveProposedModule(
  storyId: string,
  proposedName: string,
  projectId: string,
) {
  const supabase = await createClient();
  // Atomic: cria module + atualiza story
  const { data: mod, error: modErr } = await supabase
    .from("Module")
    .insert({ projectId, name: proposedName })
    .select()
    .single();
  if (modErr || !mod) throw modErr;

  await supabase
    .from("UserStory")
    .update({ moduleId: mod.id, proposedModuleName: null })
    .eq("id", storyId);

  return mod;
}

export async function validateStoryAc(storyId: string, memberId: string) {
  const supabase = await createClient();
  await supabase
    .from("UserStory")
    .update({
      acValidatedAt: new Date().toISOString(),
      acValidatedBy: memberId,
    })
    .eq("id", storyId);
}

export async function nextUserStoryReference(projectId: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("next_user_story_reference", {
    p_project_id: projectId,
  });
  if (error || !data) throw error ?? new Error("No reference returned");
  return data;
}
```

Helpers adicionais:
- `createStory(input)` (que usa `nextUserStoryReference` + cria AC em transação)
- `updateAcCheck(acId, memberId, checked)`
- `setStoryRefinement(storyId, status)`

---

## 5. Fase 4 — API route handlers

Estrutura paralela à existente (`src/app/api/`).

### 5.1 Endpoints a criar

```
src/app/api/projects/[id]/modules/route.ts          GET, POST
src/app/api/projects/[id]/modules/[modId]/route.ts  PATCH, DELETE
src/app/api/projects/[id]/personas/route.ts         GET, POST
src/app/api/projects/[id]/personas/[perId]/route.ts PATCH, DELETE
src/app/api/projects/[id]/stories/route.ts          GET, POST
src/app/api/projects/[id]/dod/route.ts              PATCH (definitionOfDone)

src/app/api/stories/[ref]/route.ts                  GET (com tasks+AC), PATCH, DELETE
src/app/api/stories/[ref]/approve-module/route.ts   POST (proposed → real)
src/app/api/stories/[ref]/validate-ac/route.ts      POST (PM marca AC validado)
src/app/api/stories/[ref]/refinement/route.ts       PATCH (draft → refined → committed)
src/app/api/stories/[ref]/acceptance/route.ts       GET, POST
src/app/api/stories/[ref]/acceptance/[acId]/route.ts PATCH (toggle), DELETE

src/app/api/tasks/[id]/acceptance/route.ts          GET, POST
src/app/api/tasks/[id]/acceptance/[acId]/route.ts   PATCH (toggle), DELETE
src/app/api/tasks/[id]/move-to-story/route.ts       POST (reattach a outra story)
```

### 5.2 Nada muda nos endpoints atuais

Endpoints `/api/sprints/*`, `/api/projects/[id]/route.ts` (project meta) etc. continuam funcionando. Backfill apenas adiciona dados novos, não muda contratos.

### 5.3 Padrão de implementação

Seguir o padrão de `/api/projects/[id]/route.ts`. Validação Zod na entrada, RLS via Supabase client com auth, retornos padronizados.

---

## 6. Fase 5 — Feature flag + nova page

### 6.1 Estratégia

`Project.useStoryHierarchy` controla quais tabs aparecem em `/projects/[id]/page.tsx`.

```tsx
// src/app/(dashboard)/projects/[id]/page.tsx
const tabs = project.useStoryHierarchy
  ? [
      { key: "overview",  label: "Overview", icon: Eye         },
      { key: "stories",   label: "Stories",  icon: BookOpen    },
      { key: "tasks",     label: "Tasks",    icon: ListTodo    },
      { key: "sprints",   label: "Sprints",  icon: Zap         },
      { key: "sessions",  label: "Sessions", icon: Lightbulb   },
      { key: "capacity",  label: "Capacity", icon: Battery     }, // existing
      { key: "wiki",      label: "Wiki",     icon: FileText    },
      { key: "settings",  label: "Settings", icon: SettingsIcon },
    ]
  : LEGACY_TABS;
```

### 6.2 Substituições nas tabs novas

| Tab | Substitui (antigo) | Vem de |
|---|---|---|
| **Overview** | `OverviewTab` atual (linha 555) | Reescrita com `<SprintSummaryStats>` + `<SprintTimeline>` + sprint vigente em destaque |
| **Stories** | (não existia) | `<StoriesList>` + `<StorySheet>` |
| **Tasks** | `TasksTab` atual (linha 938, com `TaskList` + `TaskSheet` legados) | `<TasksList>` + `<TaskSheet>` novos |
| **Sprints** | `SprintsTab` atual (linha 1097) | `<SprintNavigator>` + `<SprintTimeline>` + `<SprintDetail>` |
| **Cronograma** | `ScheduleTab` atual (linha 1349) | **DELETADA**. Mini-timeline na Overview cobre. |
| **Settings** | (não existia) | `<SettingsPanel>` (modules + personas + DoD editor) |

### 6.3 Layout sugerido

Reaproveitar header de projeto + `viewerRole` checks já existentes. Tabs antigas continuam disponíveis no código mas só aparecem quando flag está OFF — após Fase 7 a gente apaga.

### 6.4 Componentes reusados (já prontos)

```
src/components/story-hierarchy/
├── StoriesList, StorySheet
├── TasksList, TaskSheet
├── SettingsPanel
├── ModuleDialog, PersonaDialog
├── AcList
└── chips, helpers, types

src/components/sprint/
├── SprintNavigator
├── SprintDetail
├── SprintTimeline
├── SprintSummaryStats
├── SprintCapacity
├── SprintBurndown
└── helpers, types
```

Todos recebem dados via props. Adapter na page real:

```tsx
// Page real
const { stories, tasks, modules, personas, sprints, capacities, members } = await loadProjectData(id);

<TasksList
  tasks={tasks}
  stories={stories}
  modules={modules}
  members={members}
  onOpenTask={openTaskSheet}
/>
```

A diferença vs sandbox: dados vêm de Supabase via DAL ao invés de mock. **Componentes não mudam.**

### 6.5 SprintDialog — mantém

`SprintDialog` existente continua sendo usado pra criar/editar sprint. Sem mudança.

### 6.6 Mobile

Componentes de `story-hierarchy` e `sprint` foram desenvolvidos com Tailwind responsivo (grids colapsam, sheets são full-bottom em mobile via `useIsMobile`). Mas vale validar manualmente em todos os viewports antes do flag ON.

---

## 7. Fase 6 — Backfill por projeto + flip flag

**Coberto em [story-hierarchy-backfill.md](./story-hierarchy-backfill.md).**

Resumo do fluxo por projeto:
1. PM define `Project.referenceKey` (ex: `CRM`)
2. Seed personas para projetos antigos (script one-shot, não trigger)
3. PM cria modules iniciais (ou Alpha sugere via integração paralela)
4. Migrar tasks legacy (estratégia híbrida)
5. Validar amostra
6. `UPDATE Project SET useStoryHierarchy = true WHERE id = ?`
7. Time usa nova UI

---

## 8. Fase 7 — Cleanup

**Pré-requisito:** todos os projetos com `useStoryHierarchy = true` (ou seja, Fase 6 concluída em 100% dos projetos ativos).

```sql
-- 20260601_drop_deprecated_task_columns.sql
-- ATENÇÃO: irreversível. Backup antes de rodar.

-- Validar que código não lê mais essas colunas
-- (grep no codebase: grep -rn "\.acceptanceCriteria\b" src/ | grep -v "AcceptanceCriterion")

ALTER TABLE "Task"
  DROP COLUMN "acceptanceCriteria", -- text legado
  DROP COLUMN "type",
  DROP COLUMN "scope";

-- Pode também drop "useStoryHierarchy" do Project se quisermos forçar 100% rollout
ALTER TABLE "Project"
  DROP COLUMN "useStoryHierarchy";
```

**Chip nas tabs antigas:** depois desse drop, `OverviewTab`, `SprintsTab`, `ScheduleTab`, `TasksTab` antigos do `projects/[id]/page.tsx` viram código morto. Apagar arquivos.

---

## 10. Validação por fase

| Fase | Como validar |
|---|---|
| 1 | `\dt`, `\di`, `\df`, `\d view` no psql + 1 query manual em cada tabela |
| 2 | `bun run typecheck` passa após regen |
| 3 | Unit tests dos helpers DAL (mock supabase, valida shape) |
| 4 | E2E: `curl POST /api/projects/X/modules` cria, `GET` lê, `DELETE` remove |
| 5 | Smoke test no `/dev/stories` (já tá, sandbox = real após swap) + tour manual no `/projects/[id]` com flag ON num projeto teste |
| 6 | Cenários Alpha calibrados (mínimo 5/5 corretos manualmente) |
| 7 | Per-projeto: contagem de stories, módulos, AC bate com expectativa |
| 8 | Build limpo, zero referência aos campos drop |

---

## 11. Rollback

| Fase | Rollback |
|---|---|
| 1 | `DROP TABLE` + `DROP FUNCTION` + `DROP TRIGGER` (todas as criadas). Script reverso pronto antes de rodar Fase 1. |
| 2 | Reverter PR do regen + RLS via `DROP POLICY` |
| 3-4 | Reverter PR no git |
| 5 | `UPDATE Project SET useStoryHierarchy = false` — usuários voltam pra tabs antigas instantaneamente |
| 6 | Reverter PR do Alpha; tasks geradas ficam mas sem auto-attach |
| 7 | **Por projeto:** `UPDATE Project SET useStoryHierarchy = false` + opcionalmente `DELETE FROM UserStory WHERE projectId = ?` (cuidado) |
| 8 | **Não há rollback fácil.** Backup completo do DB antes. |

---

## 12. Riscos e mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| RLS quebra fluxos existentes | média | alto | Smoke test extenso em dev/staging com user real PM/Builder antes do flag ON |
| Alpha gera lixo nos primeiros sprints | alta | médio | Calibração obrigatória + flag por projeto permite isolar |
| Tasks com `userStoryId` mas sem `sprintId` confundem capacity | baixa | médio | Capacity helper já filtra por `sprintId IS NOT NULL`; reaproveita |
| Trigger `sync_task_done_at` afeta migrations futuras | média | baixo | Idempotente (sem efeito se status não muda); rodar `pg_trigger_depth` em testes |
| `next_user_story_reference` colide se 2 stories criadas no mesmo ms | muito baixa | médio | Trocar por `serial` per-project se virar problema |
| Drop da Fase 7 perde dados se algum projeto não foi backfillado | baixa | crítico | Pré-check: `SELECT COUNT(*) FROM Project WHERE useStoryHierarchy = false` deve ser 0 |
| User confunde nova/antiga UI durante rollout | média | baixo | Indicador visual no header "v2 ativa" no projeto migrado |

---

## 13. Cronograma sugerido

| Semana | Fase | Owner |
|---|---|---|
| 1 | Fase 1 (migrations) + Fase 2 (RLS + types) | dev backend |
| 2 | Fase 3 (DAL) + Fase 4 (API) | dev backend |
| 2-3 | Fase 5 (page real + componentes) | dev fullstack |
| 4+ | Fase 6 (backfill por projeto) | per doc separado |
| ~6+ | Fase 7 (cleanup) | dev backend (após 100% rollout) |
| em paralelo | Alpha integration | per doc separado, ~3-5 dias após Fase 4 |

---

## 14. Checklist de execução

### Pré-deploy
- [ ] Backup completo do DB
- [ ] Branch `feature/story-hierarchy-v2`
- [ ] Migrations 2.1-2.7 escritas e revisadas
- [ ] RLS policies revisadas com 1 PM + 1 builder
- [ ] DAL coberta por unit tests
- [ ] API endpoints com input validation Zod

### Durante deploy
- [ ] Migrations rodadas em staging primeiro
- [ ] Smoke test em staging com user PM e Builder
- [ ] Migrations em prod (off-hours)
- [ ] Regen types committado
- [ ] Code deploy
- [ ] 1 projeto-piloto com `useStoryHierarchy = true` (após Fase 6 nele)

### Pós-deploy
- [ ] Monitorar erros 500 em `/api/stories/*` por 48h
- [ ] Coletar feedback do PM-piloto
- [ ] Iterar antes de habilitar mais projetos

---

## 15. Decisões abertas (fechar antes de Fase 1)

1. **Path do feature flag:** `Project.useStoryHierarchy` (proposto) vs env var global. Per-projeto recomendado.

2. **Componentes legacy:** apagamos na Fase 7 ou deixamos pra refactor seguinte? Recomendo apagar junto pra evitar lixo.

3. **AC validation = manager-only:** validar via API (proposta) ou via column-level constraint? API é mais simples e cobre o caso. Confirmar.

4. **Mock vs prod (capacity 500):** `Member.fpCapacity` em prod usa baseline 500 (senior + 100% dedicação) com multiplicadores por seniority. Mock atual usa 30/25/20 — pra UX o número é proporcional, mas se for demonstrar pra stakeholders ajustar pra refletir realidade. Não bloqueia migração.
