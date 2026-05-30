# PRD — ContextSource Unificada (transcripts + planilhas + GitHub)

**Status:** backlog
**Autor:** João (capturado por Claude em 2026-05-29)
**Parent / relacionados:** [prd-context-import-unified](../blocked/prd-context-import-unified.md) (UI primitivo, fase anterior), [prd-vitor-output-as-prd](./prd-vitor-output-as-prd.md), [[project-transcript-ssot]]

---

## §1 Problema

1. **Cada tipo de fonte de contexto tem schema próprio.** Transcripts vivem em `TranscriptRef` + `DesignSessionTranscriptLink` + `PMReviewTranscriptLink`. Meetings em PM Review usam `PMReviewMeetingLink`. Planilhas e GitHub **não existem como fonte linkável** — usuário só consegue colar texto no chat.
2. **Integrações novas duplicam código por agente.** Pra adicionar planilha hoje, teria que: criar tabela `SpreadsheetRef` + link tables `DSSpreadsheetLink` e `PMReviewSpreadsheetLink` + tool específica em cada agente + UI custom. Próxima integração (GitHub) repete tudo. Impossível de manter.
3. **Vitor não tem nenhuma fonte além de transcript + arquivos no chat.** Pra rodar discovery sobre features já existentes, precisa olhar GitHub. Pra entender métricas de cliente, precisa olhar planilha. Hoje o usuário cola tudo manualmente.
4. **GitHub já funciona em prod via Composio** ([src/lib/composio/client.ts](../../src/lib/composio/client.ts) com toolkit=`github`, OAuth por usuário). Vitoria recebe `GITHUB_*` tools via `getUserTools(memberId, ["github"])`. Falta: deixar o **mesmo** acervo de tools disponível pro Vitor e expor PR/repo/issue como **fonte linkável** (não só tool ad-hoc).

## §2 Solução em uma frase

Consolidar `TranscriptRef` (e tudo que linka transcript/meeting) em **`ContextSource` polimorfo** com `kind ∈ {transcript, meeting, spreadsheet, github_repo, github_pr, github_issue}`, link tables únicos por agente, tool `read_context_source` que despacha por kind, e UI da `ContextInsumosSheet` com filtro por kind + "Importar novo" multi-tipo.

## §3 Não-objetivos

- **Não** suporta arquivo no GitHub (descartado em decisão).
- **Não** suporta Notion database (descartado em decisão).
- **Não** implementa refresh schedulado de Sheets/GitHub — só refresh manual via endpoint.
- **Não** muda a UX do Vitor pre-work composer (paperclip/mic continuam pra upload one-shot de arquivos não-tabulares).
- **Não** mexe na entidade `Meeting` em si — vira ContextSource via projeção (externalId aponta pro Meeting row), mas a tabela Meeting fica intacta.
- **Não** implementa OAuth flow novo — GitHub usa `GITHUB_TOKEN` env var (PAT) na Fase 1; OAuth por usuário fica pra Fase 2.

## §4 Personas e jornada

- **PM (João, Vitor pré-work):** "Tô fazendo discovery do feature X. O cliente mandou uma planilha de uso. Quero linkar essa planilha à DS, pedir pro Vitor 'olhe essa planilha e identifique padrões de uso'. Hoje cópio-e-colo no chat — bagunça a janela de contexto e perco a referência."
- **PM (João, Vitoria PM Review):** "Esta semana o time mexeu nos PRs #142 e #144. Quero linkar esses PRs ao PM Review, Vitoria lê os diffs e descreve o trabalho realizado no report semanal. Hoje copio diff manualmente."
- **Dev (Claude/futuro PR):** "Preciso adicionar 'documento Notion' como nova fonte. Quero adicionar `kind='notion'`, um adapter, e pronto — sem mexer em schema, link tables, ou nas UIs de Vitor/Vitoria."

## §5 Decisões fixadas

| Dn | Decisão | Por quê |
|----|---------|---------|
| D1 | Tabela `ContextSource` substitui `TranscriptRef`. Migration consolida tudo. | Nome reflete o conceito real ("fonte de contexto"). TranscriptRef vira nome legado |
| D2 | `kind` enum: `transcript \| meeting \| spreadsheet_csv \| spreadsheet_gsheets \| github_repo \| github_pr \| github_issue` | Discriminator simples. Sub-tipos de planilha/github separados pra deixar adapter explícito |
| D3 | Coluna `payload jsonb` carrega dados kind-specific (snapshotted CSV, sheet ID, repo full_name, etc.) | Evita N colunas null. Schema da payload validada via Zod no adapter |
| D4 | `fullText` é nullable. Adapters de fontes vivas (Sheets, GitHub) podem deixar null e fetchar via tool. CSV/transcript persiste fullText | Trade off entre custo de storage e custo de fetch |
| D5 | `DesignSessionContextLink` substitui `DesignSessionTranscriptLink` (mesmo shape, weight mantido) | Espelha mudança de TranscriptRef → ContextSource |
| D6 | `PMReviewContextLink` substitui `PMReviewTranscriptLink` + `PMReviewMeetingLink` | Unifica. Meeting vira ContextSource kind='meeting' com externalId apontando pro Meeting row |
| D7 | Tool única `read_context_source({ sourceId })` — dispatch por kind. Vitor e Vitoria recebem a mesma | Plug uma integração nova = ambos enxergam |
| D8 | Endpoints unificados: `POST /api/context-sources`, `POST /api/context-sources/[id]/refresh`, `GET /api/context-sources/[id]/content`, `POST /api/design-sessions/[id]/context/link`, `DELETE /api/design-sessions/[id]/context/[linkId]`, idem `/api/pm-reviews/[id]/context/...` | Endpoints antigos `/transcripts/*` ganham redirect/alias temporário ou são deprecated |
| D9 | GitHub usa **Composio** (toolkit `github`) — integração existente, OAuth por usuário gerenciado pelo Composio. Vitor recebe o mesmo toolset que Vitoria | `src/lib/composio/client.ts` já está em prod. `src/lib/github.ts` (stub legacy) fica intocado/morto, não vira |
| D10 | Spreadsheet Google Sheets também via **Composio** (toolkit `googlesheets`), mesmo padrão OAuth do GitHub. **Opt-in:** se `COMPOSIO_GSHEETS_AUTH_CONFIG_ID` ausente, fluxo de import falha graciosamente ("conecte Google Sheets em /settings") e o resto da feature funciona normal | Reuso máximo do que já existe. Composio gerencia OAuth, schemas, refresh. Sem SA, sem googleapis SDK |
| D10a | CSV upload é independente do Composio — usuário sobe arquivo, fica no Storage Supabase, snapshot estático | Sem dependência externa pra o caso mais comum |
| D11 | UI: `ContextInsumosSheet` ganha tabs `Tudo / Transcripts / Planilhas / GitHub`. ContextLinkList ganha badge `kind`. "Importar novo" vira `DropdownMenu` com 1 item por kind, cada item abre seu modal específico | Consistência visual; modais específicos pq cada kind tem campo diferente |
| D12 | Endpoints antigos `/api/design-sessions/[id]/transcripts/*` e `/api/pm-reviews/[id]/insumos` mantêm shape de resposta retrocompatível filtrando `kind='transcript'` — UI antiga continua funcionando durante migração | Faseamento sem big-bang |
| D13 | Migration faseada: criar tabelas novas → backfillar → switch código → drop tabelas velhas (cada uma em arquivo SQL separado) | AGENTS.md: 1 ALTER ou 1 CREATE TABLE por arquivo. Rollback granular |
| D14 | Sem refresh automático nesta entrega. `POST /[id]/refresh` é manual (botão na UI) | Cron e webhook ficam pra fase 2 |
| D15 | **UI/UX de import é idêntica entre Vitor e Vitoria.** Mesmos componentes (`ContextInsumosSheet`, `ContextLinkList`, `TranscriptModal`, `SpreadsheetModal`, `GithubSourceModal`), mesmo fluxo (tabs por kind → dropdown "Importar novo" → modal → submit → toast). Diferenças permitidas: `scope`, `showWeight`, `scopeLabel`. Nada mais. Wrapper específico por agente é proibido | Usuário aprende o padrão uma vez. Forge multi-agente do Volund depende disso. Ver memory [[feedback-agent-ui-parity]] |

## §6 Arquitetura

```
                           ┌────────────────────────────────────┐
                           │           ContextSource            │
                           │  id, kind, title, externalId,      │
                           │  externalUrl, payload jsonb,       │
                           │  summary, fullText, capturedAt,    │
                           │  projectId, createdBy, …           │
                           └───────┬────────────┬──────────────┘
                                   │            │
                  ┌────────────────┴──┐      ┌──┴──────────────────┐
                  │ DesignSessionCtxLk│      │  PMReviewContextLink│
                  │ sessionId, srcId, │      │  pmReviewId, srcId, │
                  │ weight, addedBy   │      │  weight, addedBy    │
                  └─────────┬─────────┘      └─────────┬───────────┘
                            │                          │
                            ▼                          ▼
                  src/lib/context-sources/  ←── shared layer ──┐
                  ├── adapters/                                 │
                  │   ├── transcript.ts   (fullText em-banco)   │
                  │   ├── meeting.ts      (lookup Meeting row)  │
                  │   ├── csv.ts          (storage blob)        │
                  │   ├── gsheets.ts      (Composio toolkit)    │
                  │   └── github.ts       (Composio toolkit)    │
                  └── read-context-source-tool.ts ─────────┐    │
                                                            │    │
                  ┌─────────────────────────────────────────┘    │
                  │                                              │
        src/lib/agent/agents/vitor/tools.ts   ─────► registra ◄──┤
        src/lib/agent/agents/vitoria/tools.ts ─────► registra ◄──┘

                  src/components/agent/context-import/
                  ├── context-insumos-sheet.tsx  ← ganha tabs/filtro por kind
                  ├── context-link-list.tsx     ← ganha kind badge
                  ├── transcript-modal.tsx      ← existente
                  ├── spreadsheet-modal.tsx     ← NOVO (URL Sheets / Upload CSV)
                  └── github-source-modal.tsx   ← NOVO (URL repo/PR/issue)
```

## §7 Schema

Cada bloco abaixo = 1 migration file em `supabase/migrations/` (1 CREATE/ALTER por arquivo conforme AGENTS.md).

**A. `20260530a_create_context_source.sql`**

```sql
CREATE TYPE public.context_source_kind AS ENUM (
  'transcript', 'meeting',
  'spreadsheet_csv', 'spreadsheet_gsheets',
  'github_repo', 'github_pr', 'github_issue'
);

CREATE TABLE public."ContextSource" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         public.context_source_kind NOT NULL,
  projectId    uuid REFERENCES public."Project"(id) ON DELETE CASCADE,
  title        text NOT NULL,
  externalId   text,
  externalUrl  text,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary      text,
  fullText     text,
  capturedAt   timestamptz,
  createdBy    uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  createdAt    timestamptz NOT NULL DEFAULT now(),
  updatedAt    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "ContextSource_project_kind_idx"
  ON public."ContextSource" (projectId, kind);
CREATE INDEX "ContextSource_kind_externalId_idx"
  ON public."ContextSource" (kind, externalId);

ALTER TABLE public."ContextSource" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ContextSource_select" ON public."ContextSource"
  FOR SELECT TO authenticated
  USING (projectId IS NULL OR public.can_view_project(projectId));

CREATE POLICY "ContextSource_insert" ON public."ContextSource"
  FOR INSERT TO authenticated
  WITH CHECK (projectId IS NULL OR public.can_edit_project(projectId));

CREATE POLICY "ContextSource_update" ON public."ContextSource"
  FOR UPDATE TO authenticated
  USING (projectId IS NULL OR public.can_edit_project(projectId))
  WITH CHECK (projectId IS NULL OR public.can_edit_project(projectId));

CREATE POLICY "ContextSource_delete" ON public."ContextSource"
  FOR DELETE TO authenticated
  USING (projectId IS NULL OR public.can_edit_project(projectId));
```

**B. `20260530b_create_design_session_context_link.sql`**

```sql
CREATE TABLE public."DesignSessionContextLink" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  designSessionId uuid NOT NULL REFERENCES public."DesignSession"(id) ON DELETE CASCADE,
  contextSourceId uuid NOT NULL REFERENCES public."ContextSource"(id) ON DELETE CASCADE,
  weight          text CHECK (weight IN ('primary','supporting','background')),
  addedBy         uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  addedAt         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "DesignSessionContextLink_session_source_key"
    UNIQUE (designSessionId, contextSourceId)
);

CREATE INDEX "DSCtxLink_session_idx" ON public."DesignSessionContextLink" (designSessionId);
CREATE INDEX "DSCtxLink_source_idx"  ON public."DesignSessionContextLink" (contextSourceId);

ALTER TABLE public."DesignSessionContextLink" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dsctxlink_select" ON public."DesignSessionContextLink"
  FOR SELECT TO authenticated
  USING (public.can_view_session(designSessionId));
CREATE POLICY "dsctxlink_insert" ON public."DesignSessionContextLink"
  FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_session(designSessionId));
CREATE POLICY "dsctxlink_update" ON public."DesignSessionContextLink"
  FOR UPDATE TO authenticated
  USING (public.can_edit_session(designSessionId))
  WITH CHECK (public.can_edit_session(designSessionId));
CREATE POLICY "dsctxlink_delete" ON public."DesignSessionContextLink"
  FOR DELETE TO authenticated
  USING (public.can_edit_session(designSessionId));
```

**C. `20260530c_create_pm_review_context_link.sql`**

```sql
CREATE TABLE public."PMReviewContextLink" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pmReviewId      uuid NOT NULL REFERENCES public."PMReview"(id) ON DELETE CASCADE,
  contextSourceId uuid NOT NULL REFERENCES public."ContextSource"(id) ON DELETE CASCADE,
  weight          text CHECK (weight IN ('primary','supporting','background')),
  addedBy         uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  addedAt         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "PMReviewContextLink_review_source_key"
    UNIQUE (pmReviewId, contextSourceId)
);

CREATE INDEX "PMRCtxLink_review_idx" ON public."PMReviewContextLink" (pmReviewId);
CREATE INDEX "PMRCtxLink_source_idx" ON public."PMReviewContextLink" (contextSourceId);

ALTER TABLE public."PMReviewContextLink" ENABLE ROW LEVEL SECURITY;

-- RLS policies análogas a DSCtxLink, dependendo de can_view_pm_review / can_edit_pm_review.
-- (Spec completo: ver story SQL.)
```

**D. `20260530d_backfill_transcripts_into_context_source.sql`**
Idempotente. `INSERT INTO ContextSource (kind='transcript', payload jsonb com source granola/roam/etc, fullText, summary, capturedAt, externalId, externalUrl) SELECT … FROM TranscriptRef`. Mantém `id` preservado pra refs externos seguirem funcionando.

**E. `20260530e_backfill_meetings_into_context_source.sql`**
`INSERT INTO ContextSource (kind='meeting', externalId=meetingId, title, capturedAt=meeting.startsAt, summary=meeting.summary, projectId) SELECT … FROM Meeting WHERE id IN (SELECT meetingId FROM PMReviewMeetingLink)`. Cria projeção; Meeting fica intacto.

**F. `20260530f_backfill_ds_transcript_links.sql`**
`INSERT INTO DesignSessionContextLink (designSessionId, contextSourceId, weight) SELECT designSessionId, transcriptRefId, weight FROM DesignSessionTranscriptLink`.

**G. `20260530g_backfill_pm_review_links.sql`**
Duas inserts no mesmo arquivo (1 atomic step de backfill, exceção justificada): merge de PMReviewTranscriptLink + PMReviewMeetingLink em PMReviewContextLink.

**H. `20260530h_drop_legacy_link_tables.sql`** (rodar SÓ depois do código switch — story final)
`DROP TABLE PMReviewTranscriptLink, PMReviewMeetingLink, DesignSessionTranscriptLink;`. TranscriptRef fica até confirmar nada mais lê (Fase 1.5 drop).

**I. `20260530i_drop_transcript_ref.sql`** (Fase 1.5, opcional na entrega)
`DROP TABLE TranscriptRef;` — só após `grep -r TranscriptRef src/` retornar zero.

## §8 APIs

| Método | Path | Contrato | Status |
|--------|------|----------|--------|
| POST | `/api/context-sources` | body `{ kind, title?, externalUrl?, payload? }` ou multipart pra CSV. Retorna `{ id, status: 'ready' \| 'fetching' }`. Async pra GitHub/GSheets | NOVO |
| GET | `/api/context-sources/[id]` | metadata + summary | NOVO |
| GET | `/api/context-sources/[id]/content` | `{ fullText, snapshotAt }` — tool chama aqui | NOVO |
| POST | `/api/context-sources/[id]/refresh` | re-fetch fonte viva. Retorna 202 + jobId pra GSheets/GitHub | NOVO |
| POST | `/api/design-sessions/[id]/context/link` | `{ contextSourceId, weight? }` → 201 | NOVO |
| DELETE | `/api/design-sessions/[id]/context/[linkId]` | 204 | NOVO |
| GET | `/api/design-sessions/[id]/context` | `{ linked: ContextSourceSummary[], counts: { transcript, spreadsheet_csv, … } }` | NOVO |
| POST | `/api/pm-reviews/[id]/context/link` | idem DS | NOVO |
| DELETE | `/api/pm-reviews/[id]/context/[linkId]` | 204 | NOVO |
| GET | `/api/pm-reviews/[id]/context` | linked + pool por projeto | NOVO |
| GET | `/api/design-sessions/[id]/transcripts` | retorna shape antigo filtrando `kind='transcript'` | DEPRECATED — mantido pra UI antiga ainda não migrada |
| GET | `/api/pm-reviews/[id]/insumos` | retorna shape antigo composto de transcripts + meetings | DEPRECATED idem |

**Tool agent-side:** `read_context_source({ sourceId })` → `{ id, kind, title, fullText, summary, capturedAt, externalUrl }`. Dispatch por kind chama o adapter.

## §9 UX

```
┌─ ContextInsumosSheet (scope='session', Vitor) ────────────────┐
│  Insumos desta DS                                              │
│  [Tudo (5)] [🎙 Transcripts (3)] [📊 Planilhas (1)] [🐙 GitHub (1)] │
│                                                                │
│  🎙 Daily 28/05            Granola         capturado 28/05  [x]│
│  🎙 Roam: Onboarding       Roam            capturado 12/04  [x]│
│  🎙 Reunião com Bia        Granola         capturado 26/05  [x]│
│  📊 Métricas Q1            Google Sheets   atualizado 27/05 [↻][x]│
│  🐙 perke/volund#142       PR              atualizado 28/05 [↻][x]│
│                                                                │
│  [+ Importar novo ▼]                                           │
│       ├── 🎙 Transcript (Roam/Granola)                         │
│       ├── 📊 Planilha (Google Sheets URL ou upload CSV)         │
│       └── 🐙 GitHub (repo / PR / issue URL)                     │
└────────────────────────────────────────────────────────────────┘
```

Modais separados por kind (`spreadsheet-modal.tsx`, `github-source-modal.tsx`) — cada um pede só os campos do tipo dele. TranscriptModal já existe e fica intacto.

**Regra de paridade (D15):** o desenho acima é **exatamente o mesmo** no Vitor pre-work e na Vitoria PM Review. Mesmas tabs, mesmo dropdown "Importar novo", mesmos modais, mesma ordem visual. Só muda: rótulo do header ("Insumos desta DS" vs "Insumos do projeto"), presença da seção Pool (Vitor session-scoped = sem pool; Vitoria project-scoped = mostra pool), e badge de weight (Vitoria mostra; Vitor não). Tudo via prop, sem componente derivado.

## §10 Integrações

- **Vitor agent** ([src/lib/agent/agents/vitor/](../../src/lib/agent/agents/vitor/)) — substitui `read_transcript_content` por `read_context_source`. Recebe contexto linkado já filtrado por DS (scope='session'). Ganha acesso ao toolset Composio do usuário (mesmo que Vitoria) via `getUserTools(memberId, connectedToolkits)`.
- **Vitoria agent** ([src/lib/agent/agents/vitoria/](../../src/lib/agent/agents/vitoria/)) — idem. GITHUB_* tools no prompt continuam (Composio); `read_context_source` é preferida pra fontes linkadas.
- **`src/lib/composio/client.ts`** — expandir tipo `Array<"github">` pra aceitar `"googlesheets"` (toolkit já existe no catálogo Composio). Sem mudança estrutural.
- **`src/lib/github.ts`** — stub legacy, **NÃO USADO**. Não mexer. (Cleanup opcional em fase posterior.)
- **Adapters** em `src/lib/context-sources/adapters/`:
  - `github.ts` — chama Composio (tools `GITHUB_GET_REPOSITORY_CONTENT`, `GITHUB_GET_PULL_REQUEST`, `GITHUB_GET_AN_ISSUE`) via cliente Composio do member. fullText monta resposta serializada.
  - `gsheets.ts` — análogo, tool `GOOGLESHEETS_GET_SPREADSHEET_VALUES` etc. Se conexão ausente, lança `ComposioConnectionMissing("googlesheets")` → endpoint retorna 412 com `connectUrl`.
- **Storage bucket** novo `context-source-files` no Supabase pra blobs de CSV.

## §11 Faseamento

**Fase 1 (esta entrega):**
- Schema novo + backfill de transcripts + meetings.
- Tool unificada `read_context_source` plugada em Vitor e Vitoria.
- UI multi-kind em `ContextInsumosSheet`.
- Adapters: transcript (já tem, reembala), meeting (lookup), csv (upload+parse), gsheets (Sheets API), github (Octokit real).
- Endpoints novos; endpoints antigos viram aliases compatíveis.
- Drop das link tables antigas no final (story H).

**Fase 1 entrega mais que o sistema atual:** transcripts continuam funcionando + 4 tipos novos de fonte + GitHub real (hoje é stub).

**Fase 2 (fora):** refresh automático (cron/webhook), OAuth por usuário (Google + GitHub), file source no GitHub, Notion.

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Backfill perder linha (TranscriptRef → ContextSource) | Baixa | Alto | Story de verificação: `count(*) before vs after` em assert SQL. Backfill preserva id |
| RLS quebrar após renomear link tables | Média | Alto | Cada migration de link table inclui RLS policies espelho. Smoke SQL: `SELECT count(*) AS r FROM DesignSessionContextLink WHERE designSessionId='<known>'` com role authenticated |
| Vitoria regradir por perder GITHUB_* tools | Baixa | Médio | GITHUB_* via Composio continuam disponíveis no toolset; read_context_source é preferida pra fontes linkadas mas não substitui as tools ad-hoc |
| Member sem conexão Composio (GitHub ou GSheets) | Alta | Baixo | Adapter lança ComposioConnectionMissing; UI exibe banner "Conectar X em /settings" com link direto |
| Tokens estourar em planilha grande / repo grande | Média | Médio | `fullText` em adapter trunca em 50k chars, sumariza resto; tool retorna `truncated: true` |
| Migration grande romper algo em prod | Média | Alto | Cada story = 1 migration arquivo. Backfill é idempotente (re-rodável). Drop só na story final, manual approval |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| 100% de TranscriptRef migrados | `SELECT count(*) FROM TranscriptRef` vs `SELECT count(*) FROM ContextSource WHERE kind='transcript'` |
| Vitor consegue ler ≥ 3 tipos de fonte numa única DS | Query `AgentMessage WHERE agent='vitor' AND toolCalls @> '[{"name":"read_context_source"}]'` agrupada por kind dos sources lidos |
| 0 duplicações de tabela (TranscriptLink + transcriptLink) | `grep -rE "TranscriptLink\|MeetingLink" src/` retorna apenas referências em deprecated routes |
| Tempo médio de import de planilha < 5s p50 | Log de duração no endpoint POST /context-sources |
| GitHub source funcionando via Composio em Vitor (não só Vitoria) | Smoke: linkar PR ao Vitor pre-work, pedir "leia esse PR" → tool call read_context_source observada nos logs |
| Composio toolkit list aceita googlesheets | `grep -c '"googlesheets"' src/lib/composio/client.ts` ≥ 2 |

## §14 Open questions

(vazio — pendências viram Fase 2)

## §15 Referências

- [src/components/agent/context-import/](../../src/components/agent/context-import/) — primitivo extraído fase anterior
- [src/lib/agent/tools/read-transcript-content.ts](../../src/lib/agent/tools/read-transcript-content.ts) — tool a generalizar
- [src/lib/composio/client.ts](../../src/lib/composio/client.ts) — integração Composio existente, base pra adapters GitHub/GSheets
- [src/lib/composio/manifest.ts](../../src/lib/composio/manifest.ts) — exemplo de uso de Composio + GitHub em prod
- [supabase/migrations/20260529b_design_session_transcript_link.sql](../../supabase/migrations/20260529b_design_session_transcript_link.sql), [20260529d_pm_review.sql](../../supabase/migrations/20260529d_pm_review.sql) — schemas a consolidar
- Memory: [[project-vitor-context-pool]], [[project-transcript-ssot]], [[project-pm-review]]

---

## §16 Stories implementáveis

```yaml
- id: CTXSRC-001
  title: Migration A — criar tabela ContextSource + enum + RLS
  description: |
    Criar supabase/migrations/20260530a_create_context_source.sql com CREATE TYPE
    context_source_kind, CREATE TABLE ContextSource com colunas/índices/RLS conforme §7-A.
    Rodar via `psql "$DIRECT_URL" -f ...`. Atualizar src/lib/supabase/database.types.ts
    (regenerar via `pnpm db:types` ou edit manual).
  acceptanceCriteria:
    - "Migration file existe em supabase/migrations/"
    - "Tabela ContextSource criada no DB"
    - "Enum context_source_kind com 7 valores"
    - "RLS habilitada com 4 policies (select/insert/update/delete)"
    - "database.types.ts contém ContextSource"
  verifiable:
    - kind: sql
      command_or_query: "test -f supabase/migrations/20260530a_create_context_source.sql && echo ok"
      expected: "ok"
    - kind: sql
      command_or_query: "source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql \"$DIRECT_URL\" -t -c \"SELECT to_regclass('public.\\\"ContextSource\\\"')::text\""
      expected: 'regex:ContextSource'
    - kind: sql
      command_or_query: "source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql \"$DIRECT_URL\" -t -c \"SELECT count(*) FROM pg_policies WHERE tablename='ContextSource'\""
      expected: "regex:^\\s*4"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 30
  touches:
    - supabase/migrations/20260530a_create_context_source.sql
    - src/lib/supabase/database.types.ts

- id: CTXSRC-002
  title: Migration B — DesignSessionContextLink + RLS
  description: |
    Criar 20260530b_create_design_session_context_link.sql conforme §7-B. Rodar via psql.
    Atualizar database.types.ts.
  acceptanceCriteria:
    - "Tabela criada com FK em DesignSession + ContextSource, unique constraint"
    - "RLS habilitada com 4 policies"
  verifiable:
    - kind: sql
      command_or_query: "test -f supabase/migrations/20260530b_create_design_session_context_link.sql && echo ok"
      expected: "ok"
    - kind: sql
      command_or_query: "source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql \"$DIRECT_URL\" -t -c \"SELECT to_regclass('public.\\\"DesignSessionContextLink\\\"')::text\""
      expected: 'regex:DesignSessionContextLink'
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [CTXSRC-001]
  estimateMinutes: 25
  touches:
    - supabase/migrations/20260530b_create_design_session_context_link.sql
    - src/lib/supabase/database.types.ts

- id: CTXSRC-003
  title: Migration C — PMReviewContextLink + RLS
  description: |
    Criar 20260530c_create_pm_review_context_link.sql análogo ao B, com can_view_pm_review /
    can_edit_pm_review (criar helpers SQL se não existirem espelhando padrão de can_edit_session).
  acceptanceCriteria:
    - "Tabela criada"
    - "RLS habilitada com 4 policies"
    - "Helpers can_view_pm_review e can_edit_pm_review existem (CREATE OR REPLACE FUNCTION)"
  verifiable:
    - kind: sql
      command_or_query: "test -f supabase/migrations/20260530c_create_pm_review_context_link.sql && echo ok"
      expected: "ok"
    - kind: sql
      command_or_query: "source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql \"$DIRECT_URL\" -t -c \"SELECT to_regclass('public.\\\"PMReviewContextLink\\\"')::text\""
      expected: 'regex:PMReviewContextLink'
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [CTXSRC-001]
  estimateMinutes: 25
  touches:
    - supabase/migrations/20260530c_create_pm_review_context_link.sql
    - src/lib/supabase/database.types.ts

- id: CTXSRC-004
  title: Migration D — backfill TranscriptRef → ContextSource
  description: |
    Criar 20260530d_backfill_transcripts_into_context_source.sql idempotente
    (INSERT ... ON CONFLICT (id) DO NOTHING). Preservar id pra refs externos.
    Mapear: kind='transcript', payload jsonb={source, roamId?, ...}, fullText, summary, capturedAt.
  acceptanceCriteria:
    - "Count: SELECT count(*) FROM TranscriptRef == SELECT count(*) FROM ContextSource WHERE kind='transcript'"
    - "ID preservation: cada TranscriptRef.id existe em ContextSource com mesmo id e kind='transcript' (FKs externas que apontavam pra TranscriptRef.id continuam válidas)"
    - "Migration é idempotente (segunda rodada não duplica)"
  verifiable:
    - kind: sql
      command_or_query: "test -f supabase/migrations/20260530d_backfill_transcripts_into_context_source.sql && echo ok"
      expected: "ok"
    - kind: sql
      command_or_query: "source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql \"$DIRECT_URL\" -t -c \"SELECT (SELECT count(*) FROM \\\"TranscriptRef\\\") = (SELECT count(*) FROM \\\"ContextSource\\\" WHERE kind='transcript')\""
      expected: "regex:t"
    - kind: sql
      command_or_query: "source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql \"$DIRECT_URL\" -t -c \"SELECT (SELECT count(*) FROM \\\"TranscriptRef\\\") = (SELECT count(*) FROM \\\"ContextSource\\\" cs JOIN \\\"TranscriptRef\\\" t ON cs.id = t.id WHERE cs.kind = 'transcript')\""
      expected: "regex:t"
  dependsOn: [CTXSRC-001]
  estimateMinutes: 30
  touches:
    - supabase/migrations/20260530d_backfill_transcripts_into_context_source.sql

- id: CTXSRC-005
  title: Migration E — backfill Meetings linkados → ContextSource
  description: |
    20260530e_backfill_meetings_into_context_source.sql. Cria ContextSource kind='meeting'
    para cada Meeting referenciado em PMReviewMeetingLink. externalId=meetingId, title=meeting.title,
    capturedAt=meeting.startsAt, summary=meeting.summary, projectId=meeting.projectId. Idempotente
    via ON CONFLICT.
  acceptanceCriteria:
    - "Count: distinct meetingId em PMReviewMeetingLink == count em ContextSource kind='meeting'"
    - "Idempotente"
  verifiable:
    - kind: sql
      command_or_query: "test -f supabase/migrations/20260530e_backfill_meetings_into_context_source.sql && echo ok"
      expected: "ok"
    - kind: sql
      command_or_query: "source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql \"$DIRECT_URL\" -t -c \"SELECT (SELECT count(DISTINCT \\\"meetingId\\\") FROM \\\"PMReviewMeetingLink\\\") = (SELECT count(*) FROM \\\"ContextSource\\\" WHERE kind='meeting')\""
      expected: "regex:t"
  dependsOn: [CTXSRC-001]
  estimateMinutes: 25
  touches:
    - supabase/migrations/20260530e_backfill_meetings_into_context_source.sql

- id: CTXSRC-006
  title: Migration F — backfill DS transcript links
  description: |
    20260530f_backfill_ds_transcript_links.sql. INSERT em DesignSessionContextLink (sessionId, contextSourceId=transcriptRefId, weight, addedAt) SELECT FROM DesignSessionTranscriptLink. Idempotente.
  acceptanceCriteria:
    - "Count: DesignSessionTranscriptLink == DesignSessionContextLink (count)"
  verifiable:
    - kind: sql
      command_or_query: "source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql \"$DIRECT_URL\" -t -c \"SELECT (SELECT count(*) FROM \\\"DesignSessionTranscriptLink\\\") = (SELECT count(*) FROM \\\"DesignSessionContextLink\\\")\""
      expected: "regex:t"
  dependsOn: [CTXSRC-002, CTXSRC-004]
  estimateMinutes: 20
  touches:
    - supabase/migrations/20260530f_backfill_ds_transcript_links.sql

- id: CTXSRC-007
  title: Migration G — backfill PM Review links (transcript + meeting → context)
  description: |
    20260530g_backfill_pm_review_links.sql. Dois INSERTs (justified atomic batch):
    transcript links → PMReviewContextLink (pmReviewId, transcriptRefId, weight);
    meeting links → PMReviewContextLink resolvendo meetingId → contextSourceId via
    JOIN com ContextSource WHERE kind='meeting' AND externalId=meetingId. Idempotente.
  acceptanceCriteria:
    - "Count: (PMReviewTranscriptLink + PMReviewMeetingLink) == PMReviewContextLink"
  verifiable:
    - kind: sql
      command_or_query: "source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql \"$DIRECT_URL\" -t -c \"SELECT ((SELECT count(*) FROM \\\"PMReviewTranscriptLink\\\") + (SELECT count(*) FROM \\\"PMReviewMeetingLink\\\")) = (SELECT count(*) FROM \\\"PMReviewContextLink\\\")\""
      expected: "regex:t"
  dependsOn: [CTXSRC-003, CTXSRC-004, CTXSRC-005]
  estimateMinutes: 30
  touches:
    - supabase/migrations/20260530g_backfill_pm_review_links.sql

- id: CTXSRC-008
  title: Adapters base + read_context_source tool (factory)
  description: |
    Criar src/lib/context-sources/adapters/{transcript,meeting,csv,gsheets,github}.ts.
    Cada adapter exporta { resolveContent(supabase, source): Promise<{fullText, snapshotAt}> }.
    Stub para csv/gsheets/github nesta story — implementação real nas próximas.
    Criar src/lib/agent/tools/read-context-source.ts com factory createReadContextSourceTool({supabase}).
    Tool valida Zod schema { sourceId: uuid }, fetcha ContextSource, dispatcha por kind.
    Manter src/lib/agent/tools/read-transcript-content.ts como wrapper que chama read-context-source com source filtered pra kind=transcript (back-compat até remover).
  acceptanceCriteria:
    - "Arquivos existem"
    - "tsc passa"
    - "read_context_source tool registrável (assinatura compatível com Vitor/Vitoria toolset)"
  verifiable:
    - kind: sql
      command_or_query: "test -f src/lib/agent/tools/read-context-source.ts && echo ok"
      expected: "ok"
    - kind: sql
      command_or_query: "ls src/lib/context-sources/adapters/ | grep -c '\\.ts$'"
      expected: "regex:^[5-9]"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [CTXSRC-001]
  estimateMinutes: 30
  touches:
    - src/lib/context-sources/adapters/transcript.ts
    - src/lib/context-sources/adapters/meeting.ts
    - src/lib/context-sources/adapters/csv.ts
    - src/lib/context-sources/adapters/gsheets.ts
    - src/lib/context-sources/adapters/github.ts
    - src/lib/agent/tools/read-context-source.ts

- id: CTXSRC-009
  title: GitHub adapter via Composio (reuse)
  description: |
    src/lib/context-sources/adapters/github.ts: parsear externalUrl (regex pra
    github.com/{owner}/{repo}, .../pull/{n}, .../issues/{n}), dispatchar por kind
    (github_repo|pr|issue). Chamar tools Composio via cliente do member: GITHUB_GET_REPOSITORY_CONTENT
    (pra repo, busca README + estrutura top-level), GITHUB_GET_PULL_REQUEST (diff + body + comments),
    GITHUB_GET_AN_ISSUE (body + comments). Retornar fullText serializado em markdown.
    Se member não tem GitHub conectado (composio status retorna 'pending'/'failed'), lançar
    ComposioConnectionMissing("github") → endpoint retorna 412 + connectUrl.
    NÃO mexer em src/lib/github.ts (legacy stub, fora de uso).
  acceptanceCriteria:
    - "adapters/github.ts existe e importa de @/lib/composio/client"
    - "Suporta os 3 kinds (repo/pr/issue) via parsing de URL"
    - "Lança ComposioConnectionMissing se conexão ausente"
    - "tsc passa"
  verifiable:
    - kind: sql
      command_or_query: "grep -c 'from \"@/lib/composio' src/lib/context-sources/adapters/github.ts"
      expected: "regex:^[1-9]"
    - kind: sql
      command_or_query: "grep -cE 'github_(repo|pr|issue)' src/lib/context-sources/adapters/github.ts"
      expected: "regex:^[3-9]"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [CTXSRC-008]
  estimateMinutes: 25
  touches:
    - src/lib/context-sources/adapters/github.ts

- id: CTXSRC-010
  title: CSV adapter + GSheets via Composio (opt-in, gated)
  description: |
    CSV (obrigatório): src/lib/context-sources/adapters/csv.ts usa csv-parse (instalar) pra parsear
    blob do bucket Supabase 'context-source-files'. Bucket criado via SQL atomic (migration j).
    fullText = primeiras N linhas em markdown (estilo tabular). Snapshot — sem refresh.

    GSheets (opt-in via Composio): adapters/gsheets.ts adiciona "googlesheets" ao tipo de toolkit
    em src/lib/composio/client.ts (expandir Array<"github"> pra Array<"github"|"googlesheets">).
    Adapter chama GOOGLESHEETS_GET_SPREADSHEET_VALUES via cliente Composio. Se
    COMPOSIO_GSHEETS_AUTH_CONFIG_ID ausente OU member sem conexão, lança ComposioConnectionMissing.

    NÃO instalar googleapis SDK direto — tudo via Composio.
  acceptanceCriteria:
    - "csv-parse em package.json"
    - "Bucket context-source-files existe"
    - "composio/client.ts aceita 'googlesheets' como toolkit"
    - "adapters/gsheets.ts lança ComposioConnectionMissing quando connection ausente"
    - "tsc passa"
  verifiable:
    - kind: sql
      command_or_query: "grep -c '\"csv-parse\"' package.json"
      expected: "regex:^[1-9]"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql \"$DIRECT_URL\" -t -c \"SELECT count(*) FROM storage.buckets WHERE id='context-source-files'\""
      expected: "regex:^\\s*1"
    - kind: sql
      command_or_query: "grep -c 'googlesheets' src/lib/composio/client.ts"
      expected: "regex:^[2-9]"
  dependsOn: [CTXSRC-008]
  estimateMinutes: 30
  touches:
    - src/lib/context-sources/adapters/csv.ts
    - src/lib/context-sources/adapters/gsheets.ts
    - src/lib/composio/client.ts
    - package.json
    - supabase/migrations/20260530j_create_context_source_files_bucket.sql

- id: CTXSRC-011
  title: API endpoints unificados de ContextSource
  description: |
    Criar src/app/api/context-sources/route.ts (POST) e [id]/{route.ts(GET), content/route.ts(GET),
    refresh/route.ts(POST)}.
    Criar src/app/api/design-sessions/[id]/context/{route.ts(GET), link/route.ts(POST),
    [linkId]/route.ts(DELETE)}.
    Criar src/app/api/pm-reviews/[id]/context/* idem.
    Validação Zod no body. RLS via supabase client autenticado (cookies-based).
    Endpoint POST /context-sources dispatcha por kind no body: { kind, externalUrl?, title? }
    + multipart pra CSV (use formidable ou Next.js Request.formData()).
  acceptanceCriteria:
    - "Endpoints novos respondem"
    - "Validação Zod presente"
    - "tsc passa"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "find src/app/api/context-sources src/app/api/design-sessions/*/context src/app/api/pm-reviews/*/context -name 'route.ts' 2>/dev/null | wc -l | tr -d ' '"
      expected: "regex:^[5-9]"
  dependsOn: [CTXSRC-008, CTXSRC-002, CTXSRC-003]
  estimateMinutes: 30
  touches:
    - src/app/api/context-sources/route.ts
    - src/app/api/context-sources/[id]/route.ts
    - src/app/api/context-sources/[id]/content/route.ts
    - src/app/api/context-sources/[id]/refresh/route.ts
    - src/app/api/design-sessions/[id]/context/route.ts
    - src/app/api/design-sessions/[id]/context/link/route.ts
    - src/app/api/design-sessions/[id]/context/[linkId]/route.ts
    - src/app/api/pm-reviews/[id]/context/route.ts
    - src/app/api/pm-reviews/[id]/context/link/route.ts
    - src/app/api/pm-reviews/[id]/context/[linkId]/route.ts

- id: CTXSRC-012
  title: UI — ContextInsumosSheet com tabs por kind + modais de import
  description: |
    **Template visual:** modele o look-and-feel após [pm-review-insumos-sheet.tsx](../../src/components/pm-review/pm-review-insumos-sheet.tsx)
    e [pm-review-ribbon.tsx](../../src/components/pm-review/pm-review-ribbon.tsx) — espelhe StatusChip,
    tamanhos de fonte (text-xs), bordas (rounded-md border bg-card), dark mode tokens. Não invente
    estilo novo: reuso visual é parte da regra D15.

    Em src/components/agent/context-import/:
    1. context-link-list.tsx: aceita prop kind no item; renderiza badge inline (🎙 / 📊 / 🐙).
    2. context-insumos-sheet.tsx: adiciona Tabs (shadcn) no topo (Tudo / Transcripts / Planilhas / GitHub).
       Filtra linkedItems por kind selecionado. Counter por aba.
    3. context-insumos-sheet.tsx: substitui botão "Importar novo" por DropdownMenu com itens
       (Transcript / Planilha / GitHub) abrindo modais respectivos via callbacks.
    4. spreadsheet-modal.tsx (NOVO): toggle CSV-upload | Google Sheets URL. CSV: input file.
       GSheets: URL input. Se member sem conexão Composio, mostra banner "Conectar Google Sheets em /settings" com link.
    5. github-source-modal.tsx (NOVO): URL input. Detecta kind do path (repo/pull/issues).
       Preview metadata após submit (title pulled from API). Se member sem conexão GitHub, banner análogo.
  acceptanceCriteria:
    - "Arquivos modal existem em src/components/agent/context-import/"
    - "ContextInsumosSheet renderiza tabs (visible em desktop)"
    - "Modais NÃO existem em src/components/pm-review/ ou src/components/design-session/ (forçar reuso)"
    - "tsc passa"
  verifiable:
    - kind: sql
      command_or_query: "test -f src/components/agent/context-import/spreadsheet-modal.tsx && test -f src/components/agent/context-import/github-source-modal.tsx && echo ok"
      expected: "ok"
    - kind: sql
      command_or_query: "find src/components/pm-review src/components/design-session -name 'spreadsheet-modal*' -o -name 'github-source-modal*' 2>/dev/null | wc -l | tr -d ' '"
      expected: "0"
    - kind: sql
      command_or_query: "grep -c 'Tabs\\|TabsList' src/components/agent/context-import/context-insumos-sheet.tsx"
      expected: "regex:^[1-9]"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [CTXSRC-011]
  estimateMinutes: 30
  touches:
    - src/components/agent/context-import/context-link-list.tsx
    - src/components/agent/context-import/context-insumos-sheet.tsx
    - src/components/agent/context-import/spreadsheet-modal.tsx
    - src/components/agent/context-import/github-source-modal.tsx

- id: CTXSRC-013
  title: Wiring — Vitor + Vitoria consomem read_context_source + endpoints novos
  description: |
    Vitor (src/lib/agent/agents/vitor/tools.ts + index.ts + prompt.ts):
    - Substituir read_transcript_content por read_context_source no toolset.
    - System prompt: bloco "Fontes de contexto linkadas" lista por kind (🎙 transcript / 📊 planilha / 🐙 github), instruir uso da tool com sourceId.
    - listSessionTranscripts → listSessionContextSources (novo helper) buscando de DesignSessionContextLink.
    Vitoria (idem em vitoria/):
    - read_context_source registrada.
    - prompt: bloco análogo.
    - GITHUB_* tools mantidas no prompt mas com nota "prefira read_context_source pra repos linkados".

    **UI Vitor pre-work (pre-work-step.tsx):**
    - Trocar fetcher pra /api/design-sessions/[id]/context (substitui /transcripts).
    - **NÃO reintroduzir ContextRibbon como linha separada.** A ribbon do Vitor é de 2 linhas
      (DSRibbon + StepSubHeader). O chip "[🔗 N insumos]" é injetado no StepSubHeader via
      `useProvideStepActions(...)` (padrão já implementado, ver
      [src/components/design-session/ribbon/step-actions-context.tsx](../../src/components/design-session/ribbon/step-actions-context.tsx)).
      Manter exatamente esse padrão; ajustar só o contador pra somar todos os kinds.
    - Se modal precisar abrir, callback do chip seta `insumosOpen=true` → ContextInsumosSheet.

    **UI Vitoria PM Review (pm-review-insumos-sheet.tsx + pm-review-ribbon.tsx):**
    - Trocar fetcher pra /api/pm-reviews/[id]/context.
    - Botão "Insumos" na ribbon mantém posição atual (espelha [pm-review-ribbon.tsx:101-112](../../src/components/pm-review/pm-review-ribbon.tsx#L101-L112)).
  acceptanceCriteria:
    - "vitor/tools.ts importa read_context_source"
    - "vitoria/tools.ts idem"
    - "Prompts contêm 'read_context_source'"
    - "pre-work-step.tsx NÃO renderiza ContextRibbon como elemento JSX (regra D15 + paridade visual com Vitoria)"
    - "pre-work-step.tsx usa useProvideStepActions pra injetar o chip de insumos"
    - "tsc passa"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: sql
      command_or_query: "grep -c 'read_context_source' src/lib/agent/agents/vitor/tools.ts src/lib/agent/agents/vitoria/tools.ts | awk -F: '{s+=$2} END {print s}'"
      expected: "regex:^[2-9]"
    - kind: sql
      command_or_query: "grep -c 'read_context_source' src/lib/agent/agents/vitor/prompt.ts src/lib/agent/agents/vitoria/prompt.ts | awk -F: '{s+=$2} END {print s}'"
      expected: "regex:^[2-9]"
    - kind: sql
      command_or_query: "grep -cE '<ContextRibbon\\b' src/components/design-session/pre-work-step.tsx"
      expected: "0"
    - kind: sql
      command_or_query: "grep -c 'useProvideStepActions' src/components/design-session/pre-work-step.tsx"
      expected: "regex:^[1-9]"
  dependsOn: [CTXSRC-011, CTXSRC-012]
  estimateMinutes: 30
  touches:
    - src/lib/agent/agents/vitor/tools.ts
    - src/lib/agent/agents/vitor/index.ts
    - src/lib/agent/agents/vitor/prompt.ts
    - src/lib/agent/agents/vitoria/tools.ts
    - src/lib/agent/agents/vitoria/prompt.ts
    - src/components/design-session/pre-work-step.tsx
    - src/components/pm-review/pm-review-insumos-sheet.tsx

- id: CTXSRC-015
  title: Parity check — Vitor e Vitoria consomem os MESMOS primitivos
  description: |
    Verificação automatizada da regra D15. Garante que pre-work-step (Vitor) e
    pm-review-insumos-sheet (Vitoria) importam exatamente ContextInsumosSheet do
    mesmo path (@/components/agent/context-import/) e que não existem cópias
    espelho dos modais em pastas específicas por agente.

    Também verifica visualmente (manual_browser) que o sheet aberto pelo Vitor pre-work
    é estruturalmente igual ao da Vitoria PM Review: mesmas tabs, mesmo dropdown
    "Importar novo", mesmos modais. Diferenças permitidas: rótulo do header, presença
    do pool, weight badge.
  acceptanceCriteria:
    - "pre-work-step.tsx importa ContextInsumosSheet de @/components/agent/context-import"
    - "pm-review-insumos-sheet.tsx importa ContextInsumosSheet do MESMO path"
    - "Zero arquivos *-modal.tsx em src/components/{pm-review,design-session}/"
    - "Smoke browser: abrir sheet em ambos, screenshots têm mesma estrutura"
  verifiable:
    - kind: sql
      command_or_query: "grep -c 'from \"@/components/agent/context-import' src/components/design-session/pre-work-step.tsx src/components/pm-review/pm-review-insumos-sheet.tsx | awk -F: '{s+=$2} END {print s}'"
      expected: "regex:^[2-9]"
    - kind: sql
      command_or_query: "find src/components/pm-review src/components/design-session -name '*-modal.tsx' | wc -l | tr -d ' '"
      expected: "0"
    - kind: sql
      command_or_query: "grep -c 'ContextInsumosSheet' src/components/design-session/pre-work-step.tsx"
      expected: "regex:^[1-9]"
    - kind: sql
      command_or_query: "grep -c 'ContextInsumosSheet' src/components/pm-review/pm-review-insumos-sheet.tsx"
      expected: "regex:^[1-9]"
    - kind: manual_browser
      command_or_query: "Abrir Vitor pre-work (DS qualquer) → botão Insumos no chip header → comparar com PM Review qualquer → botão Insumos. Estrutura idêntica."
      expected: "Mesmas tabs, mesmo dropdown 'Importar novo', mesmos modais ao clicar em cada kind"
  dependsOn: [CTXSRC-013]
  estimateMinutes: 15
  touches: []

- id: CTXSRC-014
  title: Migration H — drop link tables legados
  description: |
    20260530h_drop_legacy_link_tables.sql. DROP TABLE PMReviewTranscriptLink, PMReviewMeetingLink,
    DesignSessionTranscriptLink CASCADE. Rodar SÓ depois de CTXSRC-013 (código não referencia mais).
    Manter TranscriptRef intacta — drop dela fica pra entrega 1.5 após confirmar zero references.
  acceptanceCriteria:
    - "Tabelas legacy não existem mais no DB"
    - "tsc passa (zero refs no código)"
    - "Smoke: linkar/deslinkar transcript em DS continua funcionando via tabelas novas"
  verifiable:
    - kind: sql
      command_or_query: "source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql \"$DIRECT_URL\" -t -c \"SELECT to_regclass('public.\\\"DesignSessionTranscriptLink\\\"') IS NULL AND to_regclass('public.\\\"PMReviewTranscriptLink\\\"') IS NULL\""
      expected: "regex:t"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "Linkar e deslinkar 1 transcript via UI Vitor e PM Review"
      expected: "Funciona sem erro"
  dependsOn: [CTXSRC-013]
  estimateMinutes: 20
  touches:
    - supabase/migrations/20260530h_drop_legacy_link_tables.sql
```

---

**Total stories:** 15
**Total estimate:** ~395 min (~6h 35min)
**Migrations:** 8 arquivos (A-H), 1 extra do bucket (J).
**DAG:** 001 → {002, 003, 004, 008}; (002, 004) → 006; (003, 004, 005) → 007; 008 → 009; 008 → 010; (008, 002, 003) → 011; 011 → 012; (011, 012) → 013; 013 → {014, 015}.

## Pendências externas (não bloqueiam Ralph)

- **GitHub via Composio:** já configurado em prod (`COMPOSIO_GITHUB_AUTH_CONFIG_ID`). Nada a fazer.
- **Google Sheets via Composio (opt-in):** criar Auth Config no painel Composio (toolkit=`googlesheets`, OAuth gerenciado pelo Composio) e setar `COMPOSIO_GSHEETS_AUTH_CONFIG_ID` em prod/staging. Sem isso, fluxo de import de planilha Google falha graciosamente — CSV continua funcionando.
- **Member precisa conectar Google Sheets** em `/settings` (mesmo flow do GitHub) pra que o adapter consiga ler. Pré-requisito por usuário, não global.
