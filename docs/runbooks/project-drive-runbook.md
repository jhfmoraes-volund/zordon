# Runbook — Aba Google Drive no projeto (Fase 1: listagem + índice)

> **Executor:** agente Claude Code, fresh context. Leia este runbook inteiro antes de tocar em código.
> **Sequência:** rodar DEPOIS de `wiki-hero-sheet-runbook.md` (a aba Drive entra no lugar da Wiki).
> **Commit:** ao final de cada story que passa os checks, `bash scripts/sync-main.sh -m "ZRD-JM-NN: drive — <resumo>"`.
> **Migrations:** sempre via `source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql "$DIRECT_URL" -f supabase/migrations/<arquivo>.sql`, depois atualizar `src/lib/supabase/database.types.ts`.

## 1. Problema

- Artefatos do projeto (propostas, contratos, decks, planilhas do cliente) vivem no Google Drive e não têm porta de entrada no Zordon.
- A antiga aba Wiki saiu (virou sheet no hero); o slot de aba está livre pra "documentos do projeto".
- Agentes (Vitoria, prepare-context) não enxergam esses documentos — Fase 2 resolverá isso em cima do índice criado aqui.

## 2. Solução em uma frase

Cada projeto linka uma pasta do Google Drive; uma aba "Drive" lista os arquivos a partir de um índice no Supabase (metadata only), sincronizado on-demand via Composio.

## 3. Não-objetivos (Fase 1)

- NÃO baixar/espelhar binários no Supabase Storage — Drive é o SSOT dos arquivos.
- NÃO extrair conteúdo textual pros agentes (Fase 2: `GOOGLEDRIVE_EXPORT_GOOGLE_WORKSPACE_FILE` → texto/markdown no índice).
- NÃO sync recursivo de subpastas — só filhos diretos da pasta linkada; subpastas viram cards que linkam pro Drive.
- NÃO cron de sync — refresh manual (botão) apenas.
- NÃO thumbnails — `thumbnailLink` do Drive é short-lived/credenciado; renderizar ícone local por mimeType.
- NÃO instalar `googleapis` SDK (decisão D10 de `docs/prd/done/prd-context-source-unified.md`, linha 570: "NÃO instalar googleapis SDK direto — tudo via Composio").

## 4. Decisões fixadas

| # | Decisão | Por quê |
|---|---------|---------|
| D1 | Integração via **Composio**, toolkit `googledrive` | Padrão estabelecido (GSheets via Composio em `src/lib/context-sources/adapters/gsheets.ts`); `@composio/core` já instalado; D10 do PRD context-source-unified proíbe googleapis SDK |
| D2 | Env `COMPOSIO_GDRIVE_AUTH_CONFIG_ID`; ausente → erro gracioso 412 com connect URL | Espelha `COMPOSIO_GSHEETS_AUTH_CONFIG_ID` (opt-in, resto da app funciona) |
| D3 | `Project.driveFolderId` (text) + `Project.driveLinkedBy` (uuid → Member) setados juntos ao configurar a pasta | O sync executa com o connected account de `driveLinkedBy` — qualquer membro pode clicar "Sincronizar" sem ter Drive conectado |
| D4 | Tool de listagem: `GOOGLEDRIVE_FIND_FILE` com `query: "'<folderId>' in parents and trashed = false"`, paginação `pageSize`/`pageToken` | Tool recomendada do toolkit (LIST_FILES está deprecated); cobre folder scoping nativo |
| D5 | Índice em tabela `ProjectDriveFile`, upsert por `(projectId, fileId)`; arquivos que sumiram do Drive são deletados do índice no sync | Aba renderiza do banco (instantâneo, sem chamada ao Google por visita); delete mantém índice = espelho da pasta |
| D6 | Sync **inline** no POST (sem job): cap de 200 arquivos (2 páginas de 100), timeout-friendly | Listagem de 1 pasta é 1-2 calls REST; regra "async se >1s" do repo mira LLM/jobs — aqui é I/O simples (mesmo padrão do gsheets adapter). Se a pasta passar de 200, retornar `truncated: true` e avisar na UI |
| D7 | Aba `drive` entra no TABS na posição da antiga `wiki` (label "Drive", ícone `FolderOpen`), visível pra quem via a Wiki | Slot e visibilidade preservados |
| D8 | RLS: `SELECT` via `can_view_project("projectId")`; INSERT/UPDATE/DELETE revogados de `authenticated` (writes só server-side pela API) | Padrão do repo (ver `20260530e_project_wiki_section_source_table.sql`) |
| D9 | Configuração da pasta no `ProjectEditSheet`: campo "Pasta do Google Drive" aceita URL ou ID; parse extrai o folder ID de `drive.google.com/drive/folders/<id>` | UX simples; PM cola a URL |
| D10 | Subpastas aparecem no índice (`mimeType = application/vnd.google-apps.folder`) como cards clicáveis pro Drive — sem navegação interna | Fase 1 mínima; navegação em árvore só se houver demanda |

## 5. Mapa do código (reusar, não recriar)

| O quê | Onde |
|-------|------|
| Client Composio singleton (`getClient`, `initiateConnection`, `getConnectionStatus`, `executeTool`, `ComposioConnectionMissing`) | `src/lib/composio/client.ts` — **adicionar** `googledrive: "latest"` em `toolkitVersions` |
| Padrão de adapter + erro 412 connect-URL | `src/lib/context-sources/adapters/gsheets.ts` (linhas 46-70) |
| Endpoints connect/status/disconnect (genéricos por toolkit) | `src/app/api/integrations/composio/{connect,status,disconnect}/route.ts` — verificar se aceitam `toolkit` como param; se hardcoded, generalizar |
| Tabs do projeto | `src/app/(dashboard)/projects/[id]/page.tsx` (array TABS) |
| Sheet de edição do projeto (vai ganhar o campo da pasta) | `src/components/projects/project-edit-sheet.tsx` |
| PATCH do projeto | `src/app/api/projects/[id]/route.ts` |
| Padrão RLS de referência | `supabase/migrations/20260530e_project_wiki_section_source_table.sql` |

Chamada Composio (forma atual do SDK no repo — conferir assinatura em `client.ts`):

```ts
const result = await executeTool(memberId, "GOOGLEDRIVE_FIND_FILE", {
  query: `'${folderId}' in parents and trashed = false`,
  pageSize: 100,
  // pageToken: <da página anterior>
});
```

## 6. Schema (2 migrations atômicas)

### `supabase/migrations/<data>_project_drive_folder.sql`

```sql
ALTER TABLE "Project"
  ADD COLUMN "driveFolderId" text,
  ADD COLUMN "driveLinkedBy" uuid REFERENCES "Member"(id) ON DELETE SET NULL;
```

### `supabase/migrations/<data>b_project_drive_file.sql`

```sql
CREATE TABLE "ProjectDriveFile" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "projectId"    uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  "fileId"       text NOT NULL,
  name           text NOT NULL,
  "mimeType"     text NOT NULL,
  "sizeBytes"    bigint,
  "modifiedTime" timestamptz,
  "webViewLink"  text,
  "iconHint"     text,
  "syncedAt"     timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("projectId", "fileId")
);

CREATE INDEX ix_pdf_project ON "ProjectDriveFile"("projectId");

ALTER TABLE "ProjectDriveFile" ENABLE ROW LEVEL SECURITY;

CREATE POLICY pdf_select ON "ProjectDriveFile" FOR SELECT
  USING (can_view_project("projectId"));

-- Writes só server-side (API routes com service role)
REVOKE INSERT, UPDATE, DELETE ON "ProjectDriveFile" FROM authenticated;
```

> Antes de rodar: confirmar nome real da tabela de membros (`"Member"`) e do helper `can_view_project` no schema atual (`\df can_*` no psql).

## 7. APIs

| Método | Path | Contrato |
|--------|------|----------|
| GET | `/api/projects/[id]/drive/files` | 200 `{ files: ProjectDriveFile[], syncedAt: string \| null, folderId: string \| null }`. Lê só do índice. |
| POST | `/api/projects/[id]/drive/sync` | Lista pasta via Composio (account de `driveLinkedBy`), upsert + delete no índice. 200 `{ files, syncedAt, truncated }` · 409 sem `driveFolderId` · 412 `{ connectUrl }` sem conexão/auth-config (padrão `ComposioConnectionMissing`) · 502 erro do Drive |
| PATCH | `/api/projects/[id]` (existente) | Aceitar `driveFolderId` (string \| null); ao setar não-nulo, gravar `driveLinkedBy = member da sessão`. Validação Zod no route (nunca no client) |

## 8. UX da aba

```
┌─ Drive ──────────────────────────────────────────────┐
│ 📁 Pasta do projeto      Sincronizado há 2h  [⟳ Sync]│
│ ──────────────────────────────────────────────────── │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐      │
│ │📄 Prop..│ │📊 Cron..│ │📁 Design│ │📑 Contr.│      │
│ │ Doc     │ │ Sheet   │ │ pasta   │ │ PDF     │      │
│ │ há 3d   │ │ há 1sem │ │   →     │ │ há 2sem │      │
│ └─────────┘ └─────────┘ └─────────┘ └─────────┘      │
└──────────────────────────────────────────────────────┘
Estados vazios:
  sem driveFolderId  → CTA "Configurar pasta do Drive" (abre ProjectEditSheet)
  412 sem conexão    → CTA "Conectar Google Drive" (connectUrl do Composio)
  índice vazio       → "Pasta vazia ou ainda não sincronizada" + botão Sync
```

Card abre `webViewLink` em nova aba. Ícone local por `mimeType` (Doc/Sheet/Slide/PDF/img/pasta/genérico). Lista do índice via `useOptimisticCollection`? **Não** — é read-only espelho; fetch simples + estado local basta (sem mutação de coleção pelo usuário).

## 9. Stories

```yaml
- id: PDRV-001
  title: Migrations driveFolderId + ProjectDriveFile
  description: Criar e rodar as 2 migrations do §6; atualizar database.types.ts.
  acceptanceCriteria:
    - "Colunas driveFolderId/driveLinkedBy existem em Project"
    - "Tabela ProjectDriveFile existe com RLS habilitada"
  verifiable:
    - kind: sql
      command_or_query: "SELECT column_name FROM information_schema.columns WHERE table_name='Project' AND column_name IN ('driveFolderId','driveLinkedBy');"
      expected: "2 linhas"
    - kind: sql
      command_or_query: "SELECT relrowsecurity FROM pg_class WHERE relname='ProjectDriveFile';"
      expected: "t"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 15
  touches: [supabase/migrations/, src/lib/supabase/database.types.ts]

- id: PDRV-002
  title: Toolkit googledrive no client Composio
  description: >
    Registrar googledrive em toolkitVersions no getClient(); garantir que
    connect/status/disconnect aceitam toolkit=googledrive; env
    COMPOSIO_GDRIVE_AUTH_CONFIG_ID documentada em .env.example (se existir).
  acceptanceCriteria:
    - "initiateConnection(userId, 'googledrive', cb) retorna redirect URL quando env setada"
    - "Sem env → ComposioConnectionMissing (não crash)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: lint
      command_or_query: "grep -n 'googledrive' src/lib/composio/client.ts"
      expected: ">= 1 ocorrência"
  dependsOn: []
  estimateMinutes: 20
  touches: [src/lib/composio/client.ts, src/app/api/integrations/composio/]

- id: PDRV-003
  title: PATCH project aceita driveFolderId (com parse de URL)
  description: >
    Estender schema Zod do PATCH /api/projects/[id] com driveFolderId opcional
    (string|null). Helper parseDriveFolderId(input) extrai ID de URL
    drive.google.com/drive/folders/<id> ou aceita ID puro. Ao setar, gravar
    driveLinkedBy. Campo "Pasta do Google Drive" no ProjectEditSheet.
  acceptanceCriteria:
    - "PATCH com URL completa persiste só o folder ID"
    - "PATCH com null limpa driveFolderId e driveLinkedBy"
    - "Campo visível no ProjectEditSheet (Field compound API, sem h-9 custom)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: http
      command_or_query: "PATCH /api/projects/<id> body {driveFolderId: 'https://drive.google.com/drive/folders/abc123?usp=sharing'}"
      expected: "200; SELECT driveFolderId = 'abc123'"
  dependsOn: [PDRV-001]
  estimateMinutes: 25
  touches: [src/app/api/projects/[id]/route.ts, src/components/projects/project-edit-sheet.tsx]

- id: PDRV-004
  title: POST /drive/sync + GET /drive/files
  description: >
    Implementar os 2 endpoints do §7. Sync: executeTool com account de driveLinkedBy,
    GOOGLEDRIVE_FIND_FILE paginado (cap 200), normalizar pro shape ProjectDriveFile,
    upsert por (projectId,fileId), deletar fileIds ausentes. Mapear
    ComposioConnectionMissing → 412 {connectUrl}.
  acceptanceCriteria:
    - "Sync popula índice e segunda chamada é idempotente"
    - "Arquivo removido do Drive some do índice no próximo sync"
    - "Sem driveFolderId → 409; sem conexão → 412 com connectUrl"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: http
      command_or_query: "POST /api/projects/<id-sem-pasta>/drive/sync"
      expected: "409"
  dependsOn: [PDRV-001, PDRV-002, PDRV-003]
  estimateMinutes: 30
  touches: [src/app/api/projects/[id]/drive/]

- id: PDRV-005
  title: Aba Drive (UI)
  description: >
    Criar src/components/project-drive/drive-tab.tsx conforme §8: header com
    syncedAt relativo + botão Sync (busy state), grid de cards, 3 estados vazios,
    ícone por mimeType, banner se truncated. Registrar aba drive no TABS
    (posição da antiga wiki, ícone FolderOpen). Erros de sync via Sonner toast.
  acceptanceCriteria:
    - "Aba renderiza do índice sem chamar o Google"
    - "Botão Sync atualiza a lista e o syncedAt"
    - "Estado 412 mostra CTA de conexão funcional"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "configurar pasta real num projeto de teste, conectar Drive, sincronizar, abrir um arquivo"
      expected: "lista correta; webViewLink abre o arquivo; mobile ok"
  dependsOn: [PDRV-004]
  estimateMinutes: 30
  touches: [src/components/project-drive/, src/app/(dashboard)/projects/[id]/page.tsx]
```

## 10. Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| App OAuth gerenciado do Composio mostra aviso "unverified app" do Google em scopes sensíveis do Drive | média | médio | Aceitável pra uso interno; se incomodar, criar Auth Config com OAuth client próprio do Google (suportado pelo Composio, sem mudar código) |
| `driveLinkedBy` sai da empresa / revoga OAuth → sync quebra pra todo o projeto | média | médio | 412 no sync mostra quem é o account linkado + CTA pra re-linkar (qualquer um com edit pode se tornar o novo driveLinkedBy re-salvando a pasta) |
| Shape de retorno do `GOOGLEDRIVE_FIND_FILE` divergir do esperado (toolkit em evolução, ~89 tools) | média | baixo | Normalizar com parser defensivo + log do payload bruto no primeiro erro; verificar schema real no dashboard Composio antes de PDRV-004 |
| Pasta com >200 itens | baixa | baixo | `truncated: true` + banner na UI ("mostrando 200 primeiros — abra no Drive") |

## 11. Fase 2 (fora deste runbook — registrar, não implementar)

- Extração de conteúdo: `GOOGLEDRIVE_EXPORT_GOOGLE_WORKSPACE_FILE` (Docs→markdown) + download de PDFs → coluna `fullText` ou integração com ContextSource (`kind: 'gdrive_file'`) pra entrar no pool dos agentes via `read_context_source`.
- Delta sync via `GOOGLEDRIVE_GET_CHANGES_START_PAGE_TOKEN` + `LIST_CHANGES` em cron.
- Busca no índice (e embeddings/pgvector se houver demanda).

## 12. Referências

- Pesquisa de capacidade do toolkit (2026-06-10): actions `GOOGLEDRIVE_FIND_FILE`, `GOOGLEDRIVE_GET_FILE_METADATA`, `GOOGLEDRIVE_EXPORT_GOOGLE_WORKSPACE_FILE`; OAuth2 per-user only (sem service account); docs em https://docs.composio.dev/toolkits/googledrive
- Padrão adapter: `src/lib/context-sources/adapters/gsheets.ts`
- Decisão anti-googleapis: `docs/prd/done/prd-context-source-unified.md` (D10, linha 49; §10, linha 570)
- Runbook irmão: `docs/runbooks/wiki-hero-sheet-runbook.md`
