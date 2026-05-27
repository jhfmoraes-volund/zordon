# App shell + Alpha como ferramenta — V3

Plano unificado da experiência de UI do Volund: header sticky de "app desktop", sidebar atual mantida, e Alpha como **panel direito sob demanda** que empurra o conteúdo (estilo Notion AI). Substitui v1 (over-engineered shell) e v2 (sticky-only).

> **V3 — escopo:** integra header com botões de ação, Alpha-panel com reflow estilo Notion, mobile com Sheet pelo lado direito, e remoção do item "Alpha" da sidebar. Backend (path injection + tool) detalhado em [alpha-global-header-plan.md](../agents/alpha/alpha-global-header-plan.md) — mantido.

## Visão

Quando o gestor abre o Volund hoje, ele vê dashboard. Quando precisa do Alpha, abre uma bolha flutuante.

Quando ele abrir o Volund **depois desse plano**, ele continua vendo dashboard. Mas o app inteiro tem **chrome de app desktop** (header denso com botões, sidebar fixa, áreas demarcadas) e quando ele clica no botão Alpha no canto superior direito, o conteúdo **encolhe suave** dando lugar a um panel à direita com Alpha — sem perder de vista a tabela/board que ele tava olhando. Click no botão de novo, panel some, conteúdo volta ao tamanho original.

Isso é o que Notion faz quando você chama a IA. Isso é o que Cursor faz com o chat. É o padrão certo pra uma ferramenta de produtividade séria.

## Modelo mental

| Aspecto | Comportamento |
|---|---|
| Estado default | Layout 2 colunas: Sidebar + Main. Idêntico ao atual. |
| Toggle do Alpha | Click no botão no header → panel desliza pela direita, main encolhe com transição CSS |
| Conteúdo central | Sempre 100% visível, só fica mais estreito quando Alpha aberto |
| Persistência | Estado open/close salvo em localStorage por usuário |
| Mobile | Mesmo botão no header, mas abre Sheet lateral direita full-screen (sem reflow) |
| Builder (não-manager) | Botão Alpha não aparece, panel não existe — gate atual mantido |

## Layout (desktop)

```
┌──────────┬──────────────────────────────────────────────────────────────────┐
│          │  HEADER (sticky)                                                  │
│ SIDEBAR  ├──────────────────────────────────────────────────────────────────┤
│          │                                                                   │
│  Nav     │  MAIN CONTENT                                                     │
│          │  (sempre 100% visível; encolhe quando Alpha abre)                │
│          │                                                                   │
│          │                                                                   │
└──────────┴──────────────────────────────────────────────────────────────────┘

                                   ↓ click Alpha trigger ↓

┌──────────┬─────────────────────────────────────────┬────────────────────────┐
│          │  HEADER (sticky)                         │  ALPHA PANEL HEADER   │
│ SIDEBAR  ├─────────────────────────────────────────┼────────────────────────┤
│          │                                          │                        │
│  Nav     │  MAIN CONTENT (encolhido, ainda 100%    │  Alpha messages        │
│          │  visível, reflow suave)                  │                        │
│          │                                          ├────────────────────────┤
│          │                                          │  Composer              │
└──────────┴─────────────────────────────────────────┴────────────────────────┘
```

Larguras:
- Sidebar: 16rem (256px) expandida, 3rem (48px) icon — sem mudança
- Alpha panel: **24rem (384px)** quando aberto, **0** quando fechado
- Main: `flex-1` — toma o que sobra, com `transition-[flex-basis]`

Transição: `300ms ease-in-out` em ambas as direções.

## Layout (mobile)

```
┌────────────────────────────────────────┐
│  HEADER STICKY                          │
│  [☰]  Page title         [⚙] [Bot]     │
├────────────────────────────────────────┤
│                                         │
│  MAIN CONTENT (rola)                   │
│                                         │
│                                         │
└────────────────────────────────────────┘

       ↓ tap Alpha trigger ↓

Sheet side="right" ocupa 100% da viewport, sobrepõe o conteúdo (não reflow).
```

Mobile **não** faz reflow porque a tela é pequena demais — Sheet full-screen é a UX certa, igual ChatGPT/Claude mobile.

## Header — visual + componentização

O header é o ponto onde o app ganha cara de "ferramenta desktop". Não é só `<SidebarTrigger />` solto numa div como hoje.

### Estrutura

```
┌───────────────────────────────────────────────────────────────────────┐
│ [☰]  ·  Page title                    [Imperson?] · [📜] [⚙] [Bot]   │
└───────────────────────────────────────────────────────────────────────┘
 grupo-esq    centro                    grupo-status   grupo-acoes
```

Três zonas:
1. **Esquerda** — `SidebarTrigger` (sempre)
2. **Centro** — `<PageTitle>` slot (page-controlled, fallback derivado da rota)
3. **Direita** — grupo de status + grupo de ações

Separadores verticais sutis entre grupos: `<div className="h-5 w-px bg-border/50" />` — feel "barra de ferramentas".

### Botões da direita (V1)

| Botão | Ícone | Estado |
|---|---|---|
| Impersonação (admin only) | Avatar/badge | Visível só quando impersonando |
| Histórico do Alpha (manager only) | `History` | Botão ghost; click navega pra `/ops` ou abre dropdown de threads recentes |
| Settings (todo user) | `Settings` (futuro) | Não na V1 — preparar slot |
| **Alpha trigger** (manager only) | `Bot` | Toggle. Ativo: bg-primary/10 com primary text, ring-primary/20 |

### Estilo (consistente com design system)

- Tamanho dos botões icon: `size-9` (36px) — confortável pra touch e mouse
- Variante: `<Button variant="ghost" size="icon">` (existente no shadcn)
- Estado ativo (Alpha aberto): `data-[active=true]:bg-primary/10 data-[active=true]:text-primary data-[active=true]:ring-1 data-[active=true]:ring-primary/30`
- Tooltips em todos: ícone só, label aparece on hover
- Mono font em badges/contadores (ex.: contagem de mensagens não lidas no Alpha): `font-mono text-[10px]`

### Slot de título central

```tsx
// Em qualquer página:
<PageTitle>
  Projetos
  <PageTitle.Subtitle>23 ativos · 4 em risco</PageTitle.Subtitle>
</PageTitle>
```

Implementação via React Context + portal pro slot do header. Quando a página não declara, fallback derivado de `usePathname()`:
- `/projects` → "Projetos"
- `/projects/abc-123` → "Projeto" (entity name carrega via tool/data depois)
- `/sprints/xyz/board` → "Board do sprint"

Subtitle (opcional) em `text-xs text-muted-foreground font-mono` — vibe "status line".

### Atalhos de teclado

- `⌘B` / `Ctrl+B` — toggle sidebar (já existe)
- `⌘⇧A` / `Ctrl+Shift+A` — toggle Alpha panel (novo)
- `⌘K` / `Ctrl+K` — reservado pra command palette futuro (não na V1)

Tooltip do botão Alpha mostra "Alpha · ⌘⇧A".

## Alpha right panel — anatomia

```
┌────────────────────────────────────────┐
│ [Bot] Alpha     [+] [📜] [×]           │  ← panel header (h-12, bg muted/30)
├────────────────────────────────────────┤
│                                         │
│  [user msg →]                          │
│  [← assistant]                         │
│                                         │
│  ...                                    │  ← messages (flex-1, overflow-y-auto)
│                                         │
│                                         │
├────────────────────────────────────────┤
│  [textarea]                  [send]    │  ← composer (border-t, p-3)
└────────────────────────────────────────┘
```

### Header do panel

- Esquerda: `<Bot />` + "Alpha" em font-semibold
- Direita: `[+] Nova conversa` `[📜] Histórico` `[×] Fechar`
  - `+` → reset thread, mensagens limpas
  - `📜` → navega pra `/ops` (página dedicada de histórico fica acessível mas fora do sidebar)
  - `×` → fecha panel (mesmo que toggle no header)

Botões header do panel: `<Button variant="ghost" size="icon" className="size-7">` — menores que os do header global.

### Border + bg

- Panel root: `border-l border-border/50`
- Panel header: `bg-muted/30 border-b border-border/50`
- Contraste sutil com o main pra demarcar separação visual

### Mensagens

Reusa o que já tá em [alpha-chat.tsx](src/components/alpha-chat.tsx) — bubbles, tool indicators, markdown, loading state. Só muda o container.

### Composer

Reusa Textarea + Send button atuais. `pb-safe` aplicado no fim do panel pra mobile (Sheet) — no desktop o panel root já é full-height da viewport.

## Design system — tokens preservados

| Aspecto | Token / classe atual | Mantido? |
|---|---|---|
| Brand color | `--primary: oklch(0.577 0.2 18)` (Volund red) | ✓ |
| Dark mode default | `<html className="dark">` | ✓ |
| Font sans | Space Grotesk | ✓ |
| Font mono | JetBrains Mono | ✓ (usado em status/badges) |
| Border radius base | `--radius: 0.75rem` | ✓ |
| Sidebar bg | `--sidebar: oklch(0.13 0 0)` | ✓ |
| Border subtle | `border-border/50` | ✓ |
| Backdrop blur na chrome | `bg-background/95 backdrop-blur` | ✓ |
| Button variants | `ghost`, `default`, `outline`, `secondary` (shadcn) | ✓ |
| Icons | Lucide | ✓ |
| Mobile breakpoint | 768px (`md:`) | ✓ |

**Zero cores ou tokens novos.** Tudo composição do que já existe.

## Componentes — folder organization

```
src/components/app-shell/
├── shell.tsx                       # Layout root: flex container c/ Main + AlphaPanel
├── shell-header.tsx                # Header sticky com 3 zonas
├── shell-header-trigger-group.tsx  # Grupo de botões da direita do header
├── page-title/
│   ├── page-title.tsx              # API <PageTitle> + .Subtitle
│   └── page-title-portal.tsx       # Slot + provider
├── alpha/
│   ├── alpha-provider.tsx          # Context: open, threadId, messages, currentPath
│   ├── alpha-panel.tsx             # Right panel desktop (com reflow)
│   ├── alpha-sheet.tsx             # Sheet mobile side="right"
│   ├── alpha-trigger.tsx           # Botão no header (toggle)
│   ├── alpha-panel-header.tsx      # [Bot] Alpha [+][📜][×]
│   ├── alpha-messages.tsx          # Messages list
│   ├── alpha-composer.tsx          # Input + send
│   └── use-alpha-keyboard.ts       # ⌘L hook
├── action-bar/
│   ├── action-bar.tsx              # <ActionBar> public API
│   └── action-bar-portal.tsx       # Slot + provider
└── index.ts                        # Barrel
```

Pasta isolada → mudanças visuais ficam todas num lugar. `git revert` no PR de cada fase é simples.

## Backend (referência)

Detalhes em [alpha-global-header-plan.md](../agents/alpha/alpha-global-header-plan.md) — V2 dele continua válida pra:
- Threading com expiração 30min
- `currentPath` no body do POST
- Server-side enrichment em `buildOpsContext`
- Tool `get_current_page_context` opcional

A parte de UI daquele plano vira **superseded por este documento**.

## Decisões resolvidas

| # | Tema | Decisão |
|---|---|---|
| 1 | Alpha default state | Fechado. Aberto só por click. |
| 2 | Modo do panel desktop | Push (reflow) — main encolhe, ambos visíveis simultaneamente. |
| 3 | Largura panel desktop | 24rem (384px) fixo. Sem drag handle na V1. |
| 4 | Mobile sheet side | `side="right"` — simétrico com desktop. |
| 5 | Trigger location | Botão no header (canto direito). Mesmo lugar mobile + desktop. |
| 6 | Sidebar entry "Alpha" | Removida. `/ops` continua como rota, alcançada via botão histórico do panel. |
| 7 | Builder (não-manager) | Sem botão, sem panel. Gate atual mantido. |
| 8 | Persistência open/close | localStorage por usuário. |
| 9 | Atalho de teclado | `⌘⇧A` / `Ctrl+Shift+A`. Preserva mnemônico "A de Alpha", não conflita com sistema nem Chrome. |
| 10 | Header sticky | Sim, mobile + desktop. |
| 11 | Title slot central no header | Via `<PageTitle>` portal. Fallback derivado da rota. |
| 12 | Action bar (footers fixos) | `<ActionBar>` reusável com `pb-safe`. |
| 13 | Feature flag | Não. Cada fase é um PR atômico, git revert basta. |
| 14 | Pastas `_legacy/` | Não. Componentes novos isolados em `app-shell/`, layouts antigos sobrescritos diretamente. |

## Migração — fases

### Fase 1 — Header sticky novo (foundational)

Refundação visual do header sem ainda incluir Alpha.

- [ ] **1.1** Criar `src/components/app-shell/shell-header.tsx` — 3 zonas, sticky, backdrop blur
- [ ] **1.2** Criar `<PageTitle>` + portal — slot central
- [ ] **1.3** Criar `<ShellHeaderTriggerGroup>` — wrapper pros botões da direita com separadores
- [ ] **1.4** Atualizar [(dashboard)/layout.tsx](src/app/(dashboard)/layout.tsx):
  - Substituir `<div className="flex items-center gap-2 border-b ...">` pelo `<ShellHeader>`
  - Mover `SidebarTrigger` pra zona esquerda do shell
  - Mover badge de impersonação pra zona direita
- [ ] **1.5** Idem em [(focus)/layout.tsx](src/app/(focus)/layout.tsx)
- [ ] **1.6** QA visual: pixel diff zero (botão de sidebar trigger no mesmo lugar; impersonação badge no mesmo lugar). Sticky funciona em scroll mobile + desktop.

**Risco:** baixo. Refator visual de um arquivo, sem mexer em rotas ou state.

### Fase 2 — `<ActionBar>` componente

Resolve o problema original do footer do skills wizard sem cobrir home indicator.

- [ ] **2.1** Criar `src/components/app-shell/action-bar/action-bar.tsx`:
  ```tsx
  // Sempre `position: fixed inset-x-0 bottom-0 z-40 pb-safe`
  // Aceita `maxWidth` prop pra constrain inner content
  ```
- [ ] **2.2** Migrar [skills/page.tsx:337](src/app/(focus)/profile/skills/page.tsx#L337) — substituir bloco footer pelo `<ActionBar>`
- [ ] **2.3** QA mobile + iPhone PWA: botões acima do home indicator.
- [ ] **2.4** Decisão: migrar [meetings/new/page.tsx:327](src/app/(dashboard)/meetings/new/page.tsx#L327) também? Hoje funciona — só migrar se inconsistência aparecer.

**Risco:** baixo. Componente isolado, drop-in.

### Fase 3 — `<AlphaProvider>` (refactor sem mudança de UI)

Move state pra um único provider antes de mudar a apresentação. Comportamento visual continua igual ao atual (bolha flutuante bottom-right).

- [ ] **3.1** Criar `src/components/app-shell/alpha/alpha-provider.tsx`:
  - State: `isOpen`, `threadId`, `messages` (via useChat), `currentPath` (via usePathname)
  - Persistência: `lastOpenedAt` em memória, localStorage pro `isOpen`
  - Lógica de expiração de thread (30min) — alinhada com backend
- [ ] **3.2** Refatorar [src/components/alpha-chat.tsx](src/components/alpha-chat.tsx):
  - Ler estado do provider (não mais useState local)
  - Mantém JSX da bolha + Sheet mobile + painel desktop como tá
- [ ] **3.3** Wrap `<AlphaProvider>` no [(dashboard)/layout.tsx](src/app/(dashboard)/layout.tsx) — manager+ only
- [ ] **3.4** Páginas que renderizam `<AlphaChat>` não precisam mudar ainda — provider serve dados, UI atual continua
- [ ] **3.5** QA: comportamento idêntico, sem regressão. Estado preservado entre rotas (novo benefício).

**Risco:** médio. Refactor de state owner. Possível regressão se hooks reordenarem.

### Fase 4 — Right panel + reflow + remoção do sidebar entry (a fase visível)

A mudança visual grande.

- [ ] **4.1** Criar `<Shell>` (layout root) — flex container que envolve `[Sidebar][Main][AlphaPanel]`
- [ ] **4.2** Criar `<AlphaPanel>` (desktop) — `<aside>` com transição de largura, contém panel header + messages + composer
- [ ] **4.3** Criar `<AlphaSheet>` (mobile) — Sheet `side="right"` full-screen, mesmo conteúdo
- [ ] **4.4** Criar `<AlphaTrigger>` — botão no header com tooltip + ⌘L shortcut
- [ ] **4.5** Atualizar [(dashboard)/layout.tsx](src/app/(dashboard)/layout.tsx) pra usar `<Shell>` e renderizar `<AlphaTrigger />` no header trigger group
- [ ] **4.6** Remover bolha flutuante atual de [alpha-chat.tsx](src/components/alpha-chat.tsx) — UI agora vive no panel/sheet
- [ ] **4.7** Remover `<AlphaChat>` das 3 páginas que renderizam:
  - [sprints/[id]/board/page.tsx](src/app/(dashboard)/sprints/%5Bid%5D/board/page.tsx)
  - [projects/[id]/page.tsx](src/app/(dashboard)/projects/%5Bid%5D/page.tsx)
  - [meetings/[id]/page.tsx](src/app/(dashboard)/meetings/%5Bid%5D/page.tsx)
- [ ] **4.8** Remover entry "Alpha" do sidebar nav em [app-sidebar.tsx](src/components/app-sidebar.tsx) (linha do array `managerOnlyNav`)
- [ ] **4.9** Adicionar botão "Histórico" dentro do panel header → navega pra `/ops`
- [ ] **4.10** Implementar ⌘L keyboard shortcut em `useAlphaKeyboard()`
- [ ] **4.11** QA exaustivo: open/close em ambos viewports, transição suave, conteúdo central nunca esconde, persistência open/close em reload, navegação entre rotas com panel aberto preserva conversa.

**Risco:** alto-médio. Mudança visual grande. Test exaustivo necessário.

### Fase 5 — Backend auto-context

Backend conforme [alpha-global-header-plan.md V2](../agents/alpha/alpha-global-header-plan.md) — path injection + tool. Pode rodar em paralelo com Fase 4 (são PRs separados, não dependem entre si).

- [ ] **5.1** `currentPath` no body do POST em [chat/route.ts](src/app/api/agents/alpha/chat/route.ts)
- [ ] **5.2** Refator de `buildOpsContext` em [context.ts](src/lib/agent/agents/alpha/context.ts) — global compact + focus rico por tipo de rota
- [ ] **5.3** Tool `get_current_page_context` em [tools.ts](src/lib/agent/agents/alpha/tools.ts) (opcional na V1 — só se precisar)
- [ ] **5.4** Atualizar prompt em [prompt.ts](src/lib/agent/agents/alpha/prompt.ts)
- [ ] **5.5** QA: em `/projects/X`, perguntar "como tá o sprint?" → resposta sobre sprint do projeto X, não global

### Fase 6 — `<PageTitle>` por página (polish, opcional)

Páginas adotam o slot central do header com título + subtitle.

- [ ] **6.1** Migrar pages-chave: `/`, `/projects`, `/projects/[id]`, `/sprints/[id]/board`, `/meetings/[id]`
- [ ] **6.2** Resto das pages: usa fallback derivado de pathname

**Risco:** baixíssimo. Aditivo, sem efeito colateral.

## Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|---|---|---|
| Reflow do main causa layout jank em tabelas largas | Média | Transição com `will-change: width` e `transform`. QA em `/members` (tabela densa) na Fase 4. |
| Conversa do Alpha perde estado em re-render durante transição | Baixa | Provider mantém state, panel só desmonta visualmente (`width: 0` + `overflow: hidden`). State sobrevive. |
| Atalho conflita com sistema | N/A | `⌘⇧A` escolhido — não conflita com `⌘A` (select all), Chrome URL bar, nem outros browser shortcuts. |
| Mobile Sheet `side="right"` sente estranho pra quem tava acostumado com bottom | Baixa | Comportamento nativo de apps que tem chat lateral (ChatGPT/Claude/Gemini mobile). Adaptação rápida. |
| Builder (não-manager) abrir o app e ver layout 1 coluna sem o trigger no header | Baixa | Esperado. Trigger esconde via `if (!hasMinLevel) return null`. Sem buraco visual. |
| Z-index conflito: Sheet mobile sobre Sidebar Sheet | Baixa | Sidebar Sheet z=50, Alpha Sheet z=50, mas só uma aberta por vez (toggle mutuamente exclusivo via state). |
| Header com botões demais sente cluttered | Média | V1 tem só 1-3 botões (Imperson + Histórico + Alpha). Espaço pra crescer. Re-avaliar quando passar de 5. |

## Critério de "feito"

- [ ] Header sticky em todas as rotas, mobile + desktop, sem jitter
- [ ] Click no botão Alpha desktop → panel desliza, main encolhe suave, ambos visíveis
- [ ] Click X ou botão de novo → panel desaparece, main volta ao tamanho original
- [ ] `⌘⇧A` toggle funciona desktop (não dispara em inputs de texto / textareas, pra não conflitar com select-all-do-sistema; só dispara quando target não é input/textarea editáveis)
- [ ] Mobile: tap Alpha → Sheet right full-screen, mensagens iguais ao desktop
- [ ] Conversa preservada entre navegação de rotas (e desktop ↔ mobile via resize)
- [ ] Auto-context: em `/projects/X`, "sprint atual" significa o sprint do projeto X
- [ ] Sidebar entry "Alpha" sumiu, mas `/ops` continua funcionando via botão histórico do panel
- [ ] Skills wizard: footer com `pb-safe`, botões acessíveis acima do home indicator
- [ ] Builder vê layout idêntico ao atual (sem trigger no header)
- [ ] Visual diff em rotas que não tinham footer ad-hoc = zero
- [ ] TypeScript + lint + build limpos
- [ ] QA manual em iPhone real + Macbook + Chrome desktop full-width

## Não-objetivos (explícitos)

- Bottom nav mobile (você descartou)
- App shell `100dvh + overflow:hidden` (descartado em V2)
- Drag handle pra redimensionar Alpha panel (V2 talvez)
- Command palette `⌘K` (V2 talvez — slot reservado mas não implementado)
- Mudar tipografia, cores, ou tokens — só estrutura e composição
- Migrar `(auth)/` pra esse shell — fora do escopo
- Refatorar sidebar — fica como está
- Settings dropdown no header — slot reservado, implementação V2

## Ordem de execução sugerida

| Semana | Fases |
|---|---|
| 1 | Fase 1 (header sticky) + Fase 2 (action bar) — ambas low-risk, low-coupling |
| 2 | Fase 3 (AlphaProvider refactor) — sem mudança visual ainda |
| 3 | Fase 4 (right panel + reflow) + Fase 5 (backend) em PRs paralelos |
| 4 | QA + polish + Fase 6 (page titles) |

Total: ~4 semanas com soak entre fases. Pode comprimir se a QA der confiança rápida.

## Procedimentos de rollback

| Cenário | Ação |
|---|---|
| Bug visual numa fase | `git revert` do PR específico |
| Estado do Alpha bugado pós-Fase 3 | Revert da Fase 3 — UI volta a funcionar com state local antigo |
| Reflow desktop tem problema de perf | Revert da Fase 4 — bolha flutuante volta. Pode reentrar com correção. |
| Backend (Fase 5) tem regressão | Revert independente — UI continua funcionando, só sem auto-context |

Cada PR é atômico e ortogonal. Sem feature flag = sem complexidade extra.
