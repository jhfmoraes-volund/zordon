# Structured Context Sources — querying agêntico durável

**Status:** Fases 1–3 + 3.0 + 3.1 **done** · eval real fechou 100% (1 lote · 31/31) · **Owner:** João · **Criado:** 2026-06-18 · **Atualizado:** 2026-06-19
**Uma frase:** insumos estruturados (JSON/CSV/planilha) deixam de ser despejados crus no prompt e passam a ser **consultados** pela Vitoria via SQL (DuckDB in-process) sobre uma materialização efêmera **no disco do daemon** — bounded por construção, dirigido pela inteligência do agente, não por parser rígido.

> Runbook (não-Ralph). Capability de plataforma com rationale de design — vive aqui, não em `docs/prd/`. Quando virar execução, as fases viram checklist abaixo.

> **Rev. 2 (vs. rev. 1):** materialização **lazy** (não em prepare-turn); `read_context_source` **roteia** (stub vs. blob); capability **global** (Vitor/Alpha/Vitoria); migração `release_planning → daemon` **re-escopada** (7 board tools); DuckDB binding = **gate bloqueante**.
>
> **Rev. 3 (durante a implementação da Fase 1):** descoberta-chave — o daemon **não executa tools**, só proxia pro tool router do app (`/api/agents/tools/*`). Logo **DuckDB + materialização rodam no processo do APP** (Next.js), não no daemon (§4). Em v1 é local de qualquer jeito; o daemon segue **sem dep nativa** (schema-stubs). Gate (Fase 0) e Fase 1 **feitos** (§12).
>
> **Rev. 4 (eval real rodou):** um harness (`eval-backfill.ts`) roda o agente REAL via SDK no caso HITz (31 features) e provou as Fases 1–2 end-to-end, mas caçou 4 bugs (todos corrigidos — §10.3) e um **problema de FORMA**: backfill é lote, `propose_task_action` é conversacional 1-a-1.
>
> **Rev. 5 (calibragem anti-over-constraint):** a lição do lote não é "tool de backfill" — é "o write precisa falar lote". D12 generalizado para **`propose_tasks` (array genérico)**, backfill vira um caller. Entra **D14** (régua: restringe por segurança/forma/procedência, NUNCA por estratégia; **prompt magro, estado via tool**). Lastro passa a ser **por-fonte** (a ContextSource é a procedência), não nota fabricada por item.
>
> **Rev. 6 (Fase 3 fechada — 2026-06-19):** `propose_tasks` genérico construído nos 2 repos (impl no app + schema-stub no daemon + toolsets planning E release_planning); prompt do release planning **aliviado** (squad/PRD-universe/all-sprints saíram → SENSE via `list_prds`/`list_project_members`/`list_project_sprints`+`includePast`). Eval real **fechou 100%**: 1 chamada de lote (não 31), 31/31 `done`, membro certo por contribuidor, 3 sprints pela data, 0 Sprint 4. **Achados novos:** (a) a validação de assignee era "está no squad do projeto" — over-narrow ("e se"); relaxada pra **"Member existe"** (piso anti-FK, doctrine-clean), porque membership vive fora de `ProjectSquad`; (b) o squad do HITz (Squad Dex) **não estava linkado** via `ProjectSquad` → `list_project_members` voltava vazio → data fix (linkado). Caso promovido pra `src/eval/vitoria/cases/case-11-backfill-batch.ts`.

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
| **`cwd` fixo = `repoRoot`** (estável pro resume) | `exec-chat-turn.ts` (`cwd: repoRoot`) | Claude não escolhe onde ler — e nem precisa: a materialização não roda no daemon (ver linha abaixo). |
| **Execução de tool MCP é PROXIADA pro app** | `mcp-server.ts` → `POST /api/agents/tools/[toolName]` → `TOOL_REGISTRY` do app | **Descoberta da implementação (rev. 3):** o daemon NÃO executa tools — extrai só o schema das factories e proxia a chamada por HTTP pro tool router do app. O `execute` (e portanto **DuckDB + materialização) roda no processo do app (Next.js)**, não no daemon. Em v1 (app+daemon no mesmo Mac) é local de qualquer jeito; o daemon segue sem dep nativa. |
| **prepare-turn é rota do APP, devolve JSON por HTTP** | `src/app/api/agents/[slug]/prepare-turn` | Materializar em prepare-turn seria errado (estado por-turn, não por-look). A materialização correta é **lazy, dentro do `execute` da tool** (que roda no app) — ver D9. |

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
| **D9** | **Materialização LAZY, no `execute` da tool (processo do app)** | A 1ª chamada de `describe`/`query` puxa `fullText` do DB e grava um arquivo efêmero em `os.tmpdir()/zordon-structured/<sourceId>.{json,csv}` (idempotente por sourceId). Nada é escrito até a Vitoria *olhar* → alinhado com "sem contexto inicial pesado". Roda no app (tool router), não no daemon (§4, rev.3). |
| **D10** | **`read_context_source` ROTEIA fontes estruturadas** | Fonte estruturada → devolve **stub** (`structured: true`, ~N linhas, shape resumido, "use `query_structured_source`"), **nunca o blob truncado**. Sem isso o 1º instinto do agente (ler a fonte) volta 50k de JSON cortado no meio e queima o turno. |
| **D11** | **Capability GLOBAL desde a Fase 1** (Vitor/Alpha/Vitoria) | Dump grande machuca todo agente (spec anexada no Vitor, export de métricas no Alpha, activity dump no PM Review), não só release planning. As tools são de registry global; expor é só adicionar o nome ao toolset. |
| **D12** | **Lote é GERAL: `propose_tasks(array)`** — não uma tool por workflow | O eval (§10) provou que empurrar N features pelo funil 1-a-1 é impedância (lento, timeout, lastro fumbado). Mas a lição NÃO é "tool de backfill": é "o write precisa falar lote". Tool genérica `propose_tasks([...])` serve backfill, kickoff, import de planilha — qualquer N tasks de uma vez. **Backfill é UM caller** (passa `status='done'`). Não encodar o workflow no nome — mapear/estimar/sequenciar fica no agente (julgamento no SQL); a tool só faz o lote + valida. Spec §10.5. |
| **D13** | **`projectId` é closure, nunca arg do modelo** (tools de staging) | O eval pegou `propose_task_action` expondo `projectId` como input → o modelo adivinhava o projeto (FK violation / projeto errado). É o único outlier; irmãs (`propose_story`…) usam o closure. Identificador que o sistema resolve autoritativamente do escopo NÃO vai no schema. **Fix aplicado** (§10.3). |
| **D14** | **Restringe por segurança/forma/procedência — NUNCA por estratégia** + **prompt magro, estado via tool** | Régua anti-over-constraint (pós-análise rev.5). **Amarrar:** segurança (sem path traversal), orçamento (caps de linha/char), validação (FP 1-13), lastro (procedência). **Deixar pro agente:** COMO mapear/agregar/sequenciar/estimar. E o prompt é só identidade + como-agir + ponteiros; estado vivo (squad/sprints/PRDs) o agente **puxa via tool**, não pré-carregado — alinha com "pouco contexto inicial" e com *schema strictness > prompt strictness* em modelos 4.x. Toda restrição rastreia a um achado de eval, não a um "e se". |

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
                         │ describe → query → refine (chamada MCP)
        ┌────────────────▼─────────────────┐
        │  mcp-server (daemon)               │  ← só schema; PROXIA a execução
        │   • describe_structured_source     │     por HTTP pro tool router do app
        │   • query_structured_source(sql)   │
        └────────────────┬───────────────────┘
                         │ POST /api/agents/tools/[toolName]
        ┌────────────────▼─────────────────┐
        │  tool router (APP / Next.js)       │  ← onde o execute roda de verdade
        │  structured-source.ts → engine     │
        │   1ª chamada: fetch fullText do DB │
        │   → grava arquivo efêmero          │
        └────────────────┬───────────────────┘
                         │
        ┌────────────────▼─────────────────┐
        │  os.tmpdir()/zordon-structured/    │
        │    <sourceId>.{json,csv} (efêmero) │
        │  DuckDB :memory: (singleton)       │
        │  read_json_auto / read_csv_auto    │
        │  read-only · memory_limit · timeout│
        └─────────────────────────────────────┘
```

**Componentes (cada caixa = função/arquivo real ou a criar):**

- **Detecção de "estruturado"** — `structured-detect.ts` (puro, sem DuckDB; sniff: `JSON.parse` ok / kind `spreadsheet_csv`). Não toca o enum (D4). Usado por `read_context_source` pra rotear (D10) e pelas tools.
- **Engine** — `structured-query.ts` (app): materializa lazy (`os.tmpdir()/zordon-structured/<sourceId>.{json,csv}`), `describeStructured` (DESCRIBE + COUNT) e `queryStructured` (SQL read-only, `src` como tabela, caps + self-correct). Sem dep de DB/`ai` → testável isolado.
- **Tools** — `structured-source.ts` (app): camada fina que resolve o ContextSource no DB e delega pro engine. `createDescribeStructuredSourceTool` / `createQueryStructuredSourceTool`.
- **`read_context_source` roteia** (D10) — fonte estruturada > 50k chars → stub (`structured: true`, format, totalLength, "use describe/query_structured_source") em vez do blob truncado. Em `context-source.ts` (path do daemon). `read-context-source.ts` (OpenRouter, 200k cap) fica como rede de segurança.
- **Registro** — daemon `tools-registry.ts`: schema-stubs (sem `execute`, sem DuckDB) + nos toolsets de Vitor/Alpha/Vitoria (D11). App `tools-registry.ts`: factories reais (com `execute`/DuckDB) + toolsets. Falta (Fase 2): branch de surface `release_planning` em `getToolNamesForAgent` (hoje só trata `planning`).

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

## 10. Eval — harness real, achados e a decisão de lote (rev. 4)

### 10.1 O harness (roda o agente REAL, não simula)
`zordon-daemon/scripts/daemon/eval-backfill.ts` — cria um `ChatTurn` fresh (thread `release_planning`) e chama `exec-chat-turn.ts <id>` **direto** (sem o loop do daemon). É o caminho de prod: `query()` do Claude Agent SDK + MCP server + tool router do app. A telemetria de avaliação **já existe de graça**: `ChatTurnEvent` grava todo `tool_use`/`tool_result`/custo; o output é o staging (`MeetingTaskAction`). Comandos: `run | score <turnId> | setup`.

**Caso** (HITz Global, sessão `d9190b3a`): 3 JSONs linkados, **31 features** (17 Brenda + 14 Guilherme), 3 sprints reais (05-25→06-14). Decisões do caso (gabarito): **fiel a 3 sprints** (a atividade vai só até 06-11 — não inventar Sprint 4); **1 task por feature**, na sprint da data de entrega (último commit); **membro por contribuidor** (`brenda_bezerra`→Brenda Bezerra; `guilherme_siqueira`→Guilherme Siqueira — não o Perdigão). Scorecard: ancoragem (describe/query, não blob) · cobertura · todas `done` · FP 1-13 · assignee correto · sprint válida · **não inventou Sprint 4**.

### 10.2 O que o eval PROVOU
- Structured tools no stack real: `describe_structured_source` + 5× `query_structured_source` sobre os JSONs de verdade (incl. o de **3MB**), sem estourar contexto. **Fases 1+2 validadas end-to-end** (daemon→app→DuckDB).
- O agente **ancora certo** (`describe → query`, nunca o blob), resolve membros via `list_project_members`, e **respeita o grounding** (não criou Sprint 4).

### 10.3 Bugs que o eval CAÇOU (e fixes)
| Achado | Causa-raiz | Fix |
|---|---|---|
| Toda tool 500 com HTML (`Unexpected token '<'`) | `@duckdb/node-api` (binding nativo) quebrava o bundle do route inteiro | externalizado em `next.config.ts` (`serverExternalPackages`, junto do `pdf-parse`) — **exige restart do dev server** |
| Backfill sem sprint pra atribuir | `list_project_sprints` só lista futuras (`endDate ≥ hoje`); backfill cai em sprints **passadas** | `loadReleasePlanningContext` injeta TODAS as sprints (com IDs) no prompt |
| Agente trava pedindo confirmação (`AskUserQuestion`) | daemon é headless — não há humano no loop | `AskUserQuestion` + `ExitPlanMode` em `disallowedTools` (exec-chat-turn) |
| `propose_task_action` FK / projeto errado / `undefined` | `projectId` era arg do MODELO (único outlier) → o modelo adivinhava | tirar `projectId` do schema, usar o do closure (D13) |

### 10.4 O achado de FORMA → decisão de lote (D12)
Os sintomas que sobraram (lentidão, `sourceNoteIds` recebendo `"PMAR"` em vez de uuid, timeout aos ~5/31) são **um problema de impedância**, não bugs soltos: **backfill é lote derivado de fonte estruturada**, mas `propose_task_action` é proposta **conversacional, uma por vez**, com cerimônia por item (1 `add_context_note` de lastro + dedup via `get_task_detail` + validação SDD). 31 features por esse funil = 31 round-trips + erro em cadeia. A pista está no §6: a query já produz N linhas decision-ready; falta o **write** falar a mesma língua de lote.

### 10.5 Spec — `propose_tasks` (lote GENÉRICO; espinha da Fase 3)
Tool de lote, complemento das structured tools (*query → materializa em lote*). **Genérica** — backfill, kickoff, import de planilha; não nomeada por workflow (D12). Staging/aprovação do PM **intactos** — só o write vira lote.

- **input:** `{ sourceId? (ContextSource = lastro quando vem de fonte estruturada), reasoning, tasks: [{ title, functionPoints (1-13), assigneeIds (Member.id[]), targetSprintId?, status? ('done' no backfill), dueDate? (YYYY-MM-DD), scope?, userStoryId? }] }`
- **execute** (1 transação, no app, `projectId` + `planningCeremonyId` do **closure** — D13):
  1. **Lastro por-fonte (D14):** se `sourceId`, auto-cria **UMA** `PlanningContextNote` (`"Lote de <source.title> — N tasks"`) → id vira `sourceNoteIds` de todas. A **fonte** é a procedência; sem nota fabricada por item (mata o `"PMAR"`). Sem `sourceId` (kickoff de DS/transcript), aceita `sourceNoteIds` explícito.
  2. bulk-insert N `MeetingTaskAction` (type=create; `payload` com `status`/`dueDate`/FP/`assigneeIds`; `targetSprintId`; `projectId`/`planningCeremonyId` do closure).
  3. valida cada linha server-side (FP 1-13, assignee resolvível, sprint válida) → `{ created, errors: [{index, msg}] }` pro agente corrigir **só** as que falharem.
- **fluxo do agente:** `describe → query` (a query monta as N linhas com `CASE` de sprint pela data + FP por commit_count — **julgamento no SQL**, não no nosso código) → `list_project_members` → **1× `propose_tasks`**. Mata o timeout sem subir teto artificial.
- **registro:** factory real no app `tools-registry` + schema-stub no daemon + nos toolsets de **planning E release_planning** (genérica, serve os dois). `propose_task_action` segue pro caso conversacional 1-2 tasks.
- **invariante:** PM ainda aprova item a item (lote só no write).

### 10.6 Promoção pra eval suite — FEITO (2026-06-19)
Scorecard fechou (1 chamada de lote · 31/31 `done` · membro certo · 3 sprints pela data · sem Sprint 4) → caso promovido pra `src/eval/vitoria/cases/case-11-backfill-batch.ts` (fixture = subset do `atividade-*` como CSV; guard central: ancora em structured tools + escreve em LOTE, `propose_task_action` **forbidden**). É declarativo (a suite ainda é dry-run; `--live` não plugado) — a prova end-to-end VIVA segue no `eval-backfill.ts`. Ver [agent-audits/README](agent-audits/README.md).

## 11. Mitigação já em produção (não é a solução)

`src/lib/agent/tools/read-context-source.ts` (app) ganhou cap de **200k chars** com marcador de truncamento (`MAX_FULLTEXT_CHARS`). Isso **para o crash**, mas não resolve a utilidade — a Vitoria via OpenRouter ainda só veria 200k de um JSON cortado no meio. O daemon já capa em 50k. O cap vira **rede de segurança** quando o querying estruturado existir (e o roteamento D10 substitui o blob truncado por um stub útil).

**Para destravar a sessão `d9190b3a` hoje:** deslinkar os dois `*-features.json` (3MB/514k) e deixar só `atividade-resumo.json` (o índice já é o rollout decision-ready). Comando manual ou via UI de contexto.

## 12. Fases

| Fase | Entrega | Verificável |
|---|---|---|
| **0 (gate)** ✅ | Validar `@duckdb/node-api` instala/roda (R1) | **FEITO 2026-06-18:** `npm i @duckdb/node-api@1.5.4` limpo no Mac (ARM, 7s, 0 vulns); `SELECT 42` + `read_json_auto` sobre 3MB → ~60MB RAM (cappável). Instalado **só no app** (daemon segue sem dep nativa). |
| **1** ✅ | DuckDB no app + `describe`/`query_structured_source` + detecção + roteamento D10 + tools no **registry global** (Vitor/Alpha/Vitoria) | **FEITO 2026-06-18:** `scripts/structured-source-smoke.ts` → 17/17 asserts (describe/agregação exata/row-cap 200/self-correct/read-only guard/D10). tsc limpo nos 2 repos. Arquivos: app `tools/{structured-detect,structured-query,structured-source}.ts` + D10 em `tools/context-source.ts` + registro nos 2 `tools-registry.ts`. **Falta:** provar end-to-end num chat real (depende da Fase 2 ou de plugar manualmente). |
| **2** ✅ | Migração `release_planning` → daemon: route proxia, prepare-turn serve contexto, **board tools portadas**, branch `release_planning` em `getToolNamesForAgent` | **FEITO 2026-06-18** (tsc+eslint limpos nos 2 repos; toolset daemon = 26 tools, board+staging+structured+read_prd, zero faltando no registry): route `planning-sessions/[id]/chat` ganhou branch AgentMode + proxy daemon + fallback OpenRouter; tool router resolve ctx `release_planning` (releasePlanningId + companion ceremony→planningId); 6 board tools extraídas (`buildReleasePlanningBoardTools`) e registradas nos 2 registries (real no app, stub no daemon); `read_prd`/`read_context_source` reusam entradas genéricas. **Falta:** smoke end-to-end num chat real (daemon ligado) na sessão `d9190b3a`. |
| **2.5** ✅ | Eval real + fixes que ele caçou (§10.3) | **FEITO 2026-06-18:** `eval-backfill.ts` roda o agente via SDK; provou structured tools no 3MB real; 4 bugs corrigidos (next.config duckdb-external, all-sprints no prompt, AskUserQuestion disallow, projectId→closure D13). tsc limpo nos 2 repos. |
| **3** ✅ | **`propose_tasks` genérico** (D12/§10.5) + lastro por-fonte (D14) + guidance + re-rodar eval | **FEITO 2026-06-19:** impl no app (`vitoria/tools.ts`) + schema-stub no daemon + nos toolsets planning E release_planning (via `VITORIA_PLANNING_CEREMONY_NAMES`). Scorecard **fechou 100%**: 1 chamada de lote (não 31) · 31/31 `done` · membro certo por contribuidor · 3 sprints pela data · **0 Sprint 4**. Validação de assignee = **"Member existe"** (não "no squad" — over-narrow). tsc limpo nos 2 repos. |
| **3.0** ✅ | **Aliviar o prompt do release planning** (D14): tirar squad/PRD-universe/all-sprints do prompt fixo → o agente puxa via tool | **FEITO 2026-06-19:** loader + prompt do `release-planning.ts` enxugados (só identidade + como-agir + ponteiros + board atual + índice de insumos); `list_prds` adicionado ao toolset (registry) e ao `buildReleasePlanningTools` (path OpenRouter); `list_project_sprints` ganhou `includePast` (backfill cai em sprints passadas). Eval manteve o scorecard com estado vindo de tool. |
| **3.1** ✅ | Promover o caso pra `src/eval/vitoria/cases/` (regressão) | **FEITO 2026-06-19:** `case-11-backfill-batch.ts` (subset da atividade em CSV) + registrado no `cases/index.ts`; dry-run valida `[RUN] backfill-batch pass`. Guard: ancora em structured tools + LOTE, `propose_task_action` forbidden. |
| **4** | (opcional) persistir shape outline em `payload` (1º turno não precisa materializar pra ver o shape) | índice já traz shape sem materializar |

## 13. Riscos

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| **DuckDB-node não instala/compila no Mac (native binding)** | média | **bloqueante** | **Gate da Fase 0**, não risco em aberto. Daemon hoje tem ZERO deps nativas e é per-machine (todo Mac de teammate compila). Sem Bash, não há CLI fallback. **Plano B:** materialização + navegação em JS puro (`JSON.parse` + paths) cobre navegacional; **agregação SQL fica adiada** (documentar a perda). |
| Vitoria gera SQL ruim em loop | média | médio | result budget + self-correcting + maxSteps; eval case trava regressão |
| JSON malformado / não-tabular | baixa | médio | `read_json_auto` falha graciosamente → cair no stub D10 (rede de segurança §11) |
| Materialização vaza disco | baixa | baixo | dir efêmero por sessão sob cwd do daemon, cleanup no fim / TTL; cap de tamanho |
| Migração release_planning quebra board (tools faltando) | média | alto | portar as 7 board tools ANTES de virar o route pro daemon; branch de surface correto; manter fallback OpenRouter até provado |
| Backfill grande não cabe num turno (timeout / erro em cadeia) | **observado** (5/31 antes do kill) | alto | **D12 `propose_backfill_tasks`** colapsa 31 round-trips em 1; `propose_task_action` 1-a-1 só pro caso conversacional |
| Agente cria task no projeto errado | **observado** (FK no eval) | alto | **D13** — `projectId` do closure, fora do schema; aplicado |
| `@duckdb/node-api` quebra o bundle do Next | **observado** (HTML 500 em toda tool) | alto | `serverExternalPackages` no `next.config.ts`; **restart do dev server** após mudar config |

## 14. Referências

- **Doutrina de construção (o porquê acima deste runbook):** `docs/platform/agent-construction-doctrine.md` — D12/D13/D14 viraram princípio lá.
- **Eval harness (roda o agente real via SDK):** `zordon-daemon/scripts/daemon/eval-backfill.ts`
- **Structured tools (app):** `src/lib/agent/tools/{structured-detect,structured-query,structured-source}.ts`
- **Smoke isolado da engine (17 asserts):** `scripts/structured-source-smoke.ts`
- **DuckDB externalizado:** `next.config.ts` (`serverExternalPackages`)
- **Staging tool + fix D13:** `src/lib/agent/agents/vitoria/tools.ts` (`propose_task_action`; `propose_story` = padrão correto de closure)
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
