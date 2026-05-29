import type { EvalScenario } from "../types";

export const case07ScopeCreep: EvalScenario = {
  name: "scope-creep",
  title: "Detecta scope creep ao final da planning",
  description:
    "Planning quase fechada (status=in_review, 4 tasks aprovadas). PM diz 'aproveitando, podemos incluir relatórios?'. Vitoria deve marcar com nota kind=scope_creep e oferecer alternativa (próximo sprint) em vez de aceitar silenciosamente.",
  phaseDependency: 2,
  runnableToday: false,
  baselinePrediction: "fail",
  baselineRationale:
    "Atual Vitoria não tem skill scope_creep_detection — aceita propostas tardias como qualquer outra. G2 introduz capacity_overflow_resolution_playbook que cobre esse padrão.",

  setup: {
    phase: "in_review",
    project: {
      name: "Projeto Eval — scope creep",
    },
    sprint: {
      id: "spr-eval-07",
      name: "Sprint 13",
      startDate: "2026-06-08",
      endDate: "2026-06-14",
      status: "planned",
      capacityFp: 30,
      committedFp: 28,
    },
    pendingActions: [
      {
        id: "act-1",
        type: "create",
        payload: { title: "Onboarding v2", functionPoints: 8 },
        aiReasoning: "demanda recorrente em 3 reuniões",
        aiConfidence: 0.9,
      },
      {
        id: "act-2",
        type: "create",
        payload: { title: "Dashboard cohort", functionPoints: 5 },
        aiReasoning: "OKR Q2",
        aiConfidence: 0.85,
      },
      {
        id: "act-3",
        type: "move",
        taskId: "task-x",
        targetSprintId: "spr-eval-07",
        payload: { functionPoints: 3 },
        aiReasoning: "carry-over",
        aiConfidence: 0.8,
      },
      {
        id: "act-4",
        type: "create",
        payload: { title: "Refactor billing retry", functionPoints: 12 },
        aiReasoning: "risco crítico do daily",
        aiConfidence: 0.95,
      },
    ],
  },

  turns: [
    {
      role: "user",
      content:
        "ah, aproveitando que tá aberta — bota também o módulo de relatórios mensais. tem 4 telas, acho que cabe.",
    },
  ],

  expected: {
    toolCalls: [
      // Espera add_context_note kind=scope_creep ou similar. propose_task_action OK só se gate barrar depois.
      { name: "add_context_note", args: { kind: "scope_creep" } },
    ],
    responseContains: ["scope", "Sprint 14"],
    responseNotContains: ["adicionei", "criei a task"],
    judgeRubric:
      "Vitoria identifica que estamos no fim da planning (in_review), nomeia 'scope creep' explicitamente, e oferece adiar pra próxima sprint. NÃO cria a task sem mediação.",
  },
};
