# PRD — Alocação % por projeto (self-service no widget do membro)

**Feature:** `member-allocation`
**Status:** backlog (aguardando Rito 1 — Intake)
**Data:** 2026-06-11
**Runtime:** volund-web-app

---

## §1 Problema

1. **A org não sabe quanto de cada pessoa está em cada projeto.** Hoje existe `ProjectMember.fpAllocation` (teto de FP/sprint, setado por manager), mas não existe nenhuma declaração de *tempo* — quanto % da semana de cada PM/PB vai pra cada projeto. Fonte: pedido direto do João (2026-06-11) pra "passar para a org" uma visão de alocação.
2. **Não dá pra derivar isso automaticamente ainda.** Sinais reais (tasks, sessions, commits, meetings) não cobrem o tempo todo de todo mundo — qualquer cálculo automático hoje seria ficção. Fonte: decisão explícita do João ("no momento não conseguimos puxar tudo via automático, por isso vai ser um processo manual").
3. **Não existe lugar canônico pra consultar.** Quando alguém pergunta "quem está com banda pra projeto novo?", a resposta é tribal (Slack/memória do PM). Precisa de uma tabela específica, consultável por SQL, pra relatório e rituais (PM Review, Planning).

## §2 Solução em uma frase

Cada membro declara, no seu widget em `/profile`, o % da sua semana alocado em cada projeto do seu squad — gravado numa tabela dedicada (`MemberProjectAllocation`) sobre uma carga semanal default de 8h, consultável pela org via view SQL.

## §3 Não-objetivos

- **Não** substitui nem altera o modelo de FP (`Member.fpCapacity`, `ProjectMember.fpAllocation`, `SprintMember`). São eixos diferentes: FP = capacidade de entrega por sprint (manager-set); % = tempo declarado (self-reported).
- **Não** automatiza a coleta (derivar % de tasks/sessions/commits) — explícito como Fase 4, fora deste PRD.
- **Não** cria workflow de aprovação — o que o membro declara, vale.
- **Não** bloqueia soma ≠ 100% — overcommit/undercommit é informação, não erro.
- **Não** cria histórico semanal versionado na Fase 1 (snapshot via cron é Fase 2).
- **Não** cria UI de timesheet/apontamento de horas por task.

## §4 Personas e jornada

**PB (product-builder):** "Estou no Zelar e no SIAL. Abro meu perfil, vejo os dois projetos, coloco 60/40 e pronto — levou 20 segundos."

**PM:** "Toda segunda, antes da planning, ajusto minha alocação da semana. Se mudou (projeto novo entrou), o projeto já aparece na lista porque fui adicionado ao squad."

**Head-ops/Admin:** "Puxo uma query (ou o endpoint de relatório) e vejo a matriz pessoa × projeto × % × horas. Uso isso na PM Review pra discutir sobrecarga e banda livre."

**Sistema (futuro):** "Quando a coleta automática existir, comparo o declarado com o observado e aponto drift."

## §5 Decisões fixadas

| # | Decisão | Por quê |
|---|---------|---------|
| D1 | Alocação % vive em **tabela própria** `MemberProjectAllocation` — não reusa/estende `ProjectMember.fpAllocation` | Pedido explícito ("tabela específica pra gente puxar isso"); semânticas diferentes (self-reported tempo vs manager-set FP); evoluem independente |
| D2 | Unidade = **% inteiro 0–100 por projeto**; soma-alvo 100; soma ≠ 100 gera warning visual, **nunca bloqueia** | Processo manual — fricção mata adoção; overcommit é dado útil, não erro |
| D3 | Carga semanal default = **8h**, em `Member.weeklyHours` (integer NOT NULL DEFAULT 8, editável por manager). Horas derivadas = `percent/100 × weeklyHours` | Default dado pelo João; coluna (vs constante) permite exceções por pessoa sem migration |
| D4 | Lista de projetos do widget vem de **`ProjectMember`** (squad). Sem row em ProjectMember → projeto não aparece | ProjectMember já é o SSOT de "está alocado no projeto"; evita segunda fonte de verdade |
| D5 | Widget visível pra **todo member com ≥1 projeto no squad** (sem gate por position). Rollout/comunicação mira PMs e PBs | Gate por position só adiciona código e esconde dado útil; "todos como PM e PB" cobre a base inteira de entrega |
| D6 | Escrita **self-service only** na Fase 1: cada member edita só a própria alocação. Manager **lê tudo** (view + endpoint), não edita em nome de ninguém | Dado é declaração pessoal; edição por terceiro corrompe o sinal. Admin override só se a prática provar necessidade |
| D7 | API REST **síncrona** (`GET/PUT /api/me/allocations`), validação Zod só no route handler | Sem LLM/job (<1s) — regra da casa de async não se aplica; Zod fica em `src/app/api/**` |
| D8 | Fase 1 guarda **estado corrente** (`updatedAt`/`updatedBy` na linha). Histórico semanal = snapshot via pg_cron na Fase 2 (padrão `wiki-daily`/`MetricSnapshot`) | Estado corrente já responde "como estamos agora"; histórico sem rotina de preenchimento consolidada seria ruído |
| D9 | UI usa os padrões canônicos: `FormBody`/`Field`, `useOptimisticCollection`/`mutate`, erros via Sonner. Widget novo em `src/components/allocation-widget.tsx` (mesmo flat dos demais widgets) | Reuse-first (AGENTS.md); `capacity-widget.tsx` e `todos-widget.tsx` já moram aí |
| D10 | **RLS explícita** na tabela: SELECT próprio-ou-manager, INSERT/UPDATE/DELETE só próprio (via `Member.userId = auth.uid()`); reusa helper `is_manager()` | Defesa em profundidade mesmo com service_role na API; padrão do access model existente |

## §6 Arquitetura

```
┌──────────────────────────────┐
│ /profile (page.tsx)          │
│  └─ <AllocationWidget/>      │  src/components/allocation-widget.tsx
└──────────┬───────────────────┘
           │ GET/PUT
┌──────────▼───────────────────┐
│ /api/me/allocations          │  src/app/api/me/allocations/route.ts
│  GET: ProjectMember ⋈ MPA    │  (Zod aqui; getCurrentMember() do DAL)
│  PUT: bulk upsert            │
└──────────┬───────────────────┘
┌──────────▼───────────────────┐     ┌────────────────────────────────┐
│ MemberProjectAllocation      │◄────│ /api/members/allocations (GET) │
│ (tabela nova, RLS)           │     │ manager-only · lê a view       │
│ Member.weeklyHours (col nova)│     │ member_allocation_report       │
└──────────────────────────────┘     └────────────────────────────────┘
```

## §7 Schema (DDL completo)

**Migration 1 — `supabase/migrations/20260611_member_project_allocation.sql`:**

```sql
CREATE TABLE public."MemberProjectAllocation" (
  "id"        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "memberId"  uuid NOT NULL REFERENCES public."Member"(id)  ON DELETE CASCADE,
  "projectId" uuid NOT NULL REFERENCES public."Project"(id) ON DELETE CASCADE,
  "percent"   integer NOT NULL CHECK ("percent" BETWEEN 0 AND 100),
  "updatedBy" uuid REFERENCES public."Member"(id),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("memberId", "projectId")
);
COMMENT ON TABLE public."MemberProjectAllocation" IS
  'Alocação self-reported: % da semana do member dedicado ao projeto. Soma por member pode ≠ 100 (informação, não erro). updatedAt setado pela API a cada upsert.';

CREATE INDEX idx_mpa_project ON public."MemberProjectAllocation"("projectId");

GRANT ALL ON public."MemberProjectAllocation" TO service_role, authenticated;

ALTER TABLE public."MemberProjectAllocation" ENABLE ROW LEVEL SECURITY;

CREATE POLICY mpa_select_own_or_manager ON public."MemberProjectAllocation"
  FOR SELECT TO authenticated
  USING (
    public.is_manager()
    OR EXISTS (SELECT 1 FROM public."Member" m
               WHERE m.id = "memberId" AND m."userId" = auth.uid())
  );

CREATE POLICY mpa_insert_own ON public."MemberProjectAllocation"
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public."Member" m
                      WHERE m.id = "memberId" AND m."userId" = auth.uid()));

CREATE POLICY mpa_update_own ON public."MemberProjectAllocation"
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public."Member" m
                 WHERE m.id = "memberId" AND m."userId" = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public."Member" m
                      WHERE m.id = "memberId" AND m."userId" = auth.uid()));

CREATE POLICY mpa_delete_own ON public."MemberProjectAllocation"
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public."Member" m
                 WHERE m.id = "memberId" AND m."userId" = auth.uid()));
```

**Migration 2 — `supabase/migrations/20260611b_member_weekly_hours.sql`:**

```sql
ALTER TABLE public."Member"
  ADD COLUMN "weeklyHours" integer NOT NULL DEFAULT 8
  CHECK ("weeklyHours" BETWEEN 1 AND 60);
COMMENT ON COLUMN public."Member"."weeklyHours" IS
  'Carga horária semanal usada pra converter alocação % em horas (default 8 — ver §14 Q1). Distinto de fpCapacity (FP/sprint).';
```

**Migration 3 — `supabase/migrations/20260611c_member_allocation_report_view.sql`:**

```sql
CREATE OR REPLACE VIEW public.member_allocation_report AS
SELECT
  m.id                                            AS member_id,
  m.name                                          AS member_name,
  m."position"                                    AS member_position,
  m."weeklyHours"                                 AS weekly_hours,
  p.id                                            AS project_id,
  p.name                                          AS project_name,
  a.percent                                       AS percent,
  round(a.percent * m."weeklyHours" / 100.0, 1)   AS hours_per_week,
  a."updatedAt"                                   AS updated_at
FROM public."MemberProjectAllocation" a
JOIN public."Member"  m ON m.id = a."memberId"
JOIN public."Project" p ON p.id = a."projectId";

GRANT SELECT ON public.member_allocation_report TO service_role, authenticated;
```

Após cada migration: atualizar `src/lib/supabase/database.types.ts`.

## §8 APIs

| Método | Path | Auth | Contrato |
|--------|------|------|----------|
| GET | `/api/me/allocations` | member logado | 200 `{ weeklyHours, totalPercent, projects: [{ projectId, projectName, percent \| null, hoursPerWeek \| null, updatedAt \| null }] }` — projetos via `ProjectMember`; `percent: null` = nunca preenchido. 401 sem sessão |
| PUT | `/api/me/allocations` | member logado | Body Zod `{ allocations: [{ projectId: uuid, percent: int 0–100 }] }` → bulk upsert (seta `updatedAt`/`updatedBy`). 403 se algum `projectId` fora do squad do member. 200 `{ ok: true, totalPercent }` |
| GET | `/api/members/allocations` | `MANAGER` | 200 `{ rows: member_allocation_report[] }` — relatório org pessoa × projeto × % × horas |

Tudo síncrono (sem LLM/job — D7).

## §9 UX

Widget novo em `/profile`, ao lado do `CapacityCard` existente:

```
┌─ Minha alocação ───────────────────────────────────┐
│ Carga semanal: 8h              Σ 100% · 8.0h  ✓    │
│                                                    │
│  Projeto              %         h/sem              │
│  Zelar               [ 50 ]%    4.0h               │
│  SIAL                [ 30 ]%    2.4h               │
│  Zordon (interno)    [ 20 ]%    1.6h               │
│                                                    │
│  ⚠ Soma em 90% — sobrou 10% da semana   [Salvar]   │
└────────────────────────────────────────────────────┘
```

- Inputs `<Input type="number">` nativos (sem masked-input), altura via `--field-h`.
- Σ recalculada client-side a cada keystroke; badge verde (=100), âmbar (<100), vermelho (>100). Nunca bloqueia salvar.
- Horas derivadas exibidas read-only ao lado de cada %.
- Empty state (member sem projeto): "Você ainda não está no squad de nenhum projeto — fale com seu PM."
- Erros do PUT via Sonner (`showErrorToast`), padrão optimistic runbook.

## §10 Integrações

- **Capacity FP existente** — não toca. Widget tem copy curta diferenciando ("% do seu tempo" vs "FP de entrega") pra evitar confusão com `CapacityCard`.
- **PM Review / Planning Ceremony** — relatório (`member_allocation_report`) vira insumo dos rituais; Vitoria pode citar sobrecarga.
- **Metrics registry** — Fase 3 adiciona `member.allocation_coverage` e drift declarado×fpAllocation como `MetricDef`.
- **Alpha** — Fase 2: lembrete semanal pra quem não atualizou (padrão de notificação existente).

## §11 Faseamento

| Fase | Entrega |
|------|---------|
| **1 (este PRD)** | Tabela + RLS, `Member.weeklyHours`, widget self-service em `/profile`, view + endpoint de relatório manager. **Hoje não existe nada de % — Fase 1 entrega estritamente mais que o sistema atual.** |
| 2 | Snapshot semanal (pg_cron, padrão wiki-daily) pra histórico + lembrete Alpha pra quem não preencheu |
| 3 | Métricas no registry (`member.allocation_coverage`, drift % declarado vs fpAllocation) + visão exec na home (tab Ops) |
| 4 | Coleta automática (derivar de tasks/sessions/commits) — aposenta o processo manual |

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| % declarado vira ficção (ninguém atualiza) | Alta | Médio | Métrica de cobertura (§13) revisada na PM Review semanal; lembrete Alpha na Fase 2 |
| Confusão com fpAllocation/fpCapacity | Média | Médio | Copy explícita no widget + COMMENT no schema diferenciando os eixos (D1) |
| Soma ≠ 100 lida como erro de sistema | Média | Baixo | Warning com texto claro ("sobrou X%" / "X% acima"), nunca bloqueio (D2) |
| Member edita % de projeto que saiu do squad | Baixa | Baixo | PUT valida projectId ∈ ProjectMember do member (403); GET só lista squad atual |
| Default 8h estar errado (ver §14 Q1) | Média | Baixo | É só DEFAULT de coluna — corrigir é 1 ALTER + UPDATE, sem mudança de contrato |

## §13 Métricas de sucesso

| Métrica | Alvo | Instrumento |
|---------|------|-------------|
| Cobertura de preenchimento | ≥80% dos members com squad em 4 semanas | `SELECT count(DISTINCT "memberId") FROM "MemberProjectAllocation" WHERE "updatedAt" > now() - interval '7 days'` ÷ `SELECT count(DISTINCT "memberId") FROM "ProjectMember"` |
| Consistência (Σ=100) | ≥70% dos preenchidos | `SELECT count(*) FROM (SELECT "memberId", sum(percent) s FROM "MemberProjectAllocation" GROUP BY 1) t WHERE s = 100` |
| Uso no relatório | ≥1 consulta/semana na PM Review | endpoint `GET /api/members/allocations` (log de acesso) + citação no report da PM Review |

## §14 Open questions

- **Q1 (resolve no Rito 1, não bloqueia):** "8 horas **semanal**" está confirmado, ou era 8h/dia (40h/semana)? O DDL não depende da resposta — é só o `DEFAULT` da coluna `weeklyHours` (D3). Default atual segue o pedido literal: 8.
- **Q2 (Fase 2):** snapshot semanal guarda a matriz inteira ou só diffs? Decidir quando a rotina de preenchimento estiver provada.

## §15 Referências

- Código vivo: `src/components/capacity-widget.tsx`, `src/app/(dashboard)/profile/page.tsx` (CapacityCard ~L556-697), `src/app/api/projects/[id]/members/[memberId]/route.ts` (PATCH fpAllocation), `src/lib/dal.ts` (`getCurrentMember`, `getAccessibleProjectIds`), `src/lib/roles.ts` (Position, `is_manager`)
- Migration de referência: `supabase/migrations/20260423_fp_allocation_model.sql`
- Memories: `project_member_roles_access.md`, `project_metrics_registry.md`, `project_ui_patterns.md`
- Runbooks: `docs/platform/optimistic-updates-runbook.md`, `docs/platform/forms-standardization-plan.md`

## §16 Stories implementáveis

```yaml
- id: ALLOC-001
  title: Migration — tabela MemberProjectAllocation com RLS
  description: >
    Criar supabase/migrations/20260611_member_project_allocation.sql com o DDL do §7
    (tabela + UNIQUE(memberId,projectId) + índice projectId + GRANT + RLS 4 policies)
    e aplicar via psql "$DIRECT_URL".
  acceptanceCriteria:
    - "Tabela MemberProjectAllocation existe com CHECK percent 0–100 e UNIQUE (memberId, projectId)"
    - "RLS habilitada com 4 policies (select own-or-manager, insert/update/delete own)"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_policies WHERE tablename = 'MemberProjectAllocation'"
      expected: "4"
  dependsOn: []
  estimateMinutes: 20
  touches: [supabase/migrations/20260611_member_project_allocation.sql]

- id: ALLOC-002
  title: Migration — Member.weeklyHours default 8
  description: >
    Criar supabase/migrations/20260611b_member_weekly_hours.sql (ALTER Member ADD weeklyHours
    integer NOT NULL DEFAULT 8 CHECK 1–60 + COMMENT) e aplicar via psql.
  acceptanceCriteria:
    - "Coluna Member.weeklyHours existe, NOT NULL, default 8, CHECK 1–60"
  verifiable:
    - kind: sql
      command_or_query: "SELECT column_default FROM information_schema.columns WHERE table_name='Member' AND column_name='weeklyHours'"
      expected: "8"
  dependsOn: []
  estimateMinutes: 10
  touches: [supabase/migrations/20260611b_member_weekly_hours.sql]

- id: ALLOC-003
  title: Atualizar database.types.ts com tabela e coluna novas
  description: >
    Refletir MemberProjectAllocation (Row/Insert/Update) e Member.weeklyHours em
    src/lib/supabase/database.types.ts, seguindo o shape das tabelas vizinhas.
  acceptanceCriteria:
    - "Types de MemberProjectAllocation e Member.weeklyHours presentes e usáveis sem cast"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [ALLOC-001, ALLOC-002]
  estimateMinutes: 15
  touches: [src/lib/supabase/database.types.ts]

- id: ALLOC-004
  title: GET /api/me/allocations — projetos do squad + % atual
  description: >
    Route handler que resolve o member via getCurrentMember(), lista projetos via ProjectMember
    (join Project.name), faz left-join em MemberProjectAllocation e retorna
    { weeklyHours, totalPercent, projects[] } com percent/hoursPerWeek null quando não preenchido.
  acceptanceCriteria:
    - "200 com shape do §8 pra member autenticado; percent null quando sem row"
    - "401 sem sessão"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: http
      command_or_query: "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/me/allocations"
      expected: "401"
  dependsOn: [ALLOC-003]
  estimateMinutes: 25
  touches: [src/app/api/me/allocations/route.ts]

- id: ALLOC-005
  title: PUT /api/me/allocations — bulk upsert com Zod
  description: >
    No mesmo route.ts, PUT com Zod { allocations: [{ projectId uuid, percent int 0–100 }] }.
    Valida cada projectId ∈ ProjectMember do member (senão 403), upserta por
    (memberId, projectId) setando updatedAt/updatedBy, retorna { ok, totalPercent }.
  acceptanceCriteria:
    - "Upsert idempotente por (memberId, projectId); updatedAt/updatedBy setados"
    - "403 pra projectId fora do squad; 400 pra percent fora de 0–100 (Zod)"
    - "401 sem sessão"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: http
      command_or_query: "curl -s -o /dev/null -w '%{http_code}' -X PUT http://localhost:3000/api/me/allocations -H 'Content-Type: application/json' -d '{\"allocations\":[]}'"
      expected: "401"
  dependsOn: [ALLOC-004]
  estimateMinutes: 25
  touches: [src/app/api/me/allocations/route.ts]

- id: ALLOC-006
  title: AllocationWidget em /profile (self-service)
  description: >
    Criar src/components/allocation-widget.tsx (FormBody/Field, Input number nativo, Σ live com
    badge ✓/âmbar/vermelho, horas derivadas, empty state, salvar via mutate + Sonner) e montar
    em /profile junto do CapacityCard. Wireframe do §9.
  acceptanceCriteria:
    - "Widget lista projetos do GET, edita %, mostra Σ e h/sem derivadas em tempo real"
    - "Soma ≠ 100 mostra warning mas salva normalmente; erros via Sonner toast"
    - "Empty state pra member sem squad"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "Logar como PB com 2 projetos, setar 60/40, salvar, recarregar — valores persistem"
      expected: "Valores persistem; badge ✓ em Σ=100"
  dependsOn: [ALLOC-004, ALLOC-005]
  estimateMinutes: 30
  touches:
    - src/components/allocation-widget.tsx
    - src/app/(dashboard)/profile/page.tsx

- id: ALLOC-007
  title: View member_allocation_report + GET /api/members/allocations (manager)
  description: >
    Criar supabase/migrations/20260611c_member_allocation_report_view.sql (view do §7, GRANT
    SELECT) e endpoint manager-only que retorna as rows da view (requireMinLevelApi MANAGER).
  acceptanceCriteria:
    - "View retorna member × project × percent × hours_per_week × updated_at"
    - "Endpoint 200 pra manager, 403 pra builder, 401 sem sessão"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.views WHERE table_name='member_allocation_report'"
      expected: "1"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [ALLOC-003]
  estimateMinutes: 25
  touches:
    - supabase/migrations/20260611c_member_allocation_report_view.sql
    - src/app/api/members/allocations/route.ts
```
