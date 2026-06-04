# PRD — Projects V2 · Schema foundation (`projects-v2-schema`)

> **Status:** backlog (Rito 1 não rodou) · **Owner:** João · **Created:** 2026-06-04 · **id prefix:** `PV2S`
> **Depends on:** nada — esta é a fundação de Projects V2, roda primeiro.
> **Spec-mãe:** [docs/features/projects-v2/projects-v2-plan.md](../../features/projects-v2/projects-v2-plan.md) §3.3, §4.2, §10.

Este PRD implementa **apenas as mudanças de schema** que destravam Projects V2 (a área PRD-native
descrita no plano). Nada de UI, endpoint ou agente aqui — só migrations atômicas em
`supabase/migrations/` + atualização manual de `src/lib/supabase/database.types.ts`. As fases de
board/Forge/planning consomem estas colunas em PRDs posteriores.

---

## §1 — Problema

Três lacunas concretas, todas rastreadas no plano:

1. **PRD não tem pai Spec nem sprint.** `ProductRequirement` hoje só liga a `Project`, `Module` e
   `DesignSession` ([20260530c_product_requirement.sql](../../../supabase/migrations/20260530c_product_requirement.sql)
   §1). O plano (§3.2/D2/D5) exige árvore **Spec → PRD** dentro de **Sprint**, mas não existe
   `userStoryId` (Spec pai) nem `sprintId` no PRD — a única ponte pra sprint é via `Task`
   (plano §3.3, linha "no direct link today (only via Task)").
2. **PRD não tem eixo de board (delivery) nem lanes de deploy.** O plano §4 descreve dois status
   independentes; o de autoria (`draft→review→approved→superseded`) já existe, mas o de **delivery**
   (`backlog→todo→in_progress→review→changes_requested→done→in_production`) e os carimbos
   `deployedToStagingAt/deployedToProductionAt` (mirror de `Sprint`) **não existem** no PRD
   (plano §4.2, "ProductRequirement/ForgeRun do not").
3. **Capacidade de sprint e responsáveis não fecham no nível PRD.** O widget de capacidade soma
   function points de `Task` (plano §6, "capacity gap") e não há tabela de assignees por PRD
   (plano §3.3, linhas "PRD estimate/FP" e "PRD assignees" marcadas ❌ new).

---

## §2 — Solução em uma frase

Estender `ProductRequirement` com as colunas de árvore (Spec/sprint), board (delivery status +
deploy timestamps + estimativa FP), proveniência (`originType`) e uma join table de assignees, em
migrations atômicas com RLS, mantendo o tipo TS em dia.

---

## §3 — Não-objetivos

- **Sem UI.** Nenhuma rota `projects-v2/`, board, side sheet ou kanban (Fase 1+ do plano, outros PRDs).
- **Sem endpoints.** Nenhuma API nova (ver §8).
- **Sem mudança no Forge.** `createForgeRunFromProject`, Send-to-Forge, auto-transition de delivery
  status ficam pra Fase 2 do plano.
- **Sem tool de agente.** `propose_spec`, `ensure_sprint_prd_session`, summon Vitoria→Vitor — Fase 4.
- **Sem coluna `subKind = vitoria_ask`.** `DesignSession.subKind` **já existe**
  ([20260601c_prd_session_subkind.sql](../../../supabase/migrations/20260601c_prd_session_subkind.sql));
  é coluna text livre, então o valor `vitoria_ask` não precisa de migration (decisão D6 abaixo).
- **Sem tornar `designSessionId` nullable.** Já é nullable (`ON DELETE SET NULL`, sem `NOT NULL`) na
  migration original — nada a fazer (decisão D7).
- **Sem nova FK de ceremony no PRD.** Linkagem de origem-cerimônia reusa `EntityLink.planningCeremonyId`
  já existente (decisão D8).
- **Sem CHECK xor `userStoryId`/`productRequirementId` em `Task`.** Coexistência preservada (plano nota
  na migration original §3).

---

## §4 — Personas e jornada

- **João (admin, PM-piloto):** *"Quero arrastar um PRD pra dentro de uma sprint e ver a capacidade
  fechar — hoje o PRD nem sabe em que sprint está."* → precisa de `sprintId` + `estimateFp`.
- **Vitor (agente autor):** *"Sempre crio o PRD dentro de um Spec; o banco tem que aceitar o pai."* →
  precisa de `userStoryId`.
- **Vitoria (agente PM-copiloto):** *"Quando eu carrego o board, preciso saber em que coluna o PRD está
  (review? em produção?) e quem é o responsável."* → precisa de `deliveryStatus`, deploy timestamps,
  `ProductRequirementAssignee`.
- **Sistema (Forge/trigger):** *"Ao terminar um run, viro o PRD pra `review` — preciso da coluna pra
  escrever."* → `deliveryStatus` existir é pré-requisito (a transição em si é Fase 2).

---

## §5 — Decisões fixadas

| Dn | Decisão | Por quê |
|----|---------|---------|
| D1 | `userStoryId` é FK nullable → `UserStory(id)` `ON DELETE SET NULL`, com índice `prd_user_story_idx`. | Spec é o pai (plano D2/D14); nullable porque PRDs legados não têm Spec ainda; `SET NULL` evita derrubar PRD se o Spec sumir. |
| D2 | `sprintId` é FK nullable → `Sprint(id)` `ON DELETE SET NULL`, com índice `prd_sprint_idx`. | PRD vive numa sprint (plano D5); nullable = ainda no backlog; `SET NULL` devolve ao backlog se a sprint for apagada, não deleta o PRD. |
| D3 | `deliveryStatus` é `text NOT NULL DEFAULT 'backlog'` com CHECK no conjunto exato do plano §4.2 (`backlog,todo,in_progress,review,changes_requested,done,in_production`). | Reusa o vocabulário de `Task` pra reaproveitar `StatusChipSelect` (plano §4.2); `text+CHECK` (não enum nativo) segue o padrão da própria `ProductRequirement.status`. |
| D4 | `deployedToStagingAt`/`deployedToProductionAt` são `timestamptz NULL`, espelhando os mesmos campos de `Sprint`. | Mirror explícito pedido no plano §4.2/§10.4; null = não deployado. |
| D5 | Capacidade usa `estimateFp numeric NULL` (não minutos). | Capacity widget hoje soma **function points** de Task (plano §6); manter a mesma unidade evita reescrever a matemática. |
| D6 | `subKind = vitoria_ask` **não** vira migration. | `DesignSession.subKind` já é `text` livre (20260601c); novos valores não exigem schema. Plano §3.3 marca como ❌ new, mas a verificação mostra que a coluna já existe — então é decisão-de-valor, não de schema. |
| D7 | `ProductRequirement.designSessionId` **não** muda. | Já é nullable na migration original (sem `NOT NULL`); §10.7 do plano pedia "make nullable" mas já está satisfeito. |
| D8 | Origem-cerimônia reusa `EntityLink.planningCeremonyId`; PRD ganha só `originType text NULL` (discovery\|ceremony\|board\|spec_decomposition). | `EntityLink` já liga host `planningCeremonyId` (20260601o) e o ref-side dele não suporta PRD diretamente; a lineage do plano §7.3 é `PRD.designSessionId → session → EntityLink → ceremony`, então uma FK `originRitualId` nova seria redundante. `originType` só rotula a proveniência. |
| D9 | `ProductRequirementAssignee` é join table (`productRequirementId`,`memberId`, PK composta) com FKs CASCADE/CASCADE. | Assignees N:N (plano §3.3); CASCADE em ambos limpa órfãos quando PRD ou Member somem. |
| D10 | RLS da join table espelha as policies `prd_read`/`prd_write` de `ProductRequirement`. | Consistência com a tabela-mãe (plano §10.8): leitura por quem vê o projeto, escrita manager-only (fallback `can_edit_project` ainda não existe no Postgres, igual à migration original). |
| D11 | Cada coluna/objeto numa migration atômica própria, datada `20260604<letra>_*.sql`, rodada via `psql "$DIRECT_URL" -f`. | Regra AGENTS.md (migrations atômicas, rollback granular). |
| D12 | `database.types.ts` é atualizado **à mão** numa story final, validada por `tsc`. | Regra AGENTS.md (após migration, refletir no types). |

Todas as decisões estão fechadas — nenhuma pendência em aberto.

---

## §6 — Arquitetura

```
ProductRequirement (tabela existente, estendida)
 ├─ userStoryId        ──FK──►  UserStory   (Spec pai)            [PV2S-001]
 ├─ sprintId           ──FK──►  Sprint      (container)           [PV2S-002]
 ├─ deliveryStatus     text+CHECK (board axis)                    [PV2S-003]
 ├─ deployedToStagingAt / deployedToProductionAt (deploy lanes)   [PV2S-004]
 ├─ estimateFp         numeric (sprint capacity)                  [PV2S-005]
 └─ originType         text (discovery|ceremony|board|spec_decomposition) [PV2S-006]

ProductRequirementAssignee (tabela nova)                          [PV2S-007]
 ├─ productRequirementId ──FK──► ProductRequirement
 ├─ memberId             ──FK──► Member
 └─ PK (productRequirementId, memberId) + RLS (prd_read/prd_write style)

src/lib/supabase/database.types.ts  ◄── atualizado à mão          [PV2S-008]
```

Cada caixa = um objeto de schema real numa migration própria. `EntityLink.planningCeremonyId`
(existente) cobre a lineage de cerimônia sem schema novo (D8).

---

## §7 — Schema (DDL completo)

Cada bloco é **uma migration atômica** num arquivo próprio. Todos rodam com
`source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql "$DIRECT_URL" -f <arquivo>`.

### `20260604a_prd_user_story_id.sql` — PV2S-001
```sql
ALTER TABLE public."ProductRequirement"
  ADD COLUMN IF NOT EXISTS "userStoryId" uuid
    REFERENCES public."UserStory"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS prd_user_story_idx
  ON public."ProductRequirement"("userStoryId");
```

### `20260604b_prd_sprint_id.sql` — PV2S-002
```sql
ALTER TABLE public."ProductRequirement"
  ADD COLUMN IF NOT EXISTS "sprintId" uuid
    REFERENCES public."Sprint"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS prd_sprint_idx
  ON public."ProductRequirement"("sprintId");
```

### `20260604c_prd_delivery_status.sql` — PV2S-003
```sql
ALTER TABLE public."ProductRequirement"
  ADD COLUMN IF NOT EXISTS "deliveryStatus" text NOT NULL DEFAULT 'backlog';

ALTER TABLE public."ProductRequirement"
  DROP CONSTRAINT IF EXISTS prd_delivery_status_check;

ALTER TABLE public."ProductRequirement"
  ADD CONSTRAINT prd_delivery_status_check
  CHECK ("deliveryStatus" IN
    ('backlog','todo','in_progress','review','changes_requested','done','in_production'));

CREATE INDEX IF NOT EXISTS prd_delivery_status_idx
  ON public."ProductRequirement"("deliveryStatus");
```

### `20260604d_prd_deploy_timestamps.sql` — PV2S-004
```sql
ALTER TABLE public."ProductRequirement"
  ADD COLUMN IF NOT EXISTS "deployedToStagingAt"    timestamptz,
  ADD COLUMN IF NOT EXISTS "deployedToProductionAt" timestamptz;
```

### `20260604e_prd_estimate_fp.sql` — PV2S-005
```sql
ALTER TABLE public."ProductRequirement"
  ADD COLUMN IF NOT EXISTS "estimateFp" numeric;
```

### `20260604f_prd_origin_type.sql` — PV2S-006
```sql
ALTER TABLE public."ProductRequirement"
  ADD COLUMN IF NOT EXISTS "originType" text;

ALTER TABLE public."ProductRequirement"
  DROP CONSTRAINT IF EXISTS prd_origin_type_check;

ALTER TABLE public."ProductRequirement"
  ADD CONSTRAINT prd_origin_type_check
  CHECK ("originType" IS NULL OR "originType" IN
    ('discovery','ceremony','board','spec_decomposition'));
```

### `20260604g_product_requirement_assignee.sql` — PV2S-007
```sql
CREATE TABLE IF NOT EXISTS public."ProductRequirementAssignee" (
  "productRequirementId" uuid NOT NULL
    REFERENCES public."ProductRequirement"(id) ON DELETE CASCADE,
  "memberId" uuid NOT NULL
    REFERENCES public."Member"(id) ON DELETE CASCADE,
  "assignedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_requirement_assignee_pkey
    PRIMARY KEY ("productRequirementId", "memberId")
);

CREATE INDEX IF NOT EXISTS pra_member_idx
  ON public."ProductRequirementAssignee"("memberId");

ALTER TABLE public."ProductRequirementAssignee" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pra_read  ON public."ProductRequirementAssignee";
DROP POLICY IF EXISTS pra_write ON public."ProductRequirementAssignee";

-- Read: espelha prd_read (quem vê o projeto do PRD enxerga os assignees)
CREATE POLICY pra_read ON public."ProductRequirementAssignee"
  FOR SELECT
  USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."ProductRequirement" p
      WHERE p.id = "productRequirementId"
        AND public.can_view_project(p."projectId")
    )
  );

-- Write: espelha prd_write (fallback manager-only — can_edit_project ainda não
-- existe no Postgres, idêntico à policy prd_write da tabela-mãe)
CREATE POLICY pra_write ON public."ProductRequirementAssignee"
  FOR ALL
  USING  (public.is_manager())
  WITH CHECK (public.is_manager());
```

Rollback (cada um isolado): `ALTER TABLE ... DROP COLUMN ...` / `DROP TABLE public."ProductRequirementAssignee" CASCADE;`.

---

## §8 — APIs

**Sem endpoints novos — apenas schema.** Nenhuma rota em `src/app/api/**` é criada ou alterada por
este PRD. Os consumidores (board, Forge, planning) chegam em PRDs posteriores das Fases 1–4 do plano.

---

## §9 — UX

**Sem UX.** Nenhuma tela. As colunas existem pra serem lidas pela UI de Projects V2 (Fase 1 do plano,
outro PRD). Wireframe da árvore alvo (referência, não construído aqui):

```
Sprint ───────────────────────────────
 ├─ [PRD card]  deliveryStatus chip · assignees · estimateFp
 └─ [PRD card]
Spec (UserStory) ── collapsible ───────
 ├─ [PRD]  (userStoryId aponta aqui)
 └─ [PRD]
```

---

## §10 — Integrações

- **Sprint:** PRD passa a referenciar `Sprint(id)`; deploy timestamps espelham os de `Sprint`.
- **UserStory (Spec):** PRD ganha pai via `userStoryId`.
- **EntityLink:** lineage de cerimônia continua via `planningCeremonyId` (host existente); nenhuma
  alteração na `EntityLink`.
- **Member:** assignees via join table.
- **Forge:** nenhuma mudança agora; `deliveryStatus` será escrito por trigger/DAL na Fase 2.

---

## §11 — Faseamento

Este PRD **é** a Fase 1 do plano (item "Schema" de §11), recortada pra rodar sozinha. Entrega 100%
das migrations §10.1–§10.6 do plano + a join table de assignees + types atualizado. Entrega **mais**
que o estado atual (hoje PRD não tem nenhuma destas colunas) e nada menos. Fases seguintes (board,
Forge, planning, autoria) consomem estas colunas em PRDs próprios e dependem deste.

---

## §12 — Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| CHECK de `deliveryStatus` quebra INSERT de PRD legado sem o campo | Baixa | Médio | `DEFAULT 'backlog'` garante valor válido em toda linha existente e nova |
| `database.types.ts` desincronizado com o schema | Média | Médio | Story final dedicada (PV2S-008) + `tsc --noEmit` como verifiable |
| Nome de índice/constraint colide com objeto existente | Baixa | Baixo | `IF NOT EXISTS` / `DROP CONSTRAINT IF EXISTS` em cada migration |
| Policy da join table mais frouxa que a do PRD | Baixa | Alto | `pra_read`/`pra_write` copiam exatamente `prd_read`/`prd_write` (manager-only write) |
| Migration roda parcial e deixa estado inconsistente | Baixa | Médio | Cada arquivo é atômico (1 objeto) e idempotente; reexecução é segura |

---

## §13 — Métricas de sucesso

Cada métrica com instrumento SQL (rodar via `psql "$DIRECT_URL"`):

1. **Todas as 6 colunas novas existem em `ProductRequirement`.**
   ```sql
   SELECT count(*) FROM information_schema.columns
   WHERE table_name='ProductRequirement'
     AND column_name IN ('userStoryId','sprintId','deliveryStatus',
       'deployedToStagingAt','deployedToProductionAt','estimateFp','originType');
   -- esperado: 7
   ```
2. **`deliveryStatus` tem default e CHECK corretos.**
   ```sql
   SELECT column_default FROM information_schema.columns
   WHERE table_name='ProductRequirement' AND column_name='deliveryStatus';
   -- esperado: 'backlog'::text
   ```
3. **Join table existe com RLS ligada.**
   ```sql
   SELECT relrowsecurity FROM pg_class WHERE relname='ProductRequirementAssignee';
   -- esperado: t
   ```
4. **Type-safety preservada.**
   ```sql
   -- instrumento: npx tsc --noEmit  → 0 erros (proxy de database.types.ts em dia)
   ```

---

## §14 — Open questions

Nenhuma bloqueante. (Q2–Q6 do plano são de produto/UX e endereçadas em fases posteriores; não afetam
o schema.)

---

## §15 — Referências

- Plano: [docs/features/projects-v2/projects-v2-plan.md](../../features/projects-v2/projects-v2-plan.md)
- Schema atual do PRD: [20260530c_product_requirement.sql](../../../supabase/migrations/20260530c_product_requirement.sql)
- `subKind` existente: [20260601c_prd_session_subkind.sql](../../../supabase/migrations/20260601c_prd_session_subkind.sql)
- `EntityLink`: [20260601o_entitylink_create.sql](../../../supabase/migrations/20260601o_entitylink_create.sql)
- Types: [src/lib/supabase/database.types.ts](../../../src/lib/supabase/database.types.ts)
- House style: [docs/prd/ready/prd-opportunities.md](../ready/prd-opportunities.md)

---

## §16 — Stories implementáveis

```yaml
- id: PV2S-001
  title: Migration — ProductRequirement.userStoryId (FK Spec pai)
  description: Adiciona userStoryId uuid FK→UserStory nullable ON DELETE SET NULL + índice prd_user_story_idx.
  acceptanceCriteria:
    - "Arquivo supabase/migrations/20260604a_prd_user_story_id.sql existe"
    - "psql roda sem erro"
    - "Coluna userStoryId existe em ProductRequirement"
    - "Índice prd_user_story_idx existe"
  verifiable:
    - kind: sql
      command_or_query: "source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql \"$DIRECT_URL\" -f supabase/migrations/20260604a_prd_user_story_id.sql"
      expected: "ALTER TABLE (no error)"
    - kind: sql
      command_or_query: "SELECT column_name FROM information_schema.columns WHERE table_name='ProductRequirement' AND column_name='userStoryId';"
      expected: "userStoryId"
  dependsOn: []
  estimateMinutes: 15
  touches: [supabase/migrations/20260604a_prd_user_story_id.sql]

- id: PV2S-002
  title: Migration — ProductRequirement.sprintId (FK Sprint)
  description: Adiciona sprintId uuid FK→Sprint nullable ON DELETE SET NULL + índice prd_sprint_idx.
  acceptanceCriteria:
    - "Arquivo supabase/migrations/20260604b_prd_sprint_id.sql existe"
    - "psql roda sem erro"
    - "Coluna sprintId existe em ProductRequirement"
    - "Índice prd_sprint_idx existe"
  verifiable:
    - kind: sql
      command_or_query: "source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql \"$DIRECT_URL\" -f supabase/migrations/20260604b_prd_sprint_id.sql"
      expected: "ALTER TABLE (no error)"
    - kind: sql
      command_or_query: "SELECT column_name FROM information_schema.columns WHERE table_name='ProductRequirement' AND column_name='sprintId';"
      expected: "sprintId"
  dependsOn: []
  estimateMinutes: 15
  touches: [supabase/migrations/20260604b_prd_sprint_id.sql]

- id: PV2S-003
  title: Migration — ProductRequirement.deliveryStatus (board axis)
  description: Adiciona deliveryStatus text NOT NULL default 'backlog' + CHECK no conjunto do plano §4.2 + índice.
  acceptanceCriteria:
    - "Arquivo supabase/migrations/20260604c_prd_delivery_status.sql existe"
    - "psql roda sem erro"
    - "CHECK prd_delivery_status_check existe com os 7 valores"
    - "Default é 'backlog'"
  verifiable:
    - kind: sql
      command_or_query: "source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql \"$DIRECT_URL\" -f supabase/migrations/20260604c_prd_delivery_status.sql"
      expected: "ALTER TABLE (no error)"
    - kind: sql
      command_or_query: "SELECT column_default FROM information_schema.columns WHERE table_name='ProductRequirement' AND column_name='deliveryStatus';"
      expected: "'backlog'::text"
  dependsOn: []
  estimateMinutes: 20
  touches: [supabase/migrations/20260604c_prd_delivery_status.sql]

- id: PV2S-004
  title: Migration — ProductRequirement deploy timestamps
  description: Adiciona deployedToStagingAt e deployedToProductionAt timestamptz null (mirror de Sprint).
  acceptanceCriteria:
    - "Arquivo supabase/migrations/20260604d_prd_deploy_timestamps.sql existe"
    - "psql roda sem erro"
    - "Ambas colunas existem e são nullable"
  verifiable:
    - kind: sql
      command_or_query: "source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql \"$DIRECT_URL\" -f supabase/migrations/20260604d_prd_deploy_timestamps.sql"
      expected: "ALTER TABLE (no error)"
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.columns WHERE table_name='ProductRequirement' AND column_name IN ('deployedToStagingAt','deployedToProductionAt');"
      expected: "2"
  dependsOn: []
  estimateMinutes: 12
  touches: [supabase/migrations/20260604d_prd_deploy_timestamps.sql]

- id: PV2S-005
  title: Migration — ProductRequirement.estimateFp (sprint capacity)
  description: Adiciona estimateFp numeric null pra somar capacidade de sprint no nível PRD.
  acceptanceCriteria:
    - "Arquivo supabase/migrations/20260604e_prd_estimate_fp.sql existe"
    - "psql roda sem erro"
    - "Coluna estimateFp existe com data_type numeric"
  verifiable:
    - kind: sql
      command_or_query: "source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql \"$DIRECT_URL\" -f supabase/migrations/20260604e_prd_estimate_fp.sql"
      expected: "ALTER TABLE (no error)"
    - kind: sql
      command_or_query: "SELECT data_type FROM information_schema.columns WHERE table_name='ProductRequirement' AND column_name='estimateFp';"
      expected: "numeric"
  dependsOn: []
  estimateMinutes: 10
  touches: [supabase/migrations/20260604e_prd_estimate_fp.sql]

- id: PV2S-006
  title: Migration — ProductRequirement.originType (proveniência)
  description: Adiciona originType text null + CHECK in (discovery,ceremony,board,spec_decomposition). Reusa EntityLink.planningCeremonyId pra lineage de cerimônia (D8), sem FK nova.
  acceptanceCriteria:
    - "Arquivo supabase/migrations/20260604f_prd_origin_type.sql existe"
    - "psql roda sem erro"
    - "CHECK prd_origin_type_check existe (aceita NULL + 4 valores)"
  verifiable:
    - kind: sql
      command_or_query: "source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql \"$DIRECT_URL\" -f supabase/migrations/20260604f_prd_origin_type.sql"
      expected: "ALTER TABLE (no error)"
    - kind: sql
      command_or_query: "SELECT conname FROM pg_constraint WHERE conname='prd_origin_type_check';"
      expected: "prd_origin_type_check"
  dependsOn: []
  estimateMinutes: 15
  touches: [supabase/migrations/20260604f_prd_origin_type.sql]

- id: PV2S-007
  title: Migration — ProductRequirementAssignee (join table + RLS)
  description: Cria join table (productRequirementId, memberId, PK composta) com FKs CASCADE, índice por memberId, RLS pra_read/pra_write espelhando prd_read/prd_write.
  acceptanceCriteria:
    - "Arquivo supabase/migrations/20260604g_product_requirement_assignee.sql existe"
    - "psql roda sem erro"
    - "Tabela ProductRequirementAssignee existe com RLS ligada"
    - "PK composta (productRequirementId, memberId) existe"
    - "Policies pra_read e pra_write existem"
  verifiable:
    - kind: sql
      command_or_query: "source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql \"$DIRECT_URL\" -f supabase/migrations/20260604g_product_requirement_assignee.sql"
      expected: "CREATE TABLE / CREATE POLICY (no error)"
    - kind: sql
      command_or_query: "SELECT relrowsecurity FROM pg_class WHERE relname='ProductRequirementAssignee';"
      expected: "t"
    - kind: sql
      command_or_query: "SELECT policyname FROM pg_policies WHERE tablename='ProductRequirementAssignee' ORDER BY policyname;"
      expected: "pra_read\\npra_write"
  dependsOn: []
  estimateMinutes: 25
  touches: [supabase/migrations/20260604g_product_requirement_assignee.sql]

- id: PV2S-008
  title: Atualizar database.types.ts + typecheck
  description: Reflete à mão (regra AGENTS.md) as 7 colunas novas em ProductRequirement (Row/Insert/Update) e adiciona o tipo ProductRequirementAssignee. Valida com tsc.
  acceptanceCriteria:
    - "ProductRequirement Row inclui userStoryId, sprintId, deliveryStatus, deployedToStagingAt, deployedToProductionAt, estimateFp, originType"
    - "Tipo ProductRequirementAssignee existe em database.types.ts"
    - "npx tsc --noEmit passa sem erros"
  verifiable:
    - kind: sql
      command_or_query: "grep -c 'deliveryStatus' src/lib/supabase/database.types.ts"
      expected: ">= 3"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "no errors"
  dependsOn: [PV2S-001, PV2S-002, PV2S-003, PV2S-004, PV2S-005, PV2S-006, PV2S-007]
  estimateMinutes: 25
  touches: [src/lib/supabase/database.types.ts]
```
