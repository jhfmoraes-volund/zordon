# Tabela de PF (Fase B do V3)

Resultado final do pipeline V3: tabela com PF por funcionalidade + total. **Sem código** — Claude lê o catálogo revisado, consulta a base referencial (.md), aplica matriz IFPUG quando precisa, e escreve a tabela.

Plano canônico: [../../apf-estimator-plan-v3.md](../../apf-estimator-plan-v3.md) §"Fase B".

## Saídas

### 1. `<projeto>.md` — auditoria

Tabela completa com colunas: `#`, `Funcionalidade`, `Descrição`, `Tipo`, `DET`, `AR/TR`, `Complexidade`, `PF`, `Análogo`, `PF Análogo`, `Δ`, `Observação`. Cada linha justifica de onde o PF veio (análogo direto OU regra da matriz IFPUG).

### 2. `<projeto>.xlsx` — entrega

Planilha gerada ad-hoc com `python -c openpyxl` quando a .md está fechada. Colunas reduzidas pra entrega:

| # | Funcionalidade | Descrição | Tipo IFPUG | PF | Análogo | Observação |
|---|----------------|-----------|------------|-----|---------------|------------|

Última linha = SUM da coluna PF.

## Como Claude monta cada linha (sem código)

Pra cada funcionalidade do catálogo:

1. **Procura análogo** em `referencial/base-referencial.md` por verbo + tipo + entidade.
2. **Se há análogo direto** (mesmo verbo, mesmo tipo, complexidade comparável) → copia PF do análogo. `Observação = "match direto"`.
3. **Se não há análogo claro** → estima DET (campos do payload) e AR/TR (tabelas/arquivos referenciados) a partir dos sinais técnicos no catálogo, aplica [matriz IFPUG](../../function-points-reference.md). `Observação = "matriz IFPUG → tipo complexidade"`.
4. **Se ambíguo** → registra hipótese conservadora e marca `needs_review`.

## Status

- [x] `seplag-ce.md` — gerado 2026-05-05. **258,50 PF total** (241 IFPUG + 17,50 não-mensuráveis). 16 decisões fundadoras justificadas (DEC-01 a DEC-16). Zero `needs_review`.
- [x] `seplag-ce.xlsx` — gerado 2026-05-05. 2 abas: "Pontos de Função" (47 linhas + total) e "Resumo" (subtotais por categoria + fator disciplina).
