# RUNBOOK — Vitor as PM (no-stop)

> **Para o agente que está lendo este runbook:** você foi invocado pra executar este documento **do começo ao fim sem pausar pra perguntar nada ao usuário**. Toda decisão está pré-tomada aqui. Se uma decisão não estiver, **use o default mais conservador** (preserva código existente, não dispara migração nova, faz commit local sem push). **Não use** `AskUserQuestion`. **Não pare** em "approval required" — assume aprovação implícita do operador via execução do runbook.
>
> **Operador (humano que rodou o runbook):** após terminar, revise os commits e rode `bash scripts/sync-main.sh -m "feat: ship vitor-as-pm v1"` (ou equivalente) quando estiver confortável em push.

**Owner do runbook:** João Moraes
**PRD origem:** [`docs/prd/prd-vitor-output-as-prd.md`](../prd/backlog/prd-vitor-output-as-prd.md)
**Data:** 2026-05-29
**Escopo:** Fases 1-3 do PRD (MVP). Fases 4-5 ficam de fora — exigem decisão humana.

---

## 0. Briefing obrigatório (leia ANTES de tocar em qualquer arquivo)

Leia, nesta ordem, e mantenha em memória de trabalho:

1. [`AGENTS.md`](../../AGENTS.md) — convenções do repo (psql obrigatório pra migrations, UI patterns, sync-main.sh).
2. [`docs/prd/prd-vitor-output-as-prd.md`](../prd/backlog/prd-vitor-output-as-prd.md) — o PRD que este runbook materializa. Decisões fixadas na seção 5.
3. [`src/lib/agent/agents/vitor/index.ts`](../../src/lib/agent/agents/vitor/index.ts) — Vitor atual (`vitorAgent: AgentDefinition`, loadContext, tools). Linhas 61+.
4. [`src/lib/agent/agents/vitoria/tools.ts`](../../src/lib/agent/agents/vitoria/tools.ts) — padrão de tools (AI SDK ToolSet). Mirror desse estilo nos novos tools.
5. [`src/lib/dal/story-hierarchy.ts`](../../src/lib/dal/story-hierarchy.ts) — padrão DAL (db client via `db()`, retorno tipado, activity log).
6. [`supabase/migrations/20260530_member_theme.sql`](../../supabase/migrations/20260530_member_theme.sql) — exemplo de migration recente (estilo, idempotência via `IF NOT EXISTS`).

**Defaults pré-decididos (não pergunte ao usuário):**

| Decisão | Default |
|---|---|
| Branch | continuar em `joao-dev` (branch ativa); criar `feat/vitor-as-pm` apenas se `joao-dev` estiver atrás de `main` em mais de 5 commits |
| Commit por fase | sim — 1 commit ao fim de cada fase, mensagem `ZRD-JM-NN: <fase> — <delta>` |
| Push | **não** push automático. Operador faz manual no fim. |
| PRD por persona vs functionality | por **functionality** (`personaIds[]`) |
| Module continua | sim — agrupador de PRDs |
| Materialize automática? | **explícita** (PM aciona via UI) |
| `markdown` field do PRD | gerado por trigger SQL no INSERT/UPDATE; não pelo Vitor |
| DS CI gera PRD? | **não** na v1 — só DS Inception |
| Migração Zelar | **não tocar**. Schema novo coexiste com legacy. |
| Erro em qualquer fase | tente 1× re-execução do step. Se falhar de novo: abortar a fase, deixar branch intocada, escrever `docs/runbooks/vitor-as-pm-runbook-FAILED.md` com diagnóstico, NÃO reverter commits anteriores. |

---

## 1. Pre-flight (auto-detect, não pergunte)

Execute cada bloco. Se o gate falhar, **aborte com diagnóstico** — não tente "consertar criativamente".

### 1.1 Working tree

```bash
# Verifica tree limpa ou só com arquivos que JÁ estavam dirty antes do runbook
git status --porcelain
```

**Gate:** se `git status --porcelain` tem arquivos modificados que **não** estão na lista do `status` do início do runbook (você vê no system prompt inicial), aborte — outra sessão está trabalhando. Se está vazio ou só os mesmos arquivos do início, prossiga.

### 1.2 Env e dependências

```bash
# .env tem DIRECT_URL?
grep -q '^DIRECT_URL=' .env && echo "OK: DIRECT_URL present" || { echo "FAIL: DIRECT_URL missing"; exit 1; }

# psql disponível?
command -v psql >/dev/null && echo "OK: psql" || { echo "FAIL: psql not installed"; exit 1; }

# Node modules instalados?
test -d node_modules && echo "OK: node_modules" || { echo "FAIL: run npm install"; exit 1; }

# Conexão DB funciona?
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql "$DIRECT_URL" -c "SELECT 1" >/dev/null && echo "OK: db reachable" || { echo "FAIL: cannot reach DB"; exit 1; }
```

### 1.3 Branch e baseline

```bash
git branch --show-current
git rev-list --count main..HEAD  # quantos commits à frente de main
```

**Gate:** se branch ≠ `joao-dev`, faça `git checkout joao-dev`. Se `joao-dev` está > 5 commits atrás de `main` (ver via `git rev-list --count HEAD..origin/main`), aborte e peça ao operador resolver.

### 1.4 Snapshot estado atual

```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /')
psql "$DIRECT_URL" -t -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('ProductRequirement','ProductRequirementActivity');" > /tmp/vitor-pm-runbook-tables.txt
cat /tmp/vitor-pm-runbook-tables.txt
```

**Gate:** se output vazio → migração nunca rodou, prossegue na Fase 1. Se já tem as duas tabelas → migração já rodou, **pule a seção 2.1** (executar migration) mas faça todo o resto.

---

## 2. Fase 1 — Schema + Vitor tools (PRD = saída do Vitor)

### 2.1 Migration: criar `ProductRequirement` + `ProductRequirementActivity` + `Task.productRequirementId`

Escreva em [`supabase/migrations/20260530c_product_requirement.sql`](../../supabase/migrations/20260530c_product_requirement.sql):

```sql
-- 20260530c_product_requirement.sql
-- PRD = entidade de 1ª classe. Output do Vitor (reposicionado como PM).
-- Module continua como agrupador. UserStory permanece (legacy) — coexiste.

BEGIN;

-- ============================================================
-- 1) ProductRequirement
-- ============================================================
CREATE TABLE IF NOT EXISTS public."ProductRequirement" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId" uuid NOT NULL REFERENCES public."Project"(id) ON DELETE CASCADE,
  "moduleId" uuid REFERENCES public."Module"(id) ON DELETE SET NULL,
  "designSessionId" uuid REFERENCES public."DesignSession"(id) ON DELETE SET NULL,

  reference text NOT NULL,                       -- ex: EVZL-PRD-001
  title text NOT NULL,
  "oneLiner" text NOT NULL DEFAULT '',
  "personaIds" uuid[] NOT NULL DEFAULT '{}',

  problem text NOT NULL DEFAULT '',
  goal text NOT NULL DEFAULT '',
  "userJourney" jsonb NOT NULL DEFAULT '[]'::jsonb,        -- [{actor, action, expectation}]
  "acceptanceCriteria" jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{given, when, then}]
  "successMetrics" jsonb NOT NULL DEFAULT '[]'::jsonb,     -- [{metric, baseline?, target}]
  "outOfScope" text[] NOT NULL DEFAULT '{}',
  dependencies jsonb NOT NULL DEFAULT '[]'::jsonb,         -- [{prdId, kind}]
  "technicalNotes" text NOT NULL DEFAULT '',
  "risksAndAssumptions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "sourceCardIds" text[] NOT NULL DEFAULT '{}',

  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','review','approved','superseded')),
  version int NOT NULL DEFAULT 1,
  markdown text NOT NULL DEFAULT '',

  "approvedAt" timestamptz,
  "approvedBy" uuid REFERENCES public."Member"(id) ON DELETE SET NULL,

  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "dismissedAt" timestamptz,

  CONSTRAINT prd_reference_per_project UNIQUE ("projectId", reference)
);

CREATE INDEX IF NOT EXISTS prd_project_idx       ON public."ProductRequirement"("projectId");
CREATE INDEX IF NOT EXISTS prd_module_idx        ON public."ProductRequirement"("moduleId");
CREATE INDEX IF NOT EXISTS prd_design_session_idx ON public."ProductRequirement"("designSessionId");
CREATE INDEX IF NOT EXISTS prd_status_idx        ON public."ProductRequirement"(status);

-- ============================================================
-- 2) ProductRequirementActivity (audit log)
-- ============================================================
CREATE TABLE IF NOT EXISTS public."ProductRequirementActivity" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "productRequirementId" uuid NOT NULL REFERENCES public."ProductRequirement"(id) ON DELETE CASCADE,
  "actorMemberId" uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  "actorAgent" text,                              -- 'vitor' | 'vitoria' | 'system'
  kind text NOT NULL,                             -- 'created'|'updated'|'approved'|'superseded'|'materialized'
  diff jsonb NOT NULL DEFAULT '{}'::jsonb,        -- {before, after} dos campos mudados
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prd_activity_prd_idx ON public."ProductRequirementActivity"("productRequirementId");

-- ============================================================
-- 3) Task.productRequirementId — handoff Vitoria
-- ============================================================
ALTER TABLE public."Task"
  ADD COLUMN IF NOT EXISTS "productRequirementId" uuid
    REFERENCES public."ProductRequirement"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS task_prd_idx ON public."Task"("productRequirementId");

-- Nota: na v1 NÃO ativamos CHECK forçando "exatamente uma FK preenchida"
-- (userStoryId xor productRequirementId). Coexistência permitida durante transição.
-- Quando todos US legacy migrarem (Fase 4 do PRD), adicionar:
--   CHECK ("userStoryId" IS NOT NULL OR "productRequirementId" IS NOT NULL)

-- ============================================================
-- 4) Trigger: markdown derivado
-- ============================================================
CREATE OR REPLACE FUNCTION public.prd_render_markdown(p public."ProductRequirement")
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  md text;
  ac jsonb;
  m  jsonb;
  dep jsonb;
  oos text;
BEGIN
  md := format('# [%s] %s', p.reference, p.title) || E'\n\n';
  md := md || coalesce(p."oneLiner", '') || E'\n\n';
  md := md || '## Problema' || E'\n' || coalesce(p.problem,'') || E'\n\n';
  md := md || '## Goal'     || E'\n' || coalesce(p.goal,'')    || E'\n\n';

  IF jsonb_array_length(p."acceptanceCriteria") > 0 THEN
    md := md || '## Acceptance Criteria' || E'\n';
    FOR ac IN SELECT * FROM jsonb_array_elements(p."acceptanceCriteria") LOOP
      md := md || format('- **Given** %s **When** %s **Then** %s',
              coalesce(ac->>'given',''), coalesce(ac->>'when',''), coalesce(ac->>'then','')) || E'\n';
    END LOOP;
    md := md || E'\n';
  END IF;

  IF jsonb_array_length(p."successMetrics") > 0 THEN
    md := md || '## Métricas' || E'\n';
    FOR m IN SELECT * FROM jsonb_array_elements(p."successMetrics") LOOP
      md := md || format('- %s: baseline %s → target %s',
              coalesce(m->>'metric',''), coalesce(m->>'baseline','n/a'), coalesce(m->>'target','')) || E'\n';
    END LOOP;
    md := md || E'\n';
  END IF;

  IF array_length(p."outOfScope", 1) > 0 THEN
    md := md || '## Out of scope' || E'\n';
    FOREACH oos IN ARRAY p."outOfScope" LOOP
      md := md || '- ' || oos || E'\n';
    END LOOP;
    md := md || E'\n';
  END IF;

  IF jsonb_array_length(p.dependencies) > 0 THEN
    md := md || '## Dependências' || E'\n';
    FOR dep IN SELECT * FROM jsonb_array_elements(p.dependencies) LOOP
      md := md || format('- %s: %s', coalesce(dep->>'kind','related'), coalesce(dep->>'prdId','')) || E'\n';
    END LOOP;
  END IF;

  RETURN md;
END $$;

CREATE OR REPLACE FUNCTION public.prd_set_markdown() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.markdown := public.prd_render_markdown(NEW);
  NEW."updatedAt" := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS prd_set_markdown_trg ON public."ProductRequirement";
CREATE TRIGGER prd_set_markdown_trg
  BEFORE INSERT OR UPDATE ON public."ProductRequirement"
  FOR EACH ROW EXECUTE FUNCTION public.prd_set_markdown();

-- ============================================================
-- 5) RLS (espelha Module)
-- ============================================================
ALTER TABLE public."ProductRequirement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ProductRequirementActivity" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prd_read   ON public."ProductRequirement";
DROP POLICY IF EXISTS prd_write  ON public."ProductRequirement";
DROP POLICY IF EXISTS prd_act_read ON public."ProductRequirementActivity";

-- Read: quem tem acesso ao projeto enxerga (mirror dos helpers existentes)
CREATE POLICY prd_read ON public."ProductRequirement"
  FOR SELECT
  USING (public.is_manager() OR public.can_view_project("projectId"));

-- Write: manager ou contributor+ do projeto
CREATE POLICY prd_write ON public."ProductRequirement"
  FOR ALL
  USING  (public.is_manager() OR public.can_edit_project("projectId"))
  WITH CHECK (public.is_manager() OR public.can_edit_project("projectId"));

CREATE POLICY prd_act_read ON public."ProductRequirementActivity"
  FOR SELECT
  USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."ProductRequirement" p
      WHERE p.id = "productRequirementId"
        AND public.can_view_project(p."projectId")
    )
  );

COMMIT;
```

**Helpers do RLS:** o runbook assume `is_manager()`, `can_view_project(uuid)`, `can_edit_project(uuid)` existirem (memória `feedback_role_helpers_postgres`). Antes de rodar a migration, valide:

```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /')
psql "$DIRECT_URL" -t -c "SELECT proname FROM pg_proc WHERE proname IN ('is_manager','can_view_project','can_edit_project');"
```

**Se faltar `can_edit_project`:** crie um helper inline na migration substituindo a policy `prd_write` por:

```sql
CREATE POLICY prd_write ON public."ProductRequirement"
  FOR ALL
  USING (public.is_manager())
  WITH CHECK (public.is_manager());
```

(degrada pra "só manager edita" — mais restritivo, seguro como default).

**Executar:**

```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /')
psql "$DIRECT_URL" -f supabase/migrations/20260530c_product_requirement.sql
```

**Gate de sucesso:**

```bash
psql "$DIRECT_URL" -t -c "
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='ProductRequirement') AS prd_table,
  (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='ProductRequirementActivity') AS prd_act_table,
  (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='Task' AND column_name='productRequirementId') AS task_fk;
"
```

Output esperado: `1 | 1 | 1`. Se diferente → aborte, escreva diagnóstico em `/tmp/vitor-pm-failure.txt`.

### 2.2 Regenerar `database.types.ts`

```bash
npm run db:types
```

**Gate:** `grep -q "ProductRequirement:" src/lib/supabase/database.types.ts && echo OK || echo FAIL`. Se FAIL, aborte.

### 2.3 DAL — `src/lib/dal/product-requirements.ts`

Crie o arquivo seguindo o padrão de [`src/lib/dal/story-hierarchy.ts`](../../src/lib/dal/story-hierarchy.ts). Funções a exportar (assinaturas exatas, implementação a critério mas mirror do estilo existente — `db()` do `@/lib/db`, retornos tipados a partir de `Database["public"]["Tables"]["ProductRequirement"]["Row"]`):

```ts
export type ProductRequirementRow = Database["public"]["Tables"]["ProductRequirement"]["Row"];
export type ProductRequirementInsert = Database["public"]["Tables"]["ProductRequirement"]["Insert"];
export type ProductRequirementUpdate = Database["public"]["Tables"]["ProductRequirement"]["Update"];

export async function getPrdsForProject(projectId: string, opts?: { status?: PrdStatus[]; moduleId?: string | null }): Promise<ProductRequirementRow[]>;
export async function getPrdById(id: string): Promise<ProductRequirementRow | null>;
export async function nextPrdReference(projectId: string): Promise<string>; // formato <projectKey>-PRD-NNN, lê Project.referenceKey
export async function createPrd(input: Omit<ProductRequirementInsert, "id"|"reference"|"createdAt"|"updatedAt"|"markdown"> & { actorAgent?: "vitor"|"vitoria"|"system"; actorMemberId?: string | null }): Promise<ProductRequirementRow>;
export async function updatePrd(id: string, patch: ProductRequirementUpdate, ctx: { actorAgent?: "vitor"|"vitoria"|"system"; actorMemberId?: string | null }): Promise<ProductRequirementRow>;
export async function approvePrd(id: string, ctx: { actorMemberId: string }): Promise<ProductRequirementRow>;
export async function listPrdsApprovedNotMaterialized(projectId: string): Promise<ProductRequirementRow[]>;  // sem Tasks com productRequirementId = id
export async function recordPrdActivity(args: { productRequirementId: string; kind: "created"|"updated"|"approved"|"superseded"|"materialized"; diff?: object; actorMemberId?: string | null; actorAgent?: "vitor"|"vitoria"|"system" }): Promise<void>;
```

Regras de negócio:
- `createPrd`: gera reference via `nextPrdReference`, INSERT, e chama `recordPrdActivity(kind="created", diff: { after: row })`.
- `updatePrd`: lê row antes, UPDATE, diff `{ before, after }`, activity com `kind="updated"`.
- `approvePrd`: valida `problem.length >= 50`, `goal.length >= 20`, `jsonb_array_length(acceptanceCriteria) >= 3` (faça check em JS antes do UPDATE pra retornar erro 422 amigável). Set `status='approved'`, `approvedAt=now()`, `approvedBy=ctx.actorMemberId`. Activity `kind="approved"`.
- `nextPrdReference`: `SELECT count(*) FROM ProductRequirement WHERE projectId=$1` + 1, formatado `<projectKey>-PRD-NNN` com NNN zero-padded a 3.

### 2.4 Zod schemas — `src/lib/agent/agents/vitor/prd-schemas.ts`

Crie schemas Zod compartilhados entre Vitor tools (input validation) e API routes (Fase 2). Não há `src/lib/zod/` no projeto — coloque junto do Vitor:

```ts
import { z } from "zod";

export const PrdAcceptanceCriterion = z.object({
  given: z.string().min(1),
  when:  z.string().min(1),
  then:  z.string().min(1),
});

export const PrdJourneyStep = z.object({
  actor: z.string().min(1),
  action: z.string().min(1),
  expectation: z.string().min(1),
});

export const PrdMetric = z.object({
  metric: z.string().min(1),
  baseline: z.string().optional(),
  target: z.string().min(1),
});

export const PrdDependency = z.object({
  prdId: z.string().uuid(),
  kind: z.enum(["blocks","enables","shares-data"]),
});

export const PrdRiskOrAssumption = z.object({
  kind: z.enum(["risk","assumption"]),
  text: z.string().min(1),
  mitigation: z.string().optional(),
});

export const ProposePrdInput = z.object({
  projectId: z.string().uuid(),
  designSessionId: z.string().uuid(),
  moduleId: z.string().uuid().optional(),
  title: z.string().min(3).max(140),
  oneLiner: z.string().min(10).max(200),
  personaIds: z.array(z.string().uuid()).default([]),
  problem: z.string().min(50),
  goal: z.string().min(20),
  userJourney: z.array(PrdJourneyStep).default([]),
  acceptanceCriteria: z.array(PrdAcceptanceCriterion).min(3),
  successMetrics: z.array(PrdMetric).default([]),
  outOfScope: z.array(z.string()).default([]),
  technicalNotes: z.string().default(""),
  risksAndAssumptions: z.array(PrdRiskOrAssumption).default([]),
  sourceCardIds: z.array(z.string()).default([]),
});

export const UpdatePrdInput = ProposePrdInput.partial().extend({
  id: z.string().uuid(),
});

export const ApprovePrdInput = z.object({ id: z.string().uuid() });
export const LinkPrdDependencyInput = z.object({
  fromPrdId: z.string().uuid(),
  toPrdId: z.string().uuid(),
  kind: z.enum(["blocks","enables","shares-data"]),
});
```

### 2.5 Refatorar Vitor — remover tools de US/Task/AC, adicionar tools de PRD

Edite [`src/lib/agent/agents/vitor/index.ts`](../../src/lib/agent/agents/vitor/index.ts):

**Remover (do `tools` do `vitorAgent`):**
- `create_user_story`
- `update_user_story`
- `create_task`
- `update_task`
- `manage_story_ac`
- `set_story_refinement`
- `link_task_dependency` (se existir)

**Adicionar** (siga o padrão dos tools removidos pra Zod input + execute):

```ts
propose_prd: tool({
  description: "Propõe um PRD (Product Requirement Document) dentro do projeto da sessão. Use 1 PRD por functionality do brainstorm. Requer problem (≥50 chars), goal (≥20 chars), e ≥3 acceptance criteria.",
  inputSchema: ProposePrdInput.omit({ projectId: true, designSessionId: true }),
  execute: async (args) => {
    const row = await createPrd({
      ...args,
      projectId: ctx.projectId,
      designSessionId: ctx.sessionId,
      actorAgent: "vitor",
      actorMemberId: ctx.memberId ?? null,
    });
    return { id: row.id, reference: row.reference, status: row.status };
  },
}),

update_prd: tool({
  description: "Edita um PRD draft/review. Não pode editar PRD approved (use propose_prd com supersedes ou peça pra mover pra review primeiro).",
  inputSchema: UpdatePrdInput.omit({ projectId: true, designSessionId: true }),
  execute: async ({ id, ...patch }) => {
    const current = await getPrdById(id);
    if (!current) throw new Error("PRD not found");
    if (current.status === "approved") throw new Error("PRD approved — use a nova versão");
    const row = await updatePrd(id, patch, { actorAgent: "vitor", actorMemberId: ctx.memberId ?? null });
    return { id: row.id, version: row.version, status: row.status };
  },
}),

approve_prd: tool({
  description: "Aprova um PRD (status=approved). Valida que o PRD tem problem/goal/AC suficientes. Após aprovação, Vitoria pode materializar em Tasks.",
  inputSchema: ApprovePrdInput,
  execute: async ({ id }) => {
    if (!ctx.memberId) throw new Error("approve_prd requires memberId");
    const row = await approvePrd(id, { actorMemberId: ctx.memberId });
    return { id: row.id, status: row.status, approvedAt: row.approvedAt };
  },
}),

link_prd_dependency: tool({
  description: "Liga dois PRDs por uma dependência (blocks/enables/shares-data). Edita o array dependencies do fromPrdId.",
  inputSchema: LinkPrdDependencyInput,
  execute: async ({ fromPrdId, toPrdId, kind }) => {
    const from = await getPrdById(fromPrdId);
    if (!from) throw new Error("fromPrd not found");
    const deps = [...(from.dependencies as Array<{prdId:string; kind:string}> ?? []), { prdId: toPrdId, kind }];
    await updatePrd(fromPrdId, { dependencies: deps }, { actorAgent: "vitor", actorMemberId: ctx.memberId ?? null });
    return { ok: true };
  },
}),

list_prds: tool({
  description: "Lista PRDs do projeto. Opcional filtro por status. Use pra checar o que já foi criado antes de duplicar.",
  inputSchema: z.object({ status: z.array(z.enum(["draft","review","approved","superseded"])).optional() }),
  execute: async ({ status }) => {
    const rows = await getPrdsForProject(ctx.projectId, { status });
    return rows.map(r => ({ id: r.id, reference: r.reference, title: r.title, status: r.status, moduleId: r.moduleId }));
  },
}),
```

**Imports a adicionar no topo do `vitor/index.ts`:**

```ts
import { createPrd, getPrdById, updatePrd, approvePrd, getPrdsForProject } from "@/lib/dal/product-requirements";
import { ProposePrdInput, UpdatePrdInput, ApprovePrdInput, LinkPrdDependencyInput } from "./prd-schemas";
```

**Atualizar prompt do Vitor (no `systemPrompt` ou `prompt` builder do `vitorAgent`):**

Procure no `index.ts` a string do prompt do step `briefing`. Substitua a seção que descreve "como criar stories/tasks" por:

```
**Seu papel no step `briefing`:**
Você é Product Manager. Sua única responsabilidade é **produzir um array de PRDs** (Product Requirement Documents), um por functionality que emergiu do brainstorm.

Para cada functionality única (após dedup dos 56 cards únicos do brainstorm):
1. Identifique o(s) Module(s) que ela pertence (use `propose_modules`/`approve_module` se necessário).
2. Use `propose_prd` com TODOS os campos preenchidos:
   - problem ≥ 50 chars: descreva a DOR, não a feature.
   - goal ≥ 20 chars: resultado de produto esperado, mensurável.
   - acceptanceCriteria: mínimo 3, formato {given, when, then}.
   - userJourney: passos do ator alvo (vindo das personas).
   - successMetrics: o que mede sucesso (baseline opcional, target obrigatório).
   - outOfScope: clarifica fronteira da functionality.
   - sourceCardIds: IDs dos cards do brainstorm que originaram este PRD (rastreabilidade).
3. Liga dependências entre PRDs via `link_prd_dependency` quando 2 PRDs se cruzam (blocks/enables/shares-data).
4. **Você NÃO cria UserStory, Task, ou AcceptanceCriterion direto.** Tasks são responsabilidade da Vitoria, que materializa PRDs aprovados em Tasks.
5. Quando o PM revisar e aprovar (pela UI), o PRD vai pra `status=approved` — daí em diante a Vitoria pega.

Critério de qualidade do PRD: um builder externo (humano ou agente) consegue ler SÓ o PRD e implementar a functionality sem precisar de mais contexto. Se não consegue, falta detalhe — adicione.
```

### 2.6 Validação Fase 1

```bash
# Typecheck
npx tsc --noEmit

# Lint
npm run lint

# Smoke test: criar PRD via DAL diretamente (sem API ainda)
cat > /tmp/prd-smoke.ts << 'EOF'
import { createPrd, getPrdById } from "@/lib/dal/product-requirements";
import { db } from "@/lib/db";
(async () => {
  const { data: project } = await db().from("Project").select("id, referenceKey").limit(1).single();
  const { data: session } = await db().from("DesignSession").select("id").eq("projectId", project!.id).limit(1).maybeSingle();
  const prd = await createPrd({
    projectId: project!.id,
    designSessionId: session?.id ?? null,
    title: "[SMOKE] PRD test",
    oneLiner: "smoke test do runbook vitor-as-pm",
    problem: "Verificar que o pipeline novo de PRD funciona end-to-end sem regressão no schema ou nas tools.",
    goal: "PRD criado, markdown derivado, activity registrada",
    acceptanceCriteria: [
      { given: "DAL funcional", when: "createPrd chamado", then: "row inserido com reference auto" },
      { given: "trigger ativo", when: "INSERT", then: "markdown != ''" },
      { given: "activity log", when: "createPrd", then: "1 row em ProductRequirementActivity" },
    ],
    actorAgent: "system",
  });
  const back = await getPrdById(prd.id);
  console.log({ id: back?.id, reference: back?.reference, markdownLen: back?.markdown?.length });
  // cleanup
  await db().from("ProductRequirement").delete().eq("id", prd.id);
})();
EOF
npx tsx --require ./scripts/_server-only-shim.cjs /tmp/prd-smoke.ts
```

**Gate:** output deve mostrar `markdownLen > 50` e referência tipo `XXXX-PRD-001`. Se quebrar, aborte.

### 2.7 Commit Fase 1

```bash
# Tag commit auto via ZRD-JM-NN; sync-main.sh stage + commit + rebase, mas vamos commitar local sem push
git add supabase/migrations/20260530c_product_requirement.sql \
        src/lib/supabase/database.types.ts \
        src/lib/dal/product-requirements.ts \
        src/lib/agent/agents/vitor/prd-schemas.ts \
        src/lib/agent/agents/vitor/index.ts

# Próximo número ZRD-JM-NN: lê do último commit
LAST=$(git log -1 --pretty=%s | grep -oE 'ZRD-JM-[0-9]+' | grep -oE '[0-9]+$')
NEXT=$((LAST + 1))
git commit -m "ZRD-JM-${NEXT}: agents/vitor, dal, supabase — vitor-as-pm phase 1 (PRD schema + tools)"
```

---

## 3. Fase 2 — API + UI de revisão de PRD

### 3.1 API routes

Crie estes endpoints. Cada um valida auth via `getMemberFromSession` (padrão do projeto — veja [`src/app/api/meetings/route.ts`](../../src/app/api/meetings/route.ts) pro padrão exato).

**`src/app/api/prds/route.ts`**:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMemberFromSession } from "@/lib/auth/session";
import { canViewProject } from "@/lib/auth/access";
import { getPrdsForProject } from "@/lib/dal/product-requirements";

export const dynamic = "force-dynamic";

const Query = z.object({
  projectId: z.string().uuid(),
  status: z.enum(["draft","review","approved","superseded"]).optional(),
});

export async function GET(req: NextRequest) {
  const member = await getMemberFromSession();
  if (!member) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const parsed = Query.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  if (!(await canViewProject(member.id, parsed.data.projectId))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const rows = await getPrdsForProject(parsed.data.projectId, { status: parsed.data.status ? [parsed.data.status] : undefined });
  return NextResponse.json({ data: rows });
}
```

**`src/app/api/prds/[id]/route.ts`**: GET (return full row) + PATCH (updatePrd, only `draft`/`review`).

**`src/app/api/prds/[id]/approve/route.ts`**: POST → chama `approvePrd`. Retorna 422 com mensagem clara se quality gates falharem.

**Helpers ausentes** (`canViewProject`, `canEditProject`): se não existirem em `src/lib/auth/access.ts`, espelhe da função que `src/app/api/meetings/route.ts` usa. Se NADA existir, faça o check via SQL inline: `SELECT 1 FROM "ProjectAccess" WHERE projectId=$1 AND memberId=$2`.

### 3.2 UI — list + detail

> ⚠️ **Superseded (2026-06).** As rotas standalone `/projects/[id]/prds` e
> `/projects/[id]/prds/[prdId]` foram **removidas**. PRD é artefato de sessão:
> a spec é vista/editada **dentro da Design Session** via `PrdDetailSheet`
> (`src/components/prd/prd-detail-sheet.tsx`), aberto da lista de PRDs em
> `session-detail-sheet.tsx` e no step `prd_briefing`. O `PrdDetail` continua o
> mesmo componente; só passou a viver num sheet (props `onBack`/`onChanged`,
> dados via `GET /api/prds/[id]/detail`). A visão de **execução** do PRD (AC +
> stream) vive na Forja: `/projects/[id]/forge/prds/[prdId]`. O texto abaixo
> descreve a UI antiga e fica como referência histórica.

**Rota lista:** `src/app/(dashboard)/projects/[id]/prds/page.tsx`

Layout (server component, lê via DAL diretamente):

- Header: "PRDs do projeto" + count por status (badges)
- Tabela: `Reference | Title | Module | Status | Updated` — linhas linkam pra `/projects/[id]/prds/[prdId]`
- Filtros: status (draft/review/approved/superseded) via search params
- Empty state: "Nenhum PRD ainda. O Vitor cria PRDs no step `briefing` da Design Session."

Use `Card`, `Badge`, `StatusChip` de `src/components/ui/`. **Não** use `Dialog`/`Sheet` nu — segue `AGENTS.md` UI patterns.

**Rota detalhe:** `src/app/(dashboard)/projects/[id]/prds/[prdId]/page.tsx`

Layout em seções (cada seção = um `Card` com header "Editar" — abre `ResponsiveSheet` com `Field`/`FormBody`):

1. **Header**: reference + title + status chip + botão "Aprovar" (se `status in ('draft','review')`)
2. **Briefing**: oneLiner, personaIds (read-only chips), moduleId
3. **Problema & Goal**: textareas
4. **Jornada do usuário**: lista de steps (CRUD inline)
5. **Acceptance Criteria**: lista Given/When/Then
6. **Métricas de sucesso**: lista metric/baseline/target
7. **Out of scope**: lista de strings
8. **Dependências**: outros PRDs (link)
9. **Notas técnicas**: textarea
10. **Riscos & Assumptions**: lista
11. **Source cards**: read-only (vindo do brainstorm)
12. **Markdown export**: collapsable, mostra `markdown` field
13. **Activity log**: últimas 10 entradas de `ProductRequirementActivity`

**Mutations**: use `useOptimisticCollection` quando editar arrays (AC, métricas, riscos). Use `fetchOrThrow` direto pros campos escalares.

**Approve flow**: botão "Aprovar" abre `ConfirmDialog` (`destructive: false`, mensagem "PRD aprovado vai pra Vitoria materializar em Tasks. Quer aprovar?"). On confirm → `POST /api/prds/[id]/approve`. Em 422, mostra mensagem do validador via Sonner toast.

### 3.3 Link da nav

Adicione link "PRDs" na sidebar do projeto (procure por `project-sidebar.tsx` ou similar — provavelmente em `src/components/sidebar/`). Posição: entre "Stories" e "Tasks". Ícone: `FileText` do `lucide-react`. Visível só pra `access_level in (admin, manager, builder)`.

### 3.4 Validação Fase 2

```bash
npx tsc --noEmit
npm run lint
npm run build  # captura erros de App Router que tsc não pega
```

**Smoke test manual via curl** (servidor não precisa estar de pé — pula este step se `lsof -i :3000` não retorna nada):

```bash
if lsof -i :3000 >/dev/null 2>&1; then
  # GET lista (precisa auth — skip se setup complexo)
  echo "Dev server up — smoke skipped (manual test pelo operador)"
else
  echo "Dev server down — build success suficiente pra Fase 2 gate"
fi
```

### 3.5 Commit Fase 2

```bash
git add src/app/api/prds/ src/app/\(dashboard\)/projects/\[id\]/prds/ src/components/
LAST=$(git log -1 --pretty=%s | grep -oE 'ZRD-JM-[0-9]+' | grep -oE '[0-9]+$')
NEXT=$((LAST + 1))
git commit -m "ZRD-JM-${NEXT}: app, components — vitor-as-pm phase 2 (PRD API + UI)"
```

---

## 4. Fase 3 — Vitoria materializa PRD → Tasks

### 4.1 Novos tools na Vitoria

Edite [`src/lib/agent/agents/vitoria/tools.ts`](../../src/lib/agent/agents/vitoria/tools.ts) — **adicionar**, não substituir os tools de Planning Ceremony.

```ts
list_approved_prds: tool({
  description: "Lista PRDs do projeto com status=approved que ainda não foram materializados em Tasks (sem Task.productRequirementId apontando pra ele).",
  inputSchema: z.object({ moduleId: z.string().uuid().optional() }),
  execute: async ({ moduleId }) => {
    const rows = await listPrdsApprovedNotMaterialized(ctx.projectId);
    return (moduleId ? rows.filter(r => r.moduleId === moduleId) : rows)
      .map(r => ({ id: r.id, reference: r.reference, title: r.title, moduleId: r.moduleId, oneLiner: r.oneLiner }));
  },
}),

materialize_prd_to_tasks: tool({
  description: "Materializa um PRD aprovado em Tasks. Recebe drafts de tasks com FP, scope, complexity, type e dependsOn (refs internas pelos drafts via taskDraftRef opcional). Cria todas as Tasks em ordem topológica e linka via productRequirementId.",
  inputSchema: z.object({
    prdId: z.string().uuid(),
    taskDrafts: z.array(z.object({
      taskDraftRef: z.string().optional(),               // ref interna pra dependsOn entre drafts
      title: z.string().min(3),
      description: z.string().default(""),
      type: z.enum(["build","research","spike","bug","chore"]).default("build"),
      scope: z.enum(["backend","frontend","fullstack","infra","design","docs"]).default("fullstack"),
      complexity: z.enum(["XS","S","M","L","XL"]).default("M"),
      functionPoints: z.number().int().nonnegative().nullable().default(null),
      priority: z.number().int().min(0).max(100).default(50),
      dependsOnRefs: z.array(z.string()).default([]),    // taskDraftRefs internos
      dependsOnTaskIds: z.array(z.string().uuid()).default([]), // Tasks já existentes
    })).min(1),
  }),
  execute: async ({ prdId, taskDrafts }) => {
    const prd = await getPrdById(prdId);
    if (!prd) throw new Error("PRD not found");
    if (prd.status !== "approved") throw new Error("PRD não aprovado — peça aprovação primeiro");

    // 1) cria Tasks em batch (sem dependsOn)
    const refToId = new Map<string, string>();
    const created = [];
    for (const d of taskDrafts) {
      const taskRow = await createTask({
        projectId: ctx.projectId,
        productRequirementId: prdId,
        title: d.title,
        description: d.description,
        type: d.type,
        scope: d.scope,
        complexity: d.complexity,
        functionPoints: d.functionPoints,
        priority: d.priority,
        status: "draft",
      });
      created.push(taskRow);
      if (d.taskDraftRef) refToId.set(d.taskDraftRef, taskRow.id);
    }

    // 2) liga dependsOn
    for (let i = 0; i < taskDrafts.length; i++) {
      const d = taskDrafts[i];
      const taskId = created[i].id;
      const deps = [
        ...d.dependsOnRefs.map(r => refToId.get(r)).filter(Boolean) as string[],
        ...d.dependsOnTaskIds,
      ];
      for (const depId of deps) {
        await linkTaskDependency(taskId, depId, "blocks");
      }
    }

    // 3) marca PRD activity = materialized
    await recordPrdActivity({
      productRequirementId: prdId,
      kind: "materialized",
      diff: { taskCount: created.length, taskIds: created.map(t => t.id) },
      actorAgent: "vitoria",
      actorMemberId: ctx.memberId ?? null,
    });

    return { taskIds: created.map(t => t.id), count: created.length };
  },
}),

propose_sprint_from_prds: tool({
  description: "Propõe composição de sprint a partir de PRDs aprovados. Não cria sprint — retorna sugestão pra PM confirmar na UI.",
  inputSchema: z.object({
    prdIds: z.array(z.string().uuid()).min(1),
    targetCapacityFP: z.number().int().positive(),
    startDate: z.string(),
  }),
  execute: async ({ prdIds, targetCapacityFP, startDate }) => {
    // Pega tasks materializadas (productRequirementId in prdIds, status=draft|backlog)
    const tasks = await getTasksForPrds(prdIds);
    // Greedy: prioridade desc, soma FP até bater capacity
    const sorted = tasks.sort((a,b) => (b.priority ?? 0) - (a.priority ?? 0));
    const selected: typeof tasks = [];
    let totalFP = 0;
    for (const t of sorted) {
      const fp = t.functionPoints ?? 0;
      if (totalFP + fp > targetCapacityFP) continue;
      selected.push(t);
      totalFP += fp;
    }
    return {
      proposal: {
        startDate,
        targetCapacityFP,
        committedFP: totalFP,
        taskIds: selected.map(t => t.id),
        prdsCovered: [...new Set(selected.map(t => t.productRequirementId))],
      },
    };
  },
}),
```

**Imports a adicionar no topo de `vitoria/tools.ts`:**

```ts
import {
  listPrdsApprovedNotMaterialized,
  getPrdById,
  recordPrdActivity,
} from "@/lib/dal/product-requirements";
import { createTask, linkTaskDependency, getTasksForPrds } from "@/lib/dal/tasks"; // ou onde estiver — descobrir via grep
```

**Helpers ausentes:** `createTask`, `linkTaskDependency`, `getTasksForPrds` podem não existir com essas assinaturas. Tarefa do agente:
- Grep `createTask` no projeto. Se existir com assinatura compatível, use. Se não, crie em `src/lib/dal/tasks.ts` mirror de `createPrd`.
- `getTasksForPrds(prdIds)` → `SELECT * FROM "Task" WHERE "productRequirementId" = ANY($1) AND "dismissedAt" IS NULL AND status IN ('draft','backlog')`.

### 4.2 Atualizar prompt da Vitoria

Edite [`src/lib/agent/agents/vitoria/prompt.ts`](../../src/lib/agent/agents/vitoria/prompt.ts). Adicione (não substitua o conteúdo de Planning Ceremony) uma seção nova:

```
## Modo "Execution-from-PRD"

Quando o PM disser "materializar PRDs", "gerar tasks do PRD", ou listar PRDs aprovados:

1. Chame `list_approved_prds` (filtre por moduleId se mencionado).
2. Para cada PRD que o PM pedir pra materializar:
   - Leia o PRD inteiro (peça via tool de leitura se ainda não tem; ou referencie pelo id).
   - Decomponha em Tasks técnicas usando o critério:
     - **build**: implementação real (feature, endpoint, UI).
     - **research**: investigação técnica antes de implementar.
     - **spike**: protótipo descartável pra validar abordagem.
     - **chore**: setup, config, migration.
   - Estime function points (FP) por task. Use o histórico do squad como baseline (pegue de `ctx.squadMembers.fpCapacity`).
   - Identifique dependências entre as tasks (taskDraftRef interno) E entre tasks novas e Tasks existentes do projeto (dependsOnTaskIds).
3. Chame `materialize_prd_to_tasks` com o array completo de drafts.
4. Quando PM pedir sprint, chame `propose_sprint_from_prds` com capacity vinda de `ctx.sprintScope` ou ask the PM.

**Regras inalienáveis:**
- Nunca crie Task sem `productRequirementId` (PRD é o "porquê").
- Nunca materialize um PRD com status ≠ approved.
- Em PRDs com muitas AC (>10), prefira decompor em mais tasks pequenas (3-5 FP cada) em vez de poucas grandes.
- Se PRD tem dependências cross-PRD (blocks), materialize primeiro o blocker.
```

### 4.3 Validação Fase 3

```bash
npx tsc --noEmit
npm run lint
npm run build
```

**Smoke test (DAL direto):**

```bash
cat > /tmp/vitoria-smoke.ts << 'EOF'
import { db } from "@/lib/db";
import { createPrd, approvePrd, getPrdById } from "@/lib/dal/product-requirements";
(async () => {
  const { data: project } = await db().from("Project").select("id").limit(1).single();
  const { data: member } = await db().from("Member").select("id").limit(1).single();
  const prd = await createPrd({
    projectId: project!.id,
    designSessionId: null,
    title: "[SMOKE] Vitoria materialize",
    oneLiner: "smoke test materialização",
    problem: "Testar que approve + materialize fluem end-to-end sem regressão e que activity log captura ambos os eventos.",
    goal: "PRD aprovado e tasks linkadas via productRequirementId",
    acceptanceCriteria: [
      { given: "PRD created", when: "approvePrd", then: "status=approved" },
      { given: "PRD approved", when: "materialize_prd_to_tasks", then: "Tasks criadas" },
      { given: "Tasks criadas", when: "query", then: "all have productRequirementId" },
    ],
    actorAgent: "system",
  });
  const approved = await approvePrd(prd.id, { actorMemberId: member!.id });
  console.log("Approved:", approved.status, approved.approvedAt);
  // cleanup
  await db().from("ProductRequirement").delete().eq("id", prd.id);
})();
EOF
npx tsx --require ./scripts/_server-only-shim.cjs /tmp/vitoria-smoke.ts
```

### 4.4 Commit Fase 3

```bash
git add src/lib/agent/agents/vitoria/ src/lib/dal/
LAST=$(git log -1 --pretty=%s | grep -oE 'ZRD-JM-[0-9]+' | grep -oE '[0-9]+$')
NEXT=$((LAST + 1))
git commit -m "ZRD-JM-${NEXT}: agents/vitoria, dal — vitor-as-pm phase 3 (Vitoria materialize PRD→Tasks)"
```

---

## 5. Validação final + handoff

### 5.1 Gates finais

```bash
npx tsc --noEmit && echo "TS OK"
npm run lint && echo "LINT OK"
npm run build && echo "BUILD OK"
```

### 5.2 Sanity SQL

```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /')
psql "$DIRECT_URL" -c "
SELECT
  (SELECT count(*) FROM \"ProductRequirement\") AS prd_count,
  (SELECT count(*) FROM information_schema.columns WHERE table_name='Task' AND column_name='productRequirementId') AS task_fk,
  (SELECT count(*) FROM pg_trigger WHERE tgname='prd_set_markdown_trg') AS trigger_present;
"
```

### 5.3 Escreva o handoff em `/tmp/vitor-pm-runbook-DONE.md`

Conteúdo:

```markdown
# Runbook vitor-as-pm — COMPLETED

**Data:** $(date -Iseconds)
**Branch:** $(git branch --show-current)
**Commits:** $(git log --pretty="%h %s" main..HEAD)

## Próximos passos pro operador (João)

1. Revise os 3 commits acima (`git log -p main..HEAD`).
2. Suba o dev server: `npm run dev`
3. Abra `http://localhost:3000/projects/<projectId>/prds` num projeto que tenha DS Inception.
4. Rode Vitor numa DS pra ver se ele agora gera PRDs em vez de US/Task.
5. Quando estiver confortável: `bash scripts/sync-main.sh -m "feat: ship vitor-as-pm v1"`

## Pendências fora deste runbook (PRD Fases 4-5)

- Decisão de migração Zelar v2 (`docs/prd/prd-vitor-output-as-prd.md` §9.1)
- Wiki composer ler PRDs (PRD §10 Fase 4)
- GitHub MCP integration na Vitoria (PRD §10 Fase 5)

## Perguntas em aberto do PRD (seção 13) não respondidas

Veja PRD §13. Defaults adotados pelo runbook estão na seção "Defaults pré-decididos" deste runbook.
```

### 5.4 Última coisa — atualize a memória

Crie `~/.claude/projects/-Users-joaomoraes-projetos-ai-dev-Perke-perke-volund/memory/project_vitor_as_pm_shipped.md`:

```markdown
---
name: project-vitor-as-pm-shipped
description: Pipeline Vitor→PRD→Vitoria→Task implementado (Fases 1-3 do PRD). Schema, tools e UI prontos. Migração Zelar pendente.
metadata:
  type: project
---

Pipeline novo do Vitor enviado em <data>. Branch <branch>. Commits <hashes>.

- Tabela `ProductRequirement` + `ProductRequirementActivity` criadas (migration `20260530c_product_requirement.sql`)
- Vitor não cria mais UserStory/Task/AC — só PRDs (tools: propose_prd, update_prd, approve_prd, link_prd_dependency, list_prds)
- Vitoria ganhou modo "execution-from-prd" (tools: list_approved_prds, materialize_prd_to_tasks, propose_sprint_from_prds)
- UI em /projects/[id]/prds (list + detail + approve)
- `Task.productRequirementId` coexiste com `Task.userStoryId` durante transição

**Why:** separação de concerns Vitor=discovery / Vitoria=execução. PRD vira artefato canônico de handoff.

**How to apply:**
- Projeto novo (greenfield): Vitor gera PRDs no `briefing` step da DS Inception.
- Vitoria só materializa PRD com status=approved.
- Zelar v2 ainda no modelo legacy (US/Task) — não migrar sem decisão consciente do João.

Relacionado: [[project-vitor-as-pm]] (PRD), [[project-zelar-v2]].
```

E adicione linha em `MEMORY.md`:

```
- [Vitor as PM — shipped (Fases 1-3)](project_vitor_as_pm_shipped.md) — Schema/tools/UI prontos. Vitor gera PRD; Vitoria materializa em Task. Greenfield only. <data>.
```

---

## 6. Comando único pro operador kickoff (cole isso no Claude Code)

```
Execute o runbook em docs/runbooks/vitor-as-pm-runbook.md inteiro, do começo ao fim, sem parar pra perguntar nada. Todas as decisões já estão lá. Se algo falhar, faça 1 retry; se falhar de novo, escreva diagnóstico em /tmp/vitor-pm-failure.txt e pare. Não faça git push.
```

---

## Apêndice A — Tabela de arquivos criados/modificados

| Arquivo | Tipo | Fase |
|---|---|---|
| `supabase/migrations/20260530c_product_requirement.sql` | new | 1 |
| `src/lib/supabase/database.types.ts` | regen | 1 |
| `src/lib/dal/product-requirements.ts` | new | 1 |
| `src/lib/dal/tasks.ts` (se ausente) | new ou modify | 3 |
| `src/lib/agent/agents/vitor/prd-schemas.ts` | new | 1 |
| `src/lib/agent/agents/vitor/index.ts` | modify (tools + prompt) | 1 |
| `src/app/api/prds/route.ts` | new | 2 |
| `src/app/api/prds/[id]/route.ts` | new | 2 |
| `src/app/api/prds/[id]/approve/route.ts` | new | 2 |
| `src/app/(dashboard)/projects/[id]/prds/page.tsx` | new | 2 |
| `src/app/(dashboard)/projects/[id]/prds/[prdId]/page.tsx` | new | 2 |
| `src/components/prd/*` (componentes editor) | new | 2 |
| `src/components/sidebar/*` (link nav) | modify | 2 |
| `src/lib/agent/agents/vitoria/tools.ts` | modify (+3 tools) | 3 |
| `src/lib/agent/agents/vitoria/prompt.ts` | modify (+seção PRD) | 3 |

## Apêndice B — Failure modes conhecidos

| Sintoma | Causa provável | Ação |
|---|---|---|
| Migration falha em `can_view_project` | Helper não existe no DB | Use fallback de RLS só com `is_manager()` (seção 2.1) |
| `db:types` falha (project-id inválido) | `SUPABASE_PROJECT_ID` env não setado | Verifique `.env`; em última instância edite database.types.ts manualmente seguindo o pattern do trigger SQL (campos `Row`/`Insert`/`Update`) |
| Vitor mantém old tools por engano | Edit não removeu todas referências | Grep `create_user_story\|create_task\|manage_story_ac` em `src/lib/agent/agents/vitor/` — todas devem voltar zero |
| UI build falha em Server Component | Uso de hooks em arquivo sem `"use client"` | Páginas list/detail são Server Components; editores devem estar em arquivos `"use client"` separados |
| Vitoria materialize quebra com FK violation | `createTask` não está setando `productRequirementId` | Verifique signature de `createTask` aceita o campo novo |
