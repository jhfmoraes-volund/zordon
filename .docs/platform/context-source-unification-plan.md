# Plano — Unificação de Contexto Importado em `ContextSource` (Jeito A)

> **Status:** plano para revisão. Nada executado.
> **Objetivo (João):** uma fonte da verdade única e centralizada para contexto importado (transcript, planilha, github, meeting), sem redundância.
> **Decisão tomada:** Jeito A — `ContextSource` vira a tabela única; `TranscriptRef` é absorvida e dropada.
> **Conclui:** a migração estagnada do PRD [prd-context-source-unified](../prd/done/prd-context-source-unified.md) (marcada "done" prematuramente — só rodou create + backfill). Os links já foram unificados em [[project_entitylink_unification]] (D5/D6 do PRD, feito de forma melhor).

---

## 1. Realidade atual (com evidência)

### Escrita (ingestão) — funil único
Toda transcrição passa por **`upsertTranscriptRef()`** ([src/lib/transcripts/upsert.ts:35](../../src/lib/transcripts/upsert.ts)) → grava `TranscriptRef`. Callers:
- `granola-auto-import.ts` (cron + manual) — cria stub.
- Alpha `save_meeting_transcript_text` ([alpha/tools.ts:1320](../../src/lib/agent/agents/alpha/tools.ts)) — preenche `fullText` no ingest headless.
- Roam / manual via `POST /api/meetings`; Design Session via `/api/design-sessions/[id]/transcripts`; planilha via rota Planning.

### Leitura (consulta)
- Tool compartilhada `read_transcript_content` ([tools/read-transcript-content.ts](../../src/lib/agent/tools/read-transcript-content.ts)) → `TranscriptRef.fullText`, fallback `Meeting.notes`.
- Vitor/Vitoria/Alpha leem campos ricos: `participants`, `actionItems`, `meetingId`, `summary`.
- `EntityLink` referencia transcript via embed `TranscriptRef!EntityLink_transcriptRefId_fkey` (criado em [[project_entitylink_unification]]).

### `ContextSource` hoje = guarda-chuva pela metade
- Escrita só por `POST /api/context-sources` (gsheets/github) — mas a UI que alimenta isso está **órfã** → **0 linhas** de csv/gsheets/github.
- Tem só **18 transcript + 1 meeting backfillados** (mig `20260530d/e`), espelho stale: o backfill **não copiou** `participants`/`actionItems`/`summary`/`endedAt`/`storagePath`.
- Lido pela tool `read-context-source` (dispatch por kind).

### UI
- Base unificada OK: `ContextSheet` reusada em PM Review / Planning / Design Session / PRD session.
- Órfãos: `SpreadsheetModal`, `GithubSourceModal`, `ContextRibbon`, `ContextLinkList` em `agent/context-import/` (nunca importados).
- Duplicados: Planning tem `SpreadsheetImportModal` + `GitHubRepoModal` próprios.
- Contratos de unlink divergentes: PM Review `/transcripts/{itemId}` · Planning `?transcriptRefId=` · Design Session `/transcripts/{id}`.

---

## 2. End-state alvo

- **`ContextSource` = SSOT único** de todo contexto importado. `kind` enum já cobre (transcript/meeting/spreadsheet_csv/gsheets/github_repo/pr/issue).
- `TranscriptRef` **dropada**; campos ricos viram colunas de `ContextSource`.
- `EntityLink`: coluna `transcriptRefId` removida — transcript referenciado via `contextSourceId` (**simplifica** o EntityLink: 1 FK de ref a menos).
- Ingestão: `upsertTranscriptRef` repontado pra escrever `ContextSource` (mantém dedup por `source`+`sourceId`).
- Leitura: `read_transcript_content` lê `ContextSource`; embeds repontados.
- UI: órfãos ligados ou removidos; contratos de unlink normalizados.

### Schema — colunas a adicionar em `ContextSource`
Mirror dos campos ricos de `TranscriptRef` (nullable — só preenchidos p/ kind='transcript'):

| Coluna | Tipo | Origem TranscriptRef |
|---|---|---|
| `source` | text | source |
| `sourceId` | text | sourceId |
| `byline` | text | byline |
| `meetingId` | uuid FK Meeting ON DELETE SET NULL | meetingId |
| `storagePath` | text | storagePath |
| `endedAt` | timestamptz | endedAt |
| `participants` | jsonb | participants |
| `actionItems` | jsonb | actionItems |

Já existentes e reaproveitados: `id`, `title`, `summary`, `fullText`, `capturedAt`, `createdBy`(=importedById), `createdAt`(=importedAt).
**Decisão D-E:** colunas reais (não `payload`) pros campos que os agentes leem estruturado — menos reescrita, menos risco. `payload` segue pros dados kind-specific dos outros kinds (snapshot CSV, repo full_name, etc).
Dedup: índice único parcial `(source, sourceId) WHERE source IS NOT NULL` (espelha o de TranscriptRef).

---

## 3. Fases (com gates de verificação)

| Fase | Escopo | Arquivos / objetos | Risco | Gate |
|---|---|---|---|---|
| **1 — Schema** | Adicionar as 8 colunas + unique parcial em ContextSource | migration `2026XXXX_a` | aditivo, zero | colunas existem; tsc após `db:types` |
| **2 — Backfill** | Preencher novas colunas dos 18 transcript-CS a partir do TranscriptRef; garantir 1 ContextSource por TranscriptRef | migration `2026XXXX_b` | aditivo, reversível | `count` bate; participants/actionItems preenchidos |
| **3 — Ingestão** | `upsertTranscriptRef` passa a escrever ContextSource (mantém assinatura + dedup + retorno de id). Atualizar `filterUnimportedNotes` (granola) p/ checar ContextSource | `transcripts/upsert.ts`, `granola-auto-import.ts` | médio | import real (granola manual) cai em ContextSource; dedup funciona |
| **4 — Leitura** | `read_transcript_content` → ContextSource; loaders de Vitor/Vitoria/Alpha → colunas de ContextSource; embeds + `EntityLink.transcriptRefId`→`contextSourceId` | `read-transcript-content.ts`, `vitor/index.ts`, `vitoria/{index,pm-review}.ts`, `alpha/tools.ts`, `agent/prompt.ts`, `agent/context.ts`, `dal/{planning,pm-review,design-session-transcripts}.ts`, rotas que embedam transcript | **ALTO — cérebro dos agentes** | tsc 0; smoke runtime dos embeds; rodar Vitor/Vitoria/Alpha num caso real e comparar saída |
| **5 — UI** | Ligar modais órfãos OU matar duplicados; normalizar contratos de unlink | `agent/context-import/*`, `planning/*-modal.tsx`, rotas de unlink | médio | UI lista/importa/desliga nas 3 superfícies |
| **6 — Drop** | Dropar TranscriptRef + FK Meeting↔TranscriptRef + coluna `EntityLink.transcriptRefId` | migration `2026XXXX_c` | após validação prod | nada referencia TranscriptRef; app verde |

**Ordem segura:** 1→2 aditivas (podem ir já). 3 e 4 juntas num deploy (ingestão e leitura têm que cruzar coerentes). 5 em paralelo/depois. 6 só após validação em prod + re-sync da janela de deploy.

---

## 4. Decisões pendentes (precisam do João)

| # | Decisão | Recomendação |
|---|---|---|
| **D-A** | Caminho de planilha do Planning (`/api/planning/[id]/sources/spreadsheet`) hoje grava TranscriptRef `source='spreadsheet'`. Converge p/ `ContextSource kind='spreadsheet_csv'`? | **Sim** — é o ponto do Jeito A. Planilha deixa de ser "transcript". |
| **D-B** | `Meeting` tem FK `TranscriptRef.meetingId`. Após drop, relação Meeting↔transcript via `ContextSource.meetingId`. | Repontar (já incluso na Fase 1/6). |
| **D-C** | `Meeting` vira ContextSource kind='meeting'? (PRD D6) ou Meeting fica tabela própria e só é *referenciada*? | **Meeting fica tabela própria** (PRD §3 não-objetivo: "não mexe em Meeting"). ContextSource kind='meeting' só projeta via meetingId. |
| **D-D** | Normalizar os 3 contratos de unlink num só (`DELETE /api/.../context/[linkId]`). | **Sim** — alinhar com o que o EntityLink já usa. |
| **D-E** | Campos ricos como colunas vs `payload` jsonb. | **Colunas** (menos reescrita de agente, type-safe). |

---

## 5. Riscos

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| Quebrar leitura dos agentes (Vitor/Alpha/Vitoria) | Média | Alto | Manter shape dos campos idêntico; tsc + smoke runtime; rodar agentes em caso real antes do drop |
| EntityLink referencia `transcriptRefId` (recém-criado por mim) | Baixa | Médio | Repontar p/ contextSourceId na Fase 4; eu criei, conheço todos os pontos |
| Janela de deploy (escrita no caminho velho durante deploy) | Média | Médio | Dual-write na Fase 3 OU re-sync com ON CONFLICT antes do drop |
| Backfill incompleto (participants/actionItems faltando) | — | — | Fase 2 copia do TranscriptRef (SSOT atual desses campos) |
| `ContextSource.projectId` — transcripts não têm projeto direto | Baixa | Baixo | Fica nullable (backfill já põe NULL) |

---

## 6. Próximo passo

Revisar este plano. Decidir D-A..D-E. Então executar Fase 1-2 (aditivas, seguras) e parar pro próximo checkpoint antes da Fase 3/4 (ingestão + leitura = onde mora o risco).
