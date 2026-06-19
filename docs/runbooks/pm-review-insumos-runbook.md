# PM Review — Insumos (happy path) + escopo da Vitoria

Como um insumo (transcript/doc/reunião) vira contexto que a **Vitoria (PM Review)**
lê — e por que ela lê **só o que foi linkado na aba INSUMOS**, nada do pool aberto.

Escrito após 3 bugs encadeados (jun/2026): prompt congelado em resume, vazamento
do pool, e import que deixava o insumo órfão. Ver §"Falhas conhecidas".

---

## 1. O happy path, ponta a ponta

```
PM na aba INSUMOS do PM Review
  │
  ├─ "Importar reunião" (Granola/Roam)         POST /api/pm-review/[id]/transcripts/sources
  ├─ "Linkar do pool"                          POST /api/pm-reviews/[id]/context/link
  └─ "Documento" (upload)                       (cria ContextSource + linka)
        │
        ▼
  upsertTranscriptRef(...)  →  ContextSource           (SSOT do conteúdo)
        │                       • kind=transcript|document|...
        │                       • projectId = o do PM Review   ← carimbado SEMPRE
        │                       • fullText = conteúdo
        ▼
  linkTranscriptToPMReview(...) → EntityLink            (= "está na aba INSUMOS")
        │                          • pmReviewId = este review
        │                          • contextSourceId = o ContextSource
        │                          • weight = primary
        ▼
  loadContext (pm-review.ts)  lê EntityLink.pmReviewId
        │   → bloco "Fontes de contexto linkadas" no system prompt (SNAPSHOT do 1º turn)
        ▼
  Vitoria (PM Review) sintetiza lendo SÓ o linkado:
        • list_linked_sources   → lista AO VIVO os insumos linkados (aba INSUMOS)
        • read_transcript_content(id, offset) → conteúdo, paginado em janelas de 18k
        • read_context_source(id)             → docs/planilhas
        ▼
  update_pm_review_report(...) → report nas 6 seções, citando os source IDs
```

**Invariante:** o que a Vitoria pode ler = `EntityLink` deste `pmReviewId`. Sempre.
Nem o pool do projeto, nem fontes de outros reviews/DS, nem o design system.

---

## 2. Tabelas que mandam

| Coisa | Tabela / coluna | Quem escreve | Quem lê |
|------|------------------|--------------|---------|
| Conteúdo do insumo (SSOT) | `ContextSource` (`fullText`, `projectId`, `kind`) | `upsertTranscriptRef` | `read_transcript_content`, `read_context_source` |
| **Vínculo = "está em INSUMOS"** | `EntityLink.pmReviewId → contextSourceId` | `linkTranscriptToPMReview` | `loadContext`, `list_linked_sources` |
| Pool do projeto (todas as fontes) | `ContextSource.projectId` | imports/adapters | `list_context_sources` (**só Release Planning**) |

`EntityLink` é polimórfica: `designSessionId` (DS), `pmReviewId` (PM Review),
`planningCeremonyId` (Sprint Planning), `planningSessionId` (Release Planning).

---

## 3. Escopo por surface da Vitoria (não confundir)

| Surface | Tool de descoberta | Escopo | Por quê |
|---------|--------------------|--------|---------|
| **PM Review** | `list_linked_sources` | **só linkado** (EntityLink) | síntese de status tem que ser ancorada no que o PM curou — pool vazaria fonte não-escolhida |
| **Sprint Planning** | `list_context_sources` | pool + flag `linked` | — |
| **Release Planning** | `list_context_sources` + `link_context_source` | pool (curadoria) | o trabalho ali é descobrir fontes além das linkadas e curá-las |

Regra mental: **PM Review SÍNTESE → só linkado. Planning CURADORIA → pool.**

Tools em [`tools/context-source.ts`](../../src/lib/agent/tools/context-source.ts):
`createListLinkedSourcesTool` (linked) e `createListContextSourcesTool` (pool).
Wiring por surface em [`tools-registry.ts`](../../src/lib/agent/tools-registry.ts)
(`VITORIA_PMREVIEW_TOOLS` etc.).

---

## 4. Por que `read_transcript_content` pagina (offset)

A Vitoria roda no **daemon** (Claude Code SDK), cujo toolset é só `mcp__zordon__*`
— `Read`/`Bash` nativos ficam **disallowed**. O SDK derrama resultado de tool
**grande** (> ~25k chars, teto de output do MCP) pra um **arquivo em disco**, que
o agente não consegue abrir → o insumo grande some.

Empírico (projeto SILFAE): transcript de **20.969 chars** entrou inline; o de
**61.899 chars** estourou. Por isso `read_transcript_content` devolve em **janela
de 18.000 chars** + `{ hasMore, nextOffset }`. O agente pagina (`offset=nextOffset`)
até `hasMore=false` — lê 100% do transcript, em pedaços que cabem.

> Mesmo teto vale pro `read_context_source` (cap de 50k > ~25k). Fontes
> estruturadas grandes já são roteadas pro `describe/query_structured_source`
> (não inlinam). Texto não-estruturado > ~50k ainda é dívida — ver backlog.

---

## 5. Cross-repo (app ↔ daemon)

A execução das tools roda no **app** (monorepo, `/api/agents/tools/[toolName]`).
O **daemon** só expõe nome + schema via MCP (`mcp-server.ts` → `getToolNamesForAgent`).
Toda tool nova exige tocar os dois:

- **app**: factory real (com `execute`) em `tools/*` + entry no `tools-registry.ts`.
- **daemon**: stub (description + inputSchema, sem `execute`) + mesmo entry/surface.

`description` e `inputSchema` precisam bater entre os dois — é o que o modelo vê.

---

## 6. Falhas conhecidas (e como o happy path as evita)

| Sintoma | Causa | Correção |
|---------|-------|----------|
| Agente não vê insumo anexado no meio do chat | bloco de fontes do prompt é snapshot do 1º turn (resume congela) | `list_linked_sources` re-consulta ao vivo |
| Agente lê fonte que o PM **não** linkou ("vazamento") | tool de descoberta listava o **pool** no PM Review | PM Review usa `list_linked_sources` (só EntityLink) |
| Agente não lê o transcript linkado de 60k+ | resultado grande derramado pra disco (sem Read no daemon) | paginação por `offset` (janela 18k) |
| Insumo importado **some** (existe mas não linka) | import criava `ContextSource` sem `projectId` e o link era escrita separada — se falhava, sobrava **órfão** (sem projectId, sem EntityLink) | import carimba `projectId`; re-import é idempotente (upsert por `source+sourceId`) → recria o link |
| Vitoria puxa o **design system** como insumo | `design_system` (HTML de UI das settings) estava no pool | `list_context_sources` exclui `kind='design_system'` |

### Recuperar um órfão (ContextSource sem EntityLink)

Re-importar o mesmo Granola/Roam (idempotente) recria o link. Ou, manualmente,
inserir o `EntityLink(pmReviewId, contextSourceId, weight='primary')`.

---

## 7. Arquivos

- Tools: [`src/lib/agent/tools/context-source.ts`](../../src/lib/agent/tools/context-source.ts)
- Tool PM Review (`read_transcript_content`, notas, report): [`src/lib/agent/agents/vitoria/pm-review.ts`](../../src/lib/agent/agents/vitoria/pm-review.ts)
- Wiring por surface: [`src/lib/agent/tools-registry.ts`](../../src/lib/agent/tools-registry.ts)
- Import Granola/Roam: [`src/app/api/pm-review/[id]/transcripts/sources/route.ts`](../../src/app/api/pm-review/%5Bid%5D/transcripts/sources/route.ts)
- Link do pool: [`src/app/api/pm-reviews/[id]/context/link/route.ts`](../../src/app/api/pm-reviews/%5Bid%5D/context/link/route.ts)
- Daemon (stubs espelhados): `zordon-daemon/src/lib/agent/tools/context-source.ts`, `.../tools-registry.ts`
