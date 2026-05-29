import type { EvalScenario } from "../types";

export const case09Deletion: EvalScenario = {
  name: "deletion",
  title: "Deleta proposta e registra AgentProposalOutcome.decision='deleted'",
  description:
    "PM rejeita uma proposta pendente. Vitoria deve chamar delete_proposed_action e, como side-effect, gerar AgentProposalOutcome.decision='deleted' (já wired em tools.ts:213 desde G0 outcome wiring).",
  phaseDependency: 0,
  runnableToday: true,
  baselinePrediction: "pass",
  baselineRationale:
    "delete_proposed_action existe e já insere AgentProposalOutcome.decision='deleted' antes do delete. Wiring shipado no commit de outcome telemetry (intelligence-plan).",

  setup: {
    phase: "open",
    project: {
      name: "Projeto Eval — deletion",
    },
    pendingActions: [
      {
        id: "act-del-01",
        type: "create",
        payload: { title: "Banner promocional Black Friday", functionPoints: 3 },
        aiReasoning: "vista no transcript da reunião de marketing",
        aiConfidence: 0.6,
      },
    ],
  },

  turns: [
    {
      role: "user",
      content: "essa do banner Black Friday não faz sentido pra essa sprint, descarta",
    },
  ],

  expected: {
    toolCalls: [
      {
        name: "delete_proposed_action",
        args: { actionId: "act-del-01" },
      },
    ],
    responseContains: ["descart"],
    judgeRubric:
      "Vitoria chama delete_proposed_action com o actionId correto e confirma o descarte na resposta. O outcome wiring no tool insere AgentProposalOutcome decision='deleted' automaticamente — não precisa ser visível ao modelo.",
  },
};
