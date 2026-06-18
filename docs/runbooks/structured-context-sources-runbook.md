# Structured Context Sources — querying agêntico durável

**Status:** proposto (rev. 2 — alinhado às restrições do daemon) · **Owner:** João · **Criado:** 2026-06-18
**Uma frase:** insumos estruturados (JSON/CSV/planilha) deixam de ser despejados crus no prompt e passam a ser **consultados** pela Vitoria via SQL (DuckDB in-process) sobre uma materialização efêmera **no disco do daemon** — bounded por construção, dirigido pela inteligência do agente, não por parser rígido.

> Runbook (não-Ralph). Capability de plataforma com rationale de design — vive aqui, não em `docs/prd/`. Quando virar execução, as fases viram checklist abaixo.

> **Rev. 2 (o que mudou vs. rev. 1):** materialização passou a ser **lazy + daemon-side** (não em prepare-turn); `read_context_source` ganha **roteamento** (stub em vez de blob pra fonte estruturada); a capability nasce **global** (Vitor/Alpha/Vitoria), não release_planning-only; a migração `release_planning → daemon` foi **re-escopada** (porta 7 board tools, não "um branch"); DuckDB native binding virou **gate bloqueante da Fase 1**, não risco mitigável. Rationale completo no §14.

---

## 1. O incidente (o que estourou)

`POST /api/planning-sessions/d9190b3a-.../chat` → `AI_APICallError 400`:

```
This endpoint's maximum context length is 1000000 tokens.
However, you requested about 1003891 tokens (998886 of text input, 5005 of tool input).
```

Modelo: `anthropic/claude-sonnet-4.6` via OpenRouter. UI mostrou "Vitoria falhou: falha inesperada."

**Causa imediata (confirmada no banco):** a sessão tinha 3 `ContextSource` linkados:

| fonte | kind | `fullText` chars | ~tokens |
|---|---|---|---|
| `atividade-brenda-features.json` | document | **3.050.885** | ~760k |
| `atividade-guilherme-features.json` | document | 514.868 | ~130k |
| `atividade-resumo.json` | document | 11.607 | ~3k |

A tool `read_context_source` devolvia `fullText` **sem teto**. Quando a Vitoria leu o arquivo de 3MB durante o loop multi-step (`maxSteps: 40`), o blob entrou no message array e foi **reenviado a cada step** → estourou a janela.

## 2. Causa raiz (duas camadas)

1. **Dado estruturado tratado como prosa.** Os `.json` entraram como `kind='document'` (blob de texto opaco). São relatórios de atividade do repo `HitzGlobal/hitz-global` — hierarquia limpa `contribuidor → feature → commits → arquivos`, com um índice (`atividade-resumo.json`) já pronto. Despejar isso inteiro num turno de chat é um erro de categoria: **é job de dados, não de contexto de chat.**
2. **`release_planning` ficou no engine legado.** É o **único surface da Vitoria ainda no `runAgent`/OpenRouter** (`src/lib/agent/connectors/release-planning-chat.ts` → `../engine`). `planning` e `pm_review` já rodam no daemon. O daemon capa leitura em 50k chars; o engine OpenRouter não capava → por isso o crash apareceu só aqui.

## 3. Por que NÃO é RAG (decisão registrada)

RAG (embeddings + busca vetorial) brilha com **muita prosa não-estruturada** e perguntas **semânticas difusas**. Aqui o dado é **estruturado, com IDs e índice**, e as perguntas são **navegacionais/agregadas** ("features da Brenda", "commits da BR-AUTH-01", "FP por sprint"). Chunking + embedding jogaria fora a estrutura que já existe, e busca vetorial é ruim em contagem/agregação exata. Além disso o pool de ContextSource **não tem pgvector** — seria infra net-new pra um problema que um tool + SQL resolve. RAG fica reservado pro futuro de **prosa cross-source** (transcripts longos, Notion), não pra esses dumps.

## 4. O modelo do daemon é a restrição de projeto (leia antes de §6)

A capability nasce no daemon, e o daemon **não é "OpenRouter com mais tokens"** — é o **Claude Agent SDK (Claude Code)** rodando local. Três fatos que ditam o desenho:

| Fato | Onde | Implicação |
|---|---|---|
| **Filesystem nativo BLOQUEADO** | `exec-chat-turn.ts` — `disallowedTools: [Bash, Read, Grep, Glob, Write, …]`; `allowedTools` é whitelist só de `mcp__zordon__*` | Não dá pra "soltar o JSON no cwd e deixar a Vitoria usar jq/Read". Toda query vem como **tool MCP**. **Não há Bash pra cair num `duckdb` CLI** — DuckDB embutido é o único caminho. |
| **`cwd` fixo = `repoRoot`** (estável pro resume) | `exec-chat-turn.ts` (`cwd: repoRoot`) | A materialização escreve num subdir efêmero **sob o cwd do daemon**, nunca no workspace. |
| **prepare-turn é rota do APP, devolve JSON por HTTP** | `src/app/api/agents/[slug]/prepare-turn` | Ela roda na máquina do app e **não escreve no disco do daemon**. Materializar em prepare-turn é arquiteturalmente errado (só funciona em v1 por app+daemon co-locados). |

**Pilar herdado (já funciona, é o que torna isto possível):** o prompt do release planning injeta só o **índice** dos insumos linkados (`contextSourceId · kind · title`), nunca o conteúdo — o agente decide o que abrir via tool. "Pouco contexto inicial + tool-driven" já é o padrão; esta capability só estende ele pra dados estruturados (índice ganha o flag `structured + shape`; o blob continua fora do prompt).

## 5. Decisões fixadas

| # | Decisão | Por quê |
|---|---|---|
| D1 | **DuckDB in-process** como engine de materialização | SQL nativo sobre JSON/CSV (`read_json_auto`, `UNNEST`), zero servidor, embutido no daemon. Feito pra analítico/agregação — o que backfill precisa. **Único caminho** (sem Bash, sem CLI fallback) → ver D9/gate. |
| D2 | **Daemon-only** + **migrar `release_planning` pro daemon** | Capability nasce num lugar só (junto de planning/pm_review); tira `release_planning` do OpenRouter de vez (mata o path legado que estourou). **Escopo real:** portar as board tools, não só um branch (§7). |
| D3 | **Agent-driven, não parser por formato** | Divisão: **shape** (mecânico) + **estratégia/digestão** (Vitoria). Durável pra qualquer JSON, não só activity report. |
| D4 | **Sem novo `kind`; "estruturado" é capability derivada** | Qualquer kind pode ser estruturado (json em `document`, csv, gsheets…). Detecção por sniff de conteúdo, não por enum. Evita migração e é mais geral. |
| D5 | **Sem migração de schema no v1** | Shape computado on-read via DuckDB `DESCRIBE` (barato). Persistir outline em `payload`/`summary` fica como otimização futura. |
| D6 | **Materialização efêmera, read-only, por sessão** | Sem estado persistente, sem injeção, com timeout + cap de memória. |
| D7 | **Resultados orçados + self-correcting** | Toda query result tem cap de linhas/chars + paginação; erro de SQL volta com o schema pra Vitoria reescrever. |
| D8 | **Cobertura por eval case** | Bug recorrente vira case no harness — é o que impede regressão (loop de calibração). |
| **D9** | **Materialização LAZY, daemon-side** (dentro da tool, não em prepare-turn) | prepare-turn não tem acesso ao disco do daemon (§4). A 1ª chamada de `describe`/`query` puxa `fullText` do DB e grava o arquivo efêmero. Nada é escrito até a Vitoria *olhar* → mais alinhado com "sem contexto inicial pesado", e correto no v2. |
| **D10** | **`read_context_source` ROTEIA fontes estruturadas** | Fonte estruturada → devolve **stub** (`structured: true`, ~N linhas, shape resumido, "use `query_structured_source`"), **nunca o blob truncado**. Sem isso o 1º instinto do agente (ler a fonte) volta 50k de JSON cortado no meio e queima o turno. |
| **D11** | **Capability GLOBAL desde a Fase 1** (Vitor/Alpha/Vitoria) | Dump grande machuca todo agente (spec anexada no Vitor, export de métricas no Alpha, activity dump no PM Review), não só release planning. As tools são de registry global; expor é só adicionar o nome ao toolset. |

## 6. O princípio: mecânico vs julgamento

O erro a evitar é tentar fazer o agente "entender" o blob inteiro **ou** hardcodar parser por formato. Divide-se em duas camadas:

| Camada | Quem faz | Nota |
|---|---|---|
| **Shape** — esquema: colunas, tipos, paths de array + cardinalidade, samples | **Mecânico** (DuckDB `DESCRIBE` / inferência) | Nunca inlina o blob. Cabe sempre (~1-2k tokens). |
| **Estratégia + digestão** — o que consultar, como agregar, o que vira story/task/FP | **Vitoria** (agêntico) | É julgamento. Ela lê o *mapa* e dirige as queries. |

**Como a Vitoria avalia o JSON, bem feito:** lê o outline de shape → decide estratégia → roda SQL contra a materialização → ancora decisões em **agregados exatos**, não em leitura de blob truncado. Loop `describe → query → refine`, resultados orçados, self-correcting.

Backfill na prática:
```sql
-- ~31 linhas decision-ready, não 951 commits:
SELECT contributor, feature_id, name, layer,
       commit_count, lines_net, period_first, period_last
FROM features ORDER BY commit_count DESC;
```
A **contagem** é exata (SQL); o **julgamento** (feature→sprint pela data, FP 1-13, story vs task) é da Vitoria.

## 7. Arquitetura (lazy, daemon-side)

```
┌── prepare-turn (app → daemon, JSON por HTTP) ───────────────┐
│  injeta SÓ o índice: pros structured, a linha do insumo     │
│  ganha `structured: true` + shape resumido (se já em cache).│
│  NÃO transfere fullText. NÃO escreve em disco.              │
└──────────────────────────────────────────────────────────────┘
                         │  (agente vê o índice, decide olhar)
        ┌────────────────▼─────────────────┐
        │  Vitoria (daemon, surface          │
        │  'release_planning')               │
        │  toolset: board + staging +        │
        │           structured               │
        └────────────────┬───────────────────┘
                         │ describe → query → refine
        ┌────────────────▼─────────────────┐
        │  structured-source tools (MCP)     │
        │   • describe_structured_source     │  → materializa LAZY + DuckDB DESCRIBE
        │   • query_structured_source(sql)   │  → DuckDB SELECT (rows bounded + paginate)
        └────────────────┬───────────────────┘
                         │ 1ª chamada: fetch fullText do DB → grava arquivo efêmero
        ┌────────────────▼─────────────────┐
        │  <cwd-daemon>/tmp/structured/      │
        │    <sourceId>.json   (efêmero)     │
        │  DuckDB :memory: por sessão        │
        │  read_json_auto / read_csv_auto    │
        │  read-only · timeout · cleanup     │
        └─────────────────────────────────────┘
```

**Componentes (cada caixa = função/arquivo real ou a criar):**

- **Detecção de "estruturado"** — helper novo (sniff: `JSON.parse` ok / CSV / kinds `spreadsheet_*`). Não toca o enum (D4). Usado por (a) `read_context_source` pra rotear (D10) e (b) prepare-turn pra flagar a linha do índice.
- **Materialização lazy** (D9) — dentro de `describe_structured_source`: se o arquivo efêmero não existe, puxa `ContextSource.fullText` do DB e grava em `<cwd>/tmp/structured/<sourceId>.json`. Subsequentes `query` reusam o arquivo. Cleanup no fim da sessão / por TTL.
- **`describe_structured_source(sourceId)`** — materializa (lazy) + `DESCRIBE SELECT * FROM read_json_auto(path)` (+ cardinalidade de arrays via `UNNEST`). Retorna shape compacto.
- **`query_structured_source(sourceId, sql)`** — roda SQL read-only; cap de linhas (ex: 200) e chars (ex: 30k), paginação por `LIMIT/OFFSET`; on-error devolve `{ error, schema }` pra retry.
- **`read_context_source` roteia** (D10) — se a fonte é estruturada, retorna stub (`structured: true`, totalLength, shape resumido, "use describe/query_structured_source") em vez do blob. Vale nos DOIS lados (daemon `context-source.ts` cap 50k; app `read-context-source.ts` cap 200k) pra consistência.
- **Registro no daemon** — `zordon-daemon/src/lib/agent/tools-registry.ts`: as 2 tools novas entram no `TOOL_REGISTRY` global e nos toolsets de Vitor/Alpha/Vitoria (D11). Adicionar o branch de surface `release_planning` em `getToolNamesForAgent` (hoje só trata `planning`).

## 8. Migração `release_planning` → daemon (re-escopada)

Não é "espelhar planning/pm_review + um branch". As **7 board tools** do release planning existem **só** no path OpenRouter (`src/lib/agent/agents/vitoria/release-planning.ts`); o daemon `vitoria/tools.ts` tem só o staging de ceremony. Migrar = **portar essas tools pro registry do daemon**.

1. **App route:** `POST /api/planning-sessions/[id]/chat` deixa de chamar `releasePlanningChatConnector.handle` (OpenRouter) e passa a proxiar pro daemon (`sse-chat-proxy` + branch por `AgentMode`), como `planning/[id]/chat`. Mantém fallback OpenRouter se daemon offline.
2. **prepare-turn:** já resolve `surface='release_planning'` + sessionId + projectId (`resolveAgentParams`). Garantir que `loadReleasePlanningContext` (PRDs do board, universo, índice de insumos) seja servido pro prompt do daemon. **Quase pronto.**
3. **Portar board tools pro daemon** (`zordon-daemon/.../vitoria/tools.ts` + registry): `read_prd`, `list_context_sources`, `link_context_source`, `link_prd_to_sprint`, `move_prd`, `unlink_prd`, `set_sprint_count`. (O staging — `propose_task_action`/`propose_story`/`add_context_note`/`get_planning_state` — já existe no daemon.)
4. **`getToolNamesForAgent`:** adicionar branch `surface === 'release_planning'` → `[...VITORIA_RELEASE_PLANNING_TOOLS]` (board + staging + structured + read_context_source). Hoje `release_planning` cai por engano no toolset de **PM Review**.
5. **Prompt da Vitoria (release-planning.ts):** ganha as structured tools + a orientação de §9; o resto do prompt (modos kickoff/backfill/roadmap) continua.
6. **Aposentar** o caminho OpenRouter de `release-planning-chat.ts` quando o daemon estiver provado.

## 9. Guardrails ("bem feito")

1. **Índice no prompt, blob fora.** O agente vê `structured: true` + shape resumido na linha do insumo; o conteúdo só entra via tool.
2. **`read_context_source` roteia** (D10): fonte estruturada → stub com ponteiro pras structured tools, nunca o blob truncado.
3. **Shape via `DESCRIBE`** — agente nunca recebe o blob cru.
4. **Query result orçado:** 200 linhas / 30k chars (o que vier primeiro) + paginação.
5. **Materialização lazy + efêmera, read-only;** timeout de query + cap de memória do DuckDB; arquivo apagado no fim da sessão.
6. **Self-correcting query loop** (erro SQL → schema de volta).
7. **Prompt da Vitoria:** *"Insumos estruturados — NÃO leia inteiro. `describe_structured_source` pro shape, depois `query_structured_source` por SQL. Ancore o backfill em agregados (count/group by), nunca em leitura de blob. Backfill = tasks `status='done'`, `dueDate` no dia entregue, FP estimado, sprint pela data."*

## 10. Eval / calibração

Fechar o loop (ver [agent-audits/README](agent-audits/README.md)):
- Fixture: um activity JSON (subset do `atividade-*`) + backfill esperado (rollup por feature).
- Asserts: (a) a Vitoria **consulta** em vez de despejar (não há tool call de leitura de blob > cap); (b) agregados batem (commits/feature, período); (c) emite N tasks `done` com sprint correta pela data.
- Promover pra `src/eval/vitoria/cases/` quando estável.

## 11. Mitigação já em produção (não é a solução)

`src/lib/agent/tools/read-context-source.ts` (app) ganhou cap de **200k chars** com marcador de truncamento (`MAX_FULLTEXT_CHARS`). Isso **para o crash**, mas não resolve a utilidade — a Vitoria via OpenRouter ainda só veria 200k de um JSON cortado no meio. O daemon já capa em 50k. O cap vira **rede de segurança** quando o querying estruturado existir (e o roteamento D10 substitui o blob truncado por um stub útil).

**Para destravar a sessão `d9190b3a` hoje:** deslinkar os dois `*-features.json` (3MB/514k) e deixar só `atividade-resumo.json` (o índice já é o rollout decision-ready). Comando manual ou via UI de contexto.

## 12. Fases

| Fase | Entrega | Verificável |
|---|---|---|
| **0 (gate)** | Validar `@duckdb/node-api` instala/roda no Mac do João (R1) | `npm i @duckdb/node-api` limpo + `SELECT 42` retorna no daemon. **Se falhar → plano B (§13) antes de seguir.** |
| **1** | DuckDB no daemon + `describe`/`query_structured_source` + detecção de estruturado + roteamento D10 + tools no **registry global** (Vitor/Alpha/Vitoria) | tool roda SQL sobre fixture JSON, retorna rows bounded; erro de SQL self-corrige; `read_context_source` de fonte estruturada volta stub, não blob |
| **2** | Migração `release_planning` → daemon: route proxia, prepare-turn serve contexto, **7 board tools portadas**, branch `release_planning` em `getToolNamesForAgent` | `/api/planning-sessions/[id]/chat` proxia pro daemon; toolset correto (board+staging+structured, NÃO pm_review); sessão `d9190b3a` responde sem 400 |
| **3** | Prompt + backfill guidance + eval case | fixture activity JSON → backfill correto (rollup por feature, sprint pela data) |
| **4** | (opcional) persistir shape outline em `payload` (1º turno não precisa materializar pra ver o shape) | índice já traz shape sem materializar |

## 13. Riscos

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| **DuckDB-node não instala/compila no Mac (native binding)** | média | **bloqueante** | **Gate da Fase 0**, não risco em aberto. Daemon hoje tem ZERO deps nativas e é per-machine (todo Mac de teammate compila). Sem Bash, não há CLI fallback. **Plano B:** materialização + navegação em JS puro (`JSON.parse` + paths) cobre navegacional; **agregação SQL fica adiada** (documentar a perda). |
| Vitoria gera SQL ruim em loop | média | médio | result budget + self-correcting + maxSteps; eval case trava regressão |
| JSON malformado / não-tabular | baixa | médio | `read_json_auto` falha graciosamente → cair no stub D10 (rede de segurança §11) |
| Materialização vaza disco | baixa | baixo | dir efêmero por sessão sob cwd do daemon, cleanup no fim / TTL; cap de tamanho |
| Migração release_planning quebra board (tools faltando) | média | alto | portar as 7 board tools ANTES de virar o route pro daemon; branch de surface correto; manter fallback OpenRouter até provado |

## 14. Referências

- App tool (cap 200k + ponto do roteamento D10): `src/lib/agent/tools/read-context-source.ts`
- Daemon tool (cap 50k + ponto do roteamento D10): `zordon-daemon/src/lib/agent/tools/context-source.ts`
- Restrições do daemon (filesystem disallowed, cwd estável, MCP-only): `zordon-daemon/scripts/daemon/exec-chat-turn.ts`
- Connector legado: `src/lib/agent/connectors/release-planning-chat.ts` · engine: `src/lib/agent/engine.ts`
- Board tools a portar + prompt: `src/lib/agent/agents/vitoria/release-planning.ts`
- Daemon surface dispatch (falta branch release_planning): `zordon-daemon/src/lib/agent/tools-registry.ts`
- Daemon vitoria toolset (só staging hoje): `zordon-daemon/src/lib/agent/agents/vitoria/tools.ts`
- prepare-turn (já resolve surface release_planning): `src/app/api/agents/[slug]/prepare-turn/route.ts`
- Padrão de migração: `src/app/api/planning/[id]/chat`
- Schema `ContextSource`: 11 kinds, RLS on, `payload jsonb NOT NULL`, `fullText/summary text`
- Memórias: `project_structured_context_sources`, `project_context_source_pool`, `project_vitoria_daemon_surfaces`, `reference_daemon_mcp_docs`, `project_daemon_v1_v2`, `project_planning_session`
