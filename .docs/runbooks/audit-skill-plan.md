# Audit Skill — Knowledge Base

> Knowledge base da skill `/audit` (`.claude/skills/audit/SKILL.md`). Contém **formato de relatório** (§5), **formato de PRD** (§6), e **calibragem** (§7). Vocabulário e heurísticas vêm de `docs/sage-agent-plan.md` — não duplique.

---

## 0. Visão geral

`/audit` é a skill de **avaliação geral consolidada** do Volund. Orquestra 3 lentes em paralelo:

| Lente | Delegado | O que cobre |
|---|---|---|
| Refactor / Dead / Reuse | SAGE (subagent) | Duplicação, extração, código não usado, candidatos a reuso |
| Segurança | `/security-review` (built-in) ou Agent prompt | OWASP, RLS, auth, secrets, validation, injection |
| Correctness | `tsc --noEmit` + `npm run lint` | Type errors, lint warnings, tech debt markers (TODO/FIXME) |

A skill **não analisa código por si**. Ela orquestra, consolida, e formata.

---

## 1. Diferença vs SAGE

| Pergunta | SAGE | /audit |
|---|---|---|
| Escopo típico | Módulo / arquivo / PR cirúrgico | Repo, área ampla, branch inteiro |
| Lentes | 1 (quality) | 3 (quality + security + correctness) |
| Output | Relatório no chat | Relatório + PRDs em `/tmp/volund-audit/` |
| Profundidade | Deep dive sempre | Top-down: fan-out shallow → deep dive só em High |
| Edita arquivos | Não | Não (escreve só em `/tmp`) |
| Roda | Direto pelo dev quando precisa de quality sweep | Quando dev quer "panorama geral" da saúde do código |

**Regra de uso**: pergunta cirúrgica → SAGE direto. Avaliação ampla / panorâmica → /audit (que invoca SAGE internamente).

---

## 2. Modos de invocação

```
/audit                       # pergunta escopo (Fase 0)
/audit src/lib/agent         # escopo path
/audit branch                # diff vs main
/audit pr                    # alias de branch
/audit prd F3,F5             # gera PRDs do relatório mais recente
/audit clean                 # rm -rf /tmp/volund-audit/ (com confirm)
```

Convenção: a skill mantém `/tmp/volund-audit/latest` como symlink pro diretório mais recente, pra `/audit prd` funcionar sem ambiguidade.

---

## 3. Fan-out de delegação (Fase 1)

Pra cada modo de invocação, a skill dispara em paralelo:

### Modo "path" ou "repo"

```
Agent({
  subagent_type: "sage",
  description: "Audit sweep <path>",
  prompt: "Analise <path>. Foco: refactor + dead code + reuse. Top 10 findings com severity. Filtre framework entry-points (page.tsx, route.ts, layout.tsx, middleware.ts)."
})

Agent({
  subagent_type: "general-purpose",
  description: "Security sweep <path>",
  prompt: "Security review do path <path>. Cobertura: OWASP top-10, RLS do Supabase, auth bypass, secrets em código, validation faltando em /api, SQL injection, XSS via dangerouslySetInnerHTML, redirects abertos. Output: lista findings com severity high/med/low, location:line, evidence (trecho), suggestion. Não invente — se não achou nada, reporte 'limpo'."
})

Bash: npx tsc --noEmit 2>&1 | tail -100
Bash: npm run lint 2>&1 | tail -100
Bash: grep -rE "(TODO|FIXME|XXX|HACK)" src/ --include="*.ts" --include="*.tsx" -n | head -50
```

### Modo "branch" / "pr"

Substitui o prompt do SAGE e do security por "analise o diff de `git diff main...HEAD`". `tsc/eslint` rodam no projeto inteiro (não dá pra escopar por diff sem perder cross-file errors).

Se branch não tem diff vs main → reporta "branch limpa, nada pra auditar" e para.

---

## 4. Schema interno de findings

Antes de escrever o relatório, a skill normaliza todos os outputs no schema:

```ts
type Finding = {
  id: string;              // F1, F2, ... sequencial na ordem em que entram
  source: 'sage' | 'security' | 'tsc' | 'eslint' | 'structural';
  category: 'Dead code' | 'Refactor' | 'Reuse' | 'Security' | 'Type error' | 'Lint' | 'Tech debt';
  severity: 'high' | 'med' | 'low';
  location: string;         // "src/foo/bar.ts:42" ou "src/foo/bar.ts:42-58"
  evidence: string;         // trecho ou mensagem original do delegado
  suggestion: string;       // 1-2 frases
  effort?: 'S' | 'M' | 'L'; // só pra refactor/reuse
  prd_worthy: boolean;      // true se high + escopo > 1 arquivo
};
```

### Regras de dedupe

1. Se SAGE marca `unused export X` e `eslint` marca `'X' is defined but never used` → mantém SAGE (mais contexto).
2. Se `tsc` reporta erro num arquivo e SAGE comentou refactor no mesmo arquivo → 2 findings distintos (categorias diferentes).
3. Se security e SAGE flagram a mesma linha por motivos diferentes → 2 findings.

### Regras de severity

- **High**: bloqueio (type error, security vuln med+, dead code em path crítico, dup com 5+ ocorrências)
- **Med**: refatoração desejável, lint warning relevante, dead code menor
- **Low**: TODO/FIXME, warnings de estilo, watch-list (2 ocorrências aguardando 3ª)

### Regras de prd_worthy

`prd_worthy: true` se TODAS:
- `severity === 'high'`
- Escopo cross-file (não é arquivo único)
- Não é trivialmente reparável em < 10min (excluir lint auto-fix, etc)

---

## 5. Formato do relatório

```markdown
# Audit Report — Volund

**Data:** YYYY-MM-DD HH:MM
**Escopo:** <path / branch / repo>
**Lentes:** SAGE · Security · Correctness
**Arquivos analisados:** N
**Findings:** X high · Y med · Z low
**PRDs gerados:** N (high apenas)

---

## Resumo executivo

<3-5 frases honestas. Se limpo, diz que tá limpo. Se vagabundo, diz onde tá o pus.>

---

## 🔴 High

### F1 — <título curto>
- **Categoria:** <category>
- **Source:** <source>
- **Localização:** `src/foo/bar.ts:42-58`
- **Evidência:**
  ```ts
  // trecho 1-5 linhas
  ```
- **Sugestão:** <1-2 frases>
- **Effort:** S | M | L  *(só pra refactor/reuse)*
- **PRD:** [prd-F1-<slug>.md](./prd-F1-<slug>.md)

### F2 — ...

---

## 🟡 Med

### F4 — <título>
- **Categoria / Source / Local / Evidência / Sugestão** (mesma estrutura, sem PRD)

---

## 🟢 Low / Watch

(Lista compacta — 1 linha por finding, sem evidência detalhada)
- **F12** [Tech debt] `src/foo/bar.ts:123` — TODO de 2 meses atrás, considerar resolver
- **F13** [Lint] `src/baz.ts:45` — `prefer-const` warning
- ...

---

## Top 3 prioridades

1. **F1** — <razão de uma frase>
2. **F4** — <razão>
3. **F7** — <razão>

---

## Lentes — outputs brutos

- [SAGE output](./raw/sage.md)
- [Security review](./raw/security.md)
- [tsc log](./raw/tsc.log)
- [eslint log](./raw/lint.log)

---

## Perguntas / decisões pro caller

- <ex: "F2 depende de saber se Composio ainda é usado">
- <ex: "F5 só vale se vamos manter `legacy-chat`">
- <ex: "Gerar PRD pra F8 (Med)? Olho-grande de scope.">
```

**Tom**: igual ao SAGE — pt-BR, terso, evidência-direto. Sem hedging, sem "talvez considere", sem "poderia ser interessante".

---

## 6. Formato do PRD

PRD por finding High vai pra `/tmp/volund-audit/<date>/prd-F<id>-<slug>.md`:

```markdown
# PRD — <título curto, action-oriented>

> Gerado automaticamente por `/audit` em YYYY-MM-DD a partir do finding F<id>.
> Este é um **draft**. Move pra `docs/prd-<slug>.md` no repo se for promover a feature oficial.

---

## 1. Problema

<2-4 frases descrevendo o que tá errado HOJE. Evidência concreta — não abstração.>

**Evidência:**
- `src/foo/bar.ts:42-58` — <trecho ou descrição>
- `src/baz/qux.ts:10` — <outro local>
- (etc — todas as ocorrências relevantes)

**Impacto observado:**
- <ex: "duplicação em 4 lugares; cada bugfix exige editar todos">
- <ex: "endpoint sem rate-limit expõe API key via abuse">
- <ex: "type error mascara regression em runtime — feature X quebrou em prod 2026-05-15">

## 2. Solução proposta

<O que fazer, em uma frase. Não como — isso é detalhe de implementação.>

**Abordagem:**
- <step 1 — alto nível>
- <step 2>
- (etc)

**Reuso aplicável:** *(se relevante)*
- <ex: "usar `useOptimisticCollection` existente em vez de criar hook novo">
- <ex: "estender `Field` compound em vez de wrapper custom">

## 3. Não-objetivos

<O que esta proposta NÃO faz. Importante pra travar escopo.>

- <ex: "não vamos refatorar o fluxo de auth — só o middleware">
- <ex: "não substitui ConfirmDialog em todo o repo, só nos 3 callers do finding">

## 4. Critérios de aceitação

- [ ] <AC 1, verificável>
- [ ] <AC 2>
- [ ] (etc)

## 5. Risco / Reversibilidade

- **Effort:** S | M | L
- **Blast radius:** <quantos arquivos / call sites>
- **Reversibilidade:** <commit isolado? feature flag? migration irreversível?>
- **Pré-requisitos:** <ex: "exige migration X antes", "exige teste de regressão">

## 6. Decisões pendentes

- <ex: "deletar `legacy-chat` ou manter como deprecated por 1 sprint?">
- <ex: "validation vai pro middleware ou no handler?">

---

**Origem:** Audit Report YYYY-MM-DD, finding F<id>.
**Status:** draft — aguardando triagem.
```

**Princípio**: PRD é **input pra decisão**, não plano detalhado. Não invente requisitos. Não estime data. Não atribua dono. Dev decide isso depois.

---

## 7. Calibragem — matriz de cenários

Pra validar a skill antes de declarar pronta:

| # | Cenário | Esperado | Falha = |
|---|---|---|---|
| 1 | `/audit` sem args | Pergunta escopo (Fase 0) | Sai varrendo o repo todo |
| 2 | `/audit src/lib/agent` | Fan-out paralelo SAGE+security+tsc+lint | Roda sequencial / só uma lente |
| 3 | `/audit branch` em branch sem diff | "branch limpa, nada pra auditar" | Tenta auditar mesmo assim |
| 4 | Escopo retorna 0 findings High | Relatório honesto "limpo, 0 high · X med" | Inventa High pra justificar |
| 5 | SAGE e eslint apontam mesmo unused | 1 finding (dedupe pra SAGE) | 2 findings duplicados |
| 6 | Finding High mas escopo arquivo único | severity=high, prd_worthy=false (sem PRD) | Gera PRD desnecessário |
| 7 | `/audit prd F3,F5` sem audit prévio | Erro claro "rode /audit primeiro" | Tenta gerar do nada |
| 8 | `/audit prd F3` quando F3 é Med | Pergunta "F3 é Med — gerar mesmo?" | Auto-gera silenciosamente |
| 9 | Audit retorna 30+ findings Low | Lista compacta (1 linha cada), sem evidência | Dump verboso |
| 10 | PRD gerado vai pra `docs/` | NÃO. Vai pra `/tmp/volund-audit/<date>/` | Polui git com drafts |

Critério de aprovação: 9/10 ✅.

---

## 8. Anti-patterns

| Tentação | Por que evitar |
|---|---|
| Re-fazer a análise do SAGE | SAGE é especializado e filtra falso-positivo. Você não. |
| Auto-gerar PRD pra todo Med | 30 PRDs ruins escondem 3 importantes. Pergunta antes. |
| Salvar PRD em `docs/` direto | `docs/prd-*` é canônico do repo. Audit gera draft, dev promove se quiser. |
| Rodar `next build` no tsc | Caro. `tsc --noEmit` cobre type-check sem buildar. |
| Audit do repo inteiro sem pedir | Fase 0 existe pra evitar isso. Confirme escopo. |
| Esconder findings duplicados sem dedupe | Polui o relatório. Aplique §4 regras de dedupe. |
| Reportar effort numa categoria Security | Effort só faz sentido pra refactor/reuse. Security é "fix asap" ou "não". |

---

## 9. Reuso de outputs

O usuário pode rodar `/audit` várias vezes. A skill mantém histórico em `/tmp/volund-audit/`:

```
/tmp/volund-audit/
├── 2026-05-26-1430/    # mais antigo
├── 2026-05-27-0915/
├── 2026-05-28-1700/    # mais recente
└── latest -> 2026-05-28-1700/
```

`latest` symlink permite `/audit prd Fx,Fy` operar no relatório mais recente sem ambiguidade.

`/audit clean` remove tudo (após confirm). Histórico fora do git é proposital — não queremos `/tmp/volund-audit/*` em diffs.

---

## 10. Roadmap

- **M1 (agora):** skill orquestradora com SAGE + security agent genérico + tsc + eslint.
- **M2:** integrar `/security-review` built-in diretamente quando escopo for branch/PR (em vez de Agent genérico).
- **M3:** integrar tools de M2 do SAGE quando disponíveis (`knip`, `ts-prune`, `jscpd`, `madge --circular`).
- **M4:** modo `/audit diff` — só audita arquivos alterados num diff arbitrário (não só branch vs main).

---

**Última revisão:** 2026-05-26
**Skill:** [.claude/skills/audit/SKILL.md](../../.claude/skills/audit/SKILL.md)
**Referências:**
- [docs/sage-agent-plan.md](sage-agent-plan.md) — vocabulário + heurísticas (delegado)
- [.claude/agents/sage.md](../../.claude/agents/sage.md) — definição do SAGE
- AGENTS.md — padrões de UI, commit, migrations
