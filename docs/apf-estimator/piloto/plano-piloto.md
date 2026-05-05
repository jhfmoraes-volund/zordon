# Plano do Piloto (V3, 2026-05-04)

## Estratégia

Pipeline V3 em duas fases — catálogo de funcionalidades (Claude escreve, João revisa) → tabela PF (lookup base referencial + LLM tie-breaker). Plano canônico: [../../apf-estimator-plan-v3.md](../../apf-estimator-plan-v3.md).

## Premissa

Sem acesso ao código dos repos cujas medições oficiais (Riple/PGF/Escalas Médicas) compõem a base referencial. Essas medições servem como catálogo de "quanto custa funcionalidade X", não como gabarito de validação. Ver [../viabilidade.md](../viabilidade.md).

## Objetivo

Validar que o estimador APF V2:

1. Roda end-to-end num repo real Vite+React+Supabase.
2. Produz relatório auditável (cada função tem rastreio + função-análoga da biblioteca).
3. Resultado é plausível na revisão humana e coerente com a base referencial.

**Não é objetivo deste piloto:** atingir erro <30% vs medição oficial (não há medição oficial do repo-alvo).

## Repo-alvo

**SEPLAG-CE** (`github.com/volund-ia/SEPLAG-CE`, privado). Justificativa:
- Stack idêntica aos sistemas da base referencial: Vite + React + TS + Supabase (TypeScript dominante + PLpgSQL nas migrations).
- Tamanho compatível com o sanity-check do plano V2 §8.1: **41 migrations** (bate exato com o esperado), **3 edge functions**, **~19 arquivos de rota** em `src/{app,routes,pages}`, **~96 .tsx + 22 .ts**.
- Acesso já confirmado via `gh` (sem fricção de clone).
- Plano V2 já cita SEPLAG-CE como referência de gut-feeling (faixa esperada **150-300 PF**) — útil pra avaliar plausibilidade do total.

Limitação importante: **não há medição oficial do SEPLAG-CE**. As 3 medições históricas (Riple/PGF/EM) servem apenas como base referencial, não como gabarito do SEPLAG-CE.

## Critérios de prontidão (gates)

Não rode piloto sem fechar todos:

- [ ] Base referencial convertida pra markdown em [../referencial/](../referencial/).
- [ ] Decisões Q1 (mapping repo vs DB), Q2 (range default), Q7-revisada (few-shot dinâmico via biblioteca), Q8 (detecção de rota) fechadas em [../decisoes/](../decisoes/).
- [ ] `scripts/apf/` implementado conforme plano V2 §5 (Fase 1 do roadmap).
- [ ] `mapping.yaml` versionado.
- [ ] Anthropic API key configurada localmente.

## Critérios de sucesso (revisados — sem ground-truth oficial)

### S1 — Coerência interna ✅/❌
- [ ] Re-execução com mesmo commit + mesmo mapping = mesmo resultado (cache hit).
- [ ] Editar `mapping.yaml` recalcula sem rebuild.
- [ ] Cada item do relatório tem: arquivo, linha, queries detectadas, tabelas, identidade `(verb, entity, variant)`.
- [ ] Header do relatório: `estimator_version`, `prompt_version`, `mapping_hash`, `model_id`, `commit_sha`.

### S2 — Plausibilidade vs base referencial ✅/❌
- [ ] Pra cada função classificada, relatório aponta a função-mais-parecida da biblioteca com PF de referência.
- [ ] PF estimado dentro de ±1 do PF do análogo em ≥80% dos casos com análogo claro.
- [ ] Funções sem análogo claro marcadas `needs_review`.

### S3 — Revisão humana ✅/❌
- [ ] João lê o relatório do Volund e julga "ordem de grandeza faz sentido".
- [ ] Falsos positivos óbvios listados (utilities contadas, dupla contagem) — ideal: ≤10% das funções.
- [ ] Se métrico humano (Levi ou outro) tiver disponibilidade, segunda revisão.

### Insucesso (motivo pra parar)
- Piloto não roda end-to-end (bug estrutural no inventory/identity).
- >30% das funções estimadas são falsos positivos óbvios.
- Total foge da faixa de plausibilidade do plano V2 §8.1 (**150-300 PF** pro SEPLAG-CE) por mais de 2x.

## Protocolo de execução

Pra cada execução, criar arquivo em `execucoes/<projeto>-<data>.md`:

```markdown
# Execução piloto — <projeto> <YYYY-MM-DD>

## Setup
- Repo: <git url>
- Commit: <sha>
- Estimator version: <vN>
- Prompt version: <vN>
- Mapping hash: <hash>
- Model: claude-sonnet-4-6

## Resultado
- Total PF IFPUG: ___
- Total PF Ajustado: ___
- Total Itens (não mensuráveis): ___ (PAG/DCDI/DCFI/HARDC/DATDI)
- Fator disciplina detectado: ___ (sinais: ...)
- Tempo execução: ___s
- Custo LLM: $___

## Distribuição por tipo
| Tipo | Qtd | PF total |
|---|---|---|
| ALI |  |  |
| AIE |  |  |
| EE  |  |  |
| SE  |  |  |
| CE  |  |  |

## Plausibilidade vs biblioteca (S2)
- Funções com análogo claro: ___ / ___
- PF dentro de ±1 do análogo: ___%
- Top-3 funções com maior divergência vs análogo: ...

## needs_review
- ...

## Revisão humana (S3)
- Gut-feeling pré-execução: ___ PF
- Resultado faz sentido? ___
- Falsos positivos identificados na leitura: ___
- Funções óbvias que faltaram: ___

## Hipóteses + ajustes propostos pra mapping.yaml
- ...
```

## Fora de escopo do piloto

- Integração com `/admin/apf` no Volund (Fase 2 do plano V2).
- Geração XLSX no formato Prodesp (Fase 1.5 marca como opcional).
- Manutenção `A`/`E` via diff de inventário entre 2 commits — Volund não precisa exercitar isso na primeira rodada (estima `HEAD` inteiro como `I`).
- Comparação com medição oficial — não existe pro Volund.
