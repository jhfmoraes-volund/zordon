# Vitor — Normalização e Token-Efficiency

**Status:** Planning (2026-05-12)
**Branch alvo:** `joao-dev`
**Pré-requisito:** Fases 0–2.6 da DS normalization concluídas (`bee5642` + `6a4ba28`).
**Princípio:** as 4 tools genéricas (`get_step_data`/`set_field`/`add_item`/`update_item`/`delete_item`) leem/escrevem **o JSON inteiro** de um step. Conforme um step cresce (brainstorm chega a 171KB hoje), cada chamada de tool injeta o blob inteiro no contexto do modelo. **Isso desperdiça tokens sem proporção com a operação real.**

A migração pra tabelas relacionais existe pra resolver isso na escrita. Falta colher o ganho na **leitura** (contexto + tools) e na **escrita** (granularidade real, sem read-modify-write).

---

## 1. Diagnóstico — onde os tokens vazam hoje

### 1.1 `get_step_data(stepKey)` retorna o JSON inteiro

[src/lib/agent/tools.ts:72-82](src/lib/agent/tools.ts#L72) lê via `getStepData(sessionId, stepKey)` ([context.ts:20-31](src/lib/agent/context.ts#L20)) — que ainda hoje busca em `DesignSessionStepData.data`. Mesmo que a tabela esteja sendo populada **só pelo próprio Vitor** (via as 4 tools), o que está lá é o snapshot completo do step. A versão "via tabelas normalizadas" não existe — o Vitor lê um JSON que ele mesmo escreveu, em paralelo com a UI que escreve nas tabelas.

**Sintoma duplo:**
- **Divergência:** UI atualiza `DesignSessionBrainstormFeature`, Vitor lê `step_data.brainstorm.features`. Quando o usuário cria 30 features no board e pergunta "resume o brainstorm" pro Vitor, ele lê a versão **stale** do JSON (que pode ter 0 entries).
- **Custo:** ainda que estivesse fresh, retornar o JSON inteiro de `brainstorm` (171KB Zelar) num turno custa ~40k tokens só na resposta da tool.

### 1.2 Prompt ensina a chamar `get_step_data` como hábito

[prompt.ts:418,554,1011,1074,1105,916](src/lib/agent/prompt.ts) instrui Vitor a ler step inteiro pra:
- "obter nomes exatos das personas e suas dores"
- "pegar bs#ids que vão em UserStory.notes"
- "confirmar bucket de cada card"
- "detectar ambiguidades"

Cada uma dessas é uma query estreita (1 campo, 1 filtro). Mas a tool atual só tem "puxa tudo".

### 1.3 `buildSessionContext` já renderiza tudo no system prompt

[task-generator.ts:73-278](src/lib/task-generator.ts#L73) já é a versão "render once, com verbosity" — `discovery`/`refinement`/`execution`/`compact-vision`/`full`. **Isso funciona** — é o ganho da Fase 2.4.

Mas quando o Vitor precisa de algo que **não está no render** (ex: `painPointRef` exato de uma feature, `targetStoryId` de uma persona), ele chama `get_step_data` e duplica o JSON inteiro no histórico de mensagens. O system prompt renderiza compact e a tool result desfaz o trabalho.

### 1.4 `set_field`/`add_item`/`update_item`/`delete_item` fazem read-modify-write

[tools.ts:96-178](src/lib/agent/tools.ts#L96) — `set_field` chama `updateStepData` que faz read JSON → spread → write JSON inteiro de volta. Cada edit re-serializa o step completo. As RPCs `step_array_*` em [supabase/migrations/20260506_step_data_atomic_array_ops.sql](supabase/migrations/20260506_step_data_atomic_array_ops.sql) só protegem contra **race condition**, não contra tamanho.

### 1.5 `currentStepData` injetado no `buildPrompt`

[vitor/index.ts:82,185](src/lib/agent/agents/vitor/index.ts#L82) — `getStepDataForPrompt(sessionId, currentStepKey)` injeta o JSON do step atual no system prompt **a cada turno**. Para `brainstorm` no Zelar, é ~40k tokens de duplicação com `sessionContext` (que já renderiza brainstorm via `buildSessionContext`).

### 1.6 `mvp-check.ts` e `search-doc.ts` leem step inteiro

- [mvp-check.ts:52,66](src/lib/agent/tools/mvp-check.ts#L52) — lê `brainstorm` completo só pra achar 1 feature por id; lê `personas_journeys` completo só pra checar `asIsSteps[i].id === painRef`.
- [search-doc.ts:121](src/lib/agent/tools/search-doc.ts#L121) — lê `pre_work` completo só pra pegar `files[].extractedText`. Mas pre_work agora tem [DesignSessionFile](src/lib/design-session/file-extraction.ts) com endpoints próprios `/files/[fileId]/text`. O JSON tá obsoleto.

---

## 2. Princípios da migração

1. **Read fino, não read total.** Toda tool de leitura aceita filtros (`fields`, `ids`, `bucket`, `archived`) e retorna **só o que pediu**. Nenhuma tool genérica devolve "o step inteiro" — esse modo morre.
2. **Tools tipadas por entidade, não por step.** O modelo entende `upsert_persona({ name, role, ... })` melhor que `update_item({ stepKey: "personas_journeys", arrayKey: "personas", item: { ... } })`. Schema Zod específico = menos erro de shape, menos retry, menos token.
3. **Tabela é fonte da verdade pro Vitor também.** `getStepData`/`updateStepData`/`getStepDataForPrompt` morrem. Tudo lê das 9 tabelas + 3 colunas briefing.
4. **`currentStepData` no prompt tem que ser tight.** Renderiza só o que muda *no step atual* e que **já não está em `sessionContext`**. Idealmente: para 8 dos 9 steps, é vazio (`sessionContext` cobre tudo). Para briefing, é `{ subPhase, targetStoryId }` (cabe em 1 linha).
5. **Atomic write por entity-id.** Update de 1 persona = UPDATE 1 row. Não há read-modify-write. Aumenta concorrência (UI + Vitor não brigam mais).

---

## 3. Inventário de tools — 4 genéricas → 16 específicas

### 3.1 Read tools (substituem `get_step_data`)

> Cada uma toma filtros estreitos e retorna lista projetada. Default é "ids + título" pra navegação barata.

| Tool | Substitui | Input | Default output |
|---|---|---|---|
| `read_product_vision` | get_step_data("product_vision") | `{ fields?: subset }` | 5 escalares (~200 tokens) |
| `read_scope` | get_step_data("scope_definition") | `{ buckets?: ("inScope"\|"outOfScope"\|"does"\|"doesNot")[] }` | só os buckets pedidos |
| `read_personas` | get_step_data("personas_journeys") | `{ ids?, includeJourneys?: false }` | name + role + context (sem journey por default) |
| `read_persona_journey` | (parte do anterior) | `{ personaId, journey: "asIs"\|"toBe" }` | só a jornada pedida da 1 persona |
| `read_brainstorm` | get_step_data("brainstorm") | `{ ids?, archived?: false, fields?, limit? }` | id + title (sem howItSolves/keyScreens/etc) |
| `read_brainstorm_card` | (idem com 1 id) | `{ id }` | feature completa (1 row) |
| `read_priority` | get_step_data("prioritization") | `{ buckets?: ("mvp"\|"next"\|"out")[], ids?, fields? }` | id + title + bucket |
| `read_risks_gaps` | get_step_data("risks_gaps") | `{ kind?: "risk"\|"gap", category?, severity? }` | só os filtros aplicados |
| `read_tech_specs` | get_step_data("technical_specs") | `{ fields? }` | escalares + counts |
| `read_hypotheses` | get_step_data("hypotheses") | `{ ids?, fields? }` | hypothesis + indicator |
| `read_pre_work_files` | get_step_data("pre_work") | `{ filter?, extracted?: false }` | name + size + status (sem text) |
| `read_file_text` | (substitui `getStepData("pre_work").files[i].extractedText`) | `{ fileId, range?: { start, end } }` | trecho do extractedText |

**Princípio do default seco:** o modelo pede o que precisa. Se quiser detalhe, passa `fields` ou `id`. Mata a tendência de "puxar tudo pra ter certeza".

### 3.2 Write tools (substituem `set_field`/`add_item`/`update_item`/`delete_item`)

| Tool | Substitui | Input |
|---|---|---|
| `update_product_vision` | set_field(product_vision, ...) | `{ problem?, whoSuffers?, ... }` (partial) |
| `add_scope_item` / `update_scope_item` / `delete_scope_item` | add_item/update_item/delete_item em scope | `{ bucket, id?, text }` |
| `upsert_persona` / `delete_persona` | add_item/update_item em personas | `{ id?, name, role, context }` |
| `add_journey_step` / `update_journey_step` / `delete_journey_step` | (granular dentro da persona) | `{ personaId, kind: "asIs"\|"toBe", id?, description, painOrGain }` |
| `upsert_brainstorm_card` / `archive_brainstorm_card` / `delete_brainstorm_card` | add_item/update_item/delete_item brainstorm | `{ id?, title, howItSolves, targetPersona, painPointRef?, ... }` |
| `upsert_priority_item` / `move_priority_item` / `delete_priority_item` | add_item/update_item em prioritization | `{ id?, bucket, ... }` + um atalho `move({id, bucket})` |
| `add_risk` / `update_risk` / `delete_risk` (+ gap) | em risks_gaps | `{ kind: "risk"\|"gap", id?, text, category, severity, ... }` |
| `update_tech_specs` | set_field em technical_specs | `{ stack?, performance?, ... }` (partial) |
| `add_tech_integration` / `delete_tech_integration` (+ rule) | add_item/delete_item em tech_specs | `{ id?, text }` |
| `upsert_hypothesis` / `delete_hypothesis` | em hypotheses | `{ id?, hypothesis, indicator, target, expectedResult, evidence? }` |

**Total:** ~25 write tools tipadas (vs 4 genéricas). Sim é mais — mas:
- Cada uma tem ~10 linhas de Zod + 5 de SQL. **Mais simples por tool**.
- Modelo escolhe sem ambiguidade (vs `arrayKey: "personas"` vs `"solutions"` vs `"hypotheses"` que ele costuma errar).
- Tool description vira contrato exato. Menos retry.

### 3.3 Tools auxiliares — atualizar fontes

- `mvp_check` ([mvp-check.ts:52,66](src/lib/agent/tools/mvp-check.ts#L52)) — usa `DesignSessionBrainstormFeature` + `DesignSessionPersona`/`DesignSessionPersonaJourneyStep` direto. Sem `getStepData`.
- `search_doc` ([search-doc.ts:121](src/lib/agent/tools/search-doc.ts#L121)) — usa `DesignSessionFile` + `extractedText`. Tem que aceitar `fileId?` opcional pra buscar em 1 arquivo só (caso usuário tenha citado o nome do doc).

### 3.4 Tool `get_step_data` morre — opcional manter como facade temporário?

**Não.** Mantendo um facade `get_step_data` que internamente faz N selects mata o ganho: o modelo continua chamando "tudo" e a tool re-serializa 40k tokens. **Remove no mesmo PR**, prompt re-escrito.

---

## 4. Mudanças no prompt — fazer o modelo aproveitar

### 4.1 Substituir todas as ~10 menções a `get_step_data` em `prompt.ts`

Cada caso vira a tool específica + lembrete de filtro:

| Antes | Depois |
|---|---|
| `get_step_data("personas_journeys") pra obter nomes` | `read_personas({}) — só name+role, leve` |
| `get_step_data("brainstorm") pra pegar bs#ids` | `read_brainstorm({ fields: ["id","title"] })` |
| `get_step_data("prioritization") pra confirmar bucket` | `read_priority({ buckets: ["mvp"] })` ou `read_priority({ ids: [bs#X] })` |
| `get_step_data("pre_work") pra o doc inteiro` | `read_pre_work_files({})` + `read_file_text({ fileId, range })` |

### 4.2 Adicionar princípio explícito no prompt

```
TOKEN HYGIENE — leia o mínimo
- Tools de leitura aceitam filtros (ids, fields, buckets). USE.
- Nunca peça "tudo" pra confirmar; peça o ID exato ou os fields exatos.
- Se já viu o dado no sessionContext (system prompt), NÃO chame read_*.
- read_brainstorm sem filtros devolve só id+title — peça fields=["howItSolves"] só quando precisar.
- Quando estiver listando opções pro usuário, projete só o que vai mostrar.
```

### 4.3 Remover `currentStepData` do system prompt

Today [vitor/index.ts:82,185](src/lib/agent/agents/vitor/index.ts#L82) injeta `currentStepData` (JSON do step atual) em todo turno. Com `sessionContext` já cobrindo via `buildSessionContext`, isso é duplicação. Os únicos campos que `sessionContext` não cobre são briefing metadata (`subPhase`, `targetStoryId`) — agora vivem em colunas da `DesignSession`, então passa direto pra `buildPrompt` como 2 strings, não como blob.

**Resultado esperado:** prompt cai 20-40% em sessões grandes (Zelar passa de ~80k → ~50k system tokens).

---

## 5. Schema — não precisa de migration nova

Tudo já existe:
- 9 tabelas normalizadas + RLS (Fase 1)
- `DesignSession.briefing*` (Fase 2.6)
- `DesignSessionFile` + `extractedText` (Fase 2.5)

**Única exceção possível:** persona journey steps hoje vivem em `DesignSessionPersona.asIsSteps`/`.toBeSteps` como jsonb (decisão consolidada em §3.4 do plan). Pra granularidade de write (`update_journey_step({ personaId, kind, stepId, ... })`), 2 opções:

**(A)** Continuar com jsonb e fazer write granular via SQL `jsonb_set` + filter pelo `id` dentro do array. Mantém a estrutura "journey lê junto com persona" (queremos isso). RPC helper único `persona_journey_upsert(p_persona_id, p_kind, p_step jsonb)` — ~15 linhas SQL.

**(B)** Extrair pra tabela `DesignSessionPersonaJourneyStep`. Granularidade total, custo: 1 migration + retro-RLS + backfill.

**Recomendação: (A)** — journey raramente é editado isoladamente. Quando for, RPC resolve. Não vale tabela nova só pro Vitor.

---

## 6. Ordem de execução

### Fase V1 — Read tools normalizadas (~3h)

1. Criar `src/lib/agent/tools/read-*.ts` (12 read tools — §3.1). Cada uma puxa direto da tabela com filtros.
2. Registrar em `assembleTools` ([tools.ts:67](src/lib/agent/tools.ts#L67)) sob um if-flag temporário (`capabilities.normalizedReadTools`) — permite A/B.
3. Atualizar `mvp_check` e `search_doc` pra usar tabelas direto.
4. **Não remover `get_step_data` ainda** — vai conviver até as writes migrarem.

### Fase V2 — Reescrever prompt (~2h)

5. Substituir as ~10 menções a `get_step_data` em [prompt.ts](src/lib/agent/prompt.ts) pelas read-* específicas. Cada uma com filtro recomendado.
6. Adicionar bloco "TOKEN HYGIENE" (§4.2).
7. Remover `currentStepData` do `buildPrompt`. Para briefing, passar `briefingSubPhase` + `briefingTargetStoryId` como 2 strings escalares.
8. Remover `getStepDataForPrompt` chamada em [vitor/index.ts:82](src/lib/agent/agents/vitor/index.ts#L82). `loadContext` perde 1 query.

### Fase V3 — Write tools normalizadas (~5h)

9. Criar `src/lib/agent/tools/write-*.ts` por entidade (~25 tools — §3.2). Reusar Zod schemas dos endpoints REST já existentes (`src/lib/design-session/schemas.ts` ou inline nos route handlers).
10. Para persona journey, criar RPC `persona_journey_upsert/delete` (migration `20260516_persona_journey_rpcs.sql`).
11. Registrar em `assembleTools` sob mesmo flag.

### Fase V4 — Cutover (~2h)

12. Trocar flag default `normalizedReadTools=true` em `webConnector` e `vitor/live.ts`.
13. Smoke test: rodar 1 conversa por sub-phase em Zelar v2 + 1 sessão fresh. Comparar token usage no log.
14. Deletar `get_step_data`, `set_field`, `add_item`, `update_item`, `delete_item` de `tools.ts`.
15. Deletar `getStepData`, `getStepDataForPrompt`, `updateStepData` de `agent/context.ts`.
16. Deletar `webConnector` stamp em `DesignSessionStepData` (já órfão depois disso — Vitor não escreve mais lá).
17. Remover `subPhase`/`firstMessageAt`/`targetStoryId` do JSON em `connectors/web.ts` — só usa colunas novas.

### Fase V5 — Fase 3 do plano original destrava (~1h)

18. **Agora sim** `DesignSessionStepData` está 100% órfã.
19. Migration `20260517_drop_design_session_step_data.sql`:
    ```sql
    DROP TABLE "DesignSessionStepData" CASCADE;
    DROP FUNCTION step_array_add, step_array_update, step_array_delete;
    DROP FUNCTION sync_brainstorm_features, sync_brainstorm_buckets, step_data_reject_dup_ids;
    ALTER TABLE "DesignSessionBrainstormFeature" DROP COLUMN bucket;  -- se confirmado vazio
    ```
20. Deletar `src/app/api/design-sessions/[id]/steps/[stepKey]/route.ts` (preservar `/notes/`).
21. `npm run db:types && tsc --noEmit && npm run build`.
22. Commit final: `ZRD-JM-XX: ds — drop legacy step_data + endpoint genérico (Fase 3)`.

---

## 7. Métricas alvo

Pra validar que o esforço deu retorno:

| Métrica | Hoje (Zelar v2) | Alvo |
|---|---|---|
| System prompt tokens (briefing) | ~80k | ~45k (-40%) |
| Tool calls médio por turno | 2-3 | 1-2 |
| Tokens em tool results | ~5k/turno | <1k/turno |
| Latência loadContext | ~600ms (8 queries paralelas) | ~500ms (-1 query: getStepDataForPrompt) |
| Read-modify-write writes | 100% | 0% (todos viram UPDATE 1 row) |

Instrumentar via logging em `webConnector` antes da migração (turno 0) e turno 1 (compare).

---

## 8. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| 25 write tools inflam o tool catalog do AI SDK | AI SDK v6 já suporta 60+ tools sem degradação. Tool descriptions curtas (1-2 linhas). |
| Modelo "esquece" qual tool usar pra qual entity | Naming consistente: `upsert_X` + `delete_X` por entity. Listar no system prompt em ordem. |
| RPC `persona_journey_upsert` falha silenciosamente em concurrent write | RPC retorna NULL em not-found, throw em conflict. Tests via psql. |
| Migration de remoção esbarra em consumer que esquecemos | Pre-flight em §V4 step 13: `rg "get_step_data\|set_field\|add_item\|update_item\|delete_item"` deve voltar zero. |
| Token gain menor que esperado (prompt cache TTL não amortiza) | Modelo Anthropic tem cache TTL 5min — Vitor turn dura ~30s, então cache hit é a regra. Validar via header `cache_read_input_tokens` no response. |

---

## 9. O que NÃO está neste plano

- Mudar o agent loop / step budget — fora de escopo.
- Mudar `runAgent` / engine — fora de escopo.
- Mudar memory tools (`record_decision`, etc.) — já são tipadas, não tocam step_data.
- Story/task tools (`create_user_story`, `create_task`, etc.) — já vivem nas tabelas próprias.
- CI steps (`retrospective`, `new_demands`, `refinement`) — quando forem implementados, herdarão o padrão V3.

---

## 10. Decisões pendentes antes de começar

1. **Persona journey: jsonb (A) ou tabela (B)?** Recomendação **(A)** com RPC helper.
2. **A/B flag durante migração:** vale a pena ou troca tudo num PR?
   - Pro flag: rollback rápido se algo quebrar.
   - Contra: dobro de código vivo por 1-2 dias.
   - Recomendação: **sem flag.** Cada Fase Vn é um commit; rollback = `git revert`.
3. **Quantos PRs?** Sugestão: 1 PR por Fase V (5 PRs encadeados). Ou 1 PR único se preferir revisar inteiro.
4. **Quando rodar Fase 3 (drop)?** Imediatamente após V4 no mesmo dia, ou esperar 1 sprint de uso real? Recomendação: **mesmo dia** — `DesignSessionStepData` órfã sem consumidor não tem por que viver.
