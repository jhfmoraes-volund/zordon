# PRD — Vitoria Agentic Planning (superfície de ação completa)

> Status: `backlog/` — Rito 1 (Intake) ainda NÃO rodou. `prd.json` em `scripts/ralph/features/vitoria-agentic-planning/prd.json`.
> Origem: calibração real da Vitoria na surface `release_planning` via daemon, 2026-06-21 (capture e853c860 + achados de toolset).

---

## 1. Problema

A inteligência da Vitoria em planning é forte — ela lê contexto, aterra (NÃO alucina), segue convenção quando instruída. O **gargalo é a superfície de ação**: o que ela consegue _fazer_ no board é menor do que o que ela consegue _entender_. Três problemas concretos, todos confirmados lendo `src/lib/agent/agents/vitoria/tools.ts` + `src/lib/agent/tools-registry.ts`:

1. **Não cria nem edita Sprint.** Ela só lê (`list_project_sprints`). Em planning multi-sprint (visão "Planning = planner geral", memory `project_planning_as_general_planner`) ela precisa pedir ao PM pra abrir cada sprint na mão antes de poder distribuir trabalho. O `move` (`propose_task_action type=move`) exige um `targetSprintId` que talvez ainda não exista.
2. **Edição de tasks em escala é 1-a-1.** `propose_task_action(type=update)` muta uma task por chamada. Reordenar/repriorizar PFV ou status de 20 tasks = 20 tool calls = 20 round-trips, estourando o orçamento de output de um turno (um turno medido gerou 30k tokens out / 346s). Não há bulk-update.
3. **Não comenta em task e Granola fica fora da surface.** Não existe tool de comentário, embora a tabela `TaskComment` (`body`/`authorMemberId`/`mentionedMemberIds`/`taskId`, soft-delete) já exista no schema. E `read_transcript_content` (leitura curada de Granola/transcript) só está no toolset de PM Review (`VITORIA_PMREVIEW_TOOLS`) — em planning ela só lê transcript se ele for um `ContextSource`, perdendo o áudio curado como insumo de planejamento.

Efeito composto: a visão do dono ("Vitoria vira a interface principal e inteligente de planning — usando áudios do Granola curados + mais contexto pra ir mudando a sprint (PFV, status, comentários), criando e atualizando continuamente") não é alcançável com o toolset atual.

## 2. Solução em uma frase

Fechar a lacuna de ação da Vitoria em planning: dar a ela sprint-CRUD (criar/editar), bulk-update de tasks, comentário em task (reusando `TaskComment`) e Granola curado (`read_transcript_content`) na surface `release_planning` — tudo dentro do modelo de mutação existente (staging-proposal aplicado pelo PM), espelhado nos dois repos.

## 3. Não-objetivos

- **Stories (#6).** A visão de geração/refino de UserStory pela Vitoria tem PRD próprio (`prd-vitoria-story-vision`). Aqui só tocamos task/sprint/comentário/transcript. `propose_story` (que já existe) não muda.
- **Fast-apply lane / auto-aplicação sem PM.** O human-in-loop (PM aplica o staging ao Concluir) permanece. Uma lane de aplicação direta pra ops de baixíssimo risco é **fase ≥2** (ver D1) — fora deste PRD.
- **Subagentes (Claude `Task` tool) na Fase 1.** O daemon bloqueia `Task`/`Read`/`Grep` por design (`disallowedTools` em `scripts/daemon/exec-chat-turn.ts`). Fan-out via subagente fica como fase ≥2 (ver D5 + §14). Fase 1 ataca escala via querying estruturado + compaction já existentes.
- **Mutação de config/datas do projeto (`Project.startDate`/`endDate`) por LLM.** Decisão D8: fica admin-only (UI), fora do toolset da Vitoria. Não entra na Fase 1.
- **PRD↔sprint board.** Saiu da surface em 2026-06-19 (a planning lê PRDs e produz tasks). Não reabrir.

## 4. Personas e jornada

- **PM (humano, ex.: Vitória/João).** _"Eu quero descrever a sprint em voz alta no Granola e ver a Vitoria já abrir a Sprint N+1, distribuir as tasks com PFV, e me deixar só revisar e aplicar — não quero abrir sprint na mão nem mexer task por task."_
- **Vitoria (agente PM).** _"Eu entendo o que precisa acontecer — leio o transcript curado, vejo a capacidade, sei a ordem. Mas hoje eu travo: não consigo criar a sprint que preciso, nem repriorizar 15 tasks de uma vez, nem deixar um comentário pra explicar uma decisão na própria task."_
- **Builder (consome o board).** _"Quando a planning fecha, eu quero ver a task na sprint certa, com PFV e um comentário da Vitoria explicando o porquê — não um board vazio que o PM ainda vai arrumar depois."_

## 5. Decisões fixadas

| Dn | Decisão | Por quê |
|----|---------|---------|
| **D1** | Mantém o modelo **staging-proposal** (`MeetingTaskAction` → PM aplica ao Concluir) como default pra mutação de **task**. Fast-apply lane pra ops de baixo risco (move/status) é fase ≥2, fora deste PRD. | Human-in-loop é o invariante de confiança atual (`task-action-executor.ts`). Não quebrar antes de ter telemetria de qualidade (`AgentProposalOutcome`). |
| **D2** | Toda tool nova de escrita injeta `projectId`/`planningId` via **closure no tool router** (`buildVitoriaTools(planningId, projectId)`), nunca como arg do modelo. | Espelha `propose_task_action`/`propose_story`. Expor projectId ao modelo era footgun (FK violation / projeto errado) — comentado no próprio schema atual. |
| **D3** | Toda tool nova é **espelhada nos DOIS repos**: monorepo `src/lib/agent` (com `execute` real) + `zordon-daemon/src/lib/agent` (schema-stub sem `execute`, registrado nas mesmas `VITORIA_*_NAMES` arrays + surface sets). | Daemon anuncia o schema da própria cópia e proxia execução pro tool router do app (memory `project_daemon_tool_advertisement`). Drift = modelo vê schema errado. |
| **D4** | Granola entra na surface planning via **`read_transcript_content`** (mesma tool curada do PM Review), paginada por `offset` — NÃO despejo cru. | Anti-bloat (memory `project_structured_context_sources`): leitura em janela, modelo extrai antes de propor. Reusa a tool existente, não cria nova lógica de leitura. |
| **D5** | Escala de planning longa: **(1)** compaction já existente (`AgentSession.turnsSinceCompact`/`lastSummary`); **(2)** decompor lotes grandes via `describe_structured_source`/`query_structured_source` (querying SQL, não leitura crua) ANTES de cogitar subagente. Subagente = fase ≥2. | Daemon hoje bloqueia `Task`/`Read`/`Grep`. Reabrir isso é mudança de arquitetura do daemon, não de toolset. Ataca-se primeiro o que cabe no toolset. |
| **D6** | **Sprint create/update** NÃO usa o staging `MeetingTaskAction` (cujo `type` CHECK é `IN ('create','update','delete','move','review')` e é task-scoped, ver migration `20260427_meetings_daily_super_planning.sql`). Vira **write direto** ao confirmar em chat — espelhando `propose_story`, que cria a story NA HORA (live no board) enquanto as tasks ficam staged. | Adicionar `type='sprint_*'` ao CHECK quebraria o executor (`ORDER` map, guards D4) e o contrato do apply. Sprint é container, não item — mesma semântica de `propose_story` (live container, staged items). |
| **D7** | **Comentário** reusa a tabela `TaskComment` existente (write direto, `authorMemberId` = membro do thread, `body` + `mentionedMemberIds`). Sem nova entidade, sem staging. | Tabela já existe e modela exatamente isto. Comentário é anotação de baixo risco, não muta o estado planejável da task (PFV/status/sprint) — não precisa do staging do D1. |
| **D8** | **Datas/config do projeto (`Project.startDate`/`endDate`)** ficam admin-only (UI). NENHUMA tool de mutação de projeto entra no toolset da Vitoria. | Mutação de janela do projeto é decisão comercial, não de planning. Risco alto, frequência baixa — não vale o footgun. |
| **D9** | **Bulk-update** é UM `propose_task_action`-equivalente em lote: tool `propose_task_bulk_update` que recebe `updates: [{ taskId, patch }]` e cria N `MeetingTaskAction(type='update')` numa inserção (espelha `propose_tasks`). NÃO muda o executor (cada row continua um update individual no apply). | Reusa o caminho de apply já validado (`writeUpdate`). O ganho é no write (1 tool call → N rows) e no orçamento de output do turno, não na semântica de apply. |
| **D10** | **`acceptanceCriteria` vira campo opcional** em cada linha de `propose_tasks`. O executor já lê `payload.acceptanceCriteria` via `coerceAcTexts` — só falta expor no schema do batch. Continua opcional (backfill/kickoff dispensam SDD; create prospectivo single segue exigindo via `propose_task_action`). | Fecha o gap da capture e853c860 (batch não tinha AC) sem endurecer o batch — manter a assimetria intencional (single = cerimônia dura; batch = forma + integridade). |
| **D11** | **Convenção de título** (sprints "Sprint N", memory `feedback_sprint_naming`) é instruída no **system prompt** da surface planning, não enforçada por schema. | Schema strictness > prompt strictness só vale pra invariantes de integridade; naming é convenção mole, e o prompt já é onde a Vitoria recebe convenções. Default ao criar via tool = "Sprint N" auto-numerado. |
| **D12** | Todo write novo que cria/muta entidade da IA grava **procedência**: sprint create cita a(s) nota(s)/transcript de origem no `goal` ou num `add_context_note`; comentário cita a fonte no `body`; bulk-update exige `sourceNoteIds` (≥1) como o single. | Invariante anti-alucinação do projeto (memory `feedback_grounded_no_hallucination`): conteúdo gerado por LLM sempre rastreia a fonte. |

## 6. Arquitetura

```
                 ┌─────────────────────────── zordon-daemon (Mac do João) ──────────────────────────┐
  PM no chat ──▶ │  exec-chat-turn.ts                                                                │
  (surface=      │   allowedTools = getToolNamesForAgent("vitoria","release_planning")               │
   release_      │                   .map(n => `mcp__zordon__${n}`)                                   │
   planning)     │   disallowedTools = [Task, Read, Grep, …]  (subagente bloqueado — D5)              │
                 │   mcpServers.zordon → mcp-server (lê SÓ .inputSchema dos stubs)                    │
                 │                                                                                    │
                 │   tools-registry.ts (STUBS, sem execute)                                           │
                 │     VITORIA_RELEASE_PLANNING_TOOLS ⊃ { …shared_read, propose_*,                    │
                 │       + propose_sprint, update_sprint, propose_task_bulk_update,                   │
                 │       + add_task_comment, read_transcript_content }                                │
                 │     agents/vitoria/tools.ts → buildVitoriaTools() stubs                            │
                 └────────────────────────────────────┬───────────────────────────────────────────-─┘
                                                       │ HTTP (execução proxiada)
                                                       ▼
                 ┌──────────────────────── monorepo (app — execução real) ───────────────────────────┐
                 │  /api/agents/tools/<name>  → TOOL_REGISTRY[name](ctx)                              │
                 │  src/lib/agent/tools-registry.ts                                                   │
                 │    VITORIA_RELEASE_PLANNING_TOOLS (mesmo set + as 5 novas)                          │
                 │  src/lib/agent/agents/vitoria/tools.ts  (buildVitoriaTools — execute real)         │
                 │    propose_sprint ─────────▶ INSERT Sprint (live, D6)                              │
                 │    update_sprint ──────────▶ UPDATE Sprint (live, D6)                              │
                 │    propose_task_bulk_update ▶ INSERT N×MeetingTaskAction(type=update) (staged, D9) │
                 │    add_task_comment ───────▶ INSERT TaskComment (live, D7)                         │
                 │    propose_tasks (+ AC opcional, D10)                                              │
                 │    read_transcript_content (rebind p/ planning sem pmReviewId, D4)                 │
                 │                                                                                    │
                 │  Apply (PM Conclui): applyPendingActionsForPlanning → task-action-executor.ts      │
                 │    (inalterado — bulk-update vira N writeUpdate)                                    │
                 └────────────────────────────────────────────────────────────────────────────────-─┘
```

Cada caixa nova = uma factory em `buildVitoriaTools` (app) + um stub em `buildVitoriaTools` (daemon) + uma entrada nos sets de surface dos DOIS `tools-registry.ts`.

## 7. Schema

**Nenhuma migration de tabela nova.** A Fase 1 reusa o schema existente. Detalhamento por tool:

- **`propose_sprint` / `update_sprint`** → `INSERT`/`UPDATE` em `Sprint` (`name`, `startDate`, `endDate`, `goal`, `status`, `projectId`). Já tem `Sprint_projectId_fkey` e RLS via policies de projeto existentes. CHECK de semana (seg→dom, memory `project_sprint_week_model`) já vive no DB — `propose_sprint` deriva datas via `src/lib/sprint-dates.ts` (`getNextSprintDefaults`) pra nunca violar.
- **`propose_task_bulk_update`** → N× `INSERT MeetingTaskAction` (`type='update'`, `decision='pending'`, `execution='pending'`, `source='ai'`, `projectId`/`planningCeremonyId` do closure). Nenhuma coluna nova — `payload` (jsonb) carrega o patch por task. CHECK `type IN (...)` já admite `'update'`.
- **`add_task_comment`** → `INSERT TaskComment` (`taskId`, `body`, `authorMemberId` = `ctx.memberId`, `mentionedMemberIds` default `[]`). Tabela e RLS já existem.
- **`acceptanceCriteria` no `propose_tasks`** → zero schema; só amplia o Zod do array `tasks` (campo opcional). `coerceAcTexts` no executor já materializa em `AcceptanceCriterion`.

> Se a auditoria de RLS (Rito 1) achar que `Sprint` não tem policy de INSERT/UPDATE adequada pro `service_role`/membro do thread, a migration atômica correspondente entra como story extra. Hoje o daemon roda `service_role` (memory `project_daemon_v1_v2`), então o write passa; a RLS é defesa pra quando o daemon v2 usar token de usuário. **Open question OQ-1 (§14).**

## 8. APIs

Não há endpoints HTTP novos de produto — as tools são executadas via o tool router genérico já existente: `POST /api/agents/tools/<name>` (resolve `ctx` do `chatTurnId` e roda `TOOL_REGISTRY[name](ctx).execute(args)`). O contrato é o protocolo MCP/tool, não REST. Para referência, as 5 capacidades novas:

| Tool (MCP) | Args (do modelo) | Efeito | Modelo de mutação |
|------------|------------------|--------|-------------------|
| `propose_sprint` | `{ name?, startDate?, endDate?, goal? }` | INSERT Sprint (datas auto via sprint-dates se omitidas) | **live** (D6) — retorna `{ sprintId, name }` |
| `update_sprint` | `{ sprintId, name?, startDate?, endDate?, goal?, status? }` | UPDATE Sprint | **live** (D6) |
| `propose_task_bulk_update` | `{ updates: [{ taskId, patch }], reasoning, sourceNoteIds[], aiConfidence? }` | N× INSERT MeetingTaskAction(type=update) | **staged** (D9) — retorna `{ created, errors[] }` |
| `add_task_comment` | `{ taskId, body, mentionedMemberIds? }` | INSERT TaskComment | **live** (D7) |
| `read_transcript_content` | `{ transcriptRefId, offset? }` | leitura paginada de transcript curado | read-only (D4) |
| `propose_tasks` (alterada) | linha agora aceita `acceptanceCriteria?: string[]` | — | staged (inalterado) |

Todas resolvem `projectId`/`planningId`/`memberId` do `ctx` (D2). Async não se aplica (tools são síncronas sob 1s; leitura de transcript pagina, não bloqueia).

## 9. UX

A surface é o chat de planning (`release_planning`) já existente — sem telas novas. Wireframe do fluxo-alvo:

```
┌─ Chat: Planning (Projeto X) ───────────────────────────────────────────────┐
│ PM:  "ouvi o granola de hoje, abre a Sprint 12 e joga o backlog de cobrança │
│       lá com PFV; comenta na VLD-204 que o cliente mudou o escopo"          │
│                                                                             │
│ Vitoria: [read_transcript_content tref_abc offset=0]  ← lê Granola curado   │
│          [propose_sprint name="Sprint 12"]            → Sprint criada (live)│
│          [propose_task_bulk_update 8 tasks → Sprint 12] → 8 propostas       │
│          [add_task_comment VLD-204 "cliente mudou escopo: …"] (live)        │
│                                                                             │
│  ┌─ Staging (8 propostas pendentes) ──────────────────────────────────┐    │
│  │ ⤷ mover/atualizar 8 tasks → Sprint 12                               │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│  [ Concluir planning ]  ← PM aplica o staging (D1)                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

Sprints criadas e comentários aparecem ao vivo no board (não esperam o Concluir); bulk-updates ficam no staging riscado até o PM aplicar — exatamente o padrão `propose_story` (live) vs `propose_task_action` (staged).

## 10. Integrações

- **Daemon (`zordon-daemon`):** toda tool nova precisa do stub espelhado + entrada no set de surface (D3). Reiniciar o daemon após o mirror (ele carrega o registry no boot).
- **PM Review:** `read_transcript_content` passa a ser compartilhada entre PM Review e Planning. O rebind (D4) não pode quebrar o PM Review — a factory deve resolver `pmReviewId` OU `planningId`/`projectId`.
- **Planning Vivo / `propose_story`:** sprints live + comentários live convivem com o staging de tasks; o anti-duplicador do executor não é afetado (sprint não passa pelo executor).
- **Métricas (`AgentProposalOutcome`):** bulk-update gera N rows → N outcomes no apply (já coberto por `recordProposalOutcome`). Sprint/comentário live não geram outcome (não passam pelo executor) — aceitável (são containers/anotações, não propostas de trabalho).

## 11. Faseamento

- **Fase 1 (este PRD):** sprint create/update (live), bulk-update de tasks (staged), comentário (live), AC opcional no batch, Granola na surface planning. Entrega **mais** que o sistema atual: hoje a Vitoria não faz nenhuma dessas. Roda em paralelo — nenhuma capacidade existente é removida.
- **Fase 2 (≥2, fora deste PRD):** fast-apply lane (D1); subagente/fan-out reabrindo `Task` no daemon (D5); mutação de datas de projeto se a operação provar valor (D8).
- **Fase 3 (≥3):** loop de aprendizado (planning versionada, memory `project_planning_versioned_living`) consumindo os outcomes das novas tools.

## 12. Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Drift de schema entre app e daemon (stub desatualizado) | Médio | Médio | D3 + o tool router faz `safeParse` na execução (rede de segurança já existente). Story de mirror sempre toca os 4 arquivos (2 tools.ts + 2 tools-registry.ts). |
| `read_transcript_content` rebind quebra PM Review | Médio | Alto | Factory resolve `pmReviewId ?? planningId` (não troca a assinatura do PM Review). Verifiable de typecheck + check de que `VITORIA_PMREVIEW_TOOLS` ainda contém a tool. |
| Sprint live cria lixo (Vitoria abre sprint errada e não há staging pra reverter) | Médio | Médio | D11 (naming auto "Sprint N") + D12 (procedência no `goal`) + `update_sprint` permite corrigir. PM vê a sprint ao vivo e pode editar/excluir na UI. |
| Bulk-update muta task congelada (D4 do executor) | Baixo | Baixo | Nenhuma mitigação nova: o guard `FROZEN_STATUSES` do `task-action-executor.ts` já pula `in_progress/review/done` no apply. Bulk-update reusa o mesmo apply. |
| Comentário live sem rate-limit (Vitoria spammando) | Baixo | Baixo | Comentário só por instrução explícita do PM (prompt); `add_task_comment` não é chamada em loop autônomo. Monitorar via `TaskComment.authorMemberId`. |
| Output do turno ainda estoura mesmo com bulk-update | Baixo | Médio | D5: compaction + querying estruturado. Bulk-update já corta o nº de tool calls em ~N×. |

## 13. Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Vitoria cria ≥1 sprint por planning sem PM abrir na mão | `SELECT count(*) FROM "Sprint" WHERE "createdAt" > <planning.start> AND "projectId"=<p>` correlacionado ao thread; ou flag `createdByAgent` se adicionada (story opcional) |
| Bulk-update reduz tool calls/turno | `AgentUsage` (memory `project_zordon_ops_pipeline`/telemetria `20260529_agent_usage_telemetry.sql`): tokens-out e nº de tool calls por `chatTurnId` antes/depois |
| Comentários da Vitoria aplicados | `SELECT count(*) FROM "TaskComment" WHERE "authorMemberId"=<vitoria_member> AND "createdAt" > <date>` |
| AC presente em tasks de batch | `SELECT count(*) FROM "AcceptanceCriterion" ac JOIN "Task" t ON t.id=ac."taskId" WHERE t."createdByAgent" AND t."createdAt" > <date>` |
| Outcomes de bulk-update | `SELECT decision, count(*) FROM "AgentProposalOutcome" WHERE "agentName"='vitoria' AND "callKind"='turn' GROUP BY decision` |

## 14. Open questions

- **OQ-1 (resolve Fase 1, no Rito 1):** RLS de `Sprint` cobre INSERT/UPDATE pelo membro do thread (não só `service_role`)? Se não, vira migration atômica extra. Hoje daemon = `service_role` então não bloqueia; é dívida pro daemon v2. _Não-bloqueante pra Fase 1._
- **OQ-2 (Fase ≥2):** comentário deve virar `add_context_note` + `TaskComment` (duplo registro pra rastrear na planning) ou só `TaskComment`? Decidido D7 = só `TaskComment` por ora; revisitar se a planning versionada precisar do comentário na sua timeline.

## 15. Referências

- Toolset atual: `src/lib/agent/agents/vitoria/tools.ts`, `src/lib/agent/tools-registry.ts` (`VITORIA_RELEASE_PLANNING_TOOLS`, `getToolNamesForAgent`).
- Executor de staging: `src/lib/meetings/task-action-executor.ts` (`applyPendingActionsForPlanning`, `writeUpdate`, `coerceAcTexts`, `FROZEN_STATUSES`).
- Daemon mirror: `zordon-daemon/src/lib/agent/agents/vitoria/tools.ts` (stubs), `zordon-daemon/src/lib/agent/tools-registry.ts`, `zordon-daemon/scripts/daemon/exec-chat-turn.ts` (allowed/disallowedTools).
- PM Review transcript tool: `src/lib/agent/agents/vitoria/pm-review.ts` (`read_transcript_content`).
- Sprint dates: `src/lib/sprint-dates.ts`. Sprint CHECK: `supabase/migrations/20260427_meetings_daily_super_planning.sql`.
- Memories: `project_daemon_tool_advertisement`, `project_planning_as_general_planner`, `project_vitoria_daemon_surfaces`, `feedback_sprint_naming`, `feedback_grounded_no_hallucination`, `project_structured_context_sources`.

## 16. Stories implementáveis

```yaml
- id: VAP-001
  title: AC opcional no propose_tasks (batch)
  description: >
    Adiciona `acceptanceCriteria?: string[]` em cada linha do array `tasks` do
    schema de `propose_tasks` (app). O executor já lê `payload.acceptanceCriteria`
    via coerceAcTexts — só passa o campo pro payload da row. Espelha o stub no daemon.
  acceptanceCriteria:
    - "Schema Zod de `tasks[]` em src/lib/agent/agents/vitoria/tools.ts aceita acceptanceCriteria opcional (z.array(z.string()).optional())"
    - "execute de propose_tasks inclui acceptanceCriteria no payload da row quando presente"
    - "Stub do daemon (zordon-daemon/src/lib/agent/agents/vitoria/tools.ts) tem o mesmo campo opcional"
    - "tsc passa nos dois repos"
  verifiable:
    - kind: lint
      command_or_query: "grep -c 'acceptanceCriteria' src/lib/agent/agents/vitoria/tools.ts"
      expected: ">=2"
    - kind: lint
      command_or_query: "grep -c 'acceptanceCriteria' /Users/joaomoraes/projetos-ai-dev/Perke/perke/zordon-daemon/src/lib/agent/agents/vitoria/tools.ts"
      expected: ">=1"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'vitoria/tools' || echo no-errors"
      expected: "no-errors"
  dependsOn: []
  estimateMinutes: 20
  touches:
    - src/lib/agent/agents/vitoria/tools.ts
    - ../zordon-daemon/src/lib/agent/agents/vitoria/tools.ts

- id: VAP-002
  title: read_transcript_content na surface release_planning
  description: >
    Rebind de read_transcript_content pra funcionar sem pmReviewId (resolve
    pmReviewId ?? planningId/projectId) e adiciona-a ao set VITORIA_RELEASE_PLANNING_TOOLS
    nos DOIS tools-registry.ts. Não pode remover a tool do PM Review.
  acceptanceCriteria:
    - "read_transcript_content aparece em VITORIA_RELEASE_PLANNING_TOOLS em src/lib/agent/tools-registry.ts"
    - "Continua presente em VITORIA_PMREVIEW_TOOLS (não removida)"
    - "A factory do registry resolve a tool sem exigir pmReviewId quando surface=release_planning (usa planningId/projectId)"
    - "Mesma adição no set do zordon-daemon/src/lib/agent/tools-registry.ts"
    - "tsc passa nos dois repos"
  verifiable:
    - kind: lint
      command_or_query: "awk '/VITORIA_RELEASE_PLANNING_TOOLS = new Set/,/\\]\\)/' src/lib/agent/tools-registry.ts | grep -c read_transcript_content"
      expected: ">=1"
    - kind: lint
      command_or_query: "awk '/VITORIA_PMREVIEW_TOOLS = new Set/,/\\]\\)/' src/lib/agent/tools-registry.ts | grep -c read_transcript_content"
      expected: ">=1"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'tools-registry' || echo no-errors"
      expected: "no-errors"
  dependsOn: []
  estimateMinutes: 25
  touches:
    - src/lib/agent/tools-registry.ts
    - src/lib/agent/agents/vitoria/pm-review.ts
    - ../zordon-daemon/src/lib/agent/tools-registry.ts

- id: VAP-003
  title: add_task_comment (TaskComment, write direto)
  description: >
    Tool nova em buildVitoriaTools: INSERT em TaskComment (taskId, body,
    authorMemberId=ctx.memberId, mentionedMemberIds default []). Valida que a task
    pertence ao projeto. Write direto (D7). Stub espelhado no daemon. Registrada
    nos sets de planning + release_planning dos dois registries. memberId precisa
    ser threadado pro closure (buildVitoriaTools ganha memberId opcional).
  acceptanceCriteria:
    - "buildVitoriaTools expõe add_task_comment que insere em TaskComment"
    - "Valida task.projectId === projectId antes de inserir (rejeita cross-project)"
    - "add_task_comment está em VITORIA_PLANNING_TOOLS e VITORIA_RELEASE_PLANNING_TOOLS nos dois registries"
    - "Stub correspondente existe no daemon"
    - "tsc passa nos dois repos"
  verifiable:
    - kind: lint
      command_or_query: "grep -c 'add_task_comment' src/lib/agent/agents/vitoria/tools.ts"
      expected: ">=1"
    - kind: lint
      command_or_query: "grep -c 'add_task_comment' src/lib/agent/tools-registry.ts"
      expected: ">=2"
    - kind: lint
      command_or_query: "grep -c 'add_task_comment' /Users/joaomoraes/projetos-ai-dev/Perke/perke/zordon-daemon/src/lib/agent/agents/vitoria/tools.ts"
      expected: ">=1"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'vitoria/tools|tools-registry' || echo no-errors"
      expected: "no-errors"
  dependsOn: []
  estimateMinutes: 30
  touches:
    - src/lib/agent/agents/vitoria/tools.ts
    - src/lib/agent/tools-registry.ts
    - ../zordon-daemon/src/lib/agent/agents/vitoria/tools.ts
    - ../zordon-daemon/src/lib/agent/tools-registry.ts

- id: VAP-004
  title: propose_task_bulk_update (N×MeetingTaskAction type=update)
  description: >
    Tool nova: recebe updates:[{taskId, patch}], reasoning, sourceNoteIds(>=1),
    aiConfidence. Valida cada linha (taskId existe no projeto, patch não-vazio) e
    insere N MeetingTaskAction(type='update', decision/execution=pending, source=ai)
    numa inserção. Devolve {created, errors:[{index,msg}]}. Reusa o caminho de apply
    existente (D9). Stub no daemon. Registrada nos sets de planning + release_planning.
  acceptanceCriteria:
    - "buildVitoriaTools expõe propose_task_bulk_update"
    - "Insere uma MeetingTaskAction(type=update) por linha de updates[] com payload=patch"
    - "Exige sourceNoteIds >=1 (espelha propose_task_action) e reasoning"
    - "Retorna {created, errors} com validação por-index (taskId inexistente vira erro na linha)"
    - "Presente em VITORIA_PLANNING_TOOLS + VITORIA_RELEASE_PLANNING_TOOLS nos dois registries; stub no daemon"
    - "tsc passa nos dois repos"
  verifiable:
    - kind: lint
      command_or_query: "grep -c 'propose_task_bulk_update' src/lib/agent/agents/vitoria/tools.ts"
      expected: ">=1"
    - kind: lint
      command_or_query: "grep -c 'propose_task_bulk_update' src/lib/agent/tools-registry.ts"
      expected: ">=2"
    - kind: lint
      command_or_query: "grep -c 'propose_task_bulk_update' /Users/joaomoraes/projetos-ai-dev/Perke/perke/zordon-daemon/src/lib/agent/agents/vitoria/tools.ts"
      expected: ">=1"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'vitoria/tools|tools-registry' || echo no-errors"
      expected: "no-errors"
  dependsOn: []
  estimateMinutes: 30
  touches:
    - src/lib/agent/agents/vitoria/tools.ts
    - src/lib/agent/tools-registry.ts
    - ../zordon-daemon/src/lib/agent/agents/vitoria/tools.ts
    - ../zordon-daemon/src/lib/agent/tools-registry.ts

- id: VAP-005
  title: propose_sprint (INSERT Sprint live)
  description: >
    Tool nova: cria Sprint (live, D6). Args {name?, startDate?, endDate?, goal?}.
    Se datas omitidas, deriva via src/lib/sprint-dates.ts getNextSprintDefaults
    (seg->dom). Se name omitido, auto-numera "Sprint N" (D11). status default
    'planned'. Retorna {sprintId, name}. Grava procedência no goal quando relevante (D12).
    Stub no daemon. Registrada nos sets de planning + release_planning.
  acceptanceCriteria:
    - "buildVitoriaTools expõe propose_sprint que faz INSERT em Sprint"
    - "Datas omitidas são derivadas via getNextSprintDefaults (não viola CHECK seg->dom)"
    - "name omitido auto-numera 'Sprint N'"
    - "Retorna {sprintId, name}; write é live (não cria MeetingTaskAction)"
    - "Presente nos dois sets dos dois registries; stub no daemon"
    - "tsc passa nos dois repos"
  verifiable:
    - kind: lint
      command_or_query: "grep -cE 'propose_sprint|getNextSprintDefaults' src/lib/agent/agents/vitoria/tools.ts"
      expected: ">=2"
    - kind: lint
      command_or_query: "grep -c 'propose_sprint' /Users/joaomoraes/projetos-ai-dev/Perke/perke/zordon-daemon/src/lib/agent/agents/vitoria/tools.ts"
      expected: ">=1"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'vitoria/tools|tools-registry' || echo no-errors"
      expected: "no-errors"
  dependsOn: []
  estimateMinutes: 30
  touches:
    - src/lib/agent/agents/vitoria/tools.ts
    - src/lib/agent/tools-registry.ts
    - ../zordon-daemon/src/lib/agent/agents/vitoria/tools.ts
    - ../zordon-daemon/src/lib/agent/tools-registry.ts

- id: VAP-006
  title: update_sprint (UPDATE Sprint live)
  description: >
    Tool nova: edita Sprint existente (live, D6). Args {sprintId, name?, startDate?,
    endDate?, goal?, status?}. Valida sprint.projectId === projectId. Merge shallow:
    só campos passados. Retorna {sprintId, fieldsUpdated}. Stub no daemon. Registrada
    nos sets de planning + release_planning dos dois registries.
  acceptanceCriteria:
    - "buildVitoriaTools expõe update_sprint que faz UPDATE em Sprint"
    - "Valida sprint pertence ao projeto (rejeita cross-project)"
    - "Atualiza só os campos passados (merge shallow), seta updatedAt"
    - "Presente nos dois sets dos dois registries; stub no daemon"
    - "tsc passa nos dois repos"
  verifiable:
    - kind: lint
      command_or_query: "grep -c 'update_sprint' src/lib/agent/agents/vitoria/tools.ts"
      expected: ">=1"
    - kind: lint
      command_or_query: "grep -c 'update_sprint' src/lib/agent/tools-registry.ts"
      expected: ">=2"
    - kind: lint
      command_or_query: "grep -c 'update_sprint' /Users/joaomoraes/projetos-ai-dev/Perke/perke/zordon-daemon/src/lib/agent/agents/vitoria/tools.ts"
      expected: ">=1"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'vitoria/tools|tools-registry' || echo no-errors"
      expected: "no-errors"
  dependsOn:
    - VAP-005
  estimateMinutes: 25
  touches:
    - src/lib/agent/agents/vitoria/tools.ts
    - src/lib/agent/tools-registry.ts
    - ../zordon-daemon/src/lib/agent/agents/vitoria/tools.ts
    - ../zordon-daemon/src/lib/agent/tools-registry.ts

- id: VAP-007
  title: Convenção de naming + novas tools no prompt de release_planning
  description: >
    Atualiza buildReleasePlanningPrompt (src/lib/agent/agents/vitoria/release-planning.ts)
    instruindo: (a) sprints nomeadas "Sprint N" via propose_sprint (D11); (b) ler
    Granola curado via read_transcript_content antes de propor (D4); (c) gravar
    procedência (nota/transcript) em writes live de sprint/comentário (D12); (d)
    preferir propose_task_bulk_update a N× propose_task_action. O prompt é build
    app-side (prepare-turn proxia pro daemon), então NÃO há cópia no daemon — só
    este arquivo muda.
  acceptanceCriteria:
    - "buildReleasePlanningPrompt menciona a convenção 'Sprint N' e propose_sprint"
    - "Menciona read_transcript_content como insumo de planning"
    - "Menciona propose_task_bulk_update pra edição em escala e gravar procedência"
    - "tsc/build passa"
  verifiable:
    - kind: lint
      command_or_query: "grep -cE 'Sprint N|propose_sprint|read_transcript_content|propose_task_bulk_update' src/lib/agent/agents/vitoria/release-planning.ts"
      expected: ">=3"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'agents/vitoria/release-planning' || echo no-errors"
      expected: "no-errors"
  dependsOn:
    - VAP-002
    - VAP-004
    - VAP-005
  estimateMinutes: 20
  touches:
    - src/lib/agent/agents/vitoria/release-planning.ts
```
