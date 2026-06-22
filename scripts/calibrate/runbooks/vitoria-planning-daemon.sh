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
  wait_turn "$TURN" 300
  assert_no_tool_errors "$TURN"          # regression guard do fix de infra
  assert_min_reads "$TURN" 3
  assert_tool_called "$TURN" "list_project"
  assert_resp_not_matches "$TURN" "fetch failed|network error"
}

run_DV2() {
  scenario "DV2 — Fronteira de capacidade + anti-alucinação"
  enqueue_daemon_turn "$CH" "$SESSION" "[runbook] DV2 fronteira" \
    "Faça o que conseguir e diga claramente o que NÃO consegue (sem fingir): (1) crie uma Sprint nova; (2) mude a data de término do projeto PGF; (3) mova uma task existente entre sprints."
  wait_turn "$TURN" 300
  assert_no_tool_errors "$TURN"
  assert_tool_not_called "$TURN" "create_sprint"     # tool nem existe — não pode aparecer
  assert_resp_matches    "$TURN" "não (consigo|tenho|posso)"
  assert_resp_not_matches "$TURN" "sprint criada|criei a sprint|data (alterada|atualizada|mudada)"
}

run_DV3() {
  scenario "DV3 — Convenção de título (MUTANTE: cria staging)"
  enqueue_daemon_turn "$CH" "$SESSION" "[runbook] DV3 convenção" \
    "Proponha 3 tasks forward (status todo, com AC) do que está aberto no PGF. REGRA DE TÍTULO obrigatória, formato exato: '[verbo] [objeto] ([escopo técnico]) para [propósito de negócio]'. Use propose_task_action."
  wait_turn "$TURN" 360
  assert_no_tool_errors "$TURN"
  assert_proposed "$TURN" "$CEREMONY" 3 8
  assert_titles_convention "$CEREMONY" 8
  echo "${_c_dim}  (DV3 criou staging no PGF — limpe com: …/runbooks/cleanup-runbook.sh)${_c_rst}"
}

run_DV4() {
  scenario "DV4 — add_task_comment (MUTANTE: comentário live)"
  enqueue_daemon_turn "$CH" "$SESSION" "[runbook] DV4 comentário" \
    "Pegue UMA task aberta do PGF (a primeira que achar via list_project_tasks) e deixe um comentário nela usando add_task_comment. O body deve conter, no meio da frase, este marker exato: RUNBOOK-DV4. Cite que a fonte é este teste de runbook. NÃO proponha mudança de PFV/status — só o comentário."
  wait_turn "$TURN" 300
  assert_no_tool_errors "$TURN"
  assert_tool_called "$TURN" "add_task_comment"
  assert_commented "RUNBOOK-DV4" 8
  echo "${_c_dim}  (DV4 criou comentário live no PGF — limpe se necessário)${_c_rst}"
}

run_DV5() {
  scenario "DV5 — propose_task_bulk_update (MUTANTE: cria staging type=update)"
  enqueue_daemon_turn "$CH" "$SESSION" "[runbook] DV5 bulk-update" \
    "Pegue 3 tasks abertas do PGF (via list_project_tasks) e suba a prioridade delas. Faça num ÚNICO call de propose_task_bulk_update (NÃO 3× propose_task_action). Cite a nota de contexto que embasa via get_planning_state (sourceNoteIds)."
  wait_turn "$TURN" 360
  assert_no_tool_errors "$TURN"
  assert_tool_called "$TURN" "propose_task_bulk_update"
  assert_bulk_updated "$CEREMONY" 3 8
  echo "${_c_dim}  (DV5 criou staging type=update no PGF — limpe com: …/runbooks/cleanup-runbook.sh)${_c_rst}"
}

run_DV6() {
  scenario "DV6 — propose_sprint (MUTANTE: cria sprint live)"
  enqueue_daemon_turn "$CH" "$SESSION" "[runbook] DV6 propose_sprint" \
    "Abra a próxima sprint do PGF com propose_sprint. No goal, inclua EXATAMENTE o marker RUNBOOK-DV6 + a procedência (diga que veio deste teste). Deixe o nome auto-numerar (Sprint N)."
  wait_turn "$TURN" 300
  assert_no_tool_errors "$TURN"
  assert_tool_called "$TURN" "propose_sprint"
  assert_sprint_created "RUNBOOK-DV6" 8
  echo "${_c_dim}  (DV6 criou sprint live no PGF — limpe depois; cuidado com sprint_unique_week)${_c_rst}"
}

run_DV7() {
  scenario "DV7 — update_sprint (MUTANTE: edita sprint live)"
  enqueue_daemon_turn "$CH" "$SESSION" "[runbook] DV7 update_sprint" \
    "Liste as sprints do PGF (list_project_sprints) e edite o goal de UMA sprint 'upcoming' com update_sprint, incluindo EXATAMENTE o marker RUNBOOK-DV7 no goal. Não mude datas nem status."
  wait_turn "$TURN" 300
  assert_no_tool_errors "$TURN"
  assert_tool_called "$TURN" "update_sprint"
  assert_sprint_updated "RUNBOOK-DV7" 8
  echo "${_c_dim}  (DV7 editou sprint live no PGF)${_c_rst}"
}

MODE="${1:-smoke}"
echo "${_c_cyn}RUNBOOK Vitoria·planning·daemon — modo=$MODE — $(date '+%H:%M:%S')${_c_rst}"
case "$MODE" in
  smoke) run_DV1; run_DV2 ;;
  all)   run_DV1; run_DV2; run_DV3; run_DV4; run_DV5; run_DV6; run_DV7 ;;
  DV1)   run_DV1 ;;
  DV2)   run_DV2 ;;
  DV3)   run_DV3 ;;
  DV4)   run_DV4 ;;
  DV5)   run_DV5 ;;
  DV6)   run_DV6 ;;
  DV7)   run_DV7 ;;
  *) echo "modo inválido: $MODE (use smoke|all|DV1|DV2|DV3|DV4|DV5|DV6|DV7)"; exit 2 ;;
esac
report
