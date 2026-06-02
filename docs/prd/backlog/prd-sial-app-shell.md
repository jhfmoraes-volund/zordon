# PRD — SIAL App Shell (scaffold, design system, dev-auth, mock-mode)

**Reference**: SIAL-APP
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Projeto**: SIAL (JUCESP) · DesignSession Inception `b0a0f115-0ba3-48e6-92c2-244fe115855b`
**Runtime**: sial-web-app (Next.js App Router + React + Supabase + GCP)
**Depende de**: — (**PRD #0** — pré-requisito de todos os outros)

## Grounding

> Legenda: `[doc §X]` = explícito no insumo · `[decisão-sessão]` = decidido nesta DS · `[inferência]` = proposta de implementação a validar.

- **[doc]**: três frentes de experiência — Área Pública (sem login), Portal do Requerente (gov.br), Backoffice interno (SSO) (doc §4); backoffice como app único com motor de perfis (RF09).
- **[decisão-sessão]**: stack Next.js (App Router) + React + Supabase + GCP; meta = **app frontend funcional 1-shot com mocks**, infra/deploy ficam pros devs (Track B).
- **[inferência]**: design system, dev-auth com troca de persona, infra de mock-mode (`SIAL_MOCK` + factory de gateways), harness de smoke. A validar.

## §1 Problema

1. O repositório do SIAL **não existe ainda** — sem scaffold (Next+Supabase+Tailwind+env) os outros PRDs não têm onde colocar API routes, páginas e libs.
2. Os PRDs de feature **assumem primitivos de UI** (Button, Field, ResponsiveSheet…) e um client Supabase que precisam existir antes.
3. Auth real (gov.br OIDC / SSO interno) **não é executável em 1-shot** — para clicar a demo é preciso **dev-login com troca de persona**.
4. As três frentes precisam de **shell de navegação e rotas** para o resultado ser "um app que mostra como funciona", não telas soltas.
5. O caminho feliz da demo é **mock**; isso precisa ser estrutural (flag + factory), não combinado de boca.

## §2 Solução em uma frase

Estabelece o esqueleto do app SIAL — projeto Next.js+Supabase, **design system**, **rotas das 3 frentes** com layout/nav, **dev-auth com troca de persona** e a **infra de mock-mode** — a base que torna todos os PRDs seguintes executáveis em 1-shot.

## §3 Não-objetivos

- Lógica de domínio (Processo, Análise…) — PRDs próprios.
- Auth real gov.br/SSO — `prd-sial-identity-access` (real) e Track B; aqui só dev-auth.
- Infra/CI/CD/deploy GCP — **devs (Track B)**.

## §4 Personas e jornada

- **Builder/Forge**: "Quero um repo que builda, com primitivos e rotas prontos, pra cada PRD seguinte só plugar."
- **Avaliador da demo (PM/JUCESP)**: "Quero entrar como requerente, resolvedor ou admin com um clique e navegar as 3 frentes."

## §5 Decisões fixadas

| Dn | Decisão | Fonte |
|----|---------|-------|
| D1 | Next.js (App Router) + React + TypeScript + Tailwind; Supabase (client server+browser) | [decisão-sessão] |
| D2 | Design system próprio do SIAL em `src/components/ui/` (Button, Input, Textarea, Select, Field/FormBody, ResponsiveSheet, ResponsiveDialog, ConfirmDialog, Card, StatusChip, Toaster) | [inferência] (espelha padrões maduros) |
| D3 | Três route groups: `(publico)` sem auth, `(portal)` requerente, `(backoffice)` servidor (RF09 = app único com perfis) | [doc §4] |
| D4 | **Dev-auth**: `DevAuthProvider` + `/api/dev-auth/login` (env-gated por `SIAL_DEV_AUTH=1`) permite logar como persona; **desligado em produção** | [inferência] — destrava o 1-shot |
| D5 | **Mock-mode**: `SIAL_MOCK` (default `1` em dev/demo). Factory `getGateways()` retorna stubs por default; impl real (Track B) entra atrás da mesma interface por flag | [decisão-sessão] |
| D6 | Helper de sessão único `getSession()` que entende dev-auth e (no futuro) Supabase Auth real | [inferência] |
| D7 | Harness de smoke: `scripts/smoke/<feature>.ts` + `npm run smoke` — verificação automatizável sem browser | [inferência] |

## §6 Arquitetura

```
src/
  app/
    (publico)/            ← validação pública, diretório (sem login)
    (portal)/             ← requerente (dev-auth: requerente)
    (backoffice)/         ← servidor (dev-auth: resolvedor/admin)
    api/
      dev-auth/login/     ← seta sessão de persona (SIAL_DEV_AUTH=1)
      health/             ← smoke
  components/ui/          ← design system (D2)
  lib/
    supabase/             ← client server+browser + types
    sial/
      gateways/           ← factory getGateways() (D5): mock | real
      auth/session.ts     ← getSession() (D6)
  scripts/smoke/          ← harness (D7)

SIAL_MOCK=1  → getGateways() = stubs determinísticos  (demo 1-shot)
SIAL_MOCK=0  → impl real (Track B)                      (devs)
```

## §7 Schema

Sem schema de banco — este PRD é **scaffolding de código** e infra de app. O schema começa em `prd-sial-core-process`.

## §8 APIs

| Método | Path | Contrato |
|--------|------|----------|
| GET | `/api/health` | → `{ok:true}` (smoke) |
| POST | `/api/dev-auth/login` | (se `SIAL_DEV_AUTH=1`) `{persona:'requerente'|'resolvedor'|'administrador'}` → seta sessão → 200; 404 em produção |
| POST | `/api/dev-auth/logout` | encerra sessão → 204 |

## §9 UX

```
┌─ Top bar ─────────────────────────────────────────────┐
│ SIAL · JUCESP            [ persona: Resolvedor ▾ (dev) ]│  ← troca de persona (dev-auth)
├───────────────┬───────────────────────────────────────┤
│ (publico)     │  Validar autenticidade · Profissionais │
│ (portal)      │  Meus requerimentos · Novo · Pendências │
│ (backoffice)  │  Fila · Análise · Admin                 │
└───────────────┴───────────────────────────────────────┘
```

## §10 Integrações

- **Base de todos os PRDs**: design system, rotas, `getSession()`, e o factory `getGateways()` que os PRDs de feature consomem (CadastroLookup, PagamentoGateway, AssinaturaGateway, StorageGateway, E2docGateway, SincronizacaoGateway).
- `prd-sial-identity-access`: substitui o dev-auth pelo Supabase Auth real (mantém `getSession()`).
- `prd-sial-mock-data`: popula as telas servidas pelo shell.

## §11 Faseamento

Fase 1: scaffold (Next+Supabase+Tailwind+env) → design system → route groups + layout/nav → mock-mode (flag + factory) → dev-auth (persona switcher) → smoke harness. Ao fim: app builda, 3 frentes navegáveis, troca de persona funciona — pronto pra receber as features.

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Dev-auth vazar pra produção | B | A | Env-gated (`SIAL_DEV_AUTH`); rota retorna 404 sem a flag; teste cobre o gate. |
| Design system divergir do que os PRDs assumem | M | M | Inventário fixado em D2; PRDs seguintes referenciam esses nomes. |
| Mock-mode mascarar bug que só aparece no real | M | M | Mesma interface mock/real; Track B roda os mesmos smokes com `SIAL_MOCK=0`. |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| App builda limpo | `npm run build` exit 0 |
| Health ok | `curl /api/health` → `{ok:true}` |
| 3 frentes navegáveis + troca de persona | smoke `scripts/smoke/app-shell.ts` |

## §14 Open questions

- ❓ Next.js vs Vite SPA? **Assumido Next App Router (paths dos PRDs já assumem); confirmar.**
- ❓ Biblioteca de componentes base (shadcn/ui?) — **a definir na implementação; contrato dos primitivos fixado em D2.**

## §15 Referências

- Insumos: `Documento_de_Produto_SIAL.md` §4.
- DesignSession: especificações técnicas (stack React+Supabase+GCP).
- Memory: [[project_sial_inception]], [[feedback_grounded_no_hallucination]].

## §16 Stories implementáveis

```yaml
- id: SIAL-APP-001
  title: Scaffold Next.js + TS + Tailwind + Supabase + env
  description: Inicializa o projeto (Next App Router, TypeScript strict, Tailwind), adiciona supabase-js e .env.example com as chaves (SUPABASE_URL/ANON/SERVICE, SIAL_MOCK, SIAL_DEV_AUTH).
  acceptanceCriteria:
    - "npm run build passa"
    - ".env.example lista SIAL_MOCK e SIAL_DEV_AUTH"
    - "tsconfig em strict"
  verifiable:
    - kind: lint
      command_or_query: "npm run build"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 30
  touches: ["package.json", "tsconfig.json", "tailwind.config.ts", ".env.example"]

- id: SIAL-APP-002
  title: Supabase client (server + browser) + getSession()
  description: src/lib/supabase/{server,client}.ts e src/lib/sial/auth/session.ts (getSession lê dev-auth agora; Supabase Auth depois).
  acceptanceCriteria:
    - "Clients server e browser exportados"
    - "getSession() retorna {usuario|null, persona}"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-APP-001]
  estimateMinutes: 25
  touches: ["src/lib/supabase/server.ts", "src/lib/supabase/client.ts", "src/lib/sial/auth/session.ts"]

- id: SIAL-APP-003
  title: Design system — campos e ações
  description: src/components/ui Button, Input, Textarea, Select, Field/FormBody conforme D2.
  acceptanceCriteria:
    - "Field injeta id/aria no controle filho"
    - "Button tem variantes primária/secundária/destrutiva"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-APP-001]
  estimateMinutes: 30
  touches: ["src/components/ui/button.tsx", "src/components/ui/input.tsx", "src/components/ui/field.tsx", "src/components/ui/select.tsx"]

- id: SIAL-APP-004
  title: Design system — overlays e feedback
  description: ResponsiveSheet, ResponsiveDialog, ConfirmDialog, StatusChip, Card, Toaster (sonner) conforme D2.
  acceptanceCriteria:
    - "ResponsiveSheet vira bottom-sheet no mobile",
    - "ConfirmDialog stateless com onConfirm async",
    - "Toaster montado no layout raiz"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-APP-003]
  estimateMinutes: 30
  touches: ["src/components/ui/responsive-sheet.tsx", "src/components/ui/responsive-dialog.tsx", "src/components/ui/confirm-dialog.tsx", "src/components/ui/status-chip.tsx", "src/components/ui/sonner.tsx"]

- id: SIAL-APP-005
  title: Route groups + layout/nav das 3 frentes
  description: app/(publico), app/(portal), app/(backoffice) com layout próprio e nav; landings stub por frente.
  acceptanceCriteria:
    - "3 route groups com layout e nav",
    - "Cada frente tem uma landing navegável"
  verifiable:
    - kind: lint
      command_or_query: "npm run build"
      expected: "exit 0"
  dependsOn: [SIAL-APP-004, SIAL-APP-002]
  estimateMinutes: 30
  touches: ["src/app/(publico)/layout.tsx", "src/app/(portal)/layout.tsx", "src/app/(backoffice)/layout.tsx"]

- id: SIAL-APP-006
  title: Mock-mode — flag + factory de gateways
  description: src/lib/sial/gateways/index.ts com getGateways() que lê SIAL_MOCK e devolve registry de stubs (placeholders das interfaces que os PRDs preencherão).
  acceptanceCriteria:
    - "getGateways() com SIAL_MOCK=1 retorna implementações mock",
    - "Registry tipado com as interfaces (cadastro, pagamento, assinatura, storage, e2doc, sincronizacao)",
    - "SIAL_MOCK=0 lança 'real gateway not configured' até o Track B"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-APP-002]
  estimateMinutes: 30
  touches: ["src/lib/sial/gateways/index.ts", "src/lib/sial/gateways/types.ts"]

- id: SIAL-APP-007
  title: Dev-auth — persona switcher + rotas (env-gated)
  description: DevAuthProvider + topbar switcher + POST/POST logout em /api/dev-auth; 404 sem SIAL_DEV_AUTH.
  acceptanceCriteria:
    - "Login seta sessão da persona escolhida",
    - "Sem SIAL_DEV_AUTH as rotas retornam 404",
    - "Switcher troca a frente/visão conforme persona"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-APP-005, SIAL-APP-006]
  estimateMinutes: 30
  touches: ["src/app/api/dev-auth/login/route.ts", "src/app/api/dev-auth/logout/route.ts", "src/components/sial/dev-auth-switcher.tsx"]

- id: SIAL-APP-008
  title: Smoke harness + /api/health
  description: scripts/smoke/runner + npm run smoke + rota /api/health; smoke app-shell verifica build/health/navegação.
  acceptanceCriteria:
    - "npm run smoke app-shell roda e passa",
    - "/api/health retorna {ok:true}"
  verifiable:
    - kind: http
      command_or_query: "curl -s localhost:3000/api/health"
      expected: "{\"ok\":true}"
  dependsOn: [SIAL-APP-005]
  estimateMinutes: 25
  touches: ["scripts/smoke/runner.ts", "scripts/smoke/app-shell.ts", "src/app/api/health/route.ts", "package.json"]

- id: SIAL-APP-009
  title: Smoke end-to-end do shell
  description: App builda, 3 frentes navegáveis, troca de persona muda a visão. Verificação por smoke automatizável + checagem manual leve.
  acceptanceCriteria:
    - "npm run build + npm run smoke app-shell passam",
    - "Trocar para 'resolvedor' abre o backoffice; 'requerente' o portal"
  verifiable:
    - kind: lint
      command_or_query: "npm run build && npm run smoke app-shell"
      expected: "exit 0"
  dependsOn: [SIAL-APP-007, SIAL-APP-008]
  estimateMinutes: 20
  touches: ["(end-to-end)"]
```

**Total: 9 stories, ~250min (~4h10).**
