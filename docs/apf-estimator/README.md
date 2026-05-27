# APF Estimator — Iniciativa

> Pipeline pra estimar Pontos de Função (APF/SISP 2.3) a partir de um repositório Git. Estimativa **interna**, não substitui medição oficial.

## O que é

Processo em 3 etapas que produz uma estimativa de Pontos de Função (PF) auditável pra qualquer repo Vite + React + Supabase:

```
1. Base Referencial      ← catálogo vivo de funções já medidas oficialmente
2. Catálogo do Projeto   ← Claude Code lê o repo e lista funcionalidades
3. Tabela de PF          ← cruza catálogo × referencial → PF + planilha .xlsx
```

Sem código próprio. Tudo é markdown + uma planilha .xlsx gerada ad-hoc na entrega. Se virar processo recorrente em N projetos, automatiza-se (V4).

## Resultado do piloto SEPLAG-CE

- **258,50 PF** total (43 funções IFPUG + itens não-mensuráveis).
- Dentro da faixa esperada do plano V2 §8.1 (150-300 PF).
- 47 linhas catalogadas, zero pendência aberta.
- 16 decisões fundadoras (DEC-01 a DEC-16) documentadas com justificativa IFPUG/SISP.
- Saída: [tabela-pf/seplag-ce.md](./tabela-pf/seplag-ce.md) + [tabela-pf/seplag-ce.xlsx](./tabela-pf/seplag-ce.xlsx).

## Estratégia ativa: V3 v0 (zero código)

Plano canônico: **[apf-estimator-plan-v3.md](../features/estimation/apf-estimator-plan-v3.md)**.

V2 ([apf-estimator-plan-v2.md](../archive/apf-estimator-plan-v2.md)) continua como referência de regras IFPUG (anti-double-count, faixa esperada SEPLAG-CE, fator disciplina). V1 ([apf-estimator-plan.md](../archive/apf-estimator-plan.md)) é histórico.

## Decisões fundadoras V3

| # | Decisão |
|---|---|
| D1 | Granularidade = **ação do usuário** (~30-60 itens, ex.: "listar OSs migráveis") |
| D2 | Atribuição de PF = **lookup na base referencial** (match direto) + **matriz IFPUG** quando não há análogo |
| D3 | Catálogo = **Claude Code escreve, João revisa** |
| D4 | Repo-alvo do piloto = **SEPLAG-CE** (`github.com/volund-ia/SEPLAG-CE`, privado) |

## Documentos da iniciativa

- [README.md](./README.md) — este arquivo.
- [viabilidade.md](./viabilidade.md) — premissa atual + bloqueadores.
- [piloto/plano-piloto.md](./piloto/plano-piloto.md) — repo-alvo, gates, critérios de sucesso.
- [referencial/](./referencial/) — `base-referencial.md` (catálogo vivo de funções rotuladas — âncora da Fase B).
- [catalogo-funcionalidades/](./catalogo-funcionalidades/) — saída da Fase A.
- [tabela-pf/](./tabela-pf/) — saída da Fase B.
- [decisoes/](./decisoes/) — ADRs leves pras Q1..Q8 do plano V2 (algumas redefinidas no V3).

## Estrutura desta pasta

```
docs/apf-estimator/
├── README.md
├── viabilidade.md
├── piloto/
│   ├── plano-piloto.md
│   └── execucoes/
├── referencial/                # base-referencial.md — catálogo vivo de funções rotuladas
│   └── README.md
├── catalogo-funcionalidades/   # Fase A — markdown legível por ação do usuário
│   └── README.md
├── tabela-pf/                  # Fase B — tabela final + planilha .xlsx
│   └── README.md
└── decisoes/
    └── README.md
```

## Status (2026-05-05)

- ✅ Plano V3 v0 escrito (sem código).
- ✅ Repo SEPLAG-CE acessível e clonado em `/tmp/seplag-ce` (`gh repo clone volund-ia/SEPLAG-CE`).
- ✅ `base-referencial.md` v0 gerado (215 funções, 1.105 PF IFPUG bruto).
- ✅ Catálogo SEPLAG-CE v0 gerado (38 ações + 12 ALIs + 9 backend-only + não-mensuráveis).
- ✅ Tabela PF .md + .xlsx gerada (**258,50 PF**, dentro da faixa V2 §8.1).
- ⏳ Revisão final João: pendente (Marco 3).

## Próximo passo concreto

**Marco 3 (revisão):** João lê [tabela-pf/seplag-ce.md](./tabela-pf/seplag-ce.md) — em particular as 16 decisões fundadoras (DEC-01 a DEC-16) — e contesta linhas que não fazem sentido. Iteração ajusta linhas específicas até fechar.

Depois disso: replicar o processo num segundo projeto pra calibrar a base referencial e validar reprodutibilidade.
