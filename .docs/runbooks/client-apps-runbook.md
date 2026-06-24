# Runbook — Client page: "apps mentality"

> Feature **nova** no monorepo `zordon` (Next.js 16 + Supabase). Reorganiza `/clients/[id]` pra espelhar a página de projeto: nav horizontal *underline*, **espinha** (Geral + Projetos) + uma superfície **Apps** com dock. Oportunidades e CSAT viram **apps client-scoped**. **Reúso pesado de infra que já existe** — quase nenhum código novo de raiz, **zero migration**. Leia este runbook inteiro antes de tocar código; confie nos fatos abaixo MAS confirme no arquivo antes de editar.

---

## 1. OBJETIVO

Aplicar o modelo de **Apps** (já em prod nos escopos *projeto* e *org*) ao escopo **cliente**. A tese do dono: o núcleo do Zordon é **operação + eficiência do time** (Geral = inteligência, Projetos = entrega); **tudo o mais vira app plugável** (Oportunidades = gestão de inovação, CSAT = satisfação, e futuros apps community-driven).

### Modelo final
```
[ header: logo · nome · contato ]
 Geral   Projetos   Apps   Configurações       ← nav horizontal, border-b-2 (estilo Overview)
─────────────────────────────────────────────
 Geral    → KPI cards + Alpha Insights · Cliente        (INALTERADO)
 Projetos → ProjetosBoard scoped a clientId, SEM ribbon  (reúso do board estratégico)
 Apps     → ClientAppsDesktop · dock: [💡 Inovação (Oportunidades) · 💬 CSAT]
 Config   → Configurações                                (INALTERADO)
```

### Decisões fixadas (do dono — imutáveis)
- **D1** — Apps num único tab "Apps" + **dock** (espelha a página de projeto), não como abas próprias. Deep-link `?app=opportunities|csat`.
- **D2** — Aba Projetos = **board estratégico completo** (`ProjetosBoard`) scoped por `clientId`, com a **ribbon de KPIs fábrica-wide OCULTA** (linhas ativas, buffer comercial, nº clientes não fazem sentido por cliente). Lista/kanban/régua/saúde/drawer ficam.
- **D3** — Catálogo default no `/apps` (launcher) quando sem `?app=`.
- **D4** — **Sem migration.** Todas as entidades já existem (Opportunity, CsatResponse, Project.clientId).
- **D5** — **Preservar o gating de acesso atual** de cada superfície. NÃO afrouxar nem apertar. Leia as páginas atuais e espelhe o comportamento.

---

## 2. POR QUE É BARATO (arquitetura — verificado)

O `AppDesktop` (`src/components/apps/app-desktop.tsx`) é **puramente apresentacional e scope-agnóstico**. Já roda em **2 escopos**:

| Escopo | Registry | Wrapper que sincroniza URL + dispara `renderSurface` | Scope id |
|---|---|---|---|
| Projeto | `APP_REGISTRY` (`src/lib/apps/registry.ts`) | `src/app/(dashboard)/projects/[id]/_tabs/apps-tab.tsx` | `projectId` |
| Org | `OVERVIEW_APP_REGISTRY` (`src/lib/apps/overview-registry.ts`) | `src/components/overview/overview-apps-desktop.tsx` | (nenhum) |
| **Cliente (NOVO)** | `CLIENT_APP_REGISTRY` (criar) | `client-apps-desktop.tsx` (criar, cópia do overview) | `clientId` |

Contrato do `AppDesktop` (props): `apps[]`, `openAppKey`, `onOpenAppKeyChange`, `renderSurface(app) => ReactNode`, `windowSubtitle?`, `statusSlot?`, `onCreateApp?`. Renderiza dock (apps `installed`) + canvas (surface do app aberto **ou** catálogo quando `openAppKey` não bate num app installed).

`AppDef` (tipo, em `src/lib/apps/registry.ts`): `{ key, name, tagline, description, icon (LucideIcon), dot (classe bg), window ('lg'|'xl'|'2xl'|'3xl'), produces ({context?, artifacts?}), requires?, minAccessLevel? ('builder'|'manager'|'admin'), status ('installed'|'available') }`. **Reuse esse tipo** no client-registry (como o overview-registry faz).

App canônico de referência (busca os próprios dados): `src/components/apps/finance/finance-app.tsx` (`FinanceApp` → fetch `/api/finance/*`).

**Os dois apps candidatos já estão prontos e são client-scoped** — app-ificar = **embrulhar, não reescrever**.

---

## 3. ESTADO ATUAL DA CLIENT PAGE (verificado)

Route group `(dashboard)/clients/[id]` com **layout + segmentos** (não single-page):
- `[id]/layout.tsx` → `ClientProvider` + `ClientHeader` + **`ClientSidebar`** (a nav atual: pills verticais `bg-muted`).
- `[id]/page.tsx` → redirect pra `/overview`.
- Segmentos: `overview` (Geral), `projects`, `opportunities`, `csat`, `settings`.
- `_context/client-context.tsx` → `useClientContext()`: `clientId`, `client`, `members`, `canSeeInsights` (manager+), `refresh`, `updateClient`, `deleteClient`.
- `_components/client-sidebar.tsx` → `SECTIONS = [{segment,label,icon}]` (5 itens), ativo via `usePathname()`.

### Estilo do nav a copiar (de `src/components/overview/overview-tabs.tsx`)
- Container: `border-b border-border`
- Lista: `flex gap-1 overflow-x-auto scrollbar-none`
- Item (base): `inline-block px-4 py-2 text-sm border-b-2 transition-colors whitespace-nowrap shrink-0`
- Ativo: `border-primary text-foreground font-medium` · Inativo: `border-transparent text-muted-foreground hover:text-foreground`
- Variante da página de projeto (responsiva, ícone+label): ícone `size-5 md:size-4`, label `hidden md:inline`, badge `hidden md:inline-flex`. Veja `src/app/(dashboard)/projects/[id]/page.tsx` (nav inline ~linhas 619–650).

---

## 4. FASES

> **Fases 2 e 3 são independentes.** Pode fazer em qualquer ordem. Faça **uma fase por vez**, rode `tsc` ao fim de cada, e só então siga.

### Fase 1 — Nav estilo Overview
**Arquivos:** `_components/client-sidebar.tsx`, `[id]/layout.tsx`.
1. Restilizar `ClientSidebar` de pills verticais → **barra horizontal *underline*** usando as classes da §3. Mantém `Link` + `usePathname` (segment-based) que já existe.
2. Colapsar `SECTIONS` para **4 itens**: `overview/Geral`, `projects/Projetos`, `apps/Apps`, `settings/Configurações`. **Remover** `opportunities` e `csat` do nav (viram dock). Ícone sugerido pro Apps: `LayoutGrid` (lucide).
3. `layout.tsx`: empilhar `ClientHeader → nav horizontal (full-width, border-b) → {children}` (hoje é header + sidebar lado-a-lado). Espelhar o stacking da página de projeto.

**Aceite Fase 1:** nav horizontal underline no `/clients/[id]`, 4 abas, ativo correto por rota, responsivo (ícone-only no mobile). `tsc` limpo. (Aba `apps` pode mostrar placeholder até a Fase 2.)

### Fase 2 — Superfície Apps do cliente
**Arquivos novos:** `src/lib/apps/client-registry.ts`, `src/components/clients/client-apps-desktop.tsx`, `src/app/(dashboard)/clients/[id]/apps/page.tsx`, `src/components/opportunities/opportunities-app.tsx`, `src/components/clients/csat-app.tsx`. **Editar:** `opportunities/page.tsx`, `csat/page.tsx` (viram redirects).

1. **`client-registry.ts`** — `export const CLIENT_APP_REGISTRY: AppDef[]` (reusa `AppDef` de `registry.ts`) com 2 apps `status:'installed'`:
   - `{ key:'opportunities', name:'Inovação', tagline/description curtos, icon: Lightbulb, dot, window:'2xl' (ajuste), minAccessLevel: <espelhar gate atual de opportunities>, produces:{} }`
   - `{ key:'csat', name:'Satisfação', icon: MessageSquareHeart, window:'2xl' (ajuste), minAccessLevel: <espelhar gate atual de csat>, produces:{} }`
   - **D5:** leia `opportunities/page.tsx` e `csat/page.tsx` atuais pra descobrir o gate real (havia `canSeeInsights`? RLS?) e setar `minAccessLevel` igual. Não invente.
2. **`client-apps-desktop.tsx`** — **cópia** de `src/components/overview/overview-apps-desktop.tsx` adaptada: `"use client"`, recebe `clientId` (+ accessLevel/members do que precisar), sincroniza `?app=` (useSearchParams + router.replace como o overview faz), filtra `CLIENT_APP_REGISTRY` por accessLevel, `renderSurface(app)` faz switch:
   - `case 'opportunities'` → `<OpportunitiesApp clientId={clientId} />`
   - `case 'csat'` → `<CsatApp clientId={clientId} />`
3. **`apps/page.tsx`** — server component, pega `clientId` (params), renderiza `<ClientAppsDesktop clientId=... />`. Sem `?app=` → AppDesktop cai no catálogo (passar `openAppKey=""`).
4. **`opportunities-app.tsx`** (surface) — `"use client"`. Carrega via `GET /api/clients/[clientId]/opportunities` (padrão FinanceApp: fetch próprio + Skeleton no loading) e renderiza o **já existente** `OpportunitiesWidget` (`src/components/opportunities/opportunities-widget.tsx`, props `clientId` + `initialOpportunities`). Hook/API/promote já existem — não reimplementar.
5. **`csat-app.tsx`** (surface) — extrai o **corpo** de `csat/page.tsx` (`CsatPage`: load supabase + `useOptimisticCollection` + `CsatResponseCard`/`CsatResponseSheet` + delete confirm) pra `CsatApp({ clientId })`. Puxa `members`/`currentMemberId` do `useClientContext()`. Não mudar a lógica de CRUD/optimistic.
6. **Redirects** (preservam deep-links): `opportunities/page.tsx` → `redirect('/clients/${id}/apps?app=opportunities')`; `csat/page.tsx` → `?app=csat`. Use `redirect()` de `next/navigation`.

**Aceite Fase 2:** aba Apps mostra dock com Inovação + CSAT; abrir cada um renderiza a surface funcional (CRUD intacto); `/apps` sem `?app=` mostra catálogo; deep-links antigos redirecionam. `tsc` + lint limpos.

### Fase 3 — Aba Projetos = board estratégico (scoped, sem ribbon)
**Editar:** `src/lib/dal/project-overview.ts`, `src/components/overview/projetos-view.tsx`, `src/components/overview/projetos-board.tsx`, `src/app/(dashboard)/clients/[id]/projects/page.tsx`.
1. **`getProjectOverviews(clientId?: string)`** — quando `clientId` setado, adicionar `.eq('clientId', clientId)`. **Backward-compatible** (callers atuais passam nada). `Project.clientId` já existe.
2. **`projetos-view.tsx`** — prop `clientId?`. Quando setado: passa ao DAL **e PULA** os fetches fábrica-wide (`factoryLoad`/`builderLoads`) que só alimentam a ribbon. Passa `hideRibbon` ao board.
3. **`projetos-board.tsx`** — prop `hideRibbon?: boolean`. Quando true: não renderiza a ribbon nem o `RibbonPanel`. **Lista/kanban por fase + régua + saúde + `ProjectDrawer` (digest de PM Review) ficam intactos** → side-sheet de projeto vem de graça.
4. **`clients/[id]/projects/page.tsx`** — trocar grid de `ClientProjectCard` por `<ProjetosView clientId={clientId} hideRibbon />`. Se `ClientProjectCard` (`src/components/clients/client-project-card.tsx`) ficar órfão, remover (checar usos com grep antes).

**Aceite Fase 3:** aba Projetos mostra o board estratégico só com os projetos do cliente, sem ribbon; clicar abre o drawer rico; Overview org e página de projeto **inalterados** (só ganharam params opcionais). `tsc` limpo.

### Fase 4 — Gating, defaults, verificação final
- Conferir `minAccessLevel` por app == comportamento atual (D5). RLS/API existentes mantêm a barreira real — **não pode haver regressão de segurança**.
- Limpar dead code (`ClientProjectCard` se órfão; imports não usados).
- `npx tsc --noEmit` + lint limpos no fim.

---

## 5. REGRAS (não-negociáveis)
- **NÃO commitar/pushar.** Deixar a working tree pronta pra review do dono (ele commita via `scripts/sync-main.sh`). Local-as-SSOT: não dar stash/reset em mudanças de outras sessões (há arquivos modificados não relacionados: `finance-contracts.tsx`, `cronograma.tsx`, `date-utils.ts` — **não tocar**).
- **Reúso primeiro.** Antes de criar componente/sheet/form, checar UI patterns (AGENTS.md): `ResponsiveSheet`/`ResponsiveDialog` (nunca Dialog/Sheet nu), `ConfirmDialog` (nunca `window.confirm()`), `Field`/`FormBody`, `useOptimisticCollection` (nunca `setState` após fetch em lista).
- **Zero migration** (D4). Se achar que precisa de schema, **PARE e reporte** — provavelmente está reimplementando algo.
- **Validação Zod só em `src/app/api/**`**, nunca no client.
- **Uma fase por vez + `tsc` ao fim de cada.** Não marcar fase pronta sem `tsc` limpo.

## 6. GOTCHAS / APRENDIZADOS (já mapeados — não re-descobrir)
1. `AppDesktop` mostra **catálogo** quando `openAppKey` não está na lista de installed → passar `""` rende o launcher (D3).
2. `FinanceApp` **não tem scope param** (é org-only) — use-o só como padrão de "app busca os próprios dados", não copie o fetch.
3. `OpportunitiesWidget` já é `clientId`-scoped e tem hook+API próprios (`use-opportunities.ts`, `/api/clients/[id]/opportunities`, `/api/opportunities/[id]`, `/promote`). O `opportunities-app.tsx` só precisa carregar o `initialOpportunities` e renderizar o widget.
4. **CSAT escreve direto no supabase** (RLS permissiva) — mantenha como está; só muda **onde** o componente vive. **NÃO** apertar RLS aqui (dívida conhecida, fora de escopo).
5. `CsatPage` precisa de `members` + `currentMemberId` — ambos vêm do `useClientContext()`.
6. `getProjectOverviews` é usado pelo **Overview org** — o param `clientId?` tem que ser opcional e backward-compatible.
7. A ribbon do `ProjetosBoard` consome `factoryLoad`/`builderLoads` (queries org-level) — quando `hideRibbon`, **pule esses fetches** no `projetos-view.tsx` (não só esconda a UI) pra não rodar query inútil na client page.
8. Reconcile do `create` no optimistic deve **filtrar temp + append real** (não map puro) — padrão já seguido em opportunities/csat; manter.

## 7. VERIFICAÇÃO
```bash
npx tsc --noEmit        # tem que ficar limpo
# lint conforme o projeto (npm run lint ou eslint)
```
Depois, subir a app e clicar (ver skill /run ou /verify): nav horizontal 4-abas, dock Apps (Inovação + CSAT) com CRUD funcional, `/apps` no catálogo, board de Projetos scoped sem ribbon + drawer, redirects dos deep-links antigos (`/opportunities`, `/csat`).
**Deixar explícito no report final o que ficou pendente** (ex.: validação visual que exige a app rodando).

## 8. REFERÊNCIAS (código vivo)
- **Shell/registry:** `src/components/apps/app-desktop.tsx` · `src/lib/apps/registry.ts` (`AppDef`) · `src/lib/apps/overview-registry.ts` · `src/components/overview/overview-apps-desktop.tsx` (modelo do wrapper) · `src/components/apps/finance/finance-app.tsx` (app que busca dados próprios) · `src/app/(dashboard)/projects/[id]/_tabs/apps-tab.tsx` (modelo de renderSurface)
- **Client page:** `src/app/(dashboard)/clients/[id]/layout.tsx` · `_context/client-context.tsx` · `_components/client-sidebar.tsx` · `overview/page.tsx` · `projects/page.tsx` · `opportunities/page.tsx` · `csat/page.tsx` · `settings/page.tsx`
- **Nav style:** `src/components/overview/overview-tabs.tsx` · `src/app/(dashboard)/projects/[id]/page.tsx` (nav inline ~619–650)
- **Oportunidades:** `src/components/opportunities/opportunities-widget.tsx` · `opportunity-sheet.tsx` · `src/hooks/use-opportunities.ts` · `src/app/api/clients/[id]/opportunities/route.ts`
- **CSAT:** `src/components/clients/csat-response-card.tsx` · `csat-response-sheet.tsx` · `src/app/(dashboard)/clients/[id]/csat/page.tsx`
- **Board:** `src/components/overview/projetos-board.tsx` · `projetos-view.tsx` · `src/lib/dal/project-overview.ts` · `src/components/clients/client-project-card.tsx`
- **UI patterns:** `src/components/ui/responsive-sheet.tsx` · `confirm-dialog.tsx` · `src/hooks/use-optimistic-collection.ts` · AGENTS.md (§UI patterns)
