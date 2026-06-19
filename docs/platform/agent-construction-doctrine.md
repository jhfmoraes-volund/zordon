# Agent Construction Doctrine — como construímos agentes que ficam espertos

**Status:** vivo · **Owner:** João · **Criado:** 2026-06-19
**Uma frase:** o que mantém a Vitoria (e Vitor/Alpha) esperta como o Claude Code não é encher de tools específicas — é **poucas tools afiadas que leem a realidade**, com a disciplina no lugar certo (escrita), não no pensamento.

> Camada de *porquê* acima dos docs mecânicos ([agent-daemon-mcp-architecture.md](agent-daemon-mcp-architecture.md) = transporte; [agent-creation-runbook.md](../agents/agent-creation-runbook.md) = como criar). Toda tool nova passa pelo checklist do §6 antes de existir.

---

## North star

> **Tão esperta quanto o Claude Code no SENSE e na orquestração; disciplinada só no ACT.**

O Claude Code entende um pedido vago e executa bem **não** porque tem 50 tools — porque tem **poucas gerais e afiadas** (Read, Edit, Bash, Grep, Glob, Task) e confia o *planejamento* ao modelo. Nossos agentes seguem o mesmo molde, com uma diferença: eles escrevem em estado compartilhado de produção (tasks, sprints, membros), então a disciplina vai na **escrita**, não no pensar.

## 1. Por que o Claude Code é esperto (os 3 mecanismos a copiar)

1. **As tools devolvem a realidade.** `Read` mostra o arquivo de verdade. **É isto que mata a alucinação** — o modelo não adivinha, ele *olha*. Quanto mais rico o SENSE, menos o agente inventa. Grounding vem de **ler a realidade**, NÃO de forçar procedimento.
2. **Erros ensinam.** Edit erra o match → erro claro com o contexto → retry. Auto-correção embutida no contrato da tool.
3. **O modelo orquestra; a tool não.** Não existe `refactor_module` — existe primitivo + inteligência compondo. A estratégia (o "como") fica no modelo.

**A contra-lição (desconfortável e verdadeira):** mais tools ≠ mais esperto. Cada tool específica torna *um caminho* confiável, mas a soma transforma o agente numa preenchedora de formulário e o faz fumblar qual tool usar. Antes de criar uma tool, pergunte se um primitivo geral + inteligência já resolve.

## 2. As 4 classes de tool (a organização)

Toda tool cai em uma classe, com contrato uniforme:

| Classe | O que faz | Por que importa |
|---|---|---|
| **SENSE** | ler verdade: `list / get / query / read` | o **firewall de alucinação** — quanto mais rico, menos o agente inventa. Invista aqui. |
| **ACT** | escrever, em staging: `propose_tasks`, propostas, mutações | onde mora a disciplina: validação, procedência, aprovação humana |
| **REMEMBER** | memória projeto/sessão (read/write) | continuidade entre turnos (o que o Claude Code não precisa, mas um agente de ritual sim) |
| **ORIENT** | o system prompt | leve: **identidade + como-agir + ponteiros**; estado vivo vem do SENSE, não pré-carregado |

## 3. Contratos transversais (as regras de "como construir uma tool")

Destilados dos achados de eval do [structured-context-sources-runbook.md](../runbooks/structured-context-sources-runbook.md) (D12/D13/D14):

- **ID que o sistema sabe = closure, nunca arg do modelo.** projectId/sessionId/ceremonyId vêm do escopo do turno (resolvidos pelo tool router), não do schema. Expor como input faz o modelo *adivinhar* o que o sistema já sabe → FK / escopo errado. (D13)
- **Resultado orçado + erro que ensina.** Cap de linhas/chars + paginação; on-error devolve o **schema/opções** pra o modelo se corrigir sozinho (não só "falhou"). É o que torna o agente resiliente.
- **Um conceito por tool; nunca nomeie por workflow.** `propose_tasks` (geral), não `propose_backfill_tasks`. O workflow (backfill, kickoff) é *como o agente usa* a tool — fica no modelo, não no nome. (D12)
- **Procedência barata e ancorada na fonte.** O lastro de uma escrita derivada de dado é a **fonte** (a ContextSource), não uma nota fabricada por item. Cerimônia por item briga com lote e vira footgun. (D14)
- **Restringe forma/segurança/budget/procedência; NUNCA estratégia.** Amarre: sem path traversal, caps, validação (ex: FP 1-13), lastro. Deixe pro agente: COMO mapear/agregar/sequenciar/estimar. (D14)
- **Toda restrição rastreia a um achado de eval, não a um "e se".** Constranger por precaução é o que deixa o agente burro. O eval (rodar o agente real e pontuar) é o que diz onde a amarra é necessária.

## 4. A nuance que reconcilia "esperta" com "não alucinar na prod"

O Claude Code edita uma cópia local que o humano revisa. **Nossos agentes escrevem em estado compartilhado** que o time depende. Então:

- **SENSE + pensar = liberdade total.** Leia o quanto quiser, planeje como quiser. Nenhuma amarra aqui — é onde a inteligência mora.
- **ACT = disciplina.** Toda escrita é **staging** (proposta), **validada**, **com procedência**, e **aprovada por humano** antes de virar verdade. A criatividade do agente entra como *proposta*, não como fato.

Isso não é limitar o agente — é tirar a amarra do lugar errado (ler/pensar) e botar no certo (escrever).

## 5. Anti-padrões (se você está fazendo isto, pare)

- ❌ Tool nomeada por workflow (`do_backfill`, `run_kickoff`). → primitivo geral + o modelo orquestra.
- ❌ Prompt gordo com todo o estado pré-carregado (squad, sprints, PRDs). → ponteiros + SENSE sob demanda. (`schema strictness > prompt strictness` em modelos 4.x — empilhar regra no prompt piora.)
- ❌ ID que o sistema sabe exposto como arg do modelo. → closure.
- ❌ Cerimônia anti-alucinação por item (nota de lastro por linha). → procedência por fonte + grounding via SENSE.
- ❌ Criar tool nova a cada fricção. → primeiro pergunte se SENSE mais rico + 1 primitivo geral resolve.
- ❌ Erro de tool que só diz "falhou". → devolva schema/opções pra auto-correção.

## 6. Checklist pra toda tool nova

Antes de criar/registrar uma tool, responda:

- [ ] É **SENSE, ACT, REMEMBER ou ORIENT**? (se não encaixa, repense)
- [ ] É **geral** (serve vários usos) ou nomeada por **workflow**? (workflow = repensar)
- [ ] Algum input é um **ID/escopo que o sistema já sabe**? (se sim → closure, tira do schema)
- [ ] O resultado é **orçado** e o erro **devolve schema/opções**?
- [ ] Se escreve: é **staging + validada + com procedência + aprovável**?
- [ ] A procedência é **por fonte** (barata) ou **por item** (cerimônia)? (por item = repensar)
- [ ] Cada restrição rastreia a um **achado de eval**, ou é "e se"? ("e se" = tira)
- [ ] Dá pra **não criar** esta tool — SENSE mais rico + um primitivo geral cobre?

## 7. Caso vivo (onde a doutrina foi destilada)

[structured-context-sources-runbook.md](../runbooks/structured-context-sources-runbook.md): insumos estruturados consultados via SQL (SENSE rico: `query_structured_source` lê a realidade → não alucina) + `propose_tasks` (ACT geral em lote, procedência por fonte). O eval real (`zordon-daemon/scripts/daemon/eval-backfill.ts`) rodou a Vitoria de verdade e cada amarra/relaxe (D12/D13/D14) saiu de um achado dela — não de precaução. É o template de "construir tool sob a doutrina + validar com eval".

## Referências

- Transporte/daemon: [agent-daemon-mcp-architecture.md](agent-daemon-mcp-architecture.md)
- Como criar um agente (mecânico): [agent-creation-runbook.md](../agents/agent-creation-runbook.md)
- Caso vivo + evals: [structured-context-sources-runbook.md](../runbooks/structured-context-sources-runbook.md)
- Loop de calibração (eval → fix → regressão): [agent-audits/README](../runbooks/agent-audits/README.md)
- Memórias: `project_vitoria_daemon_surfaces`, `feedback_agent_ui_parity`, `reference_daemon_mcp_docs`, `project_structured_context_sources`
