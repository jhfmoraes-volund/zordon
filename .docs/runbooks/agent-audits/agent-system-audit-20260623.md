# Auditoria do sistema de agentes — 2026-06-23

> **Gerado por** workflow multi-agente read-only (8 leitores por subsistema → verificação adversarial dupla de cada quick win → síntese). Run `wf_f50e11dc-e6e`.
> **Caveat:** os leitores leram o código ANTES do rework ZRD-JM-221 das story tools da Vitoria (update_story staged, approve_module, MeetingTaskAction polimórfica). Achados sobre o formato antigo das story tools podem estar parcialmente desatualizados; o resto (harness, organização de docs, drift do daemon, eval, doutrina) é válido.
> **Read-only:** nada foi alterado. Findings são candidatos, não ações executadas.

---

I have all the synthesized inputs. Producing the executive report.

## 1. Veredito de organização

A doutrina dos agentes é genuinamente sólida e atual (`docs/platform/agent-construction-doctrine.md`), mas falta um **entrypoint apontado**: a cadeia porquê→transporte→criação→matriz existe e se cross-linka parcialmente, só não é referenciada de cima (nem `AGENTS.md` nem `docs/README.md`). O maior atrito de navegação está em `docs/agents/<agente>/`, que virou um cemitério de planos stale (May 27 / Jun 1) enquanto a doc viva mudou-se para `docs/runbooks/` — e o índice oficial (`docs/README.md`) está factualmente errado: omite `agents/vitoria/` inteira e descreve 3 runbooks onde há 34. Existem 3 bons candidatos a "comece aqui", só não promovidos.

## 2. Achados de organização (ranqueados)

| Sev | Problema | Evidência | Ação |
|-----|----------|-----------|------|
| 🔴 high | 3 artefatos gerados stale em main HEAD (93 vs 98 tools); 3 gates de CI vermelhos herdados em todo PR | `docs/platform/agent-capability-matrix.md:7` (93) vs generator (98); `agent-surface.test.ts:38-43` RED; causa cafc873 sem regen | Rodar `gen-agent-surface --write` + `gen-capability-matrix --write` + re-vendorar `agent-surface.daemon.json` |
| 🔴 high | Sem índice/entrypoint dos agentes; `docs/README.md` mente (omite vitoria/, diz 3 runbooks/há 34) | `docs/README.md:11-13,24`; `agent-construction-doctrine.md:6` já posiciona a cadeia | Eleger doctrine como entrypoint + linkar de `AGENTS.md` e corrigir `docs/README.md` |
| 🔴 high | Surface `planning` da Vitoria órfã (28KB, sem callers) ainda carregando modelo antigo "commit/branch" | grep `ensurePlanningThread` = 0 callers; `prompt.ts:72-76`; UI usa só release_planning | Decidir morte/vida; se morta, remover do dispatch + registry + deletar prompt |
| 🔴 high | `alpha-daemon-plan.md` diz "Alpha não funciona no daemon" — oposto da realidade (daemon é default) | `alpha-daemon-plan.md:11,47` vs `prepare-turn/route.ts:253-258` + `tools-registry.ts:286-296` | Marcar Fase 1+2 DONE; é o ponteiro canônico (memory) |
| 🟡 med | Divergência estrutural na surface `wiki`: monorepo roteia `vitoria:wiki`, daemon cai em pm_review | `tools-registry.ts:440-444,492` (mono) vs daemon `:298-302,330-345` | Portar branch `wiki` pro daemon surfaceKey OU marcar wiki como daemon-unreachable na matriz |
| 🟡 med | 8 planos Vitor pré-PRD + cadeia Vitoria (staging-rewrite→intelligence) + logs Alpha — stale mas com refs vivas | docs/agents/{vitor,vitoria,alpha}/ datados May/Jun | Arquivar **só após** pass de freshness (vários têm inbound links de código vivo) |
| 🟡 med | `vitoria-debug.md` totalmente stale (tools/tabelas/modelo inexistentes); sem README de pasta | `vitoria-debug.md:23-40,67` (begin_reading/haiku-4-5) | Arquivar + criar tabela "doc atual por agente×capability" |
| 🟡 med | Memory `feedback_agent_chat_daemon_only` overstated: Vitor + connectors de ritual ainda 100% OpenRouter | `web.ts:125`, `pm-review-chat.ts:80` sem branch daemon | Corrigir a memory pra não tratar engine como código morto |
| 🟢 low | Naming inconsistente + PNG órfão em docs/agents/alpha/; runbook de audit em local divergente por agente | `alpha-rim-arc-circle-...png`; `registry.md:58,89` vs `AGENTS.md` | Cosmético — agrupar num pass de organização |

## 3. Quick wins de inteligência/performance (confirmados)

| # | Win | Alavanca | Esf | Evidência | Por que ajuda |
|---|-----|----------|-----|-----------|---------------|
| 1 ⭐ | Regenerar os 3 artefatos de surface (matrix+manifest+daemon.json) | reliability | S | `agent-surface.test.ts:38-43` RED; gen produz 98 vs 93 committed | Tira 3 gates de CI do vermelho **agora em prod**, restaura o guard de drift, torna as 5 tools novas da Vitoria visíveis na governança. Um único comando, sem cascata. |
| 2 ⭐ | Injetar bloco `## Hoje` no prompt da Vitoria (todas as surfaces) | intelligence | S | `prompt.ts:58-531` sem âncora; `release-planning.ts` ZERO; padrão em `alpha/context.ts:892-902` | Vitoria faz planning semanal e raciocina sobre datas de sprint sem âncora de hoje — anti-pattern §14 que a própria doutrina marca obrigatório. Elimina chute de ano/semana. |
| 3 | Mover os `--check` de surface pro gate de `sync-main.sh` | reliability | S | grep vazio em `sync-main.sh`; `agent-surface.yml:29-35`; HEAD stale já em prod | `sync-main.sh` faz push direto pra prod sem PR; os 4 checks rodam em ~5.7s local e impedem o cenário que já ocorreu (cafc873). |
| 4 | Adicionar `read_prd` ao caminho LIVE do Vitor + warning jsonb REPLACE | intelligence | S | `tools/prd.ts:81,94` vs `vitor/index.ts:311`; `web.ts:126` é o path live | Fecha buraco de **perda-de-dados**: update_prd faz REPLACE de arrays jsonb; sem read_prd, edição parcial apaga o resto em silêncio. Daemon já protege, live não. |
| 5 | Wirar `eval:vitor` + `eval:vitoria` em CI (dry-run, custo zero) | reliability | S | `agent-surface.yml` sem eval:*; runners já fazem `process.exit(1)` em case inválido | 2 linhas num workflow que já tem o padrão idêntico; impede merge de case malformado sem chamar LLM. |
| 6 | Registrar as 3 read-tools faltantes no path in-process de release_planning | reliability | S | `release-planning.ts:144-151` (prompt) vs `:246-286` (tools, sem as 3) | No fallback OpenRouter o prompt manda usar 3 tools inexistentes → modelo trava no "leia o transcript antes de propor". Factories já existem. |
| 7 | Limpar vazamento `story_tree` do prompt MODULE_DISCOVERY do Vitor | intelligence | S | `prompt.ts:483,490`; `constants.ts:10-17` não tem story_tree | Prompt diz "siga pra story_tree" num fluxo extinto, contradizendo o resto do prompt sobre PRDs. Confunde o próximo passo do modelo. |
| 8 | Fechar blind spot do teste prompt↔tools (loop sobre as 3 sub-fases) | reliability | S | `prompt-tools-coherence.test.ts:22` hardcoda só `prd_drafting` | Pega o vazamento do #7 e drifts futuros. **Nota**: rodar só os 2 asserts-invariante nas 3 fases (Test2/Test4 quebram fora de prd_drafting). |
| 9 | Remover `buildPMReviewPrompt` morto do daemon mirror | reliability | S | daemon `pm-review.ts:178` sem refs; prompt vivo vem de prepare-turn | ~300 linhas de prompt duplicado que drifta em silêncio (29975 vs 33352 bytes). Sem noUnusedLocals, deleção é segura. |
| 10 | Corrigir default-fantasma `require_approval_for` no prompt do Alpha | intelligence | S | `context.ts:28` (delete_task/bulk_move_tasks/split_task inexistentes) | Tools fantasma vazam no system prompt always-loaded. Trocar por `[]` (campo nunca é enforçado). |
| 11 | Remover setting morto `auto_assign_priority` | cost | S | `settings.ts:45-55` + `context.ts` render vs grep = 0 consumidores | Config-fantasma: PM seleciona critério e nada muda. Ganho de $ marginal; valor real é remover o trap. |
| 12 | Filtrar `generateSchemaDocsForPrompt` pelos steps da sessão | cost | S | `prompt.ts:1297` sem args; `activeSections:1243-1247` já filtra igual | Realinha a regra que o bloco vizinho já segue. Ganho de $ ~zero (vai pro cache), valor é consistência + foco do modelo. |
| 13 | Corrigir comentário de modelo haiku→sonnet em vitoria/index.ts | reliability | S | `vitoria/index.ts:35` vs `:39` | Doc-drift de 1 linha; embute tradeoff de custo falso ("leve/econômico"). |
| 14 | Sincronizar §1 do `alpha-daemon-plan.md` com o código | intelligence | S | `:11,47` vs `prepare-turn/route.ts:253-258` | Ponteiro canônico mente "Alpha não funciona no daemon"; evita decisão errada. |
| 15 | Eleger 1 entrypoint de agentes + linkar de AGENTS.md/README | intelligence | S | `agent-construction-doctrine.md:6`; AGENTS.md/README sem refs | Discoverability/onboarding; modesto mas não-placebo. |
| 16 | Corrigir as 2 imprecisões factuais em `docs/README.md` | reliability | S | `:11-13` (sem vitoria) e `:24` (3 vs 34 runbooks) | Índice oficial engana quem procura Vitoria. |

## 4. O que NÃO vale a pena agora

Rejeitados com confiança: **marcar TOOLS array como cacheável** (o provider OpenRouter não suporta breakpoint por-tool; o caminho viável é caching automático top-level — re-scoped, não morto); **schema-diff cross-repo** (real, mas a versão ingênua é placebo — 76 `.describe()` no mono vs 0 no daemon gerariam ruído; precisa de normalizador → é M, não quick win); **arquivar planos Vitor/Alpha/Vitoria** (premissa falsa: `create_user_story`/`story_tree` NÃO foram removidos, são feature-flag; e ~13 inbound links de código vivo quebrariam); **route-scope `get_pending_actions`** (Todo não tem coluna projectId — exige decisão de produto + join, não paste). **few-shot em release_planning** e **toolChoice forçado** também caem (comportamento já 31/31 no eval-backfill; toolChoice flat quebraria o gate de confirmação multi-step).

## 5. Recomendação de sequência

1. **Apagar o incêndio (reliability, hoje):** wins #1 (regenerar artefatos) + #3 (gate no sync-main.sh). Main HEAD já está com 3 gates vermelhos em prod; #1 conserta o estado e #3 impede recorrência. Faça os dois juntos — #3 sem #1 só trava o próximo push.
2. **Arrumar a casa (organização, baixo risco):** wins #15+#16 (entrypoint + README), #13+#14 (doc-drift de modelo/daemon), e a decisão sobre a surface `planning` órfã (achado high da §2). Tudo markdown/comentário, zero runtime.
3. **Subir o teto — correção de capacidade (intelligence):** win #4 (read_prd no Vitor live — fecha perda-de-dados, maior ganho de capacidade da lista) + #2 (âncora de data na Vitoria) + #7 (limpar story_tree).
4. **Endurecer a rede de regressão (reliability):** wins #5+#8 (eval em CI + fechar blind spot do teste) + #6+#9 (paridade/limpeza de prompts daemon↔in-process).
5. **Limpeza de baixo valor (oportunístico):** wins #10/#11/#12 num único commit de "config hygiene" do Alpha + filtro de schema docs.

Incerteza honesta: o item #8 exige separar asserts-invariante de asserts-fase-específico (não é wrap-in-loop cego); e a divergência `wiki` daemon↔monorepo (§2) é uma **decisão de produto** pendente (wiki roda no daemon ou só no engine?) — não a trate como bug mecânico.
