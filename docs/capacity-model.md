# Modelo de Capacity — Volund

> Documento para alinhamento com diretoria.
> Objetivo: definir como medir, planejar e ajustar a capacidade de entrega do time.

---

## 1. O problema

Precisamos responder 3 perguntas:

1. **Quanto um membro entrega por sprint?** (capacity individual)
2. **Quanto um projeto consome por sprint?** (demanda do projeto)
3. **Quantos projetos um membro aguenta simultaneamente?** (alocacao multi-projeto)

Hoje nao temos dados reais. Toda estimativa e hipotese. Este documento propoe um modelo para sair da hipotese e chegar em dados concretos em 3 sprints.

---

## 2. Unidade de medida: Story Points (SP)

SP mede **esforco relativo**, nao tempo. Uma task de 8 SP nao demora exatamente 2x uma de 4 SP — ela e ~2x mais complexa/trabalhosa.

### Calibracao: a task-ancora

Para SP ter significado, o time precisa de uma **task-ancora** — uma task que todos conhecem e concordam no esforco. Exemplo:

| Task-ancora | Descricao | SP |
|-------------|-----------|-----|
| CRUD simples | Listagem + criacao + edicao + delecao de uma entidade com 5-6 campos, sem logica especial. API + pagina. | **5 SP** |

A partir dessa ancora, todas as estimativas sao relativas:
- "Essa task e ~metade de um CRUD simples" → 3 SP
- "Essa task e ~3x um CRUD simples" → 13 SP
- "Essa task e trivial, menos de 1h" → 1 SP

### Escala

Usamos Fibonacci modificado: **1, 2, 3, 5, 8, 13, 21**.

Se uma task parece maior que 21 SP, ela deve ser quebrada. Tasks de 21 SP ja sao arriscadas — alta incerteza de estimativa.

### Matriz de sugestao automatica

O Volund sugere SP via `scope x complexity`, mas o time pode (e deve) ajustar:

|  | trivial | low | medium | high |
|--|---------|-----|--------|------|
| micro | 1 | 2 | 3 | 5 |
| small | 2 | 3 | 5 | 8 |
| medium | 3 | 5 | 8 | 13 |
| large | 5 | 8 | 13 | 21 |

**A matriz e ponto de partida, nao verdade absoluta.** Se o time discorda, o SP manual prevalece.

---

## 3. Capacity: o modelo de 3 fases

### Fase 1 — Baseline (Sprint 1)

Nao sabemos quanto cada pessoa entrega. Entao **nao definimos capacity — medimos velocity.**

**Regras:**
- Alocar tasks com base no feeling do PM + disponibilidade
- **Nao encher o sprint.** Alocar ~60% do que parece possivel
- No fim do sprint, contar: quantos SP foram entregues (status = done)?
- Esse numero e a **velocity real** do membro no Sprint 1

**Por que 60%?** Porque Sprint 1 e sempre o pior — setup, curva de aprendizado, processos novos, comunicacao ainda travada. Planejar 100% e garantir frustacao.

**Exemplo esperado:**

| Membro | SP alocados | SP entregues | Velocity S1 |
|--------|------------|-------------|-------------|
| Lucas | 37 | 34 | 34 |
| Camila | 44 | 38 | 38 |
| Rafael | 11 | 11 | 11 (subalocado) |

### Fase 2 — Calibracao (Sprints 2-3)

Com a velocity do Sprint 1, definimos o capacity provisorio:

```
spCapacity = velocity media * 1.15
```

O **1.15** (15% acima da velocity) e margem de crescimento — o time melhora conforme os processos amadurecem. Nao e 1.0 (sem melhoria) nem 1.3 (otimista demais).

**Exemplo:**

| Membro | Velocity S1 | Capacity provisorio (S2) |
|--------|------------|-------------------------|
| Lucas | 34 | 39 |
| Camila | 38 | 44 |
| Rafael | 11 | 13 (estava subalocado, precisa de mais tasks) |

No fim do Sprint 2, recalcula com media dos 2 sprints:

```
velocity media = (velocity_s1 + velocity_s2) / 2
spCapacity = velocity media * 1.1  // margem menor, mais dados
```

### Fase 3 — Estabilizacao (Sprint 4+)

Apos 3 sprints, a velocity media e confiavel. O capacity se estabiliza:

```
spCapacity = media movel dos ultimos 3 sprints
```

Sem margem artificial. O numero e o que o membro entrega de verdade.

**Revisao trimestral:** a cada 6 sprints (~3 meses), revisar se o capacity precisa de ajuste (membro melhorou, mudou de stack, burnout, etc).

---

## 4. Capacity multi-projeto

Um membro pode trabalhar em mais de 1 projeto simultaneamente. O modelo:

```
Capacity total do membro = spCapacity (calculado acima)
Capacity disponivel por projeto = capacity total - SP ja alocados em outros projetos
```

**Exemplo:**

Lucas tem capacity de 50 SP/sprint.
- Projeto CRM: 37 SP alocados
- Projeto Novo: pode alocar ate 13 SP

O Volund ja faz isso — o endpoint `/api/members/[id]/capacity` mostra SP por sprint **agrupado por projeto**. O PM de cada projeto ve quanto do membro esta disponivel.

### Regra operacional

**Nenhum membro deve ser alocado acima de 85% do capacity total.** Os 15% restantes sao buffer para:
- Bugs urgentes
- Code review
- Suporte a outros membros
- Overhead de comunicacao

Alocacao acima de 85% = risco. Acima de 100% = sprint vai estourar.

---

## 5. Capacity do PM

PM nao produz output discreto (tasks com deliverable claro). O trabalho e continuo: facilitar, desbloquear, comunicar, planejar.

### Opcao recomendada: capacity fixo por projeto

Em vez de medir SP, definir:

| Alocacao do PM | Significado |
|----------------|-------------|
| 100% (1 projeto) | Dedicado. Sprint pesado, time grande, cliente exigente. |
| 50% (2 projetos) | Padrao. 2 projetos simultaneos com times de 3-4 builders. |
| 33% (3 projetos) | Limite. So funciona com times maduros e processos rodando. |

**No Volund**, representamos isso como SP para manter uniformidade:
- PM com 1 projeto: spCapacity = 40, tarefas de gestao somam ~35-40 SP
- PM com 2 projetos: spCapacity = 40, cada projeto aloca ~20 SP

As tasks de gestao (dailies, demos, QA) existem para dar visibilidade ao trabalho do PM, nao para medir produtividade. **Nunca cobrar velocity de PM.**

---

## 6. O que muda no Volund

### Agora (Sprint 1 — CRM)

| Campo | Valor | Justificativa |
|-------|-------|---------------|
| `spCapacity` builders | **100** | Baseline teorico multi-projeto. Nao e meta de entrega. |
| `spCapacity` PM | **40** | Baseline. ~2 projetos possiveis. |
| Alocacao no CRM | **37-44 SP** por builder | ~40% do capacity. Sprint 1 = sprint de aprendizado. |
| Meta de entrega | **Nao existe** | Sprint 1 mede velocity, nao cobra meta. |

### Apos Sprint 1

1. Calcular velocity real por membro
2. Ajustar `spCapacity` = velocity * 1.15
3. Planejar Sprint 2 com capacity calibrado
4. Repetir

### Feature futura no Volund

- Dashboard de velocity: SP planejado vs entregue por membro por sprint
- Alerta automatico quando alocacao > 85% do capacity
- Sugestao de rebalanceamento quando um membro esta em 90% e outro em 30%

---

## 7. Como apresentar para a diretoria

### O pitch

> "Nao sabemos ainda quanto cada pessoa entrega por sprint. E isso e normal — nenhuma empresa sabe no dia 1. O que temos e um modelo para descobrir em 45 dias (3 sprints):
>
> 1. Sprint 1: medimos a velocidade real do time
> 2. Sprint 2: calibramos a capacidade com dados
> 3. Sprint 3: estabilizamos e temos numeros confiaveis
>
> A partir dai, sabemos com precisao: quantos projetos podemos rodar em paralelo, quando cada projeto sera entregue, e onde esta o gargalo."

### Os numeros que a diretoria quer

Apos 3 sprints, o Volund vai fornecer:

| Pergunta | Resposta (exemplo) |
|----------|-------------------|
| Quantos SP o time entrega por sprint? | 150 SP (3 builders × 50 SP medio) |
| Quantos projetos simultaneos aguentamos? | 2-3 (depende do tamanho) |
| Quanto custa um SP? | R$ 47 (custo total time / SP entregues) |
| Quanto custa um projeto de 200 SP? | ~R$ 9.400 em mao de obra |
| Em quanto tempo entregamos 200 SP? | ~1.3 sprints = 20 dias |
| Onde esta o gargalo? | Frontend (Camila a 90%, outros a 50%) |

### O que NAO prometer

- "Vamos entregar X SP no Sprint 1" — nao temos dados pra prometer
- "Cada builder entrega 100 SP" — isso e teto teorico, nao meta
- "O modelo funciona perfeitamente" — precisa de 3 sprints pra calibrar

---

## 8. Riscos e mitigacoes

| Risco | Impacto | Mitigacao |
|-------|---------|-----------|
| SP mal calibrados (5 SP pra task que leva 3 dias) | Velocity distorcida, planejamento errado | Task-ancora + planning poker no Sprint 2 |
| Membro subalocado (Rafael com 11 SP no Sprint 1) | Velocity baixa por falta de trabalho, nao por incapacidade | PM redistribui tasks mid-sprint se folga detectada |
| Membro sobrecarregado | Sprint estoura, qualidade cai | Alerta de 85% no Volund + buffer de 15% |
| PM sem visibilidade de multi-projeto | Dois PMs alocam 80% do mesmo builder | Dashboard de capacity cross-projeto no Volund |
| Time nao faz retrospectiva | Nao aprende, velocity estagna | PM obrigado a rodar retro a cada sprint (task de gestao) |

---

## 9. Resumo executivo

1. **SP e a unidade.** Mede esforco relativo, calibrado por task-ancora (CRUD simples = 5 SP).
2. **Capacity e descoberto, nao definido.** 3 sprints pra ter numeros reais.
3. **Baseline de 100 SP/sprint** por builder e teto multi-projeto, nao meta.
4. **Alocacao maxima: 85%** do capacity. 15% e buffer operacional.
5. **PM nao se mede por velocity.** Capacity do PM e por % de dedicacao ao projeto.
6. **Velocity real calibra tudo.** Formula: `spCapacity = media movel de 3 sprints`.
7. **Em 45 dias temos dados.** Apos 3 sprints, sabemos custo por SP, throughput real, e gargalos.
