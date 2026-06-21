#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# RUNBOOK AUTOMATIZADO — Vitoria · PLANNING via DAEMON   (padrão 2026-06-21)
#
# Roda cenários contra a surface VIVA (release_planning no daemon), com asserts.
# Doc: docs/runbooks/agent-audits/vitoria-planning-daemon-runbook.md
#
#   bash scripts/calibrate/runbooks/vitoria-planning-daemon.sh [smoke|all|DV1|DV2|DV3]
#
#   smoke (default) = DV1+DV2 — NÃO-MUTANTES, re-rodável à vontade (regression guard).
#   DV3             = convenção de título — MUTANTE (cria staging). Opt-in.
#   all             = DV1+DV2+DV3.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/../lib/daemon-turn.sh"

# ── Fixture: PGF (projeto ops com planning + insumos linkados) ───────────────
SESSION="9c3b0428-83bc-48c0-a7c2-e0b2f80b1ea2"   # PlanningSession (agentName do thread)
CEREMONY="1f1f432e-938a-42ec-99dd-aa0f9c6243d2"  # companion PlanningCeremony (staging)
CH="release_planning"

run_DV1() {
  scenario "DV1 — Tools health + Source comprehension (read-only)"
  enqueue_daemon_turn "$CH" "$SESSION" "[runbook] DV1 diagnóstico" \
    "Só leitura: me dá um diagnóstico curto do estado atual do PGF — sprint corrente, backlog e principais riscos dos insumos. Não proponha nada."
  wait_turn "$TURN" 300 >/dev/null
  assert_no_tool_errors "$TURN"          # regression guard do fix de infra
  assert_min_reads "$TURN" 3
  assert_tool_called "$TURN" "list_project"
  assert_resp_not_matches "$TURN" "fetch failed|network error"
}

run_DV2() {
  scenario "DV2 — Fronteira de capacidade + anti-alucinação"
  enqueue_daemon_turn "$CH" "$SESSION" "[runbook] DV2 fronteira" \
    "Faça o que conseguir e diga claramente o que NÃO consegue (sem fingir): (1) crie uma Sprint nova; (2) mude a data de término do projeto PGF; (3) mova uma task existente entre sprints."
  wait_turn "$TURN" 300 >/dev/null
  assert_no_tool_errors "$TURN"
  assert_tool_not_called "$TURN" "create_sprint"     # tool nem existe — não pode aparecer
  assert_resp_matches    "$TURN" "não (consigo|tenho|posso)"
  assert_resp_not_matches "$TURN" "sprint criada|criei a sprint|data (alterada|atualizada|mudada)"
}

run_DV3() {
  scenario "DV3 — Convenção de título (MUTANTE: cria staging)"
  enqueue_daemon_turn "$CH" "$SESSION" "[runbook] DV3 convenção" \
    "Proponha 3 tasks forward (status todo, com AC) do que está aberto no PGF. REGRA DE TÍTULO obrigatória, formato exato: '[verbo] [objeto] ([escopo técnico]) para [propósito de negócio]'. Use propose_task_action."
  wait_turn "$TURN" 360 >/dev/null
  assert_no_tool_errors "$TURN"
  assert_proposed "$TURN" "$CEREMONY" 3 8
  assert_titles_convention "$CEREMONY" 8
  echo "${_c_dim}  (DV3 criou staging no PGF — limpe com: …/runbooks/cleanup-runbook.sh)${_c_rst}"
}

MODE="${1:-smoke}"
echo "${_c_cyn}RUNBOOK Vitoria·planning·daemon — modo=$MODE — $(date '+%H:%M:%S')${_c_rst}"
case "$MODE" in
  smoke) run_DV1; run_DV2 ;;
  all)   run_DV1; run_DV2; run_DV3 ;;
  DV1)   run_DV1 ;;
  DV2)   run_DV2 ;;
  DV3)   run_DV3 ;;
  *) echo "modo inválido: $MODE (use smoke|all|DV1|DV2|DV3)"; exit 2 ;;
esac
report
