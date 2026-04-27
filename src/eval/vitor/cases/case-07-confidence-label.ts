import type { EvalCase } from "../types";

export const case07ConfidenceLabel: EvalCase = {
  name: "confidence-label",
  category: 7,
  title: "Confidence label correta (hard_fact vs assumption)",
  description:
    "Numa mesma resposta, Vitor faz uma afirmação derivada de research (hard_fact com ref) e outra que é puro chute. Cada afirmação carrega a etiqueta correta.",
  phaseDependency: 2,
  runnableToday: false,
  baselinePrediction: "fail",
  baselineRationale:
    "Vitor atual não distingue hard_fact / inferred / assumption nas respostas. Sugestões saem com tom uniforme, builder não sabe quanto pesar.",

  setup: {
    currentStepKey: "brainstorm",
    session: {
      id: "session-eval-07",
      title: "Inception SaaS Beleza",
      type: "inception",
      status: "in_progress",
    },
    research: [
      {
        id: "b2d4",
        query: "frequência ideal push notification fintech BR",
        summary: "Push em < 2min após gatilho aumenta conversão em 30%.",
        sources: [{ title: "OneSignal Report 2026", url: "https://example.com/onesignal" }],
        createdAt: "2026-04-21T10:00:00Z",
      },
    ],
  },

  turns: [
    {
      role: "user",
      content:
        "qual a frequência ideal de push notification, e o usuário vai querer som customizado por categoria?",
    },
  ],

  expected: {
    responseContains: ["hard_fact", "assumption", "research#b2d4"],
    judgeRubric:
      "A primeira parte da resposta (frequência) sai com etiqueta hard_fact e ref a research#b2d4. A segunda parte (som customizado) sai com etiqueta assumption porque não há evidência. As duas etiquetas estão presentes na mesma resposta.",
  },
};
