# PM Review — Plano

> Discutido com João em 2026-05-29.
> Memory: `project_pm_review`. Pré-requisito: [`transcript-ssot-runbook.md`](../../platform/transcript-ssot-runbook.md).

## Em uma frase

**PM Review é o ritual semanal onde a Vitoria atua como PM inteligente** — lê reuniões, sistema e código do projeto, e mantém um **report estruturado** sobre rumo, próximos passos, riscos, necessidades, indicadores do time e decisões em aberto. Diferente da Planning (que comita uma sprint com cascata de tasks), o PM Review é **report-driven, sempre consultável**, sem staging-commit, sem propostas de task.

## Princípios

1. **Tabela própria, não discriminator.** `PMReview` é irmã de `PlanningCeremony` (como `DesignSession` é irmã de `Meeting`). Misturar via `kind` na mesma tabela mente sobre a semântica — Planning é staging-commit, PM Review é síntese. Aprendizado DS ([[project_design_session_normalization]]): cada conceito = tabela.

2. **User-facing "Ritual" continua sendo o eixo.** A tab `ProjectCeremoniesTab` lista PM Reviews + Plannings em UNION. O conceito "Ritual" vive na UI; no banco e no código cada um é seu próprio universo.

3. **Sempre consultado vira UI de primeira classe.** O PM Review da semana corrente ganha **card fixo no topo da tab Rituais** ("PM Review · semana de DD/MM · Atualizado há Nh · Abrir report"). 1-click para consulta.

4. **Reuso por primitives, não por tabela compartilhada.** `ResponsiveSheet`, `Field`/`FormBody`, `useOptimisticCollection`, `TranscriptRef`, `ChatThread` (channel discrimina), agent Vitoria (modo PM Review). Zero acoplamento de schema.

5. **Cadência semanal.** `referenceWeek = data da segunda-feira` (consistente com [[project_sprint_week_model]]). UNIQUE `(projectId, referenceWeek)`.

6. **Sem state machine complexa.** Estados enxutos: `draft` → `published` (exclusão via hard delete; `archived` é estado legado — ver §Estados). Published ≠ fechado; é "disponível pra consulta, ainda editável".

## Pré-requisitos

[`transcript-ssot-runbook.md`](../../platform/transcript-ssot-runbook.md) — PRs Fundação A e B obrigatórios antes desta feature. Caso contrário PM Review nasce limpo mas Vitor (DS) e Vitoria (PM Review) leem o mesmo Roam transcript de lugares diferentes.

## Schema — migration única

```sql
-- 1. PMReview — artefato central
CREATE TABLE "PMReview" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId" uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  "referenceWeek" date NOT NULL,
    -- segunda-feira da semana. CHECK garante day-of-week = 1.
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','archived')),
  "reportMarkdown" text,
    -- síntese da Vitoria, atualizada on-demand. Markdown puro.
    -- Exceção consciente ao princípio "rows tipadas, sem jsonb-light":
    -- é 1 string monolítica gerada por IA, não dado consultável.
  "reportGeneratedAt" timestamptz,
  "facilitatorId" uuid REFERENCES "Member"(id) ON DELETE SET NULL,
  "scheduledFor" timestamptz,
  "publishedAt" timestamptz,
  "archivedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("projectId", "referenceWeek"),
  CHECK (EXTRACT(dow FROM "referenceWeek") = 1)
);
CREATE INDEX "PMReview_project_week_idx"
  ON "PMReview" ("projectId", "referenceWeek" DESC);

-- 2. PMReviewMeetingLink — N:N tipado (espelha PlanningMeetingLink)
CREATE TABLE "PMReviewMeetingLink" (
  id uuid PK, "pmReviewId" FK→PMReview ON DELETE CASCADE,
  "meetingId" FK→Meeting ON DELETE CASCADE,
  "linkedById", "linkedAt", note,
  UNIQUE ("pmReviewId", "meetingId")
);

-- 3. PMReviewTranscriptLink — N:N com weight (espelha PlanningTranscriptLink)
CREATE TABLE "PMReviewTranscriptLink" (
  id uuid PK, "pmReviewId" FK→PMReview ON DELETE CASCADE,
  "transcriptRefId" FK→TranscriptRef ON DELETE CASCADE,
  "linkedById", "linkedAt",
  weight CHECK IN ('primary','supporting','background'),
  note,
  UNIQUE ("pmReviewId", "transcriptRefId")
);

-- 4. PMReviewNote — notes tipadas (espelha PlanningContextNote, kinds diferentes)
CREATE TABLE "PMReviewNote" (
  id uuid PK, "pmReviewId" FK→PMReview ON DELETE CASCADE,
  kind text CHECK IN (
    'summary',           -- panorama geral
    'project_direction', -- rumo do projeto
    'next_step',         -- próximos passos
    'risk',              -- risco identificado
    'need',              -- necessidade (recurso, decisão, input)
    'team_signal',       -- indicador do time (capacidade, moral, blockers)
    'open_decision'      -- decisão em aberto
  ),
  content text NOT NULL,
  "sourceTranscriptIds" uuid[] DEFAULT '{}',
  "sourceMeetingIds" uuid[] DEFAULT '{}',
  priority int DEFAULT 0,
  "dismissedAt" timestamptz,
  "generatedAt" timestamptz,
  "generatedByAgent" text CHECK IN ('vitoria') NULL,
  "generatedByMemberId" uuid FK→Member NULL,
  CHECK (
    ("generatedByAgent" IS NOT NULL AND "generatedByMemberId" IS NULL)
    OR ("generatedByAgent" IS NULL AND "generatedByMemberId" IS NOT NULL)
  )
);
CREATE INDEX "PMReviewNote_pmReview_kind_idx"
  ON "PMReviewNote" ("pmReviewId", kind)
  WHERE "dismissedAt" IS NULL;

-- 5. Helper SQL pra permissão
CREATE FUNCTION can_create_pm_review(p_project_id uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT is_admin(get_my_access_level())
        OR EXISTS (
          SELECT 1 FROM "ProjectAccess"
          WHERE "memberId" = get_my_member_id()
            AND "projectId" = p_project_id
            AND role = 'lead'
        );
  $$;

-- 6. ChatThread channel
ALTER TABLE "ChatThread"
  DROP CONSTRAINT IF EXISTS "ChatThread_channel_check";
ALTER TABLE "ChatThread"
  ADD CONSTRAINT "ChatThread_channel_check"
  CHECK (channel IN (...existentes, 'pm_review'));
```

**RLS (todas as 4 tabelas):**
- SELECT — `is_manager() OR can_view_project(...)`.
- INSERT/UPDATE/DELETE da `PMReview` — `is_manager() OR can_create_pm_review("projectId")`.
- Links e notes — `is_manager() OR EXISTS PMReview com can_view_project(...)`.

## Estados

Transições sem volta:

| De → Para | Quem dispara | Side effect |
|---|---|---|
| `draft → published` | PM clica "Publicar" | stamp `publishedAt`. Continua editável. |

> **Atualização 2026-06-19:** `archived` deixou de ser uma ação — PM Review agora se **exclui** (hard delete, `DELETE /api/pm-review/[id]` em qualquer status; cascata derruba notes/links). O valor `archived` segue no enum/CHECK só como estado **legado** de linhas antigas (renderiza/lista, mas nada transiciona para ele). Endpoint `POST /api/pm-review/[id]/archive` deletado.

**Sem trigger SQL gerado** (volume de transições é trivial). Lib `src/lib/pm-review/status.ts` (~40 linhas) valida transições + stampa timestamps. Validação na API antes do UPDATE.

## DAL — [src/lib/dal/pm-review.ts](../../../src/lib/dal/pm-review.ts) (novo)

Espelha a estrutura de [src/lib/dal/planning.ts](../../../src/lib/dal/planning.ts):

- `listPMReviews(projectId, { status?, limit?, includeArchived? })` — ordenado por `referenceWeek DESC` (suporta "última primeiro").
- `getPMReview(id)` — detail com links e contagens de notes por kind.
- `createPMReview({ projectId, referenceWeek?, facilitatorId? })` — `referenceWeek` default = segunda da semana corrente.
- `updatePMReview(id, patch)` — facilitator, referenceWeek, scheduledFor.
- `publishPMReview(id)` — status update + stamp.
- `deletePMReview(id)` — hard delete (qualquer status; cascata `ON DELETE CASCADE`).
- `linkTranscript(pmReviewId, transcriptRefId, weight?)` / `unlinkTranscript(...)`.
- `linkMeeting(pmReviewId, meetingId)` / `unlinkMeeting(...)`.
- `addNote(pmReviewId, { kind, content, sources })` / `updateNote` / `dismissNote`.
- `updateReportMarkdown(pmReviewId, markdown)` — escrita do report pela Vitoria.

Sem `concludePMReview` cascata. Sem `MeetingTaskAction`. Sem `PlanningTree` análogo.

## API

| Método | Rota | Função |
|--------|------|--------|
| POST | `/api/pm-review` | Criar (valida `canCreatePMReview` na API). |
| GET | `/api/projects/[id]/pm-reviews?status=published&limit=N` | Listar do projeto. |
| GET | `/api/pm-review/[id]` | Detail. |
| PATCH | `/api/pm-review/[id]` | Editar facilitator/referenceWeek/scheduledFor. |
| DELETE | `/api/pm-review/[id]` | Hard delete (qualquer status; cascata derruba notes/links). |
| POST | `/api/pm-review/[id]/publish` | `draft → published`. |
| POST | `/api/pm-review/[id]/transcripts` | Link transcripts (body: `[{transcriptRefId, weight}]`). |
| DELETE | `/api/pm-review/[id]/transcripts/[transcriptRefId]` | Unlink. |
| POST | `/api/pm-review/[id]/meetings` | Link meetings. |
| DELETE | `/api/pm-review/[id]/meetings/[meetingId]` | Unlink. |
| GET/POST/PATCH/DELETE | `/api/pm-review/[id]/notes` | CRUD de notes (Vitoria escreve aqui via tool). |
| POST | `/api/pm-review/[id]/report` | Força regeneração do report (chama Vitoria). |
| POST | `/api/pm-review/[id]/chat` | Endpoint do agent (streaming). |

Validação Zod em todas as rotas ([[project_ui_patterns]]) — schema só na API, nunca no client.

## Permissão

[src/lib/roles.ts](../../../src/lib/roles.ts) ganha helper:

```ts
export function canCreatePMReview(
  accessLevel: AccessLevel,
  projectAccess: ProjectAccess | null,
): boolean {
  if (isAdmin(accessLevel)) return true;
  return projectAccess?.role === "lead";
}
```

Espelho SQL `can_create_pm_review(projectId)` já no schema (item 5).

Validação em 3 camadas: client (esconder botão) → API (rejeitar payload) → RLS (cinto).

## UI

### Tab Rituais — [src/components/project-ceremonies-tab.tsx](../../../src/components/project-ceremonies-tab.tsx)

Ganha **3 zonas**:

```
┌─ Zona 1: PM Review da semana (card destacado, "sempre consultado") ─┐
│ 📊 PM Review · semana de 27/mai                                     │
│ Publicado há 2h · 4 riscos · 3 próximos passos                      │
│ [Abrir report]                                                      │
└─────────────────────────────────────────────────────────────────────┘
  ↑ Só aparece se houver PMReview com status='published' no projeto.
  ↑ Mostra o `referenceWeek` mais recente.

┌─ Zona 2: Filtros + ações ───────────────────────────────────────────┐
│ [Todas] [Planning] [PM Review]      [+ Nova Planning]               │
│                                     [+ Novo PM Review]              │
└─────────────────────────────────────────────────────────────────────┘
  ↑ Botão "+ Novo PM Review" gated por canCreatePMReview.
  ↑ DISABLED_FILTER "Review" promovido a ACTIVE.

┌─ Zona 3: Lista de rituais (UNION normalizada) ──────────────────────┐
│ • PM Review · sem 20/mai          published                         │
│ • Planning · Sprint 12            em planejamento                   │
│ • PM Review · sem 13/mai          archived                          │
│ • Planning · Sprint 11            concluída                         │
└─────────────────────────────────────────────────────────────────────┘
```

Fetch consolidado: novo `GET /api/projects/[id]/rituals?limit=N` retorna itens normalizados `{ kind: 'planning'|'pm_review', id, title, status, scheduledFor, badges, href }`. Cards exibem com mesmo layout, link de cada um respeita o `kind`.

### PMReviewSheet — [src/components/pm-review/pm-review-sheet.tsx](../../../src/components/pm-review/pm-review-sheet.tsx) (novo)

Copy enxuto do `PlanningSheet` (~200 linhas). Campos:
- **Semana de referência** — date input com auto-snap pra segunda da semana selecionada.
- **Facilitador** — select de members do projeto.

Sem sprint, sem cadência (semanal é fixo). Mesmo `ResponsiveSheet size="sm"`, mesmo padrão de Field/FormBody.

### Página `/pm-reviews/[id]` — [src/app/(dashboard)/pm-reviews/[id]/page.tsx](../../../src/app/(dashboard)/pm-reviews/[id]/page.tsx) (novo)

Layout inspirado em `/rituals/[id]` mas com painel esquerdo diferente:

```
┌─────────────────────────────────────────────────────────────────────┐
│ ← Voltar    PM Review · semana de 27/mai · [published]              │
│                                              [⚙ Editar] [💬 Vitoria]│
├─────────────────────────────────┬───────────────────────────────────┤
│ <PMReviewRibbon>                │                                   │
│ 3 transcripts · 12 notes        │ <ConversationPanel agent=vitoria> │
│ Última síntese: há 2h           │                                   │
│ [Atualizar report]              │                                   │
├─────────────────────────────────┤                                   │
│                                 │                                   │
│ <PMReviewReport>                │                                   │
│                                 │                                   │
│ ## Rumo do projeto              │                                   │
│ ...                             │                                   │
│ ## Próximos passos              │                                   │
│ ...                             │                                   │
│ ## Riscos                       │                                   │
│ ...                             │                                   │
│ ## Necessidades                 │                                   │
│ ...                             │                                   │
│ ## Indicadores do time          │                                   │
│ ...                             │                                   │
│ ## Decisões em aberto           │                                   │
│ ...                             │                                   │
│                                 │                                   │
│ <details>Ver fontes (12 notes)</details>                            │
└─────────────────────────────────┴───────────────────────────────────┘
```

**`<PMReviewReport>`** — renderiza `PMReview.reportMarkdown` direto (Markdown component existente). Se `reportMarkdown` é null, mostra "Vitoria ainda não escreveu o report — peça pra ela atualizar". Collapsible no rodapé lista as notes-fonte ordenadas por kind.

**`<PMReviewRibbon>`** — contagem de transcripts linkados, contagem de notes por kind (riscos/próximos passos/etc), "última síntese" timestamp, status pill, botão "Atualizar report".

## Vitoria — modo PM Review

### Despacho

[src/lib/agent/agents/vitoria/index.ts](../../../src/lib/agent/agents/vitoria/index.ts) lê `agentContext.surface ∈ {'planning','pm_review'}` (passado pelo `/api/pm-review/[id]/chat`) e:
- Carrega prompt apropriado.
- Habilita/desabilita tools por surface.
- `buildProjectProfile` continua o mesmo (Vitoria precisa do mesmo contexto de projeto).

### Prompt

Novo arquivo `src/lib/agent/agents/vitoria/prompt-pm-review.ts`:

```
Você é Vitoria, a PM inteligente do projeto. Sua missão: manter o pulso do
projeto pra que o PM humano possa consultar a qualquer momento.

Você atua sobre 3 camadas de contexto:
  1. Conversa — transcripts de reuniões, dailies, calls com cliente.
  2. Sistema — sprints, backlog, capacidade, tasks em andamento.
  3. Código — repositório do projeto (README + tree no MVP).

Seu output principal é um REPORT estruturado em 6 seções fixas:
  • Rumo do projeto       (project_direction)
  • Próximos passos       (next_step)
  • Riscos                (risk)
  • Necessidades          (need)
  • Indicadores do time   (team_signal)
  • Decisões em aberto    (open_decision)

REGRAS:
  • NÃO proponha tasks. Não existe staging-commit aqui.
  • Toda observação vai em add_pm_review_note com kind ∈ {summary,
    project_direction, next_step, risk, need, team_signal, open_decision}.
  • Quando o PM pedir "atualiza o report", sintetize TODAS as notes
    não-dismissed nas 6 seções fixas, em markdown direto, e grave via
    update_pm_review_report. Cite source IDs quando relevante.
  • Read first, write later: chame read_transcript_content nos IDs
    listados em "Fontes de contexto linkadas" antes de propor síntese.
  • Use get_project_indicators(projectId) pra a seção "Indicadores do
    time" — velocity, throughput, blockers, capacity vs delivered.

NÃO use jargão de fase ("vou começar a leitura agora") — fluxo é livre.
```

### Tools

| Tool | Surface | Função |
|------|---------|--------|
| `read_transcript_content` | both | Lê `TranscriptRef.fullText`. |
| `list_pm_review_context` | pm_review | Lista transcripts/meetings/notes linkados a este PM Review. |
| `add_pm_review_note(pmReviewId, kind, content, sources)` | pm_review | Escreve em `PMReviewNote`. |
| `update_pm_review_report(pmReviewId, markdown)` | pm_review | Grava `PMReview.reportMarkdown` + `reportGeneratedAt`. |
| `get_project_indicators(projectId)` | pm_review | Velocity últimas 3 sprints, throughput, contagem de blockers, capacity vs delivered via `sprint_capacity_overview`. |
| `list_project_sprints` | both | Read-only. |
| `list_project_tasks` | both | Read-only. |
| `propose_task_action`, `update_proposed_action`, `delete_proposed_action` | planning **only** | Bloqueadas em pm_review. |
| `add_context_note` (planning), `add_pm_review_note` (pm_review) | gated | Cada surface tem sua tabela. |

## Ordem de execução

Cada passo = 1 PR fechado.

0. **Pré-requisitos** ([`transcript-ssot-runbook.md`](../../platform/transcript-ssot-runbook.md)): PR Fundação A + B.
1. **Migration** — 4 tabelas + `can_create_pm_review()` + `ChatThread.channel` += 'pm_review'. Atualiza `database.types.ts`.
2. **DAL** + status lib + tests.
3. **Permissão** — helpers TS espelhando SQL.
4. **API** — todas as rotas, validação Zod.
5. **Vitoria modo PM Review** — `prompt-pm-review.ts`, 3 tools novas (`add_pm_review_note`, `update_pm_review_report`, `get_project_indicators`), despacho por surface no `index.ts`.
6. **PMReviewSheet** + create flow + permissão na UI.
7. **Tab Rituais ajustada** — UNION na API (`GET /api/projects/[id]/rituals`), card fixo de "PM Review da semana", filtro ativo "PM Review", botão "+ Novo PM Review".
8. **Página `/pm-reviews/[id]`** + `<PMReviewReport>` + `<PMReviewRibbon>` + chat com Vitoria.
9. **Smoke end-to-end**: criar PM Review, linkar 2 transcripts (1 reunião Granola + 1 sync Roam), Vitoria gera notes + report, publicar, abrir card do topo da tab Rituais.

## Riscos honestos

1. **Pré-requisitos atrasam o início.** A+B somam ~2 dias. Não cortar — sem eles a SSOT não é SSOT de verdade e PM Review vira mais uma ilha.

2. **"Sempre consultado" exige UI extra.** Card fixo no topo da tab é mais 1 componente; sem ele a feature perde 80% do valor (vira "mais um ritual na lista"). Não cortar do MVP.

3. **`reportMarkdown` é coluna text monolítica.** Desvio consciente do princípio "rows tipadas, sem jsonb-light" — aceitável porque é string gerada por IA, não dado consultável. Documentar como `COMMENT ON COLUMN`.

4. **Indicadores do time depende de dado real.** `sprint_capacity_overview` já existe. Velocity exige derivar de sprints fechadas (count tasks done × FP). Validar dados antes da tool prometer o que não dá pra entregar.

5. **`closed → reopen` não existe.** PM Review published continua editável (PM pode adicionar notes, regerar report). Se PM quiser "começar do zero", abre outro PM Review da semana? UNIQUE proíbe. **Decisão:** edição é suficiente; "começar do zero" = dismissar notes em massa e regerar report.

6. **Prompt branch em arquivo separado.** `prompt.ts` (planning) + `prompt-pm-review.ts`. Se Daily entrar como 3º ritual, valida o padrão; senão refatora pra arquivo único com seções.

## Fora do escopo (fases futuras)

- **Cron pra criar PM Review automático** toda segunda às 9h (manual no MVP).
- **Comparativo semana-a-semana** ("o risco X persiste há 3 semanas"). Só faz sentido com 3+ reports históricos.
- **Wiki section auto-gerada** (`weekly_status`) — Fase 3 do meetings-reorg ([[project_meetings_reorg]]) — pode consumir os PM Reviews quando chegar.
- **Tab dedicada "PM Reviews" no projeto** — por ora dentro de Rituais; promove só se virar dor.
- **Overview agregado no portfólio** (todos PM Reviews da semana num só lugar) — depende da Fase 3 de meetings-reorg.

## Princípio final

PM Review é um **report sempre disponível**, não uma reunião. A reunião humana é insumo (linkada via transcript), não a essência. Se em qualquer fase de execução parecer que estamos rebatizando "ata semanal", parar e revisar — o valor é a síntese estruturada da Vitoria, não o evento.
