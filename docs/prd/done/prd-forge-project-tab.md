# PRD — Forge Project Tab

> **Contexto:** primeira peça da "Forge multi-projeto". Hoje `/forge-spike` é dev-only e global; este PRD cria uma área Forge dentro de `/projects/[id]/` (sóbria, PM-only) que serve de entrada amigável e leva pro spike (mantido como está) com filtro de projeto.

## 1 · Problema

1. **Forge é dev-only.** Rota `/forge-spike` é restrita a access_level=builder+, sem ponto de entrada natural pros PMs operarem o ciclo dentro de um projeto.
2. **Sem visão por projeto.** Forge lista PRDs/runs globais; PM de Acme Bank não tem como ver "quais PRDs e runs são do meu projeto" sem ler URL/título.
3. **PMs descobrem Forge por boca-a-boca.** Sem affordance no `/projects/[id]/`, o ciclo Discovery → Forja → Entrega não fecha visualmente.

## 2 · Solução em uma frase

Adicionar tab/área "Forge" em `/projects/[id]/forge` (PM-only) com card de resumo (PRDs vinculados ao projeto + últimas runs + custo) e botão "Abrir Forge Spike" que leva pro spike existente com `?projectId=<id>` como filtro.

## 3 · Não-objetivos

- Não reescrever a UI do `/forge-spike` — fica intacta.
- Não criar nova fonte de dados; usa as mesmas DALs existentes (prd-fs, ForgeRun) com filtro.
- Não disparar autorun direto da área do projeto (botão de run continua dentro do spike).
- Não criar nova rota `/forge` global — escopo é per-project.
- Não controlar acesso por projeto-membership (só access_level global por enquanto).

## 4 · Personas e jornada

- **PM**: "Quero abrir o projeto Acme Bank, ver o que a Forge fez/tá fazendo aqui, e clicar pra agir."
- **Head Ops / CEO**: "Quero auditar overhead/custo de Forge por projeto."
- **Builder / Guest**: não veem esta área (RLS no SELECT de `/projects/[id]/forge`).

## 5 · Decisões fixadas

| ID | Decisão | Por quê |
|---|---|---|
| D1 | Rota nova: `/projects/[id]/forge` em `src/app/(dashboard)/projects/[id]/forge/page.tsx` | App Router, alinhado ao padrão das outras tabs do projeto. |
| D2 | Acesso: `access_level >= manager` | PM-only conforme requisito do João. Sem custom project-role check nesta fase. |
| D3 | UI sóbria, mesmo design system | Card + Button do shadcn; sem PixelBar/cyan. Tom igual ao resto. |
| D4 | Filtro propaga via query string: `/forge-spike?projectId=<id>` | Não muda contrato interno do spike; só nova URL aceita filtro. |
| D5 | `/forge-spike` aceita query `projectId` e filtra: PRD list, runs list, autoruns | Filtro client+server-side (componente raiz lê searchParams). |
| D6 | "PRDs vinculados ao projeto" hoje: filename match com slug do projeto | Hack provisório enquanto PRDs vivem em filesystem. Quando migrarem pra DB (ProductRequirement), troca pra `WHERE projectId = X`. |
| D7 | "Últimas runs" = top 5 ForgeRun do projeto, ordem desc por createdAt | Cap pequeno pra evitar scroll na home. Link "Ver todas" leva ao spike. |
| D8 | Custo agregado mostrado: soma `costUsdTotal` das runs últimos 7d | Métrica única, fácil de bater olho. |
| D9 | Sem realtime nesta página (revalidate-on-focus basta) | Realtime fica no spike. Project tab é resumo, refresh é OK. |

## 6 · Arquitetura

```
/projects/[id]/forge
└── page.tsx (Server Component)
    ├── getProjectForgeSummary(projectId)   → src/lib/dal/forge-project.ts (NEW)
    │     ├── reads prd-fs.listPrds()       → filter by project slug match (D6)
    │     ├── reads ForgeRun WHERE projectId=X order by createdAt desc limit 5
    │     └── aggregates cost7d
    └── renders <ForgeProjectCard data={...} />  (UI component, NEW)

/forge-spike (existing) gains:
    └── useSearchParams() → reads projectId → filters prd-fs.listPrds + ForgeRun queries
```

## 7 · Schema

Sem migrations nesta fase. Aproveita:
- `Project` (já tem id, name)
- `ForgeRun` (já tem projectId — coluna criada em FE-003)
- `prd-fs` (filesystem; filtro por nome/slug)

Futura migração de PRDs pra DB (`ProductRequirement` por `Project`) é PRD separado.

## 8 · APIs

Sem endpoints novos. Tudo é Server Component lendo via DAL.

DAL nova:
```ts
// src/lib/dal/forge-project.ts
export async function getProjectForgeSummary(projectId: string): Promise<{
  prds: PrdSummary[];      // filtered by project (D6)
  runs: ForgeRunRow[];     // top 5 by createdAt
  cost7d: number;          // sum costUsdTotal where createdAt >= now() - 7d
  runCount7d: number;
}>;
```

## 9 · UX

```
┌─ /projects/[id]/forge ─────────────────────────────────────┐
│  Forge · Acme Bank                                          │
│  4 PRDs vinculados · 12 runs nos últimos 7d · $14.30 gasto │
│                                                              │
│  ── PRDs ──────────────────────────────────────────         │
│  ▣ prd-auth-passwordless          ready                     │
│  ▣ prd-dashboard-mobile           in-progress · 80%         │
│  ✓ prd-onboarding-flow            done                      │
│  + Ver todos no Forge Spike                                 │
│                                                              │
│  ── Últimas runs ──────────────────────────────────         │
│  ▶ prd-dashboard-mobile · 32min · $1.20 · Pedro            │
│  ✓ prd-onboarding-flow  · 3h12 · $4.10 · João              │
│  ✓ prd-auth-passwordless · 1h45 · $2.30 · João             │
│                                                              │
│             [ Abrir Forge Spike → ]                          │
└─────────────────────────────────────────────────────────────┘
```

Vazio: "Esse projeto ainda não tem PRDs vinculados. [ Abrir Forge Spike ] pra criar."

## 10 · Integrações

- **Project page sidebar/tabs** ([src/app/(dashboard)/projects/[id]/page.tsx]): adicionar link/tab "Forge" ao lado de "Wiki", "Sprint", etc. Visibilidade condicional ao access_level.
- **`/forge-spike` raiz** ([src/app/forge-spike/page.tsx] / `/forge-spike/prds`): aceita searchParam `projectId`; quando presente, filtra lista de PRDs e runs.
- **DAL `prd-fs.ts`**: ganha helper `filterPrdsByProject(prds, project)` baseado em slug match (D6).

## 11 · Faseamento

| Fase | Entrega |
|---|---|
| 1 | DAL + page.tsx + card resumo (read-only, sem realtime) |
| 2 | Filtro query string no `/forge-spike` (PRD list + runs list) |
| 3 | Tab/link na navegação do projeto (visibilidade PM-only) |

Tudo em single PR. Fases marcam apenas a ordem de implementação interna.

## 12 · Riscos

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| Slug-match (D6) gera falsos positivos/negativos | M | M | Helper isolado em DAL; quando ProductRequirement existir, swap fácil. |
| PMs querem agir direto (run/kill) na project tab | M | B | Botão "Abrir spike" é claro; spike tem todas ações. Pode evoluir depois. |
| Tab visível pra builder via cache de layout | L | A | RLS no Server Component (return notFound se access_level < manager). |
| ForgeRun.projectId vem null em runs legadas | A | B | Filtro `WHERE projectId = X` exclui null; runs órfãs aparecem só no spike global. |

## 13 · Métricas de sucesso

| Métrica | Instrumento | Target |
|---|---|---|
| % PMs que entram em `/projects/[id]/forge` por semana | log de pageview (page emite event a definir) | ≥ 70% em 2 semanas pós-rollout |
| Tempo até primeira run de um PRD novo de cliente | timestamp criação PRD → primeira ForgeRun com aquele prdSlug | ≤ 15min mediana |
| Reclamação de PMs sobre "onde fica a Forge?" | Slack feedback (qualitativo) | zero em 2 sprints |

## 14 · Open questions

Nenhuma. Tudo decidido em §5.

## 15 · Referências

- Memory `project_forge_double_diamond.md` — duplo diamante agêntico
- Memory `project_forge_vs_zordon_workflow.md` — workflow git da Forge
- Memory `project_forge_hermes_alignment.md` — futuro skill library
- `src/app/(dashboard)/projects/[id]/page.tsx` — página do projeto
- `src/app/forge-spike/page.tsx` — spike existente (não tocar)
- `src/lib/forge/prd-fs.ts` — DAL de PRDs filesystem
- `src/lib/forge/dal/run.ts` — DAL de ForgeRun

## 16 · Stories implementáveis

```yaml
- id: FPT-001
  title: DAL src/lib/dal/forge-project.ts
  description: |
    Cria DAL que combina prd-fs.listPrds (filtrado por slug match do project)
    com ForgeRun (top 5 + cost7d agg). Server-only, usado por page.tsx.
  acceptanceCriteria:
    - "src/lib/dal/forge-project.ts exporta getProjectForgeSummary(projectId): Promise<ProjectForgeSummary>"
    - "Type ProjectForgeSummary tem: prds[], runs[], cost7d, runCount7d"
    - "Filtra ForgeRun por projectId (Supabase query)"
    - "Filtra prds com helper filterPrdsByProject (slug-match com project.name kebab-case)"
    - "Cost7d soma costUsdTotal das runs onde createdAt >= now() - 7 days"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: lint
      command_or_query: "pnpm exec eslint src/lib/dal/forge-project.ts"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 20
  touches:
    - src/lib/dal/forge-project.ts
  agentProfile: db

- id: FPT-002
  title: Página /projects/[id]/forge + card sóbrio
  description: |
    Server Component que chama getProjectForgeSummary e renderiza ForgeProjectCard.
    RLS: redireciona/404 se access_level < manager. Empty state.
  acceptanceCriteria:
    - "src/app/(dashboard)/projects/[id]/forge/page.tsx existe"
    - "Page é Server Component (default export async function)"
    - "Chama getCurrentMember + checa access_level >= manager; senão notFound()"
    - "Renderiza ForgeProjectCard com props { project, summary }"
    - "Empty state quando prds.length === 0 mostra CTA pro spike"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: http
      command_or_query: "curl -s -o /dev/null -w '%{http_code}' http://localhost:3333/projects/test-id/forge"
      expected: "200 or 404 (auth-dependent)"
  dependsOn: [FPT-001]
  estimateMinutes: 25
  touches:
    - src/app/(dashboard)/projects/[id]/forge/page.tsx
  agentProfile: ui

- id: FPT-003
  title: Componente ForgeProjectCard (sóbrio, padrão UI canônico)
  description: |
    Card UI mostrando título, agregados (PRDs/runs/cost), lista de PRDs (até 5),
    lista de últimas runs (até 5) e botão "Abrir Forge Spike".
    Usa shadcn Card + Button. Sem tema "arcade".
  acceptanceCriteria:
    - "src/components/forge/forge-project-card.tsx implementa o componente"
    - "Botão 'Abrir Forge Spike' linka pra /forge-spike?projectId=<project.id>"
    - "Status badges de PRD usam StatusChip (padrão canônico)"
    - "Layout responsivo (mobile-friendly, sem horizontal scroll)"
    - "Sem cores arcade (cyan/magenta) — só design tokens do app"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: lint
      command_or_query: "pnpm exec eslint src/components/forge/forge-project-card.tsx"
      expected: "exit 0"
  dependsOn: [FPT-001]
  estimateMinutes: 25
  touches:
    - src/components/forge/forge-project-card.tsx
  agentProfile: ui

- id: FPT-004
  title: /forge-spike aceita ?projectId= como filtro
  description: |
    Componente raiz do spike (e subrotas /forge-spike/prds, /forge-spike/runs)
    lê searchParam projectId via useSearchParams; quando presente, filtra:
    - listPrds com filterPrdsByProject
    - ForgeRun queries com .eq('projectId', projectId)
    Banner topo: "Filtrando: projeto Acme Bank · [limpar filtro]"
  acceptanceCriteria:
    - "src/app/forge-spike/page.tsx (e prds/page.tsx) leem searchParams.projectId"
    - "Quando projectId presente, lista de PRDs e runs filtra"
    - "Banner topo mostra nome do projeto + link 'limpar filtro' (=removeProjectIdFromUrl)"
    - "Sem projectId, comportamento atual preservado"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: http
      command_or_query: "curl -s -o /dev/null -w '%{http_code}' 'http://localhost:3333/forge-spike?projectId=abc'"
      expected: "200"
  dependsOn: [FPT-001]
  estimateMinutes: 25
  touches:
    - src/app/forge-spike/page.tsx
    - src/app/forge-spike/prds/page.tsx
  agentProfile: ui

- id: FPT-005
  title: Tab/link Forge na navegação do projeto
  description: |
    Adiciona "Forge" às tabs/sidebar de /projects/[id]/. Visível só pra
    access_level >= manager. Ícone Flame (lucide).
  acceptanceCriteria:
    - "src/app/(dashboard)/projects/[id]/layout.tsx (ou nav component) tem link 'Forge'"
    - "Visibilidade condicional ao member.access_level >= 'manager'"
    - "URL ativo destaca tab quando pathname inclui /forge"
    - "Icon Flame de lucide-react"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
    - kind: http
      command_or_query: "curl -s http://localhost:3333/projects/test-id/ | grep -c 'Forge'"
      expected: ">= 1"
  dependsOn: [FPT-002]
  estimateMinutes: 15
  touches:
    - src/app/(dashboard)/projects/[id]/layout.tsx
  agentProfile: ui

- id: FPT-006
  title: Helper filterPrdsByProject (slug-match)
  description: |
    Hack provisório até PRDs migrarem pra DB. Recebe PRD slug e Project,
    retorna true se PRD slug contém kebab-case do project.name OU se
    PRD slug está em mapa explícito project.forgeLinkedPrds (futuro).
  acceptanceCriteria:
    - "src/lib/forge/prd-fs.ts exporta filterPrdsByProject(prds, project)"
    - "Match: kebabCase(project.name) é substring de prd.slug"
    - "Helper documentado como provisório com TODO de migrar pra DB"
    - "Unit test: 'Acme Bank' matches 'prd-acme-bank-auth' mas não 'prd-acme'"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 15
  touches:
    - src/lib/forge/prd-fs.ts
  agentProfile: db
```

Total: 6 stories, ~125min estimados.
