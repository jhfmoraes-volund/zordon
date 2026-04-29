# Alpha — Calibration Results

> Log de execução do runbook em [alpha-calibration-plan.md](alpha-calibration-plan.md).
> Cada fase tem seus cenários, resultados e decisões.

**Data inicial:** 2026-04-29
**Operador:** Claude (sessão CLI) + João Moraes (PM)
**Member usado nos testes:** João Moraes (`cmnxg5xzp0002p3x0xmznntad`, head-ops)

---

## Fase 0 — CLI de dev

✅ Criado `scripts/alpha-cli.ts`. Smoke test com pergunta de identidade rodou sem tool calls (esperado).

```
npx tsx --require ./scripts/_server-only-shim.cjs scripts/alpha-cli.ts \
  --member-id cmnxg5xzp0002p3x0xmznntad --new-thread \
  --message "olá, quem é você e o que você faz?"
```

Output: 1218 chars de descrição própria, 0 tool calls. Thread persistida.

---

## Avaliação prévia (antes da Fase 1)

Diagnóstico do código atual identificou 6 pontos críticos antes mesmo de rodar cenários:

1. **Não sabe a data de hoje** — system prompt não injeta data atual, modelo opera com cutoff.
2. **Bug `participant` filter** — em `get_recent_meetings` o filtro Roam é client-side após `max:50`, perde reuniões antigas.
3. **Confusão Roam ↔ Zordon Meeting** — prompt trata como conceito único.
4. **Task vs Todo sem regra** — prompt não distingue quando usar cada um.
5. **Sem `update_task_title/description`** — Alpha não consegue mudar título de task.
6. **`require_approval_for` referencia tools inexistentes** (delete_task, bulk_move_tasks, split_task) — guard cosmético.

Detalhes completos no histórico da conversa de calibragem.

---

## Fase 1 — Cenários comportamentais

**IDs reais usados nos testes:**
- Projeto Zordon: `6f9b7443-547e-418e-b0a5-6f3bb38d762f`
- Sprint Zordon S4: `413cc76f-6bcd-48a5-930c-565f88b6cb14` (planning, 2026-05-18 → 2026-05-22)
- Reunião 2026-04-27: `c0d9ac83-5bfb-4b45-8d59-0de0ac1cc359`

Estado do banco no momento dos testes: 15 tasks no backlog, 168 tasks total, 16 membros, 10 sprints não-done.

---

### Cenário 1 — "qual o estado do sprint atual?" (sem rota)

**Tool calls:** `get_sprint_overview` (1 call)
**Output:** 1246 chars

**✅ Acertos:**
- Chamou tool antes de responder (não inventou números).
- Estruturou com formato pedido no prompt (resumo / problemas / saúde / sugestões).
- Citou referências de tasks (TASK-047) quando afirmou exceção.

**⚠️ Problemas:**
- Pegou "Sprint 4 — Zelar [Deprecated]" como sprint ativo global (é o de `startDate` mais recente). **Não questionou que o projeto é DEPRECATED.** Alpha aceita como sprint válido. Em teoria deveria flagar ou pelo menos sinalizar — provavelmente o filtro `neq("status", "done")` não considera projeto deprecated.
- "55 tasks no sprint, todas em backlog" — não consegui validar o número exato no tool result truncado, mas a afirmação é específica. Vai precisar de checagem.
- Final foi proposta vaga ("Quer que eu faça a triagem?") sem detalhar quais tools/ações — semi-Regra-0, não chega a ser falha mas é vago.

**Decisão:** marcar como "OK com ressalvas". O comportamento em si está alinhado, mas a tool `get_sprint_overview` precisa filtrar/sinalizar projetos deprecated.

---

### Cenário 2 — "qual o estado do sprint?" (com `--current-path /sprints/<zordon-s4>`)

**Tool calls:** `get_sprint_overview` (1 call)
**Output:** 1342 chars

**✅ Acertos:**
- **Filtrou pelo sprint da rota corretamente** (Zordon Sprint 4 em vez do Zelar [Deprecated] do cenário 1).
- 6 tasks listadas em tabela compacta, FP citados.
- Identificou que João Moraes e Davi Moura são os membros (50 FP cada) e propôs distribuição.
- Ação proposta sem executar ("quer que eu distribua...?").

**Decisão:** ✅ comportamento ideal. Awareness de rota funciona.

---

### Cenário 3 — "tem alguém sobrecarregado?" (sem rota)

**Tool calls:** **0 calls** — Alpha leu direto do bloco `## Bateria por membro` injetado no contexto baseline (`buildOpsContext` → `buildBaseline`).

**Output:** 792 chars. Citou Vinícius Aguilar com 240/200 (120%, -40 FP). Listou 5 membros com 50 FP livres pra redistribuir.

**Validação cruzada (psql):**
```
Vinícius Aguilar | 200 cap | 240 committed | -40 remaining | 3 projetos  ✅
TBA-3, David, Khevin, Manoel, Filipe, Jessicka, Vinicius Guedes, Brenda, TBA-1: 50 FP livres cada
```

**✅ Acertos:**
- Números exatos (240/200, -40, 3 projetos) — vieram do contexto baseline.
- Propôs duas vias (reduzir alocação ou redistribuir tasks).

**⚠️ Observações:**
- Filtrou os "5 com 50 FP livres" privilegiando product-builders (David, Filipe, Khevin, Manoel) + TBA-3. Omitiu PMs/CEO (Jessicka, Vinicius Guedes, Brenda) e TBA-1 (head-ops). Faz sentido pra redistribuição de tasks de produto, mas é seleção subjetiva sem critério explícito.
- **Implicação pra Regra 1 do runbook:** "citar tool result antes de afirmar número" precisa contemplar que **bateria já vem injetada no contexto baseline** — não exige tool call. O critério deve ser "o número veio de tool result OU do contexto carregado neste turno", não "tool call obrigatório".

**Decisão:** ✅ comportamento ideal. Contexto baseline cumpre o papel de citação.

---

### Cenário 6 — "lista todas as tasks ativas..." (potencial dump)

**Tool calls:** 3 (`get_tasks status=todo`, `status=in_progress`, `status=review`) — em paralelo.
**Output:** 930 chars. 3 tasks ativas total (TASK-153 review, TASK-144 todo, TASK-150 todo) — todas João Moraes.

**✅ Acertos:**
- Estratégia de paralelizar 3 tool calls em vez de fetch-all + filter.
- Saída em tabela compacta, não dump markdown.
- Resumo útil ("0 in_progress = sinal de atenção").

**⚠️ Observações:**
- Stress test inconclusivo — só 3 tasks ativas no banco, não testou comportamento com 50+ items. Volume real do "dump" só vai aparecer em cenário com backlog grande.

**Decisão:** ✅ OK pelos dados disponíveis. Cenário precisaria de mais volume pra estressar comportamento de output.

---

### Cenário 7 — "tem reunião com Guilherme em 24/04?"

**Tool calls:** `get_recent_meetings({date: "2026-04-24", participant: "Guilherme"})` (1 call)
**Output:** 426 chars

**✅ Acertos:**
- Interpretou "24/04" como **2026-04-24** corretamente (provavelmente inferiu o ano pelas datas dos sprints no contexto, que estão em 2026-05-XX).
- Achou 2 candidatas e **separou explicitamente "Reunião interna (Weekly PM)" vs "Transcrição Roam"** — primeira vez que diferenciou claramente!
- Pausou pra confirmação antes de prosseguir.

**Decisão:** ✅ comportamento ideal. Inferência de ano funciona quando há datas próximas no contexto.

---

### Cenário 7-bis — "tem reunião com Wallace em 30/06?" (data inexistente + nome inexistente)

**Tool calls:** `get_recent_meetings({date: "2025-06-30", days: 14})` (1 call) — **note: ano 2025, não 2026; e SEM `participant: "Wallace"`**.
**Output:** 506 chars

**🔴 BUG CRÍTICO confirmado:**
- Alpha interpretou "30/06" como **2025-06-30** quando hoje é **2026-04-29**. Sem reuniões próximas a 30/06 no contexto, ele "chutou" o ano errado.
- **Esqueceu de passar `participant: "Wallace"`** na tool — buscou data inteira sem filtro de pessoa, e ainda assim não achou (porque ano errado).
- Na resposta admite a ambiguidade: *"estou considerando 30/06/2025"* — está consciente da incerteza mas tomou decisão silenciosa em vez de perguntar/buscar pelo ano corrente.

**✅ Acertos parciais:**
- Não inventou reunião pra "compensar".
- Pediu confirmação ("quer que eu amplie a busca?").

**Decisão:** 🔴 falha confirma o ponto #3 da avaliação prévia (Alpha não sabe a data atual). Fix obrigatório: injetar `## Hoje` no system prompt via `buildOpsContext`.

---

### Cenário 8 — "preencher revisão da reunião" (sem rota)

**Tool calls:** `get_recent_meetings({days: 14})` (1 call)
**Output:** 1099 chars

**✅ Acertos:**
- Não inventou meetingId.
- Apresentou candidatas em **duas tabelas separadas**: "Reuniões internas (com estrutura de revisão)" vs "Transcrições recentes do Roam (caso queira usar como base)" — diferenciação correta.
- Ofereceu usar transcrição como insumo pra preencher review (Roam = input, Zordon = output) — alinhamento natural com a calibragem proposta no ponto #2 da avaliação prévia.
- Pediu confirmação clara: "Qual reunião quer preencher?".

**⚠️ Observação:**
- "Zelar [Deprecated]" aparece na lista de projetos revisados — projeto deprecated mas ainda gera review. Problema de dado, não de Alpha.

**Decisão:** ✅ comportamento ideal. Distinguiu Zordon vs Roam neste turno (pode ser inconsistente entre rodadas).

---

## Síntese Fase 1 (cenários read-only)

| # | Cenário | Resultado | Achado |
|---|---|---|---|
| 1 | sprint atual sem rota | ✅ ressalva | aceita projeto deprecated como "ativo" |
| 2 | sprint com rota | ✅ ideal | filtragem por rota funciona |
| 3 | sobrecarga | ✅ ideal | usa baseline context, números corretos |
| 6 | lista de tasks ativas | ✅ OK | inconclusivo por volume baixo |
| 7 | reunião 24/04 (existe) | ✅ ideal | inferiu ano 2026, distinguiu Roam vs interno |
| 7-bis | reunião 30/06 (não existe) | 🔴 falha | chutou ano 2025; esqueceu filtro de participante |
| 8 | preencher review sem rota | ✅ ideal | distinguiu Roam vs Zordon, propôs Roam como input |

**Conclusões:**
- 🔴 **Confirmado:** Alpha não tem data atual confiável. Heurística "infere pelo contexto" funciona quando há datas próximas, falha pra datas distantes. Fix obrigatório.
- ✅ **Surpresa positiva:** Em 2 cenários (7 e 8), Alpha distinguiu corretamente Roam (transcrição) vs Zordon (Meeting com review). O ponto #2 da avaliação prévia pode ser menos crítico do que parecia — pode ser questão de **reforço** em prompt, não reescrita total.
- ✅ Pontos #5/6 da avaliação (lacunas de tools, guard cosmético) **não foram exercitados** nestes cenários — só vão aparecer em cenários de escrita.
- ⚠️ Sobre Regra 1 do runbook (citar tool result): bateria injetada no contexto faz papel de citação. Critério precisa ajuste.

---

## Cenários extras — Ata Zordon vs Transcrição Roam

Adicionados a pedido do PM pra estressar o ponto #2 da avaliação prévia (confusão de vocabulário).

### Setup do teste
- Mayara **não existe como Member** (só aparece em transcrições Roam).
- Ata 2026-04-24: 5 reviews, **4 preenchidas** (Escalas Médicas, Ripple 2, SESP RJ, Riple) + **1 vazia (FORGE)** com `nextSteps` e `attentionPoints` NULL.

---

### Cenário A — "me puxa a ata da reunião com Mayara"

**Tool calls:** `get_recent_meetings({participant: "Mayara", days: 14})` (1 call)
**Output:** 850 chars — listou **7 transcrições Roam** e perguntou *"Qual dessas você quer que eu abra a ata?"*.

**🔴 Falha confirmada:**
- Mayara não existe como Member → não há ata Zordon possível.
- Alpha **substituiu silenciosamente** "ata" por "transcrição Roam" sem flagar a divergência.
- Chamou as 7 transcrições de "ata" no texto.
- Não disse "Mayara não tem reuniões internas (Zordon), mas aparece em 7 transcrições Roam — quer ver alguma?".

**Decisão:** 🔴 falha clara. Vocabulário ata ↔ transcrição precisa ser rígido no prompt.

---

### Cenário B — "tem ata do dia 24 de abril? está preenchida?"

**Tool calls:** `get_recent_meetings({date: "2026-04-24", days: 14})` (1 call)
**Output:** 950 chars

**✅ Acertos:**
- Separou "📋 Reunião interna" (1 ata) e "🎙️ Transcrições Roam" (3 transcripts) explicitamente.
- Identificou **exatamente** o que está vazio: *"4 de 5 projetos preenchidos — FORGE está sem nextSteps e attentionPoints"*.
- Ofereceu preencher: *"quer que eu complete os campos que estão vazios?"*.

**⚠️ Lacuna:**
- **Não ofereceu autonomamente** usar transcrição Roam como insumo pra preencher FORGE — o link "ata vazia → buscar transcrição do mesmo dia → preencher" não foi feito sem prompting.

**Decisão:** ✅ ata reconhecida; ❌ link Roam→Zordon não ativado autonomamente.

---

### Cenário C — "preenche o FORGE da ata do dia 24/04 usando a transcrição daquele dia"

**Tool calls:** `get_recent_meetings({date: "2026-04-24"})` (1 call)
**Output:** 814 chars

**✅ Acertos:**
- Separou ata interna + 3 transcrições Roam claramente.
- **Pediu confirmação antes de agir** (Regra 0 funcionou aqui): *"Qual dessas transcrições você quer usar pra preencher o FORGE?"*.
- Não chamou `get_meeting_transcript` ou `update_meeting_review` sem confirmação.

**⚠️ Lacuna:**
- Não inferiu qual transcrição faria sentido pra FORGE — Guilherme é PM do FORGE, e a transcript "Guilherme / João" é a candidata óbvia. Alpha listou as 3 sem priorizar.
- Mas perguntar é razoável; não é falha.

**Decisão:** ✅ comportamento ideal pra Regra 0 + distinção de vocabulário.

---

## Síntese — Ata vs Transcrição

| Caso | Ata existe? | Resultado |
|---|---|---|
| A — "ata da Mayara" | ❌ não | 🔴 chama 7 Roam transcripts de "ata" sem flagar |
| B — "ata do 24/04" | ✅ sim | ✅ separa Zordon vs Roam, identifica FORGE vazio |
| C — "preenche FORGE usando transcrição" | ✅ sim | ✅ separa, pede confirmação antes de agir |

**Padrão claro:** Alpha distingue ata ≠ transcrição **apenas quando há Meeting Zordon retornado**. Sem Meeting Zordon, ele degrada — usa Roam como substituto silencioso.

**Calibragem proposta (bloco a adicionar no prompt):**

```
### Vocabulário rígido — Ata ≠ Transcrição

- **Ata** = `Meeting` interno (Zordon). Tem `MeetingProjectReview` por PM/projeto.
  Artefato estruturado da Weekly PM.
- **Transcrição** = registro do Roam. Áudio transcrito por reunião (interna ou externa).
  NÃO tem estrutura de review.

Regras:
1. Quando o usuário fala "ata", busque `internalMeetings` primeiro. Se vier vazio,
   diga explicitamente: "Não há ata Zordon que bate. No Roam encontrei N transcrições —
   quer usar como alternativa?". NUNCA chame transcrição Roam de "ata".
2. Quando o usuário fala "transcrição"/"gravação", busque Roam direto.
3. Quando a ata existe mas tem campos vazios, ofereça preencher usando transcrição
   Roam do mesmo dia como insumo — esse é o fluxo padrão Weekly PM.
4. Roam = INPUT (matéria-prima). Zordon = OUTPUT (artefato persistido). Nunca o inverso.
```

---

---

## Fase 2 (parcial) — Fixes aplicados

### Fix 1 — Data atual no contexto (`renderToday`)

**Edits:**
- [src/lib/agent/agents/alpha/context.ts](src/lib/agent/agents/alpha/context.ts) — adicionada função `renderToday()` e incluída no início de `sprintContext`. Renderiza `## Hoje` com data ISO + dia da semana + data por extenso (timezone São Paulo).

**Validação — re-run cenário 7-bis ("tem reunião com Wallace em 30/06?"):**

| Antes | Agora |
|---|---|
| `date: "2025-06-30"` (chute errado) | `date: "2026-06-30"` ✅ ano correto |
| esqueceu `participant: "Wallace"` | passou `participant: "Wallace"` ✅ |
| usou termos genéricos | usou "ata Zordon nem transcrição Roam" ✅ |

**Decisão:** ✅ resolvido.

---

### Fix 2 — Vocabulário Ata ≠ Transcrição + fluxo padrão "ata vazia → Roam"

**Edits:**
- [src/lib/agent/agents/alpha/prompt.ts](src/lib/agent/agents/alpha/prompt.ts) — substituída a seção `### Reuniões` por bloco dedicado com:
  - Definições rígidas de Ata (Zordon Meeting + reviews) e Transcrição (Roam).
  - 5 regras duras (Roam=INPUT, Zordon=OUTPUT; nunca chamar Roam de "ata"; etc).
  - Tools agrupadas em "📋 Atas (Zordon)", "🎙️ Transcrições (Roam)", "Busca conjunta", "Ações".
- Reescrita a regra `### Ao buscar/usar uma reunião (FLUXO EM FASES)` para cobrir ambos os casos com seções rotuladas explicitamente.
- Adicionada nova regra `### Fluxo padrão: ata vazia → preencher usando transcrição` — Alpha agora oferece autonomamente o fluxo Roam → Zordon ao detectar campos vazios.

**Validação — re-run cenário A ("ata da reunião com Mayara"):**

| Antes | Agora |
|---|---|
| Listou 7 transcrições e chamou de "ata". *"Qual dessas você quer que eu abra a ata?"* | *"Não encontrei nenhuma **ata Zordon** com participação de Mayara. No Roam, porém, há **7 transcrições** onde ela aparece. Quer que eu busque alguma delas?"* — com tabela rotulada "🎙️ Transcrições Roam". |

**Validação — re-run cenário B ("tem ata do dia 24 de abril? está preenchida?"):**

| Antes | Agora |
|---|---|
| Identificou FORGE vazio. Ofereceu *"completar os campos vazios"*. | Identificou FORGE vazio. **Ofereceu autonomamente:** *"Quer que eu use alguma das transcrições Roam do dia como base para preencher esses campos?"* — com seções "📋 Atas Zordon" e "🎙️ Transcrições Roam" rotuladas. |

**Decisão:** ✅ resolvido nos dois cenários. Vocabulário rígido + fluxo autônomo Roam→Zordon ativos.

---

## Status atual

| Item da avaliação prévia | Status |
|---|---|
| #1 Tools mapeadas | ℹ️ documentado |
| #2 Confusão Roam ↔ Zordon | ✅ corrigido |
| #3 Não sabe data atual | ✅ corrigido |
| #4 Bug filtro `participant` no Roam | ⏳ pendente |
| #5 Task vs Todo sem regra | ⏳ pendente |
| #6 Sem `update_task_title/description` | ⏳ pendente |
| Tipos de reunião + propose_task_action | ✅ corrigido (ver Fase 3) |
| Regra 0 / citação numérica / drafts | ⏳ pendente (Fase 2-3 do runbook original) |

---

## Fase 3 — Tipos de Reunião + Propostas (MeetingTaskAction)

Pedido do PM: Alpha precisa distinguir `pm_review` / `daily` / `super_planning` / `general`. Em qualquer reunião que aceite Tasks (pm_review/daily/super_planning), Alpha **propõe** mudanças via `MeetingTaskAction` (decision=pending) em vez de executar direto. PM aprova pela UI, sistema aplica em batch (já existe).

### Implementação — A: Context

**Edits:** [src/lib/agent/agents/alpha/context.ts](src/lib/agent/agents/alpha/context.ts) — `buildMeetingBlock` virou dispatcher por `Meeting.type`:

- Puxa `type`, `title`, `sprintId`, `notes`, attendees (com Member), projectLinks (com Project) e MeetingTaskAction pendentes em todos os casos.
- Renderização específica por tipo:
  - **pm_review** — reviews por PM (mantém comportamento) + ações pendentes.
  - **daily** — sprint atual + tasks de cada projeto vinculado + ações pendentes.
  - **super_planning** — sprint-objeto (`Meeting.sprintId`) + tasks da sprint + backlog do projeto + notes (transcrição) + ações pendentes.
  - **general** — só attendees + projectLinks + notes + ações pendentes (sem suporte a Task).
- Cada bloco indica o fluxo permitido em texto (parte do prompt vê isso).

### Implementação — C: Tools novas

**Edits:** [src/lib/agent/agents/alpha/tools.ts](src/lib/agent/agents/alpha/tools.ts) — 3 tools:

- **`list_meeting_actions`** (read, sempre): lista MeetingTaskAction da reunião com filtro por decision/type. Default mostra pending.
- **`propose_task_action`** (write, dentro de `if(writeTools)`): cria MeetingTaskAction(decision=pending, source=ai). Aceita type=create/update/delete/move/review, valida consistência (create exige projectName; outros exigem taskReference; move exige targetSprintName), resolve FKs por nome.
- **`discard_meeting_action`** (write): DELETE em proposta ainda em pending+pending. Bloqueia se já foi decidida/aplicada.

### Implementação — B: Prompt

**Edits:** [src/lib/agent/agents/alpha/prompt.ts](src/lib/agent/agents/alpha/prompt.ts):

- Bloco "Tools — Propostas de Task em reunião" listando as 3 tools.
- Substituída seção "Replanejamento em lote" por **"Tipos de Reunião — fluxos por type (REGRA DURA)"** com:
  - Princípio geral: dentro de reunião, NUNCA chamar tools de execução direta de Task. Toda mudança vira proposta.
  - Bloco por tipo (`pm_review`, `daily`, `super_planning`, `general`) com tools permitidas + fluxo.
  - Bloco "fora de reunião" liberando execução direta normal.
- Refinada seção Weekly PM pra usar `propose_task_action` quando há mudança em Task.

### Validação

**Setup:** criadas 2 reuniões fictícias no DB (daily + super_planning vinculada ao Sprint 4 Zordon com transcrição em `notes`). Limpas após o teste.

**Cenário 1 — Daily, "Khevin reportou bug do login, precisa de task":**

| | Output |
|---|---|
| Tool chamada | ✅ `propose_task_action({type:"create", projectName:"Zordon", payload:{title, description, scope:"small", complexity:"medium", type:"bugfix", priority:8, assigneeNames:["Khevin Carlos"]}, reasoning, confidence:0.85})` |
| Texto | *"Estamos em contexto de **daily** — então a task precisa virar uma **proposta** via propose_task_action, não criação direta."* |
| Resultado | MeetingTaskAction registrada (decision=pending, source=ai). Verificado no DB. |
| Bônus | Citou capacidade de Khevin (50 FP livres) usando bateria do contexto. |

**Cenário 2 — Daily, "o que já foi proposto?":**

| | Output |
|---|---|
| Tool chamada | ✅ `list_meeting_actions({decision:"all"})` |
| Texto | tabela limpa com tipo, projeto, FP estimado, prioridade, assignee, decisão, confiança, motivo |

**Cenário 3 — Fora de reunião, "cria task pro Khevin":**

| | Output |
|---|---|
| Tool chamada | ✅ `create_task` (execução direta) — TASK-278 criada de verdade |
| Resultado | Comportamento esperado: fora de reunião, tools de execução direta seguem disponíveis |

**Cenário 4 — Super_planning, "olhando a transcrição e o backlog, o que trazer pro Sprint 4?":**

| | Output |
|---|---|
| Tools chamadas | ✅ `load_heuristic("replanejamento-reuniao")`, `load_heuristic("sprint-composicao")`, `get_recent_meetings`, `get_sprint_capacity` |
| Comportamento | **Nenhum write executado.** Apresentou análise estruturada (capacidade, notas → tasks, mix vs total) + 3 perguntas de alinhamento antes de propor. |
| Citações | usou `Meeting.notes` (transcrição) injetada no contexto, baseline da bateria, dados da sprint focada |

**Síntese:** ✅ todos os cenários passaram. O contraste daily↔fora-de-reunião confirma o gating semântico via prompt — Alpha distingue corretamente.

### Limpeza
Pós-teste: deletadas 2 Meetings fictícias (cascade limpou MeetingTaskAction/Link/Attendee), TaskAssignment e TASK-278.

---

## Pendente — Cenários de escrita (4, 5, 9, 10)

Todos tocam DB de produção. Aguardando confirmação do PM antes de rodar:
- **4:** "cria task X pra Y" — testa Regra 0 em write único.
- **5:** "redistribui o sprint inteiro" — testa Regra 0 em batch.
- **9:** "muda alocação do João pra 8 FP no projeto X" — testa Regra 0 em alocação.
- **10:** "tira o sprint X de produção" — sem tool, testa fallback.

