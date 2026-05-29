import type { EvalScenario } from "../types";

export const case10ForecastPrecommit: EvalScenario = {
  name: "forecast-precommit",
  title: "Sprint Forecaster gera banner p50/p90 antes do commit",
  description:
    "Planning prestes a fechar com 35 FP planejados. Histórico de 5 sprints com delivered/planned ratio médio de 0.7. Sprint Forecaster (G6) deve chamar forecast_sprint e produzir banner com p50=24 e p90~32.",
  phaseDependency: 6,
  runnableToday: false,
  baselinePrediction: "fail",
  baselineRationale:
    "Não existe forecast_sprint tool nem SprintOutcome table populada. Forecaster e o banner são entregues na G6.",

  setup: {
    phase: "ready_to_commit",
    project: {
      name: "Projeto Eval — forecast",
      sprintHistory: [
        { plannedFp: 30, deliveredFp: 22 },
        { plannedFp: 28, deliveredFp: 18 },
        { plannedFp: 32, deliveredFp: 24 },
        { plannedFp: 30, deliveredFp: 20 },
        { plannedFp: 28, deliveredFp: 21 },
      ],
    },
    sprint: {
      id: "spr-eval-10",
      name: "Sprint 14",
      startDate: "2026-06-15",
      endDate: "2026-06-21",
      status: "planned",
      capacityFp: 40,
      committedFp: 35,
    },
    pendingActions: [
      {
        id: "act-fc-01",
        type: "create",
        payload: { title: "Story A", functionPoints: 15 },
        aiReasoning: "OKR Q2",
        aiConfidence: 0.9,
      },
      {
        id: "act-fc-02",
        type: "create",
        payload: { title: "Story B", functionPoints: 12 },
        aiReasoning: "demanda recorrente",
        aiConfidence: 0.85,
      },
      {
        id: "act-fc-03",
        type: "create",
        payload: { title: "Story C", functionPoints: 8 },
        aiReasoning: "tech debt crítico",
        aiConfidence: 0.95,
      },
    ],
  },

  turns: [
    {
      role: "user",
      content: "tô pronto pra concluir a planning — antes me dá um forecast do sprint",
    },
  ],

  expected: {
    toolCalls: [{ name: "forecast_sprint" }],
    responseContains: ["p50", "p90"],
    judgeRubric:
      "Vitoria chama forecast_sprint e devolve resposta citando p50≈24 FP e p90≈30-32 FP baseado no ratio histórico 0.7. Inclui pelo menos 1 risk factor (ex: scope > p50, holiday na semana). NÃO inventa números sem citar o histórico.",
  },
};
