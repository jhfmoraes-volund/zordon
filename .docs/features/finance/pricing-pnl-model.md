# Modelo de Pricing & P&L — referência (planilha Hitz)

> Análise de `.assets/Pricing_Hitz_Servico.xlsx` (Squad as a Service / Hitz). Captura o modelo de cálculo pra alimentar a evolução do app Finanças: **cada projeto com uma "folha de cálculo" (DRE) pra saber a margem real**. Ver [finance-app-plan.md](finance-app-plan.md).

## 1. As 3 abas

| Aba | Papel |
|---|---|
| **Resumo Servico** | Premissas + composição de time + custo→preço (gross-up) + DRE da vigência. O motor. |
| **P&L** | DRE limpo (cascata Faturamento → impostos → custos → SG&A → IRPJ → lucro líquido). |
| **Proposta Comercial** | Itens de proposta (pacote, meses, valor mensal, total). Saída comercial. |

## 2. Premissas gerais (inputs editáveis — "células amarelas")

| Premissa | Valor | Nota |
|---|---|---|
| Margem alvo (antes do IR) | **38%** | objetivo sobre faturamento — só usado no **pricing** |
| SG&A | **10%** | despesas adm/comerciais (% do faturamento) |
| ISS | **2%** | imposto sobre serviços |
| PIS | **0,65%** | cumulativo |
| COFINS | **3%** | cumulativo |
| Custo financeiro (mensal) | **2,5%** | capital de giro — 1 mês financiado |
| IRPJ/CSLL | **34%** | só na DRE (não afeta o preço) |
| Vigência (meses) | 3 | mínimo contratual |
| Horas/mês por FTE | 160 | base pro preço/hora implícito |
| IA por FTE/mês | R$ 500 | tokens/seats (Cursor, Claude…) |
| Software/licenças por pessoa/mês | R$ 900 | ferramentas por pessoa |
| Equipamento por pessoa (CAPEX) | R$ 6.000 | amortizado |
| Vida útil equipamento (meses) | 24 | amortização do CAPEX |

## 3. Composição de time

`Papel · Salário · Alocação% · Qtd`. Ex.: AI PM 18k @50%, Builder Pleno 15k @100%, Builder Jr 11k @100%.
- **Headcount** = Σ qtd · **FTE-equivalente** = Σ(alocação × qtd).
- **Custo pessoas/mês** = `Σ(salário × alocação × qtd)` ← é exatamente o nosso rateio (comp × alocação%), só que por papel×qtd.

## 4. Custo de delivery / mês

```
custo pessoas/mês        = Σ(salário × alocação × qtd)
+ IA/tokens              = FTE × R$500
+ software/licenças      = headcount × R$900
+ equipamento amortizado = headcount × 6000/24
+ cloud/infra            = (manual)
= CUSTO DELIVERY / MÊS
```

## 5. Pricing por gross-up (custo → preço) — a sacada comercial

```
custo delivery total   = custo delivery/mês × meses
+ custo financeiro      = custo delivery/mês × 2,5%
= custos totais
divisor gross-up        = 1 − ISS − PIS − COFINS − SG&A − margem_alvo   (= 0,4635)
FATURAMENTO total       = custos totais / divisor gross-up
PREÇO MENSAL            = faturamento / meses
preço/hora implícito    = preço mensal / (FTE × 160)
markup efetivo          = preço mensal / custo delivery mês   (≈ 2,18)
```
Ideia: precifica pra que, **depois** de impostos + SG&A + margem alvo, os custos fiquem cobertos. Forward (proposta).

## 6. DRE / P&L da vigência (realizado) — a "folha de cálculo" por projeto

```
Faturamento (receita bruta)
(−) ISS, PIS, COFINS            = − faturamento × (2% + 0,65% + 3%)
= Receita líquida
(−) Custo delivery              (equipe + IA + software + equip + infra)
(−) Custo financeiro
= Margem bruta
(−) SG&A                        = − faturamento × 10%
= LAIR (lucro antes do IR)
(−) IRPJ/CSLL                   = se LAIR>0, − LAIR × 34%
= Lucro líquido
% margem líquida                = lucro líquido / faturamento   (≈ 25%)
```

## 7. O que JÁ temos × o que FALTA pro nosso app

| Conceito da planilha | No app hoje | Gap |
|---|---|---|
| Custo de pessoas (comp × alocação) | ✅ `labor_allocation` + `v_project_labor_month` | — |
| Receita por projeto | ✅ entries (Faturamento) | — |
| Despesa direta (ferramentas/extras) | ✅ entries por projeto | — |
| Margem (receita − despesa − equipe) | ✅ `margin_team` | é só "margem bruta" parcial |
| **Impostos (ISS/PIS/COFINS)** | ❌ | falta — receita líquida |
| **SG&A %** | ❌ | falta |
| **Custo financeiro %** | ❌ | falta |
| **IRPJ/CSLL** | ❌ | falta — lucro líquido |
| **Custo indireto por pessoa** (IA, software, equip amortizado) | parcial (lançável como Ferramentas, manual) | sem derivação automática por headcount/FTE |
| **Premissas org** (tabela de taxas) | ❌ | falta — config |
| **Pricing gross-up** (calculadora de preço) | ❌ | falta — lado comercial |

## 8. Proposta de evolução

1. **`finance.assumptions`** (premissas org, singleton + opcional override por projeto): iss, pis, cofins, sgaPct, financialCostPct, irpjCsllPct, targetMarginPct, hoursPerFte, aiPerFte, softwarePerHead, equipCapex, equipLifeMonths. Defaults = valores da planilha.
2. **DRE por projeto** no `FinanceProjectSheet`: trocar "margem direta/equipe" por a **cascata completa** (faturamento → impostos → receita líquida → custo delivery → financeiro → margem bruta → SG&A → LAIR → IRPJ → lucro líquido + %). Custo delivery = equipe (alocação) + despesas diretas (entries) + (opcional) overhead por pessoa derivado das premissas.
3. **Calculadora de preço (gross-up)** — opcional: dado time + margem alvo + premissas, retorna preço mensal/hora (pra proposta comercial). Espelha §5.
4. **DRE org** (home) idem por toda a operação.

## 9. Decisões em aberto (ver conversa)

- Premissas: **org-wide** só, ou **override por projeto** (ISS muda por município/cliente)?
- Overhead por pessoa (IA/software/equip): **derivar automático** das premissas, **só lançamento real**, ou **híbrido**?
- Incluir a **calculadora de preço** (forward/comercial) ou só o **realizado** (DRE)?
- Regime: as taxas são configuráveis (não hardcode de Simples/Presumido/Real) — confirmar defaults da planilha.
