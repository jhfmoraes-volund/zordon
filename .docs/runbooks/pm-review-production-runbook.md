# Runbook — PM Review automático: pronto pra produção

> **Tipo:** runbook co-pilotado (ativação + UX + observabilidade sobre o Ritual Playbook / PM Review já construído).
> **Objetivo numa frase:** transformar o cron de PM Review (já no ar) numa experiência **confiável e legível** pro PM — uma vez ligada a automação, todo dia o draft da semana fica em dia sozinho, sempre visível, com um **log de atualização** (o quê/quando/por qual gatilho), e o PM só lê → ajusta → publica.
> **Status:** 🟡 Fase 0 em execução (jun/18).

Base: [[project_ritual_playbook]], [[project_pm_review]], [[project_vitoria_daemon_surfaces]]. Sobe em cima de `docs/runbooks/pm-review-granola-folder-runbook.md` + `docs/runbooks/ritual-playbook-consolidation-runbook.md`.

---

## 0. O contrato de experiência (o que o PM espera depois de ligar a automação)

> "Liguei a folder SILFAE uma vez. A partir daí, toda manhã (dias úteis, 08h BRT) a Vitoria lê qualquer reunião nova daquela folder e mantém o draft do PM Review **desta semana** em dia. Abro a página e **sempre** há um slot pra semana — ou o draft, ou um *'aguardando reuniões'* honesto. Acima do report há um **histórico**: *'Atualizado seg 08:12 — incorporou 2 reuniões [links] · qua 08:05 — +1 reunião'*. Eu ajusto, publico, congela. Se acabei de jogar uma nota e não quero esperar amanhã, clico **Atualizar agora**."

**Timing real (a promessa):** import do Granola é **horário** → a *fonte* fica disponível em ~1h; o refresh do *report* é **diário 08h** → uma nota de terça 14h entra no draft de quarta de manhã.

**Decisão de modelo (D0):** **draft vivo da semana corrente**, refrescado diariamente, com **slot sempre visível** — NÃO um batch de domingo. A previsibilidade vem do slot sempre presente + estado vazio honesto, não de gerar linha vazia toda semana.

---

## 1. Princípios fixados (Dn)

| # | Decisão |
|---|---------|
| D0 | Draft vivo da semana (Mon→), refresh diário; slot sempre visível. |
| D1 | **Não bloquear** criação manual. O botão manual vira **"Atualizar agora"** — refresh idempotente da MESMA linha da semana (UNIQUE `(projectId, referenceWeek)` já impede review paralela). |
| D2 | **Nunca gerar draft vazio.** Sem fonte fresca = no-op (0 custo LLM). A previsibilidade é UI (slot + empty-state), não linha no banco. |
| D3 | **Publicar congela** (cron não sobrescreve published). Draft é editável antes (review-and-tweak). |
| D4 | **Log de atualização visível e com refs tipadas** — cada refresh que mudou algo vira entrada no histórico, com links clicáveis pras transcrições incorporadas. |
| D5 | **Heartbeat, não amputação.** "Está rodando?" se resolve com badge (último/próximo refresh), não tirando botões. |
| D6 | **Sem miss silencioso.** Notas recentes fora de qualquer folder vinculada são surfaçadas pro PM atribuir. |

---

## Fase 0 — Ativação & smoke (ops; ~zero código)

Fazer rodar de verdade em prod. **Estado verificado jun/18:**

| Gate | Estado |
|------|--------|
| Schema `ProjectGranolaFolder` + RLS | ✅ |
| 8 bindings (curador, token do João) | ✅ |
| Cron `pm-review-refresh` ativo (`0 11 * * 1-5`) | ✅ |
| Vault (`url`=zordon.volund.com.br, `token` 64ch = `.env`) | ✅ |
| Daemon vivo (Vitoria `done`) | ✅ |
| Fix roteamento folder→projeto (`fm.id`) | ✅ ZRD-JM-165 |
| **`PM_REVIEW_REFRESH_AUTH_TOKEN` no env do Cloud Run** | ✖ **falta** → rota dá 500 |

### Passos
1. **Setar `PM_REVIEW_REFRESH_AUTH_TOKEN` no Cloud Run** = valor do Vault/`.env` + redeploy. (Único gate que falta pro cron auto-funcionar.)
2. **Backfill da nota órfã** que o roteamento velho deixou pra trás (pré-fix): `UPDATE "ContextSource" SET "projectId"=<proj> WHERE source='granola' AND "projectId" IS NULL AND <da folder bindada>`. Hoje: `not_qPsneT6m2xlDsG` ("SILFAE - Sync") → SILFAE `05c40f5a-…`.
3. **Smoke:** disparar a rota 1× → confirmar PMReview da semana com `reportMarkdown` + `reportGeneratedAt`, `status='draft'`.

### Verificação
- [ ] `curl -X POST .../api/cron/pm-review-refresh -H "Authorization: Bearer <token>"` → 200 com `{enqueued:≥1}`.
- [ ] ChatTurn da thread vai `queued→running→done`; PMReview ganha report.
- [ ] Rodar de novo sem nota nova → `noop` (D2); published não é tocado (D3).

---

## Fase 1 — Slot da semana + estados (fundação de UX)

Previsibilidade sem linha-lixo.

- **Slot sempre presente** na página/lista do PM Review pra semana corrente, mesmo sem linha no banco. Estados: `loading` (turno em voo) / `empty` ("aguardando reuniões · 0 notas novas") / `draft` / `published` (congelado) / `error`.
- **Botão "Atualizar agora"** (renomear de "Sintetizar/criar") — refresh idempotente; desabilitado enquanto há turno `queued/running` (a rota já evita pile-up).
- **Badge de status:** "Automático · último refresh seg 08:12 · próximo amanhã 08h · on/off". (= `RitualPlaybook.enabled` + último ChatTurn + agenda do cron.)

### Verificação
- [ ] Semana sem fonte → slot mostra empty-state (não cria PMReview).
- [ ] Turno em voo → slot mostra loading; botão desabilitado.
- [ ] Badge mostra último refresh real + próximo horário.

---

## Fase 2 — Log de atualização (a feature-âncora)

O PM precisa **ver** como o report ficou daquele jeito.

- **Timeline por PM Review:** 1 entrada por refresh que mudou algo — `quando`, gatilho (`cron`/`manual`), **N fontes incorporadas com links tipados** pras transcrições, e (opcional) 1 linha *"o que mudou"* da Vitoria. + evento de publicação ("Publicado por João · sex").
- **v1 sem migration (derivado):** `EntityLink.createdAt` (quando cada fonte foi linkada ao `pmReviewId`) agrupado com o `ChatTurn` (quando sintetizou, custo/tokens). Já dá quando + quais fontes.
- **v2 (narrativa):** tabela leve `PMReviewRefreshEvent(id, pmReviewId, occurredAt, trigger, newSourceCount, status, changeSummary, chatTurnId)` + a Vitoria devolve o `changeSummary` no turno. Só se a timeline derivada não bastar.
- No-op fica **quieto** (atualiza só "última verificação" no badge) — log é sinal, não spam.

### Verificação
- [ ] Após 2 refreshes com nota nova, timeline mostra 2 entradas com contagem + links clicáveis.
- [ ] No-op não cria entrada na timeline (só move "última verificação").
- [ ] Publicar adiciona entrada "Publicado por <PM>".

---

## Fase 3 — Confiança & completude

- **Surface de miss (D6):** "M notas recentes fora de qualquer folder vinculada — atribuir?" no projeto/card. Sem isso, esquecer de arquivar = miss silencioso = erosão de confiança.
- **Telemetria:** registrar cada refresh (`noop` vs `gerou` vs custo) → calibrar cadência (talvez Seg/Qui baste).
- **Validar curador cross-pessoa** (⚠️ pendente): um PM ≠ João arquiva nota numa folder compartilhada → `scripts/granola-curator-probe.ts` mostra `owner != João`. Confirma que o token-curador enxerga nota de terceiro.
- **Delta-only** (opcional): sintetizar só o novo (mais barato/rápido) — a timeline já mostra deltas mesmo.

---

## Fase 4 — Generalizar (depois)

Mesmo slot + badge + log pros outros rituais (Sprint Planning / Release Planning) — o playbook já suporta (`emphasis`/`load_context`/`redact` por `ritualType`).

---

## Ordem de execução
`Fase 0 (ativar+backfill+smoke) → 1 (slot+estados+botão) → 2 (log) → 3 (miss+telemetria+curador) → 4 (generalizar)`.

Tudo aditivo/reversível; o contrato de saída da Vitoria não muda.
