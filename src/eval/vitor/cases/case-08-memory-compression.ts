import type { EvalCase } from "../types";

const longMemoryMd = `## Contexto Específico desta Session
${"Lorem ipsum dolor sit amet ".repeat(60)}

## Personas Estabelecidas
${Array.from({ length: 15 }, (_, i) =>
  `- **Persona${i}** (papel ${i}): contexto longo descrevendo a dor da persona com muitos detalhes que ocupam espaço considerável no prompt e somam tokens. ${"Detalhe extra ".repeat(20)}`,
).join("\n")}

## Pesquisas Relevantes
${Array.from({ length: 20 }, (_, i) =>
  `- Pesquisa ${i} (research#r${i}): resumo extenso ocupando bastante espaço com texto descritivo cumulativo. ${"Texto extra ".repeat(15)}`,
).join("\n")}
`;

export const case08MemoryCompression: EvalCase = {
  name: "memory-compression",
  category: 8,
  title: "Comprime quando memória passa de 3k tokens",
  description:
    "Memória cumulada > 3000 tokens. Carregamento deve aplicar compressão (sessions arquivadas viram só id+title; entries antigas resumidas). Vitor recebe alerta no prompt e ainda consegue responder com info essencial.",
  phaseDependency: 2,
  runnableToday: false,
  baselinePrediction: "fail",
  baselineRationale:
    "Não existe budget de tokens nem compressão. loadContext atual carrega tudo cru. Em session longa, prompt cresce sem freio.",

  setup: {
    currentStepKey: "brainstorm",
    session: {
      id: "session-eval-08",
      title: "Session Longa",
      type: "inception",
      status: "in_progress",
      memoryMd: longMemoryMd,
    },
  },

  turns: [
    {
      role: "user",
      content: "qual era a Persona3 mesmo?",
    },
  ],

  expected: {
    judgeRubric:
      "A resposta encontra Persona3 corretamente apesar da memória ter sido comprimida. Não há erro de contexto perdido. Idealmente o sistema reportou (em metadata ou no prompt) que houve compressão.",
  },
};
