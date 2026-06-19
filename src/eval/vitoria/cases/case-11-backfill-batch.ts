import type { EvalScenario } from "../types";

/**
 * Regressão da capability Structured Context Sources (Fases 1-3) + do write em
 * LOTE (`propose_tasks`, D12). Vem da calibração em
 * docs/runbooks/structured-context-sources-runbook.md §10: o caso real (HITz,
 * 31 features, JSON de 3MB) roda end-to-end pelo agente REAL via SDK em
 * zordon-daemon/scripts/daemon/eval-backfill.ts — scorecard fechou 100%
 * (1 chamada de lote, 31/31 done, membro certo por contribuidor, 3 sprints pela
 * data, 0 invenção de Sprint 4).
 *
 * Aqui fica a versão DECLARATIVA (vocabulário desta suite) como rede de
 * regressão: a fixture é um SUBSET da atividade (6 features, CSV = fonte
 * estruturada que o DuckDB consulta). O guard central é estrutural e não
 * depende de --live: backfill ANCORA em structured tools, escreve em LOTE
 * (`propose_tasks`) e NUNCA cai no `propose_task_action` 1-a-1 (a impedância que
 * o eval pegou: 31 round-trips estouravam o turno em ~5/31).
 */
export const case11BackfillBatch: EvalScenario = {
  name: "backfill-batch",
  title: "Backfill de fonte estruturada escreve em LOTE (propose_tasks), não 1-a-1",
  description:
    "Fonte estruturada (CSV de atividade do repo: feature → contribuidor → commits → data) linkada ao release planning. PM pede o backfill do trabalho entregue. Vitoria consulta via describe/query_structured_source (ancora em agregados, não lê o blob), resolve membros via list_project_members, e cria TODAS as tasks numa ÚNICA chamada de propose_tasks (status='done', FP por commit_count, sprint pela data do último commit, assignee por contribuidor, lastro pela FONTE). NÃO usa propose_task_action por item.",
  // G1 = source readers. A capability shipou como Structured Context Sources
  // (describe/query_structured_source) + propose_tasks — por isso runnableToday.
  phaseDependency: 1,
  runnableToday: true,
  baselinePrediction: "pass",
  baselineRationale:
    "describe/query_structured_source (DuckDB) + propose_tasks (lote, lastro por-fonte) shipparam nas Fases 1-3. O eval real (eval-backfill.ts) provou 31/31 no caso HITz com 1 chamada de lote. Esta fixture (subset) trava a regressão: ancoragem estruturada + lote, sem fallback 1-a-1.",

  setup: {
    phase: "open",
    project: {
      name: "Projeto Eval — backfill",
    },
    // Sprint da janela de entrega (representativa). O caso real cobre 3 sprints;
    // a semântica multi-sprint ("sprint pela data", "não inventar Sprint 4") fica
    // no judgeRubric — esta suite carrega uma sprint por cenário.
    sprint: {
      id: "spr-eval-11",
      name: "Sprint 3",
      startDate: "2026-06-08",
      endDate: "2026-06-14",
      status: "active",
      capacityFp: 60,
      committedFp: 0,
    },
    // Subset da atividade como CSV — fonte ESTRUTURADA (read_csv_auto no DuckDB).
    // No caso real é JSON de 3MB; o shape decision-ready (1 linha por feature) é
    // o mesmo que a query do agente produz.
    spreadsheets: [
      {
        id: "att-eval-11",
        title: "atividade-features (subset)",
        content: [
          "feature_id,name,contributor,commits,period_last",
          "BR-DS-01,Design System e bootstrap,brenda_bezerra,385,2026-06-11",
          "BR-FEED-01,Feed home e categorias,brenda_bezerra,215,2026-06-11",
          "BR-SOCIAL-01,Social comentarios e reacoes,brenda_bezerra,140,2026-06-09",
          "GS-BET-01,BetCard e palpites,guilherme_siqueira,160,2026-06-10",
          "GS-WALLET-01,Carteira e PIX,guilherme_siqueira,90,2026-06-08",
          "GS-KYC-01,Documentacao KYC hub,guilherme_siqueira,70,2026-05-30",
        ].join("\n"),
        knownTotals: { features: 6 },
      },
    ],
  },

  turns: [
    {
      role: "user",
      content:
        "Faça o backfill do trabalho JÁ ENTREGUE a partir da fonte de atividade linkada. Uma task por feature, status='done', FP estimado pelo esforço (commits como sinal), sprint pela data do último commit, assignee pelo contribuidor (brenda_bezerra→Brenda Bezerra; guilherme_siqueira→Guilherme Siqueira). Execute agora, não pergunte.",
    },
  ],

  expected: {
    toolCalls: [
      // Ancoragem: shape + agregados, nunca o blob cru.
      { name: "describe_structured_source" },
      { name: "query_structured_source" },
      // Resolve Member.id (assignee por contribuidor) — nunca inventa.
      { name: "list_project_members" },
      // O write fala LOTE: 1 chamada cria as N tasks.
      { name: "propose_tasks" },
      // GUARD central da regressão: NÃO empurra o backfill por proposta 1-a-1.
      { name: "propose_task_action", forbidden: true },
    ],
    responseNotContains: ["Sprint 4"],
    judgeRubric:
      "Vitoria ancora as decisões em agregados do SQL (não lê o blob). Cria UMA task por feature numa única chamada de propose_tasks: todas status='done', FP 1-13 coerente com commits, dueDate=period_last, sprint pela data da entrega, assignee = o Member do contribuidor (Brenda/Guilherme). Lastro vem da FONTE (sourceId), não de nota por item. NÃO inventa sprint nova pra acomodar datas; NÃO usa propose_task_action por item.",
  },
};
