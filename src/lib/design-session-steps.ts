export type StepDef = {
  index: number;
  key: string;
  title: string;
  description: string;
};

export const STEP_CATALOG: Record<string, Omit<StepDef, "index">> = {
  pre_work: { key: "pre_work", title: "Pre-Trabalho", description: "Upload de documentos e pre-preenchimento com IA" },
  product_vision: { key: "product_vision", title: "Visao do Produto", description: "Por que existe? Qual problema resolve? Como e o sucesso?" },
  scope_definition: { key: "scope_definition", title: "E / Nao E / Faz / Nao Faz", description: "Alinhar identidade e fronteiras do produto antes de explorar personas" },
  personas_journeys: { key: "personas_journeys", title: "Personas & Jornadas", description: "Quem sofre com o problema? Como vive hoje? Como sera com a solucao?" },
  brainstorm: { key: "brainstorm", title: "Brainstorm de Funcionalidades", description: "Ideias sem filtro — cards de funcionalidades com contexto" },
  risks_gaps: { key: "risks_gaps", title: "Riscos & Lacunas", description: "O que pode dar errado e o que ainda nao esta claro nas regras de negocio" },
  prioritization: { key: "prioritization", title: "Priorizacao & Escopo", description: "MVP / Next / Out — o que entra agora?" },
  technical_specs: { key: "technical_specs", title: "Especificacoes Tecnicas", description: "Stack, integracoes, regras tecnicas e restricoes" },
  hypotheses: { key: "hypotheses", title: "Hipoteses & Metricas", description: "O que precisamos validar? Indicadores, metas e evidencias" },
  briefing: { key: "briefing", title: "Briefing", description: "Resumo consolidado + geracao de tasks" },
  retrospective: { key: "retrospective", title: "Retrospectiva", description: "O que foi entregue + feedback" },
  new_demands: { key: "new_demands", title: "Novas Demandas", description: "Features, bugs, melhorias" },
  refinement: { key: "refinement", title: "Refinamento Tecnico", description: "Duvidas e dependencias" },
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
