# Calibragem do Agente Vitor — Runbook (Manutenção & Evolução)

> **Pra um agente Claude com contexto zerado retomar/evoluir a calibragem do Vitor.** Este documento é auto-contido. Diferente de [alpha-calibration-plan.md](alpha-calibration-plan.md) (começar do zero), aqui o Vitor já está calibrado em produção — o objetivo é **manter, evoluir e descobrir gaps novos**.

---

## 0. Background — o que é o Vitor

### 0.1 Stack

- Repo: monorepo Next.js 16 (Turbopack) com Supabase + AI SDK v6 (Anthropic Claude)
- Working dir: `/Users/joaomoraes/projetos-ai-dev/Perke/perke/volund`
- Branch principal: `main`. Push via `bash scripts/sync-main.sh -m "..."` (vai pra origin + staging)
- DB: Postgres (Supabase). Conectar com `source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql "$DIRECT_URL"`
- Migrations: `supabase/migrations/<YYYYMMDD>_<nome>.sql`, executar via psql

### 0.2 O que é Vitor

Agente assistente de Design Sessions. Conduz discovery estruturado por steps (pre_work → scope → personas → brainstorm → risks_gaps → prioritization → hypotheses → technical_specs → briefing). Existe em 3 tipos de sessão:

- **Inception**: descoberta de zero, 10 steps fixos
- **Continuous Improvement (CI)**: 5 steps fixos, foco em iteração
- **Super Session**: customizada — usuário escolhe quais steps usar e em que ordem (`pre_work` e `briefing` obrigatórios)

### 0.3 Arquivos-chave

```
src/lib/agent/
  agents/vitor/
    index.ts             # AgentDefinition (loadContext, buildPrompt, buildTools)
  prompt.ts              # ⚠️ prompt + 16 regras (0-15). ~900 linhas
  tools.ts               # 25+ tools registradas
  tools/
    search-doc.ts        # busca substring em pre_work.files[]
    step-drafts.ts       # drafts genéricos (draft_step_items, apply, discard, review)
    memory.ts            # decisions, OQs, research log, project memory
    create-task.ts       # criar tasks no briefing
    manage-tasks.ts      # listar/atualizar/deletar tasks
    mvp-check.ts         # gate antes de marcar feature como MVP
    web-search.ts        # search externo + auto-capture em research log
  engine.ts              # runAgent — compartilhado com Alpha
  context.ts             # ensureThread, persistUserMessage, persistAssistantMessage,
                         # buildSessionContext, getStepData, updateStepData
  connectors/web.ts      # webConnector — chama runAgent e retorna SSE response

src/app/api/design-sessions/[id]/
  chat/route.ts          # POST → webConnector.handle
  upload/route.ts        # POST de docs (PDF/HTML/MD) — extrai texto, popula pre_work.files

src/components/design-session/
  ai-chat-panel.tsx      # ✅ virtualizado + maxChars=10000
  briefing-task-chat.tsx # ✅ virtualizado + maxChars=10000

src/lib/design-session-steps.ts  # catálogo de steps + getStepsForSession
src/components/design-session/super-session-modal.tsx  # criação de Super
src/components/ui/markdown.tsx   # ✅ collapsible com prop maxChars

scripts/
  vitor-cli.ts                # CLI dev — drive Vitor via runAgent direto
  _server-only-shim.cjs       # bypass do "server-only" pra rodar via tsx
  _server-only-noop.cjs
  zelar-blob.ts               # one-shot: monta blob do Zelar pra pre_work
  zelar-persist-prework.ts    # one-shot: persiste docs no pre_work.files[]
  zelar-truncate-message.ts   # one-shot: trunca ChatMessage gigante (caso histórico)
  zelar-migrate-drafts.ts     # one-shot: parse markdown → _drafts[]
  zelar-dedup-drafts.ts       # one-shot: dedup _drafts vs solutions

docs/
  super-session-plan.md       # plano original do feature Super Session
  alpha-calibration-plan.md   # runbook gêmeo pro Alpha (referência de estrutura)
```

---

## 1. Estado calibrado (snapshot detalhado)

### 1.1 Regras de comportamento ativas no prompt

Em [src/lib/agent/prompt.ts](../src/lib/agent/prompt.ts), `buildBehaviorRules()`:

| # | Regra | Caso que motivou |
|---|---|---|
| **0** | Contrato de escrita: propor antes, aplicar depois. Cobre QUALQUER tool de escrita (categoria, não lista). Instrução direta do usuário NÃO substitui proposta. Sequências multi-tool exigem plano completo antes da 1ª chamada | Vitor disparava 6 tool calls em silêncio quando user dizia "marca X como under_review" |
| 1 | Lê estruturado antes de propor (decisões ativas, OQs > 7 dias) | — |
| 2 | Cita confidence + ref em sugestões substanciais | — |
| 3 | Surface contradição estruturalmente — sempre via `revise_decision(under_review)` | — |
| 4 | Cross-session pollination ativa | — |
| 6 | Briefing tasks com refs cruzadas (research#XXX, decision#XXX) | — |
| 7 | Triggers de write são SINAIS sujeitos a Regra 0, não licenças pra disparar | Colidia com Regra 0 |
| 8 | Open questions revisitadas a cada ~5 turnos | — |
| 9 | Não duplica step data | — |
| 10 | Auto-compact ao fim da session | — |
| 11 | Profundidade antes de volume | — |
| **12** | Decisões de exclusão merecem second-look ("X NÃO é Y" pode esconder buraco) | Decision sobre Admin/persona escondia o backoffice em scope |
| **13** | Citação literal antes de afirmar valor específico (faixas/limites/percentuais) — DEVE chamar `search_doc` | Vitor afirmou "M_horário termina às 22h" — estava errado, leu tabela mal |
| **14** | `search_doc`/`get_step_data` antes de responder pergunta sobre regra do doc | — |
| **15** | Output ESTRUTURADO volumoso → use tools de draft. **Conversa/perguntas/análise continuam em texto livre** | Vitor produziu 60k chars de markdown em um turno → travou navegador |

**Importante:** a numeração das regras NÃO está em ordem sequencial no código (saiu como 0, 1, 2, 3, 7, 12, 4, 6, 8, 9, 10, 11, 13, 14, 15). Refactor de ordenação é trivial mas não foi feito ainda.

### 1.2 Tools registradas

Em [src/lib/agent/tools.ts](../src/lib/agent/tools.ts), via `assembleTools(sessionId, capabilities)`:

**Leitura (sempre disponíveis):**
- `get_step_data`, `search_doc`, `review_step_draft`
- `list_decisions`, `list_open_questions`, `list_research`
- `read_session_memory`, `read_project_memory`
- `read_business_context`
- `list_project_sessions`
- `mvp_check`

**Escrita de step data:**
- `set_field`, `add_item`, `update_item`, `delete_item`

**Escrita de drafts (genérico, qualquer step):**
- `draft_step_items({ stepKey, arrayKey, items })` — persiste em `_drafts[arrayKey]`
- `apply_step_drafts({ stepKey, arrayKey, ids? })` — move pra array final
- `discard_step_drafts({ stepKey, arrayKey, ids? })`

**Escrita de memória estruturada:**
- `record_decision`, `revise_decision`
- `add_open_question`, `resolve_open_question`
- `set_business_context`, `compact_session_to_project`
- `update_session_memory`, `update_project_memory`

**Tasks (gated em `briefing` step):**
- `create_task`, `update_task`, `delete_task`
- `list_tasks`, `list_project_tasks`

**Web search (auto-capture em research log):**
- `web_search`

### 1.3 Capabilities ativas

[src/lib/agent/connectors/web.ts:18](../src/lib/agent/connectors/web.ts#L18):

```ts
const WEB_CAPABILITIES = {
  maxSteps: 60,         // calibrado de 30 → 60 (replanejamentos)
  writeTools: true,
  readTools: true,
  webSearch: true,
};
```

`createTasks: true` é injetado dinamicamente quando `currentStepKey === "briefing"`.

### 1.4 UI compactada e virtualizada

| Componente | Estado |
|---|---|
| [src/components/ui/markdown.tsx](../src/components/ui/markdown.tsx) | ✅ `maxChars` opcional (collapse com "ver completo") |
| [ai-chat-panel.tsx](../src/components/design-session/ai-chat-panel.tsx) | ✅ TanStack Virtual + maxChars=10000 |
| [briefing-task-chat.tsx](../src/components/design-session/briefing-task-chat.tsx) | ✅ TanStack Virtual + maxChars=10000 |

### 1.5 Super Session — feature implementada

- Migration: [supabase/migrations/20260429_design_session_super.sql](../supabase/migrations/20260429_design_session_super.sql) adicionou coluna `selectedSteps text[]` em `DesignSession`
- Step catalog em [src/lib/design-session-steps.ts](../src/lib/design-session-steps.ts) com `STEP_CATALOG`, `getStepsFromKeys`, `getStepsForSession`, `validateSuperSteps`, `ALWAYS_FIRST="pre_work"`, `ALWAYS_LAST="briefing"`
- Modal de criação: [super-session-modal.tsx](../src/components/design-session/super-session-modal.tsx)
- Botão "Super Session" na tab `/projects/[id]` (junto com Inception e Melhoria Contínua)
- Prompt do Vitor reconhece `type="super"` com bloco "Steps DESTA sessão (escopo fechado)" no topo

---

## 2. Sessão Zelar — estado atual e como retomar

### 2.1 IDs importantes

```bash
SUPER_SESSION_ID=ae1c4107-14e3-4d6a-9b63-e2d0969691d5  # Super Session Zelar
PROJECT_ID=e41c492e-7a14-44b2-83b9-b8e0f2b38e4c        # Projeto Zelar
```

### 2.2 Estado dos steps (em `2026-04-29`)

| Step | currentStep idx | Estado |
|---|---|---|
| pre_work | 0 | ✅ 5 docs persistidos em `files[]` (~145k chars) |
| scope_definition | 1 | ✅ 6/5/14/9 items aplicados |
| risks_gaps | 2 | ❌ vazio |
| brainstorm | 3 | ✅ 45 cards aplicados em `solutions[]` |
| prioritization | 4 | ❌ vazio (próximo step) |
| hypotheses | 5 | ❌ vazio |
| technical_specs | 6 | ❌ vazio |
| briefing | 7 | ❌ vazio (e tasks NÃO devem ser geradas — combinado) |

**Verificar estado a qualquer momento:**

```bash
source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql "$DIRECT_URL" <<SQL
SELECT
  "stepKey",
  jsonb_object_keys(data) AS keys,
  jsonb_array_length(data->'solutions') AS solutions,
  jsonb_array_length(data->'gaps') AS gaps,
  jsonb_array_length(data->'risks') AS risks,
  COALESCE(jsonb_array_length(data->'_drafts'->'solutions'), 0) AS draft_solutions
FROM "DesignSessionStepData"
WHERE "sessionId" = 'ae1c4107-14e3-4d6a-9b63-e2d0969691d5'
ORDER BY "stepIndex";
SQL
```

### 2.3 Memória estruturada do projeto Zelar

```bash
psql "$DIRECT_URL" -c "SELECT id, status, statement, tags FROM \"DesignDecision\" WHERE \"projectId\" = 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c' ORDER BY \"createdAt\";"
psql "$DIRECT_URL" -c "SELECT id, status, question FROM \"DesignOpenQuestion\" WHERE \"sessionId\" = 'ae1c4107-14e3-4d6a-9b63-e2d0969691d5';"
```

Esperado em 2026-04-29:
- 6 decisions ativas (Stack indefinida, Admin não-persona, MVP B2C, Águas Claras, Backoffice em scope, framework de pontos como Conforto)
- 1 decision reverted (Admin não persona — versão antiga, supersededBy backoffice scope)
- 2 open questions resolved (personas inferidas, OKRs ausentes)

### 2.4 Como retomar a sessão Zelar

```bash
# 1. Verificar estado
psql "$DIRECT_URL" -c "SELECT \"currentStep\", title, status FROM \"DesignSession\" WHERE id = 'ae1c4107-14e3-4d6a-9b63-e2d0969691d5';"

# 2. Próximo step natural: prioritization (idx 4)
psql "$DIRECT_URL" -c "UPDATE \"DesignSession\" SET \"currentStep\" = 4 WHERE id = 'ae1c4107-14e3-4d6a-9b63-e2d0969691d5';"

# 3. Mandar mensagem pro Vitor
echo "Vamos pro prioritization. Os 45 cards do brainstorm precisam virar buckets MVP/Next/Out. Use mvp_check antes de marcar como MVP." > /tmp/msg.txt
npx tsx --require ./scripts/_server-only-shim.cjs scripts/vitor-cli.ts \
  --session ae1c4107-14e3-4d6a-9b63-e2d0969691d5 \
  --message-file /tmp/msg.txt
```

### 2.5 Próximos steps recomendados pra Zelar (ordem)

1. **Prioritization** — buckets MVP/Next/Out nos 45 cards. Aproveitar `mvp_check` (gate estrutural). Vitor já indicou ~30 Oxigênio + ~14 Conforto na classificação dele — pode ancorar.
2. **Hypotheses** — hipóteses falsificáveis com indicador/meta/evidência. Atenção: as OQs sobre métricas de tração foram resolved como "sem OKR". Vitor pode propor metas baseadas no que sabe.
3. **Technical_specs** — stack indefinida (decision ativa). Aqui é onde a tensão "App Nativo / PWA / PWA+WhatsApp" precisa virar decisão ou gap concreto.
4. **Briefing** — só revisão visual, **NÃO gerar tasks** (combinação prévia com user).

---

## 3. Como criar nova sessão de calibragem do Vitor

Quando precisar testar comportamento novo do Vitor sem poluir Zelar real:

```bash
# Criar Super Session de teste (DELETÁVEL)
TEST_SESSION_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
PROJECT_ID="<algum-projeto-de-teste>"  # SELECT id FROM "Project" LIMIT 5;

source <(grep '^DIRECT_URL=' .env | sed 's/^/export /') && psql "$DIRECT_URL" <<SQL
INSERT INTO "DesignSession"
  (id, "projectId", type, status, title, "currentStep", "totalSteps", "selectedSteps", "updatedAt")
VALUES
  ('$TEST_SESSION_ID', '$PROJECT_ID', 'super', 'draft',
   'TESTE-VITOR-$(date +%s)', 1, 4,
   ARRAY['pre_work','brainstorm','briefing']::text[],
   NOW());
SQL
echo "$TEST_SESSION_ID" > /tmp/test-session-id

# Rodar turno
echo "tua mensagem" > /tmp/msg.txt
npx tsx --require ./scripts/_server-only-shim.cjs scripts/vitor-cli.ts \
  --session "$(cat /tmp/test-session-id)" --message-file /tmp/msg.txt

# Limpar
psql "$DIRECT_URL" -c "DELETE FROM \"DesignSession\" WHERE id = '$(cat /tmp/test-session-id)';"
```

---

## 4. Gaps conhecidos (oportunidades de calibragem futura)

### 4.1 Em produção mas com edges não cobertos

#### G1 — `search_doc` retorna ranking ruim em queries com stopwords PT-BR

**Sintoma:** query `"M_horário noturno faixa horário comercial fim de semana"` retornou 873 matches no Zelar (a maioria irrelevante; rankeou top 5 OK por coincidência semântica). Stopwords como "de", "o", "fim" inflam totalMatches.

**Impacto atual:** baixo — top-N rankeado por score evita lixo. Mas em queries menos felizes pode escapar.

**Fix proposto:**
1. Adicionar lista de stopwords PT-BR em [src/lib/agent/tools/search-doc.ts](../src/lib/agent/tools/search-doc.ts):  `["de","da","do","a","o","e","em","na","no","para","por","com","ao","aos","ou","que","se","um","uma","uns","umas"]`
2. No `splitTerms`, filtrar stopwords + termos com `length < 3`
3. Manter pelo menos 1 termo (se query for só stopwords, fallback pra busca literal)

**Esforço:** ~20 min.

#### G2 — UI não mostra `_drafts[]`

**Sintoma:** quando Vitor usa `draft_step_items`, drafts ficam em `data._drafts[arrayKey][]` mas o UI atual (`SolutionCardBoard`, `RiskGapBoard`) só renderiza o array principal. Usuário não vê o que foi rascunhado.

**Fluxo atual:** Vitor descreve drafts no chat → user aprova → `apply_drafts` → vira solutions visível. Funciona porque user confia no Vitor.

**Risco:** se sessão for retomada por outro user (que não viu o sumário no chat), drafts ficam invisíveis no UI. Pode confundir.

**Fix proposto (Artifacts pattern):**
1. Componente `<DraftsPanel />` que mostra `_drafts` com botões "aplicar" / "descartar" / "ver completo"
2. Toggle no wizard: alterna entre solutions-only e solutions+drafts
3. Mobile: bottom sheet
4. Sync state via `refreshStepData` quando aplicar/descartar

**Esforço:** ~6-10h. Era a Fase 4 do plano de robustez (não bloqueia, é polish).

#### G3 — `revise_decision` aceita id curto silenciosamente?

**Sintoma:** durante calibragem com Zelar, Vitor chamou `revise_decision({id: "a70c9f5d", ...})` (id curto) e recebeu `{ok: false, error: "decision a70c9f5d not found"}`. Ele se recuperou chamando `list_decisions` pra pegar o id completo. Mas isso é desperdício de tool call.

**Fix:** [src/lib/agent/tools/memory.ts](../src/lib/agent/tools/memory.ts) — `revise_decision` poderia fazer match parcial por prefixo do id (8 chars curtos) ou `like` no statement. Reduz fricção sem aumentar superfície de erro.

**Esforço:** ~30 min + teste.

#### G4 — Vitor às vezes ignora `currentStepKey` quando user pede ação em outro step

**Sintoma:** se user diz "vamos pro brainstorm" e currentStep está em 2 (risks_gaps), Vitor às vezes começa a trabalhar em brainstorm sem o currentStep ter avançado no banco. Resultado: o sistema acha que está em risks_gaps, mas Vitor está produzindo solutions.

**Impacto atual:** baixo — `add_item({stepKey: "brainstorm", arrayKey: "solutions", ...})` ignora currentStep e grava onde pediu. Mas o UI do user mostra outra tela.

**Fix proposto:** adicionar regra ou tool `set_current_step({stepIndex})` que Vitor chame antes de trabalhar em outro step. Ou: prompt avisa "se user pedir ação em outro step, sugere navegar primeiro".

**Esforço:** prompt-only fix em ~10 min.

### 4.2 Aprimoramentos arquiteturais (backlog)

#### B1 — Numeração de regras fora de ordem

Refactor cosmético: re-numerar `buildBehaviorRules` em ordem sequencial. Esforço: ~10 min.

#### B2 — Tools de draft podem cobrir mais steps com schema validado

Hoje `draft_step_items` aceita `items: Record<string, unknown>[]` (z.record genérico). Não valida schema do step específico. Se Vitor errar campos, vai aparecer só ao aplicar.

**Fix:** schema discriminated union por `stepKey`. Esforço médio (~1-2h).

#### B3 — Web Worker pra parse de markdown

Era a Fase 3 do plano de robustez (não implementada). Não bloqueia. Marcado como overkill em [conversa anterior](#).

---

## 5. CLI dev — `scripts/vitor-cli.ts`

Já existe e funciona. Sintaxe:

```bash
# Via flag
npx tsx --require ./scripts/_server-only-shim.cjs scripts/vitor-cli.ts \
  --session <session-id> \
  --message "texto curto"

# Via arquivo (pra mensagens grandes — recomendado)
echo "mensagem grande aqui" > /tmp/msg.txt
npx tsx --require ./scripts/_server-only-shim.cjs scripts/vitor-cli.ts \
  --session <session-id> \
  --message-file /tmp/msg.txt

# Avançar currentStep no fim do turno
... --advance-to 3
```

### 5.1 O que ele faz

1. Lê session do banco, deriva `currentStepKey`
2. `ensureThread(sessionId, "web")` + `persistUserMessage`
3. `runAgent({ vitorAgent, ..., capabilities: WEB_CAPABILITIES })`
4. Consume stream — printa text-delta + tool calls + tool results
5. `persistAssistantMessage` no fim
6. Opcional: avança currentStep

Mesmos helpers que a rota HTTP usa — chat fica visível no UI normalmente.

### 5.2 Cenários úteis pra teste rápido

| Mensagem | O que valida |
|---|---|
| `"ping"` | Smoke: tool calls minimal, resposta curta |
| `"o que diz o doc sobre X?"` | Regra 14: usa search_doc, cita literal |
| `"crie 8 cards de feature X"` | Regra 15: usa draft_step_items em vez de markdown |
| `"marca decision Y como under_review"` | Regra 0: propõe antes, não dispara |
| `"preencha tudo"` | Regra 0: UM step por turno, não enfileira tudo |

### 5.3 Limpeza após teste

```bash
# Limpar histórico de uma thread (preserva step data, decisions, OQs, etc)
psql "$DIRECT_URL" <<SQL
DELETE FROM "ChatMessage" WHERE "threadId" IN
  (SELECT id FROM "ChatThread" WHERE "sessionId" = '<session-id>');
DELETE FROM "ChatThread" WHERE "sessionId" = '<session-id>';
SQL
```

⚠️ Cuidado: se for uma sessão real (não de teste), preserva ChatThread/ChatMessage. Mensagens são histórico legítimo.

---

## 6. Como medir que o Vitor está saudável

### 6.1 Smoke test programático (5 min)

Roda em sessão de teste descartável (Seção 3):

```bash
# 1. Regra 0 — propor antes de aplicar
echo "marca a decision X como under_review" > /tmp/msg.txt
npx tsx ... --message-file /tmp/msg.txt
# Esperado: Vitor PROPÕE em texto, não chama revise_decision direto.

# 2. Regra 13 — citação literal
echo "qual o multiplicador de horário noturno?" > /tmp/msg.txt
npx tsx ... --message-file /tmp/msg.txt
# Esperado: Vitor chama search_doc, cita trecho com arquivo+linha.

# 3. Regra 15 — output volumoso
echo "desenvolva 10 cards densos sobre o produto X" > /tmp/msg.txt
npx tsx ... --message-file /tmp/msg.txt
# Esperado: Vitor usa draft_step_items, output do chat fica curto (~1k chars).

# 4. Regra 0 + multi-tool — sequência
echo "revisa decision X, grava 2 novas e reverte a antiga" > /tmp/msg.txt
npx tsx ... --message-file /tmp/msg.txt
# Esperado: Vitor apresenta plano completo (texto), pede confirmação. NÃO dispara 4 tool calls.
```

### 6.2 Checklist de saúde

A cada calibragem maior, conferir:

- ✅ `tsc --noEmit` limpo
- ✅ `npm run build` passa
- ✅ Smoke test acima passa em sessão fresh
- ✅ Push em `main` (origin + staging)
- ✅ Teste no UI: criar sessão de teste, abrir chat, mandar 1 mensagem, ver resposta + tool chips
- ✅ Verificar que `_drafts[]` não vaza pro UI (componentes só leem array principal)

---

## 7. Histórico de calibragens (timeline 2026-04-28 → 2026-04-29)

Útil pra entender de onde veio cada regra:

| Data | Calibragem | Motivação |
|---|---|---|
| 2026-04-28 | **Calibragem 1**: Regra 0 (lista nominal de tools) + Regra 12 (decisões de exclusão) | Vitor disparou 6 writes em silêncio quando user disse "marca X under_review". Decision sobre Admin escondia backoffice |
| 2026-04-28 | **Calibragem 2**: Regra 0 categoria-based (qualquer tool de escrita) + Regras 13/14 (citação literal + search_doc) + tool `search_doc` + persistir doc Zelar em `pre_work.files[]` | Lista nominal não cobriu `resolve_open_question`. Vitor errou interpretação de tabela M_horário (leu como "termina às 22h", real são 3 faixas) |
| 2026-04-28 | **Calibragem 3**: maxSteps 30 → 60 | Aplicação de 30 cards estourou stepCountIs(30) e cortou no 30º add_item |
| 2026-04-28 | **Calibragem 4**: Regra 15 + tools de drafts (brainstorm-only `draft_brainstorm_cards`/`apply_drafts`/etc) | Vitor produziu 60k chars em um turno → travou navegador na renderização. ChatMessage truncada com backup |
| 2026-04-29 | **Calibragem 5**: drafts genéricos (`draft_step_items` aceitando qualquer step+arrayKey), substituiu brainstorm-only. Regra 15 reescrita com escopo claro: drafts são pra ITEMS estruturados, conversa continua texto livre | Drafts brainstorm-only não cobriam risks_gaps/hypotheses/etc. User pediu generalização + clareza sobre o que NÃO é draft (perguntas, análise, raciocínio) |
| 2026-04-29 | **UI**: collapsible markdown (`maxChars` opcional) + virtualização TanStack Virtual nos 2 chats principais | Histórico crescendo trava o navegador mesmo com mensagens curtas. Solução de produção (Slack/Discord pattern) |

---

## 8. Quando NÃO mexer no Vitor

- Quando o sintoma é específico de **uma sessão** mas o agente comportou bem em outras → calibragem específica de input, não de regra
- Quando o gap descoberto é **edge case raro** e tem fix manual rápido (ex: psql update direto) → não vira regra de prompt, fica documentado em "Gaps conhecidos"
- Quando o time está em release iminente e calibragem mexe em prompt — risco de regressão. Calibragem em prompt é **mudança comportamental sistêmica** que afeta todas as sessões existentes
- Quando o mesmo problema apareceria com qualquer agente do mercado (não é defeito do Vitor) — ex: hallucination genérica, latência de provider

---

## 9. Próximas calibragens — priorização sugerida

Em ordem de impacto/esforço:

| # | Item | Origem | Esforço | Impacto |
|---|---|---|---|---|
| 1 | G1 — stopwords PT-BR no `search_doc` | Seção 4.1 | 20 min | Baixo (já é "ok") |
| 2 | G3 — `revise_decision` aceitar id curto | Seção 4.1 | 30 min | Baixo (atualmente recovery existe) |
| 3 | G4 — auto-set currentStep em mudança de tópico | Seção 4.1 | 10 min (prompt) | Médio |
| 4 | B1 — re-numerar regras em ordem | Seção 4.2 | 10 min | Estético |
| 5 | G2 — UI de drafts (Artifacts pattern) | Seção 4.1 | 6-10h | Alto (só vira problema se sessão for compartilhada) |
| 6 | B2 — Schema validado por step nas drafts | Seção 4.2 | 1-2h | Médio |

**Recomendação:** atacar G3+G4+B1 numa única PR de polish (~50 min total). G1 separadamente. G2/B2 quando dor manifestar.

---

## 10. Próximo passo recomendado pra quem pegar este runbook

Depende do objetivo:

### A) Continuar a sessão Zelar (próximo step prioritization)
Pular pra **Seção 2.4** e seguir os comandos.

### B) Aplicar uma calibragem da Seção 4 / 9
1. Ler Seção 1 inteira (estado calibrado) pra entender o que existe
2. Pegar item da priorização (Seção 9)
3. Editar `prompt.ts` ou tool relevante
4. Rodar smoke test (Seção 6.1)
5. `tsc --noEmit` + `npm run build`
6. Push via `bash scripts/sync-main.sh`

### C) Diagnosticar comportamento ruim novo
1. Reproduzir em sessão de teste (Seção 3)
2. Identificar regra/tool envolvida (Seção 1)
3. Adicionar ao "Gaps conhecidos" (Seção 4) com sintoma + impacto + fix proposto
4. Decidir esforço/impacto antes de mexer

### D) Só entender como Vitor funciona pra contexto
Ler Seções 0-1, abrir [src/lib/agent/agents/vitor/index.ts](../src/lib/agent/agents/vitor/index.ts) e seguir as imports.

---

## 11. Comandos úteis (cheat sheet)

```bash
# Sessão Zelar — IDs
SUPER_SESSION_ID=ae1c4107-14e3-4d6a-9b63-e2d0969691d5
PROJECT_ID=e41c492e-7a14-44b2-83b9-b8e0f2b38e4c

# Verificar estado da Zelar
psql "$DIRECT_URL" -c "SELECT \"stepKey\", jsonb_array_length(data->'solutions') AS solutions FROM \"DesignSessionStepData\" WHERE \"sessionId\" = '$SUPER_SESSION_ID';"

# Mensagem pro Vitor
echo "msg" > /tmp/msg.txt
npx tsx --require ./scripts/_server-only-shim.cjs scripts/vitor-cli.ts \
  --session $SUPER_SESSION_ID --message-file /tmp/msg.txt

# Avançar step
psql "$DIRECT_URL" -c "UPDATE \"DesignSession\" SET \"currentStep\" = N WHERE id = '$SUPER_SESSION_ID';"

# Listar decisions/OQs
psql "$DIRECT_URL" -c "SELECT id, status, statement FROM \"DesignDecision\" WHERE \"projectId\" = '$PROJECT_ID' ORDER BY \"createdAt\";"
psql "$DIRECT_URL" -c "SELECT id, status, question FROM \"DesignOpenQuestion\" WHERE \"sessionId\" = '$SUPER_SESSION_ID';"

# Ver tamanho da última ChatMessage (suspeita de pesado)
psql "$DIRECT_URL" -c "SELECT id, role, length(content) AS chars FROM \"ChatMessage\" WHERE \"threadId\" IN (SELECT id FROM \"ChatThread\" WHERE \"sessionId\" = '$SUPER_SESSION_ID') ORDER BY \"createdAt\" DESC LIMIT 5;"

# Validação
npx tsc --noEmit
npm run build

# Push
bash scripts/sync-main.sh -m "feat: vitor calibration — XYZ"
```

---

## 12. Diferenças importantes Vitor vs Alpha (não confundir)

Caso esteja comparando com [alpha-calibration-plan.md](alpha-calibration-plan.md):

1. **Vitor** trabalha com Design Sessions (step data + cards + decisions). **Alpha** trabalha com Operações (sprints + tasks + alocações).
2. **Vitor** lê documentos persistidos em `pre_work.files[]` via `search_doc`. **Alpha** lê dados de DB (sprints, tasks, members) via tools dedicadas.
3. **Vitor** persiste drafts em `DesignSessionStepData._drafts[arrayKey]`. **Alpha** ainda não tem drafts (proposta na Fase 3 do plano dele: tabela `AgentDraft` dedicada).
4. **Vitor** usa `sessionId` em ChatThread. **Alpha** usa `agentName='alpha'` + `sessionId=null`.
5. **Vitor** não tem awareness de rota (sessionId carrega o contexto). **Alpha** tem `parseRoute(currentPath)` essencial.
6. **Vitor** chama `web_search` com auto-capture em `DesignSessionResearch`. **Alpha** não tem research log (mas tem heurísticas via `load_heuristic`).

---

**Última revisão:** 2026-04-29
**Status do Vitor em produção:** Calibrado e estável (origin + staging em sync, último commit `3f4f88c`)
**Pareceiro de runbook:** [docs/alpha-calibration-plan.md](alpha-calibration-plan.md)
