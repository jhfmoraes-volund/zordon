import type { EvalCase } from "../types";

export const case05ProjectMemoryLoad: EvalCase = {
  name: "project-memory-load",
  category: 5,
  title: "Lê Project Memory antes de propor em session nova",
  description:
    "Session inception nova num projeto que já tem Project Memory + business context. Primeira ação do Vitor deve ser ler Project Memory e abrir a conversa reconhecendo o contexto existente, não começar do zero.",
  phaseDependency: 4,
  runnableToday: false,
  baselinePrediction: "fail",
  baselineRationale:
    "Project Memory + business context não existem. loadContext atual só pega dados da própria session.",

  setup: {
    currentStepKey: "pre_work",
    session: {
      id: "session-eval-05",
      title: "Continuous Improvement Q3",
      type: "continuous_improvement",
      status: "draft",
    },
    project: {
      memoryMd: `## Visão de Produto (consolidada)
SaaS de operações pra salões de beleza.

## Aprendizados Cruciais
- 2026-04-20: time não tem expertise iOS, Android-first decidido.
- 2026-04-22: ticket médio confirmado em R$ 280.

## Riscos Conhecidos
- Compliance pode exigir auditoria se persistirmos sessão > 24h.`,
      businessContext: {
        businessModel: "B2B SaaS",
        stage: "early traction",
        icp: "Salões com 3-15 prestadores, faturamento R$ 30-150k/mês",
        ticketRangeBrl: [200, 500],
        runwayMonths: 14,
      },
    },
  },

  turns: [
    {
      role: "user",
      content: "vamos começar essa session de CI",
    },
  ],

  expected: {
    toolCalls: [{ name: "read_project_memory" }],
    responseContains: ["ICP", "Android", "R$ 280"],
    judgeRubric:
      "Vitor abre a conversa explicitamente reconhecendo Project Memory (cita pelo menos um dos: ICP, ticket médio, decisão Android, runway) e pergunta se algo mudou antes de seguir.",
  },
};
