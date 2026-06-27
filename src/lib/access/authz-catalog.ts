/**
 * Catálogo de AUTORIZAÇÃO — SSOT da regra de cada capability gateada.
 *
 * Por que existe: hoje a regra de "quem pode" está duplicada em dezenas de
 * helpers `canX` (src/lib/dal.ts) que repetem a MESMA estrutura
 * (manager bypass → role no projeto → grant → exclui guest), e diverge da RLS.
 * Aqui a regra vira DADO declarado UMA vez; o resolver único
 * (require-capability.ts) interpreta. Espelho SQL é gerado deste catálogo
 * (não escrito à mão) — mata a classe de bug "mudei o TS e esqueci o SQL".
 *
 * Princípios (docs/platform/authz-remediation-plan.md §0):
 *   P2 — manager (PM) é operador GLOBAL → managerBypass default true.
 *   P3 — ProjectAccess.role só gradua NÃO-managers → projectMin.
 *   P4 — MemberAccessGrant é override pontual → grantKey.
 *
 * Adicionar uma capability nova = UMA entrada aqui + chamar
 * `requireCapabilityApi(key, { projectId })` na rota. Nada mais.
 */
import type { AccessLevel, ProjectAccessRole } from "@/lib/roles";

export type AuthzRule = {
  /**
   * Manager/admin global passa direto. Default `true` (P2).
   * `false` = nem manager passa (ex.: ação admin-only como deletar projeto).
   */
  managerBypass?: boolean;
  /**
   * Piso de access_level GLOBAL que passa sem caminho de projeto.
   * Ex.: `"admin"` para ações admin-only (combinar com managerBypass:false).
   */
  globalMin?: AccessLevel;
  /**
   * Não-manager precisa de `ProjectAccess.role >= projectMin` NESTE projeto.
   * Só faz sentido com `opts.projectId`.
   */
  projectMin?: ProjectAccessRole;
  /** Grant ativo (MemberAccessGrant) desta capability passa (override pontual). */
  grantKey?: string;
  /** Guest nunca passa, mesmo com ProjectAccess (ex.: editar/mudar visibility de DS). */
  denyGuest?: boolean;
  /** Doc curta da intenção — aparece no app Acessos e no diagnóstico. */
  intent: string;
};

/** Ordem de poder das roles por-projeto (para comparação `>=`). */
export const PROJECT_ROLE_RANK: Record<ProjectAccessRole, number> = {
  viewer: 0,
  session_participant: 1,
  contributor: 2,
  lead: 3,
};

/**
 * O catálogo. Chaves no formato `<domínio>.<ação>`.
 * NB: capabilities grant-áveis (prefixos "app." e "ritual.") reusam as
 * chaves de src/lib/access/capabilities.ts.
 *
 * ⚠️ Valores marcados `[D2]` dependem da decisão D2 (admin-only vs manager+).
 * Default aplicado = recomendação do plano (admin-only para criar/deletar base).
 */
export const AUTHZ_CATALOG = {
  // ─── Project (entidade base) ─────────────────────────────────────────────
  "project.view": {
    managerBypass: true,
    projectMin: "viewer",
    grantKey: "__any_project_grant__", // qualquer grant project-scoped destrava view (ver resolver)
    intent: "Ver um projeto (manager, qualquer ProjectAccess, ou grant).",
  },
  "project.create": {
    managerBypass: false, // [D2] rec.: admin-only
    globalMin: "admin",
    intent: "Criar um projeto — admin-only (rec. D2).",
  },
  "project.edit": {
    managerBypass: false, // [D2 fechada] admin é dono da ESTRUTURA do projeto
    globalMin: "admin",
    intent:
      "Editar metadados do projeto (name/status/datas/pmId/repo…) — admin-only. " +
      "Operar DENTRO do projeto (tasks/planning/PM review) é manager+, capabilities próprias.",
  },
  "project.delete": {
    managerBypass: false, // [D2] rec.: admin-only — DELETE em cascata é destrutivo
    globalMin: "admin",
    intent: "Deletar um projeto (cascata) — admin-only (rec. D2).",
  },

  // ─── Sprint (lifecycle) ──────────────────────────────────────────────────
  "sprint.view": {
    managerBypass: true,
    projectMin: "viewer",
    intent: "Ver sprints de um projeto.",
  },
  "sprint.write": {
    managerBypass: true,
    projectMin: "contributor",
    intent:
      "Criar/editar/concluir/reabrir/ativar/deploy/retro de sprint — manager ou contributor+ (time do projeto).",
  },
  "sprint.delete": {
    managerBypass: true, // manager-only: deletar sprint é destrutivo (preserva regra atual)
    intent: "Deletar sprint — manager+ (destrutivo).",
  },

  // ─── Task ────────────────────────────────────────────────────────────────
  "task.edit": {
    managerBypass: true,
    projectMin: "contributor",
    intent: "Editar tasks do projeto.",
  },
  "task.comment": {
    managerBypass: true,
    projectMin: "viewer", // qualquer ProjectAccess comenta (incl. guest/viewer)
    intent: "Comentar em tasks — qualquer ProjectAccess.",
  },

  // ─── Design Session ──────────────────────────────────────────────────────
  "session.view": {
    managerBypass: true,
    projectMin: "viewer",
    grantKey: "__any_project_grant__",
    intent: "Ver uma Design Session (visibility tratada em guard de recurso).",
  },
  "session.edit": {
    managerBypass: true,
    projectMin: "contributor",
    denyGuest: true,
    intent: "Editar/exportar/mudar visibility de DS — manager ou contributor+, nunca guest.",
  },

  // ─── Squad ───────────────────────────────────────────────────────────────
  "squad.view": {
    managerBypass: true,
    globalMin: "manager",
    intent: "Ver estrutura de squads — manager+ (estrutura organizacional).",
  },
  "squad.write": {
    managerBypass: false, // [D2] rec.: admin-only
    globalMin: "admin",
    intent: "Criar/editar/deletar squad — admin-only (rec. D2).",
  },

  // ─── Member ──────────────────────────────────────────────────────────────
  "member.write": {
    managerBypass: true,
    globalMin: "manager",
    intent: "Criar/editar/deletar/alocar membro — manager+.",
  },

  // ─── Opportunity ─────────────────────────────────────────────────────────
  "opportunity.write": {
    managerBypass: true,
    globalMin: "manager",
    intent: "CRUD + Promote→Project de oportunidade — manager+.",
  },

  // ─── PM Review (ritual) ──────────────────────────────────────────────────
  "pm_review.write": {
    managerBypass: true, // FIX do bug âncora: qualquer PM (manager) cria/edita
    grantKey: "ritual.pm_review",
    intent: "Criar/editar PM Review — manager (qualquer PM) ou grant ritual.pm_review.",
  },

  // ─── Planning (ritual) ───────────────────────────────────────────────────
  "ritual.planning": {
    managerBypass: true,
    projectMin: "contributor",
    grantKey: "ritual.planning",
    intent: "Operar o Planning — manager, contributor+, ou grant ritual.planning.",
  },

  // ─── Grant management (app Acessos) ──────────────────────────────────────
  "access_grant.manage": {
    managerBypass: false,
    globalMin: "admin",
    intent: "Conceder/revogar MemberAccessGrant — admin-only.",
  },

  // ─── Task / Story (conteúdo do projeto, contributor+) ────────────────────
  "task.view": {
    managerBypass: true,
    projectMin: "viewer",
    intent: "Ver tasks do projeto.",
  },
  "story.edit": {
    managerBypass: true,
    projectMin: "contributor",
    intent: "Criar/editar/promover user stories e módulos — contributor+.",
  },
  "story.view": {
    managerBypass: true,
    projectMin: "viewer",
    intent: "Ver stories/módulos do projeto.",
  },

  // ─── Project: conteúdo (contributor+) vs configuração (manager+) ──────────
  "project.content_edit": {
    managerBypass: true,
    projectMin: "contributor",
    intent: "Editar conteúdo do projeto (modules/personas/scope/tags) — contributor+.",
  },
  "project.configure": {
    managerBypass: true,
    globalMin: "manager",
    intent:
      "Configurar projeto (repo/dod/drive/granola/ritual-playbook/design-system/sprints-gen/wiki) — manager+ (operação de PM).",
  },
  "project.manage_access": {
    managerBypass: true,
    globalMin: "manager",
    intent: "Gerir ProjectAccess (quem entra no projeto) — manager+.",
  },

  // ─── Meeting / Planning Session (project-scoped) ──────────────────────────
  "meeting.view": {
    managerBypass: true,
    projectMin: "viewer",
    intent: "Ver reuniões/cerimônias do projeto.",
  },
  "meeting.edit": {
    managerBypass: true,
    projectMin: "contributor",
    intent: "Criar/editar reunião/cerimônia (daily/planning/pm_review) — contributor+.",
  },
  "planning_session.operate": {
    managerBypass: true,
    globalMin: "manager",
    grantKey: "ritual.planning",
    intent: "Operar Planning Session (ordena PRDs/roadmap) — manager+ ou grant.",
  },

  // ─── PM Review (leitura) ──────────────────────────────────────────────────
  "pm_review.view": {
    managerBypass: true,
    projectMin: "viewer",
    grantKey: "ritual.pm_review",
    intent: "Ver PM Review — quem vê o projeto, ou grant ritual.pm_review.",
  },

  // ─── Member / Org (manager+) ──────────────────────────────────────────────
  "member.view": {
    managerBypass: true,
    globalMin: "manager",
    intent: "Ver dados de membros/org — manager+.",
  },
  "client.write": {
    managerBypass: true,
    globalMin: "manager",
    intent: "Criar/editar cliente — manager+.",
  },
  "prd.write": {
    managerBypass: true,
    globalMin: "manager",
    intent: "Criar/editar PRD (ProductRequirement) — manager+.",
  },

  // ─── Apps gated por grant (admin OU grant do app) ─────────────────────────
  "finance.access": {
    managerBypass: false,
    globalMin: "admin",
    grantKey: "app.finance",
    intent: "App Finanças (S&OP): ler/editar — admin-only OU grant app.finance.",
  },
  "finance.admin": {
    managerBypass: false,
    globalMin: "admin",
    intent:
      "Operações DESTRUTIVAS em Finanças (DELETE contrato/NF/vaga/entry/clause) — admin-only (decisão 2026-06-27, grant NÃO basta).",
  },
  "ferias.manage": {
    managerBypass: false,
    globalMin: "admin",
    grantKey: "app.ferias",
    intent:
      "Gerir Férias & Folgas — admin OU grant app.ferias. NB: rotas de aprovação podem precisar de check por-squad (can_manage_member_in_squad) — não cobertas por esta regra.",
  },
  "forge.operate": {
    managerBypass: true,
    globalMin: "manager",
    grantKey: "app.forge",
    intent: "Operar Forge (jobs/runs) — manager+ ou grant app.forge.",
  },
  "context_source.write": {
    managerBypass: true,
    globalMin: "manager",
    intent: "Gerir context sources (alimentam agentes/Wiki) — manager+.",
  },
} satisfies Record<string, AuthzRule>;

export type CapabilityKey = keyof typeof AUTHZ_CATALOG;

export function getRule(capability: string): AuthzRule | undefined {
  return (AUTHZ_CATALOG as Record<string, AuthzRule>)[capability];
}
