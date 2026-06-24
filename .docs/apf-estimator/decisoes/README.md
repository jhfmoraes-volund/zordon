# Decisões — APF Estimator

ADRs leves pras 8 decisões abertas no plano V2 §9. Uma por arquivo, formato:

```markdown
# Q<N> — <título>

**Status:** aberta | fechada
**Data:** YYYY-MM-DD
**Decisor:** <nome>

## Pergunta
<copiar do plano §9>

## Default proposto no plano
<copiar do plano §9>

## Decisão
<o que foi decidido>

## Justificativa
<por quê>

## Implicações
<o que muda no código/processo>
```

## Status atual

| # | Pergunta | Status | Bloqueia piloto? |
|---|---|---|---|
| 1 | `mapping.yaml` em produção: repo ou DB editável? | aberta | Sim |
| 2 | Range default da estimativa | aberta | Sim |
| 3 | Deps externas (auth/Stripe) como AIE? | aberta (default OK) | Não |
| 4 | shadcn/ui copy-pasted conta? | aberta (default OK) | Não |
| 5 | Testes (`*.test.ts`) entram em PFT? | aberta (default OK) | Não |
| 6 | Migrações de dados (seeds) → DCDI? | aberta (default OK) | Não |
| 7 | Como rotular few-shot da Identity? | **redefinida** — usar base referencial (`referencial/`) como few-shot dinâmico (top-K análogos por função) | Sim |
| 8 | Detecção de rota: file-system ou router? | aberta (default OK) | Sim — confirmar default |

Decisões 3-6 podem rodar com o default proposto no plano sem bloquear o piloto. 1, 2, 7, 8 precisam ser fechadas antes do código.
