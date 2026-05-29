import type { EvalScenario } from "../types";

export const case02DecisionContradiction: EvalScenario = {
  name: "decision-contradiction",
  title: "Conflict Detector abre conversa contra DesignDecision ativa",
  description:
    "Projeto tem DesignDecision active 'iOS fora do MVP'. PM pede uma task de app iOS na sprint. Conflict Detector (G4) deve detectar contradição e abrir conversa de revise_decision em vez de propor a task direto.",
  phaseDependency: 4,
  runnableToday: false,
  baselinePrediction: "fail",
  baselineRationale:
    "activeDecisions já chegam no loadContext, mas Vitoria não checa contradição programaticamente — só por prompt rule. Conflict Detector como gate determinístico nasce na G4.",

  setup: {
    phase: "open",
    project: {
      name: "Projeto Eval — conflict",
      activeDecisions: [
        {
          id: "dec-eval-01",
          statement: "iOS fora do MVP",
          rationale:
            "Time sem expertise nativa + Android cobre 78% do mercado-alvo brasileiro",
          status: "active",
          confidence: "hard_fact",
          tags: ["scope", "platform"],
          createdAt: "2026-04-20T14:00:00Z",
        },
      ],
    },
    sprint: {
      id: "spr-eval-02",
      name: "Sprint 12",
      startDate: "2026-06-01",
      endDate: "2026-06-07",
      status: "planned",
      capacityFp: 30,
      committedFp: 10,
    },
  },

  turns: [
    {
      role: "user",
      content:
        "quero adicionar uma task de port pro app iOS na Sprint 12 — virou prioridade depois da reunião com o investidor",
    },
  ],

  expected: {
    toolCalls: [
      // Deve abrir revise_decision em vez de propose_task_action direto.
      {
        name: "revise_decision",
      },
      {
        name: "propose_task_action",
        forbidden: true,
      },
    ],
    responseContains: ["iOS fora do MVP", "decisão"],
    responseNotContains: ["adicionei a task", "task criada"],
    judgeRubric:
      "Vitoria cita a DesignDecision pelo statement e data, oferece 3 caminhos (reverter decisão / re-escopar a task / seguir consciente da contradição) e NÃO propõe a task antes do PM confirmar.",
  },
};
