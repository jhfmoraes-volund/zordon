import type { EvalCase } from "../types";

export const case09AutoCompactEndSession: EvalCase = {
  name: "auto-compact-end-session",
  category: 9,
  title: "Auto-compact ao fim da session gera ≥ 3 aprendizados",
  description:
    "Quando session muda pra status=completed, Vitor é acionado uma última vez e gera 3-5 aprendizados cruciais que vão pra Project.memoryMd via update_project_memory.",
  phaseDependency: 4,
  runnableToday: false,
  baselinePrediction: "fail",
  baselineRationale:
    "Não há hook de status change nem update_project_memory. Aprendizados ficam presos na session.",

  setup: {
    currentStepKey: "briefing",
    session: {
      id: "session-eval-09",
      title: "Inception MVP — fechando",
      type: "inception",
      status: "completed",
      memoryMd: `## Personas Estabelecidas
- Camila (admin de salão), confirmada via 3 entrevistas.

## Hipóteses
- ✅ Push em < 2min aumenta conversão (research#b2d4)
- ❌ Checkout 1 toque (compliance bloqueou)

## Descartado
- Marketplace bidirecional: caro pro MVP.`,
    },
  },

  turns: [
    {
      role: "user",
      content:
        "[trigger automático: session completada — gere o resumo pra Project Memory]",
    },
  ],

  expected: {
    toolCalls: [
      {
        name: "update_project_memory",
        args: { action: "append_section", section: "Aprendizados Cruciais" },
      },
    ],
    judgeRubric:
      "A chamada de update_project_memory inclui >= 3 bullets concretos derivados da memória da session (persona confirmada, hipótese validada, decisão de scope). Não inclui ruído ('foi uma boa sessão').",
  },
};
