# Sprint Picker — opções de design

**Contexto:** dentro da aba `Sprints` do projeto, o grid 4-up de cards de sprint estava
duplicando a mesma timeline já presente no topo do projeto (resumo + ribbon).

**Decisão final (2026-04-30):** **sem picker.** Apenas o `SprintNavigator` reformatado
no estilo "header de capítulo" (opção D do segundo round). Nome grande centrado, meta
line embaixo (status · datas · %), setas ghost nas pontas. Sem caixa, sem dropdown,
sem grid de cards. Navegação: setas, atalho ←/→, e drawer da ribbon (info) pra panorama.

---

## Round 1 — onde mora a navegação?

| # | Direção | Status |
|---|---------|--------|
| 1 | Remover grid de cima, mover só pra aba Sprints | descartada |
| 2 | Inverter: grid no topo, dentro da aba só o focado | descartada |
| 3 | Trocar grid de cima por timeline horizontal compacta | descartada |
| 4 | Manter grid no topo, picker compacto na aba | **escolhida** → afinada no round 2 |
| 5 | Tornar contextuais (mesma timeline, papéis diferentes) | descartada |

## Round 2 — formato do picker compacto

| # | Direção | Status |
|---|---------|--------|
| A | Stepper horizontal (dots conectados) | tentado, não ficou charmoso |
| B | Pílulas inline scrolláveis | descartada |
| C | Tabs estilo "browser" | descartada |
| D | Combobox + setinhas + mini-progresso | descartada |
| E | Slider/range com timestamps | descartada |
| F | Breadcrumb hierárquico | descartada |

## Round 3 — minimalista, sem picker

| # | Direção | Status |
|---|---------|--------|
| 1 | Trilha de bolinhas mínima (só dots, sem labels) | descartada |
| 2 | Texto puro com separador `·` | descartada |
| 3 | Régua-do-tempo proporcional | descartada |
| 4 | Breadcrumb temporal | descartada |
| 5 | Pílulas finas (chip-row) | descartada |
| 6 | Letra + número (`S1 S2 S3 S4`) | descartada |
| 7 | Sem picker — só o navigator atual | **escolhida** |

## Round 4 — formato do body central do navigator

| # | Direção | Status |
|---|---------|--------|
| A | Trio centralizado clássico (nome · status · datas, uma linha) | **escolhida** |
| B | Empilhado em duas linhas (nome+status / datas+FP) | tentada, espaço vazio demais |
| C | Bullet centrado entre as setas | descartada |
| D | Nome grande + meta em rodapé fino | tentada, espaço vazio demais |
| E | "Capítulo X de Y" | descartada |

---

## Implementação final

**`SprintNavigator` — single line, container preservado:**

```
┌────────────────────────────────────────────────────────┐
│  ‹       Sprint 1 · Ativo · 27 abr → 01 mai · 100%       ›  │
└────────────────────────────────────────────────────────┘
```

- Container `rounded-xl border bg-muted/30`
- Single line: nome (semibold) · status · datas (mono) · %
- Setas ghost nas extremidades, conteúdo centralizado via `flex-1 justify-center`
- Status em primary quando focado = vigente
- Datas e % escondem em telas estreitas (sm/md)
- "Ir pro vigente" aparece antes da seta direita quando focado ≠ vigente
- Atalho ← / → preservado, sem dropdown
