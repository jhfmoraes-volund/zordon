export type StepDef = {
  index: number;
  key: string;
  title: string;
  description: string;
};

export const STEP_CATALOG: Record<string, Omit<StepDef, "index">> = {
  pre_work: { key: "pre_work", title: "Vitor", description: "Conversa inicial com Vitor para mapear o produto e propor um ponto de partida" },
  product_vision: { key: "product_vision", title: "Visão", description: "Por que existe? Qual problema resolve? Como é o sucesso?" },
  scope_definition: { key: "scope_definition", title: "Escopo do Produto", description: "Alinhar identidade e fronteiras do produto (é / não é / faz / não faz) antes de explorar personas" },
  personas_journeys: { key: "personas_journeys", title: "Personas", description: "Quem sofre com o problema? Como vive hoje? Como será com a solução?" },
  brainstorm: { key: "brainstorm", title: "Brainstorm", description: "Ideias sem filtro — cards de funcionalidades com contexto" },
  risks_gaps: { key: "risks_gaps", title: "Riscos", description: "O que pode dar errado e o que ainda não está claro nas regras de negócio" },
  prioritization: { key: "prioritization", title: "Priorização", description: "MVP / Next / Out — o que entra agora?" },
  technical_specs: { key: "technical_specs", title: "Especificações", description: "Stack, integrações, regras técnicas e restrições" },
  hypotheses: { key: "hypotheses", title: "Métricas", description: "O que precisamos validar? Indicadores, metas e evidências" },
  briefing: { key: "briefing", title: "Briefing", description: "Resumo consolidado + geração de tasks" },
  retrospective: { key: "retrospective", title: "Retrospectiva", description: "O que foi entregue + feedback" },
  new_demands: { key: "new_demands", title: "Novas Demandas", description: "Features, bugs, melhorias" },
  refinement: { key: "refinement", title: "Refinamento Técnico", description: "Dúvidas e dependências" },
};

export const ALWAYS_FIRST = "pre_work";
export const ALWAYS_LAST = "briefing";

/** Steps opcionais que aparecem como checkbox no modal de criacao de Super Session. */
export const SUPER_OPTIONAL_STEPS = [
  "product_vision",
  "scope_definition",
  "personas_journeys",
  "brainstorm",
  "risks_gaps",
  "prioritization",
  "hypotheses",
  "technical_specs",
];

const INCEPTION_KEYS = [
  "pre_work",
  "product_vision",
  "scope_definition",
  "personas_journeys",
  "brainstorm",
  "risks_gaps",
  "prioritization",
  "technical_specs",
  "hypotheses",
  "briefing",
];

const CI_KEYS = [
  "retrospective",
  "new_demands",
  "prioritization",
  "refinement",
  "briefing",
];

function buildSteps(keys: string[]): StepDef[] {
  return keys.map((key, index) => {
    const def = STEP_CATALOG[key];
    if (!def) throw new Error(`Step desconhecido no catalogo: ${key}`);
    return { index, ...def };
  });
}

export const INCEPTION_STEPS: StepDef[] = buildSteps(INCEPTION_KEYS);
export const CI_STEPS: StepDef[] = buildSteps(CI_KEYS);

export function getSteps(type: string): StepDef[] {
  return type === "inception" ? INCEPTION_STEPS : CI_STEPS;
}

/**
 * Recebe lista arbitraria de step keys e retorna StepDef[] ordenado.
 * Forca ALWAYS_FIRST no inicio e ALWAYS_LAST no fim. Remove duplicadas
 * preservando a primeira ocorrencia. Ignora keys desconhecidas.
 */
export function getStepsFromKeys(keys: string[]): StepDef[] {
  const seen = new Set<string>();
  const middle: string[] = [];
  for (const k of keys) {
    if (seen.has(k)) continue;
    if (k === ALWAYS_FIRST || k === ALWAYS_LAST) continue;
    if (!STEP_CATALOG[k]) continue;
    seen.add(k);
    middle.push(k);
  }
  const ordered = [ALWAYS_FIRST, ...middle, ALWAYS_LAST];
  return buildSteps(ordered);
}

/**
 * Entry point unico: dado um session record, devolve os steps a renderizar.
 * Sessoes "super" usam selectedSteps; demais tipos seguem o preset.
 */
export function getStepsForSession(session: {
  type: string;
  selectedSteps?: string[] | null;
}): StepDef[] {
  if (session.type === "super" && session.selectedSteps && session.selectedSteps.length > 0) {
    return getStepsFromKeys(session.selectedSteps);
  }
  return getSteps(session.type);
}

export type ValidateSuperResult =
  | { ok: true; normalized: string[] }
  | { ok: false; error: string };

/**
 * Valida e normaliza step keys vindos do modal/API de Super Session.
 * - Garante que todas as keys existem no catalogo
 * - Remove duplicadas
 * - Forca ALWAYS_FIRST no inicio e ALWAYS_LAST no fim
 */
export function validateSuperSteps(keys: unknown): ValidateSuperResult {
  if (!Array.isArray(keys)) {
    return { ok: false, error: "selectedSteps deve ser array de strings" };
  }
  const seen = new Set<string>();
  const middle: string[] = [];
  for (const raw of keys) {
    if (typeof raw !== "string") {
      return { ok: false, error: "selectedSteps deve conter apenas strings" };
    }
    if (raw === ALWAYS_FIRST || raw === ALWAYS_LAST) continue;
    if (!STEP_CATALOG[raw]) {
      return { ok: false, error: `Step desconhecido: ${raw}` };
    }
    if (seen.has(raw)) continue;
    seen.add(raw);
    middle.push(raw);
  }
  return { ok: true, normalized: [ALWAYS_FIRST, ...middle, ALWAYS_LAST] };
}
