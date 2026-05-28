# Story Hierarchy — Plano de Backfill (projetos legados)

**Status:** plano de execução
**Data:** 2026-04-30
**Autor:** João + Alpha
**Escopo:** popular dados novos (`Module`, `ProjectPersona`, `UserStory`, `AcceptanceCriterion`, `Task.area`, `Task.userStoryId`, `Task.doneAt`, `Project.referenceKey`, `Project.definitionOfDone`) em projetos que **já existiam** antes da Fase 1 da migração.
**Pré-requisito:** Fases 1-4 do plano principal ([story-hierarchy-migration.md](./story-hierarchy-migration.md)) executadas.
**Independente de:** Fase 5 (page nova) e Fase 6 (Alpha). Backfill pode rodar antes de qualquer um — a flag `useStoryHierarchy` continua false até validar.

---

## 0. Princípios

1. **Por-projeto, não global.** Cada projeto tem seu próprio passo de backfill. Permite escolher ordem (mais valioso → menos), validar e parar se algo dá errado.
2. **Idempotente.** Todo script deve poder rodar 2× sem corromper. Usar `ON CONFLICT DO NOTHING` ou checar antes de inserir.
3. **Audit trail.** Cada execução loga em tabela `BackfillRun` (ver §1.4) — saber quem rodou, quando, com que resultado.
4. **Reversível por etapa.** Snapshot antes; cada fase tem rollback.
5. **PM no loop.** Decisões de taxonomia (referenceKey, módulos canônicos) requerem PM. Não automatizamos cegamente.

---

## 1. Inventário e infraestrutura

### 1.1 Snapshot inicial

Antes de qualquer backfill, gerar inventário do estado atual:

```sql
-- inventory.sql — rodar via psql, salvar output em CSV
\copy (
  SELECT
    p.id, p.name,
    p."referenceKey",
    (SELECT COUNT(*) FROM "Task" t WHERE t."projectId" = p.id) AS total_tasks,
    (SELECT COUNT(*) FROM "Task" t WHERE t."projectId" = p.id AND t."acceptanceCriteria" IS NOT NULL AND length(t."acceptanceCriteria") > 0) AS tasks_with_ac_text,
    (SELECT COUNT(*) FROM "Task" t WHERE t."projectId" = p.id AND t.status = 'done') AS done_tasks,
    (SELECT COUNT(*) FROM "DesignSession" ds WHERE ds."projectId" = p.id) AS design_sessions,
    (SELECT COUNT(*) FROM "ProjectPersona" pp WHERE pp."projectId" = p.id) AS personas,
    (SELECT COUNT(*) FROM "Module" m WHERE m."projectId" = p.id) AS modules,
    (SELECT COUNT(*) FROM "UserStory" us WHERE us."projectId" = p.id) AS stories
  FROM "Project" p
  ORDER BY total_tasks DESC
) TO 'inventory.csv' WITH CSV HEADER;
```

Salvar em `docs/_backfill-snapshots/inventory-2026-05-XX.csv`. **Decisões de estratégia dependem desse arquivo.**

### 1.2 Tabela de audit

```sql
-- 20260502_backfill_run.sql

CREATE TABLE "BackfillRun" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId"     uuid REFERENCES "Project"(id) ON DELETE CASCADE,
  step            text NOT NULL,            -- ex: 'persona_seed', 'task_to_story', 'ac_text_to_table'
  "startedAt"     timestamptz NOT NULL DEFAULT now(),
  "completedAt"   timestamptz,
  "ranByMember"   uuid REFERENCES "Member"(id),
  "rowsAffected"  integer,
  "result"        text NOT NULL DEFAULT 'pending'
                  CHECK (result IN ('pending','success','partial','failed','rolled_back')),
  notes           text,
  metadata        jsonb
);

CREATE INDEX "backfill_run_project_idx" ON "BackfillRun"("projectId", step);
```

Cada script de backfill insere uma row em `BackfillRun` no início e atualiza no final.

### 1.3 Backup completo antes de cada projeto

```bash
# Antes de rodar qualquer step de backfill em projeto X
pg_dump "$DIRECT_URL" \
  --table='"Project"' --table='"Task"' --table='"TaskAssignment"' \
  --table='"Module"' --table='"UserStory"' --table='"AcceptanceCriterion"' \
  --table='"ProjectPersona"' \
  --data-only \
  --where='"projectId" = '"'"'<project-uuid>'"'"' \
  > backups/project-<id>-pre-backfill-$(date +%Y%m%d).sql
```

### 1.4 Scripts onde

```
scripts/backfill/
├── 01-define-reference-keys.ts   # interativo, pede referenceKey por projeto
├── 02-seed-personas.ts           # idempotente, insere 3 default em projetos antigos
├── 03-seed-default-dod.ts        # idempotente, popula definitionOfDone se vazio
├── 04-define-modules.ts          # PM-driven (ver §3) — inputs YAML
├── 05-classify-tasks.ts          # Alpha-assistido (ver §5) — gera proposals
├── 06-create-stories-from-tasks.ts # cria UserStory + AC a partir de tasks classificadas
├── 07-migrate-ac-text-to-rows.ts # text → AcceptanceCriterion rows
├── 08-backfill-task-done-at.ts   # usa updatedAt como proxy
├── 09-classify-task-area.ts      # Alpha-assistido
├── 99-flip-flag.ts               # após validação, useStoryHierarchy = true
```

Cada script:
- Aceita `--project-id <uuid>` (obrigatório)
- Aceita `--dry-run` (loga o que faria, sem persistir)
- Insere `BackfillRun` no início, atualiza no fim
- Exit code != 0 se falha

Todos rodam via `bun scripts/backfill/<file>.ts --project-id <uuid>`.

---

## 2. Ordem de execução por projeto

```
PROJETO X
├── Decisões PM (humano)
│   ├── definir referenceKey
│   ├── definir modules canônicos (lista inicial)
│   └── definir definitionOfDone
│
├── Backfill automático
│   ├── 01-define-reference-keys      → Project.referenceKey
│   ├── 02-seed-personas               → 3 default
│   ├── 03-seed-default-dod            → Project.definitionOfDone
│   ├── 04-define-modules              → Module rows
│   ├── 05-classify-tasks              → propostas Alpha (revisar antes de 06!)
│   ├── (PM revisa CSV de propostas)
│   ├── 06-create-stories-from-tasks   → UserStory + AC; Task.userStoryId
│   ├── 07-migrate-ac-text-to-rows     → AcceptanceCriterion (de Task.acceptanceCriteria text)
│   ├── 08-backfill-task-done-at       → Task.doneAt
│   └── 09-classify-task-area          → Task.area
│
├── Validação (humano + automatizada)
│   ├── checks SQL (§9)
│   └── PM faz tour no /projects/[id] com flag temporariamente ON em staging
│
└── 99-flip-flag                       → Project.useStoryHierarchy = true
```

**Não pular etapas.** Cada uma depende da anterior.

---

## 3. Detalhamento por entidade

### 3.1 `Project.referenceKey`

**Como decidir:** PM escolhe manualmente, 2-5 letras uppercase, único globalmente.

**Critérios sugeridos:** prefixo natural do nome do projeto (CRM → `CRM`, Marketplace de Eventos → `MKE`).

**Script:** `01-define-reference-keys.ts`

```ts
// Pseudocódigo
const project = await getProject(projectId);
console.log(`Projeto: ${project.name}`);
console.log(`Sugestão automática: ${suggestKey(project.name)}`);  // CRM → CRM
const key = await prompt("referenceKey (2-5 letras maiúsculas):");
validateKey(key); // regex /^[A-Z]{2,5}$/
checkUnique(key);
await supabase.from("Project").update({ referenceKey: key }).eq("id", projectId);
log({ step: "reference_key", projectId, key });
```

**Validação:**
```sql
ALTER TABLE "Project"
  ALTER COLUMN "referenceKey" SET NOT NULL,
  ADD CONSTRAINT "project_reference_key_format" CHECK ("referenceKey" ~ '^[A-Z]{2,5}$'),
  ADD CONSTRAINT "project_reference_key_unique" UNIQUE ("referenceKey");
```

> Esse `ALTER` só roda **depois que TODOS os projetos tiverem referenceKey**. Antes disso, fica nullable.

---

### 3.2 `ProjectPersona` — seed em projetos antigos

A trigger `seed_project_personas` só dispara em **INSERTs novos**. Projetos antigos precisam do seed manualmente.

**Script:** `02-seed-personas.ts`

```ts
// Idempotente: usa ON CONFLICT
INSERT INTO "ProjectPersona" ("projectId", name, description) VALUES
  ($1, 'Builder',  'Membro do time que executa tasks'),
  ($1, 'PM',       'Gestor do projeto, define prioridades e valida entregas'),
  ($1, 'Cliente',  'Stakeholder externo / usuário final do produto')
ON CONFLICT ("projectId", name) DO NOTHING;
```

**PM pode renomear depois.** Default: 3 personas, sempre. Se projeto X só tem builders internos, "Cliente" fica disponível mas sem stories vinculadas.

**Rollback:** `DELETE FROM ProjectPersona WHERE projectId = ?` — nem **antes** de qualquer story ter sido criada referenciando.

---

### 3.3 `Project.definitionOfDone`

**Default proposto:**

```json
[
  "PR review aprovado por 1 builder + 1 PM",
  "Tem teste E2E ou unitário cobrindo o caminho feliz",
  "Deploy em staging validado com smoke test"
]
```

**Script:** `03-seed-default-dod.ts`

```ts
// Só atualiza se vazio (não sobrescreve customização manual)
UPDATE "Project"
SET "definitionOfDone" = '[...]'::jsonb
WHERE id = $1 AND "definitionOfDone" = '[]'::jsonb;
```

**PM pode customizar via Settings tab depois.**

---

### 3.4 `Module` — definição inicial

**Não tem como automatizar 100%.** Módulos são taxonomia de domínio, decisão humana.

**Estratégia híbrida:**

1. **PM gera lista inicial** baseado em conhecimento do projeto + análise dos títulos de tasks/sessions:
   ```yaml
   # backfill-input/CRM-modules.yaml
   project_id: 8e3a...
   modules:
     - name: LOGIN
       description: Autenticação, sessão e magic-link
     - name: BILLING
       description: Cobrança, planos e faturas
     - name: DASHBOARD
       description: Visão geral e indicadores
   ```

2. **Alpha sugere baseado nos títulos** (opcional, segundo passo):
   ```bash
   bun scripts/backfill/04-define-modules.ts --project-id X --suggest
   # Output: Alpha lê todas as tasks do projeto e propõe clusters → CSV pra PM revisar
   ```

3. **PM aprova final** e roda:
   ```bash
   bun scripts/backfill/04-define-modules.ts --project-id X --apply backfill-input/CRM-modules.yaml
   ```

**Rollback:** `DELETE FROM Module WHERE projectId = ?` — só antes de stories serem criadas.

---

### 3.5 `UserStory` + `AcceptanceCriterion` — agrupar tasks legacy

**Esse é o passo mais complexo.** Decidir como tasks órfãs viram stories.

#### 3.5.1 Estratégias

| Estratégia | Quando usar | Trabalho | Qualidade |
|---|---|---|---|
| **A. LEGACY placeholder** | Projetos arquivados, completed, sem necessidade de granularidade | 5 min | baixa |
| **B. Por DesignSessionItem** | Tasks já têm `designSessionId` populado | 1h por projeto | média |
| **C. Alpha clustering** | Projetos ativos, > 30 tasks órfãs | 2-4h por projeto | alta |
| **D. Manual** | < 10 tasks órfãs | 30 min | máxima |

**Recomendação por projeto:**
- Sprints **antigos completed** (já encerrados, deploy production): **A** — não precisa granularidade pra burndown histórico, só precisa não ter `Task.userStoryId IS NULL`.
- Sprints **ativos** ou **futuros** (planning) + tasks no backlog: **C** + revisão PM. Vale o investimento porque entra no fluxo novo.

#### 3.5.2 Estratégia A — LEGACY placeholder

**Script:** `06-create-stories-from-tasks.ts --strategy=legacy`

```sql
-- 1. Garante existência de Module LEGACY
INSERT INTO "Module" ("projectId", name, description)
VALUES ($1, 'LEGACY', 'Tasks históricas pré-hierarquia. Manter agrupado.')
ON CONFLICT DO NOTHING;

-- 2. Garante existência de UserStory LEGACY-MIGRATION
INSERT INTO "UserStory" (
  "projectId", "moduleId", reference,
  title, "personaId", want, "soThat",
  "refinementStatus"
)
SELECT
  p.id,
  m.id,
  next_user_story_reference(p.id),
  'Tasks históricas (pré-hierarquia)',
  (SELECT id FROM "ProjectPersona" WHERE "projectId" = p.id AND name = 'PM'),
  'consultar tasks históricas neste projeto',
  'manter contexto sem precisar reclassificar',
  'committed'
FROM "Project" p
JOIN "Module" m ON m."projectId" = p.id AND m.name = 'LEGACY'
WHERE p.id = $1
  AND NOT EXISTS (
    SELECT 1 FROM "UserStory" us
    WHERE us."projectId" = p.id AND us.title LIKE 'Tasks históricas%'
  );

-- 3. Vincula todas as tasks órfãs do projeto à story LEGACY (em sprints específicos ou todas)
UPDATE "Task" t
SET "userStoryId" = (
  SELECT us.id FROM "UserStory" us
  JOIN "Module" m ON us."moduleId" = m.id
  WHERE us."projectId" = t."projectId" AND m.name = 'LEGACY'
)
WHERE t."projectId" = $1
  AND t."userStoryId" IS NULL
  AND (
    -- Filtro opcional: só sprints completed
    t."sprintId" IN (SELECT id FROM "Sprint" WHERE "projectId" = $1 AND status = 'completed')
    OR t."sprintId" IS NULL  -- backlog sem sprint
  );
```

**Filtro:** o exemplo só agarra tasks de sprints `completed` ou sem sprint. Tasks de sprints `active` ou `planning` podem ser deixadas pra Estratégia C.

**Validação:**
```sql
SELECT COUNT(*) FROM "Task" WHERE "projectId" = $1 AND "userStoryId" IS NULL;
-- 0 = sucesso (tudo classificado, com LEGACY como fallback)
```

#### 3.5.3 Estratégia C — Alpha clustering

**Script:** `05-classify-tasks.ts`

```ts
// 1. Busca tasks órfãs do projeto + contexto (sessões, módulos disponíveis)
const orphanTasks = await getOrphanTasks(projectId);
const modules = await getModulesForProject(projectId);
const personas = await getPersonasForProject(projectId);

// 2. Pra cada CLUSTER (heurística inicial: agrupa por designSessionId quando existir,
//    senão por similaridade de título via embedding), Alpha gera proposta:
//    {
//      moduleId: <id> | null,
//      proposedModuleName: <string> | null,
//      personaId: <id>,
//      title: <string>,
//      want: <string>,
//      soThat: <string>,
//      acceptanceCriteria: [<string>],
//      taskRefs: [<TSK-001, TSK-002, ...>]  // tasks que pertencem a essa story
//    }

// 3. Output em CSV: backfill-input/CRM-classification.csv
//    Colunas: storyTitle, moduleId, personaId, want, soThat, ac1..ac5, taskRefs
//    PM revisa, edita, aprova
```

**`06-create-stories-from-tasks.ts --strategy=classified --input <csv>`** lê o CSV revisado e cria `UserStory` + `AcceptanceCriterion` + atribui `Task.userStoryId`.

#### 3.5.4 Estratégia B — DesignSessionItem

Quando tasks já têm `designSessionId` e sessions têm items razoavelmente bem definidos:

```sql
-- Pra cada DesignSessionItem com tasks vinculadas, criar 1 UserStory
WITH item_tasks AS (
  SELECT
    dsi.id            AS "itemId",
    dsi."sessionId",
    dsi.title         AS "itemTitle",
    dsi.description   AS "itemDescription",
    ds."projectId",
    array_agg(t.id ORDER BY t."createdAt") AS task_ids
  FROM "DesignSessionItem" dsi
  JOIN "DesignSession" ds ON ds.id = dsi."sessionId"
  JOIN "TaskAssignment" ta ON ta."designSessionItemId" = dsi.id
  JOIN "Task" t ON t.id = ta."taskId"
  WHERE ds."projectId" = $1
    AND t."userStoryId" IS NULL
  GROUP BY dsi.id, ds."projectId", dsi.title, dsi.description
)
INSERT INTO "UserStory" (
  "projectId", "moduleId", reference,
  title, "personaId", want, "soThat",
  "refinementStatus", "designSessionId", "designSessionItemId"
)
SELECT
  it."projectId",
  NULL, -- moduleId atribuído numa segunda passada via classificação Alpha (opcional)
  next_user_story_reference(it."projectId"),
  it."itemTitle",
  (SELECT id FROM "ProjectPersona" WHERE "projectId" = it."projectId" AND name = 'PM'),
  COALESCE(it."itemDescription", 'continuar trabalho discutido em design session'),
  NULL,
  'committed',
  it."sessionId",
  it."itemId"
FROM item_tasks it;

-- Em seguida, vincular tasks
UPDATE "Task" t
SET "userStoryId" = us.id
FROM "UserStory" us
WHERE us."designSessionItemId" = ANY (
  SELECT id FROM "DesignSessionItem" WHERE id IN (SELECT "designSessionItemId" FROM "TaskAssignment" WHERE "taskId" = t.id)
)
AND t."userStoryId" IS NULL;
```

**Limitação:** itens com 0 tasks viram UserStory órfãs (o que pode ser OK — preserva a discussão histórica). Itens com >1 task com módulos diferentes geram ruído — revisar manualmente.

---

### 3.6 `AcceptanceCriterion` — text → table

Tasks legadas têm `acceptanceCriteria text` com items separados por newline.

**Script:** `07-migrate-ac-text-to-rows.ts`

```sql
-- 1. Quebrar texto em linhas, criar 1 row por linha não-vazia
INSERT INTO "AcceptanceCriterion" ("taskId", text, "order", "checkedAt", "checkedBy")
SELECT
  t.id,
  trim(line),
  ord,
  -- Heurística: se task tá done, AC fica marcado com createdBy como checkedBy
  CASE WHEN t.status = 'done' THEN COALESCE(t."doneAt", t."updatedAt") ELSE NULL END,
  CASE WHEN t.status = 'done' THEN t."createdById" ELSE NULL END
FROM "Task" t,
LATERAL unnest(string_to_array(t."acceptanceCriteria", E'\n')) WITH ORDINALITY AS u(line, ord)
WHERE t."projectId" = $1
  AND t."acceptanceCriteria" IS NOT NULL
  AND length(trim(t."acceptanceCriteria")) > 0
  AND length(trim(line)) > 0
  AND NOT EXISTS (
    SELECT 1 FROM "AcceptanceCriterion" ac WHERE ac."taskId" = t.id
  );

-- 2. Validar
SELECT
  COUNT(*) FILTER (WHERE "acceptanceCriteria" IS NOT NULL AND length(trim("acceptanceCriteria")) > 0) AS tasks_with_text,
  (SELECT COUNT(DISTINCT "taskId") FROM "AcceptanceCriterion" WHERE "taskId" IN (SELECT id FROM "Task" WHERE "projectId" = $1)) AS tasks_with_rows
FROM "Task" WHERE "projectId" = $1;
-- Os dois números devem bater
```

**Heurística de validation:** se task tá `done` e tinha texto AC, marcamos todos como `checked` (com `checkedBy = createdById`). Otimismo razoável — tasks done no schema antigo não tinham granularidade de quem checou cada AC.

**PM pode desmarcar manualmente depois** se descobrir que algum AC não foi de fato verificado.

---

### 3.7 `Task.doneAt`

Tasks legadas com status `done` não têm `doneAt`. Aproximação: `updatedAt` da task é razoável (último update geralmente coincide com transição pra done).

**Script:** `08-backfill-task-done-at.ts`

```sql
UPDATE "Task"
SET "doneAt" = "updatedAt"
WHERE "projectId" = $1
  AND status = 'done'
  AND "doneAt" IS NULL;
```

**Imprecisão aceita:** burndown de sprints históricos vai usar `updatedAt`. Pode dar curvas levemente esquisitas (ex: várias tasks done no mesmo dia). Não é ideal mas é o melhor sinal disponível sem rebuild de histórico.

**Trigger sync_task_done_at** (criada na Fase 1) cuida das transições futuras.

---

### 3.8 `Task.area`

**Estratégia:** Alpha-assistido, pode rodar em batch por projeto.

**Script:** `09-classify-task-area.ts`

```ts
// 1. Lê tasks do projeto sem area
const tasks = await getTasksWithoutArea(projectId);

// 2. Alpha classifica baseado em title + description + type:
//    Prompt: "Classifique esta task em area: front | back | infra | ops | mixed | null.
//             Title: {title}
//             Description: {description}
//             Type: {type}
//             Scope: {scope}
//             Retorne só { area: '...' }"

// 3. Aplica em batch + log
const proposals = await Promise.all(tasks.map(t => alpha.classifyArea(t)));
// Output CSV pra PM revisar
// Após aprovação:
UPDATE "Task" SET "area" = $newArea WHERE id = $taskId;
```

**Validação:** rodar amostra de 20 tasks classificadas, PM confere. Se erro > 10%, ajustar prompt e rerodar.

---

## 4. Validação consolidada

Após todos os scripts rodarem em projeto X, rodar checks:

```sql
-- check-backfill.sql --project-id $1

-- 1. Project tem referenceKey + DoD
SELECT
  CASE WHEN "referenceKey" IS NOT NULL THEN 'ok' ELSE 'FAIL: referenceKey' END,
  CASE WHEN jsonb_array_length("definitionOfDone") > 0 THEN 'ok' ELSE 'FAIL: dod' END
FROM "Project" WHERE id = $1;

-- 2. Tem ao menos 3 personas
SELECT
  CASE WHEN COUNT(*) >= 3 THEN 'ok' ELSE 'FAIL: < 3 personas' END
FROM "ProjectPersona" WHERE "projectId" = $1;

-- 3. Tem pelo menos 1 module (LEGACY ou outros)
SELECT
  CASE WHEN COUNT(*) >= 1 THEN 'ok' ELSE 'FAIL: 0 modules' END
FROM "Module" WHERE "projectId" = $1;

-- 4. Toda task com sprint encerrado tem userStoryId
SELECT
  CASE WHEN COUNT(*) = 0 THEN 'ok' ELSE 'FAIL: ' || COUNT(*) || ' tasks órfãs' END
FROM "Task" t
LEFT JOIN "Sprint" s ON s.id = t."sprintId"
WHERE t."projectId" = $1
  AND t."userStoryId" IS NULL
  AND (s.status = 'completed' OR t."sprintId" IS NULL);

-- 5. Toda task com AC text legado tem AC rows
SELECT
  CASE WHEN COUNT(*) = 0 THEN 'ok' ELSE 'FAIL: ' || COUNT(*) || ' tasks com AC text mas sem rows' END
FROM "Task" t
WHERE t."projectId" = $1
  AND t."acceptanceCriteria" IS NOT NULL
  AND length(trim(t."acceptanceCriteria")) > 0
  AND NOT EXISTS (SELECT 1 FROM "AcceptanceCriterion" ac WHERE ac."taskId" = t.id);

-- 6. Task done tem doneAt
SELECT
  CASE WHEN COUNT(*) = 0 THEN 'ok' ELSE 'FAIL: ' || COUNT(*) || ' tasks done sem doneAt' END
FROM "Task"
WHERE "projectId" = $1 AND status = 'done' AND "doneAt" IS NULL;

-- 7. Task tem area (warn, não fail — area pode ser null)
SELECT
  COUNT(*) FILTER (WHERE area IS NULL) AS without_area,
  COUNT(*)                              AS total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE area IS NULL) / COUNT(*), 1) AS pct_null
FROM "Task" WHERE "projectId" = $1;
-- < 30% null = aceitável
```

**Output esperado:** todas as 6 primeiras checks retornam `ok`. Check 7 é warning, não bloqueia.

---

## 5. Tour humano antes de flip flag

Em **staging** (com clone do prod), PM faz:
1. Aba Stories: lista mostra LEGACY-MIGRATION? Stories aprovadas pelo PM aparecem corretamente?
2. Aba Tasks: filtros funcionam? Toggle Story/Flat OK?
3. Aba Sprints: vigente abre, burndown renderiza dos sprints históricos (com `doneAt = updatedAt` aproximado)?
4. Settings: modules + personas listadas? Edição funciona?
5. Story detail (sheet): AC interativo? Tasks aninhadas?

**Checklist de aprovação:** PM assina em comentário no Linear/Notion. Sem assinatura = sem flip.

---

## 6. Flip flag

```bash
# Após validação humana
bun scripts/backfill/99-flip-flag.ts --project-id <uuid>
```

Que executa:

```sql
UPDATE "Project" SET "useStoryHierarchy" = true WHERE id = $1;
```

E loga em `BackfillRun`. A partir daí, `/projects/<id>` mostra UI nova.

---

## 7. Rollback por etapa

| Etapa | Como reverter |
|---|---|
| `01-define-reference-keys` | `UPDATE Project SET referenceKey = NULL WHERE id = ?` |
| `02-seed-personas` | `DELETE FROM ProjectPersona WHERE projectId = ? AND name IN ('Builder','PM','Cliente') AND <não tem stories vinculadas>` |
| `03-seed-default-dod` | `UPDATE Project SET definitionOfDone = '[]'::jsonb WHERE id = ?` |
| `04-define-modules` | `DELETE FROM Module WHERE projectId = ? AND <sem stories vinculadas>` |
| `06-create-stories` | Restore do backup do passo 1.3 (mais seguro que script reverso) |
| `07-migrate-ac-text` | `DELETE FROM AcceptanceCriterion WHERE taskId IN (SELECT id FROM Task WHERE projectId = ?)` |
| `08-backfill-doneAt` | `UPDATE Task SET doneAt = NULL WHERE projectId = ? AND ... < deve filtrar só os tocados pelo backfill, usar log do BackfillRun.metadata>` |
| `09-classify-area` | `UPDATE Task SET area = NULL WHERE projectId = ?` (ou restore do backup) |
| `99-flip-flag` | `UPDATE Project SET useStoryHierarchy = false WHERE id = ?` — instantâneo, sem perda |

**Forte recomendação:** se algo deu errado a partir do passo 06, **restore do backup** ao invés de tentar script reverso. AC tabularizado + UserStory criado + Tasks atribuídas é estado complexo demais pra reverter cirurgicamente.

---

## 8. Estratégia recomendada por categoria de projeto

| Categoria | Tasks órfãs típico | Estratégia | Tempo estimado |
|---|---|---|---|
| **Projeto arquivado** (status='archived') | qualquer | Pula tudo. Mantém flag OFF. | 0 |
| **Projeto completed** (status='completed', sem novos sprints) | qualquer | A (LEGACY) + 02, 03, 07, 08. Pula 04-06 e 09. | 30 min |
| **Projeto active, < 30 tasks órfãs** | poucas | D (manual) ou B (DesignSessionItem) | 1h |
| **Projeto active, 30-100 tasks** | médio | B + C híbrido (B pega o que tem session, C cluster o resto) | 2-3h |
| **Projeto active, 100+ tasks** | muitas | C (Alpha) + revisão PM intensa | 4-8h |

**Decisão por projeto:** PM olha inventário (§1.1) e classifica. Output: planilha com `project_id, strategy, estimated_hours, owner`.

---

## 9. Cronograma macro

| Semana | Atividade |
|---|---|
| 0 | Inventário + decisões de estratégia por projeto |
| 1 | Backfill projetos `completed` (estratégia A) — quick wins |
| 2-3 | Backfill projetos `active` priorizados (3-5 projetos) |
| 4 | Resto dos projetos `active` |
| 5+ | Stragglers + projetos arquivados (se decidir migrar) |

Após **todos** os projetos com `useStoryHierarchy = true` → executa Fase 8 do plano principal (drop columns).

---

## 10. Decisões abertas (fechar antes da execução)

1. **Backfillar projetos `archived`?** Recomendo não. Custo > benefício. Flag fica OFF pra sempre, projeto fica visível no modo legacy.

2. **AC text → rows: marcar como checked se task done?** Recomendo sim (ver §3.6). Menos atrito pro PM. Validar com 1 PM antes de rodar em massa.

3. **Quem aprova taxonomia de módulos?** PM do projeto exclusivamente, ou pode ser CRO/Head Ops também? Decidir via memória `project_member_roles_access`.

4. **Bloqueio de novos projetos durante backfill?** Não — projetos novos já vêm com flag ON automaticamente após Fase 1 (decidir se queremos `default true` no flag depois das primeiras Sm sucessos).

5. **Volume real do `Project.referenceKey`:** confirmar quantos projetos existem hoje. Se < 10, manual é trivial. Se > 50, vale UI dedicada de admin pra rodar `01-define-reference-keys` em batch.

---

## 11. Métricas de sucesso

- 100% dos projetos `active` migrados em ≤ 6 semanas
- 0 erros 500 em `/api/stories/*` durante 7 dias após cada flip
- ≥ 90% das tasks com `area` preenchida (não null) após 09-classify
- 0 tasks com `acceptanceCriteria` text legado órfão (sem rows correspondentes)
- PM-piloto reporta tempo de planning reduzido em ≥ 20% após migração

---

## 12. Apêndice: checklist por-projeto

Cole isso num issue / card por projeto:

```
[ ] Backup pré-backfill criado
[ ] BackfillRun row criada (step='start', metadata={original_state})
[ ] referenceKey definido pelo PM
[ ] Personas seedadas (3 default)
[ ] DoD seedado (3 default)
[ ] Modules canônicos definidos pelo PM (≥ 3 sugerido)
[ ] Estratégia de tasks órfãs escolhida: [ A | B | C | D ]
[ ] (se C) CSV de propostas Alpha gerado e revisado pelo PM
[ ] Stories criadas e tasks vinculadas
[ ] AC text → rows migrados
[ ] doneAt backfillado em tasks done
[ ] area classificada por Alpha + revisão amostral
[ ] Validação SQL passa (todas 6 checks ok)
[ ] Tour humano em staging — PM aprovou
[ ] Flag flipped: useStoryHierarchy = true
[ ] Monitorar 48h pós-flip — sem erros
[ ] Comunicação para o time do projeto
```
