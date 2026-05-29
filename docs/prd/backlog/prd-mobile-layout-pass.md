# PRD — Mobile Layout Pass (Headers · Listas · Hints)

**Status:** draft · pronto pra Rito 1 (Intake)
**Owner:** João Moraes
**Data:** 2026-05-29
**Tipo:** UI refactor (sem DB, sem API)
**Ralph-ready:** sim

---

## 1. Problema

Telas de detalhe e listagem da app estão **quebrando em mobile** (< 768px) porque o layout assume sempre "título + chips + ações na mesma row horizontal". Quatro sintomas concretos, capturados em prints da versão mobile:

1. **Headers de detalhe truncam o título** em ~10-15 chars porque dividem row com 2 botões de ação + chips. Observado em:
   - `/projects/[id]` — "Validação Inteligente…" trunca (título + chip `active` + Editar + Access)
   - `/clients/[id]` — nome do cliente trunca (título + Editar + Excluir)
   - `/meetings/[id]` — "Alinham…" trunca (título + chip tipo + chip status + Importar + Sugerir IA)

2. **`<PageHeader>` corta a description** — botão `+ Nova reunião` empurra texto pra direita, cortando a frase "Reuniões privadas e públicas. Cerimônias de projeto vivem no próprio projeto." em telas estreitas. Afeta `/meetings`, `/projects`, `/clients`, `/squads`, `/members`, `/agents`, `/workflow`.

3. **Linha de lista de reuniões esconde ações em mobile** — Editar/Remover usam `opacity-0 group-hover:opacity-100` ([meetings/page.tsx:401](src/app/(dashboard)/meetings/page.tsx#L401)), o que **não existe em touch**: usuário mobile não consegue editar/remover reunião pela lista.

4. **Hint de teclado promete `← →` em mobile** — `deck-stage.tsx:228` mostra "← → para navegar" mesmo sem teclado físico → afordância falsa.

Adicionalmente, `/clients` usa `<Table>` puro sem variante mobile ([clients-table.tsx:140-170](src/components/clients/clients-table.tsx#L140-L170)) — não há tampa em telas pequenas. (Note: `/projects` e `/members` já têm `*CardMobile` com kebab — esses estão OK.)

---

## 2. Solução em uma frase

Criar **um primitivo `<DetailHeader>`** que estrutura headers de detalhe (título / chips / metadata / ações) com regra mobile interna fixa, tornar **`<PageHeader>` responsivo**, e padronizar **kebab `⋯` sempre-visível** em listas mobile-relevantes.

---

## 3. Não-objetivos

- **Não** redesenhar desktop. Mudanças só atuam abaixo de `md` (768px); ≥ 768px fica idêntico ao atual.
- **Não** mexer em `SprintRibbon`, `PMReviewRibbon`, `PlanningRibbon` — já têm responsividade aceitável (horizontal-scroll / flex-wrap). Backlog separado se virar problema.
- **Não** mexer em `/projects` list, `/members` list, `/agents` list, `/workflow` — já têm `*CardMobile` ou shape responsivo.
- **Não** mexer em headers de PRD detail, Squad detail, Member detail, PM Review detail, Planning detail — não têm "título + chips + 2 ações inline", o problema não se manifesta lá.
- **Não** mexer em `ResponsiveSheet`/`ResponsiveDialog` — já são mobile-first.
- **Não** introduzir FAB flutuante, sticky bottom action bar, swipe gestures. Out-of-scope.
- **Não** trocar a tipografia / cores / iconografia. Só a estrutura responsiva.

---

## 4. Personas e jornada

| Persona | Como hoje | Como deve ficar |
|---|---|---|
| **João (PM, mobile)** | "Abro `/meetings/[id]` no celular e o título da reunião fica cortado em `Alinham…`. Tenho que entrar pra ver qual é." | "Título inteiro visível, ações secundárias num menu `⋯` no canto." |
| **Yasmin (Builder, mobile)** | "Quero editar uma reunião da lista pelo celular mas não tem botão. Hover não funciona aqui." | "Kebab `⋯` em cada linha, sempre visível em touch." |
| **Bruno (Lead, mobile)** | "O header da página `/meetings` tem uma descrição importante que sempre é cortada pelo botão Nova reunião." | "Em mobile, descrição full-width; botão Nova reunião desce pra row própria com largura cheia." |
| **Camila (Guest, mobile)** | "Vejo o header de projeto sem botões (não posso editar), mas o título ainda trunca por causa do chip de status." | "Título full-width; chip de status desce pra row com o nome do cliente." |

---

## 5. Decisões fixadas

| Dn | Decisão | Por quê |
|----|---|---|
| **D1** | Criar primitivo `<DetailHeader>` em `src/components/ui/detail-header.tsx` em vez de mexer caso-a-caso. | 3 telas consomem hoje, outras vão consumir. Single source of truth pra regra mobile. |
| **D2** | `<DetailHeader>` aceita props: `backHref`, `title`, `subtitle?`, `chips?: ReactNode`, `metaRow?: ReactNode`, `actions?: DetailHeaderAction[]`. | API mínima cobre os 3 casos atuais e os futuros. `chips` e `metaRow` são `ReactNode` pra preservar liberdade visual. |
| **D3** | `actions` é array de `{ label, icon, onClick, variant?: "default" \| "destructive", primary?: boolean }`. Em mobile **todas viram itens de kebab `⋯`** (DropdownMenu). Em desktop, renderizam inline como `<Button size="sm">`. | Kebab esconde ações secundárias em mobile sem precisar de decisão visual ad-hoc. Em desktop continua igual ao atual. |
| **D4** | Breakpoint da regra responsiva = **`md` (768px)**, mesmo do `useIsMobile()`. Não usar `sm:`. | Consistência com o resto da app (`ResponsiveSheet`, sidebar). Telefones em landscape (até 767px) recebem o tratamento mobile. |
| **D5** | Layout mobile do `<DetailHeader>`: row1 `← Título full (wrap até 2 linhas)` `[⋯ se há actions]` · row2 chips · row3 subtitle · row4 metaRow. **Nenhum botão inline em mobile** — só kebab. | Título nunca trunca. Hierarchy clara: identidade → estado → contexto → ações. |
| **D6** | Layout desktop do `<DetailHeader>`: row1 `← (Título · chips) (actions inline à direita)` · row2 subtitle · row3 metaRow. **Idêntico ao atual de cada tela** — sem regressão visual em desktop. | Não introduzir mudança em telas grandes. Refactor é puramente mobile-driven. |
| **D7** | `<PageHeader>` em `src/components/page-header.tsx` ganha responsividade in-place (não criar v2). Em < `md`: stack vertical com botão `w-full` em row própria. Em ≥ `md`: idêntico ao atual. | 7 rotas se beneficiam de graça. Compatibilidade total — sem migração de chamadores. |
| **D8** | Linhas de lista de reuniões: **kebab `⋯` sempre-visível** (não-hover) em mobile, contendo Editar + Remover. Em desktop, manter hover (`opacity-0 group-hover:opacity-100`) como hoje. | Mobile não tem hover; usuário hoje não consegue editar/remover. Desktop fica idêntico. |
| **D9** | Em mobile (< md), no item de lista de reunião: row1 `🔒/👁 + título full + ⋯` · row2 `[KIND] · data` · row3 condicional `🔗 pills de projetos`. Trazer data de volta em mobile (hoje é `hidden sm:inline`). | Data é útil em mobile. Wrap em 2-3 rows acomoda sem competição horizontal. |
| **D10** | `/clients` ganha `ClientCardMobile` no padrão de `ProjectCardMobile`/`MemberCardMobile` (kebab no canto, título + truncate em 1 row, metadata abaixo). Table fica em ≥ md. | Padrão já consagrado no repo. Não inventar shape novo. |
| **D11** | Hint `← → para navegar` em [deck-stage.tsx:228](src/components/deck/deck-stage.tsx#L228) ganha `hidden md:inline-flex`. Contador `01 / 10` permanece. | Affordance falsa em touch. Contador é informação útil em qualquer device. |
| **D12** | **3 PRs**, paraleláveis após o PR1: PR1 = primitivo + PageHeader · PR2 = migração das 3 telas detail + listas · PR3 = hints. PR1 não pode ser merged junto com PR2 (PR2 depende dele). | Reduz blast radius por PR. PR1 é foundational; PR2 e PR3 são consumers independentes. |
| **D13** | Sem feature flag. Mudança é puramente visual e reversível por revert. | Sobre-engenharia pra uma pass de UI. |
| **D14** | Sem testes unitários novos. Verificação = inspeção manual em viewport mobile (375px iPhone SE, 768px iPad portrait) + typecheck + lint. | Componente é puramente apresentacional. Snapshot/E2E custoso pro retorno. |

---

## 6. Arquitetura

```
┌──────────────────────────────────────────────────────────────┐
│                    src/components/ui/                         │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ <DetailHeader>  (NOVO)                                  │ │
│  │  ├─ Desktop: row1 inline · row2 sub · row3 meta         │ │
│  │  └─ Mobile (< md, via useIsMobile):                     │ │
│  │      row1 título full + ⋯ · row2 chips · row3 sub · …  │ │
│  └─────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ <PageHeader>  (MODIFICADO — responsivo)                 │ │
│  │  ├─ Desktop: row única                                  │ │
│  │  └─ Mobile: 3 rows (h1 / desc / botão w-full)           │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
                            ▲
            ┌───────────────┼─────────────────────┐
            │               │                     │
            │ consume       │ consume             │ consume
            │               │                     │
┌───────────┴───────┐  ┌────┴───────┐  ┌──────────┴────────┐
│ /projects/[id]    │  │ /clients/  │  │ /meetings/[id]    │
│ /clients/[id]     │  │ /squads/   │  │ /projects/[id]    │
│ /meetings/[id]    │  │ /members/  │  │ ...               │
│                   │  │ /meetings/ │  │                   │
│ (DetailHeader)    │  │ /agents/   │  │ (PageHeader)      │
└───────────────────┘  │ /workflow/ │  └───────────────────┘
                       └────────────┘

┌──────────────────────────────────────────────────────────────┐
│  Listas mobile (mudança in-place no item)                    │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ /meetings — item ganha kebab sempre-visível em mobile   │ │
│  │ /clients  — ganha ClientCardMobile (Table só ≥ md)      │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  Hints                                                       │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ deck-stage.tsx — "← → para navegar" hidden md:inline    │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**Componentes novos:**
- `src/components/ui/detail-header.tsx` — `<DetailHeader>` + tipo `DetailHeaderAction`
- `src/components/clients/client-card-mobile.tsx` — novo, padrão `ProjectCardMobile`

**Componentes modificados:**
- `src/components/page-header.tsx` — responsivo
- `src/app/(dashboard)/projects/[id]/page.tsx` — header atual → `<DetailHeader>`
- `src/app/(dashboard)/clients/[id]/page.tsx` — header atual → `<DetailHeader>`
- `src/app/(dashboard)/meetings/[id]/page.tsx` — header atual → `<DetailHeader>`
- `src/app/(dashboard)/meetings/page.tsx` — item de lista ganha kebab mobile
- `src/components/clients/clients-table.tsx` — wrapper desktop/mobile (Table ≥ md, lista de Cards < md)
- `src/components/deck/deck-stage.tsx` — hint hidden md:inline-flex

---

## 7. Schema

**N/A** — pass puramente UI. Sem migrations, sem alterações em `database.types.ts`, sem RLS.

---

## 8. APIs

**N/A** — sem endpoints novos ou modificados. Nenhuma rota em `src/app/api/` tocada.

---

## 9. UX — wireframes por tela e circunstância

### 9.1 `/projects/[id]` — header de projeto

**Mobile (< 768px):**

```
─────────────────────────────────────
Active · canEdit · canManageAccess
┌───────────────────────────────────┐
│ ←  Validação Inteligente      ⋯  │  row1: título wrap até 2 linhas
│    de Escalas                     │
│    Allos · [● active]             │  row2: subtitle + chip status
│    [VICO]  PM: João Moraes        │  row3: metaRow (refKey + PM)
└───────────────────────────────────┘
                   ⋯: Editar projeto · Access

Active · viewer (guest, sem canEdit)
┌───────────────────────────────────┐
│ ←  Validação Inteligente          │  sem kebab
│    de Escalas                     │
│    Allos · [● active]             │
│    [VICO]  PM: João Moraes        │
└───────────────────────────────────┘

Done · canEdit (cliente null)
┌───────────────────────────────────┐
│ ←  Projeto X                  ⋯  │
│    — · [● done]                   │  em-dash quando client é null
│    [VICO]  PM: …                  │
└───────────────────────────────────┘
```

**Desktop (≥ 768px):** idêntico ao atual ([projects/[id]/page.tsx:426-471](src/app/(dashboard)/projects/%5Bid%5D/page.tsx#L426-L471)).

### 9.2 `/clients/[id]` — header de cliente

**Mobile:**

```
canEdit (com email + phone)
┌───────────────────────────────────┐
│ ←  Allos                       ⋯  │
│    ✉ contato@allos.com.br         │  row2: chips (email/phone como pseudo-chips)
│    📞 +55 11 99999-9999           │
└───────────────────────────────────┘
                       ⋯: Editar · Excluir (destrutiva, em vermelho)

Sem contato
┌───────────────────────────────────┐
│ ←  Allos                       ⋯  │
│    Sem contato cadastrado         │  row2 italic muted
└───────────────────────────────────┘

Viewer
┌───────────────────────────────────┐
│ ←  Allos                          │  sem kebab
│    ✉ contato@allos.com.br         │
└───────────────────────────────────┘
```

**Desktop:** idêntico ao atual ([clients/[id]/page.tsx:415-464](src/app/(dashboard)/clients/%5Bid%5D/page.tsx#L415-L464)).

### 9.3 `/meetings/[id]` — header de reunião

**Mobile:**

```
Privada · concluída · canEdit
┌───────────────────────────────────┐
│ ←  Alinhamento Infra HITZ     ⋯  │  row1: título wrap
│    [🔒 Privada] [● Concluída]     │  row2: chips
│    quarta-feira, 27 maio 2026     │  row3: data como subtitle
└───────────────────────────────────┘
                       ⋯: Importar do Granola · Sugerir com IA

Pública · agendada · canEdit (cerimônia daily)
┌───────────────────────────────────┐
│ ←  Daily PGF                  ⋯  │
│    [📅 Daily] [● Agendada]        │
│    sexta-feira, 30 maio 2026      │
└───────────────────────────────────┘
                       ⋯: Importar reunião · Sugerir com IA

Viewer / sem canEdit
┌───────────────────────────────────┐
│ ←  Alinhamento Infra HITZ         │  sem kebab
│    [🔒 Privada] [● Concluída]     │
│    quarta-feira, 27 maio 2026     │
└───────────────────────────────────┘
```

**Desktop:** idêntico ao atual ([meetings/[id]/page.tsx:507-569](src/app/(dashboard)/meetings/%5Bid%5D/page.tsx#L507-L569)).

### 9.4 `<PageHeader>` — telas de lista

**Mobile (com `onAdd` + `description`):**

```
┌───────────────────────────────────┐
│ Reuniões                          │  row1: h1 full
│ Reuniões privadas e públicas.     │  row2: description full (sem corte)
│ Cerimônias de projeto vivem no    │
│ próprio projeto.                  │
│                                   │
│ [ + Nova reunião             ]    │  row3: botão w-full
└───────────────────────────────────┘
```

**Mobile (com `onAdd`, sem `description`):**

```
┌───────────────────────────────────┐
│ Projetos                          │  row1: h1
│                                   │
│ [ + Novo Projeto             ]    │  row2: botão w-full
└───────────────────────────────────┘
```

**Mobile (sem `onAdd`):** apenas h1 + description (sem mudança de comportamento, só não-quebra).

**Desktop (qualquer combinação):** idêntico ao atual ([page-header.tsx](src/components/page-header.tsx)).

### 9.5 `/meetings` — item de lista

**Mobile, todas as combinações:**

```
L1 — privada simples, canEdit
┌───────────────────────────────────┐
│ 🔒  Alinhamento Infra HITZ    ⋯  │  row1: ícone + título + kebab
│     [GERAL] · 27/05               │  row2: kind + data (dd/MM)
└───────────────────────────────────┘
                       ⋯: Editar · Remover

L2 — privada com projeto vinculado
┌───────────────────────────────────┐
│ 🔒  Alinhamento Infra HITZ    ⋯  │
│     [GERAL] · 27/05               │
│     🔗 HITZ Global                │  row3: pills condicionais
└───────────────────────────────────┘

L3 — privada com pendentes
┌───────────────────────────────────┐
│ 🔒  Alinhamento Propostas     ⋯  │
│     [GERAL] · 27/05 · ⚠ 1 pend.   │  pendentes inline na row2
└───────────────────────────────────┘

L4 — cerimônia PLANNING + pendentes + projeto
┌───────────────────────────────────┐
│ 👁  Alinhamentos: Escalas     ⋯  │
│     [PLANNING] · 27/05 · ⚠ 2 pend │
│     🔗 Escalas Médicas            │
└───────────────────────────────────┘

L5 — sem título, sem permissão
┌───────────────────────────────────┐
│ 🔒  Sem título                    │  italic muted, sem kebab
│     [GERAL] · 27/05               │
└───────────────────────────────────┘
```

**Desktop:** idêntico ao atual ([meetings/page.tsx:322-406](src/app/(dashboard)/meetings/page.tsx#L322-L406)) — só muda o `opacity-0 group-hover:opacity-100` que agora também aplica em mobile mas é sobrescrito pra `opacity-100` em < md.

### 9.6 `/clients` — lista de clientes mobile

**Mobile (`< md`):** stack de `<ClientCardMobile>` (novo). Shape espelha `ProjectCardMobile`:

```
┌───────────────────────────────────┐
│ Allos                          ⋯  │  row1: nome + kebab
│ ✉ contato@allos.com.br            │  row2: email truncate
│ 📞 +55 11 99999-9999              │  row3: phone (se houver)
│ 3 projetos                        │  row4: contagem
└───────────────────────────────────┘
                                ⋯: Editar · Excluir
```

**Desktop (`≥ md`):** Table atual ([clients-table.tsx:140-170](src/components/clients/clients-table.tsx#L140-L170)) preservada via `hidden md:block` wrapper.

### 9.7 Deck — hint de pagination

**Mobile:**

```
       01 / 10
```

**Desktop:**

```
  01 / 10  │  ← →  PARA NAVEGAR
```

---

## 10. Integrações

- **`useIsMobile()` ([src/hooks/use-mobile.ts](src/hooks/use-mobile.ts))** — single source of truth pro breakpoint 768px. `<DetailHeader>` usa.
- **`<DropdownMenu>` ([src/components/ui/dropdown-menu.tsx](src/components/ui/dropdown-menu.tsx))** — usado pelo kebab `⋯`. Padrão já consolidado em `ProjectCardMobile`/`MemberCardMobile`.
- **`<StatusChip>` ([src/components/ui/status-chip.tsx](src/components/ui/status-chip.tsx))** — chips de status passados como `ReactNode` em `chips` prop. Sem mudança no primitivo.
- **`<Button>` ([src/components/ui/button.tsx](src/components/ui/button.tsx))** — usado inline em desktop dentro de `<DetailHeader>`.
- **Telas que não consomem `<DetailHeader>` por opção** (mantêm shape atual): Member detail (banner + Gauge), Squad detail (banner + badges), PRD detail (Card+CardHeader), PM Review detail (ribbon), Planning/Rituals detail (ribbon). Justificativa: shape já mobile-tolerável; over-migration desnecessária.

---

## 11. Faseamento

### Fase 1 (PR1) — Primitivos
- Criar `<DetailHeader>` em `src/components/ui/detail-header.tsx`
- Tornar `<PageHeader>` responsivo
- **Entrega:** primitivos funcionando, mas ainda não consumidos pelos detail pages. `PageHeader` já melhora as 7 listas imediatamente.
- **Esforço:** ~2h
- **Critério "Fase 1 ≥ atual":** ✓ — listas já se beneficiam do `PageHeader` responsivo no merge do PR1.

### Fase 2 (PR2) — Migração de consumidores
- Migrar headers de `/projects/[id]`, `/clients/[id]`, `/meetings/[id]` pra `<DetailHeader>`
- Fix de mobile no item de lista `/meetings` (kebab sempre-visível)
- Criar `<ClientCardMobile>` e wrapper desktop/mobile em `clients-table.tsx`
- **Esforço:** ~3h
- **Dependência:** PR1 mergeado.

### Fase 3 (PR3) — Hints
- Esconder `← → para navegar` em mobile no deck-stage
- Sweep global por outras strings de hint de teclado (já validado: só 1 ocorrência user-facing)
- **Esforço:** ~30min
- **Dependência:** nenhuma — pode ir em paralelo com PR1/PR2.

**Total:** ~5h-6h de implementação. 3 PRs pequenos.

---

## 12. Riscos

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| **Regressão visual em desktop** ao introduzir `<DetailHeader>` | Média | Alto (5 telas) | Story de migração inclui `verifiable` com inspeção visual em desktop antes/depois. Branch preview no Vercel/staging. |
| **`useIsMobile()` em SSR retorna `false` no primeiro paint** (já é o comportamento do hook — line 8: `useState<boolean \| undefined>(undefined)`) → flash de desktop layout em mobile | Alta | Médio | Aceitar — hook já tem essa característica e é usado em todo o repo (ResponsiveSheet, sidebar). Não introduzir CSS-only alternativa porque complica API. Documentar na implementação. |
| **Kebab `⋯` esconde demais — usuário não acha "Editar"** | Baixa | Médio | Padrão já validado em `/projects` e `/members` (que usam mesma abordagem). Discoverability OK porque ícone é universal. |
| **`ConfirmDialog` (Remover/Excluir) não dispara corretamente do DropdownMenu** | Baixa | Médio | Padrão já existe em `ProjectCardMobile` ([projects-view.tsx:78-146](src/components/projects/projects-view.tsx)). Copiar shape. |
| **Quebra de typecheck em consumidores** ao mudar API do `PageHeader` | Baixa | Baixo | API do `PageHeader` é aditiva (sem mudança de signature). Typecheck local antes do push. |
| **Conflito com `SprintRibbon` em `/projects/[id]`** — ribbon usa `-mx-3 md:-mx-6` pra ocupar gutter; `<DetailHeader>` precisa coexistir | Baixa | Baixo | Header e ribbon são irmãos no DOM, não nested. Sem colisão. Verificar visual no PR2. |
| **Wrap do título em 3 linhas em telas muito estreitas** (< 360px) | Média | Baixo | Aceitável — `<360px` é minoria absoluta. Sem `line-clamp` (esconderia info). Se virar problema, adicionar `line-clamp-2` numa iteração futura. |

---

## 13. Métricas de sucesso

**Esta pass é puramente qualitativa — não há evento de produto a instrumentar.** Critérios verificáveis no Closeout:

| Métrica | Instrumento | Meta |
|---|---|---|
| **Título nunca trunca em viewport 375px** (iPhone SE) nas 3 telas detail | Inspeção manual via DevTools mobile emulation | 100% das 3 telas |
| **`+ Nova reunião` não corta description em 375px** em `/meetings` | Inspeção visual | passa |
| **Editar/Remover acessível em touch** em `/meetings` list | Tap no kebab abre menu com 2 itens | passa |
| **Zero regressão visual em desktop ≥ 768px** | Diff manual antes/depois nas 3 telas detail + 7 listas | zero diferença visual percebida |
| **Typecheck + lint passam** | `pnpm tsc --noEmit && pnpm lint` | exit 0 |
| **Nenhum consumidor de `<PageHeader>` quebra** | `grep -r "PageHeader" src/app/ src/components/` retorna mesmos 7 imports; cada rota carrega sem erro de runtime | passa |

Não há query SQL, não há evento de telemetria. Justificativa: UI refactor não introduz comportamento mensurável — só corrige rendering.

---

## 14. Open questions

**Vazio.** Todas as decisões fechadas em §5.

---

## 15. Referências

**Arquivos do código vivo:**
- Detail headers atuais: [projects/[id]/page.tsx:426-471](src/app/(dashboard)/projects/%5Bid%5D/page.tsx#L426-L471) · [clients/[id]/page.tsx:415-464](src/app/(dashboard)/clients/%5Bid%5D/page.tsx#L415-L464) · [meetings/[id]/page.tsx:507-569](src/app/(dashboard)/meetings/%5Bid%5D/page.tsx#L507-L569)
- `PageHeader`: [src/components/page-header.tsx](src/components/page-header.tsx)
- `useIsMobile`: [src/hooks/use-mobile.ts](src/hooks/use-mobile.ts)
- `DropdownMenu`: [src/components/ui/dropdown-menu.tsx](src/components/ui/dropdown-menu.tsx)
- `StatusChip`: [src/components/ui/status-chip.tsx](src/components/ui/status-chip.tsx)
- Padrão de kebab já consagrado: [projects-view.tsx ProjectCardMobile](src/components/projects/projects-view.tsx) · [members-view.tsx MemberCardMobile](src/components/members/members-view.tsx)
- Hint deck: [deck-stage.tsx:228](src/components/deck/deck-stage.tsx#L228)

**Memories relacionadas:**
- `project_ui_patterns.md` — padrões canônicos (ResponsiveSheet, ConfirmDialog, Field, optimistic)

**PRDs relacionados:**
- Nenhum direto. Pass independente.

---

## 16. Stories implementáveis

```yaml
- id: MOBLAY-001
  title: Criar primitivo <DetailHeader>
  description: |
    Criar `src/components/ui/detail-header.tsx` com props `backHref`, `title`,
    `subtitle?`, `chips?: ReactNode`, `metaRow?: ReactNode`, `actions?: DetailHeaderAction[]`.
    Tipo `DetailHeaderAction = { label: string; icon?: ReactNode; onClick: () => void; variant?: "default" | "destructive"; primary?: boolean }`.
    Internamente usar `useIsMobile()` pra alternar layout. Em mobile: row1 (← + título full + kebab DropdownMenu se actions.length > 0) · row2 chips · row3 subtitle · row4 metaRow. Em desktop: row1 (← + título inline + chips inline + actions inline à direita) · row2 subtitle · row3 metaRow.
    Sem styled-system novo — só Tailwind + tokens existentes.
  acceptanceCriteria:
    - "Arquivo src/components/ui/detail-header.tsx existe e exporta <DetailHeader> + tipo DetailHeaderAction"
    - "Componente respeita o breakpoint md (768px) via useIsMobile()"
    - "Em mobile, actions renderiza como DropdownMenu (kebab Lucide MoreVertical) — não inline"
    - "Em desktop, actions renderiza como <Button size='sm'> inline na mesma row do título"
    - "Quando actions.length === 0, kebab não aparece em mobile"
    - "Quando variant: 'destructive', item do DropdownMenu fica em vermelho (text-destructive)"
    - "Componente não introduz dependências novas"
  verifiable:
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "exit 0"
    - kind: lint
      command_or_query: "pnpm lint src/components/ui/detail-header.tsx"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "Renderizar <DetailHeader title='...' actions={[...]}/> em uma página de teste e validar em 375px e 1024px"
      expected: "Mobile mostra kebab; desktop mostra botões inline"
  dependsOn: []
  estimateMinutes: 30
  touches:
    - src/components/ui/detail-header.tsx

- id: MOBLAY-002
  title: Tornar <PageHeader> responsivo
  description: |
    Modificar `src/components/page-header.tsx`. Em < md, container vira `flex flex-col`,
    description fica full-width abaixo do h1, e o botão recebe `w-full` em uma row própria.
    Em ≥ md, layout permanece idêntico ao atual (`flex items-center justify-between`).
    API não muda — todos os 7 consumidores continuam funcionando sem alteração.
  acceptanceCriteria:
    - "src/components/page-header.tsx modificado in-place"
    - "API (title, description?, onAdd?, addLabel?) inalterada"
    - "Em mobile, h1 ocupa row completa, description ocupa row completa, botão w-full em row própria"
    - "Em desktop, layout idêntico ao commit anterior (visual diff zero)"
    - "Os 7 consumidores (/projects, /clients, /squads, /members, /meetings, /agents, /workflow) continuam typechecking"
  verifiable:
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "exit 0"
    - kind: lint
      command_or_query: "pnpm lint"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "Abrir /meetings em viewport 375px e 1024px; comparar com snapshot pré-mudança em desktop"
      expected: "Mobile: description não corta; botão w-full. Desktop: idêntico ao anterior."
  dependsOn: []
  estimateMinutes: 20
  touches:
    - src/components/page-header.tsx

- id: MOBLAY-003
  title: Migrar header de /projects/[id] para <DetailHeader>
  description: |
    Substituir o bloco JSX em [projects/[id]/page.tsx:426-471] pelo uso de `<DetailHeader>`.
    Mapping:
      - backHref="/projects"
      - title={project.name}
      - subtitle={project.client?.name ?? "—"}
      - chips={<StatusChip tone={...} dot>{project.status}</StatusChip>}
      - metaRow={<>[refKey] · PM: {project.pm.name}</>}
      - actions: [{ label: "Editar projeto", icon: <Pencil/>, onClick: () => setEditOpen(true) }, canManageAccess && { label: "Access", icon: <Shield/>, onClick: () => setAccessOpen(true) }].filter(Boolean)
    Quando canEdit é false, actions = []. Quando canManageAccess é false, só Editar.
    Manter SprintRibbon e tabs intactos abaixo do header.
  acceptanceCriteria:
    - "Header antigo (linhas ~426-471) substituído por <DetailHeader> com props mapeadas"
    - "SprintRibbon e Tabs continuam renderizando após o header"
    - "Em mobile 375px, título nunca trunca (wrap permitido)"
    - "Em desktop, layout visualmente idêntico ao anterior"
    - "viewer/guest (sem canEdit) não vê kebab"
  verifiable:
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "Navegar pra /projects/<id-existente> em 375px e 1024px; testar como manager (vê 2 ações) e como viewer (sem ações)"
      expected: "Mobile mostra kebab com Editar/Access; desktop inline; viewer sem kebab"
  dependsOn: [MOBLAY-001]
  estimateMinutes: 25
  touches:
    - src/app/(dashboard)/projects/[id]/page.tsx

- id: MOBLAY-004
  title: Migrar header de /clients/[id] para <DetailHeader>
  description: |
    Substituir o bloco em [clients/[id]/page.tsx:415-464] por <DetailHeader>.
    Mapping:
      - backHref="/clients"
      - title={client.name}
      - chips: nenhum (cliente não tem status chip)
      - subtitle: composição condicional do email/phone (ver §9.2). Renderizar como React node com <Mail/> e <Phone/> inline; se ambos null, "Sem contato cadastrado" italic muted.
      - actions: [{ label: "Editar", icon: <Pencil/>, onClick: openEditClient }, { label: "Excluir", icon: <Trash2/>, variant: "destructive", onClick: confirmDeleteClient }]
    Preservar bloco "notes" e ClientInsightsCard abaixo do header (estão fora do bloco a substituir).
  acceptanceCriteria:
    - "Header (linhas ~415-464) substituído por <DetailHeader>"
    - "Excluir aparece em vermelho no kebab mobile e como variant='destructive' inline em desktop"
    - "Em mobile 375px, nome do cliente nunca trunca"
    - "viewer (sem canEditClient) não vê kebab — ajustar lógica de conditional actions"
    - "Bloco de notes e ClientInsightsCard preservados intactos abaixo do header"
  verifiable:
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "Abrir /clients/<id> em 375px e 1024px; testar com client.notes setado e sem notes; testar com email+phone, só email, e sem nenhum"
      expected: "Todas as combinações renderizam sem corte. Excluir sempre em vermelho."
  dependsOn: [MOBLAY-001]
  estimateMinutes: 25
  touches:
    - src/app/(dashboard)/clients/[id]/page.tsx

- id: MOBLAY-005
  title: Migrar header de /meetings/[id] para <DetailHeader>
  description: |
    Substituir o bloco em [meetings/[id]/page.tsx:507-569] por <DetailHeader>.
    Mapping:
      - backHref="/meetings"
      - title={headerTitle}
      - chips={<><StatusChip tone={...}>{MEETING_TYPE_LONG_LABELS[meeting.type]}</StatusChip><StatusChip {...lookupChip(MEETING_STATUS, ...)} dot/></>}
      - subtitle: data formatada por extenso (extrair da lógica atual)
      - actions: canEdit ? [{ label: meeting.type === "private" ? "Importar do Granola" : "Importar reunião", icon: <Download/>, onClick: handleImportClick }, { label: "Sugerir com IA", icon: <Sparkles/>, onClick: handleSuggest }] : []
    Não tocar nas sections "PROJETOS VINCULADOS" e "To-dos" — só o bloco do header.
  acceptanceCriteria:
    - "Header (linhas ~507-569) substituído por <DetailHeader>"
    - "Em mobile 375px, título trunca quebrando linha (não com '…')"
    - "viewer/guest (sem canEdit) não vê kebab"
    - "Importar continua chamando handleImportClick e Sugerir continua chamando handleSuggest"
    - "Sections abaixo (Projetos vinculados, To-dos, Transcript, etc.) preservadas"
  verifiable:
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "Abrir uma /meetings/<id-privada-concluida> em 375px e 1024px; clicar Importar e Sugerir IA do kebab"
      expected: "Ambos os handlers disparam; modais abrem normalmente; sections abaixo intactas"
  dependsOn: [MOBLAY-001]
  estimateMinutes: 25
  touches:
    - src/app/(dashboard)/meetings/[id]/page.tsx

- id: MOBLAY-006
  title: Item de lista /meetings — kebab sempre-visível em mobile
  description: |
    Em [meetings/page.tsx:322-406], item da lista.
    Mudanças:
      1) Adicionar `<DropdownMenu>` com `<MoreVertical/>` trigger ao lado direito do item, contendo Editar e Remover. Visível sempre em mobile (< md), com `opacity-100` mobile e `opacity-0 group-hover:opacity-100 md:flex` em desktop pra preservar UX atual de desktop.
      2) Reorganizar conteúdo do <Link> em mobile: row1 (ícone + título full + kebab no extremo), row2 (KIND chip · data dd/MM · pendentes inline), row3 (pills de projetos condicionais).
      3) Trazer data de volta em mobile: trocar `hidden sm:inline` por sempre visível em mobile com `dd/MM` curto, e `dd/MM/yyyy` em desktop.
      4) Pendentes inline na row2: "· ⚠ N pend." em vez de chip separado.
    Desktop mantém shape e comportamento atual (hover Editar/Remover).
  acceptanceCriteria:
    - "Em mobile 375px, cada item tem kebab visível com Editar+Remover"
    - "Em mobile, título nunca trunca com '…' — wrap em 2 linhas se necessário"
    - "Em mobile, data dd/MM visível ao lado do KIND chip"
    - "Em mobile, pendentes aparecem inline ('· ⚠ 2 pend.') na row de metadata"
    - "Em desktop ≥ md, comportamento idêntico ao atual (hover, data full, etc)"
    - "Editar/Remover handlers (openEdit, remove) chamados corretamente do kebab mobile"
  verifiable:
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "Abrir /meetings em 375px; tap no kebab de uma linha; verificar que Editar abre sheet e Remover abre ConfirmDialog"
      expected: "Ambos funcionam em touch. Desktop mantém hover."
  dependsOn: [MOBLAY-001]
  estimateMinutes: 25
  touches:
    - src/app/(dashboard)/meetings/page.tsx

- id: MOBLAY-007
  title: Criar <ClientCardMobile> e wrapper desktop/mobile em /clients
  description: |
    1) Criar `src/components/clients/client-card-mobile.tsx` espelhando shape de `ProjectCardMobile` ([projects-view.tsx:78-146]):
       - <Link> com `surface block p-4 space-y-3 relative active:bg-accent/40`
       - Kebab `<DropdownMenu>` absolute top-2 right-2 com Editar + Excluir
       - h3 nome (truncate) + p email truncate + p phone (se houver) + p "N projetos"
    2) Em [clients-table.tsx], wrappar a Table atual em `<div className="hidden md:block">` e adicionar `<div className="md:hidden space-y-2">` com a lista de `<ClientCardMobile>` por cliente.
    3) Reusar handlers de Editar/Excluir já existentes no componente parent.
  acceptanceCriteria:
    - "Arquivo src/components/clients/client-card-mobile.tsx criado"
    - "Em mobile 375px, /clients mostra cards (não Table)"
    - "Em desktop ≥ md, /clients mostra Table idêntica à atual"
    - "Tap no kebab do card abre menu com Editar + Excluir (destructive)"
    - "Excluir dispara o mesmo ConfirmDialog do desktop"
  verifiable:
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "Abrir /clients em 375px e 1024px; testar Editar + Excluir via kebab mobile"
      expected: "Mobile mostra cards; desktop mostra Table; ambos editam/excluem corretamente"
  dependsOn: [MOBLAY-001]
  estimateMinutes: 30
  touches:
    - src/components/clients/client-card-mobile.tsx
    - src/components/clients/clients-table.tsx

- id: MOBLAY-008
  title: Esconder hint de teclado em mobile no deck-stage
  description: |
    Em [src/components/deck/deck-stage.tsx:228], envolver o span `"← → para navegar"`
    (e o separador adjacente se houver) com `hidden md:inline-flex`. Contador `01 / 10`
    permanece visível em todas as viewports.
  acceptanceCriteria:
    - "Em mobile 375px (qualquer deck), texto '← → para navegar' não aparece"
    - "Contador (ex: '01 / 10') continua visível em mobile"
    - "Em desktop ≥ md, hint permanece igual ao atual"
  verifiable:
    - kind: typecheck
      command_or_query: "pnpm tsc --noEmit"
      expected: "exit 0"
    - kind: manual_browser
      command_or_query: "Abrir um deck (ex: /workflow/<algum-deck>) em 375px e 1024px"
      expected: "Mobile: só contador. Desktop: contador + '← → PARA NAVEGAR'"
  dependsOn: []
  estimateMinutes: 10
  touches:
    - src/components/deck/deck-stage.tsx
```

**Resumo do DAG:**
- MOBLAY-001 e MOBLAY-002 são raízes (sem deps).
- MOBLAY-003, 004, 005, 006, 007 dependem de MOBLAY-001.
- MOBLAY-008 é raiz independente.
- MOBLAY-002 é raiz independente.

**Paralelizável após PR1 (MOBLAY-001 + 002):** 003, 004, 005, 006, 007, 008 podem ser pegas em qualquer ordem por executores diferentes.

**Total:** 8 stories · 190 minutos (~3h efetivos) · ≤ 30 min cada · 100% com pelo menos 1 `verifiable` automatizável (typecheck) + 1 visual (manual_browser).

---

## Auto-checklist (do AGENTS.md)

- [x] §5 tem ≥ 8 decisões fixadas, zero TBD (14 decisões)
- [x] §7 marcado N/A com justificativa (não há schema)
- [x] §8 marcado N/A com justificativa (não há API)
- [x] §11 Fase 1 entrega mais que o atual (PageHeader responsivo nas 7 listas no merge do PR1)
- [x] §13 cada métrica tem instrumento explícito (inspeção visual + typecheck + lint + grep)
- [x] §14 vazio
- [x] §16 tem 8 stories, todas com `verifiable` automatizável (typecheck) + visual (manual_browser), total ≤ 25
- [ ] `scripts/ralph/features/mobile-layout-pass/prd.json` espelhando §16 — **a gerar pelo agente de Rito 1** (skill /ralph)

PRD pronto pra Rito 2 (Execução).
