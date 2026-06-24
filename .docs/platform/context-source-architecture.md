# ContextSource & EntityLink — a camada de contexto do Zordon

**Status:** vivo · **Data:** 2026-06-12 · **Owner:** João Moraes
**Escopo:** o que são as entidades de contexto, por que essa estrutura é estratégica, onde queremos chegar e o que falta pra escalar sem virar dívida.

---

## 1. As duas entidades (e por que são duas)

A camada de contexto separa **conteúdo** de **vínculo**:

| Entidade | Responde | Cardinalidade |
|---|---|---|
| `ContextSource` | **"O que existe de conhecimento?"** — um documento/fonte com texto resolvido (`fullText`), scoped a um projeto | 1 por documento por projeto |
| `EntityLink` | **"Quem usa esse conhecimento?"** — o vínculo de um source com uma superfície de Insumos (DS, PM Review, Planning Session/Ceremony, Meeting) | N links por source |

Essa separação é deliberada e é o que faz o sistema compor:

- O **pool** é do projeto (`ContextSource.projectId`). Importar um documento uma vez serve todas as superfícies e todos os agentes.
- O **escopo de atenção** é da superfície (`EntityLink`). O Vitor enxerga só o que foi linkado à DS dele (memory `project_vitor_context_pool`: pool isolado por DS pra evitar contaminação entre discoveries); a Vitoria enxerga o projeto inteiro; a Wiki lê o pool todo.
- Deletar um link não deleta conhecimento; deletar um source invalida os links por FK.

```
┌────────────────────────────────────────────────────────────────────┐
│                        FONTES (mundo externo)                      │
│  Drive · Notion · GSheets · GitHub · Granola · Upload manual       │
└──────────────┬─────────────────────────────────────────────────────┘
               │ ingestão (4 vias, §2)
               ▼
┌──────────────────────────────┐      ┌──────────────────────────────┐
│  ContextSource (pool/projeto)│◄─────│  ProjectDriveFile (índice)   │
│  kind · title · fullText     │ D5   │  espelho da pasta, stage,    │
│  externalId · capturedAt     │import│  parentId — NÃO é contexto   │
│  payload · createdBy         │explíc│  até o humano importar       │
└──────┬────────────┬──────────┘      └──────────────────────────────┘
       │            │
       │ EntityLink │ leitura direta (pool inteiro do projeto)
       ▼            ▼
┌─────────────┐  ┌─────────────────────────────────────────┐
│ Superfícies │  │ Consumidores de pool                    │
│ DS · PMR ·  │  │ · read_context_source (Vitoria/Vitor/…) │
│ Planning ·  │  │ · Wiki composer (refs tipadas/bullet)   │
│ Meeting     │  │ · cron wiki-daily (refresh >20h)        │
└─────────────┘  └─────────────────────────────────────────┘
```

### 1.1 O contrato do `ContextSource`

O que o resto do sistema pode assumir de qualquer source, independente do kind:

1. **`fullText` é a verdade legível** — markdown/texto já extraído, pronto pra prompt. Quem consome nunca lida com binário, OAuth ou API externa.
2. **`capturedAt` é o snapshot** — quando o `fullText` foi capturado. Fontes externas têm refresh (manual via `/refresh`, automático via cron >20h).
3. **`externalId` é a chave de identidade externa** — dedup por `(kind, externalId, projectId)`.
4. **`id` é a chave de grounding** — toda citação de agente/Wiki referencia o source pelo uuid (regra do repo: conteúdo gerado sem ref tipada não publica).

### 1.2 O padrão adapter

Cada `kind` tem um adapter em `src/lib/context-sources/adapters/` com a mesma assinatura:

```ts
resolveContent(supabase, source, opts?: { force?: boolean })
  → Promise<{ fullText: string; snapshotAt: string }>
```

Kinds hoje (10): `transcript` · `meeting` · `spreadsheet_csv` · `spreadsheet_gsheets` · `github_repo/pr/issue` · `document` · `notion` · `gdrive_file`.

Adicionar fonte nova = 1 valor no enum + 1 adapter + entradas de dispatch. O Drive entrou em horas (2026-06-11) por causa disso. **Esse é o ativo a proteger.**

## 2. Como o pool se alimenta (4 vias de ingestão)

| Via | Kinds | Quando o texto é resolvido | Exemplo |
|---|---|---|---|
| **Upload** | `document`, `spreadsheet_csv` | Na hora do upload (`extractTextFromBuffer`); binário vai pro bucket `context-source-files` | PDF de requisitos arrastado na DS |
| **URL colada** | `spreadsheet_gsheets`, `github_*`, `notion` | Na leitura (live ou cache+refresh), via Composio com a conexão OAuth do `createdBy` | Planilha de pré-requisitos do cliente |
| **Auto-import** | `transcript`, `meeting` | No cron do Granola (hourly) | Transcript da daily |
| **Import explícito do Drive** | `gdrive_file` | Na hora do import (export Google-native ou download+extração) | Kickoff deck na pasta Comercial |

Princípio do Drive (D5 do runbook drive-context-wiki-pipeline): **o índice não é contexto**. `ProjectDriveFile` espelha a pasta (com `stage` da taxonomia Comercial/Imersão/Ops/Pós-Ops e `parentId` pra navegação); só o clique humano "Importar pro contexto" promove um arquivo a `ContextSource`. Curadoria humana mantém o pool com razão sinal/ruído alta — e isso fica mais importante quanto mais automático ficar o consumo.

## 3. Por que essa estrutura é estratégica

No modelo operacional do Zordon (memory `project_zordon_ops_pipeline`), tudo que os agentes produzem nasce de contexto: o Vitor faz discovery sobre documentos, a Vitoria audita sprint com transcripts e specs, a Wiki narra o projeto citando fontes, o Forge consome PRDs que nasceram desses insumos. **ContextSource é o substrato comum de todos esses fluxos** — é a resposta única pra pergunta "de onde o agente tirou isso?".

Três propriedades que só existem porque a camada é unificada:

1. **Grounding auditável.** A Wiki auto-gerada só publica bullet com ref tipada (`ProjectWikiSectionSource.sourceType='context_source'` → uuid clicável). Sem entidade única com id estável, cada feature inventaria sua própria proveniência — e a regra "sem ref, não publica" seria inaplicável.
2. **Frescor centralizado.** O cron `wiki-daily` re-resolve fontes externas com snapshot >20h **uma vez**, e todos os consumidores (wiki, agentes, superfícies) leem fresco. Freshness é problema de plataforma, não de feature.
3. **Custo de integração marginal decrescente.** Drive, Notion e GitHub entraram pelo mesmo molde. A próxima fonte (Slack? Linear? e-mail?) também entra. O pool cresce sem o consumo mudar.

A aposta de fundo: **a qualidade dos agentes da Volund é função da qualidade do contexto, não só do prompt** (alinhado com a regra "schema strictness > prompt strictness > modelo"). Investir nessa camada é investir em todos os agentes de uma vez.

## 4. Onde queremos chegar

Visão em 3 horizontes (H1 = já encaminhado; H3 = direção, sem compromisso de data):

### H1 — Pool curado e fresco por projeto (estamos aqui)
- Toda fonte relevante do projeto importável em ≤2 cliques (Drive ✅, Notion ✅, upload ✅).
- Refresh diário automático das fontes vivas (✅ cron wiki-daily, D13).
- Wiki executiva 100% grounded no pool (✅ composer com refs).
- **Gap restante:** higiene da entidade e consistência entre kinds (§5).

### H2 — Retrieval em vez de full-text stuffing
Hoje o consumo é "empurra fullText no prompt com caps" (composer: 8k/source, 80k total — no SIAL, 4 sources já ficaram **fora** do prompt). Isso para de funcionar em ~30+ documentos por projeto.

- **Embeddings por chunk** (pgvector, já previsto como Fase 3 do PRD project-wiki e alinhado com a skill library do Forge, memory `project_forge_hermes_alignment`).
- `read_context_source` ganha irmã `search_context` (busca semântica no pool) — o agente puxa o trecho certo em vez de ler documentos inteiros.
- Composer da Wiki seleciona por relevância, não por recência.
- Chunking acontece no write-path (no import/refresh), não no read.

### H3 — Contexto como grafo vivo
- Sources citam sources (um PRD referencia o transcript que o originou) — proveniência em cadeia até a fonte primária.
- Telemetria de uso: quais sources os agentes realmente citam → score de utilidade → sugestão de arquivamento do que nunca foi usado (mesmo loop de decay da skill library do Forge).
- Pool alimenta o Forge: `prepare-context` do daemon serve o contexto do projeto pra builds autônomos com a mesma proveniência.

## 5. O que falta pra ficar bem-feito e escalar

Dívidas concretas, verificadas no código em 2026-06-11/12, em ordem de prioridade. Cada uma é pequena; juntas elas decidem se a camada aguenta os horizontes acima.

### P0 — corrige antes de crescer (bugs e segurança)

| # | Problema | Onde | Fix |
|---|---|---|---|
| 1 | **GitHub source criado pela UI quebra na leitura**: o adapter lê `source.externalId`, mas o POST grava só `externalUrl` | `adapters/github.ts` vs `api/context-sources/route.ts` | POST passa a gravar `externalId` (e backfill dos existentes) |
| 2 | **Dedup só existe pra `gdrive_file`**: gsheets/github/notion duplicam à vontade no POST | `api/context-sources/route.ts` | Dedup uniforme por `(kind, externalId, projectId)` + UNIQUE parcial no banco |
| 3 | **POST/GET não validam acesso ao projeto**: qualquer membro autenticado cria/lista source em qualquer `projectId` (db() é service-role) | `api/context-sources/route.ts` | `canViewProject` no GET, `canEditSessions`/equivalente no POST |

### P1 — consolida o padrão (higiene de arquitetura)

| # | Problema | Fix |
|---|---|---|
| 4 | **Dispatch por kind triplicado** (`read-context-source.ts`, `[id]/content`, `[id]/refresh`) — drift garantido (os 3 já divergem em quais kinds suportam) | Registry único `src/lib/context-sources/registry.ts`: `Record<kind, adapter>` + capabilities (`refreshable`, `cached`). Os 3 call sites viram 1 lookup |
| 5 | **`ComposioConnectionMissing` duplicada** em 3 adapters (classes distintas, mesmo nome) | Mover pra módulo compartilhado `src/lib/context-sources/errors.ts` |
| 6 | **Semântica de cache inconsistente**: github/notion resolvem live a cada leitura (latência+custo por leitura de agente); gsheets/gdrive cacheiam com refresh | Padronizar: **todo kind externo cacheia em `fullText` + refresh por `force`** (o cron D13 já assume isso) |
| 7 | **Colunas de meeting bolted-on na entidade genérica** (`participants`, `actionItems`, `byline`, `meetingId`, `endedAt`) + `payload` subutilizado (`{}` em quase tudo) | Migrar metadata kind-específica pra `payload` (jsonb tipado por kind via Zod); deprecar colunas órfãs na próxima janela de migração |
| 8 | **`projectId` nullable no schema** apesar da convenção "pool é por projeto" | `SET NOT NULL` após backfill/limpeza dos órfãos (1 source com projectId de projeto deletado apareceu no smoke de 2026-06-11) |
| 9 | **FK de `projectId` sem ON DELETE** definido explicitamente — projeto deletado deixou sources órfãos | FK com `ON DELETE CASCADE` (Drive/contexto morre com o projeto; transcript órfão não serve a ninguém) |

### P2 — prepara o H2 (escala de consumo)

| # | Problema | Fix |
|---|---|---|
| 10 | Full-text stuffing com caps silenciosos (80k chars no composer; sources de fora só aparecem em log) | Curto prazo: expor o corte na UI da Wiki ("N fontes fora por tamanho"). Médio: chunking + pgvector no write-path |
| 11 | Sem telemetria de leitura: não sabemos quais sources os agentes usam | Logar leituras de `read_context_source` (sourceId, agente, threadId) — base do score de utilidade do H3 |
| 12 | Extração de texto depende de `pdf-parse` externalizado no Next (`serverExternalPackages`) — frágil a upgrade de bundler | Teste de fumaça no CI: extrair 1 PDF fixture via rota real |

### Regras pra mantenedores (o que NÃO fazer)

- **Não criar tabela nova de "insumo" por feature.** Fonte nova = kind novo + adapter. Superfície nova = coluna em `EntityLink`. (É a lição da unificação de link-tables, memory `project_entitylink_unification`.)
- **Não fazer auto-import do Drive no sync.** O import explícito (D5) é decisão de produto, não limitação técnica.
- **Não bypassar o adapter.** Consumidor que precisa de conteúdo chama `resolveContent` (ou o futuro registry) — nunca lê `fullText` cru assumindo que está fresco, e nunca chama Composio direto.
- **Citação sempre por `ContextSource.id`.** Nunca por URL, nunca por título.

## 6. Métricas pra saber se está funcionando

| Métrica | Instrumento | Sinal de saúde |
|---|---|---|
| Sources por projeto ativo | `SELECT "projectId", count(*) FROM "ContextSource" GROUP BY 1` | Crescendo nos projetos ativos (pool sendo curado) |
| % de bullets da Wiki com ref `context_source` | JOIN em `ProjectWikiSectionSource` | ≥50% — a Wiki está bebendo do pool, não só de meetings |
| Sources nunca lidos por agente (após telemetria #11) | Log de `read_context_source` | <30% — pool sem peso morto |
| Refresh failures no cron | `failures[]` do `/api/cron/wiki-daily` (logs Cloud Run) | ~0 por tick; recorrência = conexão Composio caída |
| Duplicatas por `(kind, externalId, projectId)` | `SELECT ... GROUP BY 1,2,3 HAVING count(*)>1` | 0 após P0-2 |

## 7. Referências

- Runbook do pipeline Drive→Contexto→Wiki: [docs/runbooks/drive-context-wiki-pipeline-runbook.md](../runbooks/drive-context-wiki-pipeline-runbook.md)
- PRD da Wiki (consumidor principal do pool): [docs/prd/in-progress/prd-project-wiki.md](../prd/in-progress/prd-project-wiki.md)
- Adapters: `src/lib/context-sources/adapters/` · Refresh helper: `src/lib/context-sources/refresh.ts`
- Tool dos agentes: `src/lib/agent/tools/read-context-source.ts`
- Memories relacionadas: `project_vitor_context_pool`, `project_entitylink_unification`, `project_drive_integration`, `project_notion_integration`, `project_db_architecture_audit`
