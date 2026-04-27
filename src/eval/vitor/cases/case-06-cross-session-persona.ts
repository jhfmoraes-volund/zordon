import type { EvalCase } from "../types";

export const case06CrossSessionPersona: EvalCase = {
  name: "cross-session-persona",
  category: 6,
  title: "Detecta persona já estabelecida em session vizinha",
  description:
    "Usuário começa a descrever uma persona que já existe em outra session do mesmo projeto. Vitor deve sugerir reuso e ler a session de origem antes de duplicar.",
  phaseDependency: 4,
  runnableToday: false,
  baselinePrediction: "fail",
  baselineRationale:
    "Não existe sessionIndex no contexto nem read_session_memory. Vitor recriaria persona do zero.",

  setup: {
    currentStepKey: "personas_journeys",
    session: {
      id: "session-eval-06",
      title: "CI — Módulo Financeiro",
      type: "continuous_improvement",
      status: "in_progress",
    },
    project: {
      otherSessions: [
        {
          id: "session-vizinha",
          title: "Inception MVP",
          type: "inception",
          status: "completed",
          memoryAbstract:
            "Persona Camila (admin de salão) confirmada. Ticket R$ 280. iOS fora do MVP.",
          memoryMd: `## Personas Estabelecidas
- **Camila** (admin de salão): perde 2h/mês com fatura manual. Confirmada em 2026-04-20.`,
        },
      ],
    },
  },

  turns: [
    {
      role: "user",
      content:
        "preciso modelar a persona da admin do salão que cuida da parte financeira",
    },
  ],

  expected: {
    toolCalls: [{ name: "read_session_memory" }],
    responseContains: ["Camila", "Inception MVP"],
    responseNotContains: ["vou criar", "vamos começar do zero"],
    judgeRubric:
      "Vitor reconhece que persona equivalente (Camila) já existe na session Inception MVP e sugere reuso. NÃO cria persona nova sem pelo menos perguntar.",
  },
};
