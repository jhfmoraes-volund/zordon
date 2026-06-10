<!-- GERADO por scripts/gen-metrics-doc.ts — NÃO EDITE.
     SSOT: src/lib/metrics/registry.ts. Pra mudar fórmula/defesa, mude o
     registry (e o DAL, se for o caso) e rode: npx tsx scripts/gen-metrics-doc.ts -->

# STATS — dicionário de métricas do Overview de Projetos

Toda métrica exibida na aba Projetos do Overview (`/`) é **derivada** — nada é
coluna editável. Este dicionário é a defesa de cada número: fórmula exata,
fonte e a frase que explica pro CEO (a `defense` é o tooltip da UI **e** a
resposta do Alpha — D6). SSOT: `METRIC_REGISTRY` em
[`src/lib/metrics/registry.ts`](../../../src/lib/metrics/registry.ts); motor de
projeto: `computeStats()` em
[`src/lib/dal/project-overview.ts`](../../../src/lib/dal/project-overview.ts).

Organização: todo stat responde a uma pergunta — *quanto tempo queimou? quanto
saiu? em que ritmo? quanto da capacidade vira entrega?*

📸 = entra no snapshot semanal (`MetricSnapshot`, segundas 06:00 BRT — D3).

## PRAZO (calendário — independe de alguém criar sprint)

| Métrica | Unidade | Fórmula | Fonte | Defesa |
|---|---|---|---|---|
| **Sprints do contrato** (`project.sprints_total`) | sprints | segundas entre mondayOf(startDate) e mondayOf(endDate), inclusivo | `Project` | *quantas sprints o contrato comprou?* — O contrato é de N sprints — sprint é semana fechada seg→dom, constraint no banco. Contrato de N semanas *é* contrato de N sprints. |
| **Sprints decorridas** (`project.sprints_elapsed`) | sprints | segundas decorridas, clamp [0, total] | `Project` | *quanto do contrato já queimou em sprints?* — O calendário queima sozinho — o contrato não espera ninguém apertar play. |
| **% do contrato consumido** (`project.time_pct`) 📸 | pct | elapsed ÷ total | `Project` | *quanto do tempo comprado já passou?* — X% do tempo comprado já passou. |

Só existe em `fixed_scope` com datas (`mode: "contract"`). Contínuos não têm
prazo — fingir que há seria indefensável; viram `mode: "rolling"` (janela das
últimas 8 sprints).

## ENTREGA (produção — o que de fato saiu)

| Métrica | Unidade | Fórmula | Fonte | Defesa |
|---|---|---|---|---|
| **Sprints fechadas** (`project.sprints_closed`) 📸 | count | sprints `completed` OU endDate < hoje | `Project`, `Sprint` | *quantas sprints foram executadas até o fim?* — De N sprints compradas, X foram executadas até o fim. |
| **Avanço por sprint** (`project.done_pct`) 📸 | pct | closed ÷ total | `Project`, `Sprint` | *quanto do contrato virou sprint executada?* — Avanço guiado por sprint — o dado universal da fábrica (FP existe em ~1/3 dos projetos). |
| **Buracos** (`project.holes`) 📸 | count | semanas decorridas sem sprint cobrindo a segunda | `Project`, `Sprint` | *quantas sprints do contrato queimaram sem produção?* — Sprint do contrato queimada sem produção formalizada. Não acusa ninguém — mostra o fato. |
| **% do escopo** (`project.scope_pct`) 📸 | pct | Σ FP done ÷ Σ FP de tasks vivas | `Task` | *quanto do escopo de hoje está entregue?* — Contra o escopo de hoje — cliente adicionou escopo, % cai, e é honesto que caia. |

## RITMO (o motor — e pra onde a trajetória aponta)

| Métrica | Unidade | Fórmula | Fonte | Defesa |
|---|---|---|---|---|
| **Média FP/sprint** (`project.avg_fp_per_sprint`) 📸 | fp_per_sprint | Σ done ÷ n, últimas 6 fechadas com planned > 0 | `Sprint`, `sprint_capacity_overview` | *qual o ritmo real recente da linha?* — Ritmo real recente da linha — o time como está agora. |
| **Aproveitamento** (`project.utilization`) 📸 | pct | Σ done ÷ Σ capacity, mesma janela | `Sprint`, `sprint_capacity_overview` | *quanto da capacidade alocada vira entrega?* — De cada 100 FP de capacidade alocada, quantos viraram entrega. |
| **Pace** (`project.pace_gap`) 📸 | pp | scopePct − timePct · Faixas: ≥ 5: à frente · ≥ -5: no ritmo · ≥ -15: atrás · abaixo: crítico. | `Project`, `Task` | *estamos no ritmo do contrato?* — Queimei X% do tempo e entreguei Y% do escopo: Zpp de gap. Uma subtração, zero opinião. |
| **Projeção de término** (`project.projected_end_sprint`) 📸 | sprints | elapsed + ceil((fpTotal − fpDone) ÷ avgFp) | `Project`, `Task`, `sprint_capacity_overview` | *no ritmo atual, em que sprint o escopo termina?* — No ritmo médio recente, a matemática termina na sprint X. Não é palpite: é divisão. |

## CAPACIDADE & ALOCAÇÃO (builder e squad)

Quanto da capacidade alocada vira entrega — por builder, por squad. Fonte:
views `sprint_member_capacity` e `member_commitment_overview` via
`src/lib/dal/capacity.ts`.

| Métrica | Unidade | Fórmula | Fonte | Defesa |
|---|---|---|---|---|
| **Aproveitamento do builder** (`member.utilization`) 📸 | pct | Σ done ÷ Σ capacity do builder, janela 6 sprints fechadas | `sprint_member_capacity`, `Sprint` | *quanto da capacidade deste builder vira entrega?* — De cada 100 FP que este builder tinha de capacidade, quantos viraram entrega. ⚠ capacity reflete alocação corrente — time que mudou no meio carrega viés (congelar por sprint = v2). |
| **Compromisso do builder** (`member.committed_vs_capacity`) 📸 | pct | Σ committed cross-projeto ÷ capacityTotal, sprint corrente | `member_commitment_overview` | *quanto da capacidade do builder já está prometida?* — Quanto da capacidade do builder já está prometida — acima de 100% é overbooking. |
| **Aproveitamento do squad** (`squad.utilization`) 📸 | pct | Σ done ÷ Σ capacity dos membros do squad, janela 6 sprints fechadas | `SquadMember`, `sprint_member_capacity`, `Sprint` | *quanto da capacidade do squad vira entrega?* — O squad como unidade: capacidade alocada virando entrega. ⚠ capacity reflete alocação corrente — time que mudou no meio carrega viés (congelar por sprint = v2). |

## FÁBRICA (o agregado — ribbon do topo)

| Métrica | Unidade | Fórmula | Fonte | Defesa |
|---|---|---|---|---|
| **Aproveitamento da fábrica** (`factory.utilization`) 📸 | pct | média de project.utilization das linhas ativas | `Project`, `Sprint`, `sprint_capacity_overview` | *quanto da capacidade da fábrica vira entrega?* — A fábrica inteira: média das linhas ativas (já é a 'média da fábrica' do ribbon). |
| **Builders alocados** (`factory.builders_allocated`) 📸 | count | Members `position='product-builder'` com alocação ativa / total | `Member`, `ProjectMember`, `Project` | *quantos builders estão em linha de produção?* — Quantos builders estão em linha de produção agora. |
| **Linhas ativas** (`factory.lines_active`) 📸 | count | projetos em fase produtiva (immersion/ops) | `Project` | *quantas linhas de produção estão rodando?* — Linhas de produção rodando. |
| **Clientes ativos** (`factory.clients_active`) 📸 | count | distinct clients de linhas ativas (sem internos/eval) | `Project`, `Client` | *quantos clientes têm produção ativa?* — Clientes com produção ativa. |

## Régua (a visualização)

Um segmento por sprint do contrato (`contract`) ou por sprint (`rolling`):

- **Fechada** — cor pela entrega real (`done/planned`): verde ≥85%, âmbar 50–85%,
  vermelho <50%, cinza = sem FP.
- **Buraco** — tracejado âmbar: sprint do contrato queimada sem produção.
- **Corrente** — ring primário (ou âmbar, se não há sprint ativa).
- **Futura** — apagada.
- Pista não-cromática (WCAG 1.4.1): texto `5/12` sempre ao lado + tooltip por
  segmento.

## Regras transversais

- **Fase manda**: Comercial não exibe STATS de produção (sprints nascem na
  Imersão — mostra "em comercial há Xd" via `Project.phaseChangedAt`).
  Imersão/Ops sem sprint = ⚠ aviso legítimo. `phaseChangedAt` é estampado no
  `PUT /api/projects/[id]` quando a phase muda (backfill: `createdAt`).
- **Escadinha de degradação**: contrato completo (régua+pace+projeção) → só
  sprint (régua+done%) → contínuo (rolling+média) → nada (aviso por fase).
- **Métrica só existe se está no registry** — UI não renderiza stat fora dele;
  toda resposta numérica do Alpha sobre operação passa por `compute_metric`
  (D9). Nenhuma mudança de fórmula sem atualizar `defense` junto.
