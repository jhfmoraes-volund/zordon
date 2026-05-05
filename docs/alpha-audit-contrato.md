# Alpha — Auditoria de vocabulário "contrato"

**Data:** 2026-05-05
**Trigger:** João apontou que UI usa "contrato" pra `ProjectMember.fpAllocation` (tela `/members/[id]`), mas Alpha (e eu) usei "contrato" com outro sentido (escopo total vendido). Pergunta: Alpha entende que "contrato" = `fpAllocation`?
**Modelo:** Haiku 4.5

---

## C1 — "qual o contrato do João nesse projeto?"

**Thread:** `c7a5f67d-33c6-46db-bf9d-2c148605c149`

- **Resultado:** Alpha **acertou direto.** Chamou `get_allocated_project_members`, retornou tabela com `Capacidade total: 500 FP`, `Alocação no projeto: 300 FP`, **chamou isso de "Contrato do João Moraes no projeto Zordon"**, e calculou ocupação (60%).
- **Tools:** `get_allocated_project_members` (1)
- **Veredicto:** ✅ **funcionou apesar do prompt não ensinar**. Modelo associou "contrato" → `fpAllocation` por contexto (vocabulário próximo na cabeça do LLM). Mas é **sorte**, não rigor.

---

## C2 — "vamos conseguir entregar Zordon dentro do contrato?"

**Thread:** `f92e6ee2-ef10-48f0-a57b-8f95918a1729`

- **Resultado:** Resposta **longa, ambígua e errada no fim**. Alpha:
  - Chamou 5 tools (sprint, alerts, commitments, backlog, sprints)
  - Detectou que tem 30 tasks no backlog parado, sprints futuras vazias, capacity ociosa
  - Mas **NO FIM** perguntou: "Qual é a data do contrato? Qual é o escopo mínimo viável (MVP)? João Moraes é o único alocado permanentemente?"
  - Ou seja, **interpretou "contrato" como escopo total + deadline** (modelo errado, igual ao meu erro inicial).
- **Tools:** 5
- **Veredicto:** ❌ **mesma confusão que eu tive.** Tratou "contrato" como entidade externa que ele não tem dados. **Não usou** o modelo certo (alocação por sprint × sprints até deadline).

---

## C3 — "aumenta o contrato do João pra 400"

**Thread:** `62908a08-9824-4e0b-bf9a-b576a4154664`

- **Resultado:** ✅ Alpha mapeou corretamente "contrato" → `fpAllocation`. Disse:
  > "Quer aumentar a alocação do João para 400 FP. [...] É aumento no padrão do projeto (ProjectMember.fpAllocation) ou só neste sprint? (SprintMember override). Depois executo via `set_project_allocation` ou `set_sprint_allocation`."
- **Tools:** 0 (parou pra perguntar — ✅)
- **Veredicto:** ✅ **mapeamento correto + Regra 9b funcionando.**

---

## Diagnóstico

Alpha tem **inconsistência semântica** com a palavra "contrato":

| Contexto | Mapeamento de Alpha | Correto? |
|---|---|---|
| C1 — "qual o contrato do João" | `fpAllocation` | ✅ |
| C3 — "aumenta o contrato do João" | `fpAllocation` (set_project_allocation) | ✅ |
| C2 — "entregar dentro do contrato" | escopo total + deadline + MVP | ❌ |

**Padrão:** quando "contrato" vem **junto com nome de pessoa**, Alpha mapeia certo (`fpAllocation`). Quando vem **junto com nome de projeto** ("dentro do contrato do Zordon"), Alpha **alucina o modelo de escopo total** que não existe no schema.

**Causa raiz:** o prompt usa só "alocação" e "FP/sprint dedicado". Não diz **"o produto e a UI chamam isso de contrato"**. LLM tem dois priors competindo:
1. "Contrato" no contexto consultoria/squad = capacidade contratada (✅ certo aqui)
2. "Contrato" no contexto produto/escopo = total vendido (❌ não se aplica)

Sem ensino explícito, modelo escolhe um dos dois pelo contexto da frase — acerta 2/3, erra 1/3.

---

## Implicação pra calibração Fase 1

A calibração rodou 24 invocações, **0 falaram em "contrato"**. Cenários eram todos sobre módulo/persona/AC/refinement — nenhum sobre alocação. **Esse gap não foi medido.**

A Fase 2 (sprint planner) vai bater de cabeça nesse problema: PM vai falar "respeitando o contrato do João" e Alpha pode oscilar entre interpretar certo ou perguntar coisa que não existe.

---

## Próximo passo recomendado: adendo no prompt (5min)

Adicionar uma frase no prompt do Alpha (seção "Hierarquia" ou nova seção "Vocabulário operacional"):

```
## Vocabulário: "contrato" = ProjectMember.fpAllocation

A UI do produto chama `ProjectMember.fpAllocation` de **"contrato"** —
"o contrato do João no Zordon" = quanto FP/sprint João dedica a Zordon (300).

NÃO existe entidade "contrato do projeto" como escopo total vendido.
Volund vende capacidade humana por sprint, não pacote fechado de FP.

Quando o usuário diz:
- "o contrato do {membro}" → fpAllocation desse membro neste projeto
- "aumenta/diminui o contrato" → set_project_allocation (todo o projeto)
                               ou set_sprint_allocation (sprint específico)
- "dentro do contrato" → respeitando a soma de fpAllocation por sprint
                         (= sprint_capacity_overview.capacity)
- "vai estourar o contrato?" → o backlog cabe nas próximas N sprints
                                considerando capacity por sprint?

NUNCA pergunte "qual a data do contrato?" ou "qual o escopo total contratado?" —
não existem como dados.
```

Custo: 5min de prompt + 3 runs novos pra calibrar.

---

## Decisão: vale rodar agora ou empurrar pra Fase 2?

**Argumentos pra calibrar agora (antes de ship):**
- C2 era um caso real ("vamos entregar dentro do contrato?" é exatamente o que Head Ops pergunta)
- O fix é minúsculo (1 parágrafo)
- Sem isso, Alpha vai pedir dados inexistentes e Head Ops vai achar que precisa cadastrar contrato externo

**Argumentos pra deixar pra Fase 2:**
- Calibração principal já passou
- Vocabulário "contrato" é mais relevante em planning (Fase 2)

**Recomendação:** **fazer agora**, antes do ship. É 1 parágrafo, calibrar 3 runs nos C1/C2/C3, anotar resultado, commitar tudo junto.
