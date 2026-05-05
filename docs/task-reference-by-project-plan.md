# Task Reference por Projeto — Plano de Migração

**Status:** pronto pra execução
**Owner:** agente delegado
**Data do plano:** 2026-05-05

---

## Contexto

Hoje `Task.reference` é gerado por uma função global `next_task_reference()` que produz `TASK-001`, `TASK-002`... sem prefixo de projeto. Isso causa:

1. **Refs misturadas entre projetos** — TASK-125 pode ser do Zordon, TASK-126 do Zelar. Não dá pra identificar projeto pela ref.
2. **Inconsistência com User Stories** — `UserStory.reference` já usa formato `<KEY>-US-NNN` por projeto (ex: `ZRDN-US-001`, `EVZL-US-027`), gerado por `next_user_story_reference(projectId)` que lê `Project.referenceKey`.
3. **Tasks em draft (criadas pelo agent Vitor) ficam com `reference: null`** — UI faz fallback pro UUID, que aparece feio em breadcrumbs e listagens.

**Objetivo:** unificar tasks no padrão `<KEY>-T-NNN` por projeto (ex: `ZRDN-T-001`, `EVZL-T-001`), gerado no momento da criação (inclusive pelo agent), e backfill do Zordon que tem 89 tasks legadas.

---

## Estado atual do banco (medido em 2026-05-05)

| Projeto | `referenceKey` | Tasks com `TASK-NNN` legado | Tasks sem ref (draft do agent) |
|---|---|---|---|
| **Zordon** | `ZRDN` | 89 | 0 |
| **__eval__zelar** | `EVZL` | 16 | 4 |
| FORGE | `FRGE` | 1 | 0 |
| Zelar | `ZLAR` | 1 | 0 |

- **Branches Git / PRs já criados em qualquer task**: 0 (sem impacto em integrações Git)
- **Menções `TASK-NNN` em ChatMessage do Zordon**: 0
- **Menções `TASK-NNN` em description/notes de Tasks do Zordon**: 2 (ambas apontam pra `TASK-144` que **não existe no banco** — são refs mortas, ignorar)

**Decisão de escopo confirmada pelo dono do projeto:**
- ✅ **Backfill do Zordon** (renumerar 89 tasks pra `ZRDN-T-001..ZRDN-T-089` ordenando por `createdAt ASC`)
- ❌ **NÃO mexer em eval-zelar, FORGE, Zelar** — são projetos pequenos/eval, ficam com refs antigas conviventes
- ❌ **NÃO substituir refs em texto livre** (description/notes/chat) — são audit trail histórico

---

## Função alvo (espelha `next_user_story_reference`)

Para referência, a função existente que serve de modelo:

```sql
CREATE OR REPLACE FUNCTION public.next_user_story_reference(p_project_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_key text;
  v_seq int;
BEGIN
  SELECT "referenceKey" INTO v_key FROM public."Project" WHERE id = p_project_id;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Project % is missing referenceKey', p_project_id;
  END IF;

  SELECT COALESCE(MAX(
    CAST(SUBSTRING(reference FROM '\-US\-(\d+)$') AS int)
  ), 0) + 1
  INTO v_seq
  FROM public."UserStory"
  WHERE "projectId" = p_project_id;

  RETURN v_key || '-US-' || LPAD(v_seq::text, 3, '0');
END;
$$;
```

**Função nova (alvo):** mesma lógica, mas com regex `\-T\-(\d+)$` e prefixo `-T-`.

---

## Estratégia de execução (2 migrations + code change entre elas)

### Por que duas migrations?

A função antiga `next_task_reference()` (sem args) tem 6 callers em código TypeScript. Não dá pra dropar antes de atualizar todos. Sequência segura:

1. **Migration #1**: cria função NOVA (`next_task_reference_v2`) com nova assinatura + backfill Zordon. Função antiga **continua viva**.
2. **Code change**: atualiza os 6 callers + `create_task` (agent) pra usar `next_task_reference_v2(projectId)`. Função antiga ainda existe mas vira código morto.
3. **Migration #2**: dropa função antiga + renomeia v2 → `next_task_reference`. Agora a função canônica tem assinatura nova e única.

Janela de inconsistência: zero. Aplica #1, faz code change e push, aplica #2.

---

## Migration #1 — `supabase/migrations/<YYYYMMDD>_task_reference_per_project_step1.sql`

```sql
-- Step 1: cria next_task_reference_v2 (assinatura nova) + backfill Zordon.
-- A função antiga next_task_reference() (sem args) continua existindo pra
-- callers TS ainda não migrados — será dropada na migration step2.

BEGIN;

-- 1. Função nova com assinatura definitiva (nome temporário _v2).
CREATE OR REPLACE FUNCTION public.next_task_reference_v2(p_project_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_key text;
  v_seq int;
BEGIN
  SELECT "referenceKey" INTO v_key FROM public."Project" WHERE id = p_project_id;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Project % is missing referenceKey', p_project_id;
  END IF;

  SELECT COALESCE(MAX(
    CAST(SUBSTRING(reference FROM '\-T\-(\d+)$') AS int)
  ), 0) + 1
  INTO v_seq
  FROM public."Task"
  WHERE "projectId" = p_project_id;

  RETURN v_key || '-T-' || LPAD(v_seq::text, 3, '0');
END;
$$;

-- 2. Permissions iguais à next_user_story_reference (security definer já cuida).
GRANT EXECUTE ON FUNCTION public.next_task_reference_v2(uuid) TO authenticated;

-- 3. Backfill Zordon: 89 tasks viram ZRDN-T-001..ZRDN-T-089 ordenado por createdAt.
--    Garante UNIQUE constraint não estoura: ZRDN-T-NNN é prefixo novo, sem colisão.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM public."Task"
  WHERE "projectId" = '6f9b7443-547e-418e-b0a5-6f3bb38d762f'  -- Zordon
)
UPDATE public."Task" t
SET reference = 'ZRDN-T-' || LPAD(r.rn::text, 3, '0'),
    "updatedAt" = now()
FROM ranked r
WHERE t.id = r.id;

-- 4. Sanity check: confirma que sequência ficou contígua e única.
DO $$
DECLARE
  v_count int;
  v_max_seq int;
BEGIN
  SELECT count(*) INTO v_count
  FROM public."Task"
  WHERE "projectId" = '6f9b7443-547e-418e-b0a5-6f3bb38d762f'
    AND reference ~ '^ZRDN-T-\d+$';

  SELECT MAX(CAST(SUBSTRING(reference FROM '\-T\-(\d+)$') AS int))
  INTO v_max_seq
  FROM public."Task"
  WHERE "projectId" = '6f9b7443-547e-418e-b0a5-6f3bb38d762f';

  IF v_count <> v_max_seq THEN
    RAISE EXCEPTION 'Backfill ZRDN inconsistente: count=% max_seq=%', v_count, v_max_seq;
  END IF;

  RAISE NOTICE 'Backfill OK: % tasks Zordon renumeradas (ZRDN-T-001..ZRDN-T-%s)',
    v_count, LPAD(v_max_seq::text, 3, '0');
END $$;

COMMIT;
```

**Como rodar (segue convenção do projeto — psql via DIRECT_URL):**

```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && \
  psql "$DIRECT_URL" -f supabase/migrations/<YYYYMMDD>_task_reference_per_project_step1.sql
```

**Pós-execução, validar:**

```sql
-- Deve retornar 89 linhas, todas ZRDN-T-001..ZRDN-T-089
SELECT reference, "createdAt"
FROM "Task"
WHERE "projectId" = '6f9b7443-547e-418e-b0a5-6f3bb38d762f'
ORDER BY reference;

-- Deve retornar 'ZRDN-T-090' (próxima ref)
SELECT next_task_reference_v2('6f9b7443-547e-418e-b0a5-6f3bb38d762f');
```

---

## Code change (entre as duas migrations)

### Arquivos a editar

#### 1. `src/lib/agent/tools/create-task.ts` — ALTERAR

Atualmente cria task com `reference: null`. Mudar pra chamar a RPC nova e gravar a ref já no insert.

**Mudança no INSERT path** (perto de [src/lib/agent/tools/create-task.ts:200](src/lib/agent/tools/create-task.ts#L200)):

```typescript
// ANTES do .insert(), gerar a ref:
const refRpc = await supabase.rpc("next_task_reference_v2", {
  p_project_id: projectId,
});
if (refRpc.error || !refRpc.data) {
  return { success: false, error: refRpc.error?.message ?? "reference generation failed" };
}
const reference = refRpc.data as unknown as string;

const { data: task, error } = await supabase
  .from("Task")
  .insert({
    id: crypto.randomUUID(),
    title,
    description,
    reference,           // ← antes era `null`
    status: "draft",
    // ...resto inalterado
  })
  .select("id, title, functionPoints, reference")  // ← incluir reference no select
  .single();
```

E retornar `reference` na resposta da tool pra Vitor ver:

```typescript
return {
  success: true,
  id: task!.id,
  reference: task!.reference,  // ← novo
  title: task!.title,
  functionPoints: task!.functionPoints,
  acCount: trimmedAc.length,
  tags: { ... },
  alreadyExisted: false,
};
```

#### 2. Os 6 callers de `next_task_reference()` legado — ATUALIZAR cada um

Lista exata (com linha):

| Arquivo | Linha | projectId em escopo? |
|---|---|---|
| `src/app/api/tasks/route.ts` | 82 | sim, vem do request body |
| `src/app/api/tasks/[id]/duplicate/route.ts` | 69 | sim, da task original |
| `src/app/api/tasks/[id]/clone/route.ts` | 94 | sim, da task original |
| `src/app/api/design-sessions/[id]/export/route.ts` | 50 | sim, da session |
| `src/lib/agent/agents/alpha/tools.ts` | 610 | sim, capability scoped |
| `src/lib/meetings/task-action-executor.ts` | 81 | sim, da meeting → task |
| `src/lib/dal/story-hierarchy.ts` | 457 | sim, da story → projectId |

**Padrão da mudança em cada lugar:**

```typescript
// ANTES:
const { data: ref } = await supabase.rpc("next_task_reference");

// DEPOIS:
const { data: ref } = await supabase.rpc("next_task_reference_v2", {
  p_project_id: projectId,  // <- já existe em escopo nesses callers
});
```

**Atenção em `src/app/api/design-sessions/[id]/export/route.ts:48-58`:** este é o promotor draft → backlog. A lógica atual gera ref **só se `task.reference` for null**. Como após a code change todas as tasks novas já vêm com ref do agent, esse `if (!task.reference)` quase nunca dispara — mas mantém pra cobrir tasks legadas em draft sem ref. Só trocar a chamada da RPC.

#### 3. `src/lib/supabase/database.types.ts` — REGENERAR ou EDITAR

Linha 3715 hoje:
```typescript
next_task_reference: { Args: never; Returns: string }
```

Após a migration #2 (rename), vira:
```typescript
next_task_reference: { Args: { p_project_id: string }; Returns: string }
```

**Como atualizar:** se houver script de geração de types do Supabase, rodar e commitar. Senão, edição manual mesmo. **Importante:** atualizar SÓ depois da migration #2, pra refletir o estado final.

#### 4. Buscar regressões

Antes de aplicar a migration #2, rodar:

```bash
grep -rn "next_task_reference" src/ --include="*.ts" 2>&1 | grep -v "_v2"
```

Deve retornar **apenas** `database.types.ts:3715` (a entrada de tipo). Se aparecer qualquer outra coisa, é caller esquecido — atualizar antes de prosseguir.

#### 5. Typecheck

```bash
npx tsc --noEmit -p tsconfig.json
```

Tem que passar limpo. Se der erro de "Args: never", significa que algum caller ainda chama sem args (provavelmente tem cache do TS lang server — invalidar e tentar de novo).

---

## Migration #2 — `supabase/migrations/<YYYYMMDD>_task_reference_per_project_step2.sql`

```sql
-- Step 2: dropa função antiga global e renomeia v2 → next_task_reference.
-- Pré-requisito: todos os 6 callers TS já migrados pra next_task_reference_v2.

BEGIN;

-- 1. Confirma que function v2 existe (defensive check).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'next_task_reference_v2'
  ) THEN
    RAISE EXCEPTION 'next_task_reference_v2 not found — run step1 migration first';
  END IF;
END $$;

-- 2. Drop função antiga (sem args).
DROP FUNCTION IF EXISTS public.next_task_reference();

-- 3. Renomeia v2 → next_task_reference (recupera o nome canônico).
ALTER FUNCTION public.next_task_reference_v2(uuid)
  RENAME TO next_task_reference;

COMMIT;
```

**Como rodar:**

```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && \
  psql "$DIRECT_URL" -f supabase/migrations/<YYYYMMDD>_task_reference_per_project_step2.sql
```

**Pós-execução, validar:**

```sql
-- Função antiga não existe mais
SELECT count(*) FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'next_task_reference'
  AND pronargs = 0;
-- Esperado: 0

-- Função nova canônica existe e funciona
SELECT next_task_reference('6f9b7443-547e-418e-b0a5-6f3bb38d762f');
-- Esperado: 'ZRDN-T-090'
```

**Após esta migration, atualizar `database.types.ts`** (item 3 do code change) trocando `Args: { p_project_id: string }` na entrada `next_task_reference`. E remover qualquer entrada `next_task_reference_v2` se foi adicionada durante a transição.

---

## Validação ponta a ponta (após tudo aplicado)

### 1. Backfill Zordon validado

```sql
-- Listar primeiras e últimas refs do Zordon
SELECT reference, LEFT(title, 50) AS title, "createdAt"
FROM "Task"
WHERE "projectId" = '6f9b7443-547e-418e-b0a5-6f3bb38d762f'
ORDER BY reference
LIMIT 5;

SELECT reference, LEFT(title, 50) AS title, "createdAt"
FROM "Task"
WHERE "projectId" = '6f9b7443-547e-418e-b0a5-6f3bb38d762f'
ORDER BY reference DESC
LIMIT 5;
```

Esperado: `ZRDN-T-001` é a task mais antiga, `ZRDN-T-089` é a mais recente.

### 2. Outros projetos intocados

```sql
-- eval-zelar, FORGE, Zelar mantêm TASK-NNN legado
SELECT
  p."referenceKey",
  count(*) FILTER (WHERE t.reference LIKE 'TASK-%') AS legacy_count,
  count(*) FILTER (WHERE t.reference ~ '^[A-Z]+-T-\d+$') AS new_format_count
FROM "Project" p
JOIN "Task" t ON t."projectId" = p.id
GROUP BY p."referenceKey"
ORDER BY p."referenceKey";
```

Esperado:
- ZRDN: legacy 0, new 89
- EVZL: legacy 16, new 0 (4 drafts ainda sem ref serão atribuídas na próxima criação ou promoção)
- FRGE: legacy 1, new 0
- ZLAR: legacy 1, new 0

### 3. Nova task via Vitor (agent flow)

Pegar a sessão eval-zelar ativa (`58d05f55-57c6-4b26-86c4-9199a8f67f34`), garantir uma story refined, rodar:

```bash
npx tsx --require ./scripts/_server-only-shim.cjs scripts/vitor-cli.ts \
  --session 58d05f55-57c6-4b26-86c4-9199a8f67f34 \
  --message "decompõe US-029 em tasks. proponha primeiro, espero ok pra criar."
```

Validar: tasks criadas saem com `reference = 'EVZL-T-001'`, `'EVZL-T-002'`... (porque eval-zelar ainda não tem nenhuma `<KEY>-T-NNN`, sequência reinicia do 1 mesmo coexistindo com TASK-NNN legado — a regex `\-T\-(\d+)$` não bate em TASK-NNN).

### 4. Promoção draft → backlog (export route)

Drafts antigos do eval-zelar (sem ref) ainda existem. Quando promover, devem receber `EVZL-T-NNN` pelo caller atualizado em `export/route.ts`.

### 5. UI

Abrir um task sheet de qualquer task do Zordon. Breadcrumb deve mostrar `ZRDN-T-XXX` (não mais o UUID que aparecia em drafts, e não mais `TASK-XXX` global).

Abrir uma task draft criada pelo Vitor no eval-zelar. Breadcrumb deve mostrar `EVZL-T-XXX` (não UUID).

---

## Rollback (se algo der errado)

### Rollback da Migration #1 (antes de aplicar a #2)

```sql
BEGIN;

-- Restaurar refs antigas do Zordon (precisa de backup ou map manual — sem isso, ROLLBACK não é trivial)
-- ATENÇÃO: a migration #1 não preserva refs antigas. Se precisar reverter,
-- rodar antes da migration #1 um snapshot:
--   CREATE TABLE _backup_zordon_refs AS
--   SELECT id, reference FROM "Task" WHERE "projectId" = '6f9b7443-...';
-- E na hora de reverter:
--   UPDATE "Task" t SET reference = b.reference
--   FROM _backup_zordon_refs b WHERE t.id = b.id;

-- Drop função nova
DROP FUNCTION IF EXISTS public.next_task_reference_v2(uuid);

COMMIT;
```

**Recomendação forte:** o agente executor DEVE criar o backup antes de rodar a migration #1:

```sql
CREATE TABLE _backup_zordon_refs_20260505 AS
SELECT id, reference FROM "Task"
WHERE "projectId" = '6f9b7443-547e-418e-b0a5-6f3bb38d762f';
```

Manter pelo menos 7 dias após a migração #2. Depois pode dropar.

### Rollback da Migration #2

```sql
BEGIN;

ALTER FUNCTION public.next_task_reference(uuid)
  RENAME TO next_task_reference_v2;

CREATE FUNCTION public.next_task_reference()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  last_ref text;
  next_num int;
BEGIN
  SELECT reference INTO last_ref
  FROM public."Task"
  WHERE reference LIKE 'TASK-%'
  ORDER BY reference DESC
  LIMIT 1;

  next_num := COALESCE(
    (regexp_replace(last_ref, '^TASK-', ''))::int,
    0
  ) + 1;

  RETURN 'TASK-' || lpad(next_num::text, 3, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_task_reference() TO authenticated;

COMMIT;
```

E reverter o code change (git revert do commit que migrou os callers).

---

## Checklist de execução (pra o agente executor)

- [ ] **Pré-trabalho**: criar backup `_backup_zordon_refs_<data>` antes de qualquer mudança
- [ ] Criar arquivo `supabase/migrations/<YYYYMMDD>_task_reference_per_project_step1.sql` com o conteúdo da seção "Migration #1"
- [ ] Rodar migration #1 via `psql "$DIRECT_URL" -f ...`
- [ ] Validar via SELECTs da seção "Pós-execução" da migration #1
- [ ] Aplicar code change nos 8 arquivos listados em "Code change" (1 agent tool + 6 callers + 1 types)
- [ ] Rodar `grep -rn "next_task_reference" src/ --include="*.ts" | grep -v "_v2"` — deve retornar APENAS `database.types.ts`
- [ ] Rodar `npx tsc --noEmit -p tsconfig.json` — deve passar limpo
- [ ] Criar arquivo `supabase/migrations/<YYYYMMDD>_task_reference_per_project_step2.sql` com o conteúdo da seção "Migration #2"
- [ ] Rodar migration #2 via psql
- [ ] Validar via SELECTs da seção "Pós-execução" da migration #2
- [ ] Atualizar `database.types.ts` linha 3715 pra refletir nova assinatura (`Args: { p_project_id: string }`)
- [ ] Rodar typecheck final
- [ ] Validar UI: abrir task sheet de Zordon e ver breadcrumb `ZRDN-T-XXX`
- [ ] Rodar `vitor-cli` e criar nova task no eval-zelar — verificar que sai `EVZL-T-001`
- [ ] Commit com mensagem `ZRD-JM-NN: refs/migrations — task reference por projeto + backfill Zordon`

---

## Notas finais

- **Coexistência aceita**: o sistema vai conviver com 2 formatos (`TASK-NNN` legado em eval-zelar/FORGE/Zelar e `<KEY>-T-NNN` novo em Zordon e tudo daqui pra frente). Isso é OK — não vale o esforço de renumerar projetos pequenos.
- **`Project.referenceKey` é assumido sempre presente** — a função nova levanta exception se for null. Confirmar que todos os projetos têm `referenceKey` antes de rodar a migration:

```sql
SELECT id, name FROM "Project" WHERE "referenceKey" IS NULL;
-- Esperado: 0 linhas
```

Se aparecer projeto sem key, popular antes da migration.

- **A função `next_task_reference` retorna ref textual mas NÃO insere a row.** O insert é responsabilidade do caller. Cada caller é que faz o `INSERT INTO Task ...` passando o ref retornado.

- **Concorrência**: a função tem `SECURITY DEFINER` mas não usa lock. Se 2 chamadas simultâneas pedirem ref do mesmo projeto, ambas podem retornar a mesma ref (race). A constraint UNIQUE da coluna `reference` evita corrupção (segunda inserção falha com 23505), mas o caller precisa ter retry — o `export/route.ts` já tem isso (loop de 5 tentativas em [src/app/api/design-sessions/[id]/export/route.ts:42](src/app/api/design-sessions/[id]/export/route.ts#L42)). Para `create_task` agent, o risco é baixíssimo (inserts são serializados pelo agent) mas vale colocar 1 retry simples por segurança.

---

## Resumo executivo (1 parágrafo)

Migrar `Task.reference` de formato global `TASK-NNN` pra formato por projeto `<KEY>-T-NNN`, alinhando com o padrão já usado em `UserStory.reference`. Inclui backfill das 89 tasks do Zordon (renumeradas pra `ZRDN-T-001..089`), criação de função RPC nova com assinatura `(p_project_id uuid)`, atualização de 6 callers TS + 1 agent tool, e drop da função antiga. Eval-zelar / FORGE / Zelar **não** são renumerados — convivem com refs legadas. Branches Git zerados → sem impacto em integrações. Aplica em 2 migrations sequenciais com code change no meio pra garantir zero downtime.
