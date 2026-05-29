import type { EvalScenario } from "../types";

export const case08EditProposal: EvalScenario = {
  name: "edit-proposal",
  title: "Edita proposta pendente quando PM pede ajuste de prioridade",
  description:
    "Existe MeetingTaskAction pendente type=create com priority='medium'. PM pede pra subir pra alta. Vitoria deve chamar update_proposed_action com o actionId correto, não criar nova proposta.",
  phaseDependency: 0,
  runnableToday: true,
  baselinePrediction: "pass",
  baselineRationale:
    "update_proposed_action já existe em src/lib/agent/agents/vitoria/tools.ts:124. pendingActions chegam no agentContext. Vitoria atual já sabe usar.",

  setup: {
    phase: "open",
    project: {
      name: "Projeto Eval — edit proposal",
    },
    pendingActions: [
      {
        id: "act-edit-01",
        type: "create",
        payload: { title: "Migração de Stripe Connect", priority: "medium", functionPoints: 8 },
        aiReasoning: "demanda do squad financeiro",
        aiConfidence: 0.8,
      },
    ],
  },

  turns: [
    {
      role: "user",
      content:
        "aquela proposta da migração do Stripe Connect — sobe a prioridade pra alta, virou crítica depois da reunião com o investidor",
    },
  ],

  expected: {
    toolCalls: [
      {
        name: "update_proposed_action",
        args: { actionId: "act-edit-01" },
      },
      // NÃO deve criar uma segunda proposta.
      {
        name: "propose_task_action",
        forbidden: true,
      },
    ],
    judgeRubric:
      "Vitoria identifica o actionId 'act-edit-01' pelo título da proposta pendente e chama update_proposed_action com payload.priority='high'. Confirma a edição na resposta sem ambiguidade.",
  },
};
