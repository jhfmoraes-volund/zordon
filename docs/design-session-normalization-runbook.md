# Design Session Normalization — Runbook

**Plano de referência:** [design-session-normalization-plan.md](design-session-normalization-plan.md)
**Janela:** 2026-05-12 em diante. Time avisado, ninguém usa DS.
**Branch:** `joao-dev` (já criada localmente — branch pessoal do João antes de promover pra `main`).

## Pré-condições já satisfeitas (2026-05-12)

Pra agente em contexto limpo: estes passos JÁ foram executados, **não refazer**:

- Branch `joao-dev` criada localmente (a partir de `main`). Ainda não pushada.
- Backup in-banco: `DesignSessionStepData_backup_20260512` (20 rows, digest `e5b2deffc5d473718f7a0851a4a329b8`).
- Snapshot pré-migração: `/tmp/ds-snapshot-pre.txt` (6 sessions, 20 rows distribuídas pelos 9 stepKeys).
- Inspeção de shapes feita — decisões consolidadas no §1.1 abaixo (`_notes` → `DesignSessionStepNote`, `_drafts` descartado, `pre_work` sem tabela 1:1).
- Script de sync pessoal: `scripts/sync-joao-dev.sh` (commit + push pra `origin/joao-dev`, sem promover pra `main`).
- Untracked aguardando commit: este runbook, `docs/design-session-normalization-plan.md`, `scripts/sync-joao-dev.sh`.

**Início recomendado**: Fase 0 (defensiva no endpoint legado) — não depende da janela e não muda comportamento user-visible.

---

## Convenções do runbook

- Cada passo tem: **objetivo**, **ação**, **comando/path**, **verificação**.
- `STOP` = não avançar se a verificação falhar. Investiga ou rolla back.
- Status: marcar `[x]` ao concluir cada checkbox.
- Tudo em branch isolada. Migration roda via `psql "$DIRECT_URL" -f <arquivo>`.

---

## Pré-requisito: setup

- [ ] Confirmar branch: `git switch joao-dev` (branch pessoal já criada; commits vão pra `origin/joao-dev` via `scripts/sync-joao-dev.sh` antes de promover pra `main`)
- [ ] `.env` carregado: `source <(grep '^DIRECT_URL=' .env | sed 's/^/export /')`
- [ ] Validar conexão: `psql "$DIRECT_URL" -c "SELECT current_database(), now()"`
- [ ] Snapshot da contagem atual:
  ```bash
  psql "$DIRECT_URL" -c "SELECT type, COUNT(*) FROM \"DesignSession\" GROUP BY type"
  psql "$DIRECT_URL" -c "SELECT \"stepKey\", COUNT(*) FROM \"DesignSessionStepData\" GROUP BY \"stepKey\" ORDER BY \"stepKey\""
  ```
  Salvar saída em `/tmp/ds-snapshot-pre.txt` — referência pós-backfill.

**STOP** se branch não tá limpa ou conexão falha.

---

## Fase 0 — Defensiva no endpoint legado (~1h)

> **Pode rodar antes da janela.** Sem mudança de comportamento user-visible. Bloqueia lixo entrando no JSON durante a janela.

### 0.1 Zod no PUT do endpoint genérico

- **Path:** [src/app/api/design-sessions/[id]/steps/[stepKey]/route.ts](src/app/api/design-sessions/[id]/steps/[stepKey]/route.ts)
- **Ação:** importar schemas existentes de [src/lib/agent/schemas.ts](src/lib/agent/schemas.ts) e criar um `Record<stepKey, ZodSchema>` que valida `req.json()` antes do upsert. Mapping:
  - `pre_work` → schema simples `{ files?, transcripts?, _notes? }`
  - `product_vision` → 5 strings + `_notes`
  - `scope_definition` → 4 arrays de `{ id, text }` + `_notes`
  - `personas_journeys` → `{ personas: PersonaSchema[], _notes? }`
  - `brainstorm` → `{ solutions: SolutionSchema[], _drafts?, _notes? }`
  - `risks_gaps` → `{ risks: RiskSchema[], gaps: GapSchema[], _notes? }`
  - `prioritization` → `{ items: PrioritizationItemSchema[], _drafts?, _notes? }`
  - `technical_specs` → `{ stack, performance, integrations[], rules[], _notes? }`
  - `hypotheses` → `{ hypotheses: HypothesisSchema[], _notes? }`
- **Validação:** rodar 1 PUT válido + 1 PUT com campo extra inválido. Esperado: 200 e 400.

### 0.2 Trocar `requireSessionAccessApi` → `requireSessionEditApi` no PUT

- **Path:** mesmo arquivo
- **Ação:** no handler PUT, substituir `requireSessionAccessApi(id)` por `requireSessionEditApi(id)` (importar de [src/lib/dal.ts:564](src/lib/dal.ts#L564)). GET fica com Access.
- **Validação:** com JWT de viewer (ProjectAccess.role='viewer'), PUT deve retornar 403. Com session_participant+, 200.

### 0.3 Commit Fase 0

- [ ] Lint + typecheck passam
- [ ] `bash scripts/sync-joao-dev.sh -m "ZRD-JM-XX: agent/api — ds endpoint legacy zod + edit guard"` (vai pra `origin/joao-dev`; merge pra `main` fica pra depois)

---

## Fase 1 — Migration de schema + RLS + backfill (uma transação)

> Esta é a **migração crítica**. Tudo num único arquivo SQL, num único `BEGIN`/`COMMIT`. Rollback automático se qualquer assertion falhar.

### 1.1 Shapes reais — decisões consolidadas (2026-05-12)

Inspeção feita em 2026-05-12 (Zelar v2, session `264e6d07-d365-43ba-8029-d539ce6f7c6b`, + spot-check nas outras 5):

| stepKey | top-level keys do JSON |
|---|---|
| `pre_work` | `_notes` (só isso — files/transcripts vivem em `DesignSessionResearch` e `DesignSessionTranscript` desde 20260508) |
| `product_vision` | `problem`, `whoSuffers`, `consequences`, `successVision`, `impactMetrics`, `_notes` |
| `scope_definition` | `is`, `isNot`, `does`, `doesNot`, `_notes` (cada um é array `[{id, text}]`) |
| `personas_journeys` | `personas: []`, `_notes` |
| `brainstorm` | `solutions: []`, `_drafts`, `_notes` |
| `risks_gaps` | `risks: []`, `gaps: []`, `_notes` |
| `prioritization` | `items: []`, `_drafts`, `_notes` |
| `technical_specs` | `stack`, `performance`, `integrations: []`, `rules: []`, `_notes` |
| `hypotheses` | `hypotheses: []`, `_notes` |

**Decisões tomadas:**

- **`_notes`** é **sticky notes do facilitador** por step (`type Note = { id, text }`, renderizadas pelo `StickyNoteBoard` em [src/components/design-session/sticky-note.tsx](src/components/design-session/sticky-note.tsx); o agent inclusive lê elas — ver prompt em [src/lib/agent/prompt.ts:1363](src/lib/agent/prompt.ts#L1363)). **Manter como feature**, modelada em **tabela genérica 1:N** `DesignSessionStepNote(sessionId, stepKey, text, orderIndex)` — um único endpoint/hook serve todos os 9 steps. Hoje os 13 `_notes` no banco são todos `[]` vazios → backfill efetivo = 0 rows, mas schema pronto pra continuidade da feature.
- **`_drafts`** (presente em 2 rows: Zelar v2 brainstorm + prioritization, ambos com arrays vazios) → **descartar**. É UI scratch volátil; sem valor preservar.
- **Pre-work files/transcripts**: confirmado via `\d` no banco — `DesignSessionResearch` (2 rows, files/queries com sources jsonb) e `DesignSessionTranscript` (0 rows, Roam transcripts) já existem com RLS própria. Pre-work não tem entidade 1:1 nem precisa: o step é apenas um agregado dessas tabelas + sticky notes (via `DesignSessionStepNote`). **`DesignSessionPreWork` removida da migration**; backfill desse step = no-op.
- **`DesignSessionRiskGapMeta`** removida — só guardaria `_notes`, agora coberto por `DesignSessionStepNote`.

Snapshot pré-migração (`/tmp/ds-snapshot-pre.txt`):
- 6 sessions (todas `inception`)
- 20 rows em `DesignSessionStepData`: brainstorm=2, hypotheses=2, personas_journeys=2, pre_work=3, prioritization=2, product_vision=2, risks_gaps=2, scope_definition=3, technical_specs=2

Backup já existe: `DesignSessionStepData_backup_20260506` (gerado na migration UUID de 2026-04-30). **Confirmar com João se serve, ou se faz `pg_dump` adicional antes da Fase 1.**

### 1.2 Criar arquivo de migration

- **Path:** `supabase/migrations/20260513_design_session_normalization.sql` (ajustar data se rodar depois)
- **Estrutura:**

```sql
BEGIN;

-- ============================================================
-- 1. CREATE TABLES
-- ============================================================

-- 1.1 DesignSessionStepNote (1:N) — sticky notes do facilitador, genérica por step
CREATE TABLE "DesignSessionStepNote" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionId" uuid NOT NULL REFERENCES "DesignSession"(id) ON DELETE CASCADE,
  "stepKey" text NOT NULL CHECK ("stepKey" IN (
    'pre_work','product_vision','scope_definition','personas_journeys',
    'brainstorm','risks_gaps','prioritization','technical_specs','hypotheses'
  )),
  text text NOT NULL DEFAULT '',
  "orderIndex" int NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON "DesignSessionStepNote"("sessionId", "stepKey", "orderIndex");

-- (pre_work não tem tabela 1:1 — files/transcripts vivem em
--  DesignSessionResearch e DesignSessionTranscript desde 20260508;
--  sticky notes via DesignSessionStepNote acima)

-- 1.2 DesignSessionProductVision (1:1)
CREATE TABLE "DesignSessionProductVision" (
  "sessionId" uuid PRIMARY KEY REFERENCES "DesignSession"(id) ON DELETE CASCADE,
  problem text NOT NULL DEFAULT '',
  "whoSuffers" text NOT NULL DEFAULT '',
  consequences text NOT NULL DEFAULT '',
  "successVision" text NOT NULL DEFAULT '',
  "impactMetrics" text NOT NULL DEFAULT '',
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- 1.3 DesignSessionScope (1:1) — renomeando is→inScope, isNot→outOfScope
CREATE TABLE "DesignSessionScope" (
  "sessionId" uuid PRIMARY KEY REFERENCES "DesignSession"(id) ON DELETE CASCADE,
  "inScope" jsonb NOT NULL DEFAULT '[]',
  "outOfScope" jsonb NOT NULL DEFAULT '[]',
  does jsonb NOT NULL DEFAULT '[]',
  "doesNot" jsonb NOT NULL DEFAULT '[]',
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- 1.4 DesignSessionPersona (1:N)
CREATE TABLE "DesignSessionPersona" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionId" uuid NOT NULL REFERENCES "DesignSession"(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT '',
  context text NOT NULL DEFAULT '',
  "asIsSteps" jsonb NOT NULL DEFAULT '[]',
  "toBeSteps" jsonb NOT NULL DEFAULT '[]',
  "orderIndex" int NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON "DesignSessionPersona"("sessionId", "orderIndex");

-- 1.5 DesignSessionBrainstormFeature já existe — só aplicar RLS retroativa (§4.2)
-- ver bloco 2 abaixo.

-- 1.6 DesignSessionRisk (1:N) — decisão revisão 2: separar de Gap
CREATE TABLE "DesignSessionRisk" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionId" uuid NOT NULL REFERENCES "DesignSession"(id) ON DELETE CASCADE,
  text text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'business' CHECK (category IN ('business','technical')),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('high','medium','low')),
  "relatedFeature" text,
  mitigation text,
  "orderIndex" int NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON "DesignSessionRisk"("sessionId", severity);

CREATE TABLE "DesignSessionGap" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionId" uuid NOT NULL REFERENCES "DesignSession"(id) ON DELETE CASCADE,
  text text NOT NULL DEFAULT '',
  category text,
  severity text,
  "relatedFeature" text,
  mitigation text,
  "orderIndex" int NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON "DesignSessionGap"("sessionId", "orderIndex");

-- (sticky notes do risks_gaps vão para DesignSessionStepNote com stepKey='risks_gaps')

-- 1.7 DesignSessionPriorityItem (1:N)
CREATE TABLE "DesignSessionPriorityItem" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionId" uuid NOT NULL REFERENCES "DesignSession"(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  "howItSolves" text NOT NULL DEFAULT '',
  "targetPersona" text NOT NULL DEFAULT '',
  bucket text NOT NULL DEFAULT 'next' CHECK (bucket IN ('mvp','next','out')),
  "keyScreens" text,
  "userFlows" text,
  "painPointRef" text,
  "technicalNotes" text,
  "orderIndex" int NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON "DesignSessionPriorityItem"("sessionId", bucket);
CREATE INDEX ON "DesignSessionPriorityItem"("sessionId", "orderIndex");

-- 1.8 DesignSessionTechnicalSpecs (1:1)
CREATE TABLE "DesignSessionTechnicalSpecs" (
  "sessionId" uuid PRIMARY KEY REFERENCES "DesignSession"(id) ON DELETE CASCADE,
  stack text NOT NULL DEFAULT '',
  performance text NOT NULL DEFAULT '',
  integrations jsonb NOT NULL DEFAULT '[]',
  rules jsonb NOT NULL DEFAULT '[]',
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- 1.9 DesignSessionHypothesis (1:N)
CREATE TABLE "DesignSessionHypothesis" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionId" uuid NOT NULL REFERENCES "DesignSession"(id) ON DELETE CASCADE,
  hypothesis text NOT NULL DEFAULT '',
  indicator text NOT NULL DEFAULT '',
  target text NOT NULL DEFAULT '',
  "expectedResult" text NOT NULL DEFAULT '',
  evidence text,
  "orderIndex" int NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON "DesignSessionHypothesis"("sessionId", "orderIndex");

-- ============================================================
-- 2. RLS — padrão canônico (loop)
-- ============================================================

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'DesignSessionStepNote',
    'DesignSessionProductVision',
    'DesignSessionScope',
    'DesignSessionPersona',
    'DesignSessionBrainstormFeature',  -- retro-RLS
    'DesignSessionRisk',
    'DesignSessionGap',
    'DesignSessionPriorityItem',
    'DesignSessionTechnicalSpecs',
    'DesignSessionHypothesis'
  ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY "manager_or_viewer_select" ON %I FOR SELECT USING (can_access_session("sessionId"))', t
    );
    EXECUTE format(
      'CREATE POLICY "manager_or_editor_insert" ON %I FOR INSERT WITH CHECK (can_edit_session("sessionId"))', t
    );
    EXECUTE format(
      'CREATE POLICY "manager_or_editor_update" ON %I FOR UPDATE USING (can_edit_session("sessionId")) WITH CHECK (can_edit_session("sessionId"))', t
    );
    EXECUTE format(
      'CREATE POLICY "manager_or_editor_delete" ON %I FOR DELETE USING (can_edit_session("sessionId"))', t
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO authenticated', t);
  END LOOP;
END $$;

-- ============================================================
-- 3. BACKFILL
-- ============================================================

-- 3.1 step notes (genérico, todos os steps) — _notes é array [{id, text}]
INSERT INTO "DesignSessionStepNote" (id, "sessionId", "stepKey", text, "orderIndex", "createdAt", "updatedAt")
SELECT
  COALESCE((note->>'id')::uuid, gen_random_uuid()),
  sd."sessionId"::uuid,
  sd."stepKey",
  COALESCE(note->>'text', ''),
  (ord - 1)::int,
  sd."updatedAt",
  sd."updatedAt"
FROM "DesignSessionStepData" sd,
     LATERAL jsonb_array_elements(sd.data->'_notes') WITH ORDINALITY AS arr(note, ord)
WHERE jsonb_typeof(sd.data->'_notes') = 'array'
  AND jsonb_array_length(sd.data->'_notes') > 0
ON CONFLICT (id) DO NOTHING;

-- (pre_work não tem backfill 1:1 — só sticky notes via 3.1 acima, se houver)

-- 3.2 product_vision
INSERT INTO "DesignSessionProductVision" ("sessionId", problem, "whoSuffers", consequences, "successVision", "impactMetrics", "updatedAt")
SELECT
  "sessionId"::uuid,
  COALESCE(data->>'problem', ''),
  COALESCE(data->>'whoSuffers', ''),
  COALESCE(data->>'consequences', ''),
  COALESCE(data->>'successVision', ''),
  COALESCE(data->>'impactMetrics', ''),
  "updatedAt"
FROM "DesignSessionStepData"
WHERE "stepKey" = 'product_vision'
ON CONFLICT ("sessionId") DO NOTHING;

-- 3.3 scope_definition (is→inScope, isNot→outOfScope)
INSERT INTO "DesignSessionScope" ("sessionId", "inScope", "outOfScope", does, "doesNot", "updatedAt")
SELECT
  "sessionId"::uuid,
  COALESCE(data->'is', '[]'::jsonb),
  COALESCE(data->'isNot', '[]'::jsonb),
  COALESCE(data->'does', '[]'::jsonb),
  COALESCE(data->'doesNot', '[]'::jsonb),
  "updatedAt"
FROM "DesignSessionStepData"
WHERE "stepKey" = 'scope_definition'
ON CONFLICT ("sessionId") DO NOTHING;

-- 3.4 personas_journeys → explode data->'personas'
INSERT INTO "DesignSessionPersona" (id, "sessionId", name, role, context, "asIsSteps", "toBeSteps", "orderIndex", "createdAt", "updatedAt")
SELECT
  COALESCE((persona->>'id')::uuid, gen_random_uuid()),
  sd."sessionId"::uuid,
  COALESCE(persona->>'name', ''),
  COALESCE(persona->>'role', ''),
  COALESCE(persona->>'context', ''),
  COALESCE(persona->'asIsSteps', '[]'::jsonb),
  COALESCE(persona->'toBeSteps', '[]'::jsonb),
  (ord - 1)::int,
  sd."updatedAt",
  sd."updatedAt"
FROM "DesignSessionStepData" sd,
     LATERAL jsonb_array_elements(sd.data->'personas') WITH ORDINALITY AS arr(persona, ord)
WHERE sd."stepKey" = 'personas_journeys'
ON CONFLICT (id) DO NOTHING;

-- 3.5 brainstorm — JÁ está em DesignSessionBrainstormFeature via trigger. Validar contagem.
-- (não fazemos INSERT — só log de contagem na fase de validação)

-- 3.6 risks_gaps → explode 2 arrays + meta
INSERT INTO "DesignSessionRisk" (id, "sessionId", text, category, severity, "relatedFeature", mitigation, "orderIndex", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  sd."sessionId"::uuid,
  COALESCE(risk->>'text', ''),
  COALESCE(risk->>'category', 'business'),
  COALESCE(risk->>'severity', 'medium'),
  risk->>'relatedFeature',
  risk->>'mitigation',
  (ord - 1)::int,
  sd."updatedAt",
  sd."updatedAt"
FROM "DesignSessionStepData" sd,
     LATERAL jsonb_array_elements(sd.data->'risks') WITH ORDINALITY AS arr(risk, ord)
WHERE sd."stepKey" = 'risks_gaps';

INSERT INTO "DesignSessionGap" (id, "sessionId", text, category, severity, "relatedFeature", mitigation, "orderIndex", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  sd."sessionId"::uuid,
  COALESCE(gap->>'text', ''),
  gap->>'category',
  gap->>'severity',
  gap->>'relatedFeature',
  gap->>'mitigation',
  (ord - 1)::int,
  sd."updatedAt",
  sd."updatedAt"
FROM "DesignSessionStepData" sd,
     LATERAL jsonb_array_elements(sd.data->'gaps') WITH ORDINALITY AS arr(gap, ord)
WHERE sd."stepKey" = 'risks_gaps';

-- (notes do risks_gaps já cobertos pelo 3.1 step notes genérico)

-- 3.7 prioritization → explode data->'items'
INSERT INTO "DesignSessionPriorityItem" (id, "sessionId", title, "howItSolves", "targetPersona", bucket, "keyScreens", "userFlows", "painPointRef", "technicalNotes", "orderIndex", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  sd."sessionId"::uuid,
  COALESCE(item->>'title', ''),
  COALESCE(item->>'howItSolves', ''),
  COALESCE(item->>'targetPersona', ''),
  COALESCE(item->>'bucket', 'next'),
  item->>'keyScreens',
  item->>'userFlows',
  item->>'painPointRef',
  item->>'technicalNotes',
  (ord - 1)::int,
  sd."updatedAt",
  sd."updatedAt"
FROM "DesignSessionStepData" sd,
     LATERAL jsonb_array_elements(sd.data->'items') WITH ORDINALITY AS arr(item, ord)
WHERE sd."stepKey" = 'prioritization';

-- 3.8 technical_specs
INSERT INTO "DesignSessionTechnicalSpecs" ("sessionId", stack, performance, integrations, rules, "updatedAt")
SELECT
  "sessionId"::uuid,
  COALESCE(data->>'stack', ''),
  COALESCE(data->>'performance', ''),
  COALESCE(data->'integrations', '[]'::jsonb),
  COALESCE(data->'rules', '[]'::jsonb),
  "updatedAt"
FROM "DesignSessionStepData"
WHERE "stepKey" = 'technical_specs'
ON CONFLICT ("sessionId") DO NOTHING;

-- 3.9 hypotheses → explode data->'hypotheses'
INSERT INTO "DesignSessionHypothesis" (id, "sessionId", hypothesis, indicator, target, "expectedResult", evidence, "orderIndex", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  sd."sessionId"::uuid,
  COALESCE(item->>'hypothesis', ''),
  COALESCE(item->>'indicator', ''),
  COALESCE(item->>'target', ''),
  COALESCE(item->>'expectedResult', ''),
  item->>'evidence',
  (ord - 1)::int,
  sd."updatedAt",
  sd."updatedAt"
FROM "DesignSessionStepData" sd,
     LATERAL jsonb_array_elements(sd.data->'hypotheses') WITH ORDINALITY AS arr(item, ord)
WHERE sd."stepKey" = 'hypotheses';

-- ============================================================
-- 4. ASSERTIONS
-- ============================================================

DO $$
DECLARE
  v_actual int;
  v_expected int;
BEGIN
  -- step notes: soma de jsonb_array_length(_notes) em todo step_data com _notes não-vazio
  SELECT COUNT(*) INTO v_actual FROM "DesignSessionStepNote";
  SELECT COALESCE(SUM(jsonb_array_length(data->'_notes')), 0) INTO v_expected
    FROM "DesignSessionStepData"
    WHERE jsonb_typeof(data->'_notes') = 'array'
      AND jsonb_array_length(data->'_notes') > 0;
  IF v_actual != v_expected THEN
    RAISE EXCEPTION 'step notes: % vs %', v_actual, v_expected;
  END IF;

  -- product_vision
  SELECT COUNT(*) INTO v_actual FROM "DesignSessionProductVision";
  SELECT COUNT(*) INTO v_expected FROM "DesignSessionStepData" WHERE "stepKey" = 'product_vision';
  IF v_actual != v_expected THEN
    RAISE EXCEPTION 'product_vision: % vs %', v_actual, v_expected;
  END IF;

  -- scope
  SELECT COUNT(*) INTO v_actual FROM "DesignSessionScope";
  SELECT COUNT(*) INTO v_expected FROM "DesignSessionStepData" WHERE "stepKey" = 'scope_definition';
  IF v_actual != v_expected THEN
    RAISE EXCEPTION 'scope: % vs %', v_actual, v_expected;
  END IF;

  -- personas (somar jsonb_array_length de cada row)
  SELECT COUNT(*) INTO v_actual FROM "DesignSessionPersona";
  SELECT COALESCE(SUM(jsonb_array_length(data->'personas')), 0) INTO v_expected
    FROM "DesignSessionStepData" WHERE "stepKey" = 'personas_journeys';
  IF v_actual != v_expected THEN
    RAISE EXCEPTION 'personas: % vs %', v_actual, v_expected;
  END IF;

  -- risks
  SELECT COUNT(*) INTO v_actual FROM "DesignSessionRisk";
  SELECT COALESCE(SUM(jsonb_array_length(data->'risks')), 0) INTO v_expected
    FROM "DesignSessionStepData" WHERE "stepKey" = 'risks_gaps';
  IF v_actual != v_expected THEN
    RAISE EXCEPTION 'risks: % vs %', v_actual, v_expected;
  END IF;

  -- gaps
  SELECT COUNT(*) INTO v_actual FROM "DesignSessionGap";
  SELECT COALESCE(SUM(jsonb_array_length(data->'gaps')), 0) INTO v_expected
    FROM "DesignSessionStepData" WHERE "stepKey" = 'risks_gaps';
  IF v_actual != v_expected THEN
    RAISE EXCEPTION 'gaps: % vs %', v_actual, v_expected;
  END IF;

  -- priority items
  SELECT COUNT(*) INTO v_actual FROM "DesignSessionPriorityItem";
  SELECT COALESCE(SUM(jsonb_array_length(data->'items')), 0) INTO v_expected
    FROM "DesignSessionStepData" WHERE "stepKey" = 'prioritization';
  IF v_actual != v_expected THEN
    RAISE EXCEPTION 'priority: % vs %', v_actual, v_expected;
  END IF;

  -- hypotheses
  SELECT COUNT(*) INTO v_actual FROM "DesignSessionHypothesis";
  SELECT COALESCE(SUM(jsonb_array_length(data->'hypotheses')), 0) INTO v_expected
    FROM "DesignSessionStepData" WHERE "stepKey" = 'hypotheses';
  IF v_actual != v_expected THEN
    RAISE EXCEPTION 'hypotheses: % vs %', v_actual, v_expected;
  END IF;

  -- technical_specs
  SELECT COUNT(*) INTO v_actual FROM "DesignSessionTechnicalSpecs";
  SELECT COUNT(*) INTO v_expected FROM "DesignSessionStepData" WHERE "stepKey" = 'technical_specs';
  IF v_actual != v_expected THEN
    RAISE EXCEPTION 'tech specs: % vs %', v_actual, v_expected;
  END IF;

  RAISE NOTICE 'All backfill assertions passed.';
END $$;

COMMIT;
```

### 1.3 Rodar migration

- [ ] `psql "$DIRECT_URL" -f supabase/migrations/20260513_design_session_normalization.sql`
- [ ] Verificar saída: deve terminar com `NOTICE: All backfill assertions passed.` e `COMMIT`.

**STOP** se qualquer `RAISE EXCEPTION` disparar — investigar JSON shape e rever migration. Não tentar fixes ad-hoc; corrigir o arquivo e re-rodar (drop manual das tabelas se necessário).

### 1.4 Validação visual — Zelar v2

- [ ] Spot-check no Zelar v2 (`264e6d07-...`):
  ```bash
  psql "$DIRECT_URL" -c "SELECT problem, \"successVision\" FROM \"DesignSessionProductVision\" WHERE \"sessionId\"='264e6d07-d365-43ba-8029-d539ce6f7c6b'"
  psql "$DIRECT_URL" -c "SELECT name, role, \"orderIndex\" FROM \"DesignSessionPersona\" WHERE \"sessionId\"='264e6d07-d365-43ba-8029-d539ce6f7c6b' ORDER BY \"orderIndex\""
  psql "$DIRECT_URL" -c "SELECT bucket, COUNT(*) FROM \"DesignSessionPriorityItem\" WHERE \"sessionId\"='264e6d07-d365-43ba-8029-d539ce6f7c6b' GROUP BY bucket"
  psql "$DIRECT_URL" -c "SELECT severity, COUNT(*) FROM \"DesignSessionRisk\" WHERE \"sessionId\"='264e6d07-d365-43ba-8029-d539ce6f7c6b' GROUP BY severity"
  psql "$DIRECT_URL" -c "SELECT \"stepKey\", COUNT(*) FROM \"DesignSessionStepNote\" WHERE \"sessionId\"='264e6d07-d365-43ba-8029-d539ce6f7c6b' GROUP BY \"stepKey\""
  ```
- [ ] Confrontar contagens com o JSON antigo:
  ```bash
  psql "$DIRECT_URL" -c "SELECT jsonb_array_length(data->'personas') FROM \"DesignSessionStepData\" WHERE \"sessionId\"='264e6d07-d365-43ba-8029-d539ce6f7c6b' AND \"stepKey\"='personas_journeys'"
  ```

### 1.5 Validar RLS

- [ ] Com JWT de viewer (impersonar):
  ```sql
  SET LOCAL request.jwt.claims = '{"sub":"<viewer-uuid>","app_metadata":{"role":"product-builder"}}';
  SELECT COUNT(*) FROM "DesignSessionPersona";  -- esperado: 0 ou só sessions com ProjectAccess
  INSERT INTO "DesignSessionPersona" ("sessionId", name) VALUES ('<session>', 'x');  -- esperado: erro RLS
  ```
- [ ] Com session_participant: SELECT OK, INSERT OK.
- [ ] Sem JWT: 0 rows.

### 1.6 Regenerar types

- [ ] `npx supabase gen types typescript --project-id <project-id> > src/lib/supabase/database.types.ts` (ou pipeline equivalente)
- [ ] Verificar diff: tipos novos das 10 tabelas aparecem.
- [ ] `npm run typecheck` — esperado 0 erros (nada consome as tabelas novas ainda).

### 1.7 Commit Fase 1

- [ ] `bash scripts/sync-joao-dev.sh -m "ZRD-JM-XX: supabase — ds normalization (schema + rls + backfill)"`

---

## Fase 2 — UI migration (passo-a-passo por step)

> Cada step vira um commit/PR independente. Regra: ao migrar, **para** de tocar o endpoint genérico para aquele step. Sem dual-write.

### 2.0 Setup (uma vez)

- [ ] Criar pasta `src/hooks/design-session/`
- [ ] Criar `src/lib/design-session/schemas.ts` movendo schemas de `src/lib/agent/schemas.ts` (mantém re-exports temporários no antigo para não quebrar agent).
- [ ] Criar `src/lib/design-session/guards.ts` com `assertStepInSession(sessionId, stepKey)`.
- [ ] **Step notes (genérico)** — criar antes do piloto, será reusado por todos os steps:
  - API: `src/app/api/design-sessions/[id]/steps/[stepKey]/notes/route.ts` (GET list, POST create) + `[noteId]/route.ts` (PATCH text, DELETE) + `reorder/route.ts`.
  - Hook: `src/hooks/design-session/use-step-notes.ts` — `useStepNotes(sessionId, stepKey)` via `useOptimisticCollection`.
  - Refatorar `StickyNoteBoard` consumers (atualmente em [src/app/(dashboard)/design-sessions/[id]/steps/[step]/page.tsx](src/app/(dashboard)/design-sessions/[id]/steps/[step]/page.tsx)) para usar o hook — `_notes` some do `stepData` consumido pela page.
  - Smoke: criar/editar/deletar sticky em qualquer step → row aparece em `DesignSessionStepNote` com `stepKey` certo; JSON legado fica congelado.
- [ ] Commit: `ZRD-JM-XX: ds — step notes (table-only) + lib scaffolding`.

### 2.1 Piloto: `hypotheses`

> Step mais simples (158L, 1 entidade, sem cross-step). Define o padrão dos outros 8.

- [ ] **API**: criar `src/app/api/design-sessions/[id]/hypotheses/route.ts` (GET list, POST create) + `[hypothesisId]/route.ts` (PATCH, DELETE) + `reorder/route.ts`.
  - Cada handler: `requireSessionEditApi` (mutação) ou `requireSessionAccessApi` (GET) → `assertStepInSession` → Zod → operação.
- [ ] **Hook**: criar `src/hooks/design-session/use-hypotheses.ts` usando `useOptimisticCollection`.
- [ ] **Componente**: atualizar `src/components/design-session/hypothesis-board.tsx` para consumir o hook, eliminar leitura/escrita de `stepData`.
- [ ] **Página container**: remover `hypotheses` do `stepData` consumido pela `page.tsx` (passa `sessionId` para o board, board faz fetch próprio).
- [ ] **Smoke test**: criar/editar/deletar/reordenar 3 hipóteses na UI. Confirmar que escrita não vai no JSON legado: `psql "$DIRECT_URL" -c "SELECT data FROM \"DesignSessionStepData\" WHERE \"stepKey\"='hypotheses' AND \"sessionId\"='<session>'"` (deve estar congelado, o que já foi backfilled).
- [ ] **Super Session test**: criar Super sem `hypotheses` no `selectedSteps`. Tentar `POST /api/design-sessions/[id]/hypotheses` → esperado 409.
- [ ] Commit: `ZRD-JM-XX: ds — hypotheses pilot (table-only, optimistic)`.

### 2.2 Replicar para os outros steps simples (1:1 e 1:N pequenos)

> Ordem sugerida pela menor complexidade. Cada um é um PR/commit independente seguindo o template do piloto.

- [ ] `product_vision` — form 5 campos, 1:1. PATCH onBlur.
- [ ] `scope_definition` — 4 boards de post-it. Atenção: colunas `inScope`/`outOfScope` no DB, mas API pode mapear para `is`/`isNot` na payload se quiser preservar o JSON-shape histórico; **recomendo expor `inScope`/`outOfScope` no payload tb** para consistência.
- [ ] `risks_gaps` — agora 2 tabelas separadas. 2 hooks (`use-risks`, `use-gaps`) ou 1 hook combinado? Recomendo **1 hook combinado** `use-risks-gaps` expondo `{risks, gaps, mutateRisk, mutateGap}`. Notes do step via hook genérico de §2.0.
- [ ] `personas_journeys` — useOptimisticCollection. Edição de persona inteira = PATCH da row (journeys inline em jsonb).
- [ ] `technical_specs` — 1:1, mix de escalar + 2 jsonb arrays.
- [ ] `pre_work` — **sem tabela 1:1**. Já consome `DesignSessionResearch` e `DesignSessionTranscript` via endpoints próprios; sticky notes via hook genérico de §2.0. Migração desse step é apenas: remover leitura/escrita do `_notes` do JSON, eliminar consumo do endpoint genérico `/steps/pre_work`.

### 2.3 Brainstorm + Prioritization (juntos)

> **Único PR** porque compartilhavam os 2 triggers.

- [ ] Criar APIs `/brainstorm-features` (CRUD + reorder) e `/priority-items` (CRUD + reorder + `seed-from-brainstorm`).
- [ ] Criar hooks `use-brainstorm-features` e `use-priority-items`.
- [ ] Refatorar `solution-card-board.tsx` (448L) e `priority-board.tsx`.
- [ ] **Drop dos triggers** no PR (parte do mesmo commit, migration auxiliar):
  ```sql
  DROP TRIGGER IF EXISTS sync_brainstorm_features_trigger ON "DesignSessionStepData";
  DROP TRIGGER IF EXISTS sync_brainstorm_buckets_trigger ON "DesignSessionStepData";
  ```
- [ ] Smoke: drag-to-bucket muda a coluna `bucket` direto na tabela.
- [ ] Commit: `ZRD-JM-XX: ds — brainstorm + prioritization (drop triggers, table-only)`.

### 2.4 Endpoint agregado e consumidores

- [ ] Criar `GET /api/design-sessions/[id]/full`:
  - Lê `session`, calcula `stepKeys = getStepsForSession(session).map(s => s.key)`.
  - Faz N SELECTs paralelos só dos steps presentes.
  - Retorna `{ session, productVision?, scope?, personas?, brainstormFeatures?, risks?, gaps?, priorityItems?, technicalSpecs?, hypotheses?, stepNotes: Record<stepKey, Note[]>, research?, transcripts? }`.
  - `stepNotes` agrupado por `stepKey` num único SELECT em `DesignSessionStepNote` filtrado por `sessionId`.
- [ ] Atualizar `briefing-sheet.tsx` para consumir `/full` em vez de ler `stepData`.
- [ ] Atualizar `src/lib/task-generator.ts:buildSessionContext` para iterar `getStepsForSession` lendo das novas tabelas. **Atenção ao Vitor / task-gen agent — chamadas internas precisam funcionar idênticas.**
- [ ] Smoke: abrir briefing-sheet da Zelar v2, conferir que renderiza igual ao pré-migração.
- [ ] Smoke: rodar `/task-gen-story` em uma story qualquer — confirmar contexto chega completo.

---

## Fase 3 — Cleanup (no PR final da Fase 2)

> Roda **após** todos os 9 steps migrados e o endpoint agregado funcionando.

- [ ] Confirmar zero callers do endpoint legado:
  ```bash
  rg "design-sessions/.+/steps/" src/ --type ts
  ```
- [ ] Confirmar zero callers de `step_array_*` RPCs:
  ```bash
  rg "step_array_(add|update|delete)" src/
  ```
- [ ] Migration `20260514_drop_design_session_step_data.sql`:
  ```sql
  BEGIN;
  DROP TABLE "DesignSessionStepData" CASCADE;
  DROP FUNCTION IF EXISTS step_array_add;
  DROP FUNCTION IF EXISTS step_array_update;
  DROP FUNCTION IF EXISTS step_array_delete;
  -- step_data_reject_dup_ids trigger cai com a tabela
  COMMIT;
  ```
- [ ] `psql "$DIRECT_URL" -f supabase/migrations/20260514_drop_design_session_step_data.sql`
- [ ] Deletar `src/app/api/design-sessions/[id]/steps/[stepKey]/route.ts`.
- [ ] Limpar `src/lib/agent/schemas.ts` (re-exports temporários da Fase 2.0).
- [ ] Regenerar types.
- [ ] `npm run typecheck` + `npm run build`.
- [ ] Commit: `ZRD-JM-XX: ds — drop legacy step_data + generic endpoint`.

---

## Critérios de sucesso global

- [ ] Todas as 9 tabelas novas existem com RLS habilitado (`DesignSessionStepNote`, `ProductVision`, `Scope`, `Persona`, `Risk`, `Gap`, `PriorityItem`, `TechnicalSpecs`, `Hypothesis`) + retro-RLS em `BrainstormFeature`.
- [ ] Backfill validado: contagens batem, spot-check visual da Zelar v2 OK.
- [ ] Briefing-sheet da Zelar v2 renderiza idêntico ao pré-migração.
- [ ] `DesignSessionStepData` dropada.
- [ ] Endpoint genérico `/steps/[stepKey]` removido.
- [ ] Zero referências a `data->...` no código relacionado a Design Session.
- [ ] Lint + typecheck + build OK.
- [ ] Time avisado de fim de janela.

---

## Rollback / kill switch

**Durante Fase 1:** se a transação falhar, ela rolla back sozinha. Migration ainda não rodada = nada para reverter.

**Após Fase 1, antes de Fase 2:** o legado ainda está vivo. Se decidir abortar: dropar as 9 tabelas novas via migration de rollback. JSON intacto.

```sql
BEGIN;
DROP TABLE "DesignSessionHypothesis" CASCADE;
DROP TABLE "DesignSessionTechnicalSpecs" CASCADE;
DROP TABLE "DesignSessionPriorityItem" CASCADE;
DROP TABLE "DesignSessionGap" CASCADE;
DROP TABLE "DesignSessionRisk" CASCADE;
DROP TABLE "DesignSessionPersona" CASCADE;
DROP TABLE "DesignSessionScope" CASCADE;
DROP TABLE "DesignSessionProductVision" CASCADE;
DROP TABLE "DesignSessionStepNote" CASCADE;
-- DesignSessionBrainstormFeature: NÃO dropar (vive desde 20260508). Apenas reverter RLS se desejar:
-- ALTER TABLE "DesignSessionBrainstormFeature" DISABLE ROW LEVEL SECURITY;
COMMIT;
```

**Durante Fase 2:** cada step migrado é commit independente. `git revert` do commit + drop opcional da tabela específica restaura comportamento legado (o JSON ainda é gravado pelo endpoint genérico).

**Após Fase 3 (DesignSessionStepData dropada):** não há rollback fácil. Backup do banco antes de rodar a migration de drop é mandatório:

```bash
pg_dump --table='"DesignSessionStepData"' "$DIRECT_URL" > /tmp/step_data_backup_$(date +%Y%m%d).sql
```

---

## Log de execução

> Preencher durante a janela. Útil pra post-mortem.

- Início: ___
- Fase 0 concluída: ___
- Fase 1 concluída: ___
- Fase 2 concluída: ___
- Fase 3 concluída: ___
- Fim de janela / time avisado: ___
- Bugs encontrados: ___
