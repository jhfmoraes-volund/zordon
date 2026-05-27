# Alpha global no header + contexto de rota — v2

Plano para mover o chat do Alpha de bolha por-página pra acesso global via header, com awareness automática da rota onde o usuário está, threading com expiração por inatividade, e tools que respeitam o escopo da página.

> v2 endereça as três falhas críticas do v1: threading não decidido, contexto project-agnostic, e abstração errada do parser de rota (lazy tool em vez de eager enrichment).

## Objetivos

1. Header sticky no mobile pra navegação mais fácil
2. Bolha do Alpha acessível de qualquer página, sem precisar montar `<AlphaChat>` em cada uma
3. Alpha sabe automaticamente em que página o usuário está, e quando a página tem entidade rica (projeto, sprint, reunião) o servidor injeta o contexto direto no system prompt
4. Conversa preservada entre rotas durante uma sessão; após 30min sem reabrir, próxima abertura começa nova thread
5. Tools respeitam o escopo da rota: em `/projects/X`, "sprint atual" significa o sprint ativo do projeto X, não o global

## Estado atual

- Header em [layout.tsx:60-68](src/app/(dashboard)/layout.tsx#L60-L68) — não-sticky, contém `SidebarTrigger` e badge de impersonação. Não tem logo.
- `<AlphaChat>` montado em 3 páginas:
  - [board/page.tsx:391](src/app/(dashboard)/sprints/%5Bid%5D/board/page.tsx#L391) — passa `sprint?.name` e `{ sprintId }`
  - [projects/[id]/page.tsx:487](src/app/(dashboard)/projects/%5Bid%5D/page.tsx#L487) — passa nome do projeto e `{ projectId }`
  - [meetings/[id]/page.tsx:637](src/app/(dashboard)/meetings/%5Bid%5D/page.tsx#L637) — passa data e `{ meetingId }`
- Bolha flutuante bottom-right em todos os viewports
- Modal: Sheet `side="bottom"` no mobile, painel 420×550 bottom-right no desktop
- Backend: [chat/route.ts](src/app/api/agents/alpha/chat/route.ts) hoje aceita só `meetingId` no body; threading via `ensureAgentThread` (último thread `web` do membro, sem expiração)
- Página `/ops` ([ops/page.tsx](src/app/(dashboard)/ops/page.tsx)) usa o mesmo endpoint com gestão explícita de `threadId` + `newThread`. Mesmo `channel: "web"` da bolha — hoje os dois compartilham pool, mas ninguém percebe porque a bolha sempre cai no último thread.

## Decisões resolvidas

| # | Tema | Decisão |
|---|---|---|
| 1 | Timer de inatividade | 30min. Reseta no toggle abrir (`open=false → true`). Não reseta em close nem em send. |
| 2 | UX de expiração | Bolha abre vazia, sem banner. Thread anterior fica acessível em `/ops`. |
| 3 | Pool de threads | Bolha e `/ops` compartilham `channel: "web"`. Threads da bolha aparecem no histórico de `/ops`. |
| 4 | Estado inicial na sessão | Bolha sempre vazia ao montar (recarregar página = começa do zero). Continuidade vem da `useChat` instance preservada no provider, não de fetch ao servidor. |
| 5 | Project-scoping | Tools recebem `projectId`/`sprintId` parseados da rota como params da execução. Filtram quando o agente não passa ID explícito. |
| 6 | Server-side enrichment | `/projects/[id]`, `/sprints/[id]/board` e `/meetings/[id]` viram blocos ricos no system prompt. Outras rotas só path raw. |
| 7 | Header sticky | Mobile only. Desktop fica como está. |
| 8 | Sheet mobile | `side="bottom"` (mantido). |
| 9 | Badge de label | Removido. |

## Arquitetura

### 1. Modelo de threading da bolha

Estado vive numa store client-side (`AlphaBubbleProvider`) — não persiste em localStorage.

```
threadId: string | null
lastOpenedAt: number | null   // epoch ms
messages: UIMessage[]         // via useChat
isOpen: boolean
```

**Ciclo de vida:**

| Evento | Ação |
|---|---|
| Mount do provider | Estado vazio. Sem fetch. |
| Toggle `open=false → true`, primeira vez na sessão | `lastOpenedAt = now`. Não reseta nada (já está vazio). |
| Toggle `open=false → true`, com `threadId != null` E `now - lastOpenedAt < 30min` | `lastOpenedAt = now`. Mensagens em memória ficam. Continua mesmo thread. |
| Toggle `open=false → true`, com `threadId != null` E `now - lastOpenedAt >= 30min` | `messages = []`, `threadId = null`, `lastOpenedAt = now`. Visualmente: bolha vazia, como sessão nova. |
| Send com `threadId == null` | Envia `newThread: true` no body. Backend cria thread, devolve `X-Thread-Id`, store guarda. |
| Send com `threadId != null` | Envia `threadId` no body. |
| Navegação de rota | Nada acontece com a thread. `currentPath` muda no body do próximo send. |
| Reload da página | Provider remonta, estado zera. Thread anterior só visível via `/ops`. |

**Por que reset SÓ no abrir, não em send:**
- Decisão do usuário foi explícita: "última abertura da bolha".
- Caso-borda: usuário abre, conversa por 1h sem fechar, fecha, reabre 5min depois → timer = 1h05min → expirou. **Comportamento aceito.** Conversa contínua de 1h+ é raro na bolha (esse fluxo vai pro `/ops`).

**Por que sem fetch ao montar:**
- Decisão do usuário (item 4): bolha sempre vazia ao montar.
- Continuidade entre rotas vem da `useChat` instance preservada no provider durante a navegação SPA.
- Reload = perde contexto in-memory mas thread persiste no DB e fica disponível em `/ops`.

**Por que mesmo pool com `/ops`:**
- Histórico unificado, fonte única.
- Continuar uma conversa rápida da bolha no `/ops` (com tela maior) é feature útil.
- Implementação: zero mudança no backend — `channel: "web"` já funciona pros dois.

### 2. Contexto de rota — eager server-side enrichment

Cliente envia `currentPath` no body de cada send. Backend parseia, identifica entidade, e injeta bloco rico no system prompt.

**Parser do path** (server-side, em [chat/route.ts](src/app/api/agents/alpha/chat/route.ts)):

```ts
type RouteContext =
  | { kind: "project"; projectId: string }
  | { kind: "sprint"; sprintId: string }
  | { kind: "meeting"; meetingId: string }
  | { kind: "list"; entity: "projects" | "sprints" | "meetings" | "clients" | "members" | "squads" }
  | { kind: "other"; path: string };

function parseRoute(path: string): RouteContext { /* regex match */ }
```

Validação de `currentPath`:
- String, max 500 chars
- Regex: `^\/[a-zA-Z0-9\-\/\_]*(\?[a-zA-Z0-9\-\=\&\_]*)?$`
- Se inválido: ignora silenciosamente, não envia pra `runAgent`

**Enrichment por tipo:**

| Tipo | Bloco no prompt |
|---|---|
| `project` | "## Foco: Projeto X" — nome, status, PM, sprints (planning/active) com nome+datas, tasks ativas top-10 por prioridade, membros + fpAllocation |
| `sprint` | "## Foco: Sprint Y do Projeto X" — sprint, projeto, capacidade, alocação por membro, tasks |
| `meeting` | Mantém bloco atual de `buildMeetingBlock` |
| `list` | "## Local atual: lista de projetos" (curto) |
| `other` | "## Local atual: <path>" (curto, raw) |

**Estratégia de tokens:**
- Sem foco (rota `list`/`other`): mantém contexto global atual (sprint ativo do banco, bateria, backlog) — comportamento idêntico ao de hoje.
- Com foco (`project`/`sprint`/`meeting`): contexto global vira **versão compacta** (só bateria + alertas globais; sem sprint ativo global, sem backlog completo) e o **foco** vira o bloco rico. Evita inflar o prompt em ~1000 tokens.

**Refatoração de [context.ts](src/lib/agent/agents/alpha/context.ts):**

Quebrar `buildOpsContext` em:
- `buildGlobalContext({ compact: boolean })` — bateria, alertas, backlog. Quando `compact=true`, omite sprint ativo global e backlog detalhado.
- `buildProjectFocus(projectId)` — projeto + sprints + tasks + membros do projeto.
- `buildSprintFocus(sprintId)` — sprint + projeto + capacidade + tasks. (Reusa parte de `buildProjectFocus`.)
- `buildMeetingBlock(meetingId)` — existente, mantido.

Composição em `buildOpsContext({ route, meetingId })`:
1. Sempre: params, matrix, heuristics
2. Sempre: `buildGlobalContext({ compact: route.kind !== "list" && route.kind !== "other" })`
3. Branch:
   - `route.kind === "project"` → `buildProjectFocus(route.projectId)`
   - `route.kind === "sprint"` → `buildSprintFocus(route.sprintId)`
   - `route.kind === "meeting"` → `buildMeetingBlock(route.meetingId)`
   - resto → bloco curto "## Local atual: <path>"

**Por que eager enrichment em vez de tool `get_current_page_context`:**
- Sem round-trip: agente já sabe na primeira passada do modelo.
- Reusa o padrão que já existe pro `meetingId`.
- Reduz a chance do agente "esquecer" de chamar a tool.
- Lazy só faria sentido pra rotas com lookup caro — no nosso caso, nenhuma é cara o suficiente pra justificar um turno extra.

### 3. Project-scoping nas tools

Tools globais hoje ([tools.ts](src/lib/agent/agents/alpha/tools.ts)) ignoram a rota. Resultado: em `/projects/X`, perguntar "sprint atual" pega o sprint ativo do banco inteiro.

**Mudança:**
- `assembleAlphaTools(capabilities, opts)` ganha `opts.routeProjectId`, `opts.routeSprintId` — passados pelo `loadContext` do agente em [alpha/index.ts](src/lib/agent/agents/alpha/index.ts).
- Tools afetadas filtram pelo escopo **quando o agente não passa ID explícito**:

| Tool | Comportamento atual | Comportamento novo |
|---|---|---|
| `get_sprint_overview` | Sprint mais recente não-done global | Se `routeSprintId` → esse sprint. Se `routeProjectId` → sprint ativo do projeto. Caso contrário → global (comportamento atual). |
| `get_alerts` | Sprint global + todos os membros | Se `routeProjectId` → filtra alertas pelos membros do projeto + sprint do projeto. |
| `list_sprints` | Aceita `projectName`. Sem filtro default. | Se `routeProjectId` E `projectName` ausente → filtra pelo projeto da rota. |
| `get_backlog` | Aceita `projectName`. | Se `routeProjectId` E `projectName` ausente → filtra pelo projeto da rota. |
| `get_sprint_capacity` | Aceita `sprintId` | Sem mudança — já recebe ID explícito. |
| `get_member_commitments` | Cross-projeto (bateria) | Sem mudança — bateria é por definição global. |
| Demais write tools | Recebem nome/ID explícito | Sem mudança. |

**Implementação:**
- Tools leem `opts.routeProjectId` direto do closure (já é assim com `activeMeetingId` em [tools.ts:22](src/lib/agent/agents/alpha/tools.ts#L22)).
- Resolução do "sprint ativo do projeto da rota" usa: `Sprint.where(projectId=routeProjectId, status!=done).orderBy(startDate desc).limit(1)`.
- Documentar no prompt que o agente pode pedir o global explicitamente passando `projectName` quando quiser cross-project.

### 4. Layout — alterações só no mobile

| Aspecto | Mobile | Desktop |
|---|---|---|
| Header | Sticky (`sticky top-0 z-40 bg-background/80 backdrop-blur`), trigger sidebar à esquerda + bolha Alpha à direita (variant menor `h-9 w-9`) | Inalterado (não-sticky, `SidebarTrigger` + impersonação) |
| Bolha Alpha | No header (canto direito) | Inalterada (flutuante bottom-right, `h-14 w-14`) |
| Modal | `Sheet side="bottom"` 100dvh | Inalterado (painel 420×550 bottom-right) |
| Páginas com `<AlphaChat>` | Removido | Removido |

**Por que mobile-only:**
- Desktop tem sidebar persistente; bolha flutuante já funciona.
- Mobile esconde sidebar atrás de Sheet → header é a única surface persistente, então sticky + bolha lá faz sentido.
- Reduz superfície de teste; estender pro desktop é uma linha de CSS depois se a gente sentir falta.

**Por que `side="bottom"` no mobile mesmo com trigger no topo:**
- Input fica perto do polegar (ergonomia > coerência da animação).
- Manter o padrão atual reduz risco de regressão com teclado virtual no iOS.

### 5. Split de componentes

```
<AlphaChatProvider>           — client, em (dashboard)/layout.tsx envolvendo <main>
  └─ store (Zustand ou Context):
       open, setOpen, toggle, lastOpenedAt
       threadId, setThreadId
       useChat instance + sendMessage(text)
       send injeta automaticamente { currentPath, threadId, newThread } no body

<AlphaChatTrigger />          — render duas vezes:
   variant="header"           — md:hidden, dentro do <header>, h-9 w-9
   variant="floating"         — hidden md:block, fixed bottom-right, h-14 w-14
   ambos chamam toggle() do store

<AlphaChatPanel />            — render uma vez, escolhe layout via useIsMobile():
   mobile  → <Sheet side="bottom" />
   desktop → painel flutuante 420×550
```

**Gate por role:** `hasMinLevel(effectiveRole, MANAGER)` aplicado no Provider — se Builder, provider monta vazio (não cria `useChat`, não renderiza Trigger nem Panel).

**Hidratação:** Provider é client component. Layout é server component que envolve `<AlphaChatProvider>` em volta de `<main>`. `useChat` só roda no cliente; SSR não vê isso.

## Tarefas

### Backend

- [ ] **1.1** Em [chat/route.ts](src/app/api/agents/alpha/chat/route.ts), aceitar `currentPath` no body. Validar (string, max 500, regex). Implementar `parseRoute(path) → RouteContext`. Passar `route` em `params` pra `runAgent`.
- [ ] **1.2** Em [alpha/index.ts](src/lib/agent/agents/alpha/index.ts), `loadContext` lê `params.route`. Passa `route` pra `buildOpsContext`. Exporta `routeProjectId`, `routeSprintId` no `agentContext` pras tools.
- [ ] **1.3** Refatorar [context.ts](src/lib/agent/agents/alpha/context.ts):
  - Quebrar em `buildGlobalContext({ compact })`, `buildProjectFocus(projectId)`, `buildSprintFocus(sprintId)`. Manter `buildMeetingBlock`.
  - `buildOpsContext({ route, meetingId })` compõe na ordem: params → matrix → heuristics → global (compact se houver foco) → focus block (project/sprint/meeting/path).
  - Resolver "sprint ativo do projeto" via subquery dedicada.
- [ ] **1.4** Em [tools.ts](src/lib/agent/agents/alpha/tools.ts), `assembleAlphaTools(capabilities, opts)` aceita `opts.routeProjectId`, `opts.routeSprintId`. Aplicar filtro nas 4 tools listadas (`get_sprint_overview`, `get_alerts`, `list_sprints`, `get_backlog`).
- [ ] **1.5** Atualizar [prompt.ts](src/lib/agent/agents/alpha/prompt.ts):
  - Documentar: "Quando o contexto traz um bloco `## Foco`, ele reflete a página onde o usuário está. Tools de leitura sem ID explícito vão filtrar por esse foco automaticamente."
  - Documentar: "Pra perguntar sobre o sistema todo (cross-projeto), passe `projectName` ou outro ID explícito nas tools."

### Frontend — store & split

- [ ] **2.1** Criar `src/components/alpha-chat/store.tsx` (Context API; sem Zustand pra evitar dependência nova):
  - Estado: `open`, `lastOpenedAt`, `threadId`, `messages` (via `useChat`)
  - Ações: `toggle()`, `sendMessage(text)`
  - `toggle()`: se vai pra `open=true` E `lastOpenedAt && now - lastOpenedAt >= 30min` → reset (`setMessages([])`, `threadId = null`); sempre `lastOpenedAt = now`.
  - `sendMessage(text)`: chama `chat.sendMessage({ text }, { body: { currentPath, threadId, newThread: !threadId } })`. Quando resposta chega, lê `X-Thread-Id` do header e atualiza store.
  - `currentPath` derivado de `usePathname()`.
  - Gate por role internamente (não monta `useChat` se Builder).
- [ ] **2.2** Quebrar [alpha-chat.tsx](src/components/alpha-chat.tsx) em `alpha-chat/`:
  - `provider.tsx` — `<AlphaChatProvider>` com store
  - `trigger.tsx` — `<AlphaChatTrigger variant="header" | "floating" />`
  - `panel.tsx` — `<AlphaChatPanel />` (Sheet ou painel desktop)
  - `index.ts` reexporta os três
- [ ] **2.3** Manter Markdown rendering, autofocus no textarea, indicador de loading.

### Frontend — layout

- [ ] **3.1** Em [layout.tsx](src/app/(dashboard)/layout.tsx):
  - Wrapar `<main>` com `<AlphaChatProvider>` (cliente)
  - Header recebe `sticky top-0 z-40 bg-background/80 backdrop-blur md:static md:bg-transparent md:backdrop-blur-none`
  - Adicionar `<AlphaChatTrigger variant="header" />` no header (`md:hidden` interno)
  - Adicionar `<AlphaChatTrigger variant="floating" />` no body (`hidden md:block` interno)
  - Adicionar `<AlphaChatPanel />` uma vez no body
- [ ] **3.2** Garantir que `<main className="flex-1 overflow-auto">` continue scrollando independente do header sticky (o sticky funciona contra o scroll do `<main>`, não do documento).

### Frontend — limpeza das páginas

- [ ] **4.1** Remover `<AlphaChat>` e import de [board/page.tsx](src/app/(dashboard)/sprints/%5Bid%5D/board/page.tsx)
- [ ] **4.2** Remover `<AlphaChat>` e import de [projects/[id]/page.tsx](src/app/(dashboard)/projects/%5Bid%5D/page.tsx)
- [ ] **4.3** Remover `<AlphaChat>` e import de [meetings/[id]/page.tsx](src/app/(dashboard)/meetings/%5Bid%5D/page.tsx)
- [ ] **4.4** Apagar [src/components/alpha-chat.tsx](src/components/alpha-chat.tsx) antigo (substituído pela pasta `alpha-chat/`).

## O que se perde

- **`contextLabel` no badge** ("Sprint 4", "12/03/2026") — decidido remover. Se sentir falta, fácil reintroduzir derivando do path.

## Riscos / pontos de atenção

- **Conversa mistura contextos ao navegar.** Usuário discute sprint do projeto A, navega pra projeto B, faz pergunta. Mensagens em memória ainda referenciam A; `currentPath` e bloco de foco no system prompt são de B. **Mitigação:** docstring no prompt explicando "quando o foco mudar durante a conversa, isso é normal — referencia o foco atual". Aceitar como custo de "conversa preservada".
- **Reset por 30min é silencioso.** Usuário pode achar que perdeu trabalho. Mitigação: thread anterior fica em `/ops`. Avaliar telemetria depois pra ver se incomoda.
- **Sticky header + Sidebar Sheet no mobile.** Header z-40, Sheet do sidebar z-50 (Radix), Painel do Alpha z-50. Quando bolha + sidebar abrem juntos, ordem do DOM define quem fica em cima — `<AlphaChatPanel>` é filho do `<AlphaChatProvider>` em `<main>`, então `Sidebar Sheet` (mais alto na árvore) sobrepõe a bolha. Comportamento aceitável; documentar.
- **Token budget.** Quando há foco, contexto global vira compacto pra compensar. Verificar com 1-2 medições reais que o prompt total fica próximo do tamanho atual (~3-5k tokens).
- **Prompt injection via `currentPath`.** Mitigado pela validação regex e por o path nunca conter input livre do usuário (vem do `usePathname()`). Mesmo assim, sanitizar antes de injetar (escapar quebras de linha).
- **Tool param naming.** `routeProjectId` vs `projectName` (input do agente) precisa ficar claro no prompt pra evitar o agente passar `projectName: undefined` achando que vai filtrar.
- **`useChat` instance no Provider.** Quando o Provider remonta (Builder vira Manager via impersonação), `useChat` reinicializa e perde mensagens. Aceitável — impersonação é flow raro.

## Ordem de execução

1. **Backend (1.1 → 1.5)** — testar com curl: `curl -X POST .../alpha/chat -d '{"messages":[...], "currentPath":"/projects/abc"}'` e inspecionar prompt gerado em log.
2. **Frontend store + split (2.1 → 2.3)** — sem mexer no layout. Testar manualmente importando `<AlphaChatProvider>` numa página de sandbox.
3. **Layout + remoção das páginas (3.1 → 4.4)** — única migração visível.
4. **QA manual** — Chrome DevTools responsive + dispositivo real (iOS Safari + Android Chrome).

## Critério de "feito"

Funcional:
- [ ] Em qualquer página do dashboard mobile, dá pra abrir o Alpha pelo header.
- [ ] Header fica visível ao rolar a página no mobile.
- [ ] **Project-scoping:** em `/projects/<id>`, perguntar "como tá o sprint atual?" → resposta menciona o nome do projeto da rota e o sprint correto. Em log do servidor, `routeProjectId` aparece e `get_sprint_overview` retorna o sprint do projeto, não o global.
- [ ] **Conversa preservada:** abrir bolha em `/projects/A`, conversar, navegar pra `/sprints/B/board`, mensagens anteriores ainda visíveis. Próxima pergunta usa contexto do sprint B (verificar via log).
- [ ] **Reset por idle:** abrir bolha, mandar 1 msg, fechar, esperar 31min, abrir → bolha vazia, thread anterior visível em `/ops`.
- [ ] **Reset NÃO ocorre dentro da janela:** abrir, fechar, abrir 5min depois → conversa preservada.
- [ ] **Threads visíveis em `/ops`:** thread iniciada pela bolha aparece na lista do `/ops` com título derivado da primeira mensagem.
- [ ] Desktop continua idêntico (visualmente e funcionalmente).

Não-funcional:
- [ ] Type check + lint limpos.
- [ ] Token count médio do prompt em rotas com foco fica dentro de ±15% do prompt sem foco (ou seja, contexto compacto compensa o foco rico).
- [ ] Validação de `currentPath` rejeita: `null`, string sem `/` inicial, > 500 chars, caracteres fora do regex.
