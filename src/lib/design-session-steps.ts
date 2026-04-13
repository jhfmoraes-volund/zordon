export type StepDef = {
  index: number;
  key: string;
  title: string;
  description: string;
};

export const INCEPTION_STEPS: StepDef[] = [
  { index: 0, key: "product_vision", title: "Visao do Produto", description: "Por que existe? Qual problema resolve? Como e o sucesso?" },
  { index: 1, key: "personas_journeys", title: "Personas & Jornadas", description: "Quem sofre com o problema? Como vive hoje? Como sera com a solucao?" },
  { index: 2, key: "brainstorm", title: "Brainstorm de Solucoes", description: "Ideias sem filtro — solution cards com contexto" },
  { index: 3, key: "prioritization", title: "Priorizacao & Escopo", description: "MVP / Next / Out — o que entra agora?" },
  { index: 4, key: "sequencing", title: "Sequenciamento", description: "Organizar MVP em fases e releases" },
  { index: 5, key: "technical_specs", title: "Especificacoes Tecnicas", description: "Stack, integracoes, regras tecnicas e restricoes" },
  { index: 6, key: "briefing", title: "Briefing", description: "Resumo consolidado + geracao de tasks" },
];

export const CI_STEPS: StepDef[] = [
  { index: 0, key: "retrospective", title: "Retrospectiva", description: "O que foi entregue + feedback" },
  { index: 1, key: "new_demands", title: "Novas Demandas", description: "Features, bugs, melhorias" },
  { index: 2, key: "prioritization", title: "Priorizacao", description: "MoSCoW nas demandas" },
  { index: 3, key: "refinement", title: "Refinamento Tecnico", description: "Duvidas e dependencias" },
  { index: 4, key: "briefing", title: "Briefing", description: "Resumo + geracao de tasks" },
];

export function getSteps(type: string): StepDef[] {
  return type === "inception" ? INCEPTION_STEPS : CI_STEPS;
}
