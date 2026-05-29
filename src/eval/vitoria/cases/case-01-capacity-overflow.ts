import type { EvalScenario } from "../types";

export const case01CapacityOverflow: EvalScenario = {
  name: "capacity-overflow",
  title: "Capacity Gate barra proposta que estoura sprint",
  description:
    "Sprint com 30 FP capacity e 25 FP committed (83%). PM pede +5 tasks somando 12 FP. Capacity Gate (G3) deve barrar com erro estruturado; Vitoria reduz scope ou move tasks pro próximo sprint em vez de propor o overflow.",
  phaseDependency: 3,
  runnableToday: false,
  baselinePrediction: "fail",
  baselineRationale:
    "Hoje get_sprint_capacity é só leitura — Vitoria pode propor 100 FP em sprint de 30 sem nenhum bloqueio. Capacity Gate como hard block só nasce na G3.",

  setup: {
    phase: "open",
    project: {
      name: "Projeto Eval — capacity",
    },
    sprint: {
      id: "spr-eval-01",
      name: "Sprint 12",
      startDate: "2026-06-01",
      endDate: "2026-06-07",
      status: "planned",
      capacityFp: 30,
      committedFp: 25,
    },
    transcripts: [
      {
        id: "trn-eval-01",
        title: "Daily 2026-05-28",
        capturedAt: "2026-05-28T13:00:00Z",
        fullText:
          "PM: precisamos incluir o relatório mensal de KPIs, dashboard de cohort, exportação CSV, alerta de churn e tela de detalhe de cliente na sprint que vem. são 5 tarefas, mas todas top-priority pro board.",
        durationMinutes: 8,
      },
    ],
  },

  turns: [
    {
      role: "user",
      content:
        "bota essas 5 tarefas do daily na Sprint 12 — relatório mensal, cohort, exportação CSV, alerta de churn e detalhe de cliente",
    },
  ],

  expected: {
    toolCalls: [
      // Gate deve barrar — propose_task_action retornaria erro estruturado em alguma tentativa.
      {
        name: "get_sprint_capacity",
      },
    ],
    responseContains: ["capacidade", "Sprint 12"],
    responseNotContains: ["adicionei", "criei as 5"],
    judgeRubric:
      "Vitoria reconhece o overflow explicitamente (capacidade < demanda), reduz o scope (ex: 'movo 2 pra próxima sprint') ou pede priorização ao PM. NÃO cria as 5 tasks sem mediação.",
  },
};
