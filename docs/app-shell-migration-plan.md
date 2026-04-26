# Sticky shell — consistência mobile + desktop

Migração leve pra dar feel de app nativo sem reescrever a infraestrutura. Inspirado no padrão do projeto Zerei (`/Users/joaomoraes/projetos-ai-dev/Perke/Zerei/game-completion-hub`) que já funciona em produção.

> **v2 — pivô:** v1 propunha app shell com `<body overflow:hidden + h-[100dvh]>` e único scroll container. Após análise do Zerei, ficou claro que é over-engineering. O Zerei usa body-scrolls + sticky chrome e funciona. Plano rescrito pra adotar essa abordagem.

## Princípio

Não fingir que o browser é app nativo. Deixar o body rolar (comportamento que ele já faz bem), e usar `position: sticky` na chrome (header e sidebar) pra manter visível durante scroll. Para action bars (CTAs fixos como prev/next em wizard), `position: fixed` com `pb-safe`.

| Aspecto | Modelo escolhido |
|---|---|
| Body scroll | Natural (body rola) |
| Header | `sticky top-0 z-30` |
| Sidebar (desktop) | `<SidebarProvider>` shadcn já faz isso (slot reservado + sticky) |
| Sidebar (mobile) | `<SidebarProvider>` shadcn já faz isso (Sheet off-canvas) |
| Action bar | `fixed inset-x-0 bottom-0 pb-safe z-40` em componente reusável |
| Mobile bottom nav | Não tem. Sidebar Sheet cobre essa função. |

## Estado atual

- Root [layout.tsx](src/app/layout.tsx) — `<body className="min-h-full flex">`. OK, sem mudança.
- `(dashboard)` [layout.tsx](src/app/(dashboard)/layout.tsx):
  - `<SidebarProvider>` + `<AppSidebar />` + `<main className="flex-1 overflow-auto">` ✓
  - Header (linha 61) — **NÃO** é sticky. Precisa ficar.
- `(focus)` [layout.tsx](src/app/(focus)/layout.tsx):
  - Header não sticky. Precisa ficar.
- Footers ad-hoc:
  - [skills/page.tsx:337](src/app/(focus)/profile/skills/page.tsx#L337) — `fixed inset-x-0 bottom-0` **sem `pb-safe`** ❌
  - [meetings/new/page.tsx:327](src/app/(dashboard)/meetings/new/page.tsx#L327) — `sticky bottom-0 ... pb-safe sm:static` ✓
  - [responsive-dialog.tsx:131](src/components/ui/responsive-dialog.tsx#L131) — `sticky bottom-0 ... pb-safe` ✓
  - [task-sheet.tsx:643](src/components/task-sheet.tsx#L643) — `border-t` sem sticky (dentro de Sheet, fora do escopo)

## O que fazer

### 1. Header sticky em ambos os layouts

Mudança mínima — adicionar 4 classes no div existente.

**`(dashboard)/layout.tsx` linha 61:**
```diff
- <div className="flex items-center gap-2 border-b border-border/50 px-6 py-3">
+ <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-border/50 bg-background/95 px-6 py-3 backdrop-blur">
```

**`(focus)/layout.tsx` linha 53:**
```diff
- <header className="flex items-center justify-between border-b border-border/50 px-6 py-3">
+ <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border/50 bg-background/95 px-6 py-3 backdrop-blur">
```

**Por que `z-30`:** sidebar sheet (mobile) é z-50, chat panels z-50. Header fica abaixo deles, acima do conteúdo.

**Por que `bg-background/95 backdrop-blur`:** garante que conteúdo rolando atrás não vaza. `/95` mantém leve translucidez moderna. Mesmo padrão do Zerei.

### 2. Componente `<MobileActionBar>`

Substitui os patterns ad-hoc por um componente único.

```tsx
// src/components/ui/mobile-action-bar.tsx
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Constrai conteúdo da barra ao mesmo max-w da página (ex.: max-w-3xl). */
  maxWidth?: string;
  className?: string;
};

export function MobileActionBar({ children, maxWidth, className }: Props) {
  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-border/50 bg-background/95 backdrop-blur pb-safe",
        className,
      )}
    >
      <div className={cn("mx-auto flex items-center justify-between gap-2 px-6 py-3 lg:px-10", maxWidth)}>
        {children}
      </div>
    </div>
  );
}
```

**Uso na page:**
```tsx
// skills/page.tsx — substitui o bloco de footer atual
<MobileActionBar maxWidth={containerWidth}>
  <Button variant="ghost" onClick={prev} disabled={stepIndex === 0} size="sm">
    <ChevronLeft className="h-4 w-4 mr-1" /> Voltar
  </Button>
  <div className="flex items-center gap-2">
    {currentTower && (
      <Button variant="ghost" size="sm" onClick={next}>
        <SkipForward className="h-4 w-4 mr-1" /> Pular torre
      </Button>
    )}
    {stepIndex === REVIEW_INDEX ? (
      <Button onClick={complete}>Salvar e publicar</Button>
    ) : (
      <Button onClick={next}>
        {stepIndex === 0 ? "Começar" : "Próxima"}
        <ChevronRight className="h-4 w-4 ml-1" />
      </Button>
    )}
  </div>
</MobileActionBar>
```

**Garantir o offset do conteúdo:** página continua usando `pb-32` (ou similar) pra reservar espaço atrás da barra.

### 3. Migrar `meetings/new` pro mesmo componente

Hoje usa `sticky bottom-0 sm:static` — comportamento "sticky no mobile, inline no desktop". Posso manter esse comportamento adicionando uma variant `responsive` no `<MobileActionBar>` ou deixar como está (já funciona). Recomendo **deixar como está** — não é o problema reportado. Migrar só se aparecer inconsistência.

### 4. Safe area no header (notch)

Para PWA standalone (já configurado em [layout.tsx:33-38](src/app/layout.tsx#L33-L38) com `viewportFit: "cover"`), o notch do iPhone cobre o topo do header. Adicionar `pt-safe`:

```diff
- <div className="sticky top-0 z-30 flex items-center gap-2 border-b ... px-6 py-3 backdrop-blur">
+ <div className="sticky top-0 z-30 border-b ... bg-background/95 backdrop-blur">
+   <div className="flex items-center gap-2 px-6 py-3 pt-safe">
+     ...
+   </div>
+ </div>
```

Ou inline com calc — escolher na implementação. **Só importa em standalone PWA**. Em browser normal, `pt-safe` é 0.

## Folder organization

Não precisa de `_legacy/`, feature flag, ou folders especiais. Mudanças são:

```
src/
├── components/ui/
│   └── mobile-action-bar.tsx        # NEW (~30 linhas)
├── app/
│   ├── (dashboard)/layout.tsx       # MODIFIED — 1 linha (sticky no header)
│   └── (focus)/
│       ├── layout.tsx               # MODIFIED — 1 linha (sticky no header)
│       └── profile/skills/page.tsx  # MODIFIED — substitui footer JSX
```

**Rollback:** `git revert` do PR. Cada mudança é local e atômica.

## Tarefas

### PR 1 — Header sticky

- [ ] **1.1** Adicionar classes sticky no header de [(dashboard)/layout.tsx:61](src/app/(dashboard)/layout.tsx#L61)
- [ ] **1.2** Adicionar classes sticky no header de [(focus)/layout.tsx:53](src/app/(focus)/layout.tsx#L53)
- [ ] **1.3** QA mobile: rolar lista longa (ex.: `/projects`, `/members`), confirmar header continua visível, sem jitter
- [ ] **1.4** QA desktop: idem
- [ ] **1.5** QA PWA standalone (opcional): verificar notch — se cobrir, adicionar `pt-safe` no inner

### PR 2 — Mobile action bar

- [ ] **2.1** Criar `src/components/ui/mobile-action-bar.tsx`
- [ ] **2.2** Migrar [skills/page.tsx:337](src/app/(focus)/profile/skills/page.tsx#L337) — substituir bloco de footer pelo componente
- [ ] **2.3** Verificar `pb-32` continua suficiente pra não cobrir conteúdo
- [ ] **2.4** QA mobile + iPhone PWA: confirma que `pb-safe` empurra os botões pra cima do home indicator
- [ ] **2.5** QA desktop: layout continua igual (footer fica largura total no rodapé, conteúdo centralizado pelo `maxWidth` interno)

### PR 3 — varredura final (opcional)

- [ ] **3.1** Grep por `fixed bottom-0\|sticky bottom-0` sem `pb-safe` — corrigir se houver
- [ ] **3.2** Considerar migrar [meetings/new/page.tsx:327](src/app/(dashboard)/meetings/new/page.tsx#L327) pro componente, com prop `responsive` que mantém o comportamento `sticky → static`

## Critério de "feito"

- [ ] Header fica visível ao rolar conteúdo, em todas as rotas, mobile e desktop
- [ ] Header não pula durante URL bar collapse no Safari mobile (sticky comporta-se bem)
- [ ] Skills wizard: botões prev/next sempre visíveis, com clearance acima do home indicator do iPhone
- [ ] Sidebar (desktop expanded, desktop icon, mobile sheet) continua funcionando idêntico
- [ ] Visual diff em rotas sem footer ad-hoc = zero
- [ ] TypeScript + lint limpos

## Riscos

| Risco | Mitigação |
|---|---|
| `position: sticky` pula no iOS Safari quando URL bar colapsa | Aceitar — é comportamento padrão e mínimo. Zerei vive com isso. |
| Z-index conflitando com Sheet do sidebar | `z-30` no header < `z-50` da Sheet. Verificar manual. |
| `backdrop-blur` no header degrada perf em mobile baixo-end | Aceitar — Volund é interno, não consumer. Reverter se aparecer. |
| Header `sticky top-0` quebrar layout existente em alguma rota | Improvável — `<main className="flex-1 overflow-auto">` já é o scroll container interno do flex layout. Sticky no header dentro do main mantém comportamento correto. |

## Não-objetivos

- Mobile bottom nav (você pediu pra pular)
- Reescrita de scroll containers via `100dvh + overflow:hidden`
- Feature flags / pastas `_legacy/` (escopo era grande demais pra justificar)
- Pull-to-refresh, transições de rota animadas, polyfill de hash navigation
- Mudar tipografia, cores, spacing tokens

## Integração com `alpha-global-header-plan.md`

Esse plano de header sticky é **pré-requisito** pra fase 4 do plano do Alpha (bolha no header mobile). Uma vez que o header é sticky, basta colocar o `<AlphaChatTrigger />` dentro do header e ele já fica visível durante o scroll.

Ordem sugerida:
1. Esse plano (PR 1 + PR 2) — base estável
2. Plano do Alpha (`alpha-global-header-plan.md` v2) — herda o header sticky
