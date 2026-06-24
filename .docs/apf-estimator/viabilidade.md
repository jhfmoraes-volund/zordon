# Avaliação de prontidão pro piloto — sincero (revisado 2026-05-04)

> Você perguntou: "temos tudo pra fazer um piloto?". Depois esclareceu: **não temos acesso ao código dos repos das medições oficiais históricas**. Essas medições servem como base referencial ("quanto custa funcionalidade X em PF"), não como gabarito de validação de um repo específico.
>
> Resposta revisada: **sim, temos o suficiente pra um piloto útil — desde que se redefina o que "piloto" significa.** Não dá pra validar erro vs medição oficial; dá pra validar coerência interna e plausibilidade contra a base referencial.

## Premissa que mudou

| Antes | Agora |
|---|---|
| Planilhas = gabarito (rodar estimador num repo X e comparar com a medição da Levi) | Planilhas = biblioteca de **referência funcional** ("uma função CE de 'listar OS' em sistema Prodesp foi medida em ~6 PF") |
| Validação = erro % vs número oficial | Validação = (a) coerência interna, (b) plausibilidade vs biblioteca, (c) revisão humana |
| Repo-alvo = mesmo das planilhas | Repo-alvo = qualquer repo Vite+React+Supabase em que faça sentido estimar (ex.: o próprio **Volund**, ou um cliente novo) |

## O que isso destrava

- **Não precisamos mais identificar commit SHA da medição** — irrelevante, repo é outro.
- **Não precisamos linkar "função-da-planilha → trecho-de-código"** — o linking é entre a função estimada *no novo repo* e exemplos *similares* na biblioteca.
- **Few-shot da Identity** muda: em vez de "dada essa função do SEPLAG-CE, qual a `variant`?", vira "dada essa função do novo repo, ela parece com qual função-tipo da biblioteca?".

## O que isso impede

- **Não dá pra dizer "erro vs oficial é X%".** O critério de sucesso do plano V2 §8 (erro <30% vs medição oficial) **não é mais aplicável neste piloto**. Precisa critério novo.
- **Sem ground-truth absoluto.** Se o estimador disser "Volund = 380 PF", não temos número oficial pra comparar. Temos: gut-feeling, plausibilidade vs biblioteca, e eventualmente uma medição oficial futura.

## O que as medições históricas viram nesse novo modelo

Uma **biblioteca rotulada** de funções já medidas, indexada pelo verbo+entidade+contexto:

```
listar OSs migráveis      → CE / Alta / 6 PF / 12 DET / 5 AR
detalhar OS pra migração  → CE / Alta / 6 PF / 14 DET / 6 AR
preview dry-run migração  → SE / Alta / 7 PF / 12 DET / 5 AR
confirmar migração item   → EE / Alta / 6 PF / 10 DET / 5 AR
calendário apontamentos   → CE / Alta / 6 PF / 14 DET / 6 AR
exportar calendário XLSX  → SE / Alta / 7 PF / 12 DET / 5 AR
dashboard medição/gerência → CE / Alta / 6 PF / 14 DET / 5 AR
... (Riple ~30 funções, PGF ~200, EM ~15)
```

Total: ~245 funções rotuladas em 3 sistemas Prodesp do mesmo nicho. Isso é **muito few-shot pra LLM** — Sonnet 4.6 com `temperature: 0` consegue classificar plausivelmente "essa função nova parece a `Exportar_Calendario_Excel_Forn` da Riple → SE Alta".

## O que ainda falta

### Bloqueadores duros

1. **Zero código.** Plano V2 §6 estima ~2 semanas pra Fase 1. Nada implementado.
2. **Repo-alvo do piloto.** **SEPLAG-CE** (`github.com/volund-ia/SEPLAG-CE`, privado, acesso confirmado). Stack idêntica (Vite+React+TS+Supabase), 41 migrations, 3 edge functions, ~19 rotas, 96 .tsx + 22 .ts. Bate exato com o sanity-check do plano V2 §8.1 (faixa esperada 150-300 PF).
3. **Base referencial em formato consumível.** Pro piloto, as planilhas oficiais precisam virar markdown estruturado em `docs/apf-estimator/referencial/` (uma entrada por função, com verbo/entidade/tipo/PF/DET/AR/observação).
4. **Critério de sucesso novo** — não pode ser "erro <30% vs oficial". Proposta na seção abaixo.

### Soft (dá pra rodar sem, mas o piloto fica menos honesto)

5. Decisões Q1, Q2, Q8 do plano V2 §9 (Q7 sai redefinida, ver abaixo).
6. Anthropic API key configurada pro pipeline.

## Critério de sucesso revisado

Sem ground-truth oficial, sucesso vira composto:

### S1 — Coerência interna (objetivo)
- Re-rodar estimador 2x no mesmo commit produz o **mesmo resultado** (cache hit).
- Mexer só em `mapping.yaml` recalcula sem precisar mexer em código.
- Cada função estimada tem rastreio: `(arquivo, linha, queries, tabelas)`.
- Header do relatório registra `estimator_version`, `prompt_version`, `mapping_hash`, `model_id`, `commit_sha`.

### S2 — Plausibilidade vs biblioteca (semi-subjetivo)
- Pra cada função classificada como CE/SE/EE/AIE/ALI no Volund, o estimador aponta **a função-mais-parecida da base referencial** com PF de referência.
- Spread esperado: PF estimado ±1 do PF da função análoga da biblioteca em ≥80% dos casos.
- Funções sem análogo claro na biblioteca → marcadas `needs_review`.

### S3 — Revisão humana (subjetivo)
- João + (idealmente um métrico) leem o relatório e julgam: "isso parece o tamanho do Volund?".
- Falsos positivos óbvios (utilities contadas como função, mesma função contada 2x) são listados.

**Não é tão sólido quanto erro <30% vs oficial.** É o que dá pra fazer sem o gabarito do mesmo repo. Aceito explicitamente como o piloto v0.

## Recomendação revisada

**Semana 0 (2-3 dias, sem código):**
1. Repo-alvo confirmado: **SEPLAG-CE** (`github.com/volund-ia/SEPLAG-CE`). Clonar localmente (ex.: `/tmp/seplag-ce`).
2. Converter as 3 planilhas oficiais históricas → markdown estruturado em [referencial/](./referencial/) — provavelmente automatizável (script de parse das 3 .xlsx).
3. Fechar Q1, Q2, Q8.
4. Q7 reformulada: "como rotular few-shot da Identity?" → "base referencial JSON é o few-shot; LLM recebe top-K funções similares como contexto na classificação".

**Semana 1-2 (código):** Fase 1 do plano V2 — com a mudança de §3 do plano sendo: classificador recebe top-K análogos da biblioteca como few-shot dinâmico (em vez de few-shot fixo).

**Semana 3 (piloto):** Rodar no SEPLAG-CE, gerar relatório, fazer revisão humana. Se passar S1+S2+S3 e o total cair entre 150-300 PF → declarar viabilidade. Se uma medição oficial do SEPLAG-CE acontecer depois, dá pra calibrar erro %.

## Veredito revisado

**Sim, temos o suficiente pra um piloto.** Mas o piloto agora é "estimador roda num repo real e produz relatório auditável e plausível", não "estimador erra <30% vs oficial". Se isso é suficiente pro seu objetivo (precificação interna, dimensionamento de novos contratos), está bom. Se você precisa de "auditoria oficial-grade", aí precisa de uma planilha oficial do mesmo repo — o que volta ao bloqueio anterior.
