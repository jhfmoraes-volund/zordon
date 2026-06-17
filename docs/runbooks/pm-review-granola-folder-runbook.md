# Runbook — PM Review auto-alimentado por folder do Granola

> **Tipo:** runbook co-pilotado (não Ralph autônomo — tem decisão de schema + integração com daemon).
> **Objetivo numa frase:** o PM vincula uma folder do Granola a um projeto **uma vez**; daí o cron roteia as reuniões daquela folder pro projeto e mantém **um** PM Review vivo por semana atualizado sozinho — o PM só lê, ajusta e publica.
> **Status:** 🟡 não iniciado. Avançar fase a fase; cada passo tem verificação.

Memories relacionadas: [[project_pm_review]], [[project_vitoria_daemon_surfaces]], [[project_sprint_planning_living_model]], [[project_context_source_pool]], [[project_vitoria_weekly_planning]].

---

## 0. Modelo fixado (Dn)

| # | Decisão | Já existe? |
|---|---------|-----------|
| D1 | 1 PM Review por `(projeto, semana)` | ✅ `PMReview` UNIQUE `("projectId","referenceWeek")` |
| D2 | Cron folder-aware atualiza o draft vivo; nunca duplica | a construir |
| D3 | Sem `ContextSource` nova desde `reportGeneratedAt` → **no-op** (zero custo de LLM) | a construir |
| D4 | `draft → published` é o gate humano; publicado **congela** (cron não sobrescreve) | ✅ `status` enum existe; lógica de freeze a construir |
| D5 | Draft **editável** antes do publish (review-and-tweak, não carimbo) | ✅ UI/RLS já permitem UPDATE pelo PM |
| D6 | Roteamento folder→projeto na **camada de import** (beneficia toda a galáxia, não só PM Review) | a construir |
| D7 | Binding por `folderId` + `memberId` em **tabela própria** (não por nome, não coluna solta) | a construir |

`referenceWeek` = segunda-feira da semana corrente. `CHECK (EXTRACT(dow FROM "referenceWeek") = 1)` em [20260529d_pm_review.sql:52](../../supabase/migrations/20260529d_pm_review.sql). Bate com sprint week Seg→Dom ([[project_sprint_week_model]]).

---

## 1. Inventário — o que JÁ existe (não rebuildar)

| Peça | Onde | O que faz |
|------|------|-----------|
| `PMReview` table | [20260529d_pm_review.sql:26](../../supabase/migrations/20260529d_pm_review.sql) | `projectId`, `referenceWeek` (Monday), `status` (draft/published/archived), `reportMarkdown`, `reportGeneratedAt`, `publishedAt`. UNIQUE `(projectId, referenceWeek)`. RLS: PM escreve (`can_create_pm_review`), quem vê o projeto lê. |
| Granola client | [src/lib/granola.ts](../../src/lib/granola.ts) | `listNotes()` + `getNote()`. **Falta** `listFolders()` e `folderId` no filtro. |
| Auto-import | [src/lib/granola-auto-import.ts](../../src/lib/granola-auto-import.ts) | per-member, hourly. Cria Meeting `private` com `p_project_ids: []` (órfão) + `ContextSource` via `upsertTranscriptRef`. `MAX_NOTES_PER_RUN = 20`. |
| ContextSource do transcript | [src/lib/transcripts/upsert.ts:44](../../src/lib/transcripts/upsert.ts) | grava `ContextSource` (`kind='transcript'`, `source='granola'`, `sourceId=note.id`, `meetingId`). **`projectId` fica null hoje.** |
| `create_meeting_with_reviews` | [20260501_text_to_uuid.sql:200](../../supabase/migrations/20260501_text_to_uuid.sql) | `p_project_ids` (jsonb) → insere em `MeetingProjectLink`. Não cria PMReview. |
| PM Review consome via EntityLink | [src/lib/dal/pm-review.ts:251](../../src/lib/dal/pm-review.ts) | lê Meetings (`pmReviewId` + `meetingId`) e ContextSource (`pmReviewId` + `contextSourceId`). **Pra aparecer no report, precisa de EntityLink.** |
| Cron template | [20260611g_wiki_daily_cron.sql](../../supabase/migrations/20260611g_wiki_daily_cron.sql) | `kick_*()` lê Vault (`url` + `secret`) → `net.http_post` com header → rota `/api/cron/*`. `cron.schedule(name, expr, 'SELECT kick_*()')`. |
| Granola import cron | [20260521_granola_auto_import.sql:193](../../supabase/migrations/20260521_granola_auto_import.sql) | `enqueue_granola_auto_imports()` + `kick_granola_import_drain()`. |
| Sprint Planning UNIQUE parcial (padrão a espelhar) | [20260601b_planning_one_per_sprint.sql:11](../../supabase/migrations/20260601b_planning_one_per_sprint.sql) | `CREATE UNIQUE INDEX ... WHERE phase <> 'archived'`. |

**Fluxo alvo:**

```
PM vincula folder ──┐  (settings, 1×)
                    ▼
        ProjectGranolaFolder { projectId, folderId, memberId }   ← D7
                    │
   cron granola import (já existe, hourly) ─ por nota:
   nota.folder ∈ binding?  ──não──► Meeting private órfão (como hoje)
                    │ sim
                    ▼
   create_meeting_with_reviews(p_project_ids=[projectId])  ← D6
   + ContextSource.projectId = projectId
                    │
   cron pm-review-refresh (NOVO, Seg/Qua/Sex) ─ por projeto com binding:
                    ▼
   upsert PMReview(projectId, referenceWeek = segunda desta semana)   ← D1
   nova ContextSource da semana desde reportGeneratedAt? ─não─► NO-OP  ← D3
                    │ sim, e status != 'published'                       ← D4
                    ▼
   EntityLink(week meetings + contextsources → pmReviewId)
   daemon sintetiza → reportMarkdown + reportGeneratedAt
                    │
                    ▼
   PM lê / ajusta / PUBLICA → status='published' → congela              ← D4/D5
```

---

## Fase 0 — Granola client: folders (pré-requisito)

Sem isso, nada de folder. Diff cirúrgico só no client; não toca import ainda.

### Passos

1. **Tipos** em [src/lib/granola.ts](../../src/lib/granola.ts):
   ```ts
   export interface GranolaFolder {
     id: string;
     title: string | null;
     parent_folder_id?: string | null;
   }
   export interface GranolaFolderMembership { folder_id: string }
   ```
   Trocar `folder_membership?: unknown[]` (linha 41) por `folder_membership?: GranolaFolderMembership[]`.

2. **`listFolders()`** no `GranolaClient`:
   ```ts
   async listFolders(opts?: { cursor?: string; limit?: number }): Promise<{
     folders: GranolaFolder[]; hasMore: boolean; cursor: string | null;
   }> {
     const p = new URLSearchParams();
     if (opts?.cursor) p.set("cursor", opts.cursor);
     if (opts?.limit) p.set("limit", String(opts.limit));
     const qs = p.toString();
     return this.request(`/folders${qs ? `?${qs}` : ""}`);
   }
   ```

3. **`folderId` em `listNotes()`** — adicionar `if (opts?.folderId) params.set("folder_id", opts.folderId);` ao bloco de params.

### Verificação (script) — ✅ FEITO 2026-06-17

```bash
NODE_OPTIONS='--conditions=react-server' pnpm tsx scripts/granola-folders.ts
```
**Resultado real:** gate PASSOU. Aprendizados gravados no código:

- **Campo do nome da folder é `name`, não `title`** — `GranolaFolder.name` em [granola.ts](../../src/lib/granola.ts). Payload: `{ object:"folder", id:"fol_…", name, parent_folder_id }`.
- **`server-only` quebra no tsx** — rodar com `NODE_OPTIONS='--conditions=react-server'` (faz virar no-op fora do bundler). Vale pra qualquer script que importe `granola.ts`.
- `GET /notes?folder_id=…` filtra ok; `folder_membership` (detalhe) existe e retorna `[]` quando a nota não está em folder.
- Script de verificação: [scripts/granola-folders.ts](../../scripts/granola-folders.ts).

> ⚠️ **Pré-requisito operacional (humano, não-código):** no workspace atual há 2 folders (`Client calls`, `Team meetings`) **vazias** — as 10+ reuniões reais (SIAL, Hitz, Gulf…) estão soltas (`folder_membership: []`). A API pública é **read-only**, então arquivar notas em folder é passo manual no app do Granola. Pra testar roteamento end-to-end (Fase 1.3 / 2), o PM precisa criar uma folder com nome de projeto real (ex: `SIAL`) e arquivar ≥1 nota nela. **Não bloqueia a construção da Fase 1, só a verificação final.**

---

## Fase 1 — Binding + roteamento folder→projeto (o destravamento)

Entrega valor sozinha mesmo sem cron: reuniões da folder param de ser órfãs e passam a viver no projeto.

### 1.1 Migration — tabela de binding (D7)

`supabase/migrations/20260617a_project_granola_folder.sql`:
```sql
-- Vínculo durável folder-do-Granola → projeto. Por folderId (não nome).
-- memberId = de quem é o token que enxerga a folder (escopo per-member do import).
CREATE TABLE IF NOT EXISTS public."ProjectGranolaFolder" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId"  uuid NOT NULL REFERENCES public."Project"(id) ON DELETE CASCADE,
  "folderId"   text NOT NULL,
  "folderName" text,                       -- display only, snapshot no bind
  -- memberId = token que DIRIGE o roteamento (binding é do projeto). SET NULL,
  -- não CASCADE: offboard de um PM deixa o binding órfão (re-vinculável), não
  -- some em silêncio matando o roteamento. (Fix do review adversarial, finding #2.)
  "memberId"   uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  "updatedAt"  timestamptz NOT NULL DEFAULT now(),
  -- uma folder roteia pra no máx 1 projeto (evita nota em 2 projetos).
  -- um projeto pode ter N folders (N linhas, folderId distinto).
  CONSTRAINT "ProjectGranolaFolder_folder_key" UNIQUE ("folderId")
);

CREATE INDEX IF NOT EXISTS "ProjectGranolaFolder_member_idx"
  ON public."ProjectGranolaFolder" ("memberId");
CREATE INDEX IF NOT EXISTS "ProjectGranolaFolder_project_idx"
  ON public."ProjectGranolaFolder" ("projectId");

GRANT SELECT, INSERT, UPDATE, DELETE ON public."ProjectGranolaFolder" TO authenticated;
ALTER TABLE public."ProjectGranolaFolder" ENABLE ROW LEVEL SECURITY;

-- Lê: quem vê o projeto. Escreve: PM (mesma autoridade do PM Review) ou admin.
CREATE POLICY "pgf_select" ON public."ProjectGranolaFolder"
  FOR SELECT USING (public.is_manager() OR public.can_view_project("projectId"));
CREATE POLICY "pgf_insert" ON public."ProjectGranolaFolder"
  FOR INSERT WITH CHECK (public.is_manager() OR public.can_create_pm_review("projectId"));
CREATE POLICY "pgf_update" ON public."ProjectGranolaFolder"
  FOR UPDATE USING (public.is_manager() OR public.can_create_pm_review("projectId"))
  WITH CHECK (public.is_manager() OR public.can_create_pm_review("projectId"));
CREATE POLICY "pgf_delete" ON public."ProjectGranolaFolder"
  FOR DELETE USING (public.is_manager() OR public.can_create_pm_review("projectId"));
```
Rodar:
```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && \
  psql "$DIRECT_URL" -f supabase/migrations/20260617a_project_granola_folder.sql
```
Depois: atualizar [src/lib/supabase/database.types.ts](../../src/lib/supabase/database.types.ts) com a tabela nova.

> **Autoridade das rotas (fix do review, finding #1):** GET usa `requireProjectViewApi`; POST/DELETE usam `requireProjectViewApi` + `canCreatePMReviewForProject` — **mesma autoridade do PM Review** (admin OU `ProjectAccess.role='lead'`), não `MANAGER` global. Espelha `/api/pm-review`. Antes o PM-lead não-manager levava 403 indevido.

> **Offboarding:** binding com `memberId NULL` = órfão (PM saiu). Card mostra "órfã — desvincule e reconecte". Roteamento ignora órfãos (sem token pra dirigir). Re-vincular a mesma folder: desvincule o órfão (UNIQUE em folderId) e vincule de novo com o token do novo PM.

### 1.2 UI — card de binding no settings (PM-only)

Em [settings-tab.tsx](../../src/app/(dashboard)/projects/[id]/_tabs/settings-tab.tsx) (ao lado de `referenceKey`/`definitionOfDone`), novo Card "Granola":
- Lista folders via novo endpoint `GET /api/integrations/granola/folders` (server-side usa o token do member logado).
- **Sugere** a folder cujo `title` casa com `project.name` ou `referenceKey` (case-insensitive, sem acento) — PM confirma 1×.
- Persiste `{ folderId, folderName, memberId: <logado> }` via `useOptimisticCollection` (padrão de mutação — ver [[project_ui_patterns]]).
- Mostra folders já vinculadas + botão remover (`ConfirmDialog`, nunca `confirm()` nativo).

Endpoint novo `POST/GET /api/integrations/granola/folders` — usa `getMemberGranolaClient(memberId)` ([member-integrations.ts](../../src/lib/member-integrations.ts)).

### 1.3 Roteamento no import (D6)

Em [granola-auto-import.ts](../../src/lib/granola-auto-import.ts), no loop por nota (perto da linha 330):
1. Carregar bindings do member: `SELECT "projectId","folderId" FROM "ProjectGranolaFolder" WHERE "memberId" = :memberId`.
2. Resolver a folder da nota: ler `note.folder_membership` (de `getNote`) **ou** rodar o import já filtrado por `folder_id` por binding (preferível — uma passada `listNotes({folderId})` por folder vinculada; mais barato que baixar tudo e cruzar).
3. Se a nota pertence a uma folder vinculada → `p_project_ids: [projectId]` no `create_meeting_with_reviews` (em vez de `[]`).
4. Setar `projectId` na `ContextSource` — passar `projectId` por `upsertTranscriptRef` (adicionar o campo ao insert em [transcripts/upsert.ts](../../src/lib/transcripts/upsert.ts)).

> Nota sem folder vinculada continua virando Meeting `private` órfão — comportamento atual preservado, zero regressão.

### Verificação Fase 1
- [ ] `psql "$DIRECT_URL" -c '\d "ProjectGranolaFolder"'` mostra a tabela + RLS habilitado.
- [ ] Vincular uma folder no settings → linha aparece em `ProjectGranolaFolder`.
- [ ] Forçar 1 import (`POST /api/cron/run-granola-import` com auth) de uma nota dessa folder → conferir:
  ```sql
  -- Meeting linkado ao projeto:
  SELECT m.id, mpl."projectId" FROM "Meeting" m
    JOIN "MeetingProjectLink" mpl ON mpl."meetingId" = m.id
   WHERE m.id = '<novo>';
  -- ContextSource com projectId preenchido:
  SELECT id, source, "projectId" FROM "ContextSource"
   WHERE source='granola' AND "sourceId"='<note.id>';
  ```
  **Esperado:** ambos com `projectId` certo (antes: null/órfão).

---

## Fase 2 — PM Review vivo + cron (D1–D4)

### 2.1 Função de refresh (idempotente, no-op-aware)

Rota nova `POST /api/cron/pm-review-refresh` (auth via `x-cron-secret`, espelha o padrão da wiki/granola). Lógica por projeto com ≥1 binding:

```
referenceWeek := date_trunc('week', now())::date   -- segunda (Postgres week=Mon)
review := upsert PMReview(projectId, referenceWeek)  -- ON CONFLICT (projectId,referenceWeek)
IF review.status = 'published' THEN  return (skip)   -- D4 freeze
novos := ContextSource source='granola', projectId=projectId,
         createdAt > coalesce(review.reportGeneratedAt, '-infinity'),
         da semana [referenceWeek, referenceWeek+7)
IF novos = 0 THEN return (no-op)                     -- D3 zero custo
para cada meeting+contextsource da semana sem EntityLink → criar EntityLink(pmReviewId=review.id)
chamar daemon p/ sintetizar → grava reportMarkdown + reportGeneratedAt; status='draft'
```

Upsert do PMReview usa a UNIQUE existente:
```sql
INSERT INTO "PMReview" ("projectId","referenceWeek",status)
VALUES (:projectId, :monday, 'draft')
ON CONFLICT ("projectId","referenceWeek") DO NOTHING
RETURNING id;
```

**Síntese headless:** reusar o caminho que o botão "Sintetizar report" já dispara (Vitoria no daemon — [[project_vitoria_daemon_surfaces]]). ⚠️ **Passo a confirmar na implementação:** localizar como `/api/pm-review/[id]/chat` invoca o daemon e expor uma variante server-triggered (sem stream) que recebe `pmReviewId` e grava `reportMarkdown`. Não reimplementar a síntese — só dar um gatilho não-interativo ao mesmo núcleo.

### 2.2 Cron (espelha granola-import) — ✅ INSTALADO

Migration: [20260617c_pm_review_refresh_cron.sql](../../supabase/migrations/20260617c_pm_review_refresh_cron.sql). `kick_pm_review_refresh()` lê 2 secrets do Vault e faz `net.http_post` com `Authorization: Bearer`. Schedule **diário Seg–Sex 08:00 BRT** (`0 11 * * 1-5`) — cadência escolhida pelo João. Job `pm-review-refresh` ativo em `cron.job`. Idempotente (unschedule+schedule num DO block).

**Ativação (operacional — falta fazer):** o cron é **inerte** até:
1. `PM_REVIEW_REFRESH_AUTH_TOKEN` no `.env` (token forte qualquer) — a rota valida `Authorization: Bearer <token>`.
2. 2 secrets no Vault (mesmo valor do token + a URL pública da rota):
   ```sql
   SELECT vault.create_secret('https://<app>/api/cron/pm-review-refresh', 'pm_review_refresh_url');
   SELECT vault.create_secret('<mesmo PM_REVIEW_REFRESH_AUTH_TOKEN>', 'pm_review_refresh_auth_token');
   ```
Sem isso, `kick_*` dá `RETURN` cedo (não falha). Pra testar antes de seedar: chamar a rota manual com o Bearer token.

### Verificação Fase 2
- [ ] Rodar a rota manualmente 1× com folder tendo nota nova → PMReview da semana ganha `reportMarkdown` + `reportGeneratedAt`, `status='draft'`.
- [ ] Rodar **de novo sem nota nova** → **no-op**: `reportGeneratedAt` não muda, nenhuma chamada ao daemon (conferir logs / token spend). (D3)
- [ ] Publicar (`status='published'`) e rodar de novo → report **não** é sobrescrito. (D4)
- [ ] `SELECT * FROM cron.job WHERE jobname='pm-review-refresh';` retorna 1 linha.
- [ ] EntityLinks da semana existem: `SELECT count(*) FROM "EntityLink" WHERE "pmReviewId"=:id;` > 0.

---

## Fase 3 — Confiança & deltas (polish; depois das 1–2 estáveis)

- **Surface de gap** no projeto: "N reuniões importadas da folder X esta semana" + "M notas recentes fora de qualquer folder vinculada — atribuir?". Sem isso, esquecer de arquivar = miss silencioso = erosão de confiança.
- **Delta** no draft: "o que mudou desde o último toque" em vez de regenerar do zero (otimização de custo + leitura mais rápida pro PM).
- **Telemetria**: registrar cada refresh (no-op vs gerou) pra calibrar a cadência (talvez Seg/Qui baste).

---

## Rollback

- Fase 1: `DROP TABLE public."ProjectGranolaFolder";` + reverter o diff do import (volta a `p_project_ids: []`). ContextSources já roteadas ficam — `projectId` preenchido não quebra nada.
- Fase 2: `SELECT cron.unschedule('pm-review-refresh');` + `DROP FUNCTION public.kick_pm_review_refresh();`. PMReviews-draft criados ficam (inofensivos; PM arquiva).

## Ordem de execução

`Fase 0 (client) → 1.1 migration → 1.2 UI → 1.3 import → verificar → 2.1 rota → 2.2 cron → verificar → Fase 3`.

Bloqueante absoluto: **Fase 0 verificação** (token enxerga `/folders`). Se 404, pausa tudo e resolve o acesso à API antes.
