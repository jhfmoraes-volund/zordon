# Runbook — Wiki Executiva (introdução + pulso + log de atividade)

> **Executor:** agente Claude Code, fresh context. Leia este runbook inteiro antes de tocar em código.
> **Pré-requisito:** Wiki já é sheet read-first no hero (`wiki-hero-sheet-runbook.md` concluído) e a v2 auto-gerada está em prod (composer + jobs + cron).
> **Commit:** ao final de cada story que passa os checks, `bash scripts/sync-main.sh -m "ZRD-JM-NN: wiki — <resumo>"`.
> **Mockup de referência:** `scratchpad/wiki-redesign-mockup.html` (artifact publicado) — fiel aos tokens charcoal.
>
> **Status (2026-06-21):** WER-001..006 implementadas e commitadas (ZRD-JM-183). `tsc` + `eslint` limpos; rotas compilam no bundler do Next (metrics → 401 auth, página → 302, sem erro de build). Falta apenas o walkthrough autenticado no browser (DoD §8).

## 1. Problema

- A Wiki abre como pilha plana de cards sem hierarquia. Quando não há sprint ativa, o "hero" colapsa para a string **"0%"** sozinha no topo (ver screenshot do usuário).
- **Nada diz o que é o projeto:** sem cliente, sem objetivo legível, sem linha do tempo (quando começou / quando entrega). A leitura executiva de 30s que a Wiki v2 prometia não existe.
- O conteúdo útil hoje depende 100% do LLM ("Gerar Wiki"). Projeto recém-criado abre com 4 cards vazios.
- A DAL ([wiki-metrics.ts](../../src/lib/dal/wiki-metrics.ts)) já computa `velocity` e `roadmap` que **nenhum componente renderiza** — payload morto.

## 2. Solução em uma frase

A Wiki abre com uma **introdução executiva determinística** (cliente · projeto · objetivo · linha do tempo), um **Pulso** de métricas escaneável no lugar do "0%", e um **log minimalista de Atividade recente** — tudo SQL, sem novo schema; a narrativa LLM fica enxuta (Objetivos + Highlights) abaixo.

## 3. Não-objetivos

- NÃO criar tabela nem coluna nova. Tudo sai de `Project`, `Client`, `Sprint`, `DesignSession`, `PlanningEvent`/`PlanningSession`, `ProjectPhaseEvent`, `PMReview`, `ProjectWikiSection`.
- NÃO mexer no composer LLM além de **remover** a seção `decisions` (D3).
- NÃO tocar em `/wiki/compose`, `/wiki/jobs`, cron `wiki-daily`, nem na lógica de suppress.
- NÃO adicionar edição manual (a Wiki v2 é auto-gerada — invariante do projeto).
- NÃO mexer no botão/posição do hero nem na abertura do sheet.

## 4. Decisões fixadas

| # | Decisão | Por quê |
|---|---------|---------|
| D1 | Introdução, Pulso e Atividade são **100% determinísticos (SQL)**; renderizam antes de qualquer "Gerar Wiki" | A tela nunca fica vazia; LLM vira enriquecimento, não resgate |
| D2 | `identity` e `activity` entram no payload de `getWikiMetrics` (mesmo endpoint `/wiki/metrics`, mesmo cache 5min) | Um único fetch; não criar endpoint novo |
| D3 | Seção LLM **`decisions` sai** (composer + schemas + render). Decisões aparecem como evento no log (ex: "Planning aplicada") | Decisão do usuário: enxugar, log absorve. Mantém Objetivos + Highlights |
| D4 | Ordem do sheet: Identidade → Pulso → Atividade → Objetivos → Highlights → Equipe → footer | Leitura executiva primeiro; narrativa LLM secundária |
| D5 | Objetivo one-liner na Identidade = bullet **`vision`** da seção `objectives` (já carregada pelo sheet), com `↳ fonte` clicável. Sem `vision` → linha muted "objetivo aparece ao aprovar DS de Inception" | Reusa o que o composer já extrai; não puxa DS pra DAL de métricas |
| D6 | Para evitar repetição, a narrativa "Objetivos" passa a renderizar só **Problema + Sinais** (vision sobe pro header) | Não mostrar a mesma frase 2×. `data.vision` continua persistido, só não re-renderiza abaixo |
| D7 | Linha do tempo = **cronograma de blocos reusando `Cronograma` (variant `mini`)**: 1 bloco por sprint, cor por atividade (entregue/corrente/futura), igual Planning/PM Review. Labels `Início · {startDate}` / `Entrega prevista · {endDate}` abaixo. Sem sprints → ribbon some (componente retorna null); datas nulas degradam gracioso (sem inventar) | Reuso do componente canônico (parity via prop, não cópia); grounded |
| D8 | Atividade = união de 5 fontes, ordenada por data desc, **top 6**. Cada evento: `kind` (ícone), título, data relativa, `href?` best-effort | Minimalista ("nothing too much"); kind dá ícone tonal |
| D9 | Cliente: **reusar componente `ClientLogo`** (clients/[id]/_components/client-logo.tsx) — já resolve public URL do bucket `client-logos` + fallback monograma. DAL devolve `clientName/clientLogoPath/clientLogoUpdatedAt` crus | Reuso > recriar; monograma embutido evita buraco visual |
| D10 | PFV no Pulso continua escondido pra guest (`useCanSeeFunctionPoints`), igual hoje | Sem mudança de modelo de acesso (D9 do PRD original) |

## 5. Mapa do código (estado atual)

| O quê | Onde |
|-------|------|
| Sheet da Wiki (orquestra fetch + render) | [src/components/project-wiki/wiki-sheet.tsx](../../src/components/project-wiki/wiki-sheet.tsx) |
| Hero string (`Sprint N · X% · ...`) | [src/components/project-wiki/wiki-hero.tsx](../../src/components/project-wiki/wiki-hero.tsx) |
| Seção narrativa (bullets + suppress) | [src/components/project-wiki/wiki-narrative-section.tsx](../../src/components/project-wiki/wiki-narrative-section.tsx) |
| DAL métricas determinísticas (cache 5min) | [src/lib/dal/wiki-metrics.ts](../../src/lib/dal/wiki-metrics.ts) |
| Endpoint métricas | [src/app/api/projects/[id]/wiki/metrics/route.ts](../../src/app/api/projects/[id]/wiki/metrics/route.ts) |
| Composer LLM (SECTIONS array) | [src/lib/wiki/composer.ts](../../src/lib/wiki/composer.ts) |
| Schemas + `NARRATIVE_SECTION_KEYS` | [src/lib/wiki/schemas.ts](../../src/lib/wiki/schemas.ts) |

Tabelas-fonte para Atividade: `Sprint` (startDate, status), `PlanningEvent` (createdAt, appliedCount) via `PlanningSession.projectId`, `DesignSession` (completedAt, title), `ProjectPhaseEvent` (changedAt, from/toPhase), `PMReview` (publishedAt, referenceWeek).

Cronograma de blocos (reuso): [src/components/timeline/cronograma.tsx](../../src/components/timeline/cronograma.tsx) — `Cronograma` + `CronogramaBlock`. Montagem de blocos por sprint (sort + bin) já feita em [planning/page.tsx](../../src/app/(dashboard)/projects/[id]/planning/page.tsx) ~L284-321 — espelhar essa lógica no WikiIdentity.

## 6. Stories

```yaml
- id: WER-001
  title: getWikiMetrics ganha bloco `identity` + sprints do cronograma
  description: >
    (a) Adicionar `identity` ao WikiMetrics: { clientName, clientLogoUrl|null,
    projectName, status, phase, phaseChangedAt, startDate|null, endDate|null }.
    clientLogoUrl resolvido de Client.logoStoragePath (public URL do bucket).
    Query do Project + join Client no Promise.all existente.
    (b) Adicionar `sprints: Array<{id, name, startDate, endDate, doneTaskCount}>`
    com TODAS as sprints do projeto (sem o limit 3 do velocity) — alimenta o
    cronograma de blocos. doneTaskCount reusa doneTasks já computado (por sprintId).
    Sem novo endpoint.
  acceptanceCriteria:
    - "WikiMetrics.identity e WikiMetrics.sprints existem e são tipados (não any)"
    - "clientLogoUrl é null quando logoStoragePath é null"
    - "startDate/endDate vêm como ISO ou null, sem inventar default"
    - "sprints inclui futuras e passadas, ordenado por startDate"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "sem erros"
    - kind: http
      command_or_query: "GET /api/projects/<id>/wiki/metrics → body.identity, body.sprints"
      expected: "identity com clientName/projectName/phase; sprints array"
  dependsOn: []
  estimateMinutes: 25
  touches: [src/lib/dal/wiki-metrics.ts]

- id: WER-002
  title: getWikiMetrics ganha feed `activity`
  description: >
    Adicionar `activity: Array<{kind, title, date, href?}>` ao WikiMetrics.
    União de 5 fontes (D8): Sprint iniciada (startDate), Planning aplicada
    (PlanningEvent.createdAt via PlanningSession do projeto, título com
    appliedCount), DS aprovada (completedAt), mudança de fase
    (ProjectPhaseEvent.changedAt, "from → to"), PM Review publicado
    (publishedAt, referenceWeek). Ordena por date desc, slice(0,6).
    kind ∈ {sprint, planning, design_session, phase, pm_review}.
  acceptanceCriteria:
    - "activity ordenado por date desc, no máximo 6 itens"
    - "cada item tem kind válido + title + date ISO"
    - "projeto sem eventos retorna [] (não quebra)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "sem erros"
    - kind: sql
      command_or_query: "SELECT count(*) FROM \"ProjectPhaseEvent\" WHERE \"projectId\"='<id>'"
      expected: "número ≥ 0 (sanity da fonte)"
  dependsOn: []
  estimateMinutes: 30
  touches: [src/lib/dal/wiki-metrics.ts]

- id: WER-003
  title: Componente WikiIdentity (com cronograma de blocos)
  description: >
    Novo src/components/project-wiki/wiki-identity.tsx: logo (ou monograma) +
    "Cliente · {nome}" + nome do projeto + StatusChip + chip de fase + objetivo
    one-liner (vision bullet, passado por prop) com ↳ fonte. Linha do tempo
    reusa `Cronograma` variant="mini": montar CronogramaBlock[] das
    sprints (espelhar useMemo de planning/page.tsx L284-321 — sort por
    startDate, kind por today vs janela, logCount = doneTaskCount). selectedKey
    = sprint corrente; onSelect no-op (read-first v1). Labels de data
    `Início`/`Entrega prevista` abaixo do ribbon. Trata os 3 casos de data (D7).
  acceptanceCriteria:
    - "Reusa Cronograma (não recria o componente de blocos)"
    - "Sem vision bullet, mostra hint muted (não vazio)"
    - "Sem sprints, ribbon some; sem startDate, omite labels de data"
    - "Logo cai pro monograma quando clientLogoUrl é null"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "sem erros"
    - kind: manual_browser
      command_or_query: "Abrir Wiki de projeto com sprints + cliente + datas"
      expected: "header com cliente, projeto, objetivo e ribbon de sprints colorido"
  dependsOn: [WER-001]
  estimateMinutes: 30
  touches: [src/components/project-wiki/wiki-identity.tsx]

- id: WER-004
  title: WikiPulse substitui a string do hero
  description: >
    Reescrever wiki-hero.tsx (ou novo wiki-pulse.tsx) como strip de 4 stats
    (Sprint · Concluído com barra · PFV · Próx. marco) usando os mesmos campos
    de metrics.hero. PFV escondido pra guest (D10). Visual conforme mockup.
  acceptanceCriteria:
    - "Sem sprint ativa, mostra '—' no slot de sprint (não some o bloco todo)"
    - "Barra de progresso reflete completionPercent"
    - "Guest não vê o stat de PFV"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "sem erros"
    - kind: manual_browser
      command_or_query: "Abrir Wiki como guest e como builder"
      expected: "PFV visível só pro builder"
  dependsOn: []
  estimateMinutes: 25
  touches: [src/components/project-wiki/wiki-hero.tsx]

- id: WER-005
  title: Componente WikiActivity (log)
  description: >
    Novo src/components/project-wiki/wiki-activity.tsx: timeline vertical
    minimalista (ícone tonal por kind + título + data relativa). Reusa o
    agoLabel/relative-date helper. href opcional vira link. Vazio → hint muted
    "sem atividade recente".
  acceptanceCriteria:
    - "Renderiza até 6 itens com ícone por kind"
    - "Item com href é clicável; sem href é texto"
    - "Lista vazia mostra hint, não some"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "sem erros"
    - kind: manual_browser
      command_or_query: "Abrir Wiki de projeto com sprint + planning recentes"
      expected: "log com eventos ordenados por data desc"
  dependsOn: [WER-002]
  estimateMinutes: 25
  touches: [src/components/project-wiki/wiki-activity.tsx]

- id: WER-006
  title: Remover seção `decisions` + remontar ordem do sheet
  description: >
    Tirar 'decisions' de SECTIONS (composer.ts), de NARRATIVE_SECTION_KEYS
    (schemas.ts) e de SECTION_KEYS/SECTION_TITLES/SECTION_HINTS + render
    (wiki-sheet.tsx). Montar a nova ordem (D4): WikiIdentity, WikiPulse,
    WikiActivity, Objetivos (só problema+sinais, D6), Highlights, Equipe,
    footer. Passar vision pro WikiIdentity e activity/identity pro pulse.
  acceptanceCriteria:
    - "Grep por 'decisions' em src/lib/wiki e project-wiki não retorna render ativo"
    - "Sheet renderiza na ordem de D4"
    - "Objetivos não repete a frase que está no header (vision)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "sem erros"
    - kind: lint
      command_or_query: "npx eslint src/components/project-wiki src/lib/wiki"
      expected: "sem erros"
    - kind: manual_browser
      command_or_query: "Gerar Wiki e conferir ausência de 'Decisões recentes'"
      expected: "sem card Decisões; Objetivos+Highlights presentes"
  dependsOn: [WER-003, WER-004, WER-005]
  estimateMinutes: 30
  touches:
    - src/components/project-wiki/wiki-sheet.tsx
    - src/lib/wiki/composer.ts
    - src/lib/wiki/schemas.ts
```

## 7. Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Datas (`startDate`/`endDate`) nulas na maioria dos projetos | Alta | Médio | D7: degrada gracioso ("em andamento" / omite barra), nunca inventa data |
| `PlanningEvent` exige join 2-hop (via `PlanningSession.projectId`) | Média | Baixo | Buscar planningSessionIds do projeto primeiro, depois eventos — padrão já usado na DAL |
| Remover `decisions` deixa rows órfãs em `ProjectWikiSection` | Baixa | Baixo | Inofensivas (não renderizam). Opcional: `DELETE WHERE sectionKey='decisions'` num passo manual, fora do código |
| Logo do Client via Storage com path inválido → imagem quebrada | Média | Baixo | D9: `onError` cai pro monograma; testar com path nulo e inválido |
| Sheet fica longo demais no mobile | Baixa | Médio | Identidade+Pulso+Atividade são compactos; narrativa enxuta (2 seções). Validar em 90dvh |

## 8. Definição de pronto

- `npx tsc --noEmit` e `npx eslint` limpos.
- Wiki de um projeto **com** cliente/datas/eventos mostra introdução executiva + pulso + log preenchidos sem clicar "Gerar Wiki".
- Wiki de um projeto **recém-criado** (sem DS, sem eventos) abre sem cards vazios dominando — identidade aparece, seções LLM mostram CTA/hint.
- Nenhuma seção "Decisões recentes" renderiza.
- Guest não vê PFV.
