/**
 * QAL-002 — Template do PRD-000 "Setup & Stack" (a fundação do projeto).
 *
 * Toda discovery via Quick-Ask Launcher produz, como raiz do DAG, um PRD de
 * setup + stack que estabelece o terreno (scaffold, stack, auth base, RLS,
 * migration inicial, CI) que todas as features assumem como pré-requisito.
 *
 * `buildSetupStackPrd()` devolve o CONTEÚDO do PRD — exatamente o shape que a
 * tool `propose_prd` aceita (ProposePrdInput sem projectId/designSessionId, que
 * são injetados do contexto da sessão). Stack-da-casa por default (Next +
 * Supabase); `overrides` troca a stack quando o projeto pede (D8).
 *
 * "Raiz do DAG" é por construção: ProposePrdInput não carrega arestas de
 * dependência — quem cria os links é a tool `link_prd_dependency`. O PRD-000
 * nunca recebe link de saída; as features apontam PRA ele.
 */

import { z } from "zod";
import { ProposePrdInput } from "./prd-schemas";

/** Conteúdo do PRD = ProposePrdInput sem os ids de contexto (injetados pela tool). */
export const SetupStackPrdContentSchema = ProposePrdInput.omit({
  projectId: true,
  designSessionId: true,
});

export type SetupStackPrdContent = z.infer<typeof SetupStackPrdContentSchema>;

/** Overrides da stack-da-casa. Vazio = default Next + Supabase. */
export type StackOverrides = {
  /** Framework de aplicação. Default: "Next.js (App Router)". */
  framework?: string;
  /** Banco + backend. Default: "Supabase (Postgres)". */
  database?: string;
  /** Camada de auth. Default: "Supabase Auth (magic link, invite-only)". */
  auth?: string;
  /** Pipeline de CI/deploy. Default: "Cloud Build". */
  ci?: string;
};

const HOUSE_STACK: Required<StackOverrides> = {
  framework: "Next.js (App Router)",
  database: "Supabase (Postgres)",
  auth: "Supabase Auth (magic link, invite-only)",
  ci: "Cloud Build",
};

/**
 * Monta o conteúdo do PRD-000 Setup & Stack.
 * @param overrides troca campos da stack-da-casa (D8).
 */
export function buildSetupStackPrd(
  overrides: StackOverrides = {},
): SetupStackPrdContent {
  const stack = { ...HOUSE_STACK, ...overrides };

  return {
    title: "Setup & Stack — Fundação do Projeto",
    oneLiner: `Scaffold ${stack.framework} + ${stack.database} com auth base, RLS, CI e migration inicial — o terreno que toda feature depende.`,
    problem:
      "Antes de qualquer feature, o projeto precisa de terreno: scaffold do app, " +
      "stack definida, autenticação base, schema inicial com RLS e pipeline de CI. " +
      "Sem essa fundação, a Forja tropeça na primeira story — inventa decisão de " +
      "stack, não tem onde rodar migration e o build quebra. Este PRD estabelece a " +
      "raiz que todos os outros PRDs assumem como pré-requisito.",
    goal:
      `Entregar um repositório executável com ${stack.framework} + ${stack.database} ` +
      "configurados, auth base funcionando, migration inicial aplicada e CI verde — " +
      "pronto pra receber as features.",
    personaIds: [],
    userJourney: [],
    acceptanceCriteria: [
      {
        given: "um repositório recém-clonado",
        when: "rodar o setup do projeto",
        then: `a aplicação ${stack.framework} sobe localmente sem erro`,
      },
      {
        given: "a stack-da-casa configurada",
        when: "inspecionar dependências e config",
        then: `${stack.database} está integrado com client SSR e RLS habilitada nas tabelas iniciais`,
      },
      {
        given: `${stack.auth} configurado`,
        when: "um usuário autentica",
        then: "a sessão é estabelecida e rotas protegidas respeitam o access_level",
      },
      {
        given: `o pipeline de ${stack.ci}`,
        when: "abrir um PR",
        then: "build + typecheck rodam e ficam verdes",
      },
    ],
    successMetrics: [],
    outOfScope: [
      "Features de produto — cada uma é coberta por seu próprio PRD",
      "Otimizações avançadas de performance/infra",
      "Conteúdo de seed além do mínimo pra rodar",
    ],
    technicalNotes:
      `Stack-da-casa: ${stack.framework}, ${stack.database}, ${stack.auth}, CI via ${stack.ci}. ` +
      "Migration inicial cria o schema base com RLS por tabela. Auth resolve access_level por rota. " +
      "Este é o PRD-000: raiz do DAG, sem dependências de saída; todas as features dependem dele.",
    risksAndAssumptions: [],
    sourceCardIds: [],
  };
}
