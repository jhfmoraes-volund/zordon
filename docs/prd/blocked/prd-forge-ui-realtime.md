# PRD — Forge UI Realtime (Supabase channel ao invés de SSE/jsonl)

> Status: `backlog` · Owner: João · Created: 2026-05-31 · Target: 1 loop Ralph (~1h45min)

---

## 0 · Posicionamento

Terceiro PRD da quinta **Forge-MVP** (depende de F1). Resolve: **UI não vê o run**. Hoje `/forge-spike/runs/[id]/page.tsx` consome SSE de `/api/forge/runs/[id]/stream/route.ts:18` que lê `process.cwd()/.forge/<id>/events.jsonl` — caminho hardcoded errado pro daemon (que grava em `~/.volund-forge/runs/...`). Mesmo se o path fosse certo, o jsonl pode estar em outra máquina. Solução: UI **dropa SSE/jsonl e passa a consumir `ForgeEvent` via Supabase Realtime** — só funciona depois de F1 popular a tabela.

Princípio: **frontend só fala com Postgres (REST + Realtime). Filesystem do daemon é invisível pra UI.**

---

## 1 · Problema

3 sintomas:

1. **`/forge-spike/runs/<id>` em branco mid-run** — SSE conecta, mas `eventsPath` aponta pra `<repo>/.forge/<runId>/events.jsonl` que não existe (daemon escreve em `~/.volund-forge/runs/<runId>/`). Stream fica vazio. Após F1 o jsonl ainda vai existir, mas em path incompatível, e além disso o frontend não tem acesso ao FS do daemon de qualquer forma.

2. **Multi-máquina impossível** — se daemon roda em máquina A e operador abre browser em máquina B, jsonl é inacessível por design. Pra um SaaS-agency-style (memory `project_zordon_ops_pipeline`), isso é bloqueador.

3. **Leak no SSE polui logs** — `Controller is already closed` em [route.ts:36](../../../src/app/api/forge/runs/[id]/stream/route.ts) cuspe `uncaughtException` repetidamente. Sintoma de fundo: SSE custom é cerimônia que Realtime resolve out-of-the-box.

**Fonte:**
- [src/app/api/forge/runs/[id]/stream/route.ts:18](../../../src/app/api/forge/runs/[id]/stream/route.ts)
- [src/app/api/forge/autoruns/[id]/route.ts:34-35](../../../src/app/api/forge/autoruns/[id]/route.ts)
- [src/app/forge-spike/runs/[id]/page.tsx](../../../src/app/forge-spike/runs/[id]/page.tsx) — consumer SSE
- [src/components/forge/run-kanban.tsx:122-150](../../../src/components/forge/run-kanban.tsx) — JÁ usa Realtime em `ForgeEvent` (vai começar a funcionar após F1)

## 2 · Solução em uma frase

**Componente `<RunEventStream runId>` em `src/components/forge/run-event-stream.tsx` que (1) faz initial fetch via `supabase.from('ForgeEvent').select().eq('runId', runId).order('seq')`, (2) assina `postgres_changes` em ForgeEvent filtrado por runId, (3) tem fallback REST poll a cada 5s se canal cair; rotas `api/forge/runs/[id]/stream` e `api/forge/autoruns/[id]` deletadas.**

## 3 · Não-objetivos

- ❌ Não preservar rota SSE — deletar definitivamente. Quem dependia migra junto.
- ❌ Não fazer paginação de eventos v1 — runs têm ≤ 1k eventos típico, fetch direto.
- ❌ Não animar entrada de evento (UX polish fica pra depois).
- ❌ Não mudar `/forge-spike/runs/[id]/page.tsx` além do necessário pra plugar o componente novo.
- ❌ Não tocar `run-kanban.tsx` e `active-builders.tsx` (já usam Realtime; só precisam de F1 pra funcionarem).
- ❌ Não criar versão server-only (page.tsx vira thin server + client component).
- ❌ Não adicionar autenticação extra — RLS de `ForgeEvent` já cobre.

## 4 · Personas e jornada

**Operador acompanhando run live:**
> "Abre `/forge-spike/runs/<runId>`. Componente faz initial fetch (200 eventos backfill em ~100ms). Lista renderiza. Channel `supabase.channel('forge-events-<runId>')` conecta. Novo evento chega via Realtime em ≤300ms — lista cresce no fim. Scroll auto-stick no fim."

**Operador inspecionando run antigo:**
> "Mesmo flow. Initial fetch traz todos os eventos. Channel conecta mas não recebe nada (run terminou). UI mostra eventos estáticos. Botão 'Re-run' visível se status='error'."

**Operador em rede instável:**
> "Channel cai. UI mostra badge 'Reconnecting...'. Fallback poll dispara a cada 5s (`SELECT WHERE runId=$1 AND seq > $lastSeq ORDER BY seq`). Quando channel volta, pollback para."

## 5 · Decisões fixadas

| Dn | Decisão | Por quê |
|---|---|---|
| D1 | UI usa supabase-js client component, **não** server component | Realtime channel é client-side por design. SSR-only não consegue subscrever. |
| D2 | Initial fetch via `.from('ForgeEvent').select('*').eq('runId', $).order('seq')` — REST, não SSE | Cold-start atômico, sem stream parsing. RLS aplica. |
| D3 | Subscription via `supabase.channel('forge-events-<runId>').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ForgeEvent', filter: 'runId=eq.<runId>' }, handler)` | Realtime nativo. Filtro server-side reduz bandwidth. |
| D4 | Fallback poll: se `channel.subscribe()` não atingir `SUBSCRIBED` em 5s OU disparar `CLOSED`, inicia `setInterval` 5s com `SELECT WHERE seq > $maxSeen` | Resiliência sem cerimônia. Poll para quando channel reconecta. |
| D5 | Estado local: `events: ForgeEventRow[]` + `lastSeq: number` + `connectionState: 'connecting'\|'realtime'\|'polling'\|'disconnected'` | Permite UI mostrar badge de status sem hack. |
| D6 | Componente novo `src/components/forge/run-event-stream.tsx` (client) — substitui código inline do `/forge-spike/runs/[id]/page.tsx` | Reusável: `/forge-spike/runs/[id]`, futuras telas (e.g. tab do projeto) podem importar. |
| D7 | Página `/forge-spike/runs/[id]/page.tsx` vira server thin: lê meta do run via DAL, renderiza header + `<RunEventStream runId>` | Padrão Next 16 App Router: server pra meta estática, client pra streams. |
| D8 | Rotas `api/forge/runs/[id]/stream/route.ts` e `api/forge/autoruns/[id]/route.ts` são **deletadas** | Código morto pós-migration. Sage flagged o leak — deletar resolve raiz. |
| D9 | Realtime channel auto-cleanup em `useEffect` return — `supabase.removeChannel(channel)` | Sem leak. React lifecycle padrão. |
| D10 | Hard cap de 5000 eventos renderizados; após, virtualizar ou truncar | Performance. v1: truncar com banner "showing last 5000". Virtual list é Fase 2. |

## 6 · Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│ /forge-spike/runs/[id]/page.tsx   (server component)         │
│                                                              │
│   const run = await getRun(id)  ◄── REST/DAL                 │
│   return (                                                   │
│     <header>...{run.status}...</header>                      │
│     <RunEventStream runId={id} />   ◄── client island        │
│   )                                                          │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ <RunEventStream runId>  (client component)                   │
│                                                              │
│  useEffect:                                                  │
│    1. initial = await supabase.from('ForgeEvent')            │
│         .select('*').eq('runId', runId).order('seq')         │
│    2. channel = supabase.channel('forge-events-' + runId)    │
│         .on('postgres_changes', {                            │
│           table: 'ForgeEvent', filter: 'runId=eq.' + runId   │
│         }, ev => setEvents(prev => [...prev, ev.new]))       │
│         .subscribe(status => {                               │
│           if (status==='SUBSCRIBED') stopPolling()           │
│           if (status==='CLOSED') startPolling()              │
│         })                                                   │
│    3. fallback poll = setInterval(5000, async () => {        │
│         const next = await supabase.from('ForgeEvent')       │
│           .select('*').eq('runId',runId).gt('seq',lastSeq);  │
│         setEvents(prev => [...prev, ...next])                │
│       })                                                     │
│    4. return cleanup: removeChannel + clearInterval          │
│                                                              │
│  render:                                                     │
│    <Badge state={connectionState} />                         │
│    {events.slice(-5000).map(...)}                            │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
              Supabase Realtime + REST
```

Componentes novos:
- `src/components/forge/run-event-stream.tsx` — client component.
- `src/lib/dal/forge-run.ts` — adiciona `getRun(id)` se ainda não existe.

Componentes modificados:
- `src/app/forge-spike/runs/[id]/page.tsx` — server thin + client island.

Componentes deletados:
- `src/app/api/forge/runs/[id]/stream/route.ts`
- `src/app/api/forge/autoruns/[id]/route.ts`

## 7 · Schema

Nenhuma migration. RLS `ForgeEvent_select` já permite owner+manager (verificado em F1).

## 8 · APIs

**Deletadas:**
- `GET /api/forge/runs/[id]/stream` (SSE)
- `GET /api/forge/autoruns/[id]` (REST jsonl reader)

**Mantidas:**
- `GET /api/forge/runs/[id]/prd-status` (já lê DB; não muda)
- `GET /api/forge/active-builders` (já lê DB; não muda)

API TypeScript (componente):
```ts
type RunEventStreamProps = {
  runId: string;
  maxRendered?: number; // default 5000
};
export function RunEventStream(props: RunEventStreamProps): JSX.Element;
```

## 9 · UX

Wireframe `/forge-spike/runs/<id>`:

```
┌─────────────────────────────────────────────────────────────┐
│ ← Back                                                       │
│                                                              │
│  Run 0408de11-2637  ·  status: running  ·  progress: 30%    │
│  started 2 min ago  ·  events: 47                            │
│  [● realtime]   ◄── badge: realtime | polling | disconnected │
│                                                              │
│ ┌───────────────────────────────────────────────────────────┐│
│ │ seq │ ts       │ kind             │ payload preview        ││
│ │  1  │ 17:04:51 │ autorun_started  │ {prdSlug, total: 1}    ││
│ │  2  │ 17:04:51 │ manifest_…       │ {storyCount: 1}        ││
│ │  3  │ 17:04:52 │ story_picked     │ VOLU-PRD-001           ││
│ │  4  │ 17:04:53 │ tool_use         │ Edit: src/app/login... ││
│ │  …  │   …      │   …              │   …                    ││
│ └───────────────────────────────────────────────────────────┘│
│   ↓ auto-scroll                                              │
└─────────────────────────────────────────────────────────────┘
```

Badge `●` cores: verde (realtime), amarelo (polling), vermelho (disconnected).

## 10 · Integrações

- **F1 (forge-event-ssot)** é pré-requisito (sem eventos no DB, UI fica vazia).
- **F2 (forge-run-lifecycle)** complementa: badge superior mostra `status` que F2 atualiza.
- **F4 (forge-daemon-service)** independente.
- **F5 (forge-closeout-pr)** adicionará evento `pr_opened` com `prUrl` que UI mostra como link.

## 11 · Faseamento

1 fase. Big-bang: deletar rotas + criar componente + migrar página. UI muda atomicamente.

## 12 · Riscos

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| Realtime publication não inclui ForgeEvent | Média | Alta — UI fica muda | Migration de verificação: `SELECT pubname FROM pg_publication_tables WHERE tablename='ForgeEvent'`. Se faltar, adiciona em FUI-001. |
| RLS bloqueia select pro user logado | Baixa | Alta | Policy `ForgeEvent_select` permite owner+manager; testar com user comum. |
| Realtime channel quota excedida no Supabase | Baixa | Média | 1 channel por aba aberta; limite Supabase é centenas. Aceitável v1. |
| UI lenta com 5000+ eventos sem virtualização | Média | Média | Hard cap D10 + banner. Virtual list em Fase 2. |
| Deletar rotas quebra algo que ainda referencia | Baixa | Baixa | `grep -r "/api/forge/runs/.*stream"` antes de deletar. |

## 13 · Métricas de sucesso

| Métrica | Instrumento | Target |
|---|---|---|
| `/forge-spike/runs/<id>` mostra eventos durante run live | Manual: abrir página durante run, ver lista crescer | ≥ 1 evento novo a cada 5s mid-run |
| Latência evento DB → UI render | Manual: comparar `ts` do evento vs hora do render | p95 ≤ 500ms |
| Channel state durante 5min de uso | Console log do badge | ≥ 95% do tempo em `realtime` |
| Rota SSE não responde 200 (deletada) | `curl http://localhost:3000/api/forge/runs/<id>/stream` | 404 |
| Leak `Controller is already closed` some | `tail -f /tmp/forge-spike-dev.log \| grep -c "is already closed"` | 0 |

## 14 · Open questions

- (Fase 2) Virtualização da lista (react-window) pra runs > 5000 eventos.
- (Fase 2) Filtros UI por `kind` (mostrar só tool_use, ou só erros).

## 15 · Referências

- [src/components/forge/run-kanban.tsx:122-150](../../../src/components/forge/run-kanban.tsx) — exemplo de subscription Realtime existente, copiar padrão
- [src/lib/supabase/client.ts](../../../src/lib/supabase/client.ts) — getter client-side
- PRDs irmãos: [prd-forge-event-ssot.md](prd-forge-event-ssot.md), [prd-forge-run-lifecycle.md](prd-forge-run-lifecycle.md)
- Memory `project_ui_patterns`

## 16 · Stories implementáveis

```yaml
- id: FUI-001
  title: Garantir ForgeEvent + ForgeRun na publication Realtime
  description: Migration idempotente que ALTER PUBLICATION supabase_realtime ADD TABLE pra ForgeEvent e ForgeRun se não estiverem.
  acceptanceCriteria:
    - "supabase/migrations/20260601n_forge_realtime_publication.sql existe"
    - "ForgeEvent aparece em pg_publication_tables"
    - "ForgeRun aparece em pg_publication_tables"
    - "Migration roda sem erro mesmo se já estiver na publication"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_publication_tables WHERE tablename IN ('ForgeEvent','ForgeRun')"
      expected: "2"
  dependsOn: []
  estimateMinutes: 10
  touches:
    - supabase/migrations/20260601n_forge_realtime_publication.sql
  agentProfile: db
  passes: false

- id: FUI-002
  title: Implementar RunEventStream client component
  description: Initial fetch + Realtime subscribe + fallback poll + badge de estado. Hard cap 5000. Auto-scroll.
  acceptanceCriteria:
    - "src/components/forge/run-event-stream.tsx existe ('use client')"
    - "Exporta RunEventStream(props: { runId, maxRendered? })"
    - "useEffect faz initial fetch + subscribe + cleanup"
    - "Estado connectionState com 4 valores ('connecting','realtime','polling','disconnected')"
    - "Fallback poll dispara se canal não SUBSCRIBED em 5s"
    - "Cap 5000 eventos com banner 'showing last 5000' quando excede"
    - "Tipecheck passa"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit src/components/forge/run-event-stream.tsx"
      expected: ""
    - kind: lint
      command_or_query: "grep -c 'postgres_changes' src/components/forge/run-event-stream.tsx"
      expected: "1"
  dependsOn: ["FUI-001"]
  estimateMinutes: 30
  touches:
    - src/components/forge/run-event-stream.tsx
  agentProfile: ui
  passes: false

- id: FUI-003
  title: Migrar /forge-spike/runs/[id]/page.tsx pra server thin + client island
  description: Server fetch da meta do run via DAL + render <RunEventStream>. Remove código SSE inline.
  acceptanceCriteria:
    - "page.tsx é server component (sem 'use client')"
    - "Faz await supabase.from('ForgeRun').select().eq('id',id).maybeSingle()"
    - "Renderiza header com status + <RunEventStream runId={id} />"
    - "Código SSE / EventSource removido"
    - "Tipecheck passa"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit src/app/forge-spike/runs/[id]/page.tsx"
      expected: ""
    - kind: lint
      command_or_query: "grep -c 'EventSource\\|new Response.*text/event-stream' src/app/forge-spike/runs/[id]/page.tsx"
      expected: "0"
    - kind: lint
      command_or_query: "grep -c 'RunEventStream' src/app/forge-spike/runs/[id]/page.tsx"
      expected: "1"
  dependsOn: ["FUI-002"]
  estimateMinutes: 20
  touches:
    - src/app/forge-spike/runs/[id]/page.tsx
  agentProfile: ui
  passes: false

- id: FUI-004
  title: Deletar rotas SSE e autoruns/[id]
  description: Remover arquivos. Garantir grep não acha referência viva.
  acceptanceCriteria:
    - "src/app/api/forge/runs/[id]/stream/route.ts não existe"
    - "src/app/api/forge/autoruns/[id]/route.ts não existe"
    - "Nenhum 'use' restante (`grep -r /api/forge/runs/.*stream src/` retorna 0)"
    - "Tipecheck passa"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p ."
      expected: ""
    - kind: lint
      command_or_query: "test -e src/app/api/forge/runs/[id]/stream/route.ts && echo EXISTS || echo OK"
      expected: "OK"
  dependsOn: ["FUI-003"]
  estimateMinutes: 10
  touches:
    - src/app/api/forge/runs/[id]/stream/route.ts
    - src/app/api/forge/autoruns/[id]/route.ts
  agentProfile: code
  passes: false

- id: FUI-005
  title: Smoke browser test
  description: Rodar dev server, criar run, abrir página, ver eventos chegando via Realtime.
  acceptanceCriteria:
    - "Página /forge-spike/runs/<id> abre sem erro no console"
    - "Lista cresce mid-run em ≤500ms após emit do daemon"
    - "Badge realtime fica verde ≥95% do tempo"
    - "Nenhum erro 'Controller is already closed' no log do Next"
  verifiable:
    - kind: manual_browser
      command_or_query: "bash scripts/forge/test-smoke-ui-realtime.sh"
      expected: "PASS"
  dependsOn: ["FUI-004"]
  estimateMinutes: 25
  touches:
    - scripts/forge/test-smoke-ui-realtime.sh
  agentProfile: ops
  passes: false

- id: FUI-006
  title: Sweep references mortas
  description: Achar e remover qualquer link/import pra rotas deletadas em outros componentes.
  acceptanceCriteria:
    - "grep -rE '/api/forge/runs/.*/stream|/api/forge/autoruns/' src/ retorna 0 matches"
    - "Tipecheck passa após sweep"
  verifiable:
    - kind: lint
      command_or_query: "grep -rE '/api/forge/runs/.*/stream|/api/forge/autoruns/' src/ | wc -l"
      expected: "0"
    - kind: typecheck
      command_or_query: "npx tsc --noEmit -p ."
      expected: ""
  dependsOn: ["FUI-004"]
  estimateMinutes: 15
  touches:
    - src/
  agentProfile: code
  passes: false
```
