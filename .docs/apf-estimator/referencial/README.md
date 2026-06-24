# Base Referencial

Catálogo vivo de funções IFPUG **rotuladas** com PF — usado como âncora de comparação quando atribuímos pontos de função a funcionalidades novas. Vive em `base-referencial.md` neste diretório.

## Por que existe

Atribuir PF "do zero" usando só a matriz IFPUG é tecnicamente correto mas pouco prático — duas pessoas estimando a mesma função podem chegar em DET/AR diferentes e cair em complexidades diferentes. A base referencial reduz esse arbítrio: na hora de classificar uma funcionalidade nova, primeiro procura-se uma **análoga já medida** e copia o PF dela. Só recorre à matriz IFPUG quando não há análogo claro.

É o que faz o V3 ser auditável — toda linha da tabela final cita ou um análogo da base, ou a regra IFPUG aplicada.

## Origem inicial

A v0 da `base-referencial.md` é semeada com 215 funções de 3 medições oficiais históricas — Riple (105 PF), PGF (481 PF), Escalas Médicas (20 PF). Sistemas administrativos públicos do mesmo nicho do SEPLAG-CE.

## Documento vivo, não dump fechado

A base **cresce e é refinada com o tempo**:
- Toda nova medição que rodarmos pode adicionar análogos novos.
- Quando dois análogos divergem (mesmo verbo+entidade, PFs diferentes), abrimos discussão e refinamos a entrada.
- Categorias podem ser adicionadas (ex.: hoje só tem Prodesp/admin; amanhã pode ter SaaS B2B, e-commerce).
- Itens errados podem ser ajustados — se uma medição posterior mostrar que `Listar X` foi medida diferente em outro projeto, registramos as duas versões e a justificativa.

## Formato

Markdown legível, organizado por projeto e área funcional:

```markdown
## Riple — Medição 6 (2025-11-17, total 105 PF, fator disciplina 0.95)

### Migração HH→PF
- `Listar_OSs_Migraveis_HHPF` — CE Alta — DET 12, AR 5 — **6 PF** — lista OSs migráveis.
- `Detalhe_OS_Para_Migracao_HHPF` — CE Alta — DET 14, AR 6 — **6 PF** — detalhe da OS.
- `Preview_DryRun_Migracao_Item_HHPF` — SE Alta — DET 12, AR 5 — **7 PF** — preview de migração.
- `Confirmar_Migracao_Item_HHPF_PF` — EE Alta — DET 10, AR 5 — **6 PF** — efetiva conversão.

### Apontamentos
- `Calendario_Apontamentos_Fornecedor` — CE Alta — DET 14, AR 6 — **6 PF** — visão calendário.
- `Exportar_Calendario_Excel_Forn` — SE Alta — DET 12, AR 5 — **7 PF** — export XLSX.
...
```

Pra cada item: nome, tipo IFPUG, complexidade, DET, AR/TR, PF, descrição curta.

## Geração inicial

A v0 é montada **manualmente/conversacionalmente** numa sessão de Claude — `python -c openpyxl` lê as 3 .xlsx, agrupa por área, escreve markdown. Sem script versionado.

## Como Claude consome

Pra cada funcionalidade do catálogo do projeto-alvo, Claude:

1. Lê `base-referencial.md`.
2. Procura análogos por verbo + tipo IFPUG + entidade (texto direto, não busca vetorial).
3. Cita o análogo na coluna "Análogo" da tabela final ou marca `needs_review`.

Sem embedding, sem busca vetorial, sem código. É leitura mesmo.

## Status

- [x] `base-referencial.md` v0 — gerado 2026-05-05. **215 funções rotuladas** de 3 medições oficiais históricas, 1.105 PF IFPUG bruto. Distribuição: 40 ALI, 8 AIE, 118 EE, 20 SE, 29 CE.
