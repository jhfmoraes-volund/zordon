# Runbook — Remediação da auditoria do sistema de agentes

> **Origem:** [`agent-system-audit-20260623.md`](agent-system-audit-20260623.md) (audit multi-agente read-only, 2026-06-23).
> **Objetivo:** resolver os achados em ordem de risco, cada passo com evidência, ação, verificação e esforço.
> **Como usar:** os blocos estão na ordem recomendada (incêndio → casa → teto → rede → limpeza). Cada passo é independente e idempotente; pode parar entre blocos. Marque `[x]` ao concluir.
> **Regra:** nenhum passo aqui foi executado pela auditoria. Antes de cada edição de código de agente, lembre [[feedback_regenerate_surface_artifacts]] e os 2 repos ([[project_daemon_tool_advertisement]]).

Legenda esforço: **S** <30min · **M** 30min–1h · **L** >1h.

---

## Bloco 1 — Apagar o incêndio (reliability, hoje)

CI de `main` está vermelho **em prod** e o `sync-main.sh` empurra direto sem PR. Os dois passos andam juntos: #1 conserta o estado, #3 impede recorrência.

### 1.1 Regenerar os 3 artefatos de surface  ·  **S**  ·  🔴

- **Problema:** `cafc873` (ZRD-JM-220, +5 tools da Vitoria) não regenerou os artefatos → matriz diz 93 tools, gerador produz 98. 4 gates do workflow `agent-surface` vermelhos.
- **Evidência:** `docs/platform/agent-capability-matrix.md` (header "93 tools") vs `scripts/gen-capability-matrix.ts`; `.github/workflows/agent-surface.yml:29-35`.
- **Ação:**
  ```bash
  npx tsx --tsconfig tsconfig.eval.json scripts/gen-agent-surface.ts --write docs/platform/agent-surface.manifest.json
  npx tsx --tsconfig tsconfig.eval.json scripts/gen-capability-matrix.ts --write docs/platform/agent-capability-matrix.md
  # daemon.json é vendorizado: gerar a surface do daemon e copiar (ver cabeçalho de scripts/check-daemon-surface.ts)
  npx tsx scripts/gen-agent-surface.ts --write /tmp/daemon-surface.json   # surface só-daemon
  # revisar o diff e copiar as chaves do daemon pra docs/platform/agent-surface.daemon.json
  ```
- **Verificação (tem que passar os 4):**
  ```bash
  npx tsx --tsconfig tsconfig.eval.json scripts/agent-surface.test.ts
  npx tsx --tsconfig tsconfig.eval.json scripts/gen-agent-surface.ts --check docs/platform/agent-surface.manifest.json
  npx tsx --tsconfig tsconfig.eval.json scripts/gen-capability-matrix.ts --check docs/platform/agent-capability-matrix.md
  npx tsx scripts/check-daemon-surface.ts
  ```
- **Nota:** as 5 tools de story da Vitoria (`list_project_stories`, `list_project_modules`, `get_story_detail`, `update_story`, `approve_module`) passam a aparecer na governança após este passo.

### 1.2 Mover os `--check` de surface pro gate do `sync-main.sh`  ·  **S**  ·  🔴

- **Problema:** `sync-main.sh` faz push direto pra prod sem PR; os checks só rodam no CI **depois** que o push já chegou em prod. Foi exatamente o cenário do `cafc873`.
- **Evidência:** `scripts/sync-main.sh` (sem chamada aos checks de surface); rodam em ~6s local.
- **Ação:** adicionar antes do commit/push, junto do gate de `tsc`, os 4 comandos de verificação do passo 1.1 (abortar se algum falhar).
- **Verificação:** rodar `bash scripts/sync-main.sh -m "test"` com a matriz dessincronizada de propósito deve **abortar** antes do push.

---

## Bloco 2 — Arrumar a casa (organização, baixo risco — só markdown/comentário)

### 2.1 Eleger 1 entrypoint dos agentes + linkar  ·  **S**

- **Problema:** não há "comece aqui" dos agentes; a cadeia porquê→transporte→criação→matriz existe mas não é apontada de cima.
- **Evidência:** `docs/platform/agent-construction-doctrine.md:6` já posiciona a cadeia; `AGENTS.md` e `docs/README.md` não a referenciam.
- **Ação:** eleger `agent-construction-doctrine.md` como entrypoint; linká-lo de `AGENTS.md` (seção de agentes) e de `docs/README.md`.

### 2.2 Corrigir as imprecisões factuais do `docs/README.md`  ·  **S**

- **Problema:** o índice oficial omite `docs/agents/vitoria/` inteira e diz "3 runbooks" onde há 34.
- **Evidência:** `docs/README.md:11-13` (sem vitoria), `:24` (3 vs 34).
- **Ação:** corrigir a contagem e adicionar a pasta `agents/vitoria/`. Considerar uma tabela "doc atual por agente × capability".

### 2.3 Sincronizar `alpha-daemon-plan.md` com o código  ·  **S**

- **Problema:** o ponteiro canônico diz "Alpha não funciona no daemon" — o oposto da realidade (daemon é default).
- **Evidência:** `docs/platform/alpha-daemon-plan.md:11,47` vs `src/app/api/agents/prepare-turn/route.ts:253-258` + `tools-registry.ts` (Alpha registrado).
- **Ação:** marcar Fases 1+2 como DONE; descrever o estado real (Alpha roda no daemon, `update_task` live).

### 2.4 Corrigir comentário de modelo `haiku→sonnet`  ·  **S**

- **Problema:** doc-drift de 1 linha embute tradeoff de custo falso.
- **Evidência:** `src/lib/agent/agents/vitoria/index.ts:35` (comentário) vs `:39` (modelo real).
- **Ação:** corrigir o comentário.

### 2.5 Decidir a surface `vitoria:planning` órfã  ·  **S→M**  ·  🔴 (decisão)

- **Problema:** surface `planning` (28KB de prompt, modelo antigo "commit/branch") sem callers; a UI usa só `release_planning`.
- **Evidência:** `grep ensurePlanningThread` = 0 callers; `src/lib/agent/agents/vitoria/prompt.ts:72-86`.
- **Decisão necessária (produto):** a surface `planning` morre ou volta a ter superfície? Se morta: remover do dispatch + do registry (`VITORIA_*` name-lists) + deletar `prompt.ts`, e **rodar o Bloco 1.1** (a contagem de tools muda). Se viva: documentar onde é usada.

> ⚠️ Os achados sobre as **story tools** da Vitoria no relatório foram lidos ANTES do rework ZRD-JM-221 ([[project_vitoria_story_tools]]). Revalide contra o estado atual antes de agir neles.

---

## Bloco 3 — Subir o teto (correção de capacidade — intelligence)

### 3.1 `read_prd` no caminho LIVE do Vitor + warning de REPLACE  ·  **S**  ·  🔴

- **Problema (perda de dados):** `update_prd` faz REPLACE de arrays jsonb; sem `read_prd` antes, edição parcial apaga o resto em silêncio. O daemon já protege; o path live (OpenRouter) não.
- **Evidência:** `src/lib/agent/tools/prd.ts:81,94`; `src/lib/agent/agents/vitor/index.ts:311`; path live em `web.ts:126`.
- **Ação:** registrar `read_prd` no toolset live do Vitor e adicionar no `update_prd` a regra "leia antes; mande o array COMPLETO (REPLACE)".
- **Verificação:** edição parcial de um PRD multi-campo preserva os campos não citados.

### 3.2 Injetar bloco `## Hoje` no prompt da Vitoria (todas as surfaces)  ·  **S**  ·  ✅ FEITO 2026-06-25

- **Feito:** helper compartilhado `src/lib/agent/today.ts` (`renderTodayBlock()`); Alpha refatorado pra reusar (output idêntico); `## Hoje` injetado no bloco VOLÁTIL (cache-correto) de planning (`prompt.ts`), `pm-review.ts` e `release-planning.ts`. tsc+eslint limpos. Prompt-only → sem mudança de tool/daemon/surface artifacts.
- **Problema (original):** Vitoria faz planning semanal e raciocina sobre datas de sprint **sem âncora de hoje** — anti-pattern §14 que a própria doutrina marca como obrigatório.
- **Evidência:** `src/lib/agent/agents/vitoria/prompt.ts` (sem âncora); `release-planning.ts` (zero); padrão pronto em `src/lib/agent/agents/alpha/context.ts:892-902`.
- **Ação:** adicionar um bloco `## Hoje` (data + nº da semana/sprint corrente) no prompt das surfaces da Vitoria, reusando o helper do Alpha.

### 3.3 Limpar vazamento `story_tree` do prompt do Vitor  ·  **S**

- **Problema:** o prompt MODULE_DISCOVERY manda "siga pra story_tree" num fluxo extinto, contradizendo o resto (que fala de PRDs).
- **Evidência:** `src/lib/agent/agents/vitor/.../prompt.ts:483,490`; `constants.ts:10-17` não tem `story_tree`.
- **Ação:** remover/atualizar a referência. (NÃO arquivar os planos do Vitor — `create_user_story`/`story_tree` são feature-flag com inbound links vivos; ver §"rejeitados" do relatório.)

---

## Bloco 4 — Endurecer a rede de regressão (reliability)

### 4.1 Wirar `eval:vitor` + `eval:vitoria` no CI (dry-run, custo zero)  ·  **S**

- **Problema:** a eval suite não roda em CI; case malformado entra sem barreira.
- **Evidência:** `.github/workflows/agent-surface.yml` sem `eval:*`; os runners já fazem `process.exit(1)` em case inválido; scripts `eval:vitor`/`eval:vitoria` no `package.json`.
- **Ação:** 2 linhas no workflow (modo validação de case, sem chamar LLM).

### 4.2 Fechar o blind spot do teste prompt↔tools  ·  **S**

- **Problema:** o teste de coerência cobre só uma sub-fase, deixando passar drifts como o #3.3.
- **Evidência:** `scripts/prompt-tools-coherence.test.ts:22` (hardcoda `prd_drafting`).
- **Ação:** rodar os 2 asserts-invariante nas 3 fases. **Cuidado:** Test2/Test4 são fase-específicos — não envolver tudo num loop cego; separar invariante de fase-específico.

### 4.3 Paridade/limpeza de prompts daemon↔in-process  ·  **S→M**  ·  (b) ✅ FEITO 2026-06-25

- **Problema:** (a) `buildPMReviewPrompt` morto no daemon mirror (~300 linhas que driftam); (b) read-tools que o prompt de `release_planning` manda usar não estão registradas no path in-process (fallback OpenRouter trava).
- **Evidência:** daemon `pm-review.ts:178` (sem refs); `release-planning.ts` prompt referencia `describe_structured_source`/`query_structured_source` vs assembly in-process que não as montava.
- **Feito (b):** `describe_structured_source` + `query_structured_source` montadas no toolset in-process do release_planning ([release-planning.ts](../../../src/lib/agent/agents/vitoria/release-planning.ts)) — paridade com o registry (path daemon já as tinha). tsc+eslint limpos.
- **Pendente (a):** deletar o `buildPMReviewPrompt` morto do daemon mirror.

---

## Bloco 5 — Limpeza de baixo valor (oportunístico, 1 commit de "config hygiene")

| # | Item | Evidência | Ação | Esf |
|---|------|-----------|------|-----|
| 5.1 | Default-fantasma `require_approval_for` no prompt do Alpha (tools inexistentes vazam) | `alpha/context.ts:28` | Trocar por `[]` | S |
| 5.2 | Setting morto `auto_assign_priority` (0 consumidores) | `alpha/settings.ts:45-55` + render em `context.ts` | Remover | S |
| 5.3 | Filtrar `generateSchemaDocsForPrompt` pelos steps da sessão | `prompt.ts:1297` (sem args) vs `:1243-1247` (já filtra) | Passar `activeSections` | S |

---

## O que NÃO fazer (rejeitado pela verificação adversarial)

- **Marcar o array TOOLS como cacheável** — OpenRouter não suporta breakpoint por-tool; o caminho viável é caching automático top-level (re-escopo, não quick win).
- **Schema-diff cross-repo ingênuo** — 76 `.describe()` no monorepo vs 0 no daemon gerariam ruído; precisa de normalizador → é M, não quick.
- **Arquivar planos Vitor/Alpha/Vitoria** — premissa falsa: `create_user_story`/`story_tree` são feature-flag, não removidos; ~13 inbound links de código vivo quebrariam. Arquivar só após pass de freshness.
- **Route-scope `get_pending_actions`** — `Todo` não tem coluna `projectId`; exige decisão de produto + join.
- **few-shot em release_planning / toolChoice forçado** — eval já 31/31; toolChoice flat quebraria o gate de confirmação multi-step.

---

## Sequência sugerida (resumo)

1. **Bloco 1** (1.1 + 1.2) — hoje. Sem isso, todo push leva CI vermelho a prod.
2. **Bloco 2** — markdown/comentário, zero runtime; inclui a decisão da surface órfã (2.5).
3. **Bloco 3** — capacidade: 3.1 (perda de dados) primeiro.
4. **Bloco 4** — rede de regressão.
5. **Bloco 5** — limpeza num commit só.
