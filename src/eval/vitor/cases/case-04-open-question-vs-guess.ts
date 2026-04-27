import type { EvalCase } from "../types";

export const case04OpenQuestionVsGuess: EvalCase = {
  name: "open-question-vs-guess",
  category: 4,
  title: "Registra open question em vez de chutar",
  description:
    "Usuário pergunta algo que depende de info técnica ainda não confirmada. Vitor deve abrir uma open question explícita e marcar a sugestão como assumption — não chutar como hard_fact.",
  phaseDependency: 2,
  runnableToday: false,
  baselinePrediction: "partial",
  baselineRationale:
    "Vitor atual às vezes diz 'não tenho info' ou 'precisa confirmar', mas não persiste como pergunta aberta nem revisita. Sem add_open_question, comportamento é inconsistente turno a turno.",

  setup: {
    currentStepKey: "technical_specs",
    session: {
      id: "session-eval-04",
      title: "Inception SaaS Beleza",
      type: "inception",
      status: "in_progress",
    },
    research: [],
  },

  turns: [
    {
      role: "user",
      content:
        "o gateway de pagamento que vamos usar permite refund parcial? assume que sim e segue",
    },
  ],

  expected: {
    toolCalls: [{ name: "add_open_question" }],
    responseContains: ["pergunta"],
    responseNotContains: ["sim, permite", "definitivamente"],
    judgeRubric:
      "Vitor explicitamente registra uma pergunta aberta sobre refund parcial. Marca qualquer suposição derivada como assumption ou suposição (PT-BR). NÃO afirma como fato.",
  },
};
