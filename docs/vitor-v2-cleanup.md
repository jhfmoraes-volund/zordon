# Vitor v2 — Cleanup (PR 3)

**Status:** ready to run (esperar 24h após PR 2 em prod — captura rota fria de edge/cron/replay).
**Pré-requisito:** PR 1 (`7f2f636`) e PR 2 (`c7db56e`) em produção há pelo menos 24h sem regressão.
**Janela:** segura — Vitor já não escreve em `DesignSessionStepData` (PR 2); legacy só serve fallback pra ler `pre_work.files` antigos.

## Objetivo

Apagar do banco e do código tudo que dependia de `DesignSessionStepData` / `step_array_*`.
Antes do drop, validar que **nenhum** consumer ativo escreve mais nessas estruturas.

---

## 1. Pre-flight no banco (obrigatório antes de migration)

Rode estas queries antes do drop. Se qualquer count > 0 fora do esperado, **PARE** e investigue.

```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /')
psql "$DIRECT_URL" <<'SQL'
-- 1. Quantas rows ainda existem em DesignSessionStepData?
SELECT COUNT(*) AS total_step_data FROM "DesignSessionStepData";

-- 2. Há writes recentes? (últimos 7 dias)
SELECT "stepKey", COUNT(*) AS rows, MAX("updatedAt") AS last_write
  FROM "DesignSessionStepData"
  WHERE "updatedAt" > now() - interval '7 days'
  GROUP BY "stepKey"
  ORDER BY last_write DESC;

-- 3. Brainstorm.bucket ainda usado? Se = 0, podemos dropar a coluna.
SELECT COUNT(*) AS rows_with_bucket
  FROM "DesignSessionBrainstormFeature"
  WHERE bucket IS NOT NULL;

-- 4. RPCs antigos foram chamados recentemente? (pg_stat_user_functions)
SELECT funcname, calls, total_time
  FROM pg_stat_user_functions
  WHERE schemaname = 'public'
    AND funcname IN ('step_array_add', 'step_array_update', 'step_array_delete');
SQL
```

**Decisão por resultado:**
- `(1)` total > 0: OK, são rows legadas. Esperado.
- `(2)` linhas recentes (últimos 7d) **excluindo `briefing`** (que era escrito até PR 2): investigar quem escreveu, abortar drop até identificar.
- `(3)` = 0: pode dropar coluna `bucket` na migration; > 0: deixar coluna por mais 1 sprint.
- `(4)` calls aumentando: alguém ainda chama. Investigar `pg_stat_activity` ou logs Supabase.

---

## 2. Migration de drop

Arquivo: `supabase/migrations/20260517_drop_design_session_step_data.sql`

```sql
BEGIN;

-- 1. Drop trigger antes da função (dependência)
DROP TRIGGER IF EXISTS step_data_reject_dup_ids_trg ON "DesignSessionStepData";

-- 2. Drop RPCs legadas
DROP FUNCTION IF EXISTS public.step_array_add(uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.step_array_update(uuid, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.step_array_delete(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.step_data_reject_dup_ids() CASCADE;
DROP FUNCTION IF EXISTS public.sync_brainstorm_features() CASCADE;
DROP FUNCTION IF EXISTS public.sync_brainstorm_buckets() CASCADE;

-- 3. Drop a tabela (CASCADE pra políticas RLS e backups dependentes)
DROP TABLE IF EXISTS "DesignSessionStepData_backup_20260506";
DROP TABLE IF EXISTS "DesignSessionStepData_backup_20260512";
DROP TABLE IF EXISTS "DesignSessionStepData" CASCADE;

-- 4. CONDICIONAL: drop coluna bucket se pre-flight (3) retornou 0
-- DESCOMENTE só se pre-flight confirmou:
-- ALTER TABLE "DesignSessionBrainstormFeature" DROP COLUMN bucket;

COMMIT;
```

Rodar:
```bash
psql "$DIRECT_URL" -f supabase/migrations/20260517_drop_design_session_step_data.sql
npm run db:types
```

---

## 3. Cleanup TypeScript

Após migration aplicada, esses arquivos têm refs órfãs que vão quebrar tsc. Limpar em ordem.

### 3.1 Arquivos a DELETAR inteiros

| Path | Motivo |
|---|---|
| `src/app/api/design-sessions/[id]/steps/[stepKey]/route.ts` | Endpoint genérico que escrevia em step_data. Já existe `/notes/` separado pra notes; outros consumers usam endpoints por entidade. **Cuidado:** preservar `/notes/` subdir. |

```bash
# Verificar primeiro: route.ts é o ÚNICO file no diretório [stepKey]/ ?
ls "src/app/api/design-sessions/[id]/steps/[stepKey]/"
# Esperado: route.ts + notes/
# Deletar SÓ o route.ts (não o diretório):
rm "src/app/api/design-sessions/[id]/steps/[stepKey]/route.ts"
```

### 3.2 Arquivos a EDITAR

#### `src/lib/agent/context.ts`
Remover `getStepData()` (linhas ~20-31) e `updateStepData()` (linhas ~36-57). Mantém o resto (buildSessionContext, message history, ensureThread).

```ts
// REMOVER:
export async function getStepData(...) { ... }
export async function updateStepData(...) { ... }

// E o import órfão de SupabaseJson se ficar não-usado.
```

#### `src/lib/agent/tools/ds-entities.ts`
Remover o **fallback legacy** de files (PR 1 manteve pra transição). Ler só de `DesignSessionFile`.

- Remover `interface LegacyPreWorkFile` (linhas ~309-315)
- Em `loadFilesUnified()` (linhas ~317-372): remover bloco "Legacy fallback" (linhas ~348-368)
- Em `createReadFileTextTool` execute (linhas ~395-444): remover bloco "legacy fallback" (linhas ~408-423)
- Trocar `source: "table" | "legacy"` por só `source: "table"` ou remover o campo

#### `src/lib/agent/tools/search-doc.ts`
Remover fallback legacy de pre_work files.

- Remover `interface LegacyPreWorkFile` (linhas ~18-24)
- Em `loadSearchableFiles()` (linhas ~26-67): remover bloco "Legacy fallback" (linhas ~46-65)

#### `src/lib/agent/tools/mvp-check.ts`
Já migrado no PR 1. Não precisa mexer.

#### `src/lib/agent/prompt.ts:212`
Atualizar texto:
```
- "Se a info ja esta em DesignSessionStepData (personas, scope, brainstorm...)"
+ "Se a info ja esta nas tabelas normalizadas (personas, scope, brainstorm...)"
```

#### `src/app/api/design-sessions/[id]/route.ts:18`
Remover embed `stepData:DesignSessionStepData(*)` da query GET.

```ts
.select(`
  *,
  project:Project(name, client:Client(name)),
  participants:DesignSessionParticipant(*, member:Member(name)),
  items:DesignSessionItem(*)
`)
```

#### `src/lib/supabase/types.ts:18`
Após regenerar `database.types.ts`, esse export vai quebrar:
```ts
// REMOVER:
export type DesignSessionStepData = Tables["DesignSessionStepData"]["Row"];
```

#### `src/eval/vitor/live.ts` (linhas 275-287, 400)
Eval harness ainda popula stepData no setup. Migrar pros endpoints por entidade ou desabilitar setup legado.
- Linha 275-287: `c.setup.session.stepData` — refatorar pra escrever direto nas tabelas via supabase.from(...).insert(...)
- Linha 400: cleanup `.from("DesignSessionStepData").delete()` — remover (tabela não existe mais)

Como é um eval (não-produção), pode ser feito num PR separado se complicar.

#### `src/app/(dashboard)/dev/chat-stress/page.tsx:14-17`
Stress test enumera nomes de tool antigos. Trocar pelos novos:
```ts
const TOOL_NAMES = [
  "write_brainstorm",
  "write_persona",
  "write_priority",
  "read_brainstorm",
  // ...
];
```

#### `src/components/ui/conversation/tool-registry.ts:43-59`
Labels/ícones dos tools antigos. **DECISÃO:** manter ou remover?
- Manter: pra renderizar chips de mensagens **históricas** que ainda referenciam `set_field`/`add_item` etc.
- Remover: chips ficam "unknown tool", mas histórico polui menos.

Recomendado: **MANTER** com label tipo "(legado)" pra não quebrar replay de threads antigas.

#### `src/eval/vitor/cases/case-00-smoke-persona-grounding.ts:20`
Comment menciona `get_step_data`. Atualizar:
```
- "se há regressão na integração get_step_data"
+ "se há regressão na integração read_persona"
```

---

## 4. Validação pós-cleanup

```bash
# 1. Type-check
npx tsc --noEmit

# 2. Build
npm run build

# 3. Re-grep pra confirmar zero hits funcionais
rg "DesignSessionStepData|step_array_|getStepData|updateStepData|sync_brainstorm_(features|buckets)|step_data_reject_dup_ids" \
   src/ supabase/ \
   --type ts --type sql

# Esperado: hits apenas em:
# - supabase/migrations/2026{0506,0509,0501,0423,0427,0515,...} (migrations históricas, NÃO mexer)
# - src/components/ui/conversation/tool-registry.ts (se mantido)
# - docs/*.md
```

---

## 5. Smoke pós-deploy

1. Abrir DS Zelar v2 (`264e6d07-...`).
2. Mandar mensagem pro Vitor em cada step (product_vision, personas, brainstorm, prioritization, briefing) — confirmar que ele lê via `read_X` e escreve via `write_X` sem erro.
3. Realtime: abrir 2 tabs no mesmo step, criar item numa, ver aparecer na outra em <500ms.
4. Export: rodar `export-design-session` numa sessão e diff o output vs export do dia anterior (formato v2 agora).
5. Histórico: abrir thread antiga (pré-v2), confirmar que chips renderizam (mesmo que com label "(legado)").

---

## 6. Commit

```bash
bash scripts/sync-main.sh -m "ZRD-JM-XX: vitor — PR 3 drop DesignSessionStepData + step_array_* + endpoint genérico"
```

---

## 7. Pós-merge — atualizar memory

Editar `~/.claude/projects/.../memory/project_design_session.md`:
- Remover qualquer menção a "DesignSessionStepData" como ativa.
- Atualizar arquitetura: "9 tabelas normalizadas, sem step_data espelhado".
