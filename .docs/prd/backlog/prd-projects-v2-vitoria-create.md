# PRD — projects-v2-vitoria-create

> **Feature id prefix:** `PV2V` · **Phase:** 1 (the only build of plan §7.3/§7.4 + D13)
> **Depends on:** `projects-v2-spec-authoring` (Vitor `propose_spec` + Spec-inside PRD authoring),
> `projects-v2-planning` (Sprint-Planning re-point + `ProductRequirement.sprintId` + `allocatePrdToSprint`).
> **Grounding:** [docs/features/projects-v2/projects-v2-plan.md](../../features/projects-v2/projects-v2-plan.md)
> §7.3, §7.4, **D13**. All code refs below point at live files.

---

## §1 — Problema

1. **O PM perde o fio da cerimônia pra criar um PRD.** Hoje a Vitoria, dentro de uma Sprint Planning
   (`PlanningCeremony`), só sabe `link_prd_to_sprint` / `move_prd` / `unlink_prd` e `propose_task_action`
   ([src/lib/agent/agents/vitoria/tools.ts](../../../src/lib/agent/agents/vitoria/tools.ts),
   [release-planning.ts](../../../src/lib/agent/agents/vitoria/release-planning.ts)). Quando bate uma
   lacuna ("falta um PRD pra cobrir X"), o PM tem que **sair da cerimônia**, abrir o launcher de
   Quick-Ask, falar com o Vitor, e voltar — perde contexto e trava o ritual.
2. **Não existe lineage de PRD nascido em cerimônia.** Um PRD criado fora da cerimônia não carrega
   marca de origem; não dá pra responder "quantos PRDs nasceram da Sprint Planning N?". A coluna
   `DesignSession.subKind` ([database.types.ts](../../../src/lib/supabase/database.types.ts) linha 1643)
   já existe mas ninguém usa pra esse fim.
3. **Vitoria não é autora de PRD — e não deve virar.** D7 fixa Vitor como **único** autor de PRD
   (grounding + quality gates centralizados). Hoje não há mecanismo pra Vitoria *orquestrar* Vitor sem
   ela mesma escrever, então a única saída seria duplicar a lógica de autoria nela — exatamente o que
   D7 proíbe.

## §2 — Solução em uma frase

Vitoria ganha **uma** capacidade de orquestração — `ensure_sprint_prd_session` + convocar o Vitor em
**background** numa `DesignSession` de `subKind='vitoria_ask'` por cerimônia — que cria o PRD **sem
trocar o chat/tela do PM**, anuncia a convocação de forma explícita, e ao aprovar aloca o PRD na sprint
da cerimônia.

## §3 — Não-objetivos

- **Vitoria NÃO autora PRD.** Ela só provisiona a session, convoca o Vitor e aloca. A autoria
  (`propose_prd`/`propose_spec`/`update_prd`/`approve_prd`) é do Vitor (D7/D14).
- **Sem nova UI de autoria.** A `vitoria_ask` renderiza idêntica a `prd_session` (D11/D15). Nenhum
  componente de chat/tela novo.
- **Sem migration de schema.** `subKind` e `EntityLink.planningCeremonyId` já existem.
- **Sem deep-link / troca de tela.** D13 resolve a favor de background summon, não navegação.
- **Não toca Release Planning** (multi-sprint; já planeja PRD→sprint). Escopo aqui é a Sprint Planning
  (single-sprint, `PlanningCeremony`).
- **Não constrói `+ New PRD` (board) nem `Decompose` (Spec) como UI** — esses *hosts* vêm de
  `projects-v2-area`. Aqui só garantimos o **roteamento** desses gatilhos pra autoria do Vitor.

## §4 — Personas e jornada

- **PM (admin-piloto, João):** *"Tô no meio da Sprint Planning, percebi que falta um PRD pra cobrir o
  rate-limit. Não quero abrir outra tela — quero pedir pra Vitoria e continuar conversando. Mas preciso
  **saber** que o Vitor entrou e onde o PRD vai aparecer."*
- **Vitoria (orquestradora):** *"Não escrevo PRD. Eu abro a porta: garanto a session da cerimônia,
  anuncio que estou convocando o Vitor em background, e quando ele aprova eu prendo o PRD na sprint."*
- **Vitor (autor, convocado):** *"Recebo o brief na session `vitoria_ask`, fundo no repo, varro PRDs/
  Specs existentes (dedup), crio dentro de uma Spec, e o PRD aparece na árvore da sprint."*

## §5 — Decisões fixadas

| # | Decisão | Valor | Por quê |
|---|---------|-------|---------|
| D1 | Marca da session | `DesignSession.subKind = 'vitoria_ask'` (coluna já existe) | Lineage + query-as-set sem migration |
| D2 | Granularidade | **1 session por cerimônia** (não por PRD); lazy create, reuso em todos os gap-fills | `PlanningCeremony` é UNIQUE por sprint; evita explosão de sessions |
| D3 | Link cerimônia↔session | `EntityLink.planningCeremonyId` + `EntityLink.designSessionId` numa única row | FK já existe; sem tabela nova |
| D4 | Vitoria NÃO autora | Vitoria só `ensure_sprint_prd_session` + summon + allocate | D7 (Vitor é o único autor) |
| D5 | Background summon | Vitoria invoca Vitor server-side via helper `summonVitorHeadless` (`runAgent` + **drain do stream** até o fim — padrão `runAlphaIngestHeadless` em [granola-auto-import.ts](../../../src/lib/granola-auto-import.ts)), disparado por **`after()`** do Next 16 dentro da própria tool da Vitoria — fire-and-forget, **sem** trocar chat/tela do PM | `runAgent` retorna stream **dormente**: sem drain, o loop do Vitor NÃO roda e nenhum PRD é criado. O drain via `after()` roda após a resposta da Vitoria flushar — não bloqueia o turno dela e não exige job table nem processo destacado |
| D6 | Transparência obrigatória | Antes do summon, Vitoria emite **status message estruturado** + o prompt dela exige o anúncio textual | "PM sempre sabe que o Vitor está agindo" (§7.3 passo 2) |
| D7 | Reuso de `createPrdDraftSession` | Estende com `ceremonyId?` + `subKind?` (default `quick_ask`) | Mesma infra de draft/insumos; sem fork |
| D8 | Render idêntico | `vitoria_ask` usa o mesmo two-pane PRD-tree de `prd_session` | D11/D15 — nenhuma UI nova de autoria |
| D9 | Alocação na aprovação | Ao Vitor `approve_prd`, Vitoria chama **`allocatePrdToSprint`** (de `projects-v2-planning`) — que escreve `ProductRequirement.sprintId` + `deliveryStatus='todo'`. **Não** `link_prd_to_sprint` (essa escreve `PlanningSessionPRD`, mecanismo do release-planning, errado aqui) | Commit single-sprint correto; reusa a primitiva certa de `projects-v2-planning` (D1 daquele PRD) |
| D10 | Roteamento dos hosts | `+ New PRD` (board) → Vitor mini-context; `Decompose` (Spec) → Vitor decompose — ambos resolvem na **mesma** entrada de autoria do Vitor | Hosts vêm de `projects-v2-area`; aqui só o resolver |
| D11 | Idempotência | `ensure_sprint_prd_session` é provision-or-reuse (guard por `planningCeremonyId`); 2ª chamada retorna a mesma session | Evita 2 sessions por cerimônia |
| D12 | Escopo do summon | `summonVitorHeadless` usa `runAgent` ([engine.ts](../../../src/lib/agent/engine.ts)) com `agent=vitorAgent`, `params.sessionId` = a `vitoria_ask`, e **drena o stream** (`toUIMessageStreamResponse` + reader loop, igual `runAlphaIngestHeadless`) pra o loop do Vitor de fato rodar e persistir. Disparado por `after()` — sem endpoint HTTP dedicado | Único entrypoint de agente; o drain é o que faz o Vitor executar; `after()` evita bloquear a Vitoria sem job/queue novos |

## §6 — Arquitetura

```
 PM (chat da cerimônia)
   │  "Vitoria, falta um PRD pra rate-limit"
   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Vitoria  (surface=planning, src/lib/agent/agents/vitoria/*)           │
│  1. emite status message estruturado  ── announceSummon()             │
│  2. ensure_sprint_prd_session(ceremonyId)                             │
│        └─► createPrdDraftSession({ projectId, ceremonyId,             │
│                                    subKind:'vitoria_ask' })           │
│                └─► DesignSession(subKind=vitoria_ask, status=draft)   │
│                └─► EntityLink(planningCeremonyId, designSessionId)    │
│  3. summon Vitor  ── after(() => summonVitorHeadless(sessionId,brief))│
│        └─► runAgent({ agent: vitorAgent, params:{ sessionId } })      │
│            + DRAIN do stream (toUIMessageStreamResponse + reader)     │
│                └─► Vitor: propose_spec → propose_prd → approve_prd    │
│                        (ProductRequirement.designSessionId = session) │
│  4. on approve → allocatePrdToSprint(prdId, sprintId)  (de planning)  │
└──────────────────────────────────────────────────────────────────────┘
   │ (NENHUMA troca de tela do PM)
   ▼
 Árvore de PRDs da sprint  ◄── PRD novo aparece (Spec card → PRD)
```

Cada caixa = função real: `ensure_sprint_prd_session` (tool nova em vitoria/tools.ts),
`createPrdDraftSession` (estendida em [prd-session/dal.ts](../../../src/lib/sessions/prd-session/dal.ts)),
`summonVitorHeadless` (helper novo: `runAgent` + drain, padrão `runAlphaIngestHeadless`),
`runAgent` ([engine.ts](../../../src/lib/agent/engine.ts)), `allocatePrdToSprint` (de
`projects-v2-planning` — escreve `sprintId` + `deliveryStatus='todo'`). O summon é disparado por
`after()` dentro da tool da Vitoria — **sem endpoint HTTP dedicado**.

## §7 — Schema

**Sem mudança de schema — `subKind` já existe; usa `EntityLink.planningCeremonyId`.**

Verificação explícita (já confirmado no repo):

- `DesignSession.subKind: string | null` — [database.types.ts](../../../src/lib/supabase/database.types.ts)
  linha 1643 (Row), 1674/1705 (Insert/Update). Aceita `'vitoria_ask'` sem ALTER.
- `EntityLink.planningCeremonyId: string | null` + `EntityLink.designSessionId: string | null` — ambas
  na mesma row de `EntityLink` ([database.types.ts](../../../src/lib/supabase/database.types.ts) linhas
  ~150–170, FK `EntityLink_planningCeremonyId_fkey` e `EntityLink_designSessionId_fkey`). Uma única row
  liga cerimônia↔session.
- `ProductRequirement.designSessionId` (lineage PRD→session) e `ProductRequirement.sprintId` (alocação)
  são providos pelos PRDs upstream (`ProductRequirement.designSessionId` já existe;
  `ProductRequirement.sprintId` vem de `projects-v2-planning`). **Este PRD não cria coluna nenhuma.**

RLS: nenhuma policy nova. As policies existentes de `DesignSession` / `EntityLink` /
`ProductRequirement` (managers / `can_view_project`) cobrem; o gate admin do *área* V2 é na camada de app
(D1 do plano), fora do escopo deste PRD.

Lineage resultante (sem schema novo): `ProductRequirement.designSessionId → DesignSession(subKind=
'vitoria_ask') → EntityLink.designSessionId / EntityLink.planningCeremonyId → PlanningCeremony.sprintId`.

## §8 — APIs

### 8.1 Tool nova da Vitoria — `ensure_sprint_prd_session`

```ts
// src/lib/agent/agents/vitoria/tools.ts — adicionada em buildVitoriaTools(planningId, projectId)
ensure_sprint_prd_session: tool({
  description:
    "Provisiona-ou-reusa UMA DesignSession (subKind='vitoria_ask') pra esta cerimônia, " +
    "linkada via EntityLink.planningCeremonyId. NÃO autora PRD. Idempotente: 2ª chamada " +
    "retorna a mesma session. Use ANTES de convocar o Vitor.",
  inputSchema: z.object({
    ceremonyId: z.string().uuid().describe("PlanningCeremony.id (= planningId da cerimônia atual)"),
  }),
  execute: async ({ ceremonyId }): Promise<{
    sessionId: string;
    reused: boolean;       // true se já existia
    subKind: "vitoria_ask";
  }> => { /* provision-or-reuse via DAL */ },
}),
```

### 8.2 DAL estendida — `createPrdDraftSession`

```ts
// src/lib/sessions/prd-session/dal.ts — assinatura ESTENDIDA (retrocompatível)
export async function createPrdDraftSession(args: {
  projectId: string;
  actorMemberId: string;
  ceremonyId?: string;                       // NOVO — se presente, cria EntityLink(planningCeremonyId)
  subKind?: "quick_ask" | "vitoria_ask";     // NOVO — default "quick_ask"
}): Promise<{ sessionId: string }>;

// + helper novo (idempotência D11):
export async function ensureCeremonyPrdSession(args: {
  projectId: string;
  actorMemberId: string;
  ceremonyId: string;
}): Promise<{ sessionId: string; reused: boolean }>;
//   lookup: EntityLink WHERE planningCeremonyId=ceremonyId AND designSessionId IS NOT NULL
//           JOIN DesignSession ON subKind='vitoria_ask'  → reuse; senão createPrdDraftSession(...)
```

### 8.3 Helper de summon headless (sem endpoint)

```ts
// src/lib/sessions/prd-session/summon.ts — novo
// Mesmo shape de runAlphaIngestHeadless (granola-auto-import.ts): roda o Vitor e DRENA o stream
// até o fim, pra o loop do agente executar e persistir o PRD. Sem drain, runAgent fica dormente.
export async function summonVitorHeadless(args: {
  sessionId: string;          // a DesignSession subKind='vitoria_ask'
  brief: string;              // o que falta cobrir (≥10 chars)
  actorMemberId: string;
}): Promise<void> {
  const result = await runAgent({
    agent: vitorAgent,
    thread: { id: <thread da session> },
    userMessage: args.brief,
    memberId: args.actorMemberId,
    params: { sessionId: args.sessionId, currentStepKey: "briefing" },
  });
  const res = result.streamText.toUIMessageStreamResponse({
    onFinish: persistResponseMessage(<thread>),
  });
  const reader = res.body?.getReader();
  if (reader) { while (true) { const { done } = await reader.read(); if (done) break; } }
}
```

**Disparo (fire-and-forget, dentro da tool da Vitoria):**

```ts
import { after } from "next/server";
// ... na execução da capacidade de summon, DEPOIS de anunciar (D6):
after(() => summonVitorHeadless({ sessionId, brief, actorMemberId }));
```

`after()` agenda o drain pra **depois** da resposta da Vitoria flushar — o turno dela não bloqueia, o
PM continua no mesmo chat, e o stream do Vitor escreve na thread da `vitoria_ask` (não na da cerimônia).
**Sem endpoint HTTP, sem job table, sem processo destacado.** Validação (`subKind='vitoria_ask'`,
session existe) acontece em `ensure_sprint_prd_session` antes do disparo.

### 8.4 Status message do anúncio (transparência D6)

```ts
// emitido pela Vitoria ANTES do summon — parte estruturada no stream da cerimônia
type SummonAnnouncement = {
  kind: "vitoria_summon";
  agent: "vitor";
  sessionId: string;
  message: string; // ex.: "Estou convocando o Vitor em background — ele vai criar o PRD; aparece na árvore de PRDs desta sprint."
};
```

## §9 — UX

Chat da cerimônia (Vitoria), **sem troca de tela** — o anúncio + o PRD surgindo na árvore:

```
┌─ Sprint Planning · Sprint 14 ──────────────────────────┬─ Árvore de PRDs (sprint) ──────┐
│                                                        │                                │
│  PM:  falta um PRD pra cobrir rate-limit no gateway    │  ▾ Spec: Gateway                │
│                                                        │     • PRD: Auth no gateway   ✓  │
│  Vitoria:                                              │     • PRD: Logging           ✓  │
│   ┌──────────────────────────────────────────────┐    │                                │
│   │ ⚡ Convocando o Vitor em background            │    │  ⏳ (Vitor autorando…)          │
│   │ Ele vai criar o PRD; aparece na árvore de     │    │                                │
│   │ PRDs desta sprint. Você continua aqui.        │    │  ▾ Spec: Gateway                │
│   └──────────────────────────────────────────────┘    │     • PRD: Auth no gateway   ✓  │
│                                                        │     • PRD: Logging           ✓  │
│  PM:  beleza, e o cache?                               │     • PRD: Rate-limit       NEW │ ◄ apareceu
│                                                        │       (vitoria_ask · draft)    │
│  [ caixa de texto da cerimônia ]                       │                                │
└────────────────────────────────────────────────────────┴────────────────────────────────┘
   ▲ PM nunca saiu do chat da cerimônia; o card "Rate-limit" nasceu sozinho na árvore.
```

Board `+ New PRD` e Spec `Decompose` (hosts em `projects-v2-area`) → roteiam pra mesma entrada de
autoria do Vitor (mini-context / decompose), sem nova UI aqui.

## §10 — Integrações

- **Design Session:** `vitoria_ask` é um `subKind` de `prd_session`; herda render, threads, insumos.
- **PlanningCeremony / Sprint Planning:** a cerimônia é o âncora (1 session/cerimônia). Alocação reusa
  `allocatePrdToSprint` de `projects-v2-planning` (escreve `sprintId` + `deliveryStatus='todo'`).
- **Vitor (autor):** convocado via `runAgent`; cria dentro de Spec (`propose_spec` de
  `projects-v2-spec-authoring`).
- **EntityLink:** liga cerimônia↔session na mesma polimórfica já usada por meetings/transcripts.
- **projects-v2-area:** dona dos botões `+ New PRD` / `Decompose`; este PRD provê o resolver de rota.

## §11 — Faseamento

Fase única (1). Entrega completa o build de §7.3/§7.4 + D13:

1. Estende `createPrdDraftSession` (ceremonyId + subKind) + `ensureCeremonyPrdSession` (idempotente).
2. Tool `ensure_sprint_prd_session` na Vitoria.
3. Helper `summonVitorHeadless` (`runAgent` + drain) disparado por `after()` na tool da Vitoria.
4. Anúncio estruturado + reforço no prompt da Vitoria (transparência D6).
5. Alocação on-approve (`allocatePrdToSprint` de `projects-v2-planning`).
6. Marcador `vitoria_ask` na query/listagem (render idêntico, queryable como set).
7. Resolver de rota dos hosts `+ New PRD` / `Decompose` pra autoria do Vitor.

Entrega **mais** que o estado atual (hoje Vitoria não cria PRD nenhum), nunca menos.

## §12 — Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Summon silencioso (PM não percebe o Vitor agindo) | Média | Alto (quebra confiança) | D6: status message estruturado **antes** do summon + regra no prompt; verifiable `manual_browser` checa o anúncio |
| 2 sessions por cerimônia (race) | Média | Médio | D11: `ensureCeremonyPrdSession` faz lookup por `planningCeremonyId` antes de criar; guard idempotente |
| Vitoria começa a autorar (viola D7) | Baixa | Alto | Tool só provisiona/convoca/aloca; prompt proíbe autoria explicitamente; sem tool `propose_prd` na Vitoria |
| Summon não roda (runAgent dormente / após resposta) | Média | Alto | D5/D12: `summonVitorHeadless` **drena** o stream (sem isso o Vitor não executa); disparo por `after()` roda pós-resposta sem bloquear a Vitoria. Verifiable confere que o PRD aparece na session após o summon |
| Agent-in-agent atrasa percepção do PM | Baixa | Baixo | Anúncio (D6) antes do disparo; o drain roda em background, o PM segue no chat; PRD surge na árvore quando o Vitor aprova |
| PRD órfão (criado, nunca alocado) | Média | Baixo | Alocação on-approve; PRD sem `sprintId` cai em `backlog` (estado válido do plano §4) |

## §13 — Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| PRDs nascidos em cerimônia (lineage) | `SELECT count(*) FROM "ProductRequirement" pr JOIN "DesignSession" ds ON pr."designSessionId"=ds.id WHERE ds."subKind"='vitoria_ask';` |
| Cerimônias com session provisionada | `SELECT count(DISTINCT el."planningCeremonyId") FROM "EntityLink" el JOIN "DesignSession" ds ON el."designSessionId"=ds.id WHERE ds."subKind"='vitoria_ask';` |
| Idempotência (no máx 1 session por cerimônia) | `SELECT el."planningCeremonyId", count(*) FROM "EntityLink" el JOIN "DesignSession" ds ON el."designSessionId"=ds.id WHERE ds."subKind"='vitoria_ask' GROUP BY 1 HAVING count(*) > 1;` deve retornar **0 linhas** |
| PRDs de cerimônia alocados na sprint | `SELECT count(*) FROM "ProductRequirement" pr JOIN "DesignSession" ds ON pr."designSessionId"=ds.id WHERE ds."subKind"='vitoria_ask' AND pr."sprintId" IS NOT NULL;` |
| Taxa de anúncio (transparência) | Evento `vitoria_summon` no stream da cerimônia — contado por turno que dispara summon (logado em `AgentUsage`/quality-log); meta: 100% dos summons precedidos de anúncio |

## §14 — Open questions

Nenhuma bloqueante. (D13 do plano já resolveu o fork background-vs-deeplink a favor de background.)

## §15 — Referências

- Plano: [projects-v2-plan.md](../../features/projects-v2/projects-v2-plan.md) §7.3/§7.4, D13, D11–D15.
- Código: [vitoria/tools.ts](../../../src/lib/agent/agents/vitoria/tools.ts) ·
  [vitoria/index.ts](../../../src/lib/agent/agents/vitoria/index.ts) ·
  [vitoria/release-planning.ts](../../../src/lib/agent/agents/vitoria/release-planning.ts) ·
  [prd-session/dal.ts](../../../src/lib/sessions/prd-session/dal.ts) ·
  [quick-ask/draft/route.ts](../../../src/app/api/sessions/prd/quick-ask/draft/route.ts) ·
  [vitor/index.ts](../../../src/lib/agent/agents/vitor/index.ts) ·
  [engine.ts](../../../src/lib/agent/engine.ts)
- Memory: `project_vitor_as_pm`, `project_rituals_taxonomy`, `project_sprint_planning_living_model`,
  `project_vitor_context_pool`, `feedback_agent_ui_parity`.

## §16 — Stories implementáveis

```yaml
- id: PV2V-001
  title: Estende createPrdDraftSession com ceremonyId + subKind
  description: >
    Adiciona params opcionais `ceremonyId?` e `subKind?` ('quick_ask'|'vitoria_ask', default
    'quick_ask') a createPrdDraftSession. Quando subKind='vitoria_ask', o insert seta subKind +
    title "PRD da cerimônia — rascunho"; quando ceremonyId presente, cria EntityLink(planningCeremonyId,
    designSessionId) na mesma row. Sem schema novo.
  acceptanceCriteria:
    - "createPrdDraftSession aceita { projectId, actorMemberId, ceremonyId?, subKind? }"
    - "Com subKind='vitoria_ask', a DesignSession inserida tem subKind='vitoria_ask'"
    - "Com ceremonyId presente, uma row EntityLink com planningCeremonyId e designSessionId é criada"
    - "Chamada legada (sem ceremonyId/subKind) continua criando subKind='quick_ask' (retrocompatível)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "no errors"
    - kind: lint
      command_or_query: "npx eslint src/lib/sessions/prd-session/dal.ts"
      expected: "no errors"
  dependsOn: []
  estimateMinutes: 25
  touches:
    - src/lib/sessions/prd-session/dal.ts

- id: PV2V-002
  title: ensureCeremonyPrdSession (provision-or-reuse idempotente)
  description: >
    Helper no dal.ts que faz lookup de EntityLink WHERE planningCeremonyId=ceremonyId JOIN
    DesignSession ON subKind='vitoria_ask'. Se achar, retorna { sessionId, reused:true }. Senão chama
    createPrdDraftSession({ ceremonyId, subKind:'vitoria_ask' }) e retorna { sessionId, reused:false }.
    Garante no máx 1 session vitoria_ask por cerimônia (D11).
  acceptanceCriteria:
    - "ensureCeremonyPrdSession({ projectId, actorMemberId, ceremonyId }) existe e exporta tipo de retorno"
    - "2ª chamada com mesmo ceremonyId retorna reused:true e o MESMO sessionId"
    - "Query de idempotência (§13) retorna 0 linhas após 2 chamadas"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "no errors"
    - kind: sql
      command_or_query: "SELECT el.\"planningCeremonyId\", count(*) FROM \"EntityLink\" el JOIN \"DesignSession\" ds ON el.\"designSessionId\"=ds.id WHERE ds.\"subKind\"='vitoria_ask' GROUP BY 1 HAVING count(*) > 1;"
      expected: "0 rows"
  dependsOn: [PV2V-001]
  estimateMinutes: 25
  touches:
    - src/lib/sessions/prd-session/dal.ts

- id: PV2V-003
  title: Tool ensure_sprint_prd_session na Vitoria
  description: >
    Adiciona tool ensure_sprint_prd_session em buildVitoriaTools. inputSchema { ceremonyId:uuid }.
    execute chama ensureCeremonyPrdSession e retorna { sessionId, reused, subKind:'vitoria_ask' }.
    Description deixa claro que NÃO autora PRD e que deve ser chamada antes do summon.
  acceptanceCriteria:
    - "buildVitoriaTools expõe ensure_sprint_prd_session"
    - "inputSchema valida ceremonyId como uuid"
    - "execute retorna { sessionId, reused, subKind }"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "no errors"
    - kind: lint
      command_or_query: "npx eslint src/lib/agent/agents/vitoria/tools.ts"
      expected: "no errors"
  dependsOn: [PV2V-002]
  estimateMinutes: 20
  touches:
    - src/lib/agent/agents/vitoria/tools.ts

- id: PV2V-004
  title: Helper summonVitorHeadless (runAgent + drain) disparado por after()
  description: >
    Cria src/lib/sessions/prd-session/summon.ts com summonVitorHeadless({ sessionId, brief, actorMemberId }):
    chama runAgent({ agent: vitorAgent, thread, userMessage: brief, params:{ sessionId, currentStepKey:'briefing' } })
    e DRENA o stream via toUIMessageStreamResponse({ onFinish: persistResponseMessage }) + reader loop até done
    (padrão runAlphaIngestHeadless em granola-auto-import.ts) — sem o drain o loop do Vitor não roda. A tool
    de summon da Vitoria dispara via after(() => summonVitorHeadless(...)) (next/server), DEPOIS do anúncio (D6),
    fire-and-forget. SEM endpoint HTTP, sem job table.
  acceptanceCriteria:
    - "src/lib/sessions/prd-session/summon.ts exporta summonVitorHeadless"
    - "Usa runAgent (engine.ts) com vitorAgent e DRENA o stream (toUIMessageStreamResponse + reader loop até done)"
    - "O disparo usa after() de next/server dentro da tool da Vitoria (fire-and-forget), não um endpoint"
    - "Após o summon, um ProductRequirement.designSessionId = sessionId é criado pelo Vitor"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "no errors"
    - kind: lint
      command_or_query: "grep -cE 'summonVitorHeadless|toUIMessageStreamResponse|getReader' src/lib/sessions/prd-session/summon.ts"
      expected: ">=2"
    - kind: lint
      command_or_query: "grep -c 'after' src/lib/agent/agents/vitoria/tools.ts"
      expected: ">=1"
  dependsOn: [PV2V-003]
  estimateMinutes: 45
  touches:
    - src/lib/sessions/prd-session/summon.ts
    - src/lib/agent/agents/vitoria/tools.ts

- id: PV2V-005
  title: Anúncio estruturado do summon + reforço no prompt da Vitoria
  description: >
    Antes do summon, a Vitoria emite uma status message estruturada (kind='vitoria_summon') com a
    mensagem "Estou convocando o Vitor em background — ele vai criar o PRD; aparece na árvore de PRDs
    desta sprint." Reforça no prompt da Vitoria a regra: SEMPRE anunciar antes de convocar; NUNCA
    autorar PRD. (Transparência D6.)
  acceptanceCriteria:
    - "Tipo SummonAnnouncement (kind:'vitoria_summon') definido e emitido antes do summon"
    - "Prompt da Vitoria contém regra explícita de anúncio + proibição de autoria"
    - "Mensagem de anúncio cita 'background' e 'árvore de PRDs desta sprint'"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "no errors"
    - kind: manual_browser
      command_or_query: "Na Sprint Planning, pedir um PRD à Vitoria; confirmar que ela ANUNCIA o summon (texto sobre background + árvore) ANTES do Vitor agir"
      expected: "Anúncio visível antes do summon"
  dependsOn: [PV2V-004]
  estimateMinutes: 25
  touches:
    - src/lib/agent/agents/vitoria/tools.ts
    - src/lib/agent/agents/vitoria/prompt.ts

- id: PV2V-006
  title: Alocação on-approve (allocatePrdToSprint)
  description: >
    Quando o Vitor aprova um PRD numa session vitoria_ask, a Vitoria aloca o PRD na sprint da cerimônia
    via tool allocate_ceremony_prd(prdId): resolve sprintId = PlanningCeremony.sprintId e chama
    allocatePrdToSprint (de projects-v2-planning), que escreve ProductRequirement.sprintId +
    deliveryStatus='todo'. NÃO usa link_prd_to_sprint (essa é PlanningSessionPRD, mecanismo errado).
  acceptanceCriteria:
    - "Tool allocate_ceremony_prd(prdId) existe na Vitoria"
    - "Resolve sprintId via PlanningCeremony.sprintId e chama allocatePrdToSprint (não link_prd_to_sprint)"
    - "Após alocar, ProductRequirement.sprintId é não-nulo e deliveryStatus='todo'"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "no errors"
    - kind: sql
      command_or_query: "SELECT count(*) FROM \"ProductRequirement\" pr JOIN \"DesignSession\" ds ON pr.\"designSessionId\"=ds.id WHERE ds.\"subKind\"='vitoria_ask' AND pr.\"sprintId\" IS NOT NULL;"
      expected: ">= 1 after an approved+allocated ceremony PRD"
  dependsOn: [PV2V-005]
  estimateMinutes: 30
  touches:
    - src/lib/agent/agents/vitoria/tools.ts

- id: PV2V-007
  title: Marcador vitoria_ask queryable + render idêntico
  description: >
    Garante que sessions vitoria_ask são listáveis como set (filtro/marcador em queries de session) e
    renderizam idênticas a prd_session (mesmo two-pane PRD-tree). Adiciona helper de query
    listVitoriaAskSessions(ceremonyId|projectId) e confirma que o componente de PRD-tree não diverge por
    subKind.
  acceptanceCriteria:
    - "Helper listVitoriaAskSessions filtra DesignSession por subKind='vitoria_ask'"
    - "Render do PRD-tree é o mesmo de prd_session (nenhum branch por subKind na UI de autoria)"
    - "Query de lineage (§13) retorna as sessions vitoria_ask da cerimônia"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "no errors"
    - kind: sql
      command_or_query: "SELECT count(*) FROM \"EntityLink\" el JOIN \"DesignSession\" ds ON el.\"designSessionId\"=ds.id WHERE ds.\"subKind\"='vitoria_ask' AND el.\"planningCeremonyId\" IS NOT NULL;"
      expected: ">= 1 after a summon"
  dependsOn: [PV2V-006]
  estimateMinutes: 25
  touches:
    - src/lib/sessions/prd-session/dal.ts

- id: PV2V-008
  title: Roteamento dos hosts + New PRD (board) e Decompose (Spec) pra autoria do Vitor
  description: >
    Adiciona o resolver que liga os gatilhos hospedados em projects-v2-area — board "+ New PRD" (Vitor
    mini-context) e Spec "Decompose" — à mesma entrada de autoria do Vitor. "+ New PRD" abre/usa uma
    session de autoria (prd_session) com brief vazio; "Decompose" passa o Spec (userStoryId) como
    contexto pra Vitor fatiar em PRDs. Sem nova UI aqui — só o resolver de rota.
  acceptanceCriteria:
    - "Função resolvePrdAuthoringTarget({ kind:'new_prd'|'decompose', projectId, userStoryId? }) existe"
    - "kind='new_prd' resolve pra entrada de autoria do Vitor (prd_session)"
    - "kind='decompose' passa userStoryId (Spec) como contexto da autoria"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "no errors"
    - kind: manual_browser
      command_or_query: "No board V2, clicar '+ New PRD' abre autoria do Vitor; numa Spec, 'Decompose' inicia fatiamento do Vitor com a Spec como contexto"
      expected: "Ambos roteiam pra Vitor"
  dependsOn: [PV2V-007]
  estimateMinutes: 30
  touches:
    - src/lib/sessions/prd-session/dal.ts
```
