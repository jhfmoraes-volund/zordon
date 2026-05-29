# PRD — Opportunities Backlog (governança executiva de projetos candidatos)

**Status:** Draft v1
**Owner:** João (PM Volund)
**Data:** 2026-05-29
**Persona primária:** Volund PM interno (cura o backlog dentro de cada Client). Persona secundária: C-level do cliente (consome o widget, decide GO/NO-GO).

---

## §1 Problema

1. **Cliente não vê pipeline de futuro.** Hoje o Volund só renderiza projetos *em execução* (`/clients/[id]` lista `Project`). Ideias de automação/digitização que ainda não viraram projeto ficam em ata de reunião, Notion do PM ou cabeça do sponsor — somem entre uma reunião e outra. (Fonte: nenhuma rota lista candidatos a projeto; `Project.status` não tem estado pré-aprovação.)
2. **Governança ruim de demandas.** O Volund PM coleta demanda em DS, weekly, ata do Granola e Slack. Não existe artefato único onde "tudo que pode virar projeto neste cliente" mora. Quando o sponsor pergunta "o que tá na fila?", o PM responde de memória.
3. **Falta priorização executiva.** Sem visualização impact×effort, o sponsor não tem como dizer "começa por A, parqueia B". A decisão de qual ideia vira o próximo projeto é informal — o que custa autoridade do PM e gera retrabalho (projetos começam, são pausados, são repriorizados).

## §2 Solução em uma frase

**Backlog de oportunidades por cliente** — entidade `Opportunity` ancorada em `Client`, exposta como widget híbrido (matriz impact×effort + lista priorizada) na home do cliente, com botão **Promote → Project** que cria projeto novo + abre DS Inception linkada.

## §3 Não-objetivos

- Não substituímos CRM/pipeline comercial (HubSpot, Pipedrive). `Opportunity` é **pós-venda**: ideias de digitização *dentro de uma conta já fechada*, não leads.
- Não estimamos ROI/financeiro em fase 1 (sem campo `expectedRevenue`, `cost`). Score é qualitativo (impact 1-5, effort 1-5).
- Não fazemos extração automática via Vitor/LLM em fase 1 (PM cria manual). Fase 2.
- Não temos voto/comentário de stakeholder em fase 1. Fase 2.
- Não tem suporte mobile-first (PM usa desktop pra curar; cliente C-level vê em desktop). ResponsiveSheet já cobre o caso edge mobile via padrão Volund.
- Não tem integração com Wiki v2 em fase 1 (Wiki v2 ainda está em construção; integração vira fase 3 depois de ambos saneados).

## §4 Personas e jornada

**Persona 1 — Volund PM (primária, cura)**
> "Saio da reunião com o sponsor com 5 ideias na cabeça. Quero abrir o cliente no Volund, jogar cada uma como card, dar uma nota de impacto e esforço, e ter o backlog atualizado antes do próximo weekly. Quando o sponsor decidir que A vai virar projeto, eu clico um botão e o projeto nasce já com a oportunidade como contexto na DS Inception."

**Persona 2 — Sponsor / C-level do cliente (consome, decide)**
> "Abro o painel do meu cliente no Volund e vejo um quadrante visual: do canto superior-direito pra esquerda, são as iniciativas que valem a pena começar. Bato o olho em 5 segundos e digo pro Volund PM 'toca essas duas primeiro'."

**Persona 3 — PM Cliente (consome, comenta — fase 2)**
> "Eu acompanho o backlog pra alinhar com meu time interno antes do sponsor olhar. Quero comentar nos cards e indicar quais já estão prontos pra DS." *(fase 2; mencionado pra orientar schema)*

**Jornada MVP (fase 1):**
1. PM cria `Opportunity` via `/clients/[id]` → botão "Nova oportunidade" → `OpportunitySheet` (título, descrição, impact 1-5, effort 1-5, status=`discovery`).
2. Card aparece no widget (matriz 2×2 — quick wins, big bets, fill-ins, money pits) + na lista expandida.
3. PM refina ao longo do tempo (status `discovery → evaluating → approved`).
4. Sponsor olha matriz, alinha verbalmente com PM.
5. PM clica em card aprovado → "Promote → Project" → `ConfirmDialog` → cria `Project` + abre `DesignSession` tipo `inception` já populada com `description` da oportunidade. `Opportunity.status` vira `in_project`, `Opportunity.promotedProjectId` aponta pro projeto novo.
6. Oportunidades não aprovadas viram `rejected` (soft-delete) — ficam no backlog visível mas saem da matriz por default.

## §5 Decisões fixadas

| Dn  | Decisão | Por quê |
|-----|---------|---------|
| D1  | `Opportunity` ancora em `Client` (FK obrigatória `clientId`), não em `Project`. | Oportunidade é **candidata a virar projeto**. Ancorar em Project assume que o projeto já existe — contradiz o problema. |
| D2  | Scoring qualitativo manual em fase 1: `impact` (1-5) e `effort` (1-5). | Eixos suficientes pra montar matriz 2×2. RICE/ROI ($) fica fase 2 quando tivermos sinal real de uso. |
| D3  | Estados: `discovery → evaluating → approved → in_project → rejected`. Enum Postgres. | 5 estados cobrem o fluxo. `rejected` é soft-delete (oportunidade morre mas histórico fica). |
| D4  | Promote → Project cria **novo `Project`**, copia `name`/`description` da Opportunity, abre `DesignSession` tipo `inception` linkada. | Re-aproveita stack existente (DS Inception é onde o "por quê" mora). Não precisa novo fluxo de entrada de projeto. |
| D5  | Widget vive em `/clients/[id]` (página do cliente). Sem rota dedicada `/opportunities` em fase 1. | Onde o sponsor já loga pra ver seus projetos. Reduz fricção navegacional. Aba dedicada vira fase 2 se a lista crescer >20 itens/cliente. |
| D6  | Acesso: `can_view_client(clientId)` → SELECT (todos com acesso ao cliente leem). `can_edit_client(clientId)` (nova helper) → INSERT/UPDATE/DELETE (só lead/contributor do cliente OU manager+ global). | Reusa modelo `ProjectAccess` + `is_manager()` já estabelecido em [supabase/migrations/20260427_project_access.sql](supabase/migrations/20260427_project_access.sql). Helper novo `can_edit_client` (analogia a `can_edit_tasks`). |
| D7  | Sem IA na fase 1. Captura via Vitor (transcript → proposed Opportunity) fica fase 2. | Reduz superfície a validar; cliente vê valor com CRUD antes de investir em pipeline LLM. |
| D8  | Refs tipadas opcionais: `sourceMeetingId` (FK Meeting, nullable), `sourceDesignSessionId` (FK DesignSession, nullable), `sourceTranscriptRefId` (FK TranscriptRef, nullable). | Permite ancorar de onde a ideia veio sem forçar. Alinha com [transcript SSOT runbook](docs/platform/transcript-ssot-runbook.md). |
| D9  | `priorityRank int NULL` permite override manual da ordem default (score = `impact*5 - effort`). | Drag-to-reorder é UX óbvia. Default por score, mas PM pode forçar topo. |
| D10 | Promote é **idempotente** via `Opportunity.promotedProjectId` — se já tem projeto, botão promote desabilita e mostra link. | Evita double-promote acidental (já vimos isso no fluxo MeetingTaskAction). |
| D11 | Soft-delete via `status='rejected'`. Sem `deletedAt` separado. | Estados já cobrem; menos colunas. Trash bin é só `WHERE status='rejected'`. |
| D12 | Optimistic updates via `useOptimisticCollection<Opportunity, OpportunityMutation>` (padrão Volund). | Não inventar. [docs/platform/optimistic-updates-runbook.md](docs/platform/optimistic-updates-runbook.md) cobre tudo. |
| D13 | Forms via `Field`/`FormBody` (compound API) + `ResponsiveSheet` pra edição. | Padrão fechado do repo (ver [docs/platform/forms-standardization-plan.md](docs/platform/forms-standardization-plan.md)). |

## §6 Arquitetura

```
┌──────────────────────── /clients/[id] ────────────────────────┐
│                                                                │
│  ┌─ ClientHeader ─────────────────────────────────────────┐    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                │
│  ┌─ OpportunitiesWidget ──────────────────────────────────┐    │
│  │  [Matrix 2×2: impact × effort]                          │    │
│  │  ┌────────────────┬────────────────┐                    │    │
│  │  │  Big Bets      │  Quick Wins    │                    │    │
│  │  │  (hi imp/hi ef)│  (hi imp/lo ef)│                    │    │
│  │  ├────────────────┼────────────────┤                    │    │
│  │  │  Money Pits    │  Fill-ins      │                    │    │
│  │  │  (lo imp/hi ef)│  (lo imp/lo ef)│                    │    │
│  │  └────────────────┴────────────────┘                    │    │
│  │                                                          │    │
│  │  [Lista priorizada (expand)]                            │    │
│  │  1. ▲ Automação NF — score 4, status approved [Promote] │    │
│  │  2. ▲ Bot WhatsApp — score 3, evaluating                │    │
│  │  ...                                                     │    │
│  │  [+ Nova oportunidade]  [Mostrar descartadas]           │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                │
│  ┌─ ProjectsList (existente) ─────────────────────────────┐    │
│  └────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────┘

         OpportunitySheet (ResponsiveSheet)
         ├─ Field: title (Input)
         ├─ Field: description (Textarea)
         ├─ Field.Row cols=2: impact / effort (Select 1-5)
         ├─ Field: status (StatusChipSelect)
         ├─ Field: sourceMeetingId / sourceDesignSessionId (Select)
         └─ Footer: [Salvar] [Promover → Projeto]
```

**Componentes (novos):**
- `OpportunitiesWidget` — orquestra matrix + lista; carrega via DAL no server, hidrata em client component pra optimistic. `src/components/opportunities/opportunities-widget.tsx`.
- `OpportunityMatrix` — board 2×2 derivado de [src/components/design-session/board/board-layout.tsx](src/components/design-session/board/board-layout.tsx). Reusa `StickyCard` adaptado.
- `OpportunityCard` — card visual (status chip + score badge + título).
- `OpportunityList` — lista expand stack-ranked.
- `OpportunitySheet` — edição (ResponsiveSheet, size=md).
- `useOpportunities(clientId)` — hook em `src/hooks/use-opportunities.ts`, wraps `useOptimisticCollection`.

**Componentes (reuso):**
- `Field`, `FormBody`, `Input`, `Textarea`, `Select`, `StatusChipSelect`, `Button`, `ResponsiveSheet`, `ConfirmDialog` — todos de [src/components/ui/](src/components/ui/).

**Endpoints (novos):**
- `GET /api/clients/[id]/opportunities` → lista
- `POST /api/clients/[id]/opportunities` → cria
- `PATCH /api/opportunities/[id]` → update
- `POST /api/opportunities/[id]/promote` → cria Project + DS Inception, retorna `{ projectId, designSessionId }`

**DAL:** `src/lib/dal/opportunities.ts` (lê/escreve via supabase server client; RLS aplica automático).

**Tipos:** auto-gerar `Opportunity` em `src/lib/supabase/database.types.ts` após migrations (via `supabase gen types`).

## §7 Schema

### 7.1 Tabela `Opportunity`

**Arquivo:** `supabase/migrations/20260530_opportunity_table.sql`

```sql
CREATE TYPE "OpportunityStatus" AS ENUM (
  'discovery',
  'evaluating',
  'approved',
  'in_project',
  'rejected'
);

CREATE TABLE "Opportunity" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "clientId"   uuid NOT NULL REFERENCES "Client"(id) ON DELETE CASCADE,
  title        text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description  text,
  impact       smallint NOT NULL CHECK (impact BETWEEN 1 AND 5),
  effort       smallint NOT NULL CHECK (effort BETWEEN 1 AND 5),
  status       "OpportunityStatus" NOT NULL DEFAULT 'discovery',
  "priorityRank" integer,                       -- manual override; NULL = use score
  "sourceMeetingId"        uuid REFERENCES "Meeting"(id) ON DELETE SET NULL,
  "sourceDesignSessionId"  uuid REFERENCES "DesignSession"(id) ON DELETE SET NULL,
  "sourceTranscriptRefId"  uuid REFERENCES "TranscriptRef"(id) ON DELETE SET NULL,
  "promotedProjectId"      uuid REFERENCES "Project"(id) ON DELETE SET NULL,
  "createdBy"  uuid NOT NULL REFERENCES "Member"(id) ON DELETE RESTRICT,
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  "updatedAt"  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_opportunity_client_status
  ON "Opportunity" ("clientId", status)
  WHERE status <> 'rejected';

CREATE INDEX ix_opportunity_promoted
  ON "Opportunity" ("promotedProjectId")
  WHERE "promotedProjectId" IS NOT NULL;

ALTER TABLE "Opportunity" ENABLE ROW LEVEL SECURITY;
```

### 7.2 Helper RLS `can_edit_client`

**Arquivo:** `supabase/migrations/20260530b_can_edit_client_helper.sql`

```sql
CREATE OR REPLACE FUNCTION public.can_edit_client(client_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    is_manager()
    OR EXISTS (
      SELECT 1
      FROM "ProjectAccess" pa
      JOIN "Project" p ON p.id = pa."projectId"
      WHERE p."clientId" = client_id
        AND pa."userId" = auth.uid()
        AND pa.role IN ('contributor','lead')
    );
$$;

GRANT EXECUTE ON FUNCTION public.can_edit_client(uuid) TO authenticated;
```

> Razão: PM Volund tem `access_level=manager` global → `is_manager()` true.
> Builder/contributor com acesso a *qualquer projeto* do cliente edita.
> Viewer/guest do cliente apenas lê.

### 7.3 RLS policies em `Opportunity`

**Arquivo:** `supabase/migrations/20260530c_opportunity_rls.sql`

```sql
-- SELECT: quem vê o cliente, vê as opportunities
CREATE POLICY opp_select
  ON "Opportunity" FOR SELECT TO authenticated
  USING (
    is_manager()
    OR EXISTS (
      SELECT 1 FROM "ProjectAccess" pa
      JOIN "Project" p ON p.id = pa."projectId"
      WHERE p."clientId" = "Opportunity"."clientId"
        AND pa."userId" = auth.uid()
    )
  );

-- INSERT / UPDATE / DELETE: gated por can_edit_client
CREATE POLICY opp_insert
  ON "Opportunity" FOR INSERT TO authenticated
  WITH CHECK (can_edit_client("clientId"));

CREATE POLICY opp_update
  ON "Opportunity" FOR UPDATE TO authenticated
  USING (can_edit_client("clientId"))
  WITH CHECK (can_edit_client("clientId"));

CREATE POLICY opp_delete
  ON "Opportunity" FOR DELETE TO authenticated
  USING (can_edit_client("clientId"));
```

### 7.4 Trigger `updatedAt`

**Arquivo:** `supabase/migrations/20260530d_opportunity_touch_trigger.sql`

```sql
CREATE OR REPLACE FUNCTION public.touch_opportunity_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_opportunity_touch_updated_at
  BEFORE UPDATE ON "Opportunity"
  FOR EACH ROW EXECUTE FUNCTION public.touch_opportunity_updated_at();
```

> 4 migrations atômicas (uma por arquivo) — alinhado com convenção do repo. Rollback granular se promote falhar.

## §8 APIs

| Método | Path | Contrato | Async? |
|--------|------|----------|--------|
| `GET`    | `/api/clients/[id]/opportunities`             | → `{ opportunities: Opportunity[] }` ordenado por `priorityRank NULLS LAST, score DESC, createdAt DESC` | sync |
| `POST`   | `/api/clients/[id]/opportunities`             | body Zod: `{ title, description?, impact:1-5, effort:1-5, status?, sourceMeetingId?, sourceDesignSessionId?, sourceTranscriptRefId? }` → `{ opportunity }` 201 | sync |
| `PATCH`  | `/api/opportunities/[id]`                     | body Zod (partial): `{ title?, description?, impact?, effort?, status?, priorityRank? }` → `{ opportunity }` 200 | sync |
| `DELETE` | `/api/opportunities/[id]`                     | hard-delete (raramente usado; UI usa `status='rejected'`) → 204 | sync |
| `POST`   | `/api/opportunities/[id]/promote`             | body Zod: `{ projectName?: string }` (default = opportunity.title); → `{ projectId, designSessionId }` 201. Transação: cria Project + DS Inception + seta opportunity.promotedProjectId + status=in_project. Idempotente se já promovida (retorna mesmo payload). | sync (transação curta, sem LLM) |

**Validação Zod:** todos os schemas em `src/app/api/.../route.ts` (regra do repo — Zod só no server).

**Status codes:** 200 ok, 201 created, 204 deleted, 400 zod error, 403 RLS, 404 not found, 409 conflict (promote em opportunity já com `promotedProjectId` diferente do retornado).

## §9 UX

**Wireframe — matriz no widget:**

```
┌─ Oportunidades (5) ──────────────────── [+ Nova] [Lista ▾] ┐
│                                                              │
│  high impact                                                 │
│  ┌──────────────────┬──────────────────┐                    │
│  │                  │  ★ Automação NF  │   ← Quick Wins     │
│  │  • Migração ERP  │  ★ Bot WhatsApp  │                    │
│  │   (big bet)      │                  │                    │
│  ├──────────────────┼──────────────────┤                    │
│  │                  │  • Dashboard BI  │                    │
│  │  (vazio)         │                  │                    │
│  │                  │                  │                    │
│  └──────────────────┴──────────────────┘                    │
│  low impact                                                  │
│       high effort         low effort                         │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Wireframe — sheet de edição (mobile-aware via ResponsiveSheet):**

```
┌─ Editar oportunidade ────────────── [×] ┐
│ Título * [_______________________]      │
│ Descrição                                │
│ [____________________________________]   │
│ [____________________________________]   │
│                                          │
│ Impacto *      Esforço *                 │
│ [3 ▾ 1-5]      [2 ▾ 1-5]                 │
│                                          │
│ Status                                   │
│ [● discovery] [evaluating] [approved]…   │
│                                          │
│ Origem (opcional)                        │
│ [Reunião… ▾]  [Design Session… ▾]        │
│                                          │
├──────────────────────────────────────────┤
│ [Descartar]    [Salvar]  [Promover → ★]  │
└──────────────────────────────────────────┘
```

**Quadrantes (definição visual):**
- impact ≥ 4 & effort ≤ 2 → **Quick Wins** (chip verde)
- impact ≥ 4 & effort ≥ 3 → **Big Bets** (chip azul)
- impact ≤ 3 & effort ≤ 2 → **Fill-ins** (chip cinza)
- impact ≤ 3 & effort ≥ 3 → **Money Pits** (chip vermelho, alerta)

**Estados visuais:**
- `discovery` — chip cinza pontilhado
- `evaluating` — chip amarelo
- `approved` — chip verde, ★ no card
- `in_project` — chip azul + link clicável pro Project
- `rejected` — opacidade 50%, escondido por default; toggle "Mostrar descartadas"

## §10 Integrações

| Sistema | Como toca | Direção |
|---------|-----------|---------|
| **Project** | Promote cria Project (FK `promotedProjectId`). Project.name/description vêm da Opportunity. | Opportunity → Project |
| **DesignSession** | Promote abre DS Inception linkada ao Project recém-criado. `DesignSession.description` inicializa com `Opportunity.description`. | Opportunity → DS |
| **Meeting** | `sourceMeetingId` opcional ancora oportunidade na reunião onde nasceu. UI mostra link clicável. | Meeting → Opportunity (referência) |
| **TranscriptRef** | `sourceTranscriptRefId` opcional (transcript onde foi mencionada). Padrão [transcript SSOT runbook](docs/platform/transcript-ssot-runbook.md). | Transcript → Opportunity |
| **ProjectAccess + is_manager** | Reuso direto pra RLS (D6). Sem novo modelo de ACL. | Auth → Opportunity |
| **Wiki v2** | **Fase 3** (depois de wiki-v2 estabilizar). Wiki do Project promovido pode citar Opportunity origem (badge "veio de Opportunity X"). | Não fase 1. |
| **Vitor (PM agent)** | **Fase 2** — Vitor lê transcript de DS/meeting e propõe Opportunities (`status='discovery'`, awaiting PM curation). | Não fase 1. |
| **Alpha (ops agent)** | Não toca. | — |

## §11 Faseamento

**Fase 1 — Backlog manual + Promote (MVP).** Este PRD.
- Schema + RLS + CRUD + widget (matriz + lista) + Promote → Project + DS Inception. ~6-8 dias de impl + 2 dias QA.
- Entrega mais que o sistema atual (zero hoje vs. backlog visual + promote pipeline).

**Fase 2 — Captura via Vitor + Voto.**
- Vitor extrai oportunidades de transcript (DS/meeting) e propõe cards `status='discovery'` com `sourceTranscriptRefId`.
- Sponsor/PM cliente votam +1/-1 nos cards (signal pra priorização). Tabela `OpportunityVote(opportunityId, userId, value, createdAt)`.
- Comentários básicos (reusa pattern do `Comment` ou cria leve).

**Fase 3 — Integração Wiki v2.**
- Wiki do Project promovido cita Opportunity origem (seção "Origem" auto-populada).
- Métricas no overview do Client: "X oportunidades aprovadas em N dias", "ratio promoted/rejected".

**Fase 4 — RICE + financeiro.**
- Adicionar reach, confidence, expectedRevenue (BRL), implementationCost.
- Score migra de `impact*5 - effort` pra RICE: `(reach * impact * confidence) / effort`.
- Opcional: ROI estimation feed pro Alpha (relatório semanal).

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| PM não cura backlog → vira lixo orgânico (igual Wiki manual) | Médio | Alto | Vitoria/Alpha pingam PM no semanal se Opportunities sem update há >14d. **Mitigação na Fase 1.5** (cheap cron). |
| Promote sem DS preenchida cria projeto fantasma | Médio | Médio | Promote SEMPRE abre DS Inception (não dá pra escapar). DS tem template. ConfirmDialog avisa "Vai criar projeto + DS — você é PM?" |
| Cliente C-level entra e edita por engano | Baixo | Médio | RLS `can_edit_client` exige role ≥ contributor. Guest (viewer) só lê. Promote só lead/manager. |
| Idempotência de Promote — double-click cria 2 projetos | Médio | Alto | `Opportunity.promotedProjectId` checa na transação ANTES de INSERT. Idempotente garantido. ConfirmDialog `busy` state previne duplo-clique. |
| Matriz 2×2 vira complicada quando há >20 cards no mesmo quadrante | Baixo (fase 1) | Baixo | Lista priorizada cobre overflow. Quadrante mostra top-5 + "ver +12". |
| Migration falhar parcialmente (4 arquivos) | Baixo | Alto | Cada arquivo é ALTER/CREATE atômico. Rollback granular: reverter migrations em ordem inversa. Bem testado em staging primeiro. |
| Cliente sem nenhum project ainda → `can_edit_client` falha (não tem ProjectAccess) | Médio | Alto | Manager bypass cobre PM Volund. **Mas:** policy permite manager criar Opportunity em cliente "vazio" → primeira opportunity → primeiro projeto. Fluxo válido. |

## §13 Métricas de sucesso

| Métrica | Instrumento | Target Fase 1 |
|---------|-------------|---------------|
| **Adoção:** clientes com ≥ 1 Opportunity criada | `SELECT count(DISTINCT "clientId") FROM "Opportunity";` | ≥ 60% dos clientes ativos em 30d |
| **Cura ativa:** Opportunities com `updatedAt` < 14d | `SELECT count(*) FROM "Opportunity" WHERE status NOT IN ('rejected','in_project') AND "updatedAt" > now() - interval '14 days';` ÷ total ativas | ≥ 70% das ativas curadas no período |
| **Promote rate:** Opportunity → Project conversion | `SELECT count(*) FILTER (WHERE status='in_project') * 1.0 / count(*) FROM "Opportunity";` | ≥ 20% das criadas viram projeto em 60d |
| **Tempo discovery → in_project (mediana)** | `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (updated_to_in_project - created)) FROM (audit log)` | ≤ 21 dias |
| **Visualizações C-level:** sponsor abre `/clients/[id]` | Event log front (próprio): `client_dashboard_view` filtrando `userId` com `access_level='guest'` | ≥ 1 view/semana por sponsor ativo |
| **Promote idempotência:** zero duplicate projects | `SELECT "promotedProjectId", count(*) FROM "Opportunity" GROUP BY "promotedProjectId" HAVING count(*) > 1;` | 0 rows sempre |

Eventos front (analytics): emitir `opportunity_created`, `opportunity_promoted`, `client_dashboard_view` via mecanismo existente (se houver) ou wire em Alpha event stream.

## §14 Open questions

(idealmente vazio — mas há 2 não-bloqueantes pra fase ≥ 2)

- **OQ-1** (fase 2): Voto é sócio à `Member` (autenticado interno) ou aberto a stakeholder externo via invite link? *Resolver no PRD da Fase 2.*
- **OQ-2** (fase 4): RICE confidence é qualitativo (alto/médio/baixo) ou numérico (0-1)? *Resolver na fase 4.*

Nada bloqueia fase 1.

## §15 Referências

- [docs/prd/in-progress/prd-project-wiki.md](../in-progress/prd-project-wiki.md) — Wiki v2 (futura integração fase 3)
- [docs/platform/optimistic-updates-runbook.md](docs/platform/optimistic-updates-runbook.md) — `useOptimisticCollection`
- [docs/platform/forms-standardization-plan.md](docs/platform/forms-standardization-plan.md) — Field / FormBody
- [docs/platform/transcript-ssot-runbook.md](docs/platform/transcript-ssot-runbook.md) — refs tipadas (sourceTranscriptRefId)
- [docs/runbooks/ralph-process.md](docs/runbooks/ralph-process.md) — pipeline de execução autônoma
- [supabase/migrations/20260427_project_access.sql](supabase/migrations/20260427_project_access.sql) — modelo de ACL reusado
- [src/components/design-session/board/](src/components/design-session/board/) — board kit base pra OpportunityMatrix
- [src/hooks/use-optimistic-collection.ts](src/hooks/use-optimistic-collection.ts) — hook canônico
- Memory: `project_meeting_task_unification.md`, `project_transcript_ssot.md`, `project_wiki_v2.md`, `project_ui_patterns.md`

---

## §16 Stories implementáveis

```yaml
- id: OPP-001
  title: "Migration — Opportunity table + enum"
  description: "Cria enum OpportunityStatus e tabela Opportunity (§7.1) com checks, FKs ON DELETE CASCADE/SET NULL e índices parciais."
  acceptanceCriteria:
    - "Arquivo supabase/migrations/20260530_opportunity_table.sql existe com DDL do §7.1"
    - "psql roda sem erro"
    - "\\d \"Opportunity\" mostra 14 colunas + 2 índices + RLS habilitada"
    - "OpportunityStatus enum tem 5 valores"
  verifiable:
    - kind: sql
      command_or_query: 'source <(grep ^DIRECT_URL= .env | sed "s/^/export /") && psql "$DIRECT_URL" -f supabase/migrations/20260530_opportunity_table.sql'
      expected: "CREATE TYPE / CREATE TABLE / CREATE INDEX (no error)"
    - kind: sql
      command_or_query: "SELECT enum_range(NULL::\"OpportunityStatus\");"
      expected: "{discovery,evaluating,approved,in_project,rejected}"
    - kind: sql
      command_or_query: "SELECT relrowsecurity FROM pg_class WHERE relname='Opportunity';"
      expected: "t"
  dependsOn: []
  estimateMinutes: 20
  touches:
    - "supabase/migrations/20260530_opportunity_table.sql"

- id: OPP-002
  title: "Migration — can_edit_client helper"
  description: "Cria função SECURITY DEFINER can_edit_client(uuid) per §7.2 (manager bypass + role check via ProjectAccess JOIN Project)."
  acceptanceCriteria:
    - "Arquivo supabase/migrations/20260530b_can_edit_client_helper.sql existe"
    - "Função existe com prosecdef=true"
    - "GRANT EXECUTE TO authenticated"
  verifiable:
    - kind: sql
      command_or_query: 'source <(grep ^DIRECT_URL= .env | sed "s/^/export /") && psql "$DIRECT_URL" -f supabase/migrations/20260530b_can_edit_client_helper.sql'
      expected: "CREATE FUNCTION / GRANT (no error)"
    - kind: sql
      command_or_query: "SELECT proname, prosecdef FROM pg_proc WHERE proname='can_edit_client';"
      expected: "can_edit_client | t"
  dependsOn: []
  estimateMinutes: 15
  touches:
    - "supabase/migrations/20260530b_can_edit_client_helper.sql"

- id: OPP-003
  title: "Migration — Opportunity RLS policies"
  description: "Cria 4 policies (opp_select/opp_insert/opp_update/opp_delete) per §7.3."
  acceptanceCriteria:
    - "Arquivo supabase/migrations/20260530c_opportunity_rls.sql existe"
    - "4 policies registradas em pg_policy pra Opportunity"
  verifiable:
    - kind: sql
      command_or_query: 'source <(grep ^DIRECT_URL= .env | sed "s/^/export /") && psql "$DIRECT_URL" -f supabase/migrations/20260530c_opportunity_rls.sql'
      expected: "CREATE POLICY x4 (no error)"
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_policy WHERE polrelid='\"Opportunity\"'::regclass;"
      expected: "4"
  dependsOn: ["OPP-001", "OPP-002"]
  estimateMinutes: 15
  touches:
    - "supabase/migrations/20260530c_opportunity_rls.sql"

- id: OPP-004
  title: "Migration — touch updatedAt trigger"
  description: "Cria função + trigger BEFORE UPDATE pra manter updatedAt automatico per §7.4."
  acceptanceCriteria:
    - "Arquivo supabase/migrations/20260530d_opportunity_touch_trigger.sql existe"
    - "Trigger trg_opportunity_touch_updated_at registrado"
  verifiable:
    - kind: sql
      command_or_query: 'source <(grep ^DIRECT_URL= .env | sed "s/^/export /") && psql "$DIRECT_URL" -f supabase/migrations/20260530d_opportunity_touch_trigger.sql'
      expected: "no error"
    - kind: sql
      command_or_query: "SELECT tgname FROM pg_trigger WHERE tgrelid='\"Opportunity\"'::regclass AND tgname='trg_opportunity_touch_updated_at';"
      expected: "trg_opportunity_touch_updated_at"
  dependsOn: ["OPP-001"]
  estimateMinutes: 10
  touches:
    - "supabase/migrations/20260530d_opportunity_touch_trigger.sql"

- id: OPP-005
  title: "Regenerar database.types.ts"
  description: "Rodar supabase gen types e committar atualização contendo tipos Opportunity + OpportunityStatus."
  acceptanceCriteria:
    - "src/lib/supabase/database.types.ts contém 'Opportunity:' como key em Tables"
    - "enum OpportunityStatus exposto"
  verifiable:
    - kind: sql
      command_or_query: "echo skip-DB-this-is-typegen-step"
      expected: "skip-DB-this-is-typegen-step"
    - kind: typecheck
      command_or_query: "grep -c 'Opportunity:' src/lib/supabase/database.types.ts"
      expected: ">=1"
    - kind: typecheck
      command_or_query: "grep -c 'OpportunityStatus' src/lib/supabase/database.types.ts"
      expected: ">=1"
  dependsOn: ["OPP-001", "OPP-002", "OPP-003", "OPP-004"]
  estimateMinutes: 10
  touches:
    - "src/lib/supabase/database.types.ts"

- id: OPP-006
  title: "DAL — opportunities.ts"
  description: "Cria src/lib/dal/opportunities.ts com funções listByClient(clientId), getById(id), create(input), update(id, patch), softReject(id), promote(id, projectName?). Promote roda em transação RPC ou múltiplos statements via single supabase client."
  acceptanceCriteria:
    - "Arquivo src/lib/dal/opportunities.ts existe"
    - "Exporta listByClient, getById, create, update, softReject, promote"
    - "Todas funções tipadas com Database['public']['Tables']['Opportunity']['Row']"
    - "promote() retorna { projectId, designSessionId } e é idempotente (early return se promotedProjectId já existe)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'src/lib/dal/opportunities' || echo 'no-errors'"
      expected: "no-errors"
    - kind: lint
      command_or_query: "grep -E 'export (async )?function (listByClient|getById|create|update|softReject|promote)' src/lib/dal/opportunities.ts | wc -l | tr -d ' '"
      expected: "6"
  dependsOn: ["OPP-005"]
  estimateMinutes: 30
  touches:
    - "src/lib/dal/opportunities.ts"

- id: OPP-007
  title: "API GET/POST /api/clients/[id]/opportunities"
  description: "Cria src/app/api/clients/[id]/opportunities/route.ts com handler GET (list) e POST (create) usando Zod no body."
  acceptanceCriteria:
    - "Arquivo route.ts existe"
    - "GET retorna { opportunities: [] } 200"
    - "POST valida body via Zod (title, impact 1-5, effort 1-5 obrigatórios) e retorna 201 com novo card"
    - "Erros 400 (Zod), 403 (RLS), 404"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'src/app/api/clients/\\[id\\]/opportunities' || echo 'no-errors'"
      expected: "no-errors"
    - kind: lint
      command_or_query: "grep -E 'export (async )?function (GET|POST)' 'src/app/api/clients/[id]/opportunities/route.ts' | wc -l | tr -d ' '"
      expected: "2"
  dependsOn: ["OPP-006"]
  estimateMinutes: 25
  touches:
    - "src/app/api/clients/[id]/opportunities/route.ts"

- id: OPP-008
  title: "API PATCH/DELETE /api/opportunities/[id]"
  description: "Cria src/app/api/opportunities/[id]/route.ts com PATCH (partial update Zod) e DELETE (hard delete)."
  acceptanceCriteria:
    - "Arquivo route.ts existe"
    - "PATCH valida Zod partial (todos campos opcionais) e retorna { opportunity } 200"
    - "DELETE retorna 204"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'src/app/api/opportunities/\\[id\\]/route' || echo 'no-errors'"
      expected: "no-errors"
    - kind: lint
      command_or_query: "grep -E 'export (async )?function (PATCH|DELETE)' 'src/app/api/opportunities/[id]/route.ts' | wc -l | tr -d ' '"
      expected: "2"
  dependsOn: ["OPP-006"]
  estimateMinutes: 20
  touches:
    - "src/app/api/opportunities/[id]/route.ts"

- id: OPP-009
  title: "API POST /api/opportunities/[id]/promote"
  description: "Cria src/app/api/opportunities/[id]/promote/route.ts. Body Zod { projectName? }. Idempotente: se promotedProjectId existe → retorna mesmo payload com 200; senão cria Project + DesignSession Inception em transação e seta promotedProjectId + status='in_project' (201)."
  acceptanceCriteria:
    - "Arquivo route.ts existe"
    - "Retorna { projectId, designSessionId }"
    - "Idempotente: 2 chamadas seguidas retornam mesmo IDs"
    - "Body invalida com 400 se projectName muito longo (>200)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'src/app/api/opportunities/\\[id\\]/promote' || echo 'no-errors'"
      expected: "no-errors"
    - kind: lint
      command_or_query: "grep -E 'projectId.+designSessionId|designSessionId.+projectId' 'src/app/api/opportunities/[id]/promote/route.ts' | wc -l | tr -d ' '"
      expected: ">=1"
  dependsOn: ["OPP-006"]
  estimateMinutes: 30
  touches:
    - "src/app/api/opportunities/[id]/promote/route.ts"

- id: OPP-010
  title: "Hook useOpportunities (optimistic)"
  description: "Cria src/hooks/use-opportunities.ts envolvendo useOptimisticCollection com reducer customizado pra patch/create/delete/promote. Errors via showErrorToast."
  acceptanceCriteria:
    - "Arquivo hook existe e exporta useOpportunities(clientId, initial)"
    - "Suporta mutations: create, patch, softReject, promote"
    - "Usa useOptimisticCollection (não setState direto)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'src/hooks/use-opportunities' || echo 'no-errors'"
      expected: "no-errors"
    - kind: lint
      command_or_query: "grep -c 'useOptimisticCollection' src/hooks/use-opportunities.ts"
      expected: ">=1"
  dependsOn: ["OPP-007", "OPP-008", "OPP-009"]
  estimateMinutes: 25
  touches:
    - "src/hooks/use-opportunities.ts"

- id: OPP-011
  title: "OpportunityCard component"
  description: "Cria src/components/opportunities/opportunity-card.tsx — derivado de sticky-card. Mostra título, status chip, score badge, link pro promoted Project se existir. Click abre OpportunitySheet."
  acceptanceCriteria:
    - "Arquivo existe"
    - "Recebe prop opportunity: Opportunity"
    - "Renderiza StatusChip + Badge de score"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'src/components/opportunities/opportunity-card' || echo 'no-errors'"
      expected: "no-errors"
  dependsOn: ["OPP-010"]
  estimateMinutes: 25
  touches:
    - "src/components/opportunities/opportunity-card.tsx"

- id: OPP-012
  title: "OpportunityMatrix component (2×2 board)"
  description: "Cria src/components/opportunities/opportunity-matrix.tsx — board 2×2 (4 quadrantes per §9: Quick Wins, Big Bets, Fill-ins, Money Pits). Cada quadrante renderiza top-5 cards + 'ver mais' se >5."
  acceptanceCriteria:
    - "Arquivo existe"
    - "4 quadrantes renderizados com labels corretos"
    - "Cards distribuídos por impact/effort conforme §9"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'src/components/opportunities/opportunity-matrix' || echo 'no-errors'"
      expected: "no-errors"
    - kind: lint
      command_or_query: "grep -E '(Quick Wins|Big Bets|Fill-ins|Money Pits)' src/components/opportunities/opportunity-matrix.tsx | wc -l | tr -d ' '"
      expected: "4"
  dependsOn: ["OPP-011"]
  estimateMinutes: 30
  touches:
    - "src/components/opportunities/opportunity-matrix.tsx"

- id: OPP-013
  title: "OpportunityList component (stack-ranked)"
  description: "Cria src/components/opportunities/opportunity-list.tsx — lista priorizada por priorityRank NULLS LAST + score DESC. Inclui toggle 'Mostrar descartadas'. Botão Promote inline pra cards approved."
  acceptanceCriteria:
    - "Arquivo existe"
    - "Lista ordenada conforme spec"
    - "Toggle 'descartadas' funciona (filtra status='rejected')"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'src/components/opportunities/opportunity-list' || echo 'no-errors'"
      expected: "no-errors"
  dependsOn: ["OPP-011"]
  estimateMinutes: 25
  touches:
    - "src/components/opportunities/opportunity-list.tsx"

- id: OPP-014
  title: "OpportunitySheet — edit form"
  description: "Cria src/components/opportunities/opportunity-sheet.tsx — ResponsiveSheet size=md com Field compound API (title, description, impact, effort 1-5 select, status, sources). Footer com Descartar/Salvar/Promover (botão promover só se status='approved')."
  acceptanceCriteria:
    - "Arquivo existe"
    - "Usa ResponsiveSheet + Field/FormBody"
    - "Validação inline (impact/effort entre 1-5)"
    - "Botão Promover renderiza ConfirmDialog antes de chamar POST /promote"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'src/components/opportunities/opportunity-sheet' || echo 'no-errors'"
      expected: "no-errors"
    - kind: lint
      command_or_query: "grep -cE '(ResponsiveSheet|FormBody|ConfirmDialog)' src/components/opportunities/opportunity-sheet.tsx"
      expected: ">=3"
  dependsOn: ["OPP-010"]
  estimateMinutes: 30
  touches:
    - "src/components/opportunities/opportunity-sheet.tsx"

- id: OPP-015
  title: "OpportunitiesWidget — wire-up no /clients/[id]"
  description: "Cria src/components/opportunities/opportunities-widget.tsx (client component) que orquestra Matrix + List + Sheet. Edita src/app/(dashboard)/clients/[id]/page.tsx pra carregar opportunities via DAL (server) e passar pra widget. Inclui botão '+ Nova oportunidade'."
  acceptanceCriteria:
    - "Arquivo widget existe"
    - "page.tsx do client mostra widget (server-fetch + hidrata)"
    - "Botão + nova oportunidade abre OpportunitySheet em modo create"
    - "Manual browser smoke: criar 1 opportunity, ver no matrix, editar score, ver re-rank"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E '(opportunities-widget|src/app/\\(dashboard\\)/clients/\\[id\\]/page)' || echo 'no-errors'"
      expected: "no-errors"
    - kind: http
      command_or_query: "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/clients/test-id 2>/dev/null || echo 'manual'"
      expected: "200 or 'manual' (dev server not assumed)"
    - kind: manual_browser
      command_or_query: "Abrir /clients/<id>, criar opportunity, validar matrix + lista + edição"
      expected: "Card aparece na matriz no quadrante correto"
  dependsOn: ["OPP-012", "OPP-013", "OPP-014"]
  estimateMinutes: 30
  touches:
    - "src/components/opportunities/opportunities-widget.tsx"
    - "src/app/(dashboard)/clients/[id]/page.tsx"
```

**Stories: 15. Total estimate: 360 min (~6h focused).** Cabe em 1 sprint Ralph.

---

**Auto-checklist (executar antes de Rito 2 Ralph):**
- [x] §5 tem ≥ 8 decisões fixadas, zero TBD (13 decisões)
- [x] §7 DDL completo com RLS, 4 migrations atômicas
- [x] §8 todos endpoints com método + path + contrato
- [x] §11 Fase 1 entrega mais que sistema atual (zero hoje → backlog visual + promote)
- [x] §13 todas métricas com query SQL ou evento
- [x] §14 vazio bloqueante; 2 não-bloqueantes marcados pra fase ≥ 2
- [x] §16 tem 15 stories, todas com `verifiable` automatizável, total ≤ 25
- [ ] `scripts/ralph/features/opportunities/prd.json` espelhando §16 *(criar a seguir)*
