# PRD — Sweep `react-hooks/set-state-in-effect`

## 1. Problema

A regra `react-hooks/set-state-in-effect` (React 19+) está sinalizando **48 ocorrências** no `src/` em 2026-05-31. O padrão `useEffect(() => { void load(); }, [id])` onde `load` chama `setState` síncronamente dispara cascading re-renders e foi flagado pelo time React como anti-pattern.

Hoje o erro só não trava CI porque cada novo edit num arquivo afetado vê o hook reportando o problema e empurra a correção pra quem está editando algo não-relacionado (visto no fix de header da tela `/clients/[id]` em 2026-05-31).

## 2. Solução em uma frase

Sweep top-down dos 48 sites pra mover data-loading de `useEffect → load() → setState` pra Server Components (quando possível) ou pra padrão idiomático com `useSyncExternalStore`/SWR-like fetcher.

## 3. Não-objetivos

- Reescrever camada de DAL.
- Introduzir SWR/React Query (avaliar separado).
- Mudar arquitetura de auth/context.

## 4. Personas e jornada

- **Dev tocando feature X**: edita arquivo, hook não enche o saco com lint não-relacionado.
- **Reviewer**: PR diff não mistura mudança real + fix de lint pré-existente.

## 5. Decisões fixadas

| Dn | Decisão | Por quê |
|---|---|---|
| D1 | Server Component + Suspense > client fetch quando o dado é renderizado on-mount sem interação | App router suporta, elimina a categoria toda |
| D2 | Pra dados que precisam de cliente (auth-gated, ações realtime), usar padrão `loader` com `useEffect` + abort, mas isolando setState num callback fora do effect body | Atende a regra |
| D3 | NÃO usar `eslint-disable` em massa — cada site recebe fix real | Regra existe por motivo |
| D4 | Priorizar páginas com 1 só `useEffect → load()` (low-risk) antes de páginas com múltiplos | Reduz blast radius |
| D5 | Manter `// eslint-disable-next-line react-hooks/exhaustive-deps` onde já existe | Esse é outro problema |
| D6 | Stories agrupam por similaridade de padrão, não por arquivo | Bate com paralelismo do Ralph |
| D7 | Cada story tem `verifiable: lint` que conta zero violações na pasta tocada | Automatizável |
| D8 | Closeout do PRD só com `npx eslint src/ 2>&1 \| grep -c react-hooks/set-state-in-effect` = 0 | Critério limpo |

## 6. Arquitetura

Não há componente novo — refactor de loading pattern em loco.

## 7. Schema

N/A — sem mudança de schema.

## 8. APIs

N/A — endpoints existentes mantidos.

## 9. UX

N/A — loading visual deve permanecer idêntico (Skeleton patterns mantidos).

## 10. Integrações

Toca todos os subsistemas que fazem fetch on-mount (DAL, Supabase client, contexts).

## 11. Faseamento

1. **Fase 1**: páginas detalhe `[id]` simples (1 effect+load). Ex: `clients/[id]`, `members/[id]`, `meetings/[id]`. ~15 sites.
2. **Fase 2**: páginas com múltiplos effects (filters, dependent fetches). ~20 sites.
3. **Fase 3**: contexts e hooks reutilizados. ~13 sites.

## 12. Riscos

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| Regression de loading state | Média | Alto | Cada PR roda smoke manual antes de merge |
| Server component não suportar `useAuth` context | Alta | Médio | Casos manter client, mas refatorar effect com `startTransition` |
| Suspense boundary faltando quebra render | Média | Alto | Adicionar boundary explícito ao migrar |

## 13. Métricas de sucesso

- `npx eslint src/ 2>&1 \| grep -c react-hooks/set-state-in-effect` = 0 (instrumento: CI step novo).
- Sem regression de p95 TTI nas páginas tocadas (instrumento: Vercel Analytics, dashboard padrão).

## 14. Open questions

- Adotar SWR no caminho? (Fase ≥ 2, separado deste PRD)

## 15. Referências

- Trigger original: hook PostToolUse no edit de [src/app/(dashboard)/clients/[id]/page.tsx:189](../../src/app/(dashboard)/clients/[id]/page.tsx#L189) em 2026-05-31.
- React docs: https://react.dev/learn/you-might-not-need-an-effect
- Contagem inicial: 48 ocorrências (`npx eslint src/` em 2026-05-31).

## 16. Stories implementáveis

```yaml
- id: LINT-001
  title: Inventariar todos os sites afetados em arquivo CSV
  description: Rodar eslint, parsear output, gerar docs/prd/in-progress/lint-set-state-sites.csv com colunas (path, line, classificação: server-candidate | client-required | context).
  acceptanceCriteria:
    - "Arquivo docs/prd/in-progress/lint-set-state-sites.csv existe"
    - "Linhas = 48 (ou contagem atual no momento do run)"
    - "Cada linha tem classificação preenchida"
  verifiable:
    - kind: sql
      command_or_query: "wc -l docs/prd/in-progress/lint-set-state-sites.csv"
      expected: "≥ 49 (header + 48)"
  dependsOn: []
  estimateMinutes: 20
  touches: [docs/prd/in-progress/lint-set-state-sites.csv]

- id: LINT-002
  title: Migrar páginas detalhe [id] simples (Fase 1)
  description: Pra cada site classificado como server-candidate em LINT-001, mover fetch pra Server Component + passar dados como props.
  acceptanceCriteria:
    - "Sites Fase 1 do CSV não aparecem mais em eslint output"
    - "Visual idêntico (skeleton mantido onde aplicável via Suspense fallback)"
  verifiable:
    - kind: lint
      command_or_query: "npx eslint src/app/\\(dashboard\\)/clients/\\[id\\]/page.tsx 2>&1 | grep -c react-hooks/set-state-in-effect"
      expected: "0"
  dependsOn: [LINT-001]
  estimateMinutes: 30
  touches: [src/app/(dashboard)/clients/[id]/page.tsx, src/app/(dashboard)/members/[id]/, src/app/(dashboard)/meetings/[id]/]

- id: LINT-003
  title: Migrar páginas com multiple effects (Fase 2)
  description: Páginas com filters/dependent fetches — refactor usando useTransition + isolar setState fora do effect body.
  acceptanceCriteria:
    - "Sites Fase 2 do CSV não aparecem mais em eslint output"
  verifiable:
    - kind: lint
      command_or_query: "npx eslint src/ 2>&1 | grep -c react-hooks/set-state-in-effect"
      expected: "≤ 13 (só Fase 3 restante)"
  dependsOn: [LINT-002]
  estimateMinutes: 30
  touches: [src/app/(dashboard)/]

- id: LINT-004
  title: Migrar contexts e hooks reutilizados (Fase 3)
  description: Auth context, design-session context, hooks compartilhados. Padrão `useSyncExternalStore` onde apropriado.
  acceptanceCriteria:
    - "0 violações totais"
  verifiable:
    - kind: lint
      command_or_query: "npx eslint src/ 2>&1 | grep -c react-hooks/set-state-in-effect"
      expected: "0"
  dependsOn: [LINT-003]
  estimateMinutes: 30
  touches: [src/contexts/, src/hooks/]

- id: LINT-005
  title: CI step que bloqueia regressão
  description: Adicionar step em GitHub Actions (ou hook local) que falha se a contagem voltar a > 0.
  acceptanceCriteria:
    - "Workflow .github/workflows/lint.yml (ou similar) tem step explícito pro rule"
    - "PR de teste com violação intencional é barrado"
  verifiable:
    - kind: manual_browser
      command_or_query: "Abrir PR com violação propositada e ver step falhar"
      expected: "Step status = failure"
  dependsOn: [LINT-004]
  estimateMinutes: 15
  touches: [.github/workflows/]
```
