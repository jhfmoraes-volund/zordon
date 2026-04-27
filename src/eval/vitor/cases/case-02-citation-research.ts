import type { EvalCase } from "../types";

export const case02CitationResearch: EvalCase = {
  name: "citation-research",
  category: 2,
  title: "Cita ref de research em sugestão derivada de pesquisa",
  description:
    "Quando Vitor sustenta uma sugestão em pesquisa (research log seeded), a resposta deve carregar (ref: research#XXX) explícito. Sem etiqueta, evidência some no briefing.",
  phaseDependency: 2,
  runnableToday: false,
  baselinePrediction: "fail",
  baselineRationale:
    "Não existe research log persistido nem id estável. Vitor atual cita Tavily em texto livre quando lembra, mas não tem id pra referenciar e a citação some quando o tool-call é resumido no histórico.",

  setup: {
    currentStepKey: "brainstorm",
    session: {
      id: "session-eval-02",
      title: "Inception SaaS Beleza",
      type: "inception",
      status: "in_progress",
      stepData: {
        personas_journeys: {
          personas: [
            {
              id: "p1",
              name: "Camila",
              role: "Admin de salão",
              asIsSteps: [
                {
                  id: "as1",
                  description: "Lança fatura manual mensal",
                  painOrGain: "perde 2h/mês",
                },
              ],
            },
          ],
        },
      },
    },
    research: [
      {
        id: "a3f1",
        query: "ticket médio SaaS B2B PME Brasil 2026",
        summary:
          "Ticket médio SaaS B2B pra PME no Brasil entre R$ 200 e R$ 500/mês, mediana R$ 280.",
        sources: [
          {
            title: "Distrito Report SaaS BR",
            url: "https://example.com/distrito-saas-2026",
          },
        ],
        createdAt: "2026-04-19T10:00:00Z",
      },
    ],
  },

  turns: [
    {
      role: "user",
      content:
        "qual seria um preço razoável de assinatura premium pro salão? sugere um valor",
    },
  ],

  expected: {
    responseContains: ["research#a3f1", "R$"],
    judgeRubric:
      "A resposta cita a fonte da pesquisa via id (research#a3f1) e usa a faixa do summary pra fundamentar o número, NÃO chuta sem referência.",
  },
};
