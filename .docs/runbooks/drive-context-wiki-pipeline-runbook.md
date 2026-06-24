# Runbook — Pipeline Drive → ContextSource → Wiki auto-gerada (com cron diário)

> **Executor:** agente Claude Code, fresh context. Leia este runbook INTEIRO antes de tocar em código.
> **Objetivo da sessão:** ao final, a funcionalidade está **pronta pra teste manual** (checklist no §9).
> **Commit:** ao final de cada story que passa os checks, `bash scripts/sync-main.sh -m "ZRD-JM-NN: <area> — <resumo>"` (NN incremental — veja `git log --oneline -3` pra saber o próximo).
> **Migrations:** sempre `source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql "$DIRECT_URL" -f supabase/migrations/<arquivo>.sql`, depois regenerar `src/lib/supabase/database.types.ts`.
> **Working tree:** há trabalho NÃO COMMITADO de outra sessão (adapter Notion + daemon chat). Regra local-as-SSOT: **não stash, não reset, não reverta nada** — o sync-main.sh sweepa tudo junto, e isso é o comportamento esperado.

## 0. Visão — o que estamos construindo

```
Google Drive (pastas canônicas por projeto)          ┌──────────────────────┐
  📁 Comercial / Imersão / Ops / Pós-Ops             │  pg_cron (1×/dia)    │
        │ sync 1 nível (Composio)                    │  └→ rota cron Next   │
        ▼                                            └──────────┬───────────┘
  ProjectDriveFile (índice + stage)                             │
        │ "Importar pro contexto" (UI)                          ▼
        ▼                                            1. refresh ContextSources
  ContextSource kind='gdrive_file'  ◄────────────────2. wiki composer (LLM)
  (pool por projeto, fullText extraído)                 → ProjectWikiSection
        │                                               → refs em ProjectWikiSectionSource
        ▼                                               (sourceType='context_source')
  Agentes (read_context_source) + Wiki sheet
```

Quatro blocos, **executar na ordem**: A (stage no Drive) → B (extração → ContextSource) → C (wiki composer) → D (cron). C é o maior; B alimenta C; D amarra tudo.

## 1. Estado atual — o que JÁ EXISTE (não recriar)

Verificado em 2026-06-11. Confie nesta lista, mas confirme com grep se algo parecer divergente.

| Coisa | Estado | Onde |
|-------|--------|------|
| Aba Drive no projeto (sync, índice, cards, estados vazios) | ✅ feito | `src/components/project-drive/drive-tab.tsx`, `src/app/api/projects/[id]/drive/{sync,files}/route.ts` |
| `Project.driveFolderId` + `driveLinkedBy`, tabela `ProjectDriveFile` (RLS ok) | ✅ feito | migrations `20260610c_project_drive_folder.sql`, `20260610d_project_drive_file.sql` |
| Composio toolkit `googledrive` (+ connect/status/disconnect genéricos por toolkit) | ✅ feito | `src/lib/composio/client.ts:48`, `src/app/api/integrations/composio/connect/route.ts` |
| Wiki como hero **sheet** (`?tab=wiki` abre sheet) | ✅ feito | `src/components/project-wiki/wiki-sheet.tsx`, `src/app/(dashboard)/projects/[id]/page.tsx:118-122` |
| Schema wiki: `ProjectWikiSection` (audit cols), `ProjectWikiSectionSource`, `ProjectResource` | ✅ feito (WIKI-001..003) | migrations `20260530c/d/e` |
| Wiki composer (LLM), compose 202, suppress, WikiHero | ❌ pendente (WIKI-004..018) | PRD `docs/prd/blocked/prd-project-wiki.md` + `scripts/ralph/features/project-wiki/prd.json` |
| ContextSource pool por projeto (projectId obrigatório, RLS) + adapters csv/gsheets/github/document/notion | ✅ feito | `src/lib/context-sources/adapters/`, `src/app/api/context-sources/route.ts` |
| pg_cron + pg_net habilitados, padrão "enqueue + kick via pg_net + Vault" | ✅ operacional | `20260519_project_insights.sql` §6-7, `20260521_granola_auto_import.sql` §5 |
| LLM server-side | ✅ padrão | `generateText` + `getModel(DEFAULT_MODEL)` de `src/lib/ai/provider.ts` (OpenRouter) |
| Extração de texto de PDF/DOCX/etc | ✅ existe pra upload | `src/lib/context-sources/adapters/document.ts` — **reusar** na extração do Drive |

## 2. Decisões fixadas (não reabrir)

| # | Decisão | Por quê |
|---|---------|---------|
| D1 | Taxonomia canônica de pastas do Drive: **Comercial, Imersão, Ops, Pós-Ops** → enum `stage`: `comercial \| imersao \| ops \| pos_ops`; arquivos na raiz ou em pasta não-canônica → `stage = NULL` | Compromisso do João: toda pasta de projeto terá essas 4 subpastas. Metadata determinística > inferência |
| D2 | Match de pasta canônica por **nome normalizado** (lowercase, sem acento, sem não-alfanumérico): `comercial`, `imersao`, `ops`, `posops` | Tolera "Pós Ops", "pos-ops", "Imersão". Atenção à ordem: testar `posops` ANTES de `ops` |
| D3 | Sync desce **exatamente 1 nível**: raiz + conteúdo das 4 pastas canônicas. Subpastas não-canônicas e sub-subpastas continuam cards clicáveis (sem recursão) | Convenção de pastas torna 1 nível suficiente; recursão é complexidade sem demanda |
| D4 | Cap: 200 arquivos na raiz (existente) + 100 por pasta canônica; acima → `truncated: true` | Mantém sync inline (sem job), 1-6 calls REST |
| D5 | Drive→ContextSource é **import explícito** (botão por arquivo na aba), não auto-import no sync | Curadoria humana mantém o pool limpo — nem tudo no Drive merece virar contexto de agente |
| D6 | `ContextSource` novo kind `gdrive_file`; dedup por `(kind, externalId=fileId, projectId)`; `payload = { fileId, mimeType, stage }` | Segue o padrão dos kinds existentes (`externalId` já é a dedup key de gsheets/github) |
| D7 | Extração: Google-native (Doc/Sheet/Slide) via `GOOGLEDRIVE_EXPORT_GOOGLE_WORKSPACE_FILE` (export text/markdown); binários (PDF etc.) via download + pipeline do `document.ts`. Cap 1MB de texto | Reusa o que existe; Drive continua SSOT do binário |
| D8 | **Composer roda no Next** (módulo `src/lib/wiki/composer.ts` + rota worker interna), NÃO em Edge Function Deno — **emenda ao PRD** (que dizia Edge `run-wiki-composer`) | Os adapters/Composio client vivem no Next e não são portáveis pra Deno sem duplicação; Cloud Run aguenta request de minutos |
| D9 | Job state em tabela **`WikiJob`** desde a v1 — **emenda ao PRD** (que dizia `Map<jobId,status>` em memória na v1) | Cloud Run roda multi-instância: Map em memória quebra o poll de status. Tabela também é o que o cron precisa |
| D10 | `ProjectWikiSectionSource.sourceType` ganha `'context_source'` no CHECK | Wiki precisa citar docs do Drive/GSheets/Notion como fonte (regra: sem ref tipada, não publica) |
| D11 | Hash guard: coluna `inputsHash` em `ProjectWikiSection`; composer calcula hash dos inputs por seção e **pula o LLM** se igual ao anterior | Cron diário sem hash = pagar LLM pra reescrever o mesmo texto + churn |
| D12 | Cron: `pg_cron` diário (06:00 UTC = 03:00 BRT) → função SQL → `net.http_post` pra rota Next `/api/cron/wiki-daily` autenticada por `CRON_SECRET` (URL + secret no Vault, padrão granola) | Reusa padrão estabelecido (`20260521_granola_auto_import.sql` §5). Rota Next (não Edge) por causa de D8 |
| D13 | Refresh de sources no cron: re-resolve `fullText` dos kinds externos (`gsheets`, `github_*`, `gdrive_file`, `notion`) com snapshot mais velho que 20h, ANTES de compor | Snapshots são estáticos hoje; wiki nível A exige fonte fresca. 20h evita refresh duplo no mesmo dia |
| D14 | Stories WIKI-019 (CRUD Recursos) e WIKI-020 (migração legado) ficam **fora desta sessão** | Não bloqueiam o teste do pipeline; ficam no prd.json pra depois |

## 3. Ordem de execução + bookkeeping Ralph

1. Bloco A (stage) → 2. Bloco B (extração) → 3. Bloco C (composer) → 4. Bloco D (cron) → 5. Checklist §9.

Antes do Bloco C:
```bash
source scripts/ralph/lib/prd-paths.sh && prd_move project-wiki in-progress
```
(o PRD está em `docs/prd/blocked/` mas o `prd.json` aponta `in-progress/` — este move corrige a inconsistência).

Ao completar cada story WIKI-NNN, marque `"passes": true` no `scripts/ralph/features/project-wiki/prd.json` e logue 1 linha em `scripts/ralph/features/project-wiki/progress.txt` (siga o formato existente do arquivo).

**Leia o PRD inteiro antes do Bloco C:** `docs/prd/in-progress/prd-project-wiki.md` (pós-move). Ele tem os Zod schemas, prompts por seção, contratos e ACs das WIKI-004..018. Este runbook só registra os **deltas** (D8, D9, D10, D11 e a emenda do loader no §6).

## 4. Bloco A — stage no índice do Drive (3 stories)

### DRVS-001 — Migration: coluna stage
```sql
-- supabase/migrations/20260611b_project_drive_file_stage.sql
ALTER TABLE "ProjectDriveFile"
  ADD COLUMN stage text CHECK (stage IN ('comercial','imersao','ops','pos_ops'));
```
- Rodar via psql; regenerar types; `npx tsc --noEmit` passa.
- **verifiable (sql):** `SELECT column_name FROM information_schema.columns WHERE table_name='ProjectDriveFile' AND column_name='stage';` → 1 row.

### DRVS-002 — Sync desce 1 nível com stage
Em `src/app/api/projects/[id]/drive/sync/route.ts`:
1. Lista a raiz (como hoje). Identifica subpastas com nome canônico (D2 — helper `folderStage(name): Stage | null`, com testes mentais: "Pós Ops"→`pos_ops`, "OPS"→`ops`, "Imersão"→`imersao`, "Design"→`null`).
2. Pra cada pasta canônica: lista filhos (`'<folderId>' in parents and trashed = false`, cap 100), grava cada arquivo com `stage` da pasta-mãe. A própria pasta canônica **não** entra como card.
3. Arquivos da raiz e subpastas não-canônicas: comportamento atual (`stage = NULL`).
4. Upsert + delete continuam por `(projectId, fileId)` — o delete agora considera o conjunto completo (raiz + 4 pastas).
- **verifiable (typecheck)** + **(http):** POST sync num projeto com pasta configurada → 200, e `SELECT stage, count(*) FROM "ProjectDriveFile" WHERE "projectId"='<id>' GROUP BY stage;` mostra arquivos com stage não-nulo.

### DRVS-003 — UI agrupada por stage
Em `drive-tab.tsx`: agrupar cards por seção na ordem **Comercial → Imersão → Ops → Pós-Ops → Geral** (NULL = "Geral"; seção vazia não renderiza). Banner discreto quando o sync não encontrou alguma das 4 pastas canônicas (retornar `missingStages: string[]` no sync e persistir no estado da resposta — pode vir só na resposta do POST, não precisa de tabela).
- **verifiable (typecheck)** + **(manual_browser):** aba mostra grupos; arquivo de "Comercial" aparece sob o header certo.

## 5. Bloco B — Drive → ContextSource (3 stories)

### DRVX-001 — Migration: kind gdrive_file
Template: `supabase/migrations/20260611_context_source_kind_notion.sql` (no working tree, recém-criado — leia e replique o padrão de alterar o CHECK de `kind`). Nome: `20260611c_context_source_kind_gdrive.sql`.
- **verifiable (sql):** `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='"ContextSource"'::regclass AND contype='c';` → contém `gdrive_file`.

### DRVX-002 — Adapter drive.ts + POST aceita gdrive_file
- `src/lib/context-sources/adapters/drive.ts` exportando `resolveContent(supabase, source)` no padrão dos irmãos (leia `gsheets.ts` pro padrão Composio/412 e `document.ts` pra extração de binário):
  - mimeType Google-native (`application/vnd.google-apps.document|spreadsheet|presentation`) → `GOOGLEDRIVE_EXPORT_GOOGLE_WORKSPACE_FILE` (mimeType de export `text/markdown` pra Docs; `text/csv` pra Sheets; `text/plain` pra Slides). Conferir o nome/args exatos da tool no dashboard Composio se a call falhar — normalizar com parser defensivo.
  - Binário (PDF, DOCX…) → tool de download do toolkit + pipeline de extração do `document.ts` (refatore a extração pra função exportada se estiver inline).
  - Cap 1MB de texto; persiste em `fullText` + `snapshotAt`. Account Composio: o `createdBy` do source (mesma semântica dos outros adapters).
- Registrar o kind no dispatch do `read-context-source.ts` e no `POST /api/context-sources` (payload: `{ kind: 'gdrive_file', projectId, fileId }` → busca metadata no `ProjectDriveFile` do projeto pra title/mimeType/stage; `externalId = fileId`; dedup: se já existe `(kind, externalId, projectId)`, retornar o existente com 200, não duplicar).
- **verifiable (typecheck)** + **(lint):** `grep -n "gdrive_file" src/lib/agent/tools/read-context-source.ts src/app/api/context-sources/route.ts` → ≥1 ocorrência em cada.

### DRVX-003 — Botão "Importar pro contexto" na aba Drive
Em cada card de arquivo (não pasta): ação "Importar pro contexto" → POST acima → toast Sonner de sucesso/erro; badge "no contexto" quando já importado. Pra saber o que já foi importado: o GET `/drive/files` retorna também os `externalId` dos ContextSources `kind='gdrive_file'` do projeto (1 query a mais no route, não no client).
- **verifiable (typecheck)** + **(manual_browser):** importar um Doc real → aparece em `SELECT title, kind FROM "ContextSource" WHERE "projectId"='<id>' AND kind='gdrive_file';` com `fullText` preenchido; segundo clique não duplica.

## 6. Bloco C — Wiki composer (WIKI-004..018 do prd.json + 2 emendas)

Execute as stories do `scripts/ralph/features/project-wiki/prd.json` na ordem do DAG (WIKI-004 → … → WIKI-018), **aplicando os deltas abaixo**. O PRD é a spec; em conflito PRD × runbook, **este runbook vence** (D8, D9, D10, D11).

### WIKE-001 (rodar ANTES de WIKI-012) — Migrations das emendas
```sql
-- supabase/migrations/20260611d_wiki_source_type_context_source.sql
-- conferir o nome real do constraint antes: \d "ProjectWikiSectionSource"
ALTER TABLE "ProjectWikiSectionSource" DROP CONSTRAINT "ProjectWikiSectionSource_sourceType_check";
ALTER TABLE "ProjectWikiSectionSource" ADD CONSTRAINT "ProjectWikiSectionSource_sourceType_check"
  CHECK ("sourceType" IN ('meeting','design_session','task','sprint','pm_review','context_source'));
```
```sql
-- supabase/migrations/20260611e_wiki_section_inputs_hash.sql
ALTER TABLE "ProjectWikiSection" ADD COLUMN "inputsHash" text;
```
```sql
-- supabase/migrations/20260611f_wiki_job.sql  (D9 — substitui o Map in-memory do PRD)
CREATE TABLE "WikiJob" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId"  uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed')),
  trigger      text NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual','cron')),
  error        text,
  "startedAt"  timestamptz,
  "finishedAt" timestamptz,
  "createdAt"  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_wiki_job_project ON "WikiJob"("projectId", "createdAt" DESC);
ALTER TABLE "WikiJob" ENABLE ROW LEVEL SECURITY;
CREATE POLICY wj_select ON "WikiJob" FOR SELECT USING (can_view_project("projectId"));
REVOKE INSERT, UPDATE, DELETE ON "WikiJob" FROM authenticated;
```
- **verifiable (sql):** os 3 rodam sem erro; types regenerados; tsc passa.

### Deltas sobre as stories do PRD

- **WIKI-009..012 (Edge Function)** → implementar como **módulo Next**: `src/lib/wiki/composer.ts` com `composeWiki(projectId, jobId)` (skeleton → load context → LLM por seção → persist). A rota worker é `POST /api/internal/wiki-composer` protegida por header `x-cron-secret === process.env.CRON_SECRET` (sem sessão de usuário; usa client service-role do padrão do repo). Os ACs de conteúdo das stories (schemas Zod, prompts, UPSERT preservando suppressed) valem inalterados.
- **WIKI-010 (load context) — emenda do pool:** além de DS + meetings + tasks (spec do PRD), carregar os `ContextSource` do projeto: `id, kind, title, summary, fullText` (truncar cada `fullText` em ~8k chars no prompt; se o total passar de ~80k chars, priorizar os de `snapshotAt` mais recente e logar o corte). Cada bullet gerado a partir de um source registra ref `sourceType='context_source', sourceId=<ContextSource.id>`.
- **WIKI-011 (LLM) — hash guard (D11):** antes de chamar o LLM pra uma seção, calcular `inputsHash = sha256(JSON dos inputs da seção)`; se igual ao `inputsHash` persistido, pular a seção (não regenerar, não tocar em `generatedAt`). Persistir o hash novo junto com o conteúdo quando gerar. LLM: `generateText` + `getModel(DEFAULT_MODEL)` de `src/lib/ai/provider.ts`.
- **WIKI-013 (compose 202):** cria row em `WikiJob` (`trigger='manual'`), dispara `fetch` não-aguardado pra rota worker com o secret, retorna `202 { jobId }`. **WIKI-014 (poll):** lê de `WikiJob` (404 se não existe).
- **WIKI-016..018 (UI):** conforme PRD, sem delta — botão "Gerar Wiki" + poll + WikiHero + suppress menu, dentro do `wiki-sheet.tsx` atual.
- **WIKI-019/020:** pular (D14).

## 7. Bloco D — cron diário (2 stories)

### CRON-001 — Rota `/api/cron/wiki-daily`
`POST`, autenticada por `x-cron-secret`. Lógica:
1. Seleciona projetos elegíveis: com ≥1 `ContextSource` OU `driveFolderId` não-nulo (e sem `WikiJob` `pending|running` pro projeto).
2. Por projeto, sequencialmente (não paralelo — é 03:00, latência não importa; rate limit importa):
   a. **Refresh (D13):** pra cada source de kind externo (`spreadsheet_gsheets`, `github_*`, `gdrive_file`, `notion`) com `snapshotAt` > 20h: re-rodar o adapter forçando bypass do cache de `fullText` (adicione um param `force?: boolean` ao `resolveContent` ou limpe `fullText` antes — escolha 1 e aplique em todos os adapters externos de forma uniforme). Erro num source → loga, marca e segue (não derruba o batch).
   b. Cria `WikiJob` (`trigger='cron'`) e chama `composeWiki(projectId, jobId)` direto (mesma instância — sem fetch).
3. Responde `{ projects: n, refreshed: n, composed: n, failures: [...] }`.
- **verifiable (http):** `curl -X POST localhost:3000/api/cron/wiki-daily -H "x-cron-secret: $CRON_SECRET"` → 200 com counts; sem header → 401.

### CRON-002 — Agendamento pg_cron + Vault
Migration `20260611g_wiki_daily_cron.sql`: função `kick_wiki_daily()` que lê base URL da app + `CRON_SECRET` do **Vault** e faz `net.http_post` pra `/api/cron/wiki-daily` — siga o padrão exato de `supabase/migrations/20260521_granola_auto_import.sql` §5 (leia antes de escrever). Schedule: `cron.schedule('wiki-daily', '0 6 * * *', $$SELECT kick_wiki_daily()$$)`.
Adicionar `CRON_SECRET` no `.env` (gerar com `openssl rand -hex 32`), inserir no Vault junto com a URL (o padrão granola mostra como), e adicionar a env no `cloudbuild.yaml` (o arquivo já está modificado no tree — só acrescente a env, não mexa no resto).
- **verifiable (sql):** `SELECT jobname, schedule FROM cron.job WHERE jobname='wiki-daily';` → 1 row.

## 8. Riscos e como reagir

| Risco | Reação |
|-------|--------|
| Shape do retorno de `GOOGLEDRIVE_EXPORT_GOOGLE_WORKSPACE_FILE` divergir (toolkit evolui) | Logar payload bruto no primeiro erro, normalizar defensivamente, conferir schema no dashboard Composio. Não travar a sessão nisso: se export falhar pra um mimeType, suportar os Google-native primeiro e PDFs depois |
| Constraint name do CHECK diferente do esperado | `\d "ProjectWikiSectionSource"` / `\d "ContextSource"` antes do ALTER |
| `pnpm` vs `npx` | Use o que o repo usa (`package.json` scripts); typecheck canônico: `npx tsc --noEmit` |
| Compose demorar > timeout do fetch interno | O worker é rota separada: o fetch do 202 não aguarda resposta (fire-and-forget com `.catch`). No cron, chamada direta de função — sem fetch |
| Prompt da wiki alucinar fato sem fonte | Regra do repo (grounded): bullet sem ref tipada não persiste — o persist (WIKI-012) deve descartar bullets cujo array de refs veio vazio e logar |

## 9. Checklist final — "pronto pra testes" (fazer TODOS antes de encerrar)

Pré-requisito: um projeto real com `driveFolderId` configurado e Drive conectado (se nenhum tiver, configurar via UI usando a pasta de teste do João — pedir no chat se necessário... **não**: agente é autônomo; use qualquer projeto que já tenha `driveFolderId` não-nulo: `SELECT id, name FROM "Project" WHERE "driveFolderId" IS NOT NULL;` — a Fase 1 já foi testada com pasta real).

- [ ] `npx tsc --noEmit` exit 0 e lint sem erro novo
- [ ] Sync do Drive popula `stage` (SQL do DRVS-002) e a aba mostra grupos por etapa
- [ ] Importar 1 Doc do Drive → `ContextSource kind='gdrive_file'` com `fullText` não-vazio; reimport não duplica
- [ ] `read_context_source` resolve o source importado (testar via SQL/unit do adapter se não houver driver de agente à mão)
- [ ] Botão "Gerar Wiki" → 202 → poll → seções `objectives/highlights/decisions` preenchidas com `generatedAt` e ≥1 ref em `ProjectWikiSectionSource` com `sourceType='context_source'`
- [ ] Gerar de novo SEM mudar fontes → seções puladas pelo hash guard (logs mostram skip; `generatedAt` não muda)
- [ ] Suppress de um bullet sobrevive a re-compose
- [ ] `POST /api/cron/wiki-daily` com secret → refresh + compose ok; sem secret → 401
- [ ] `cron.job` tem `wiki-daily` agendado
- [ ] prd.json com WIKI-004..018 `passes: true`, progress.txt atualizado, PRD em `in-progress/`
- [ ] Tudo commitado e pushado via `sync-main.sh` (commits por bloco/story, tag ZRD-JM-NN incremental)

Ao terminar: escreva um resumo de 10 linhas no chat com o que foi feito, o que ficou de fora (WIKI-019/020, Fase 3 embeddings) e o roteiro de teste manual pro João (3-5 passos clicáveis).
