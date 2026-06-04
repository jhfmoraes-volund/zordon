# Projects V2 — Forge unlock + delivery-status machinery

> **Status:** Backlog (Rito 1 não rodou) · **Owner:** João (admin-only pilot) · **Created:** 2026-06-04
> **Feature id:** `projects-v2-forge-unlock` · **Story prefix:** `PV2F`
> **Depends on:** `projects-v2-schema` (provides `ProductRequirement.deliveryStatus` + `deployedToStagingAt`/`deployedToProductionAt`) · `projects-v2-area` (provides the board host + the **Enviar pra Forge** button stub).
>
> Implements **D9** and **§4.2 / §5** of [projects-v2-plan.md](../../features/projects-v2/projects-v2-plan.md): unlock the Forge from `forgeSourceSessionId` so it runs **any approved PRD scoped to the project**, plus the delivery-status state machine that turns a finished Forge run into a PM **review** gate and adds a **Production** lane.

---

## §1 — Problema

1. **A Forge está presa a uma única session.** Hoje só roda PRDs da `Project.forgeSourceSessionId` carregada; `setForgeSourceSession` exige `type === 'prd_session'` e `createForgeRunFromSession` falha com `"Project não tem session carregada na Forja."` se a lock está vazia (`src/lib/dal/forge-project.ts:724`). PRDs aprovados que nasceram de uma Inception/super/outra session ficam inacessíveis pra um run em batch.
2. **"done" da Forge mente pro PM.** O kanban classifica `runState === 'done'` como coluna "Concluído" (`forge/kanban/page.tsx:113`, hint "último run ok"). Mas "código entrou" é exatamente o momento em que o **gate de review do PM abre** — não é entregue. Não há coluna que diga "código pronto, PM precisa avaliar".
3. **Não existe lane de Produção.** `Sprint` tem `deployedToProductionAt`, mas `ProductRequirement`/`ForgeRun` não. O kanban da Forge não tem como mostrar "o que está em produção" — o usuário pediu isso explicitamente (plan §4.2).

---

## §2 — Solução em uma frase

Adicionar `createForgeRunFromProject(projectId, prdRefs[])` (snapshot project-scoped, sem `forgeSourceSessionId`), estender o endpoint de run pra aceitar `prdRefs`, ligar o botão **Enviar pra Forge**, auto-transicionar `deliveryStatus` `in_progress → review` quando um `ForgeRun` termina em `done`, e adicionar as colunas **Review** e **Production** (toggle manual de PM) no kanban.

---

## §3 — Não-objetivos

- **Não** mexer em downstream da execução (`ForgeJob`/daemon pickup, `verifiable` enforcement) — inalterado.
- **Não** trocar a SessionLoader UI por um seletor de backlog completo (isso é escopo do `projects-v2-area`; aqui só o botão host stub é ligado).
- **Não** implementar detecção automática de merge de PR pra produção (plan §12 Q4: default é toggle manual de PM).
- **Não** criar `deliveryStatus`/`deployedToProductionAt` columns — vêm de `projects-v2-schema`. Aqui só são **consumidas** e mutadas via trigger/endpoint.
- **Não** tocar Sprint Planning / capacidade de PRD (fase 3 do plan).

---

## §4 — Personas e jornada

- **PM (admin-pilot, João):** *"Aprovei 12 PRDs espalhados em 3 sessions. Quero selecionar os 5 desta sprint e mandar todos pra Forge de uma vez — sem ter que 'carregar uma session'. Quando a Forge termina, quero ver eles na coluna **Review** pra eu testar, não num 'Concluído' enganoso. E quando eu subir pra prod, marco e some pra coluna **Production**."*
- **Forge daemon (SISTEMA):** *"Recebo um `ForgeRun` com manifest snapshotado igual ao de hoje — não me importa se veio de session ou de project. Quando termino em `done`, o trigger já cuida de promover os PRDs cobertos pra `review`."*

---

## §5 — Decisões fixadas

| # | Decisão | Por quê |
|---|---------|---------|
| D1 | Nova DAL `createForgeRunFromProject(projectId, ownerId, prdRefs[])` em `forge-project.ts`, **sem** ler `forgeSourceSessionId` | D9 do plan: Forge aceita qualquer PRD aprovado do projeto |
| D2 | Fonte dos PRDs = `getPrdsForProject(projectId, { status: ['approved','ready'] })` (já existe em `product-requirements.ts:45`) | Reusa query project-scoped existente; sem novo SQL |
| D3 | `prdRefs[]` é **obrigatório e não-vazio** em `createForgeRunFromProject` (board sempre seleciona ≥1) | Run project-scoped é sempre explícito (multi-select / sprint), nunca "tudo" |
| D4 | Reusa `snapshotManifest(sentinelSessionId, prds)` inalterado; passa `sentinelSessionId = ""` (string vazia) como `sourceSessionId` do manifest | Manifest machinery imutável; project-run não tem session de origem |
| D5 | `ForgeRun.designSessionId` = `null` em project-run; `trigger = 'ad_hoc'` | Coluna já é nullable (`20260601l_forge_run_manifest.sql:33`); audit fica via manifest |
| D6 | Mesma validação FRS-004 (`story_without_verifiable`) que `createForgeRunFromSession` aplica | Mantém o gate de `verifiable` idêntico entre os dois caminhos |
| D7 | Endpoint **estende** `POST /api/forge/projects/[id]/runs`: se `body.prdRefs` é array não-vazio → **project-run** (`createForgeRunFromProject`); senão mantém o path session (`retryFailed`/session-run). **Sem** olhar `forgeSourceSessionId` | D9 do plano é desacoplar da session — o sinal é `prdRefs`, não a presença/ausência da lock. Um endpoint só; back-compat com session-run |
| D8 | Auto-transição `in_progress → review` via **extensão do trigger existente** `update_prd_last_run()` (`20260601_prd_last_run.sql`) numa migration nova aditiva | Trigger já roda no terminal `done` e já resolve os refs do manifest — reusa o mesmo `WHERE` |
| D9 | Auto-transição só dispara em `NEW.status = 'done'` (não `error`/`aborted`) e só quando `deliveryStatus = 'in_progress'` (não pisa em `done`/`changes_requested` manuais) | `done` = código entrou = abre review; falha não promove |
| D10 | Coluna **Review** no kanban = `deliveryStatus = 'review'`; **Production** = `deployedToProductionAt IS NOT NULL` (precede todas as outras regras) | Production é overlay terminal de PM sobre runState |
| D11 | Entrada em Production = **toggle manual de PM** via `POST /api/forge/projects/[id]/prds/[prdId]/production` (set/clear `deployedToProductionAt`) | plan §12 Q4 default = manual, sem detecção de merge |
| D12 | Gate de acesso de ambos endpoints = `hasMinAccessLevel(accessLevel, 'manager')`, igual ao endpoint de runs atual | Consistência com o resto da Forge API |

---

## §6 — Arquitetura

```
 Board (projects-v2-area)
   │  [Enviar pra Forge]  (multi-select / sprint)
   ▼
 POST /api/forge/projects/[id]/runs   { prdRefs: [...] }
   │
   ├─ body.prdRefs?.length  (project-run)
   │     └─► createForgeRunFromProject(projectId, ownerId, prdRefs)   ◄── NEW (forge-project.ts)
   │            getPrdsForProject(status approved|ready) → filtra prdRefs
   │            → snapshotManifest("", eligible)   (reusa, sourceSessionId="")
   │            → INSERT ForgeRun(status=queued, designSessionId=null, trigger=ad_hoc)
   │            → createJob(queued, assignToAnyone)
   │     202 { runId, jobId, prdCount }
   │
   └─ else → createForgeRunFromSession (path existente, inalterado)

 Forge daemon claims job → executa → UPDATE ForgeRun.status='done'
   │
   ▼  AFTER UPDATE OF status  (trigger)
 update_prd_last_run()            (existente: seta lastRun*)
 update_prd_delivery_on_done()    ◄── NEW trigger fn
   └─ NEW.status='done' → para cada PRD no manifest com deliveryStatus='in_progress':
        SET deliveryStatus='review'

 NEW kanban: projects-v2/[id]/forge/kanban/page.tsx  (admin-gated)
   import { COLUMNS, classifyPrd } from "src/lib/forge/classify-prd.ts"  ◄── NEW lib
   Production (deployedToProductionAt) ▸ Review (deliveryStatus='review') ▸ ... runState lanes
   │  (legacy projects/[id]/forge/kanban INTOCADO)
   └─ PM toggle ► POST /api/forge/projects/[id]/prds/[prdId]/production   ◄── NEW
```

Cada caixa nova é uma função/endpoint real: `createForgeRunFromProject` (DAL), `update_prd_delivery_on_done` (trigger fn), `POST .../runs` estendido, `POST .../prds/[prdId]/production` (endpoint novo), `classify-prd.ts` (lib nova: `COLUMNS`+`classifyPrd`), e a página nova `projects-v2/[id]/forge/kanban`. **As rotas de página vivem todas sob `projects-v2/`**; a `/api/forge/*` é infra compartilhada e é estendida no lugar.

---

## §7 — Schema (migration do delivery-status auto-transition, completa)

Migration atômica, aditiva, **não** recria o trigger de last-run (esse continua). Adiciona uma 2ª trigger function + trigger no mesmo evento `AFTER UPDATE OF status ON "ForgeRun"`. Roda via `psql "$DIRECT_URL" -f`.

**`supabase/migrations/20260604a_prd_delivery_on_run_done.sql`**

```sql
-- ProductRequirement.deliveryStatus auto-transition on Forge run terminal 'done'
--
-- Quando um ForgeRun termina em 'done' (código entrou), os PRDs cobertos pelo
-- manifest e que estão em deliveryStatus='in_progress' avançam pra 'review' —
-- o gate de avaliação do PM. NÃO promove em error/aborted, NÃO pisa em estados
-- manuais (done/changes_requested/in_production).
--
-- Pré-condição: ProductRequirement.deliveryStatus já existe (projects-v2-schema).
-- Convive com trg_forge_run_last_run (20260601_prd_last_run.sql), que continua.

BEGIN;

CREATE OR REPLACE FUNCTION update_prd_delivery_on_done() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'done'
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE "ProductRequirement" pr
    SET "deliveryStatus" = 'review'
    WHERE pr."projectId" = NEW."projectId"
      AND pr."deliveryStatus" = 'in_progress'
      AND pr.reference IN (
        SELECT prd->>'reference'
        FROM jsonb_array_elements(NEW.manifest->'prds') AS prd
        WHERE prd ? 'reference'
      );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_forge_run_delivery_review ON "ForgeRun";
CREATE TRIGGER trg_forge_run_delivery_review
  AFTER UPDATE OF status ON "ForgeRun"
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION update_prd_delivery_on_done();

COMMIT;
```

RLS: nenhuma policy nova — `ProductRequirement` mantém `prd_read`/`prd_write`; a trigger roda no contexto da connection do daemon (service role) que já muta `ForgeRun`. O endpoint de production toggle herda RLS via `ProductRequirement` write policy (managers / `can_edit_project`).

---

## §8 — APIs

| Método | Path | Body | Resposta |
|--------|------|------|----------|
| POST | `/api/forge/projects/[id]/runs` (estendido) | `{ prdRefs: string[] }` (project-run) · ou `{ retryFailed?: boolean }` / `{}` (session-run, inalterado) | `202 { runId, jobId, prdCount }` · `400 { error }` se nenhum PRD elegível / `story_without_verifiable` · `403` |
| POST | `/api/forge/projects/[id]/prds/[prdId]/production` (novo) | `{ deployed: boolean }` | `200 { id, deployedToProductionAt }` · `404` se PRD não pertence ao projeto · `403` |

**`POST .../runs` — contrato project-run (novo branch):**
```
Request:  POST /api/forge/projects/<pid>/runs
          { "prdRefs": ["WIKI-001", "WIKI-002"] }
Guard:    hasMinAccessLevel(accessLevel, "manager")  → senão 403
Branch:   if body.prdRefs?.length && !project.forgeSourceSessionId
            → createForgeRunFromProject({ projectId, ownerId: member.id, prdRefs })
Response: 202 { "runId": "<uuid>", "jobId": "<uuid>", "prdCount": 2 }
```

**`POST .../prds/[prdId]/production` — contrato:**
```
Request:  POST /api/forge/projects/<pid>/prds/<prdId>/production
          { "deployed": true }
Guard:    hasMinAccessLevel(accessLevel, "manager")  → senão 403
Effect:   UPDATE ProductRequirement
            SET deployedToProductionAt = (deployed ? now() : null)
            WHERE id = prdId AND projectId = pid    → 404 se não casar
Response: 200 { "id": "<prdId>", "deployedToProductionAt": "<iso|null>" }
```

`createForgeRunFromProject` é sempre async (envolve INSERT + job enqueue), retorna 202 + runId. Nenhum contrato muda entre fases.

---

## §9 — UX (kanban com colunas novas)

```
┌──────────┬─────────┬──────────┬─────────┬───────────┬──────────┬────────────┬───────────┐
│  Inbox   │ Pronto  │ Rodando  │ Falhou  │ Concluído │ Review   │ Production │ Arquivado │
│ draft/   │approved,│  em      │último   │ run ok    │ código   │ em prod    │superseded │
│ review   │ aguarda │ execução │run falh.│ (técnico) │ pronto,  │ (PM toggle)│           │
│          │  run    │          │         │           │ PM avalia│            │           │
├──────────┼─────────┼──────────┼─────────┼───────────┼──────────┼────────────┼───────────┤
│ ▢ PRD-12 │ ▢ PRD-3 │ ◌ PRD-7  │ ✗ PRD-9 │ ✓ PRD-4   │ ▣ PRD-5  │ ★ PRD-1    │ ▢ PRD-0   │
│          │ [Enviar │ (live)   │         │           │ [marcar  │            │           │
│          │ pra For-│          │         │           │  prod ★] │            │           │
│          │ ge]     │          │         │           │          │            │           │
└──────────┴─────────┴──────────┴─────────┴───────────┴──────────┴────────────┴───────────┘
```

- **Review** entra entre Concluído e Production: PRD com `deliveryStatus='review'` (auto após run `done`, ou manual pós Copy-run). Card mostra botão **marcar prod ★**.
- **Production** = `deployedToProductionAt` não-null; prevalece sobre qualquer outra classificação. Card mostra ★ + data.
- **Enviar pra Forge** (host do `projects-v2-area`) dispara `POST .../runs` com os `prdRefs` selecionados; multi-select = batch.

Este kanban é a **página nova** `src/app/(dashboard)/projects-v2/[id]/forge/kanban/page.tsx`,
admin-gated igual à área V2 (`getEffectiveAccessLevel` → `redirect('/projects')` se não-admin). A lógica
de coluna mora em `src/lib/forge/classify-prd.ts` (`COLUMNS` + `classifyPrd`), reusada pela página fina.
O kanban legado em `projects/[id]/forge/kanban` **não é tocado**.

`classifyPrd` ordem de precedência: `deployedToProductionAt` → `superseded` → `runState running/pending` → `runState failed` → `deliveryStatus='review'` → `runState done` → `draft/review` → `ready`.

---

## §10 — Integrações

- **`projects-v2-schema`**: consome `deliveryStatus` (`backlog|todo|in_progress|review|changes_requested|done|in_production`) e `deployedToProductionAt`/`deployedToStagingAt`. Esta feature **não** cria essas colunas.
- **`projects-v2-area`**: o botão **Enviar pra Forge** já existe como stub no board; aqui ele é ligado ao endpoint. O endpoint `/prds` que o kanban consome ganha os campos `deliveryStatus` + `deployedToProductionAt` no payload por-PRD.
- **Forge daemon**: nenhuma mudança — consome `ForgeRun.manifest` por `runId` igual hoje. A transição de `deliveryStatus` é puramente DB-side (trigger).
- **Forge tab atual (session-based)**: inalterada — o branch novo só ativa quando `prdRefs` vem no body; sem `prdRefs`, o endpoint segue o path session de hoje.

---

## §11 — Faseamento

Feature inteira é a **Fase 2** do plan ("Forge unlock + delivery status"). Entrega completa (mais que o sistema atual): além do run session-based existente, ganha run project-scoped, review gate e production lane. Sem sub-fases internas — as stories formam um DAG único.

---

## §12 — Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Trigger novo conflita/duplica efeito com `trg_forge_run_last_run` | Baixa | Médio | Função e trigger com nomes distintos (`update_prd_delivery_on_done` / `trg_forge_run_delivery_review`); ambos `AFTER UPDATE OF status`, idempotentes; `WHERE deliveryStatus='in_progress'` evita pisar estado manual |
| `prdRefs` aponta pra PRD não-aprovado ou de outra session | Média | Baixo | DAL filtra `getPrdsForProject(status approved\|ready)` ∩ `prdRefs`; se vazio → 400 com mensagem clara |
| Production toggle muta PRD de outro projeto | Baixa | Médio | `UPDATE ... WHERE id=prdId AND projectId=pid` → 404 se não casar; RLS write policy de `ProductRequirement` |
| Dependência `projects-v2-schema` ainda não rodou (coluna ausente) | Média | Alto | Story do trigger documenta a pré-condição; verifiable SQL falha cedo e claro se coluna não existe (Checkpoint humano) |
| `snapshotManifest` com `sourceSessionId=""` quebra consumidor | Baixa | Médio | Manifest só lê `manifest.prds[]` no daemon/trigger; `sourceSessionId` é metadado de audit, não consumido pra exec |

---

## §13 — Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Project-runs disparados (sem session) | `SELECT count(*) FROM "ForgeRun" WHERE "designSessionId" IS NULL AND trigger='ad_hoc' AND "createdAt" > now()-interval '7 days';` |
| PRDs que entraram em review via auto-transição | `SELECT count(*) FROM "ProductRequirement" WHERE "deliveryStatus"='review';` (delta antes/depois de um run `done`) |
| Latência review→production | `SELECT avg("deployedToProductionAt" - "updatedAt") FROM "ProductRequirement" WHERE "deployedToProductionAt" IS NOT NULL;` |
| Adoção do botão Enviar pra Forge | evento de POST 202 em `/api/forge/projects/[id]/runs` com `prdRefs` (log estruturado `[POST .../runs] project-run`) |
| Cobertura da lane Production | `SELECT count(*) FILTER (WHERE "deployedToProductionAt" IS NOT NULL) AS in_prod, count(*) AS total FROM "ProductRequirement" WHERE "projectId"=$1;` |

---

## §14 — Open questions

(vazio — todas as decisões fechadas em §5; Q4 do plan resolvido como toggle manual = D11.)

---

## §15 — Referências

- Plan: [docs/features/projects-v2/projects-v2-plan.md](../../features/projects-v2/projects-v2-plan.md) (§4.2, §5, D9)
- Código: [forge-project.ts](../../../src/lib/dal/forge-project.ts) (`createForgeRunFromSession`, `snapshotManifest`, `derivePrdRunInfo`) · [product-requirements.ts](../../../src/lib/dal/product-requirements.ts) (`getPrdsForProject`) · [run-state.ts](../../../src/lib/forge/run-state.ts) · [forge/kanban/page.tsx](../../../src/app/(dashboard)/projects/[id]/forge/kanban/page.tsx) (`classifyPrd`, `COLUMNS`) · [runs/route.ts](../../../src/app/api/forge/projects/[id]/runs/route.ts)
- Migrations: [20260601_prd_last_run.sql](../../../supabase/migrations/20260601_prd_last_run.sql) · [20260601l_forge_run_manifest.sql](../../../supabase/migrations/20260601l_forge_run_manifest.sql) · [20260516_forge_v1.sql](../../../supabase/migrations/20260516_forge_v1.sql)
- Memory: `project_forge_prd_consumption`, `project_forge_double_diamond`, `project_zordon_ops_pipeline`

---

## §16 — Stories implementáveis

```yaml
- id: PV2F-001
  title: Migration — auto-transição deliveryStatus on run done
  description: >
    Cria a trigger function update_prd_delivery_on_done() + trigger
    trg_forge_run_delivery_review (AFTER UPDATE OF status ON ForgeRun) que
    promove ProductRequirement.deliveryStatus 'in_progress'→'review' pros PRDs
    cobertos pelo manifest quando o run termina em 'done'. Convive com o
    trigger de last-run existente. Migration atômica via psql.
  acceptanceCriteria:
    - "supabase/migrations/20260604a_prd_delivery_on_run_done.sql existe com a DDL do §7"
    - "Função update_prd_delivery_on_done registrada em pg_proc"
    - "Trigger trg_forge_run_delivery_review registrado em ForgeRun (AFTER UPDATE OF status)"
    - "Atualizar um ForgeRun pra status='done' flipa deliveryStatus de PRDs in_progress cobertos pelo manifest pra 'review'"
    - "Não pisa em deliveryStatus já em done/changes_requested/in_production"
  verifiable:
    - kind: sql
      command_or_query: "source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql \"$DIRECT_URL\" -f supabase/migrations/20260604a_prd_delivery_on_run_done.sql"
      expected: "CREATE FUNCTION / CREATE TRIGGER (no error)"
    - kind: sql
      command_or_query: "SELECT tgname FROM pg_trigger WHERE tgrelid='\"ForgeRun\"'::regclass AND tgname='trg_forge_run_delivery_review';"
      expected: "trg_forge_run_delivery_review"
  dependsOn: []
  estimateMinutes: 25
  touches: [supabase/migrations/20260604a_prd_delivery_on_run_done.sql]

- id: PV2F-002
  title: SQL smoke — run done flipa deliveryStatus pra review
  description: >
    Check de follow-up do trigger: dentro de uma transação ROLLBACK, cria um
    ForgeRun queued com manifest cobrindo 1 PRD posto em deliveryStatus
    'in_progress', atualiza o run pra 'done', e verifica que o PRD virou
    'review'. Não persiste (ROLLBACK ao fim). Roda só após PV2F-001 aplicado.
  acceptanceCriteria:
    - "Query transacional sobe ForgeRun done e lê deliveryStatus='review' do PRD coberto"
    - "PRD com deliveryStatus='done' NÃO é alterado pelo mesmo run"
    - "Transação faz ROLLBACK (sem efeito colateral no banco)"
  verifiable:
    - kind: sql
      command_or_query: "source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql \"$DIRECT_URL\" -v ON_ERROR_STOP=1 <<'SQL'\nBEGIN;\nWITH proj AS (SELECT id, \"ownerId\" FROM \"ForgeRun\" LIMIT 1)\nSELECT 1;\nWITH pr AS (\n  UPDATE \"ProductRequirement\" SET \"deliveryStatus\"='in_progress'\n  WHERE id=(SELECT id FROM \"ProductRequirement\" LIMIT 1)\n  RETURNING id, reference, \"projectId\"\n), run AS (\n  INSERT INTO \"ForgeRun\"(id,\"projectId\",\"ownerId\",title,status,trigger,manifest)\n  SELECT gen_random_uuid(), pr.\"projectId\", (SELECT id FROM \"Member\" LIMIT 1), 't','queued','ad_hoc',\n    jsonb_build_object('prds', jsonb_build_array(jsonb_build_object('reference', pr.reference)))\n  FROM pr RETURNING id\n)\nUPDATE \"ForgeRun\" SET status='done' WHERE id=(SELECT id FROM run);\nSELECT \"deliveryStatus\" FROM \"ProductRequirement\" WHERE id=(SELECT id FROM \"ProductRequirement\" WHERE \"deliveryStatus\"='review' LIMIT 1);\nROLLBACK;\nSQL"
      expected: "review"
  dependsOn: [PV2F-001]
  estimateMinutes: 20
  touches: []

- id: PV2F-003
  title: DAL — createForgeRunFromProject
  description: >
    Adiciona createForgeRunFromProject({ projectId, ownerId, prdRefs }) em
    forge-project.ts. Lê getPrdsForProject(projectId,{status:['approved','ready']}),
    filtra pelo prdRefs (não-vazio obrigatório), aplica a mesma validação
    story_without_verifiable do path session, chama snapshotManifest("", eligible),
    insere ForgeRun(status='queued', designSessionId=null, trigger='ad_hoc',
    manifest, repoUrl=Project.repoUrl) e cria ForgeJob queued. Retorna
    { runId, jobId, prdCount }.
  acceptanceCriteria:
    - "forge-project.ts exporta createForgeRunFromProject"
    - "Não referencia project.forgeSourceSessionId no novo caminho"
    - "Usa getPrdsForProject + snapshotManifest existentes (reuso)"
    - "Lança erro claro se prdRefs vazio ou nenhum PRD aprovado casa"
    - "Aplica o gate story_without_verifiable idêntico ao path session"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'forge-project' || echo no-errors"
      expected: "no-errors"
    - kind: lint
      command_or_query: "grep -cE 'export async function createForgeRunFromProject' src/lib/dal/forge-project.ts"
      expected: "1"
    - kind: lint
      command_or_query: "grep -c 'getPrdsForProject' src/lib/dal/forge-project.ts"
      expected: ">=1"
  dependsOn: []
  estimateMinutes: 30
  touches: [src/lib/dal/forge-project.ts]

- id: PV2F-004
  title: API — POST runs aceita prdRefs (project-run)
  description: >
    Estende src/app/api/forge/projects/[id]/runs/route.ts: se body.prdRefs é
    array não-vazio, chama createForgeRunFromProject e retorna 202 { runId,
    jobId, prdCount } — sem olhar forgeSourceSessionId (D7). Caso contrário
    mantém o path createForgeRunFromSession (retryFailed/prdRefsFilter
    existentes). Guard manager inalterado.
  acceptanceCriteria:
    - "route.ts importa e chama createForgeRunFromProject quando body.prdRefs é não-vazio"
    - "Branch project-run NÃO depende de forgeSourceSessionId"
    - "Retorna 202 com { runId } quando prdRefs passado"
    - "Mantém back-compat com retryFailed e session-run"
    - "Guard hasMinAccessLevel(manager) preservado"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'forge/projects/\\[id\\]/runs' || echo no-errors"
      expected: "no-errors"
    - kind: lint
      command_or_query: "grep -c 'createForgeRunFromProject' 'src/app/api/forge/projects/[id]/runs/route.ts'"
      expected: ">=1"
    - kind: http
      command_or_query: "curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3000/api/forge/projects/<pid>/runs -H 'Content-Type: application/json' -d '{\"prdRefs\":[\"<REF>\"]}' (autenticado como manager, projeto sem session, ≥1 PRD aprovado)"
      expected: "202"
  dependsOn: [PV2F-003]
  estimateMinutes: 25
  touches: ["src/app/api/forge/projects/[id]/runs/route.ts"]

- id: PV2F-005
  title: API — POST production toggle
  description: >
    Cria src/app/api/forge/projects/[id]/prds/[prdId]/production/route.ts.
    POST { deployed: boolean } seta ProductRequirement.deployedToProductionAt =
    (deployed ? now() : null) WHERE id=prdId AND projectId=id. Guard manager.
    404 se PRD não pertence ao projeto. Retorna 200 { id, deployedToProductionAt }.
  acceptanceCriteria:
    - "route.ts existe com handler POST"
    - "UPDATE filtra por id AND projectId (404 se não casar)"
    - "deployed=true seta now(); deployed=false seta null"
    - "Guard hasMinAccessLevel(manager)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'prds/\\[prdId\\]/production' || echo no-errors"
      expected: "no-errors"
    - kind: lint
      command_or_query: "grep -cE 'export (async )?function POST' 'src/app/api/forge/projects/[id]/prds/[prdId]/production/route.ts'"
      expected: "1"
    - kind: lint
      command_or_query: "grep -c 'deployedToProductionAt' 'src/app/api/forge/projects/[id]/prds/[prdId]/production/route.ts'"
      expected: ">=1"
  dependsOn: []
  estimateMinutes: 25
  touches: ["src/app/api/forge/projects/[id]/prds/[prdId]/production/route.ts"]

- id: PV2F-006
  title: API — prds payload expõe deliveryStatus + deployedToProductionAt
  description: >
    Estende src/app/api/forge/projects/[id]/prds/route.ts: cada PrdLine inclui
    deliveryStatus e deployedToProductionAt lidos do ProductRequirement row,
    pra o kanban classificar Review/Production no client.
  acceptanceCriteria:
    - "Tipo PrdLine ganha deliveryStatus: string e deployedToProductionAt: string|null"
    - "Cada item do payload popula esses campos do row"
    - "tsc passa"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'forge/projects/\\[id\\]/prds' || echo no-errors"
      expected: "no-errors"
    - kind: lint
      command_or_query: "grep -cE 'deliveryStatus|deployedToProductionAt' 'src/app/api/forge/projects/[id]/prds/route.ts'"
      expected: ">=2"
  dependsOn: []
  estimateMinutes: 20
  touches: ["src/app/api/forge/projects/[id]/prds/route.ts"]

- id: PV2F-007
  title: classify-prd.ts (lib) + página nova projects-v2/[id]/forge/kanban
  description: >
    Extrai a lógica de coluna pra src/lib/forge/classify-prd.ts: tipo ColumnKey
    (com 'review' e 'production'), COLUMNS (Review entre done e archived;
    Production após review), tipo PrdItem com deliveryStatus + deployedToProductionAt,
    e classifyPrd com a precedência do §9 (production prevalece, depois superseded,
    runState running/failed, deliveryStatus review, runState done, …). Cria a página
    nova admin-gated src/app/(dashboard)/projects-v2/[id]/forge/kanban/page.tsx que
    importa COLUMNS+classifyPrd e renderiza as lanes. NÃO toca o kanban legado.
  acceptanceCriteria:
    - "src/lib/forge/classify-prd.ts exporta COLUMNS, classifyPrd, ColumnKey, PrdItem"
    - "ColumnKey inclui 'review' e 'production'; classifyPrd retorna 'production' quando deployedToProductionAt não-null (precede tudo) e 'review' quando deliveryStatus==='review'"
    - "src/app/(dashboard)/projects-v2/[id]/forge/kanban/page.tsx existe, admin-gated (redirect /projects se não-admin), importando de classify-prd.ts"
    - "O arquivo legado projects/[id]/forge/kanban/page.tsx NÃO é modificado"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'classify-prd|projects-v2/\\[id\\]/forge/kanban' || echo no-errors"
      expected: "no-errors"
    - kind: lint
      command_or_query: "grep -cE \"'review'|'production'\" src/lib/forge/classify-prd.ts"
      expected: ">=2"
    - kind: lint
      command_or_query: "grep -c 'classify-prd' 'src/app/(dashboard)/projects-v2/[id]/forge/kanban/page.tsx'"
      expected: ">=1"
  dependsOn: [PV2F-006]
  estimateMinutes: 30
  touches:
    - "src/lib/forge/classify-prd.ts"
    - "src/app/(dashboard)/projects-v2/[id]/forge/kanban/page.tsx"

- id: PV2F-008
  title: Kanban v2 — botão "marcar prod" no card de Review
  description: >
    No card do kanban v2, quando columnKey==='review', renderiza um botão
    "marcar prod ★" que faz POST /api/forge/projects/[id]/prds/[prdId]/production
    { deployed:true } e refaz o load. Card de Production mostra ★ + data
    (deployedToProductionAt).
  acceptanceCriteria:
    - "Card em Review tem botão que chama o endpoint production com deployed:true"
    - "Card em Production renderiza indicador ★ com a data"
    - "tsc + lint passam"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'projects-v2/\\[id\\]/forge/kanban' || echo no-errors"
      expected: "no-errors"
    - kind: lint
      command_or_query: "grep -c 'production' 'src/app/(dashboard)/projects-v2/[id]/forge/kanban/page.tsx'"
      expected: ">=1"
  dependsOn: [PV2F-007]
  estimateMinutes: 25
  touches: ["src/app/(dashboard)/projects-v2/[id]/forge/kanban/page.tsx"]

- id: PV2F-009
  title: Wire "Enviar pra Forge" no board → POST runs
  description: >
    Liga o botão host stub Enviar pra Forge (do projects-v2-area) ao endpoint:
    coleta os prdRefs (references) dos PRDs selecionados / da sprint e faz
    POST /api/forge/projects/[id]/runs { prdRefs }. Sucesso → toast com runId +
    refetch. Erro → showErrorToast.
  acceptanceCriteria:
    - "Handler do botão monta prdRefs e faz POST .../runs"
    - "Sucesso mostra feedback (toast) com runId; erro via showErrorToast"
    - "Multi-select envia N refs num único run (batch)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'projects-v2' || echo no-errors"
      expected: "no-errors"
    - kind: manual_browser
      command_or_query: "Como admin, em projects-v2 board de um projeto sem session carregada e com ≥2 PRDs aprovados: selecionar 2 PRDs, clicar Enviar pra Forge. Validar: toast com runId, run aparece queued, PRDs entram em in_progress."
      expected: "Run criado (202) + PRDs selecionados no run"
  dependsOn: [PV2F-004]
  estimateMinutes: 30
  touches: ["src/components/projects-v2/board-forge-button.tsx"]

- id: PV2F-010
  title: Smoke browser — kanban Review/Production visíveis e funcionais
  description: >
    Validação visual ponta-a-ponta do kanban estendido: as colunas Review e
    Production renderizam, um run terminado move o PRD pra Review, e o toggle
    manual move pra Production.
  acceptanceCriteria:
    - "Colunas Review e Production aparecem no kanban"
    - "PRD com deliveryStatus='review' cai na coluna Review"
    - "Clicar 'marcar prod ★' move o PRD pra Production e persiste após reload"
  verifiable:
    - kind: manual_browser
      command_or_query: "Abrir /projects-v2/<id>/forge/kanban como admin. Confirmar colunas Review + Production. Num PRD de Review, clicar marcar prod ★ e recarregar."
      expected: "PRD aparece em Production com ★ + data após reload"
    - kind: lint
      command_or_query: "grep -cE 'Review|Production' src/lib/forge/classify-prd.ts"
      expected: ">=2"
  dependsOn: [PV2F-008]
  estimateMinutes: 20
  touches: ["src/app/(dashboard)/projects-v2/[id]/forge/kanban/page.tsx"]
```
