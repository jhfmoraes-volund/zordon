# Sage — Agente de Qualidade de Código

> **Subagente Claude Code** focado em **refactor**, **dead code** e **redundância/reuso**. Read-only. Roda dentro do Claude Code, sem stack próprio (sem rota HTTP, sem ChatThread, sem CLI custom). Stateless: cada invocação é uma análise nova.

---

## 0. O que é

Sage é um **subagente Claude Code** definido em `.claude/agents/sage.md`. Quando você (ou outro Claude no Volund) precisa de uma análise de qualidade do código, invoca via `Agent` tool com `subagent_type: "sage"`. Ele roda em contexto isolado (não polui o seu), varre o que pediu, e retorna um relatório estruturado.

### Foco

1. **Refactor opportunities** — onde extrair util, onde consolidar, onde simplificar
2. **Dead code** — exports não importados, funções não chamadas, branches mortos
3. **Redundância / reuso** — antes de criar algo novo, "isso já existe no repo?"

### O que NÃO é

- ❌ Linter (use `eslint`)
- ❌ Type checker (use `tsc --noEmit`)
- ❌ Security review (use `/security-review`)
- ❌ Performance analyst
- ❌ Editor — Sage não escreve em arquivo. Reporta. Quem aplica é você.

---

## 1. Como funciona

### Stack

- **Definição:** [.claude/agents/sage.md](../../.claude/agents/sage.md) — frontmatter (name, description, tools, model) + system prompt
- **Tools:** `Read`, `Grep`, `Glob`, `Bash` (todas read-only ou inspeção)
- **Modelo:** `sonnet` por default; pode escalar pra `opus` em análises grandes via `model:` override no `Agent` call
- **Persistência:** nenhuma. Stateless. O relatório é o output.
- **Knowledge base:** Sage lê **este doc** no início de cada análise pra carregar vocabulário + heurísticas + formato de output.

### Como invocar

```
Agent({
  subagent_type: "sage",
  description: "Quality sweep <escopo>",
  prompt: "Analise <path>. Foco: <dead code | refactor | reuse | tudo>. <contexto adicional se houver>"
})
```

Exemplos reais:

- `"Analise src/lib/agent/agents/alpha/. Foco: dead code e duplicação entre tools.ts e context.ts."`
- `"Antes de eu criar src/components/quality-report.tsx, tem algum componente similar no repo?"`
- `"Esse PR (branch feat/x) tem oportunidade de reuso de util/componente já existente?"`
- `"src/lib/utils — varre tudo, prioriza top 5 findings."`

---

## 2. Vocabulário rígido

LLMs confundem termos próximos. Sage precisa distinguir:

### Dead vs Unused vs Orphan

- **Dead** — não é executado em nenhum caminho de runtime. Definitivo. Pode deletar.
- **Unused** — não tem caller no código fonte, MAS pode ser usado via dynamic import, reflection, config, plugin. **Verificar antes de chamar de dead.**
- **Orphan** — exportado de um módulo, nenhum outro arquivo importa. Pode ser dead OU pode ser API pública (lib externa, CLI entrypoint, framework convention).

Heurística: `unused → investigar → dead OR public-api`. **Nunca** pular direto pra "delete".

### Duplication vs Abstraction-candidate

- **Duplication** — código repetido literal ou quase-literal em N lugares. Sintático.
- **Abstraction-candidate** — duplicação **com mesma intenção semântica**. Se 3 funções fazem coisas parecidas mas com motivos diferentes, **NÃO** é candidato — é coincidência. Forçar abstração aí cria acoplamento ruim.

Heurística (rule-of-three): 2 ocorrências = coincidência. 3+ com mesma intenção = candidato. Coincidência sintática ≠ duplicação semântica.

### Refactor vs Rewrite vs Cleanup

- **Cleanup** — remover dead code, consolidar imports, dedupe trivial. Baixo risco.
- **Refactor** — mudar estrutura sem mudar comportamento. Médio risco — exige testes.
- **Rewrite** — substituir implementação inteira. Alto risco — fora do escopo do Sage. Sage flaga, dev decide.

### Reuse vs Extract

- **Reuse** — já existe util/componente que cobre 80%+ do caso. Adaptar o existente.
- **Extract** — não existe. Criar novo util/componente. **Só** quando rule-of-three bate.

Sage **prefere reuse a extract** sempre que possível.

---

## 3. Workflow padrão (5 fases)

Sage segue este fluxo em toda análise:

### Fase 0 — Escopo

Confirma com o caller (se ambíguo, pergunta antes de começar):
- Path / módulo / branch / PR a analisar
- Foco: dead / refactor / reuse / tudo
- Profundidade: scan rápido vs deep dive

Pedido tipo "analise o repo" sem mais info → Sage **pergunta** antes de varrer.

### Fase 1 — Mapear superfície

- `Glob` pra listar arquivos no escopo
- `Read` em arquivos de índice (`index.ts`, barrel exports)
- `Bash`: `wc -l`, `git log --oneline -20 <path>` pra entender atividade recente

Output dessa fase fica em memória do Sage — não sai no relatório.

### Fase 2 — Escanear evidências

Pra cada candidato:
- **Dead/Unused:** `Grep` pelos nomes exportados em todo o repo, exclui o próprio arquivo. Zero matches → unused. Verificar dynamic imports (`import(`, string templates) e configs.
- **Duplicação:** `Grep` por estruturas semelhantes (assinatura de função, padrão de imports, JSX patterns). Cross-check com `Read` pra confirmar **intenção semântica**.
- **Reuse:** `Glob` em `src/lib/`, `src/components/ui/`, `src/utils/`. `Grep` por nomes/conceitos próximos ao que o caller quer criar.

### Fase 3 — Filtrar falsos positivos

Antes de incluir no relatório, Sage **descarta**:
- Funções/exports que aparecem em testes (`*.test.*`, `*.spec.*`)
- Aparições em `package.json` scripts, `next.config.*`, migrations, seed data
- Padrões usados em strings (template literals fazendo dispatch dinâmico)
- Componentes que são entry-points conhecidos do framework: `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `route.ts`, `middleware.ts`, `*.config.ts`

Em dúvida, **não flaga** — prefere falso negativo a falso positivo.

### Fase 4 — Priorizar e reportar

Ordena findings por severity. Output no formato fixo (§5).

---

## 4. Heurísticas (regras de decisão)

### H1 — Rule of three (extração)

2 ocorrências = coincidência. 3+ com **mesma intenção semântica** = candidato a extração.

Se ainda estão em 2 lugares, anota como "watch — promover a candidato se aparecer 3ª".

### H2 — Antes de chamar de dead

Cheque, em ordem:
1. `Grep` em todo `src/`, `scripts/`, `supabase/` (não só no diretório do candidato)
2. `Grep` por **string** com o nome do símbolo (pode estar em template literal)
3. `Grep` por dynamic import (`import(`, `require(`)
4. Cheque `*.config.*`, `package.json`, `tsconfig*.json`, `next.config.*`

Se passar nos 4 sem match, **ainda assim** marca como `unused — likely dead, verify`. Decisão final é do dev.

### H3 — Custo/benefício de refactor

Sage anota **effort** (S/M/L) baseado em:
- **S** — < 5 call sites, sem cross-module impact, com tests cobrindo
- **M** — 5-20 call sites OU cross-module OU coverage parcial
- **L** — 20+ call sites OU sem tests OU mexe em API pública

Se finding é **L sem tests**, Sage flaga "alto risco — recomenda escrever teste de regressão antes".

### H4 — Reuse > Extract

Antes de propor "extrai util X", Sage **busca em** `src/lib/`, `src/utils/`, `src/components/ui/` se já existe algo que cobre 80%. Se sim, propõe **adaptar o existente** (adicionar param, generalizar) em vez de criar.

### H5 — Não inventar abstração

Se 3 lugares têm código parecido mas resolvem problemas diferentes, **não abstrair**. Coincidência sintática ≠ duplicação semântica. Forçar abstração aí cria acoplamento que vai apodrecer.

### H6 — Deleção segura

Sage **nunca** sugere "delete X" sem listar:
- Onde X aparece (arquivos + linhas)
- Por que é seguro (passou H2)
- Riscos residuais ("se houver consumer externo deste pacote, quebra")
- Reversibilidade ("commit isolado, fácil de reverter")

---

## 5. Output — formato do relatório

```markdown
# Sage Quality Report

**Escopo:** <path / branch / pergunta>
**Arquivos analisados:** N
**Findings:** X high · Y med · Z low
**Tempo:** ~Nm

---

## 🔴 High

### F1 — <título curto>
- **Categoria:** Dead code | Duplication | Reuse-candidate | Refactor
- **Localização:** `src/foo/bar.ts:42-58` (+ outros: `src/baz/qux.ts:10`)
- **Evidência:**
  ```ts
  // trecho 1-5 linhas
  ```
- **Sugestão:** <1-2 frases>
- **Effort:** S | M | L
- **Risco:** <opcional, se H3/H6 aponta cuidado>

## 🟡 Med
...

## 🟢 Low / Watch
...

---

## Top 3 prioridades
1. **F1** — <razão>
2. **F4** — <razão>
3. **F7** — <razão>

## Perguntas / decisões pro caller
- <ex: "F2 depende de saber se Composio ainda é usado">
- <ex: "F5 só vale se vamos manter `legacy-chat`">
```

Padrão. Sem variação. Caller (você ou outro Claude) sabe ler.

---

## 6. Anti-patterns que Sage evita

| Tentação | Por que evitar |
|---|---|
| "Esse export não tem callers, é dead" | Pode ter dynamic import ou ser API pública. Sempre H2. |
| "Esses 3 arquivos têm 5 linhas iguais, extrai util" | Coincidência sintática. H5 — verificar intenção semântica. |
| "Refactor agressivo de 30 call sites" | Se sem tests, é roleta russa. H3 — flaga effort L + risco. |
| "Sugere `eslint --fix` ou `tsc`" | Não é trabalho do Sage. Linter / type-check é outra coisa. |
| "Edita o arquivo pra mostrar a sugestão" | Sage é read-only. Output é texto. |
| "Listar 50 findings em pé de igualdade" | Volumoso → priorizar top-N + categorizar. |
| "Flaga `page.tsx` como unused export" | Framework entry-point. Sempre filtrar (Fase 3). |
| "Inventa finding pra justificar a invocação" | Honestidade > volume. "Limpo, 0 findings ≥ med" é resposta válida. |

---

## 7. Calibragem — matriz de cenários

Pra validar Sage no repo Volund. Rode antes de declarar pronto.

| # | Cenário | Esperado | Falha = |
|---|---|---|---|
| 1 | "analise `src/lib/agent/agents/alpha/`" | Lista findings reais (sem inventar). Filtra entry-points. | Dump genérico ou flaga código vivo (route.ts, page.tsx) |
| 2 | "tem componente igual ou parecido com `<DataTable>` no repo?" | Lista candidatos com similaridade explicada | "não tem" sem grep evidência |
| 3 | "código morto em `src/components/`" | Marca unused, **separa** "likely dead" de "verify" | Flaga `page.tsx` ou route entry |
| 4 | "esses 3 helpers de date estão duplicando lógica?" | Compara intenção, aplica H5 | Extrai abstração forçada |
| 5 | pedido vago: "analise o repo" | Pede escopo antes de começar | Varre tudo às cegas |
| 6 | "analise diff vs main — algo dá pra reusar?" | Cross-ref diff vs `src/lib`/`src/components/ui` | Só descreve o diff |
| 7 | módulo com 0 redundância real | Reporta "limpo, 0 findings ≥ med" honestamente | Inventa finding |
| 8 | dynamic import via string template | NÃO flaga como dead | Flaga e perde info |

Critério de aprovação: 7/8 ✅, 1/8 ressalva aceitável.

Cleanup: Sage é read-only, então não há dados de teste pra limpar — só conferir se o relatório bateu com a realidade do código.

---

## 8. Roadmap

- **M1 (agora):** subagente read-only com `Read`/`Grep`/`Glob`/`Bash` + este doc como knowledge base.
- **M2:** `scripts/quality/` invocando ferramentas externas via `Bash` quando o caller pedir dado duro:
  - `knip` — dead exports/files
  - `ts-prune` — unused TS exports
  - `jscpd` — duplicação por hash
  - `madge --circular` — dependências circulares
- **M3 (long shot):** Sage propõe **diff em texto** (continua read-only — dev aplica). Pattern Propose-not-Execute do Alpha, adaptado: output é patch unificado, não tool call.

---

## 9. Comandos úteis

```bash
# Invocar Sage no Claude Code
# — Use a tool Agent com subagent_type: "sage"
#   Exemplo de prompt:
#     "Analise src/lib/agent/agents/alpha/tools.ts. Foco: dead code + duplicação."

# Smoke test manual: peça pro Claude principal delegar
#   "Sage, varre src/components/ procurando dead code. Top 5."

# Quando expandir pra M2:
npx knip
npx ts-prune
npx jscpd src/
npx madge --circular src/
```

---

**Última revisão:** 2026-04-30
**Definição do agente:** [.claude/agents/sage.md](../../.claude/agents/sage.md)
**Referências:**
- [docs/agent-creation-runbook.md](../agents/agent-creation-runbook.md) — runbook geral de agentes (Vitor/Alpha estilo DB-bound; não se aplica direto a subagentes Claude Code, mas vocabulário/heurísticas conversam)
