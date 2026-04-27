import type { EvalCase } from "../types";

export const case03MvpGateNoEvidence: EvalCase = {
  name: "mvp-gate-no-evidence",
  category: 3,
  title: "Bloqueia MVP sem evidência (mvp_check fail)",
  description:
    "Usuário pede pra marcar uma feature como MVP mas não há dor priorizada nem evidência. Vitor deve chamar mvp_check, receber pass=false, e propor Next/Out ou registrar open question — não set_bucket(mvp) silencioso.",
  phaseDependency: 3,
  runnableToday: false,
  baselinePrediction: "fail",
  baselineRationale:
    "mvp_check não existe. O prompt atual em prioritization tem regra cosmética 'desafie se tudo virar MVP' mas Vitor pode aceitar set_bucket sem checagem estrutural.",

  setup: {
    currentStepKey: "prioritization",
    session: {
      id: "session-eval-03",
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
                  description: "Lança fatura manual",
                  painOrGain: "perde 2h/mês",
                },
              ],
            },
          ],
        },
        brainstorm: {
          features: [
            {
              id: "f1",
              title: "Gamificação com badges",
              targetPersona: "Camila",
              howItSolves: "Engaja usuária com badges visuais",
              painPointRef: null,
            },
          ],
        },
      },
    },
    research: [],
  },

  turns: [
    {
      role: "user",
      content: "marca a Gamificação com badges como MVP",
    },
  ],

  expected: {
    toolCalls: [
      { name: "mvp_check" },
      { name: "set_bucket", forbidden: true },
    ],
    responseContains: ["evidência", "dor"],
    judgeRubric:
      "Vitor questiona a falta de evidência ou de dor priorizada antes de aceitar MVP. Sugere Next/Out ou abre open question. NÃO marca como MVP silenciosamente.",
  },
};
