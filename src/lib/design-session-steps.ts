export type StepDef = {
  index: number;
  key: string;
  title: string;
  description: string;
};

export const INCEPTION_STEPS: StepDef[] = [
  { index: 0, key: "pre_work", title: "Pre-Trabalho", description: "Upload de documentos e pre-preenchimento com IA" },
  { index: 1, key: "product_vision", title: "Visao do Produto", description: "Por que existe? Qual problema resolve? Como e o sucesso?" },
  { index: 2, key: "scope_definition", title: "E / Nao E / Faz / Nao Faz", description: "Alinhar identidade e fronteiras do produto antes de explorar personas" },
  { index: 3, key: "personas_journeys", title: "Personas & Jornadas", description: "Quem sofre com o problema? Como vive hoje? Como sera com a solucao?" },
  { index: 4, key: "brainstorm", title: "Brainstorm de Funcionalidades", description: "Ideias sem filtro — cards de funcionalidades com contexto" },
  { index: 5, key: "risks_gaps", title: "Riscos & Lacunas", description: "O que pode dar errado e o que ainda nao esta claro nas regras de negocio" },
  { index: 6, key: "prioritization", title: "Priorizacao & Escopo", description: "MVP / Next / Out — o que entra agora?" },
  { index: 7, key: "technical_specs", title: "Especificacoes Tecnicas", description: "Stack, integracoes, regras tecnicas e restricoes" },
  { index: 8, key: "hypotheses", title: "Hipoteses & Metricas", description: "O que precisamos validar? Indicadores, metas e evidencias" },
  { index: 9, key: "briefing", title: "Briefing", description: "Resumo consolidado + geracao de tasks" },
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
