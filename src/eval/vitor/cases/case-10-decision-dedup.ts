import type { EvalCase } from "../types";

export const case10DecisionDedup: EvalCase = {
  name: "decision-dedup",
  category: 10,
  title: "Não duplica decision similar (dedup)",
  description:
    "Já existe DesignDecision 'iOS fora do MVP'. Usuário reafirma com palavras diferentes. Vitor deve detectar similaridade e NÃO criar duplicata — atualiza a existente ou ignora.",
  phaseDependency: 2,
  runnableToday: false,
  baselinePrediction: "fail",
  baselineRationale:
    "Não há tabela de decisions, então a questão não se aplica diretamente — mas no comportamento atual, Vitor anota tudo no chat sem dedup, gerando ruído cumulativo.",

  setup: {
    currentStepKey: "scope_definition",
    session: {
      id: "session-eval-10",
      title: "Inception MVP",
      type: "inception",
      status: "in_progress",
    },
    decisions: [
      {
        id: "dec-existing",
        statement: "iOS fora do MVP",
        rationale: "Time sem expertise + Android cobre 78%",
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
      content:
        "só pra deixar registrado: a gente não vai fazer iOS no MVP, focando só Android",
    },
  ],

  expected: {
    toolCalls: [
      { name: "list_decisions" },
      { name: "record_decision", forbidden: true },
    ],
    responseContains: ["já registrado", "dec-existing"],
    judgeRubric:
      "Vitor primeiro lista decisions, detecta a equivalência semântica com a existente, e responde reconhecendo que já está registrado. NÃO chama record_decision criando duplicata.",
  },
};
