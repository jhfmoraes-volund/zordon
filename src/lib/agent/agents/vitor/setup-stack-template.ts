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
    // §16 — stories implementáveis do setup (raiz do DAG; tudo depende delas).
    stories: [
      {
        id: "SETUP-001",
        title: `Scaffold ${stack.framework} + Tailwind + env`,
        description:
          "Inicializa o projeto com TypeScript strict, Tailwind e .env.example com as chaves obrigatórias.",
        acceptanceCriteria: [
          "Projeto builda sem erro",
          ".env.example lista as chaves obrigatórias da stack",
        ],
        verifiable: [
          { kind: "lint", command_or_query: "npm run build", expected: "exit 0" },
        ],
        dependsOn: [],
        agentProfile: "wiring",
        estimateMinutes: 30,
        touches: ["package.json", "tsconfig.json"],
      },
      {
        id: "SETUP-002",
        title: `Client ${stack.database} (server + browser) + sessão`,
        description:
          "Configura o client SSR (server + browser) e o helper de sessão que os guards usam.",
        acceptanceCriteria: [
          "Clients server e browser exportados",
          "Helper de sessão resolve usuário/acesso",
        ],
        verifiable: [
          { kind: "typecheck", command_or_query: "npx tsc --noEmit", expected: "exit 0" },
        ],
        dependsOn: ["SETUP-001"],
        agentProfile: "wiring",
        estimateMinutes: 25,
        touches: ["src/lib/supabase/", "src/lib/auth/"],
      },
      {
        id: "SETUP-003",
        title: "Migration inicial + RLS por tabela",
        description:
          "Cria o schema base com RLS habilitado em cada tabela inicial e regenera os types.",
        acceptanceCriteria: [
          "Migration inicial aplica sem erro via psql",
          "RLS habilitado nas tabelas iniciais",
        ],
        verifiable: [
          {
            kind: "sql",
            command_or_query:
              "SELECT bool_and(relrowsecurity) FROM pg_class WHERE relkind='r' AND relnamespace='public'::regnamespace",
            expected: "t",
          },
        ],
        dependsOn: ["SETUP-002"],
        agentProfile: "db",
        estimateMinutes: 30,
        touches: ["supabase/migrations/", "src/lib/supabase/database.types.ts"],
      },
      {
        id: "SETUP-004",
        title: `Auth base — ${stack.auth} + access_level por rota`,
        description:
          "Liga a autenticação base e o middleware que resolve access_level por rota.",
        acceptanceCriteria: [
          "Usuário autentica e a sessão é estabelecida",
          "Rotas protegidas respeitam access_level",
        ],
        verifiable: [
          { kind: "typecheck", command_or_query: "npx tsc --noEmit", expected: "exit 0" },
        ],
        dependsOn: ["SETUP-002"],
        agentProfile: "api",
        estimateMinutes: 30,
        touches: ["src/proxy.ts", "src/lib/auth/"],
      },
      {
        id: "SETUP-005",
        title: `CI verde via ${stack.ci}`,
        description: "Pipeline que roda build + typecheck em cada PR e fica verde.",
        acceptanceCriteria: [
          "build + typecheck rodam no CI",
          "Pipeline verde no PR base",
        ],
        verifiable: [
          {
            kind: "lint",
            command_or_query: "npm run build && npx tsc --noEmit",
            expected: "exit 0",
          },
        ],
        dependsOn: ["SETUP-001"],
        agentProfile: "test",
        estimateMinutes: 25,
        touches: ["cloudbuild.yaml", ".github/"],
      },
    ],
  };
}
