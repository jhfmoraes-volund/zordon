# Planning — Staging Model (simplificação UX + backend)

> Sucede o modelo de 6 fases visíveis e substitui o ribbon de phase transitions por um padrão "staging atômico" inspirado no Briefing de Design Session.

## Motivação

Hoje `/rituals/[id]` expõe ao PM uma máquina de estados de 6 fases (`idle → reading → proposing → approving → closed → archived`) com 3 botões manuais ("Iniciar leitura", "Revisar", "Fechar"). Problemas:

- 5 das 6 fases não correspondem a uma decisão real do PM — são plumbing.
- "Iniciar leitura" é jargão; PM não pensa em fases, pensa em "estou planejando o sprint".
- Aprovação por proposta força N micro-decisões antes do PM ter visão do todo.
- Não há como "ajustar mid-sprint" — `UNIQUE(projectId, sprintId)` permite só 1 planning por sprint.

## Novo modelo: Planning = commit, Sprint = branch

```
Planning #1 (segunda) ──┐
Planning #2 (quarta)  ──┼──► Sprint 23 (estado atual = soma dos commits)
Planning #3 (sexta)   ──┘
```

- **Cada planning = uma sessão de staging atômica.** Vitória conversa, propõe, edita; nada aplica até `Concluir`.
- **Concluir = commit irreversível**, append-only. Aplica todas as `MeetingTaskAction(decision=pending)` da planning em cascata.
- **Sem reopen.** Pra reverter, PM abre **nova planning** na mesma sprint conversando com Vitória ("desfaz a criação da VLD-105, move VLD-101 de volta pro escopo original"). Histórico append-only é audit trail natural.
- **Status visível ao PM: 2 estados.** `Em planejamento` / `Concluída`. (Backend mantém as 6 fases internamente; UI mostra só essa dicotomia.)

### Por que não Reopen estilo Briefing

Briefing reverte porque criou tudo do zero (deletar = limpo). Planning faz `create | update | delete | move` em tasks existentes — reverter `update`/`delete` exigiria `previousState jsonb` em cada action + lógica de revert por tipo. **Mais código, menos clareza** que simplesmente abrir uma planning nova.

## UX

### Header (PlanningRibbon, espelha BriefingRibbon)

```
← Planning · Sprint 23 · 28/05    [Em planejamento]
  12 tasks · 5 propostas · 34 FP
                          [Contexto] [Concluir planning]
```

- Stats inline: tasks do sprint, propostas pendentes da planning, FP total.
- "Contexto" abre o ContextSheet atual (transcripts + reuniões linkadas).
- "Concluir planning" é o único botão de governance. CTA principal.
- Em `Concluída`: badge verde + botão removido. Sem "Reabrir".

### Layout (2 colunas)

```
┌────────────────────────────────┬──────────────────────────┐
│ Tasks do sprint                │ 🟣 Vitória               │
│                                │                          │
│ ▸ VLD-101 Login social         │ Li a daily de ontem.     │
│ ▸ VLD-102 Auth flow refactor   │ Vou propor 3 ajustes:    │
│ ── propostas pendentes ──      │ - Criar VLD-105...       │
│ + Nova: VLD-105 Recovery       │ - Mover VLD-102 pra      │
│ ≠ Alterar: VLD-101 → scope     │   próximo sprint         │
│ → Mover: VLD-102 → Sprint 24   │                          │
│                                │ [Pergunte ou peça algo]  │
└────────────────────────────────┴──────────────────────────┘
```

**Esquerda — Sprint workspace:**
- Lista de tasks atuais do sprint (reusa primitivas da lista de tasks do projeto).
- Propostas pendentes da Vitória aparecem inline, separadas por divisor "propostas pendentes". Cada uma com badge visual:
  - `+ nova` (tone green) — `create`
  - `≠ alterar` (tone blue) — `update`
  - `→ mover` (tone amber) — `move`
  - `− remover` (tone rose) — `delete`
- Click no card de proposta abre `MeetingTaskActionSheet` pra ver detalhe da Vitória + ajustar payload manualmente (já existe).
- Não há "aprovar/rejeitar individual" no card. Discordância acontece via chat ("não, essa não") → Vitória apaga a action.

**Direita — chat Vitória:**
- ConversationPanel atual (sem mudança).
- BriefingSheet **não vai existir** — notes da Vitória ficam no fluxo da conversa.

### Listagem de cerimônias (aba do projeto)

- Mostrar **todas** as plannings de cada sprint (ordem cronológica).
- Label: "Planning · Sprint 23 · 28/05" (data por extenso pra distinguir múltiplas plannings da mesma sprint).
- Agrupamento por sprint é polish — primeira versão pode ser flat.

## Mudanças de schema

### Migration 1 — remover constraint

```sql
ALTER TABLE "PlanningCeremony"
  DROP CONSTRAINT IF EXISTS "PlanningCeremony_projectId_sprintId_key";
```

(Conferir nome exato do constraint via `\d PlanningCeremony` antes — pode ser `..._sprintId_unique` ou similar.)

### Migration 2 — atalho na máquina de estados

Adicionar transição `* → closed` (qualquer fase ativa → closed) à matriz em `src/lib/planning/phase.ts` + regenerar trigger SQL via `npm run gen:phase-sql`. Razão: `Concluir planning` pode ser disparado em qualquer fase ativa (idle, reading, proposing, approving) — sem precisar passar por todas em sequência.

**Não** adicionar `closed → idle` (reopen não existe).

## Mudanças de código

| Arquivo | Mudança |
|---------|---------|
| `src/lib/planning/phase.ts` | Adicionar `[*, "closed"]` na matriz; manter precondições mínimas. Atualizar `transition()` + testes. |
| `scripts/gen-phase-sql.ts` | Regenerar trigger. |
| `supabase/migrations/<date>_planning_staging.sql` | Drop UNIQUE + replace phase trigger. |
| `src/lib/dal/planning.ts` | `createPlanning`: remove tratamento de "já existe". Nova função `concludePlanning(id)`: transação que (a) aplica todas as actions pending, (b) transição phase → closed, (c) stampa closedAt. |
| `src/app/api/planning/[id]/complete/route.ts` | **Novo.** POST. Valida acesso, chama `concludePlanning`. |
| `src/app/api/planning/[id]/phase/route.ts` | Remover endpoints manuais (Iniciar leitura / Revisar) — toda a transição manual desaparece. Manter só pra archived se ainda for usado. |
| `src/app/(dashboard)/rituals/[id]/page.tsx` | Remove `PhaseRibbon`. Substitui por `PlanningRibbon`. Substitui leftPane (BriefingTree + ProposalCard grid) por `SprintTaskList` com propostas inline. |
| `src/components/planning/planning-ribbon.tsx` | **Novo.** Stats + Contexto + Concluir. Espelha `BriefingRibbon`. |
| `src/components/planning/sprint-task-list.tsx` | **Novo.** Lista tasks do sprint + propostas pendentes inline com badges visuais. |
| `src/components/planning/briefing-tree.tsx` | **Remover.** Notes da Vitória não têm mais visualizador dedicado. |
| `src/components/planning/proposal-card.tsx` | Refatorar pra "inline row" em vez de card grande. Sem botões de aprovar/rejeitar (decisão é via chat). |
| `src/components/planning/planning-create-dialog.tsx` | Garantir auto-criação de sprint da semana vigente se não houver nenhuma no projeto. |
| `src/lib/agent/agents/vitoria/prompt.ts` | Atualizar: explicar modelo staging-commit; aprovação não é por proposta. |
| `src/components/meetings/cerimonies-tab.tsx` (ou equivalente) | Mostrar múltiplas plannings por sprint, ordenadas. |

## Auto-criação de sprint (no PlanningCreateDialog)

Se PM clica "Nova planning" em projeto sem sprint cadastrada:
1. Backend cria automaticamente sprint "Sprint N" na semana vigente (seg→dom da data atual, usando o helper em `src/lib/sprint-dates.ts`).
2. Planning é vinculada nessa sprint nova.
3. PM nunca vê erro "associe uma sprint primeiro".

Se já existir sprint da semana corrente, default vira ela (mas dropdown deixa escolher outra).

## Ordem de implementação

1. **Migration drop UNIQUE + phase shortcut + regenerar trigger.** Banco antes de código.
2. **DAL: `concludePlanning(id)` transacional + remover bloqueio em `createPlanning`.**
3. **API: `POST /api/planning/[id]/complete`. Remover endpoints manuais de phase transition.**
4. **UI: `PlanningRibbon` + `SprintTaskList` + remover `PhaseRibbon`/`BriefingTree`.**
5. **Vitória prompt: atualizar pro modelo staging.**
6. **PlanningCreateDialog: auto-sprint da semana vigente.**
7. **Lista de cerimônias: múltiplas plannings por sprint.**
8. **Smoke test + verify manual.**

Cada passo é mergeable independente. Banco primeiro porque é load-bearing pro resto.

## Riscos / drift

- **Vitória ainda menciona "fases" nos prompts atuais.** Auditar `vitoria/prompt.ts` + tools. Se a IA continuar falando "vou começar a leitura agora", a UX nova fica incoerente.
- **MeetingTaskAction existente em prod.** Plannings antigas (já concluídas) têm actions com decision/execution históricos — migration não deve mexer nesses dados. Só novos endpoints/UX.
- **`PlanningContextNote`** continua sendo gerada pela Vitória (ela mantém o registro pra si). Apenas o UI dedicado some — banco fica intacto.
- **Botão "Resetar briefing"** desaparece junto. Se PM ligou contexto errado, ele desfaz no chat ("dispensa essa nota") ou abre nova planning.

## Aberto

- Label da planning na listagem: "Planning · 28/05" ou "Planning #2 · Sprint 23"? Decidir após ver lista populada.
- Agrupar cerimônias por sprint na aba (collapsible) ou flat? Default flat; agrupa se ficar poluído.
- Permitir editar uma planning concluída (cosmético: título/data)? Sim — só `phase` é congelado.
