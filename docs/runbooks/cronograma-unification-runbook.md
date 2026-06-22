# RUNBOOK — Cronograma unification (autônomo, NO-STOP)

> Executar o plano `docs/platform/cronograma-unification-plan.md` **sozinho, sem
> checkpoint humano**, fase por fase, com gate automático (`tsc` + `eslint`) ao
> fim de cada fase. Idioma alvo: **chip** (mockup `/tmp/cronograma-unified.html`,
> opção C). Tudo que varia entra por **prop**, nunca por cópia (doutrina
> parity-by-prop, memory `feedback_agent_ui_parity`).
>
> **Confie nos fatos abaixo — mas confirme no código antes de editar.** Este
> runbook já corrige dois erros do plano (ver §1). Sobrevive a compactação de
> contexto: cada fase é independente e re-verificável.

---

## 0. INVARIANTES (não-negociáveis)

1. **Casa única** = evoluir `src/components/timeline/cronograma.tsx`. NÃO criar sibling. (D3)
2. **Componente é agnóstico de domínio.** Nunca importa de `finance/` nem `overview/`.
   Paleta/tom de delivery entram por **prop** (`tone`). (D4)
3. **Aditivo → seguro.** Fase 0 não muda nenhum caller (aliases). Cada fase compila
   e roda sozinha. Reverter uma fase não quebra as anteriores.
4. **Gate por fase:** `npx tsc --noEmit` limpo + `npx eslint <arquivos tocados>` limpo.
   Sem isso, a fase NÃO está pronta.
5. **NÃO dar `git push`/`sync-main` sem o dono aprovar a revisão visual** (Fase 2/3
   mexem em pixels — o plano §7 exige revisão visual em prod). Deixar tudo na working
   tree (local-as-SSOT, memory `feedback_local_ssot`). Comando de envio fica no §6.
6. **Não reverter mudanças de outras sessões.** A working tree já trazia o refactor
   de Finanças em voo (ver §1) + arquivos não relacionados (`.assets/*.pdf`, migration
   `20260623h_finance_contract_period_ssot.sql`). Não tocar nesses.

---

## 1. CORREÇÕES AO PLANO (verificadas no código — grounded)

O plano estava certo na direção, errado em dois fatos. **Ambos confirmados por grep.**

- **C1 — Fase 3 toca SÓ `projetos-board.tsx`.** O plano §3 diz que o `SprintTimeline`
  (clone da grade `full`) tem callers em `dev/stories/page.tsx` e
  `sprint-ribbon/ribbon-drawer.tsx`. **Falso.** Existem DOIS `SprintTimeline` distintos:
  - `projetos-board.tsx:510` `function SprintTimeline({ stats })` — **local, não
    exportado**, usado só em `projetos-board.tsx:1790,1821`. ESTE é o clone da grade.
  - `src/components/sprint/sprint-timeline.tsx` — componente **card** (sprints+tasks+FP),
    exportado por `src/components/sprint/index.ts`. ESTE é o que `dev/stories` e
    `ribbon-drawer` importam. **Fora do escopo** (idioma diferente).
  ⇒ Fase 3 não toca `dev/stories` nem `ribbon-drawer`. Só `projetos-board.tsx`.

- **C2 — Finanças (Fase 1) já está meio-migrada (sessão anterior, não reverter).** A
  working tree já: deletou `finance-sprint-timeline.tsx`, removeu `NEUTRAL_PALETTE` de
  `contract-bands.ts`, removeu o `<FinanceSprintTimeline>` de `finance-project-sheet.tsx`,
  e **inlinou uma tira de chips por-contrato** dentro de `finance-contracts.tsx`
  (`covered.map(...)` → `<span class="size-6 ...">{shortName(s.name)}</span>`). ESSA tira
  inline é exatamente o que a Fase 1 troca por `<Cronograma shape="chip">`.

- **C3 — enums de `kind` divergem.** `CronogramaBlock.kind = past|current|future`
  (atividade). `ReguaSegment.kind = closed|hole|current|future` (delivery). O adapter da
  Fase 3 mapeia: `closed→past` (+`tone`), `hole→past`+`silent`, `current→current`,
  `future→future`.

---

## 2. ESTADO ATUAL (verificado)

`Cronograma` hoje: `{ blocks, selectedKey: string|null, onSelect, variant?: "mini"|"full" }`.
`CronogramaBlock = { key, dateLabel: string, label: string|null, kind, logCount }`.
`CronogramaRail` = label + `<Cronograma variant="mini">` + action à direita.

Callers (idioma chip — alvo):
| # | Arquivo | Hoje | Vira (alvo) |
|---|---|---|---|
| 1 | `app/(dashboard)/projects/[id]/planning/page.tsx` | `CronogramaRail` (mini) | ribbon (sem mudança visual) |
| 2 | `planning-session/planning-history-sheet.tsx` | `Cronograma variant="full"` | `shape="chip" layout="wrap"` |
| 3 | `app/(dashboard)/projects/[id]/pm-review/page.tsx` | `CronogramaRail` (mini) | ribbon |
| 4 | `pm-review/pm-review-week-sheet.tsx` | `Cronograma variant="full"` | `shape="chip" layout="wrap"` |
| 5 | `project-wiki/wiki-identity.tsx` | `Cronograma variant="mini"` (noop) | `shape="chip" layout="wrap" collapsible` |
| 6 | `apps/finance/finance-contracts.tsx` | tira inline de chips | `shape="chip" layout="scroll"` |
| 7 | `overview/projetos-board.tsx` `Regua`+`SprintTimeline` | grade local | `shape="ribbon"`/`shape="grid"` |

Helpers: `src/lib/date-utils.ts` (precisa de `fmtDayMonth`), `apps/finance/contract-bands.ts`
(`paletteFor(seq)→{dot,band,border,text}`), `projetos-board.tsx`
(`segmentColor`/`cellClass`/`segmentTitle`/`segmentValueLabel`/`segmentValueTone`/`ReguaSummaryLine`).

---

## 3. API ALVO de `cronograma.tsx`

```ts
export type CronogramaTone = { border: string; band: string; text: string };

export type CronogramaBlock = {
  key: string;
  indicator?: string;     // glifo do chip: "4"/idx da semana
  dateLabel?: string;     // "14 jun" (fmtDayMonth) — agora OPCIONAL
  value?: string;         // secundário: "1 log"/"3 notes"
  state?: "past" | "current" | "future";
  silent?: boolean;       // passado sem atividade → tracejado
  tone?: CronogramaTone;  // paleta explícita; omitir → tom de atividade do state
  title?: string;         // tooltip
  flagged?: boolean;      // marco ⚑ acima da célula (régua/PM Review)
  // legacy (aliases — Fase 0 mantém; remover quando todos os callers migrarem):
  label?: string | null;  // → title
  kind?: "past" | "current" | "future"; // → state
  logCount?: number;      // → value "N logs" + silent (===0)
};

export function Cronograma(props: {
  blocks: CronogramaBlock[];
  selectedKey?: string | null;          // opcional
  onSelect?: (key: string) => void;     // ausente ⇒ <span> (read-only)
  shape?: "chip" | "ribbon" | "grid";   // default "chip"
  layout?: "scroll" | "wrap";           // default "wrap"
  collapsible?: { previewCount: number };
  variant?: "mini" | "full";            // legacy alias: mini→ribbon, full→grid
}): JSX.Element | null;

export function deliveryTone(pct: number | null): CronogramaTone; // 85/50 → emerald/yellow/red, null→muted
```

**Resolução de shape:** `shape ?? (variant==="mini" ? "ribbon" : variant==="full" ? "grid" : "chip")`.

**Normalize interno** (legacy → novo, preserva render atual):
`state = b.state ?? b.kind ?? "past"` · `silent = b.silent ?? (b.logCount===0 && state==="past")` ·
`value = b.value ?? (b.logCount>0 ? "N log(s)" : undefined)` · `title = b.title ?? b.label ?? derivado`.

**Tom:** `resolved = block.tone ?? activityTone(state)` onde `activityTone`:
current→primary, past→emerald, future→muted, silent→tracejado.
`current` força ring primary + barra primary; `future` muted+opacity; `silent` dashed.
`tone` só preenche o **fill do passado**. Seleção = `ring-2 ring-primary ring-offset-1`
(convenção atual; consistente entre shapes).

**Shapes (do mockup `/tmp/cronograma-unified.html`):**
- `ribbon` = **idêntico ao `mini` atual** (`h-2.5 w-3.5 rounded-[3px]`, gap-[3px], wrap;
  scroll opcional). ⚑ acima quando `flagged`. (mockup pill 22×11 é ilustrativo — manter
  pixels atuais p/ zero-regressão na Fase 0; rails não mudam.)
- `chip` = box `h-[30px] min-w-[58px] rounded-[7px] border pl-1.5 pr-2.5 gap-1.5 font-mono`,
  fundo `tone.band`, borda `tone.border`; `ind` = `size-[18px] rounded-[4px]` (nº);
  `date` text-[11px] muted; `val` text-[10px] `tone.text`. `silent`→dashed/transparente.
- `grid` = **idêntico ao `full` atual** (`grid auto-fill minmax(64px,1fr)`, barra+value+date);
  `indicator` opcional (linha extra). Mantido p/ Fase 0; após Fase 2 só a régua (Fase 3) usa.

`collapsible={{previewCount}}`: se `blocks.length > previewCount`, mostra `previewCount` +
toggle "Ver mais (N) ⌄ / Ver menos ⌃" (`useState`). Substitui expand bespoke.

---

## 4. FASES (executar em ordem; gate ao fim de cada)

### Fase 0 — estender o componente (zero regressão) — só `cronograma.tsx` + `date-utils.ts`
1. `date-utils.ts`: add `fmtDayMonth(yyyyMmDd: string): string` → "14 jun", **UTC-safe**
   (espelha `fmtWeek`: `new Date(s+"T00:00:00Z")`, `getUTCDate`/`getUTCMonth`, `MONTHS_SHORT`).
2. `cronograma.tsx`: reescrever com a API do §3 (tipo + normalize + 3 shapes + collapsible +
   `deliveryTone` export). `CronogramaRail` segue casca, passa `shape="ribbon"`.
3. **Gate:** `npx tsc --noEmit` + `npx eslint src/components/timeline/cronograma.tsx src/lib/date-utils.ts`.
   Callers atuais NÃO mudam (passam `variant`+`{key,dateLabel,label,kind,logCount}` — todos
   aliases válidos; `selectedKey`/`onSelect` viram opcionais mas continuam passados).

### Fase 1 — Finanças → `Cronograma` — só `finance-contracts.tsx`
1. Trocar o bloco `covered.length > 0 && (...)` (tira inline `covered.map`) por:
   ```tsx
   <Cronograma
     shape="chip" layout="scroll"
     blocks={covered.map((s) => ({
       key: s.id, indicator: shortName(s.name),
       dateLabel: fmtDayMonth(s.startDate),
       tone: { border: pal.border, band: pal.band, text: pal.text },
       title: `${s.name} · ${fmtDate(s.startDate)} → ${fmtDate(s.endDate)}`,
     }))}
   />
   ```
   Sem `onSelect` (chips read-only; o clique pra escopar é no card inteiro — preservar).
   `shortName` fica local em finance (é transform caller-side "Sprint N"→"N").
2. Import `Cronograma` de `@/components/timeline/cronograma` e `fmtDayMonth` de `@/lib/date-utils`.
3. **Gate:** `tsc` + `eslint src/components/apps/finance/finance-contracts.tsx`. Visual = mockup §1.

### Fase 2 — chip em Planning / PM Review / Wiki
- **planning/page.tsx**: na construção dos blocks (`sorted.map`), add `indicator: shortName(s.name)`
  (ou nº da sprint) e `value: logCount>0 ? "${n} log(s)" : undefined`. Manter `kind`/`logCount`
  (rail ribbon ignora extras). Bloco órfão: indicator omitido.
- **planning-history-sheet.tsx**: `variant="full"` → `shape="chip" layout="wrap"`.
- **pm-review/page.tsx**: nos blocks, add `indicator` (idx/semana) e `value: review ? "${n} notes" : undefined`.
- **pm-review-week-sheet.tsx**: `variant="full"` → `shape="chip" layout="wrap"`.
- **wiki-identity.tsx**: `variant="mini"` → `shape="chip" layout="wrap" collapsible={{previewCount: 8}}`;
  blocks add `indicator: i+1` (idx da semana), `dateLabel: fmtDayMonth(start)`, `value: doneTaskCount || undefined`.
- Rails (CronogramaRail) seguem ribbon — sem mudança. *(revisado depois → ver Fase 4.)*
- **Gate:** `tsc` + `eslint` nos 5 arquivos. Visual = mockup §2/§3/§4. ⚠️ pixels mudam → revisão visual.

### Fase 4 — réguas (CronogramaRail) viram chip + responsivo — só `cronograma.tsx`
- `CronogramaRail`: desktop (≥md) = `<Cronograma shape="chip" layout="scroll">` (fileira de chips com
  scroll lateral; o bloco selecionado é auto-centralizado via `scrollIntoView` quando a seleção muda —
  espelha o `DSRibbon`). Mobile (<md) = `CronogramaRailSelect`, um `<Select>` dropdown (trigger mostra o
  bloco selecionado; lista completa no tap). Swap por **CSS** (`md:hidden` / `hidden md:block`), NÃO `useIsMobile`.
- Padrão de referência: `src/components/design-session/ribbon/ds-ribbon.tsx` (`DSStepSelect`).
- Cobre Planning + PM Review automaticamente (ambos passam por `CronogramaRail`) — **zero mudança nos callers**
  (os blocks já têm `indicator`/`dateLabel`/`value` desde a Fase 2).
- **Gate:** `tsc` + `eslint cronograma.tsx` limpos. Visual = rail desktop (chips rolando) + mobile (dropdown).

### Fase 3 — régua do overview — só `projetos-board.tsx` (ver C1) — **FEITO**
1. Adapter `segToBlock(g, i, milestoneIndex)` + `segTone(g)` (tom por kind, chip-aware):
   `state: closed→past · hole→past+silent · current · future` · `dateLabel: fmtDayMonth(g.monday)` ·
   `value: segmentValueLabel(g)` · `tone: segTone(g)` · `title: segmentTitle(g)` · `flagged: i===milestoneIndex`.
   `segTone`: closed→`deliveryTone(pct)`; current→primary; future→muted; hole→dashed (silent). `text`=`segmentValueTone(g)`.
2. `Regua` (board row + tooltip) → `<Cronograma shape="ribbon" size={sm|lg}>` (glance forte via `tone.bar`). Read-only.
3. `SprintTimeline` (local, expandida) → `<Cronograma shape="chip" layout="wrap">` + `<ReguaSummaryLine>` embaixo.
   **D1 (chip em tudo):** a régua expandida é CHIP, não grid (revisão do dono no side-sheet 2026-06-22).
4. **Side-sheet STATS:** removido o glance `Regua` + toggle "Ver mais/menos" (redundante com a chip-cronograma,
   que já carrega data+estado+entrega+breakdown). Dossier renderiza só `<SprintTimeline>`. Mortos removidos:
   `StatTip`, `ReguaSummaryTip`, `cellClass`, `segmentColor` + imports `Tooltip*`.
5. **`CronogramaTone` ganhou `bar?`** (fill forte .60–.70 da barra ribbon/grid) separado de `band` (.10, fundo do chip).
   `deliveryTone` devolve os dois. Régua glance usa `bar`; chip usa `band`+`text`.
6. **Gate:** `tsc` + `eslint projetos-board.tsx` limpos (só `set-state-in-effect` pré-existente). Visual = board + side-sheet.

### Final
- `npx tsc --noEmit` global + `npx eslint` em TODOS os arquivos tocados.
- Atualizar mockup se o chip divergir; relatar pendências (revisão visual + push).

---

## 5. GOTCHAS

1. **Zero-regressão Fase 0:** ribbon ≡ mini atual, grid ≡ full atual. Aliases obrigatórios
   nos campos do block (`label`/`kind`/`logCount`) — não remover até todos migrarem.
2. **`current` bar opacity:** unificar em `bg-primary/40` (valor do cronograma atual; a régua
   usava `/30` — diferença imperceptível, aceitável na revisão visual).
3. **⚑ marco:** só via `flagged?: boolean` (genérico). `Regua` sm não mostra ⚑ (milestoneIdx=null);
   só lg/grid. Não inventar prop de domínio.
4. **fmtDayMonth muda o formato da data da régua** ("16/06"→"16 jun") (D5) — esperado.
5. **eslint:** `npx eslint <arquivos>` (script `lint` = `eslint`). `tsc`: `npx tsc --noEmit`.
6. **`deliveryTone` exportado de `cronograma.tsx`** (agnóstico: só pct→tone). `projetos-board`
   importa dele; o adapter compõe o resto (text/band por segmento).

---

## 6. COMMIT / ENVIO (só após revisão visual aprovada pelo dono)

```bash
bash scripts/sync-main.sh -m "ZRD-JM-NN: cronograma — chip unificado (finance/planning/pm-review/wiki/overview)"
```
Sweepa TUDO (local-as-SSOT) — inclui os arquivos de outras sessões. Confira `git status` antes.
**Não rodar sem OK do dono** (revisão visual das Fases 2/3 em prod).

## 7. REFERÊNCIAS
- Plano: `docs/platform/cronograma-unification-plan.md` · Mockups: `/tmp/cronograma-unified.html`, `/tmp/finance-blocks-options.html`
- Código: `src/components/timeline/cronograma.tsx` · `src/lib/date-utils.ts` · `apps/finance/{finance-contracts,contract-bands}.tsx` · `overview/projetos-board.tsx` · `lib/dal/project-overview.ts` (`ReguaSegment`)
- Memories: `project_cronograma_unification` · `project_ui_patterns` · `feedback_agent_ui_parity` · `feedback_visual_mockups_for_ui` · `feedback_local_ssot` · `feedback_grounded_no_hallucination`
