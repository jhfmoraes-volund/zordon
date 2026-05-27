# Plano Mobile + PWA — Volund

Plano de melhorias para tornar o Volund navegável e agradável em telefone, com instalação como PWA.

## Princípios

- **Mantém a sidebar atual.** Em mobile ela já é offcanvas via shadcn — só vamos garantir que o trigger seja descoberto e que o conteúdo respire.
- **PWA mínimo:** manifest + botão de instalar. Sem service worker, sem offline, sem push, sem splash.
- **Bottom sheet vira o padrão de "modal" em mobile.** Dialog continua em desktop via wrapper responsivo.
- **Não inventar padrões novos.** Mexer no que já existe quando quebra; não adicionar bottom nav, não criar shell mobile separado.
- **Mobile first nas correções, desktop intocado.** Toda mudança usa breakpoints (`< md`) para não regredir desktop.

---

## Fase 0 — PWA mínimo

**Esforço: ~1h**

### Entregáveis

1. **Manifest** em `public/manifest.webmanifest`:
   - `display: standalone`
   - `theme_color`, `background_color`
   - `start_url: /`
   - Ícones 192px e 512px (maskable + any)

2. **Meta tags** no `app/layout.tsx`:
   - `<link rel="manifest" href="/manifest.webmanifest">`
   - `<meta name="apple-mobile-web-app-capable" content="yes">`
   - `<meta name="apple-mobile-web-app-status-bar-style" content="default">`
   - `<meta name="theme-color" content="...">`
   - `viewport` com `viewport-fit=cover`

3. **Botão "Instalar app"** discreto no rodapé da sidebar:
   - Captura `beforeinstallprompt` (Android/Chrome desktop)
   - Em iOS: fallback com instrução visual "Compartilhar → Adicionar à Tela de Início"
   - Esconde quando já instalado (detecta via `display-mode: standalone`)

4. **Safe-area utilities** no `globals.css`:
   - `--sat: env(safe-area-inset-top)`, `--sab: env(safe-area-inset-bottom)`
   - Classes utilitárias `.pt-safe`, `.pb-safe` para usar onde precisar

### Não faz parte

- Service worker
- Cache offline
- Push notifications
- Splash screen customizada

---

## Fase 1 — Quick CSS wins + tira horizontal

**Esforço: ~3h**

Edits pontuais, baixo risco, alto impacto.

### 1.1 — Correções pontuais

1. **iOS input zoom fix:**
   - `src/components/ui/input.tsx`: `text-base md:text-sm` → `text-[16px] md:text-sm`
   - `src/components/ui/textarea.tsx`: idem

2. **Padding responsivo do dashboard:**
   - `src/app/(dashboard)/layout.tsx`: `p-6` → `px-3 py-4 sm:px-4 lg:p-6`

3. **Grids `cols-N` sem prefixo responsivo:**
   - `src/app/(dashboard)/page.tsx:439` (capacity grid): `grid-cols-2` → `grid-cols-1 sm:grid-cols-2`
   - `src/app/(dashboard)/projects/[id]/page.tsx:519` (health metrics): `grid-cols-4` → `grid-cols-2 sm:grid-cols-4`
   - `src/app/(dashboard)/projects/page.tsx:376, 390` (form grids): `grid-cols-3`/`grid-cols-2` → `grid-cols-1 sm:grid-cols-3`/`sm:grid-cols-2`

4. **Header de project com nome longo:**
   - `src/app/(dashboard)/projects/[id]/page.tsx:283`: adicionar `min-w-0` no bloco do título e `truncate` no h1

5. **Touch targets em pontos críticos:**
   - Send button do chat (`alpha-chat.tsx:182`): `h-9 w-9` → `h-10 w-10`
   - Outros botões em footers/composers: `size-10` (40px)
   - **Não** mexer no `size-icon` global do `button.tsx` (risco de regressão)

6. **Sidebar trigger no header mobile:**
   - `src/app/(dashboard)/layout.tsx:62`: garantir `h-10 w-10` no SidebarTrigger e ícone visível

### 1.2 — Padrão "tira horizontal" (quick win descoberto)

O sprint board (`sprints/[id]/board/page.tsx:324`) já usa esse padrão e funciona bem em mobile:

```tsx
<div className="flex gap-3 overflow-x-auto pb-4 -mx-3 px-3 snap-x snap-mandatory">
  {items.map(item => (
    <div className="min-w-[280px] shrink-0 snap-start">...</div>
  ))}
</div>
```

**Por que funciona:** cada item mantém largura mínima (não comprime), usuário swipa de lado naturalmente, snap segura no item.

**Quando usar:** itens homogêneos, poucos (≤ ~10), com estrutura interna densa, especialmente para **comparação** entre itens.

**Quando NÃO usar:** listas para navegação (projetos, membros, meetings) — vertical é melhor pra escanear muitos itens.

#### Aplicações na Fase 1

Componentes que viram tira horizontal em `< md` (em desktop, mantém layout atual):

| Componente | Arquivo | Largura mínima do card |
|------------|---------|------------------------|
| Capacity do Time | `(dashboard)/page.tsx:399-493` | `min-w-[280px]` |
| Alocação por semana (WeekBlocks) | `components/weekly-allocation.tsx:104-117` | `min-w-[260px]` |
| Stats cards do overview | `(dashboard)/page.tsx:339` | `min-w-[160px]` |
| SprintOverviewWidget (linhas de sprint) | `components/sprint-overview-widget.tsx:79-125` | `min-w-[280px]` (vira card vertical em mobile) |
| Sprints tab do projeto | `projects/[id]/page.tsx:892` (SprintsTab) | `min-w-[280px]` |

**Padrão CSS reutilizável** (adicionar em `globals.css` se virar comum):

```css
@utility scroll-strip {
  display: flex;
  gap: 0.75rem;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  padding-bottom: 1rem;
  margin-inline: -0.75rem;
  padding-inline: 0.75rem;
  scrollbar-width: none;
}
@utility scroll-strip-item {
  flex-shrink: 0;
  scroll-snap-align: start;
}
```

Em desktop (`md+`), aplicar `md:contents` no container para "desligar" o flex e voltar pro grid/stack original.

---

## Fase 2 — `<ResponsiveDialog>` + `<ResponsiveSheet>`

**Esforço: ~2h**

### Entregáveis

1. **Wrapper `<ResponsiveDialog>`** em `src/components/ui/responsive-dialog.tsx`:
   - Renderiza `<Dialog>` em `md+` e `<Sheet side="bottom">` em `< md`
   - Mesma API (`open`, `onOpenChange`, `children`)
   - Detecta breakpoint via media query

2. **Padrão visual do bottom sheet:**
   - `max-h-[90vh]` com header fixo no topo
   - Scroll interno no corpo
   - CTA primário sticky no fundo com `pb-safe`
   - Drag handle no topo (visual)

3. **Migrar dialogs principais:**
   - Criar/editar membro (`members/page.tsx:472`)
   - Criar/editar projeto + settings (`projects/page.tsx`, `projects/[id]/page.tsx`)
   - Criar sprint (`sprint-dialog.tsx`)
   - "Nova ação" da meeting (`meetings/[id]/page.tsx:536`)
   - Outros que aparecerem no audit

---

## Fase 3 — Navegação dentro de páginas

**Esforço: ~3h. Resolve a queixa específica de "navegação na aba de projetos não funciona bem".**

### Entregáveis

1. **Tabs do projeto scrolláveis:**
   - `src/app/(dashboard)/projects/[id]/page.tsx:312-334`
   - Container: `flex gap-1 border-b overflow-x-auto -mx-3 px-3 scroll-smooth`
   - Cada tab: `whitespace-nowrap shrink-0 snap-start`
   - Esconder scrollbar com utility CSS

2. **Tabs do agente scrolláveis:**
   - `src/app/(dashboard)/agents/[slug]/layout.tsx:64-88`
   - Mesma técnica

3. **Tabela de projetos → cards em `< md`:**
   - Componente `<ProjectCardMobile>` novo
   - Renderiza condicional: cards em mobile, tabela atual em desktop
   - Card inteiro abre detalhe; ações (editar, deletar) em menu 3-dots
   - Sem botões inline brigando por tap

4. **Tabela de membros → cards em `< md`:**
   - `<MemberCardMobile>` com nome + role + bateria de capacidade + menu de ações
   - Mesmo padrão de render condicional

5. **Sprint board mobile:**
   - `src/app/(dashboard)/sprints/[id]/board/page.tsx`
   - Detectar mobile no mount (`window.matchMedia("(max-width: 768px)")`)
   - Default `viewMode = "list"` em mobile
   - Toggle visível no header da página (não escondido em menu)

---

## Fase 4 — Alpha chat refactor

**Esforço: ~2h**

### Contexto

Hoje o Alpha tem dois problemas em mobile:

1. **`alpha-chat.tsx`**: bubble flutuante + painel `fixed w-[420px] h-[550px]` que estoura em telefones de 360-390px.
2. **`ops/page.tsx:233`**: sidebar de threads à direita (`<aside className="w-64 border-l">`) que em mobile rouba metade da tela ou desaparece sem aviso.

### Entregáveis

1. **`alpha-chat.tsx` painel responsivo:**
   - Em mobile (`< md`): vira `<Sheet side="bottom">` com `h-[100dvh]`, `pt-safe pb-safe`
   - Em desktop: mantém o painel atual (`w-[420px] h-[550px]`)
   - Bubble continua flutuante; respeita `pb-safe`
   - Composer: send button `size-10`, textarea `text-[16px]`, container com `pb-safe`

2. **`ops/page.tsx` sidebar de threads:**
   - Extrair lista para componente `<ThreadsList>` (mesmo componente nos dois lugares)
   - Em desktop: continua como `<aside>` à direita
   - Em mobile: vira botão "Histórico" no header da página → abre bottom sheet com a `<ThreadsList>` dentro

---

## Fase 5 — Design Session mobile

**Esforço: ~5h. Plano dedicado por superfície.**

A Design Session tem 3 superfícies (lista, criação, detalhe). Cada uma tem problemas distintos.

### 5.1 — Lista (`meetings/page.tsx`)

**~1h**

Hoje: tabela com 8 colunas (Data, Tipo, Título, Status, Projetos, Ações, Pendentes, +menu) sem fallback mobile.

**Refator:**

- Tabela vira `<MeetingCardMobile>` em `< md`.
- Layout do card:
  ```
  ┌──────────────────────────────┐
  │ 22/abr · [Tipo badge]        │
  │ Título da reunião            │
  │ [Status]  3 projetos · 5 ações│
  │            ⚠ 2 pendentes      │
  └──────────────────────────────┘
  ```
- Card inteiro clicável → abre detalhe. Sem botões inline.
- Filtros (`SelectTrigger w-[160px]` e `w-[200px]`) viram full-width empilhados em mobile (`flex-col gap-2 sm:flex-row`).

### 5.2 — Nova reunião (`meetings/new/page.tsx`)

**~1h**

Já tem `max-w-2xl` e usa `flex-wrap` com `min-w-[]`, então adapta razoavelmente. Pontos a corrigir:

- **Bloco de attendee externo (linhas 230-248):** 3 inputs com `min-w-[140/160/120px]` lado a lado quebram mal em 360px. Em mobile, força `flex-col gap-2` e empilha.
- **CTAs do rodapé (linha 321):** viram sticky no fim do form com `pb-safe`.
- **Lista de projetos selecionáveis:** já é `flex-wrap`, ok.
- Inputs já com `text-[16px]` (vem da Fase 1).

### 5.3 — Detalhe (`meetings/[id]/page.tsx`)

**~3h. É o mais complexo.**

Quatro problemas concretos:

#### a) Header + filtros (linhas 281-303)

`flex items-start justify-between` com botões à direita — em mobile, título longo + status badge + dois botões empilham mal.

**Fix:** em `< md`, título full-width em cima; botões viram linha abaixo com `flex-wrap gap-2`.

#### b) Revisão por projeto agrupada por PM (linhas 387-424)

Já tem `grid-cols-1 md:grid-cols-2` — bom, vira coluna única em mobile.

- Header do grupo PM (`button` linha 392-407): garantir padding maior pra toque (`py-3` em mobile).
- **`<ReviewCard>` precisa auditoria à parte:** é o componente mais denso da feature. Aplicar:
  - Inputs full-width
  - Labels acima do input (não inline)
  - Textarea com `text-[16px]` e `min-h-[100px]`
  - CTAs internos com `size-10` em mobile

#### c) Action items (linhas 458-510) — **principal dor**

Hoje cada item é uma linha horizontal:

```
[ícone] descrição.................. [assignee] [data] [status]
```

Em 360px isso vira ilegível: descrição comprimida, badges quebradas, ícone status pequeno.

**Refator:**

```
┌──────────────────────────────┐
│ ◉ Descrição da ação aqui     │  ← ícone status (h-6, tap-area 44px)
│   que pode quebrar 2 linhas   │
│   ⓘ Projeto: Foo              │
│   ─────────────────────────── │
│   👤 Maria   📅 28/abr  [DOING]│
└──────────────────────────────┘
```

- Em mobile (`< md`): `flex-col` com descrição full-width em cima, metadata embaixo.
- Em desktop: mantém a linha horizontal atual.
- Tap no card todo = ciclar status (alternativa ao ícone, área maior).
- Long-press (futuro) = editar/deletar.

#### d) Dialog "Nova ação" (linha 536)

Vira bottom sheet via `<ResponsiveDialog>` (já feito na Fase 2).

Form: descrição (textarea), assignee (select), due date (input), source (select). Empilhar full-width.

---

## Fase 6 — Login mobile

**Esforço: ~1h. Opcional, deixar por último (tela pouco usada por usuário logado).**

### Entregáveis

- `src/app/(auth)/login/login.module.css`:
  - Em `< 640px`: esconde o terminal animado (`display: none`).
  - Form único centralizado, `padding: 24px 16px`.
  - Input `height: 48px`, `font-size: 16px` (corrige zoom iOS já garantido na Fase 1, mas explícito aqui).
  - Reduzir `padding: 88px 56px 56px` do `.layout` para `40px 16px` em mobile.

---

## Resumo de esforço

| Fase | Descrição | Horas |
|------|-----------|-------|
| 0 | PWA mínimo | 1h |
| 1 | Quick CSS wins + tira horizontal | 3h |
| 2 | ResponsiveDialog + Sheet | 2h |
| 3 | Tabs + listas + board | 3h |
| 4 | Alpha chat + ops threads | 2h |
| 5 | Design Session (lista + new + detalhe) | 5h |
| 6 | Login mobile | 1h |
| | **Total** | **~17h** |

---

## Ordem recomendada de PRs

| PR | Fases | Por quê primeiro |
|----|-------|------------------|
| 1 | 0 + 1 | Não muda estrutura, melhora 70% das queixas |
| 2 | 2 | ResponsiveDialog destrava todos os forms |
| 3 | 3 | Resolve a queixa específica de navegação em projetos |
| 4 | 4 | Alpha + ops viram usáveis em mobile |
| 5 | 5 | Design Session — mais complexo, depende da Fase 2 |
| 6 | 6 | Última, baixa prioridade |

---

## Decisões já tomadas

- ❌ Sem bottom nav (sidebar atual basta)
- ❌ Sem service worker (PWA é só install + manifest)
- ❌ Sem push notifications
- ❌ Sem splash screen customizada
- ❌ Sem offline mode
- ✅ Bottom sheet como padrão de modal em mobile
- ✅ Alpha chat e ops threads sidebar viram bottom sheet em mobile
- ✅ Tabelas viram cards em `< md` (projetos, membros, meetings)
- ✅ Tabs scrolláveis horizontalmente quando estouram
- ✅ Padrão "tira horizontal" (`flex overflow-x-auto + shrink-0 min-w-[]`) para widgets de comparação (capacity, alocação semanal, stats, sprints)

## Decisões em aberto

- Login mobile esconde terminal animado completamente ou mantém colapsado? (proposta: esconder)
- Ordem dos campos no `<ProjectCardMobile>` / `<MemberCardMobile>` / `<MeetingCardMobile>` — finalizar no momento da implementação, com base no que é mais útil em escaneabilidade
