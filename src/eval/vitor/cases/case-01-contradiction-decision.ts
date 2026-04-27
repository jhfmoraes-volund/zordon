import type { EvalCase } from "../types";

export const case01ContradictionDecision: EvalCase = {
  name: "contradiction-decision",
  category: 1,
  title: "Detecta contradição com decisão ativa e marca under_review",
  description:
    "Usuário propõe algo que contradiz uma decisão ativa. Vitor deve PARAR, citar a decisão (com data e razão), e chamar revise_decision marcando como under_review antes de seguir.",
  phaseDependency: 2,
  runnableToday: false,
  baselinePrediction: "fail",
  baselineRationale:
    "Não existe DesignDecision nem revise_decision tool. Vitor atual aceita silenciosamente — a única defesa hoje é o sessionContext em texto livre, que não estrutura status nem dispara contradição.",

  setup: {
    currentStepKey: "brainstorm",
    session: {
      id: "session-eval-01",
      title: "Inception Eval",
      type: "inception",
      status: "in_progress",
    },
    decisions: [
      {
        id: "dec-001",
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

  turns: [
    {
      role: "user",
      content: "vamos priorizar o app iOS pro MVP, virou prioridade",
    },
  ],

  expected: {
    toolCalls: [
      {
        name: "revise_decision",
        args: { id: "dec-001", status: "under_review" },
      },
    ],
    responseContains: ["2026-04-20", "decidido", "confirma"],
    responseNotContains: ["claro!", "vou priorizar", "perfeito"],
    judgeRubric:
      "A resposta cita explicitamente a decisão prévia (com data ou razão), pede confirmação antes de mudar, e NÃO assume silenciosamente que a decisão mudou.",
  },
};
