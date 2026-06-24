# PRD — Project Wiki (executive, auto-generated)

**Status:** draft (revised post lead-review)
**Owner:** João Moraes
**Data:** 2026-05-29
**Audiência:** equipe interna (PM/lead/contributor/sponsor) + leitura para participantes de DS
**Codename:** `project-wiki-v2` · `WikiComposer` (Edge Function) · `ProjectWikiSection` (entidade existente, repropósito)

---

## 1. Problema

A Wiki atual ([project-wiki.tsx](../../src/components/project-wiki.tsx)) é um formulário de 7 seções editáveis manualmente (description em Tiptap, links, sponsors, objectives, success_indicators, environments, access). Três problemas:

1. **Wiki vira lixo orgânico.** Campos manuais envelhecem rápido. Após 2 sprints ninguém atualiza. PM acaba não confiando no que lê, vira documento morto.
2. **Não há leitura executiva de saúde do projeto.** Quem abre um projeto não vê em 10s: sprint atual, % completion, FPs done/total, próximos marcos, equipe, riscos. Esses dados existem (tasks, sprints, FunctionPoints, meetings) mas estão fragmentados em sub-rotas.
3. **DS abre sem contexto operacional.** Participantes de uma Design Session entram numa reunião sem saber estado atual do projeto — precisam pedir resumo verbal ao PM toda vez.

Volund já tem fontes ricas e estruturadas (DS de Inception com módulos aprovados, meetings com transcripts, tasks com FPs, ProjectAccess com equipe). Falta **consolidação curada e auto-mantida**.

## 2. Solução em uma frase

Substituir a Wiki manual por um **dashboard executivo auto-gerado** com 2 camadas (métricas determinísticas via SQL + narrativa estruturada via LLM lendo DS Inception + meetings + operação), publicada **sem edição livre** mas com **válvula de "ocultar bullet"** (suppress) pra mitigar alucinações pontuais, gerada manualmente via botão na v1 e via cron + triggers em v2. Conteúdo manual antigo (drive, links, sponsors) migra pra aba **Recursos** separada.

## 3. Não-objetivos

- **Não** mantém Tiptap/edição livre nas seções auto-geradas.
- **Não** entrega cron em v1. Geração manual via botão; cron e triggers ficam pra Fase 2.
- **Não** expõe ao cliente externo na v1. Audiência inicial: equipe interna + participantes de DS.
- **Não** substitui o Alpha em runtime conversacional. WikiComposer é Edge Function, não chat.
- **Não** dispara ações automáticas (não cria task, não notifica). Wiki é leitura.
- **Não** mantém histórico navegável na v1. Snapshot mais recente por projeto; histórico em Fase 3.
- **Não** consome meetings `private` (respeita escopo owner-only).
- **Não** oferece campo de override editorial **com reescrita**. A única edição humana possível é **ocultar bullet via suppress flag** (item continua na auditoria, some da UI até nova fonte chegar).
- **Não** introduz `DesignSession.wikiSnapshotAtOpen` — Fase 3 fará live fetch da Wiki no header da DS (DS dura horas, link live basta).

## 4. Personas e jornada

### PM/Lead interno
> "Abro o projeto, vejo o Hero: Sprint 12, 67% completion, 142/213 FP, próximo marco em 14 dias. Embaixo: objetivos do projeto (vindo da DS de Inception), highlights da semana (extraídos do último pm_review), riscos abertos, equipe. Em 30s tenho o pulso do projeto."

### Contributor/builder
> "Entrei no projeto novo essa semana. Wiki me dá em 1min: o quê estamos construindo (objetivos+escopo), onde estamos (métricas), quem é quem (equipe), o que decidimos recentemente (decisões). Não preciso garimpar."

### Participante de DS (Sponsor, Builder)
> "Entrei na sala de DS. Header da DS faz live fetch da Wiki — sei o estado do projeto sem o PM precisar narrar."

### Guest / Sponsor (com acesso limitado)
> "Vejo Hero sem FP (escondidos por política de guest access), só `% completion`. Vejo objetivos e highlights, mas não vejo riscos internos nem decisões internas."

## 5. Decisões fixadas (post-revisão)

| # | Decisão | Escolha | Por quê |
|---|---|---|---|
| D1 | Fonte canônica do "porquê" | **DS de Inception aprovada** | Único lugar onde problema/visão/escopo são estruturados. |
| D2 | Editorial humano | **Sem reescrita; suppress bullet permitido** | Wiki é espelho puro, mas alucinação semântica acontece — válvula é ocultar bullet (persistido em `ProjectWikiSection.suppressed` jsonb). Item some da UI, fica na auditoria. Regen recria item se fonte ainda existe, exceto se mesmo `bulletHash` continua na lista de supressos (idempotente). |
| D3 | Gatilho de geração v1 | **Botão manual "Gerar Wiki"** com endpoint **sempre async** (202 + jobId) | Contrato estável v1→v2. Job inline (Promise.resolve) na v1; queue real na v2. |
| D4 | Modelo de dados | **2 camadas: métricas (SQL) + narrativa (LLM cacheada)** | Determinístico recalcula no page-load; generativo cacheia e regenera só sob trigger. |
| D5 | Conteúdo manual antigo | **Aba "Recursos" separada** | Wiki = vivo/auto; Recursos = catálogo manual. |
| D6 | Transparência de fontes | **Tabela `ProjectWikiSectionSource` com FK real** | Permite JOIN, queries, detecção de fonte deletada. Substitui o `sources jsonb` opaco. |
| D7 | Escopo input narrativa | meetings com `MeetingProjectLink` AND `type != 'private'` + DS approved + tasks completed | Linha clara, respeita privacidade já garantida por RLS. |
| D8 | Multiplicidade de DS Inception | **Mais recente approved ganha**; histórico no Fase 3 | Projetos evoluem; última DS reflete entendimento atual. |
| D9 | Audiência v1 | Interna + participantes de DS, com filtro **por persona** (guests não veem FP/risks/decisions) | Reduz risco editorial + compatível com `project_guest_access`. |
| D10 | Runtime do WikiComposer | **Edge Function (Supabase)** | Mesma stack de `alpha-insights`; isola LLM call; latência ok pra cron+trigger; custo previsível. |
| D11 | Dedupe | **v1 sem dedupe entre runs** (regen apaga seção + sources antes); **v2 via embedding (pgvector)** | Hash de texto normalizado não cobre paráfrase; honestidade > vaidade técnica. |
| D12 | Faseamento Fase 1 | **MVP narrativo completo** (objectives + highlights + decisions) | Sem isso, Fase 1 entrega menos que a Wiki atual e adoção é zero. Scope/risks só na Fase 2. |
| D13 | Migrations | **3 arquivos separados, atômicos** (ALTER, ProjectResource, ProjectWikiSectionSource) | Cada um isolado pra rollback granular e revisão. |
| D14 | RLS | **SELECT segue ProjectAccess; INSERT/UPDATE/DELETE só service role (compose)** | Wiki é write-only via Edge Function. Suppress é UPDATE da coluna `suppressed` via endpoint dedicado que checa `canEditProject`. |

## 6. Arquitetura

### 6.1 Diagrama

```
┌────────────────────────────────────────────────────────────────────┐
│ UI: /projects/[id] — tab "Wiki" (refeita)                          │
│   Hero (live SQL) + Narrativa (cached) + Equipe (live SQL)         │
│   Botão "Gerar Wiki" (v1) | Auto via cron+events (v2)              │
│   Botão "ocultar bullet" (suppress) por item                       │
│ UI: /projects/[id] — tab "Recursos" (novo)                         │
│   Catálogo manual: links, drive, figma, repos                      │
└────────────────────────────────────────────────────────────────────┘
         ↑ render                              ↑ POST compose (async)
         │                                     │
┌────────┴───────────────────┐  ┌──────────────┴─────────────────────┐
│ Métricas (SQL live)        │  │ API Next.js                        │
│ GET .../wiki/metrics       │  │ POST .../wiki/compose → 202+jobId  │
│ Cache 5min                 │  │ GET  .../wiki/jobs/[jobId]         │
└────────────────────────────┘  └──────────────┬─────────────────────┘
                                               │ invoke
                                ┌──────────────┴─────────────────────┐
                                │ Edge Function: run-wiki-composer   │
                                │ 1. Load DS Inception approved      │
                                │ 2. Load meetings (kind != private) │
                                │ 3. Load completed tasks (range)    │
                                │ 4. LLM extração estruturada/seção  │
                                │    + schema Zod                    │
                                │ 5. TRANSACTION:                    │
                                │      DELETE old Source rows        │
                                │      UPSERT ProjectWikiSection     │
                                │      INSERT new Source rows        │
                                │      preserve `suppressed` jsonb   │
                                │ 6. AgentUsage log                  │
                                └────────────────────────────────────┘
                                          ↑
                                v2: pg_cron (semanal seg 9h BRT)
                                    + triggers (DS completed, etc.)
```

### 6.2 Seções

**Camada determinística (SQL, cache 5min):**

| Section | Conteúdo | Fonte SQL |
|---|---|---|
| `hero` | Sprint atual, % completion, FPs done/total, próximo marco | Sprint + Task + FunctionPoint |
| `metrics` | Burndown, velocity últimos 3 sprints, throughput por persona | Sprint + Task |
| `team` | Lead, contributors, session participants, sponsor | ProjectAccess + Member |
| `roadmap` | Próximos sprints + DS agendadas | Sprint + DesignSession |

**Camada narrativa (LLM extração estruturada, cacheada em `ProjectWikiSection.data`):**

| Section | Fonte primária | Output estruturado | Fase |
|---|---|---|---|
| `objectives` | DS Inception approved (mais recente) | `{ problem, vision, success_signals[] }` | 1 |
| `highlights` | pm_review + tasks completed na janela | `[{ title, summary, bulletHash }]` | 1 |
| `decisions` | Meetings (notes + actionItems) na janela | `[{ decision, date, bulletHash }]` | 1 |
| `scope` | Módulos approved + status de stories | `{ in_scope_modules[], out_of_scope[], evolving[] }` | 2 |
| `risks` | pm_review (campo específico) + tasks bloqueadas | `[{ risk, severity, bulletHash }]` | 2 |

**Aba Recursos (manual, sem LLM):**

| Section | Conteúdo |
|---|---|
| `links` | Drive, figma, docs externos |
| `repos` | Repositórios git |
| `legacy_sponsors` | Sponsors externos (até virarem Member) |

### 6.3 Extração estruturada (mitigação de alucinação)

1. **LLM extrai bullets com refs, não escreve parágrafos.** Cada item da narrativa é `{ texto curto, bulletHash, source: { type, id } }`.
2. **Schema rigoroso por seção** (Zod). Output inválido → mantém versão anterior + log.
3. **Limite de tokens.** Highlights = máx 5 bullets de 200 chars. Decisões = máx 10.
4. **Suppress por bullet** (válvula contra alucinação semântica). Persistido em `ProjectWikiSection.suppressed: jsonb`:
   ```jsonb
   [
     { "bulletHash": "abc123", "suppressedBy": "memberId", "suppressedAt": "2026-..." }
   ]
   ```
   UI filtra antes de render. Regen recria item, mas `bulletHash` ainda na lista → continua escondido. Item volta naturalmente quando fonte muda (novo hash).
5. **Fallback gracioso.** Sem DS Inception → seção `objectives` com CTA "Crie uma DS de Inception". Sem meetings → "Sem rituais no período".
6. **Visibilidade por persona** (D9): `useCanSeeFunctionPoints()` + `useCanSeeRisks()` no Hero/Risks; guests veem versão filtrada.

## 7. Schema (3 migrations atômicas)

Todas executadas via `psql "$DIRECT_URL" -f ...` conforme `AGENTS.md`.

### 7.1 `supabase/migrations/20260530c_project_wiki_section_audit_cols.sql`

```sql
ALTER TABLE "ProjectWikiSection"
  ADD COLUMN IF NOT EXISTS "generatedAt"    timestamptz,
  ADD COLUMN IF NOT EXISTS "generatedBy"    text,
  ADD COLUMN IF NOT EXISTS "schemaVersion"  int       DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "suppressed"     jsonb     NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN "ProjectWikiSection"."generatedBy" IS
  'manual | cron | event:ds_completed | event:sprint_closed | event:pm_review';
COMMENT ON COLUMN "ProjectWikiSection"."suppressed" IS
  'array<{ bulletHash:text, suppressedBy:uuid, suppressedAt:timestamptz }>';

-- RLS: existente já cobre SELECT via ProjectAccess.
-- INSERT/UPDATE/DELETE: revogar de roles autenticados; só service role escreve.
REVOKE INSERT, UPDATE, DELETE ON "ProjectWikiSection" FROM authenticated;
-- (suppress endpoint usa service role e checa canEditProject no Next layer)
```

### 7.2 `supabase/migrations/20260530d_project_resource_table.sql`

```sql
CREATE TABLE "ProjectResource" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId" uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('link','repo','sponsor','doc')),
  title       text NOT NULL,
  url         text,
  notes       text,
  "order"     int  NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_project_resource_project ON "ProjectResource"("projectId", "order");

ALTER TABLE "ProjectResource" ENABLE ROW LEVEL SECURITY;

CREATE POLICY pr_select ON "ProjectResource" FOR SELECT
  USING (can_view_project("projectId"));
CREATE POLICY pr_modify ON "ProjectResource" FOR ALL
  USING (can_edit_project("projectId"))
  WITH CHECK (can_edit_project("projectId"));
```

### 7.3 `supabase/migrations/20260530e_project_wiki_section_source_table.sql`

```sql
CREATE TABLE "ProjectWikiSectionSource" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "wikiSectionId" uuid NOT NULL REFERENCES "ProjectWikiSection"(id) ON DELETE CASCADE,
  "bulletHash"    text NOT NULL,
  "sourceType"    text NOT NULL CHECK ("sourceType" IN
                    ('meeting','design_session','task','sprint','pm_review')),
  "sourceId"      uuid NOT NULL,
  "extractedAt"   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_pwss_section ON "ProjectWikiSectionSource"("wikiSectionId");
CREATE INDEX ix_pwss_source  ON "ProjectWikiSectionSource"("sourceType","sourceId");

ALTER TABLE "ProjectWikiSectionSource" ENABLE ROW LEVEL SECURITY;

CREATE POLICY pwss_select ON "ProjectWikiSectionSource" FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "ProjectWikiSection" s
      WHERE s.id = "wikiSectionId"
        AND can_view_project(s."projectId")
    )
  );
-- INSERT/UPDATE/DELETE: só service role (compose Edge Function).
REVOKE INSERT, UPDATE, DELETE ON "ProjectWikiSectionSource" FROM authenticated;
```

## 8. APIs

Compose sempre async (D3) — contrato estável v1→v2.

| Método | Path | Função | Auth |
|---|---|---|---|
| GET  | `/api/projects/[id]/wiki` | Retorna todas as seções (data + suppressed + sources agregadas) | canViewProject |
| GET  | `/api/projects/[id]/wiki/metrics` | Métricas SQL live | canViewProject |
| POST | `/api/projects/[id]/wiki/compose` | Enfileira job; **retorna 202 `{ jobId }`** | canEditProject |
| GET  | `/api/projects/[id]/wiki/jobs/[jobId]` | Status do job (`pending\|running\|done\|failed`) | canViewProject |
| POST | `/api/projects/[id]/wiki/suppress` | Body: `{ sectionKey, bulletHash }`. Insere no array `suppressed`. | canEditProject |
| DELETE | `/api/projects/[id]/wiki/suppress` | Body: `{ sectionKey, bulletHash }`. Remove. | canEditProject |
| GET/POST/PUT/DELETE | `/api/projects/[id]/resources/...` | CRUD manual de ProjectResource | canEditProject (write), canViewProject (read) |

Endpoint legado `PUT /api/projects/[id]/wiki/[sectionKey]` é **removido** (sem edição manual de conteúdo).

**v1 do compose:** job inline na própria API route (Promise.resolve invocando Edge function) — devolve 202 mas resolve em segundos. Cliente faz poll. **v2:** queue real, cron e triggers.

## 9. UX — layout executivo

```
┌─ HERO ──────────────────────────────────────────────────────────────┐
│ Projeto Foo · Sprint 12 (5/7d) · 67% · [142/213 FP*] · v2 em 14d   │
│ * FP escondido pra guest                                            │
└─────────────────────────────────────────────────────────────────────┘
┌─ NARRATIVA ─────────────────────┬─ MÉTRICAS ────────────────────────┐
│ Objetivos                       │ Burndown (chart)                  │
│  • Problema: …  [⋯ ocultar]    │ Velocity últimos 3 sprints        │
│  • Visão: …    [⋯ ocultar]     │ Throughput por persona            │
│  ↳ fonte: DS Inception #abc     │                                   │
│                                 │                                   │
│ Highlights da semana            │                                   │
│  • … ↳ meeting #xyz             │                                   │
│ Decisões recentes               │                                   │
│  • … ↳ meeting #def             │                                   │
│ Riscos (interno)                │                                   │
│  • … ↳ pm_review #ghi           │                                   │
└─────────────────────────────────┴───────────────────────────────────┘
┌─ EQUIPE ────────────────────────────────────────────────────────────┐
│ Lead · Contributors · Session participants · Sponsor                │
└─────────────────────────────────────────────────────────────────────┘

[Botão: "Atualizar Wiki" · gerada há 3 dias · fontes: DS #abc, 4 meetings]
```

Princípios visuais:
- Hero = 1 linha densa, status legível em 1s. FP escondido pra guest via `useCanSeeFunctionPoints()`.
- Narrativa = bullets com `↳ fonte` clicável + menu `⋯` com "ocultar bullet" (suppress).
- Bullets supressos somem da UI (não há "ver supressos" na v1 — Fase 2 traz painel de auditoria).
- Métricas = cards com microcharts, números grandes.
- Footer = quando gerou, quantas fontes, botão regerar.

## 10. Integração com Design Session

**Header da DS faz live fetch da Wiki ao abrir** (não congela snapshot — DS dura horas, link live basta). Endpoint: `GET /api/projects/[id]/wiki` consumido pelo header da DS. Re-render quando Wiki regenera (não bloqueante).

**Não introduzimos** `DesignSession.wikiSnapshotAtOpen`. Decisão revisada — over-engineering pra primeira iteração.

## 11. Faseamento (limpo, sem v1.1)

### Fase 1 — Dashboard executivo + narrativa core

**Objetivo:** entregar **MVP narrativo completo** + Hero + Equipe + Recursos. Sem Fase 1 ambiciosa, adoção é zero.

- 3 migrations atômicas (§7.1, §7.2, §7.3)
- Script de migração de conteúdo manual antigo → ProjectResource (dry-run + backup `ProjectWikiSection_legacy`)
- Refazer [project-wiki.tsx](../../src/components/project-wiki.tsx) com Hero + grid read-only + botão suppress
- Aba "Recursos" CRUD manual (ResponsiveSheet + Field + useOptimisticCollection)
- `GET /wiki/metrics` (SQL determinístico, cache 5min)
- `POST /wiki/compose` async (202 + jobId; inline na v1) cobrindo **objectives, highlights, decisions**
- `GET /wiki/jobs/[jobId]` polling
- `POST/DELETE /wiki/suppress`
- Edge Function `run-wiki-composer` (Supabase) com schemas Zod + AgentUsage log
- Transparência: badge "gerado em X · fonte: DS #abc" por seção
- Visibilidade por persona: FP/risks/decisions filtrados pra guest

**Entregável:** Wiki nova com Hero + métricas live + 3 seções narrativas autopopuladas + Recursos + suppress.

### Fase 2 — Narrativa expandida + automação + dedupe

- WikiComposer adiciona `scope` + `risks`
- pg_cron semanal seg 9h BRT (`run_wiki_compose_batch()`)
- Triggers event-driven: DS completed, sprint closed, pm_review submitted
- Async job queue real (tabela `WikiJob`, drain loop na Edge)
- **Dedupe via embedding (pgvector)** — substitui hash de texto normalizado
- Painel de auditoria de bullets supressos (`/projects/[id]/wiki/audit`)

### Fase 3 — DS integration + histórico

- Header live da Wiki na DS (componente compartilhado)
- Histórico de versões da Wiki (last 10 generations por projeto, navegável)
- Diff visual entre gerações (o que mudou na narrativa)

### Fase 4 (opcional) — Sponsor view

- Visão filtrada da Wiki pra sponsors externos (sem riscos/decisões internas)
- Compartilhamento via link público com escopo limitado

## 12. Riscos e mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| LLM alucina na narrativa (semântica) | Alta | Médio | Schema rigoroso + refs obrigatórias + limite de tokens + **suppress bullet** (D2) |
| Projeto sem DS Inception fica "vazio" | Alta | Baixo | CTA "Crie uma DS de Inception"; resto da Wiki (métricas, equipe, highlights, decisions) continua funcional |
| Custo LLM × N projetos no cron | Média | Médio | Fase 2; reusar contexto de meeting já lido; só regenerar seções afetadas pelo trigger |
| Wiki desatualizada entre cron runs | Média | Médio | Triggers event-driven em Fase 2 cobrem âncoras (DS/sprint/pm_review) |
| Migração de dados manuais perde conteúdo | Média | Alto | Dry-run + backup em `ProjectWikiSection_legacy` + script idempotente |
| Membros não confiam ("máquina escreveu") | Média | Alto | Transparência radical: cada bullet com fonte clicável; suppress quando errar |
| Guest enxerga FP sem querer | Baixa | Alto | `useCanSeeFunctionPoints()` no Hero; teste E2E com sessão guest |
| Compose async + UI polling complica v1 | Baixa | Baixo | Job inline na v1 resolve <5s; polling é trivial (3 reqs no pior caso) |
| pm_review ainda não tem campo "risco" estruturado | Alta | Baixo | Fase 2 onde risks entra; v1 não cobre risks na narrativa |

## 13. Métricas de sucesso (com instrumento)

| Métrica | Meta v1 (30d) | Como medir |
|---|---|---|
| Adoção | ≥ 70% dos projetos ativos com ≥1 geração nos primeiros 30d | SQL: `SELECT count(DISTINCT projectId) FROM "ProjectWikiSection" WHERE "generatedAt" > now()-interval '30d'` ÷ `count(Project WHERE status='active')` |
| Frescor | mediana de dias desde última geração < 14d (alvo Fase 2 c/ cron) | SQL: `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY now() - "generatedAt") FROM "ProjectWikiSection"` |
| Confiança | ≥ 70% concorda em survey qualitativo retro mensal | Survey externo (Tally/Notion form), agregação manual; documentado em `docs/runbooks/wiki-confidence-survey.md` |
| Taxa de suppress | < 5% dos bullets gerados acabam supressos | SQL: `sum(jsonb_array_length(suppressed)) / count(bullets generated)` (extrair do schema das seções narrativas) |
| Erros de geração | < 5% dos jobs com status=`failed` | SQL em `WikiJob` (Fase 2) ou logs do AgentUsage (`error not null`) na Fase 1 |
| Custo | < $0.50/projeto/mês | `SELECT projectId, sum(costUsdCents)/100 FROM "AgentUsage" WHERE "agentName" LIKE 'wiki-%' GROUP BY projectId` |
| Uso em DS (Fase 3) | ≥ 50% das DS abertas com header expandido | Event `wiki_header_expanded_in_ds` em analytics (Vercel Analytics) |

Métricas sem instrumento foram removidas (sem vaidade).

## 14. Open questions

Todas resolvidas nesta revisão. Histórico curto:

1. ~~Edge vs Next.js server~~ → Edge Function (D10).
2. ~~Sources jsonb vs tabela~~ → Tabela `ProjectWikiSectionSource` (D6).
3. ~~Dedupe~~ → v1 sem; v2 embedding (D11).
4. ~~Fase 1 escopo~~ → MVP narrativo completo (D12).
5. ~~wikiSnapshotAtOpen~~ → removido; live fetch (§10).
6. ~~Editorial humano~~ → suppress bullet (D2).
7. ~~v1.1~~ → faseamento limpo 1→2→3→4.
8. ~~RLS~~ → service role escreve; canEditProject pra suppress (D14).

Restam **não-bloqueantes pra Fase 2+:**
- Janela temporal dos `highlights`: última semana ou desde último pm_review? Sugestão: desde último pm_review.
- `scope` reage a stories evolving ou só módulos approved? A decidir antes da Fase 2.

## 15. Referências

- Wiki atual: [src/components/project-wiki.tsx](../../../src/components/project-wiki.tsx) · [src/hooks/use-wiki-items.ts](../../../src/hooks/use-wiki-items.ts)
- Alpha Insights (padrão): [docs/prd/archive/prd-alpha-project-insights-20260529.md](../archive/prd-alpha-project-insights-20260529.md)
- DS Inception: [docs/features/design-session/](../../features/design-session/)
- Meetings: [src/lib/meetings.ts](../../../src/lib/meetings.ts)
- Guest access (constraint de visibilidade): memory `project_guest_access.md`
- UI patterns: memory `project_ui_patterns.md`
- Edge Function pattern: [supabase/functions/export-design-session/](../../supabase/functions/export-design-session/)

---

## 16. Stories implementáveis (Fase 1)

Stories pequenas (≤ 30min cada), sequenciáveis via `dependsOn`. Cada uma com AC objetivos e `verifiable` executável. Total: 20 stories.

### Schema (migrations)

#### WIKI-001 — Migration: ProjectWikiSection audit columns
**Description:** Cria migration adicionando colunas `generatedAt`, `generatedBy`, `schemaVersion`, `suppressed` em `ProjectWikiSection`, revoga INSERT/UPDATE/DELETE de `authenticated`.
**AC:**
- Arquivo `supabase/migrations/20260530c_project_wiki_section_audit_cols.sql` existe com DDL exata do §7.1.
- `psql "$DIRECT_URL" -f ...` roda sem erro.
- `\d "ProjectWikiSection"` mostra as 4 colunas novas.
- `SELECT has_table_privilege('authenticated', '"ProjectWikiSection"', 'INSERT')` retorna `false`.
**dependsOn:** []
**estimateMinutes:** 15
**touches:** `supabase/migrations/20260530c_project_wiki_section_audit_cols.sql`

#### WIKI-002 — Migration: ProjectResource table
**Description:** Cria tabela `ProjectResource` com RLS via `can_view_project` / `can_edit_project`.
**AC:**
- Arquivo `supabase/migrations/20260530d_project_resource_table.sql` existe (DDL exata §7.2).
- Migration roda via psql sem erro.
- `\d "ProjectResource"` mostra todas colunas + índice + RLS enabled.
- Policies `pr_select` e `pr_modify` existem (`SELECT polname FROM pg_policy WHERE polrelid = '"ProjectResource"'::regclass`).
**dependsOn:** []
**estimateMinutes:** 20
**touches:** `supabase/migrations/20260530d_project_resource_table.sql`

#### WIKI-003 — Migration: ProjectWikiSectionSource table
**Description:** Cria tabela `ProjectWikiSectionSource` (FK pra ProjectWikiSection ON DELETE CASCADE) com RLS de SELECT via JOIN.
**AC:**
- Arquivo `supabase/migrations/20260530e_project_wiki_section_source_table.sql` existe (DDL exata §7.3).
- Migration roda via psql sem erro.
- 2 índices criados (`ix_pwss_section`, `ix_pwss_source`).
- RLS enabled; INSERT/UPDATE/DELETE revogados de `authenticated`.
**dependsOn:** []
**estimateMinutes:** 20
**touches:** `supabase/migrations/20260530e_project_wiki_section_source_table.sql`

#### WIKI-004 — Regenerate database.types.ts
**Description:** Regerar tipos TypeScript do Supabase pós-migrations.
**AC:**
- `npx supabase gen types typescript --local` (ou comando do projeto) atualiza `src/lib/supabase/database.types.ts`.
- Tipo `ProjectWikiSection` inclui `generatedAt`, `generatedBy`, `schemaVersion`, `suppressed`.
- Tipo `ProjectResource` e `ProjectWikiSectionSource` existem como Row types.
- `pnpm tsc --noEmit` passa.
**dependsOn:** ["WIKI-001", "WIKI-002", "WIKI-003"]
**estimateMinutes:** 10
**touches:** `src/lib/supabase/database.types.ts`

### Domain types + Zod schemas

#### WIKI-005 — Zod schemas para output narrativo
**Description:** Cria `src/lib/wiki/schemas.ts` com Zod schemas pra `objectives`, `highlights`, `decisions` (output da LLM por seção). Cada bullet tem `bulletHash` (sha256 8 chars do texto+sourceId) e `source: { type, id }`.
**AC:**
- Arquivo `src/lib/wiki/schemas.ts` exporta `ObjectivesSchema`, `HighlightsSchema`, `DecisionsSchema`.
- Cada schema valida `max(N)` items (objectives 1; highlights 5; decisions 10).
- Tipos `Objectives`, `Highlights`, `Decisions` inferidos via `z.infer`.
- `pnpm tsc --noEmit` passa.
**dependsOn:** ["WIKI-004"]
**estimateMinutes:** 25
**touches:** `src/lib/wiki/schemas.ts`

#### WIKI-006 — Helper bulletHash + suppressed type
**Description:** Cria `src/lib/wiki/suppressed.ts` com `computeBulletHash(text, sourceId)` (sha256→hex[:8]) e tipo `SuppressedEntry = { bulletHash, suppressedBy, suppressedAt }`. Função `isSuppressed(bullet, suppressed[])`.
**AC:**
- Arquivo `src/lib/wiki/suppressed.ts` exporta `computeBulletHash`, `isSuppressed`, tipo `SuppressedEntry`.
- `computeBulletHash` é determinístico: mesma input → mesmo output.
- Teste de bancada (script ts-node ad-hoc ok): `computeBulletHash("a","b") === computeBulletHash("a","b")`.
- tsc passa.
**dependsOn:** ["WIKI-005"]
**estimateMinutes:** 20
**touches:** `src/lib/wiki/suppressed.ts`

### Métricas SQL (live)

#### WIKI-007 — DAL: getWikiMetrics(projectId)
**Description:** Cria `src/lib/dal/wiki-metrics.ts` com função que retorna `{ hero, metrics, team, roadmap }` via queries SQL agregadas. Cache em-memória 5min (Next unstable_cache ok).
**AC:**
- Função `getWikiMetrics(projectId): Promise<WikiMetrics>` exportada.
- Shape inclui `hero.sprintNumber`, `hero.completionPercent`, `hero.fpDone`, `hero.fpTotal`, `hero.nextMilestoneDays`.
- Query usa apenas tabelas existentes (Sprint, Task, FunctionPoint, ProjectAccess, Member, DesignSession).
- tsc passa; ESLint passa.
**dependsOn:** ["WIKI-004"]
**estimateMinutes:** 30
**touches:** `src/lib/dal/wiki-metrics.ts`

#### WIKI-008 — API route GET /api/projects/[id]/wiki/metrics
**Description:** Route handler retorna `WikiMetrics` via `getWikiMetrics`. Auth: `canViewProject`. Validação Zod do `[id]`.
**AC:**
- Arquivo `src/app/api/projects/[id]/wiki/metrics/route.ts` exporta `GET`.
- 401 sem auth; 403 sem `canViewProject`; 200 com shape `WikiMetrics`.
- `curl` (com cookie de sessão) retorna JSON validável contra schema.
- tsc + lint passam.
**dependsOn:** ["WIKI-007"]
**estimateMinutes:** 25
**touches:** `src/app/api/projects/[id]/wiki/metrics/route.ts`

### Edge Function (WikiComposer)

#### WIKI-009 — Edge Function skeleton run-wiki-composer
**Description:** Cria `supabase/functions/run-wiki-composer/index.ts` baseado no padrão `export-design-session`. Aceita body `{ projectId, jobId }`. Retorna `{ status: 'done'|'failed', error? }`.
**AC:**
- Arquivo existe e roda via `supabase functions serve run-wiki-composer` sem crash.
- Recebe POST com `{ projectId, jobId }` e responde 200 (lógica vazia ok nesta story).
- Validação de input com Zod.
- Auth via service role key (header).
**dependsOn:** ["WIKI-005"]
**estimateMinutes:** 30
**touches:** `supabase/functions/run-wiki-composer/index.ts`

#### WIKI-010 — Edge Function: load context (DS + meetings + tasks)
**Description:** Implementa `loadWikiContext(projectId)` dentro da Edge Function. Carrega: DS Inception approved mais recente, meetings últimos 14d (type != 'private'), tasks completed na janela.
**AC:**
- Função `loadWikiContext` exportada no arquivo da Edge.
- Filtra meetings `type != 'private'` (testado via mock SQL).
- Trunca transcript a 3000 chars (head+tail).
- Retorna `{ inceptionDS, meetings, completedTasks }`.
- Sem erro com projeto sem DS (retorna `inceptionDS: null`).
**dependsOn:** ["WIKI-009"]
**estimateMinutes:** 30
**touches:** `supabase/functions/run-wiki-composer/index.ts`

#### WIKI-011 — Edge Function: LLM call por seção (objectives/highlights/decisions)
**Description:** Adiciona 3 chamadas LLM (OpenRouter) com schema Zod por seção. Reusa `src/lib/ai/provider.ts` pattern. Output validado; erro mantém versão anterior.
**AC:**
- 3 funções `composeObjectives`, `composeHighlights`, `composeDecisions` (cada uma chama LLM + valida Zod).
- Em parse fail, retorna `{ error: string }` em vez de jogar.
- `response_format: { type: 'json_object' }` configurado.
- Mock LLM (env var `WIKI_DRY_RUN=1`) retorna shape válido pra teste local.
**dependsOn:** ["WIKI-010"]
**estimateMinutes:** 30
**touches:** `supabase/functions/run-wiki-composer/index.ts`

#### WIKI-012 — Edge Function: persist (UPSERT seção + sources, preserve suppressed)
**Description:** Implementa persistência transacional: DELETE Source rows antigas, UPSERT ProjectWikiSection (preservando `suppressed`), INSERT novas Source rows. AgentUsage log.
**AC:**
- Função `persistWikiSection(projectId, sectionKey, data, sources)` em uma transação.
- `suppressed` da row anterior é preservado (SELECT antes do UPSERT).
- Sources antigas deletadas antes das novas (mesmo `wikiSectionId`).
- AgentUsage row inserida com `agentName='wiki-composer-<section>'` e `costUsdCents`.
**dependsOn:** ["WIKI-011"]
**estimateMinutes:** 30
**touches:** `supabase/functions/run-wiki-composer/index.ts`

### Compose API (Next layer)

#### WIKI-013 — API route POST /api/projects/[id]/wiki/compose (async 202)
**Description:** Route handler que gera `jobId` (uuid), invoca Edge Function via fetch interno (não bloqueante), retorna 202 com `{ jobId }`. Auth: `canEditProject`. Job state em-memória (Map<jobId, status>) na v1; v2 substitui por tabela.
**AC:**
- `src/app/api/projects/[id]/wiki/compose/route.ts` exporta `POST`.
- Retorna 202 + `{ jobId: uuid }`.
- 403 sem `canEditProject`.
- Edge Function invocada em background (Promise não-awaited).
- tsc + lint passam.
**dependsOn:** ["WIKI-012"]
**estimateMinutes:** 30
**touches:** `src/app/api/projects/[id]/wiki/compose/route.ts`, `src/lib/wiki/job-store.ts`

#### WIKI-014 — API route GET /api/projects/[id]/wiki/jobs/[jobId]
**Description:** Retorna status do job (`pending|running|done|failed`) consultando job-store. Auth: `canViewProject`.
**AC:**
- `src/app/api/projects/[id]/wiki/jobs/[jobId]/route.ts` exporta `GET`.
- 200 com `{ status, error?, finishedAt? }`.
- 404 se jobId desconhecido.
- 403 sem `canViewProject`.
**dependsOn:** ["WIKI-013"]
**estimateMinutes:** 20
**touches:** `src/app/api/projects/[id]/wiki/jobs/[jobId]/route.ts`

### Suppress API

#### WIKI-015 — API route POST/DELETE /api/projects/[id]/wiki/suppress
**Description:** POST adiciona `{ bulletHash, suppressedBy, suppressedAt }` no array `suppressed` da seção; DELETE remove. Auth: `canEditProject`. Service role pra escrever.
**AC:**
- `src/app/api/projects/[id]/wiki/suppress/route.ts` exporta `POST` e `DELETE`.
- POST com `{ sectionKey, bulletHash }` insere no array (idempotente — sem duplicar).
- DELETE remove a entry.
- 403 sem `canEditProject`.
- Validação Zod do body.
**dependsOn:** ["WIKI-014"]
**estimateMinutes:** 30
**touches:** `src/app/api/projects/[id]/wiki/suppress/route.ts`

### UI — Wiki tab

#### WIKI-016 — Component: WikiHero (read-only métricas)
**Description:** Componente `src/components/wiki/wiki-hero.tsx` que renderiza linha Hero com sprint, completion, FP, próximo marco. Usa `useCanSeeFunctionPoints()` pra esconder FP de guest.
**AC:**
- Componente recebe `metrics: WikiMetrics['hero']` como prop.
- Renderiza "Sprint N · X% · Y/Z FP · marco em Wd".
- Quando `useCanSeeFunctionPoints()` = false, esconde "Y/Z FP" e mostra só "X%".
- Snapshot/storybook ad-hoc renderiza sem erro.
**dependsOn:** ["WIKI-008"]
**estimateMinutes:** 25
**touches:** `src/components/wiki/wiki-hero.tsx`, `src/hooks/use-can-see-function-points.ts`

#### WIKI-017 — Component: WikiNarrativeSection com suppress menu
**Description:** Componente `src/components/wiki/wiki-narrative-section.tsx` que renderiza lista de bullets com `↳ fonte` clicável + menu `⋯` com "Ocultar bullet" (chama suppress API via `useOptimisticCollection`).
**AC:**
- Recebe `section: { key, data: { bullets: [...] }, suppressed: SuppressedEntry[] }`.
- Filtra bullets supressos antes de render.
- Menu `⋯` (DropdownMenu) com "Ocultar bullet" chama `POST /wiki/suppress` via `useOptimisticCollection.mutate`.
- Erro de rede via `showErrorToast`.
- tsc + lint passam.
**dependsOn:** ["WIKI-015", "WIKI-016"]
**estimateMinutes:** 30
**touches:** `src/components/wiki/wiki-narrative-section.tsx`

#### WIKI-018 — Refatorar project-wiki.tsx (novo layout)
**Description:** Reescreve `src/components/project-wiki.tsx` substituindo o form atual por layout executivo: WikiHero + 3 WikiNarrativeSection (objectives/highlights/decisions) + WikiTeam + footer com botão "Gerar Wiki" e timestamp. Wiki velha vai pro git history.
**AC:**
- Componente renderiza Hero + objectives + highlights + decisions + team + footer.
- Botão "Gerar Wiki" chama `POST /wiki/compose`, faz poll de `GET /jobs/[jobId]` a cada 1s até `done|failed`.
- Loading skeleton enquanto job roda.
- Toast em erro de geração.
- Sem Tiptap.
- tsc + lint passam; component renderiza num projeto seed sem erro.
**dependsOn:** ["WIKI-017"]
**estimateMinutes:** 30
**touches:** `src/components/project-wiki.tsx`

### Recursos tab

#### WIKI-019 — Tab Recursos: CRUD ProjectResource
**Description:** Cria tab "Recursos" em `/projects/[id]` com lista de `ProjectResource` + ResponsiveSheet de criação/edição usando Field + useOptimisticCollection.
**AC:**
- Componente `src/components/wiki/project-resources.tsx` lista resources agrupados por `kind`.
- Botão "+ Recurso" abre ResponsiveSheet com Field pra title/url/notes/kind.
- Create/Update/Delete via useOptimisticCollection.
- 403 redirect/toast pra non-canEditProject.
- Aba adicionada em `src/app/(dashboard)/projects/[id]/page.tsx`.
- tsc + lint passam.
**dependsOn:** ["WIKI-002", "WIKI-018"]
**estimateMinutes:** 30
**touches:** `src/components/wiki/project-resources.tsx`, `src/app/api/projects/[id]/resources/route.ts`, `src/app/api/projects/[id]/resources/[resourceId]/route.ts`, `src/app/(dashboard)/projects/[id]/page.tsx`

### Data migration

#### WIKI-020 — Script: migrar conteúdo manual legado → ProjectResource
**Description:** Script `scripts/migrate-wiki-to-resources.ts` com flag `--dry-run`. Lê `ProjectWikiSection` antigos com keys `links/sponsors/environments`, cria `ProjectResource` correspondente, backup em `ProjectWikiSection_legacy`.
**AC:**
- Script roda com `pnpm tsx scripts/migrate-wiki-to-resources.ts --dry-run` sem efeito.
- Sem flag, cria rows em `ProjectResource` e tabela `ProjectWikiSection_legacy` populada.
- Idempotente: rodar 2× não duplica (checa por `url+title+projectId`).
- Logs estruturados: `{ projectId, created, skipped }`.
**dependsOn:** ["WIKI-019"]
**estimateMinutes:** 30
**touches:** `scripts/migrate-wiki-to-resources.ts`

---

**Total Fase 1:** 20 stories, ~510 minutos = ~8,5 horas de implementação contínua (sem overhead de context-switching).
