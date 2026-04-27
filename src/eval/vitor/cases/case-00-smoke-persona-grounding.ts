import type { EvalCase } from "../types";

/**
 * Smoke test — Vitor atual deve passar nisso HOJE.
 *
 * Mede o básico: Vitor lê step data, referencia persona pelo nome,
 * ancora sugestão na dor real. Se isso falhar, o problema não é memória —
 * é o prompt ou a integração de contexto.
 */
export const case00SmokePersonaGrounding: EvalCase = {
  name: "smoke-persona-grounding",
  category: 0,
  title: "Vitor referencia persona pelo nome ao sugerir feature",
  description:
    "Step data já tem persona Camila com dor mapeada. Vitor deve sugerir feature mencionando Camila explicitamente e ancorando na dor — comportamento já esperado do prompt atual.",
  phaseDependency: 0,
  runnableToday: true,
  baselinePrediction: "pass",
  baselineRationale:
    "O prompt atual em modo brainstorm explicitamente instrui Vitor a usar nomes exatos das personas e referenciar painPointRef. Se falhar, há regressão na integração get_step_data.",

  setup: {
    currentStepKey: "brainstorm",
    session: {
      id: "session-eval-smoke",
      title: "Smoke — Persona Grounding",
      type: "inception",
      status: "in_progress",
      stepData: {
        personas_journeys: {
          personas: [
            {
              id: "p-camila",
              name: "Camila",
              role: "Admin de salão de beleza",
              context: "Gerencia agenda e fatura mensal de prestadores",
              asIsSteps: [
                {
                  id: "as1",
                  description: "Lança fatura manual em planilha todo mês",
                  painOrGain: "Perde 2h/mês com lançamento manual e erros",
                },
                {
                  id: "as2",
                  description: "Liga pra cada prestador pra cobrar",
                  painOrGain: "Cobrança fica inconsistente, atraso de pagamento",
                },
              ],
              toBeSteps: [],
            },
          ],
        },
      },
    },
  },

  turns: [
    {
      role: "user",
      content:
        "sugere uma feature pra resolver a dor mais crítica dessa persona. responde em até 8 linhas.",
    },
  ],

  expected: {
    responseContains: ["Camila"],
    responseNotContains: ["o usuário", "os usuários"],
    judgeRubric:
      "A resposta menciona Camila pelo nome, identifica explicitamente uma das dores (lançamento manual ou cobrança), e a feature proposta ataca essa dor diretamente.",
  },
};
