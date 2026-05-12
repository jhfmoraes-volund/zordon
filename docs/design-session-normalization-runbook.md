# Design Session Normalization — Runbook

**Plano de referência:** [design-session-normalization-plan.md](design-session-normalization-plan.md)
**Branch:** `joao-dev` (pessoal do João — local é SSOT, `sync-joao-dev.sh` sweepa tudo).
**Status:** Fases 0 → 2 concluídas em 2026-05-12. **Fase 3 (cleanup destrutivo) ainda não rodada.**

## Convenções

- Local working tree é SSOT — quando commitar via `bash scripts/sync-joao-dev.sh -m "..."`, **não stash/reset** mudanças não-relacionadas; o script stagea tudo. Memory: `feedback_local_ssot.md`.
- Migrations rodam via `psql "$DIRECT_URL" -f <arquivo>` (CLAUDE.md). Load `.env` primeiro: `source <(grep '^DIRECT_URL=' .env | sed 's/^/export /')`.
- Após qualquer migration, regenerar types: `npm run db:types`.
- Commits seguem `ZRD-JM-NN: <area> — <summary>` (sequencial).

---

## ✅ Fase 0 — Defensiva no endpoint legado (`d8f678d`)

**Path:** [src/app/api/design-sessions/[id]/steps/[stepKey]/route.ts](src/app/api/design-sessions/[id]/steps/[stepKey]/route.ts)

- PUT validado por Zod per-step (top-level `.strict()`, items `.passthrough()` — preserva legados como `painOrGainDescription` em journey steps).
- PUT migrado de `requireSessionAccessApi` → `requireSessionEditApi`.
- Validado contra 20 rows reais pré-migração (20/20 pass; junk top-level rejected).

---

## ✅ Fase 1 — Schema + RLS + backfill (`8a7d0f9`)

**Migration:** [supabase/migrations/20260513_design_session_normalization.sql](supabase/migrations/20260513_design_session_normalization.sql)

Transação única: CREATE TABLES → RLS → BACKFILL → ASSERTIONS. Rollback automático se assertion falhar.

### Tabelas criadas (9 novas + retro-RLS em 1)

| Tabela | Cardinalidade | Origem do backfill |
|---|---|---|
| `DesignSessionStepNote` | 1:N por step | `step_data.data->'_notes'` (todos steps) |
| `DesignSessionProductVision` | 1:1 | `step_data` onde `stepKey='product_vision'` |
| `DesignSessionScope` | 1:1 | `step_data` onde `stepKey='scope_definition'` (renomeado `is/isNot → inScope/outOfScope`) |
| `DesignSessionPersona` | 1:N | `step_data.data->'personas'` (jornadas inline jsonb) |
| `DesignSessionBrainstormFeature` | 1:N | **JÁ existia** — retro-RLS aplicada |
| `DesignSessionRisk` | 1:N | `step_data.data->'risks'` |
| `DesignSessionGap` | 1:N | `step_data.data->'gaps'` |
| `DesignSessionPriorityItem` | 1:N | `step_data.data->'items'` (prioritization) |
| `DesignSessionTechnicalSpecs` | 1:1 | `step_data` onde `stepKey='technical_specs'` |
| `DesignSessionHypothesis` | 1:N | `step_data.data->'hypotheses'` |

**RLS canônica** em todas: 4 policies (`can_access_session` SELECT, `can_edit_session` INSERT/UPDATE/DELETE) + GRANT a authenticated.

### Decisões consolidadas no schema

- **`_notes`** = sticky-notes genérico → tabela única `DesignSessionStepNote(sessionId, stepKey, text, orderIndex)` reusada pelos 9 steps.
- **`_drafts`** descartado (UI scratch volátil).
- **`pre_work`** sem tabela 1:1 (files migrados depois pra `DesignSessionFile` — ver Fase 2 files).
- **IDs legados de UI** (nanoids tipo `"8yzqk0u"`) preservados via regex check; se não casar UUID, gera novo. Aplicado em `DesignSessionStepNote.id` e `DesignSessionPersona.id`.

### Backfill counts (todas 6 sessions)

step notes=0, product_vision=2, scope=3, personas=5, risks=4, gaps=4, priority items=72, tech specs=2, hypotheses=14, brainstorm features=79 (já existia).

### Backups disponíveis pra rollback Fase 1→0

- `DesignSessionStepData_backup_20260506` (UUID migration)
- `DesignSessionStepData_backup_20260512` (pré-normalização)

---

## ✅ Fase 2 — UI migration (table-only)

Cada step virou: API CRUD per-entity → hook com `useOptimisticCollection` → component sem `data/onChange`. JSON legacy **não é mais escrito** por nenhum step. PUT do endpoint genérico aceita rotas inativas durante a janela (Fase 0 zod), mas nenhum caller faz PUT real.

### Padrão canônico do hook (CRÍTICO — bug fix de 2026-05-12)

O `reconcile` do create no `useOptimisticCollection` deve:

```ts
reconcile: (prev, result) => {
  const real = result as Entity;
  if (prev.some(x => x.id === tempId)) return prev.map(x => x.id === tempId ? real : x);
  if (prev.some(x => x.id === real.id)) return prev;
  return [...prev, real];
}
```

**Por quê:** quando `reconcile` é passado, o reducer **não roda no committed** — só no optimistic. Se você usar `prev.map(x => x.id === tempId ? real : x)` puro, `prev` (committed) nunca teve o tempId, então o map devolve `prev` intocado e a entidade some quando o `useOptimistic` reconcilia. Referência: `src/components/story-hierarchy/task-feed.tsx:189`. Memory: `feedback_optimistic_reconcile_create.md`.

### 2.0 Step notes genérico (`51997d2`)

- API: `/api/design-sessions/[id]/steps/[stepKey]/notes/{route,[noteId]/route,reorder/route}.ts`
- Hook: `src/hooks/design-session/use-step-notes.ts`
- `WizardLayout` chama `useStepNotes` internamente via subcomponente `StepNotesPanel` (só monta se `step.key` é stepKey válido).
- Lib: `src/lib/design-session/{types.ts,guards.ts}` (`STEP_KEYS`, `assertStepInSession`).

### 2.1 Piloto `hypotheses` (`b7e0ad5`)

- API: `/hypotheses/{route,[hypothesisId]/route,reorder/route}.ts`
- Hook: `use-hypotheses.ts`
- `HypothesesStep` consome o hook, mapeia `HypothesisRow` ↔ `Hypothesis` (schema do board).

### 2.2 Steps simples (`4784c3c`)

| Step | API | Hook | Padrão |
|---|---|---|---|
| product_vision | `/product-vision` (GET+PUT) | `use-product-vision` | debounced PUT (1:1) |
| scope_definition | `/scope` (GET+PUT) | `use-scope` | debounced PUT, aceita `is/isNot` e `inScope/outOfScope` na payload |
| risks_gaps | `/risks` + `/gaps` (CRUD) | `use-risks-gaps` (combinado) | optimistic collection × 2 |
| personas_journeys | `/personas` (CRUD) | `use-personas` | optimistic; journey-step ops = persona PATCH com array novo |
| technical_specs | `/technical-specs` (GET+PUT) | `use-technical-specs` | debounced PUT. **Campo `notes` removido** (Textarea histórica que nunca persistiu — Fase 0 zod rejeitava). |
| pre_work | (ver §2.5 abaixo) | — | — |

### 2.3 Brainstorm + Prioritization (`95ceb75`)

**Modelo:** brainstorm-as-canonical em `DesignSessionBrainstormFeature`. Prioritization usa tabela separada `DesignSessionPriorityItem` (não compartilha bucket-column com BrainstormFeature).

- API: `/brainstorm-features/{route,[featureId]/route}.ts` + `/priority-items/{route,[itemId]/route,seed-from-brainstorm/route}.ts`
- Hooks: `use-brainstorm-features`, `use-priority-items` (auto-seed na primeira carga se vazio, idempotente por title).
- **Triggers dropados** via [supabase/migrations/20260513b_drop_brainstorm_sync_triggers.sql](supabase/migrations/20260513b_drop_brainstorm_sync_triggers.sql): `sync_brainstorm_features_trigger`, `sync_brainstorm_buckets_trigger`. Functions ficam no schema pra rollback (drop em Fase 3).
- Cross-refs atualizadas:
  - `RisksGapsStep` lê features de `/brainstorm-features` (não mais `/steps/brainstorm`).
  - `BrainstormStep` lê personas de `/personas` (não mais `/steps/personas_journeys`).
- BrainstormFeature.bucket column fica orfão (era setado pelo trigger); drop em Fase 3.

### 2.4 Endpoint `/full` + consumers (`fb54f5f`)

- `GET /api/design-sessions/[id]/full` — agrega tudo em 1 request. Só consulta tabelas dos steps ativos (via `getStepsForSession`). Returns: `{ session, productVision, scope, personas, brainstormFeatures, risks, gaps, priorityItems, technicalSpecs, hypotheses, stepNotes (agrupado por stepKey), research, transcripts, files }`.
- **`buildSessionContext`** ([src/lib/task-generator.ts](src/lib/task-generator.ts)) reescrito para ler das tabelas normalizadas direto (sem HTTP). Verbosity preservada. Scope mapeado `inScope/outOfScope` ↔ legacy `is/isNot` no template.
- **Briefing step** (último step do wizard) consome `/full` em vez de 8 fetches no endpoint legacy. Reconstroi shape per-step que `BriefingSheet` espera.

### 2.5 PreWork files → `DesignSessionFile` (`d6e61a6`)

**Migration:** [supabase/migrations/20260513c_design_session_file.sql](supabase/migrations/20260513c_design_session_file.sql)

Decisão pós-runbook original: criar tabela `DesignSessionFile` separada de `Research`/`Transcript` (semânticas distintas) + bucket Supabase Storage.

- **Tabela:** `DesignSessionFile(id, sessionId, name, size, mimeType, storagePath, extractedText, extractionStatus, uploadedByMemberId, createdAt)`. CHECK em `extractionStatus IN ('pending','success','unsupported','failed')`.
- **Bucket:** `design-session-files` (privado, 25MB cap). Path: `{sessionId}/{fileId}/{sanitized-name}`.
- **Storage RLS:** SELECT liberado pra authenticated (resolver signed URL); INSERT/UPDATE/DELETE só via service_role (server-side).
- **Extração estendida** ([src/lib/design-session/file-extraction.ts](src/lib/design-session/file-extraction.ts)):
  - PDF (pdf-parse), DOCX (mammoth), HTML (node-html-parser), TXT/MD/JSON/YAML (utf-8).
  - **CSV** (csv-parse/sync) → tabela Markdown.
  - **XLSX/XLS** (exceljs) → cada sheet vira `### {SheetName}` + tabela MD.
  - Outros: `status='unsupported'`, `extractedText=null`, upload OK.
  - Falhas: `status='failed'`, log, upload **não bloqueia**.
- **Endpoints:** `POST /upload` reescrito (storage + DB), `GET /files`, `DELETE /files/[fileId]`, `GET /files/[fileId]/download` (signed URL TTL 60s), `GET /files/[fileId]/text` (extractedText sob demanda).
- **Hook `useSessionFiles`** — list + upload + delete + getDownloadUrl + getExtractedText.
- **PreWorkStep** sem `data/onChange`. `handleSend` busca `extractedText` server-side pra cada pending file antes de injetar no chat (não fica mais em memória do client). Files com `status='unsupported'/'failed'` são mencionados por nome apenas.
- **`/full`** ganha `files` (metadata-only).

**Bug fix do reconcile** (`2815cc0`): aplicado em todos os hooks de coleção (`use-hypotheses`, `use-step-notes`, `use-risks-gaps`, `use-personas`, `use-brainstorm-features`, `use-session-files`).

---

## ⏳ Fase 3 — Cleanup destrutivo (ainda não rodada)

**Quando:** depois de validar end-to-end na UI que:
1. Todos os 9 steps gravam **só** nas tabelas novas (verificar via `psql` que `DesignSessionStepData` não recebe nenhum UPDATE/INSERT durante uso normal — `updatedAt` deve ficar congelado).
2. Briefing-sheet renderiza idêntico ao pré-migração pra cada session existente (6 sessions; spot-check Zelar v2 `264e6d07-d365-43ba-8029-d539ce6f7c6b`).
3. Task generation funciona — rodar `/task-gen-story` em uma story, confirmar que `buildSessionContext` traz contexto completo.
4. Files upload + download + extração CSV/XLSX testados na UI.

### 3.1 Pre-flight (read-only)

```bash
# Confirma zero callers do endpoint legado
rg "design-sessions/.+/steps/[a-z_]+\"" src/ --type ts  # exceto /steps/[stepKey]/notes (ainda usado)

# Confirma zero callers de step_array_* RPCs
rg "step_array_(add|update|delete)" src/

# Snapshot final dos backups (pra confirmar que sobreviveram a janela)
psql "$DIRECT_URL" -c "SELECT COUNT(*) FROM \"DesignSessionStepData_backup_20260512\""
```

**STOP** se qualquer ref ativa aparecer — investigar antes de dropar.

### 3.2 Backup adicional defensivo

```bash
pg_dump --table='"DesignSessionStepData"' "$DIRECT_URL" > /tmp/step_data_final_backup_$(date +%Y%m%d).sql
```

### 3.3 Migration de drop

**Path:** `supabase/migrations/20260514_drop_design_session_step_data.sql`

```sql
BEGIN;

-- Drop legacy generic endpoint storage
DROP TABLE "DesignSessionStepData" CASCADE;

-- Drop helper RPCs (caem com a tabela via CASCADE, mas explícito por clareza)
DROP FUNCTION IF EXISTS step_array_add;
DROP FUNCTION IF EXISTS step_array_update;
DROP FUNCTION IF EXISTS step_array_delete;

-- Drop trigger function bodies (já dropadas as triggers em Fase 2.3)
DROP FUNCTION IF EXISTS sync_brainstorm_features;
DROP FUNCTION IF EXISTS sync_brainstorm_buckets;
DROP FUNCTION IF EXISTS step_data_reject_dup_ids;

-- Limpa coluna orfã: bucket em BrainstormFeature (era setado pelo trigger,
-- prioritization agora vive em PriorityItem). Confirmar antes que está vazia
-- ou aceitar perda.
ALTER TABLE "DesignSessionBrainstormFeature" DROP COLUMN bucket;

COMMIT;
```

**Confirmar antes do drop da coluna `bucket`:**
```sql
SELECT bucket, COUNT(*) FROM "DesignSessionBrainstormFeature" GROUP BY bucket;
```
Se houver rows com bucket != NULL, decidir: ignorar (PriorityItem é canônico) ou backfill PriorityItem antes.

### 3.4 Limpeza no código

```bash
# Deletar endpoint legacy
rm src/app/api/design-sessions/[id]/steps/[stepKey]/route.ts
# Atenção: /steps/[stepKey]/notes/ continua! Não deletar a pasta inteira.

# Os schemas Zod de Fase 0 podem ser deletados também — só serviam pro endpoint legacy
# Os types Zod em src/lib/agent/schemas.ts continuam sendo usados pelo agent (Vitor) — manter
```

### 3.5 Pós-drop

- `npm run db:types` (DesignSessionStepData some dos types)
- `npx tsc --noEmit` (deve passar — nenhum consumer ativo)
- `npm run build`
- Commit: `bash scripts/sync-joao-dev.sh -m "ZRD-JM-XX: ds — drop legacy step_data + generic endpoint (Fase 3)"`

### 3.6 Rollback Fase 3

**Não há rollback fácil** — `DesignSessionStepData` foi dropada. Restaurar via `pg_dump` backup do passo 3.2:

```bash
psql "$DIRECT_URL" -f /tmp/step_data_final_backup_YYYYMMDD.sql
# Re-aplicar trigger functions
# Reverter o commit de drop no git
```

---

## Critérios de sucesso global

- [x] 9 tabelas novas existem com RLS habilitado + retro-RLS em `BrainstormFeature`.
- [x] Backfill validado (assertions passaram + spot-check visual Zelar v2).
- [x] PreWork files migrados pra `DesignSessionFile` + Storage bucket.
- [x] Briefing-sheet consome `/full` (read único).
- [x] `buildSessionContext` lê das tabelas normalizadas.
- [x] Triggers de sync brainstorm/prioritization dropadas.
- [x] Bug do reconcile do create corrigido em todos hooks.
- [ ] **Validação end-to-end na UI** (próximo passo, antes de Fase 3).
- [ ] `DesignSessionStepData` dropada.
- [ ] Endpoint genérico `/steps/[stepKey]` removido (só `/notes` subroute sobrevive).
- [ ] Zero refs a `data->...` em código DS-related.

---

## Inventário de arquivos novos (Fases 0–2)

### APIs
```
src/app/api/design-sessions/[id]/
├── full/route.ts                       # agregado
├── product-vision/route.ts             # 1:1
├── scope/route.ts                      # 1:1
├── personas/route.ts                   # 1:N
│   └── [personaId]/route.ts
├── brainstorm-features/route.ts        # 1:N
│   └── [featureId]/route.ts
├── risks/route.ts                      # 1:N
│   └── [riskId]/route.ts
├── gaps/route.ts                       # 1:N
│   └── [gapId]/route.ts
├── priority-items/route.ts             # 1:N
│   ├── [itemId]/route.ts
│   └── seed-from-brainstorm/route.ts
├── technical-specs/route.ts            # 1:1
├── hypotheses/route.ts                 # 1:N
│   ├── [hypothesisId]/route.ts
│   └── reorder/route.ts
├── files/route.ts                      # 1:N + Storage
│   └── [fileId]/
│       ├── route.ts                    # DELETE
│       ├── download/route.ts           # signed URL
│       └── text/route.ts               # extractedText sob demanda
├── steps/[stepKey]/notes/              # genérico (sobrevive Fase 3)
│   ├── route.ts
│   ├── [noteId]/route.ts
│   └── reorder/route.ts
└── upload/route.ts                     # reescrito — storage + extração
```

### Hooks
```
src/hooks/design-session/
├── use-step-notes.ts
├── use-product-vision.ts
├── use-scope.ts
├── use-personas.ts
├── use-brainstorm-features.ts
├── use-risks-gaps.ts
├── use-priority-items.ts
├── use-technical-specs.ts
├── use-hypotheses.ts
└── use-session-files.ts
```

### Lib
```
src/lib/design-session/
├── types.ts            # STEP_KEYS, StepKey, StickyNote
├── guards.ts           # assertStepInSession
└── file-extraction.ts  # extractTextFromBuffer (PDF/DOCX/HTML/TXT/CSV/XLSX)
```

### Migrations (todas em supabase/migrations/)
- `20260513_design_session_normalization.sql` — Fase 1 (tabelas + RLS + backfill)
- `20260513b_drop_brainstorm_sync_triggers.sql` — Fase 2.3 (drop triggers)
- `20260513c_design_session_file.sql` — Fase 2.5 (tabela File + bucket)
- `20260514_drop_design_session_step_data.sql` — **pendente Fase 3**

---

## Commits da migração (em ordem cronológica)

| Commit | Fase | Descrição |
|---|---|---|
| `d8f678d` | 0 | ds endpoint legacy zod gate + edit guard |
| `8a7d0f9` | 1 | ds normalization migration (uuid regex fix + types regen) |
| `51997d2` | 2.0 | step notes (table-only) + lib scaffolding |
| `b7e0ad5` | 2.1 | hypotheses pilot (table-only, optimistic) |
| `2815cc0` | bugfix | fix optimistic reconcile do create |
| `4784c3c` | 2.2 | 5 steps simples table-only |
| `95ceb75` | 2.3 | brainstorm + prioritization (drop sync triggers) |
| `fb54f5f` | 2.4 | /full aggregated + task-generator from normalized tables |
| `d6e61a6` | 2.5 | DesignSessionFile + storage bucket + extended extraction |

---

## Para um agente em contexto limpo continuar a partir daqui

**Estado atual em 1 parágrafo:** Fases 0, 1 e 2 inteiras concluídas. As 10 tabelas novas estão populadas, RLS aplicada, hooks/APIs criados, UI migrada, triggers dropados, files via Storage. `DesignSessionStepData` ainda existe mas **não é mais escrita** (só lida pelo endpoint legacy `/steps/[stepKey]` que continua aceitando PUTs com `.passthrough()` zod — defensivo, sem nenhum caller). Falta apenas validar end-to-end na UI e rodar Fase 3 (drop da tabela + endpoint legacy).

**O que fazer agora:**

1. **Testar UI end-to-end** numa sessão fresh (criar DS nova, passar pelos 9 steps, criar uma story via Vitor, gerar tasks). Validar que tudo grava nas tabelas novas:
   ```sql
   -- Antes de qualquer ação
   SELECT MAX("updatedAt") FROM "DesignSessionStepData" WHERE "sessionId" = '<nova-session>';
   -- ... usar a UI ...
   -- Depois — deve continuar igual ou null
   SELECT MAX("updatedAt") FROM "DesignSessionStepData" WHERE "sessionId" = '<nova-session>';
   ```
2. **Spot-check Zelar v2** no briefing-sheet: comparar renderização visualmente.
3. **Smoke test files**: upload PDF + CSV + XLSX, baixar via download endpoint, deletar.
4. Se tudo OK → **rodar Fase 3** seguindo §3.1–3.5 deste runbook.

**Conhecimento crítico que pode não estar óbvio no código:**

- O bug do reconcile do create (memory `feedback_optimistic_reconcile_create.md`) — qualquer hook novo de coleção deve seguir o padrão `filter temp + append real`.
- `Local-as-SSOT` (memory `feedback_local_ssot.md`) — `sync-joao-dev.sh` sweepa tudo, não filtrar.
- Pre_work não tinha tabela 1:1 originalmente — decisão de criar `DesignSessionFile` foi pós-runbook original.
- Persona IDs em sessions antigas eram nanoids (não UUIDs); a migration de backfill usa regex check.
- O endpoint legacy `/steps/[stepKey]` PUT continua "vivo" defensivamente mas ninguém escreve nele — Fase 3 mata.
- O endpoint legacy `/steps/[stepKey]/notes` é **outro path**, esse é o canônico de step notes e **sobrevive** Fase 3.

**Inventário de memories relevantes** (em `~/.claude/projects/.../memory/`):
- `project_design_session.md` — feature overview
- `project_design_session_normalization.md` — plano original
- `project_task_draft_lifecycle.md` — DS como unidade atômica de aprovação
- `feedback_optimistic_reconcile_create.md` — bug do reconcile
- `feedback_local_ssot.md` — política de commits
- `feedback_role_helpers_postgres.md` — RLS helpers
