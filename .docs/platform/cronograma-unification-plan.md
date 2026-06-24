# Cronograma — unificação dos "chips de cronograma"

> Plano de organização: convergir todas as tiras de blocos de semana/sprint
> (cronograma) num **único componente reutilizável**, no idioma de chip
> (indicador + data + valor opcional) alinhado em 2026-06-22. Mockups fiéis:
> `/tmp/finance-blocks-options.html` (opção de chip escolhida = C, horizontal) e
> `/tmp/cronograma-unified.html` (a mesma chip em cada circunstância).

## 1. Problema

Hoje existem **implementações paralelas** da mesma ideia — "uma fileira de blocos,
cada bloco = uma semana/sprint, colorido por estado, um é o corrente, clicável":

- `src/components/timeline/cronograma.tsx` — `Cronograma` + `CronogramaRail`. Idioma
  **barra colorida + valor + data**, variants `mini` (ribbon) e `full` (grade
  auto-fill 64px). Já compartilhado por Planning + PM Review + Wiki.
- `src/components/apps/finance/finance-contracts.tsx` — tira inline de **chips**
  (quadrado 24px, nº da sprint, paleta do contrato), recém-refatorada.

São o **mesmo padrão com dois desenhos diferentes**. Resultado: drift visual e
lógica duplicada (binning, formatação, paleta, seleção).

## 2. Solução em uma frase

Evoluir o `Cronograma` existente pra **casa única** (idioma de chip + modelo de
dado superset), e migrar Finanças + Planning + PM Review + Wiki + a régua de
projeto do overview pra ele — o que varia entra por **prop**, nunca por cópia
(doutrina parity-by-prop).

## 3. Inventário (verificado)

### No escopo (idioma chip — unificar)
| Lugar | Arquivo | Bloco hoje | Cor | Ação |
|---|---|---|---|---|
| Finanças contratos | `apps/finance/finance-contracts.tsx` | chip nº+data | paleta contrato | escopa DRE |
| Planning rail | `app/(dashboard)/projects/[id]/planning/page.tsx` | ribbon | atividade | abre histórico |
| Planning histórico | `planning-session/planning-history-sheet.tsx` | grade barra+logs+data | atividade | troca versão |
| PM Review rail/page | `app/(dashboard)/projects/[id]/pm-review/page.tsx` | ribbon | atividade | abre semana |
| PM Review week sheet | `pm-review/pm-review-week-sheet.tsx` | grade barra+notes+data | atividade | seleciona semana |
| Wiki STATS | `project-wiki/wiki-identity.tsx` | ribbon | atividade | leitura |
| **Régua de projeto (overview)** | `overview/projetos-board.tsx` (`Regua` mini + `SprintTimeline` grade) | ribbon + grade barra+%+data | **entrega %** | read-only (tooltip) |

> ⚠️ `SprintTimeline` é **clone byte-a-byte** do `full` do `Cronograma` (mesma grade
> `auto-fill,minmax(64px,1fr)`). Eliminá-lo é o maior ganho de dedup. Tem callers
> além do overview: `app/(dashboard)/dev/stories/page.tsx`,
> `sprint/sprint-ribbon/ribbon-drawer.tsx` — migrar toca os três.

### Fora do escopo (idioma diferente — NÃO mexer)
| Lugar | Por quê |
|---|---|
| `weekly-allocation.tsx` | Cards verticais de carga com expand. Não é tira de chips. |
| `members/[id]/_components/insights-tab.tsx` | Sparkline de barras (gráfico), não tira clicável. |

### Helpers compartilhados (reuso, não recriar)
- `src/lib/date-utils.ts` — `fmtDate`/`fmtWeek` etc. **Adicionar** `fmtDayMonth(yyyyMmDd)`
  → "14 jun", **UTC-safe** (igual `fmtWeek`; o `fmtDate` comum renderiza o dia −1 em
  UTC-3 pra datas date-only).
- `src/lib/pm-review/week.ts` — `weeksBetween`, `brtMonday`, `addWeeks`, `ddmm`.
- `src/lib/weekBuckets.ts` — `bucketSprintsByWeek` (usado pelos fora-de-escopo).
- `src/components/apps/finance/contract-bands.ts` — `paletteFor(seq)` → `{border,band,text,dot}`.
  A paleta **flui por prop** pro Cronograma; o componente NÃO importa de finance.

## 4. API unificada

### Modelo de dado (superset)
```ts
// src/components/timeline/cronograma.tsx
export type CronogramaTone = { border: string; band: string; text: string };

export type CronogramaBlock = {
  key: string;            // identidade estável → alvo do onSelect
  indicator?: string;     // glifo do chip: "4" (sprint) / idx da semana — opcional
  dateLabel?: string;     // "14 jun" (fmtDayMonth, UTC-safe) — opcional
  value?: string;         // secundário: "1 log" / "3 notes" — opcional
  state?: "past" | "current" | "future";
  silent?: boolean;       // passado sem atividade → tracejado
  tone?: CronogramaTone;  // paleta explícita (contrato); omitir → cor de atividade do state
  title?: string;         // tooltip (default derivado de label/value/state)
};
```
Compat: o `CronogramaBlock` atual (`{key,dateLabel,label,kind,logCount}`) é mapeável
1:1 — `label`→`indicator`/`title`, `kind`→`state`, `logCount`→`value`. Manter um
shim ou migrar os 4 callers de uma vez (Fase 0 mantém os campos antigos como aliases).

### Props de apresentação
```ts
export function Cronograma(props: {
  blocks: CronogramaBlock[];
  selectedKey?: string | null;          // opcional — read-only (régua) não seleciona
  onSelect?: (key: string) => void;     // ausente ⇒ blocos não-clicáveis (span, não button)
  shape?: "chip" | "ribbon" | "grid";   // default "chip"; mini→ribbon, full→grid (aliases)
  layout?: "scroll" | "wrap";           // default "wrap"; finance/rail usam "scroll"
  collapsible?: { previewCount: number }; // embute "Ver mais/menos" (some o expand bespoke)
}): JSX.Element | null;
```
- `CronogramaRail` (label + ribbon + ação à direita) — **mantido** como casca do topo.
- Rodapé "Semana de 15 jun + status" = **caller-owned** (detalhe contextual, fora da tira).

### Tom
`state` sempre cuida de corrente (ring `primary`) / futuro (muted) / silencioso
(`silent` → tracejado). O que varia é o **fill do passado**, resolvido por dois mecanismos:
- **Atividade** (default, sem `tone`): passado-ativo → `emerald` binário. Planning/PM/Wiki.
- **Explícito** (`tone` por bloco): caller passa `{border,band,text}`. Dois usos:
  - Finanças → `paletteFor(seq)` (identidade do contrato; ignora state).
  - **Régua de projeto → `deliveryTone(deliveryPct)`** (≥85 emerald · ≥50 amarelo ·
    <50 vermelho · null muted) — mesma escala do `segmentColor` atual.

Assim **não há 3º enum**: "delivery" é só tom explícito calculado pelo caller. O
componente continua agnóstico de domínio (nada de import de finance/overview).

## 5. Mapa de migração (chip em tudo)

| Lugar | shape | layout | indicator | value | tone | onSelect |
|---|---|---|---|---|---|---|
| Finanças contratos | chip | scroll | sprint nº | — | paleta contrato | escopa DRE |
| Planning rail | ribbon | scroll | — | — | atividade | abre histórico |
| Planning histórico | grid | wrap | sprint nº | N logs | atividade | troca versão |
| PM Review rail | ribbon | scroll | — | — | atividade | abre semana |
| PM Review week sheet | grid | wrap | semana | N notes | atividade | seleciona semana |
| Wiki STATS | chip | wrap + collapsible | sprint/semana | — | atividade | leitura |
| Régua projeto (mini) | ribbon | scroll | — | — | delivery (explícito) | — (read-only) |
| Régua projeto (expandida) | grid/chip | wrap | sprint nº | "85%"/"corrente"/"desligada" | delivery (explícito) | — (read-only) |

`ReguaSegment` → `CronogramaBlock`: `monday`→`key`/`dateLabel`(via `fmtDayMonth`),
`kind`→`state`(+`silent` quando `hole`), `deliveryPct`→`tone=deliveryTone(pct)` &
`value=segmentValueLabel`. `onSelect` ausente = read-only (prop opcional).

## 6. Faseamento (aditivo → seguro)

### Fase 0 — estender o componente (zero regressão)
- Adicionar `CronogramaTone`, campos novos no `CronogramaBlock` (mantendo os antigos
  como aliases), e os props `shape`/`layout`/`collapsible`.
- Tornar `onSelect`/`selectedKey` **opcionais** (read-only vira `span`, não `button`).
- `mini` ⇒ `shape="ribbon"`, `full` ⇒ `shape="grid"` (aliases) — callers atuais não quebram.
- Adicionar `fmtDayMonth` em `date-utils.ts` e um `deliveryTone(pct)` compartilhado.
- Verif: `tsc` limpo; os callers atuais renderizam igual a antes.

### Fase 1 — Finanças passa a usar o `Cronograma`
- Deletar a tira inline de `finance-contracts.tsx`; renderizar `<Cronograma shape="chip"
  layout="scroll" .../>` com `tone = paletteFor(seq)`, `indicator = shortName`,
  `dateLabel = fmtDayMonth(sprint.startDate)`.
- Mover `shortName` pra um helper compartilhado (ou pro próprio cronograma).
- Verif: `tsc`/`eslint`; visual idêntico ao chip atual de Finanças.

### Fase 2 — re-skin chip em Planning / PM Review / Wiki
- Trocar a grade `full` (barra+valor+data) pelo `shape="chip"` (indicador+data+valor),
  tom de atividade. Rail segue `ribbon`.
- Ajustar cada caller pra preencher `indicator`/`value` (sprint nº / "N logs"/"N notes").
- Verif: `tsc`/`eslint` + **revisão visual** (telas em prod — montar mockup antes se preciso).

### Fase 3 — régua de projeto (overview) no mesmo componente
- Migrar `Regua` (mini → `shape="ribbon"`) e **eliminar `SprintTimeline`** (= clone do
  `full`) → `<Cronograma shape="grid"/>` com `tone=deliveryTone(pct)`, sem `onSelect`.
- Mapear `ReguaSegment`→`CronogramaBlock` num adapter; mover `segmentValueLabel`/`deliveryTone`
  pra perto do componente (ou helper compartilhado).
- **Toca 3 arquivos** (overview, `dev/stories`, `sprint-ribbon/ribbon-drawer`) — re-testar os três.
- Preservar: marco ⚑, tooltip por célula (`segmentTitle`), breakdown (`ReguaSummaryLine`)
  ficam **fora** da tira (caller-owned). Verif: `tsc`/`eslint` + revisão visual do board.

## 7. Verificação
- Cada fase: `npx tsc --noEmit` + `npx eslint <arquivos>` limpos.
- Fase 1/2: comparar com mockup `/tmp/cronograma-unified.html`.
- Smoke manual: abrir sheet de Finanças (contrato com sprints), Planning (histórico),
  PM Review (semanas), Wiki (STATS) — seleção/escopo continuam funcionando.

## 8. Decisões fixadas (2026-06-22)
- **D1** — Idioma chip em **tudo** (Fase 2/3 completas), não híbrido.
- **D2** *(revisada)* — Escopo = **5** tiras do idioma chip: Finanças, Planning, PM Review,
  Wiki **e a régua de projeto do overview** (`Regua`/`SprintTimeline`). Fora: só
  `weekly-allocation` e `insights` (idioma de fato diferente).
- **D3** — Casa única = evoluir `src/components/timeline/cronograma.tsx` (não criar sibling).
- **D4** — Paleta/tom entra por prop; o componente não depende de `finance`/`overview`.
  "Delivery" não é enum novo — é tom explícito via `deliveryTone(pct)`.
- **D5** — Data via `fmtDayMonth` UTC-safe ("14 jun").
- **D6** — `onSelect` opcional: bloco sem handler é read-only (`span`), pra a régua.

## 9. Referências
- Código: `src/components/timeline/cronograma.tsx` · `src/components/apps/finance/finance-contracts.tsx`
  · `src/components/apps/finance/contract-bands.ts` · `src/lib/date-utils.ts` · `src/lib/pm-review/week.ts`
- Mockups: `/tmp/finance-blocks-options.html` · `/tmp/cronograma-unified.html`
- Memories: `project_cronograma_unification` · `project_ui_patterns` · `feedback_agent_ui_parity`
  · `feedback_visual_mockups_for_ui` · `project_sprint_week_model`
