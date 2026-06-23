// Mock initial state for the /dev/stories sandbox.
// When migrating to the real screen, this file goes away — replace with
// fetched data from Supabase keyed by `Project.id`.

import type {
  Member,
  Module,
  Persona,
  ProjectContext,
  Story,
  Task,
} from "@/components/story-hierarchy";
import type {
  Sprint,
  SprintMemberCapacity,
} from "@/components/sprint";

// ─── Project ────────────────────────────────────────────────────────────────

export const PROJECT: ProjectContext & { client: string; status: "active" } = {
  name: "CRM",
  client: "Volund — interno",
  referenceKey: "CRM",
  status: "active",
  definitionOfDone: [
    "Tem teste E2E ou unitário cobrindo o caminho feliz",
    "PR review aprovado por 1 builder + 1 PM",
    "Deploy em staging validado com smoke test",
    "Documentação atualizada se a mudança é pública",
  ],
};

// ─── Personas + Modules + Members ──────────────────────────────────────────

export const PERSONAS_INITIAL: Persona[] = [
  { id: "p-builder", name: "Builder", description: "Membro do time que executa tasks" },
  { id: "p-pm",      name: "PM",      description: "Gestor do projeto, define prioridades" },
  { id: "p-client",  name: "Cliente", description: "Stakeholder externo / usuário final" },
];

export const MODULES_INITIAL: Module[] = [
  { id: "m-login",     name: "LOGIN",     description: "Autenticação, sessão e magic-link" },
  { id: "m-billing",   name: "BILLING",   description: "Cobrança, planos e faturas" },
  { id: "m-dashboard", name: "DASHBOARD", description: "Visão geral e indicadores do cliente" },
];

export const MEMBERS: Member[] = [
  { id: "mb-lucas",   name: "Lucas",   role: "builder" },
  { id: "mb-camila",  name: "Camila",  role: "builder" },
  { id: "mb-rafael",  name: "Rafael",  role: "builder" },
  { id: "mb-joao",    name: "João",    role: "pm"      },
];

// ─── Sprints ─────────────────────────────────────────────────────────────────
//
// Today (system date in CLAUDE.md): 2026-04-30.
// Cenário: 3 sprints, time no meio do cronograma e perto do FIM do sprint atual.
//
//   Sprint 7 (completed)  · 2026-04-15 → 2026-04-21  · 100% done · deployed
//   Sprint 8 (active)     · 2026-04-25 → 2026-05-01  · dia 6/7 · ~65% done
//   Sprint 9 (planning)   · 2026-05-06 → 2026-05-12  · backlog populado

export const SPRINTS_INITIAL: Sprint[] = [
  {
    id: "spr-7",
    name: "Sprint 7",
    startDate: "2026-04-15",
    endDate: "2026-04-21",
    status: "completed",
    deployedToStagingAt: "2026-04-21T18:30:00Z",
    deployedToProductionAt: "2026-04-22T10:15:00Z",
  },
  {
    id: "spr-8",
    name: "Sprint 8",
    startDate: "2026-04-25",
    endDate: "2026-05-01",
    status: "active",
    deployedToStagingAt: "2026-04-29T14:00:00Z",
    deployedToProductionAt: null,
  },
  {
    id: "spr-9",
    name: "Sprint 9",
    startDate: "2026-05-06",
    endDate: "2026-05-12",
    status: "upcoming",
    deployedToStagingAt: null,
    deployedToProductionAt: null,
  },
];

export const SPRINT_CAPACITIES: SprintMemberCapacity[] = [
  // Sprint 7 — completed
  { sprintId: "spr-7", memberId: "mb-lucas",  fpCapacity: 30, fpAllocation: 10 },
  { sprintId: "spr-7", memberId: "mb-camila", fpCapacity: 25, fpAllocation: 5  },
  { sprintId: "spr-7", memberId: "mb-rafael", fpCapacity: 20, fpAllocation: 2  },
  // Sprint 8 — active, perto do fim
  { sprintId: "spr-8", memberId: "mb-lucas",  fpCapacity: 30, fpAllocation: 18 },
  { sprintId: "spr-8", memberId: "mb-camila", fpCapacity: 25, fpAllocation: 12 },
  { sprintId: "spr-8", memberId: "mb-rafael", fpCapacity: 20, fpAllocation: 3  },
  // Sprint 9 — planning
  { sprintId: "spr-9", memberId: "mb-lucas",  fpCapacity: 30, fpAllocation: 8  },
  { sprintId: "spr-9", memberId: "mb-camila", fpCapacity: 25, fpAllocation: 5  },
  { sprintId: "spr-9", memberId: "mb-rafael", fpCapacity: 20, fpAllocation: 0  },
];

// ─── Stories ─────────────────────────────────────────────────────────────────

export const STORIES_INITIAL: Story[] = [
  // Sprint 8 (active) — em curso
  {
    reference: "CRM-US-014",
    moduleId: "m-login",
    title: "Magic-link com expiração curta",
    personaId: "p-builder",
    want: "receber link de login que expira em 10 min",
    soThat: "sessões antigas não possam ser exploradas se o email vazar",
    refinementStatus: "committed",
    acValidatedAt: null,
    acValidatedBy: null,
    acceptanceCriteria: [
      { id: "ac-014-1", text: "Link expira em 10 minutos após enviado",          checked: true,  checkedBy: "Camila" },
      { id: "ac-014-2", text: "Email mostra horário de expiração no corpo",     checked: true,  checkedBy: "Camila" },
      { id: "ac-014-3", text: "Reuso de link expirado retorna mensagem clara",  checked: true,  checkedBy: "Lucas"  },
      { id: "ac-014-4", text: "Tentativa expirada gera log estruturado",        checked: false },
    ],
    designSessionRef: "DS-09 / item 3",
    createdByAgent: true,
  },
  // Sprint 7 (completed) — done + AC validado
  {
    reference: "CRM-US-015",
    moduleId: "m-login",
    title: "Logout em todos os dispositivos",
    personaId: "p-client",
    want: "encerrar todas as sessões ativas em um clique",
    soThat: "consigo reagir rápido se desconfio de acesso indevido",
    refinementStatus: "committed",
    acValidatedAt: "2026-04-21 17:10",
    acValidatedBy: "João (PM)",
    acceptanceCriteria: [
      { id: "ac-015-1", text: "Botão 'Sair de todos os dispositivos' em Conta",     checked: true, checkedBy: "Lucas" },
      { id: "ac-015-2", text: "Tokens de outras sessões expiram em até 30s",        checked: true, checkedBy: "Lucas" },
      { id: "ac-015-3", text: "Email de notificação enviado após logout massivo",  checked: true, checkedBy: "Lucas" },
    ],
    designSessionRef: "DS-09 / item 5",
    createdByAgent: true,
  },
  // Sprint 7 (completed) — done + AC validado
  {
    reference: "CRM-US-021",
    moduleId: "m-billing",
    title: "Geração de fatura mensal automática",
    personaId: "p-pm",
    want: "que o sistema gere a fatura no dia 1 de cada mês",
    soThat: "eu não precise lembrar de gerar manualmente para cada cliente",
    refinementStatus: "committed",
    acValidatedAt: "2026-04-21 19:42",
    acValidatedBy: "João (PM)",
    acceptanceCriteria: [
      { id: "ac-021-1", text: "Cron roda no dia 1 às 03h America/Sao_Paulo",   checked: true, checkedBy: "Lucas"  },
      { id: "ac-021-2", text: "Fatura inclui itens do mês anterior",           checked: true, checkedBy: "Lucas"  },
      { id: "ac-021-3", text: "Falha do cron gera alerta no canal #ops",       checked: true, checkedBy: "Rafael" },
    ],
    designSessionRef: "DS-11 / item 1",
    createdByAgent: true,
  },
  // Sprint 8 (active) — em curso, AC parcial
  {
    reference: "CRM-US-024",
    moduleId: "m-billing",
    title: "Cobrança por uso adicional de seats",
    personaId: "p-client",
    want: "ver no checkout o custo adicional dos seats acima do plano",
    soThat: "eu saiba o valor antes de confirmar o aumento",
    refinementStatus: "committed",
    acValidatedAt: null,
    acValidatedBy: null,
    acceptanceCriteria: [
      { id: "ac-024-1", text: "Preview do cálculo aparece em tempo real ao mudar quantidade", checked: true,  checkedBy: "Lucas" },
      { id: "ac-024-2", text: "Tooltip explica regra de pro-rata se mid-cycle",               checked: false },
    ],
    designSessionRef: "DS-11 / item 4",
    createdByAgent: true,
  },
  // Sprint 9 (planning) — quebrada em tasks, mas backlog
  {
    reference: "CRM-US-027",
    moduleId: "m-dashboard",
    title: "Filtro de período no dashboard",
    personaId: "p-client",
    want: "filtrar métricas por mês, trimestre ou ano",
    soThat: null,
    refinementStatus: "committed",
    acValidatedAt: null,
    acValidatedBy: null,
    acceptanceCriteria: [
      { id: "ac-027-1", text: "Seletor com 3 presets (mês/tri/ano) + custom range", checked: false },
      { id: "ac-027-2", text: "Filtro persiste na URL (compartilhável)",            checked: false },
    ],
    designSessionRef: "DS-12 / item 2",
    createdByAgent: true,
  },
  // Inbox (sem módulo) — draft, sem tasks
  {
    reference: "CRM-US-029",
    moduleId: null,
    proposedModuleName: "AUDIT_LOG",
    title: "Auditoria de eventos críticos",
    personaId: "p-pm",
    want: "ver quem fez o quê em ações sensíveis (delete, role change)",
    soThat: "eu consiga rastrear incidentes de segurança",
    refinementStatus: "draft",
    acValidatedAt: null,
    acValidatedBy: null,
    acceptanceCriteria: [
      { id: "ac-029-1", text: "Tabela append-only com actor, action, target, timestamp", checked: false },
      { id: "ac-029-2", text: "Tela /audit lista últimos 30 dias com filtros básicos",   checked: false },
    ],
    designSessionRef: "DS-13 / item 4",
    createdByAgent: true,
  },
  // Sprint 9 (planning) — committed, tasks em backlog
  {
    reference: "CRM-US-031",
    moduleId: "m-login",
    title: "Suporte a 2FA via TOTP",
    personaId: "p-builder",
    want: "ativar segundo fator (app autenticador) na minha conta",
    soThat: "ter camada extra de segurança em contas administrativas",
    refinementStatus: "committed",
    acValidatedAt: null,
    acValidatedBy: null,
    acceptanceCriteria: [
      { id: "ac-031-1", text: "Setup gera QR code escaneável",                       checked: false },
      { id: "ac-031-2", text: "Login pede código TOTP quando 2FA ativo",             checked: false },
      { id: "ac-031-3", text: "Recovery code é gerado e exibido 1 vez no setup",    checked: false },
    ],
    designSessionRef: "DS-14 / item 1",
    createdByAgent: true,
  },
];

// ─── Tasks ───────────────────────────────────────────────────────────────────
//
// Sprint 7 (spr-7) — todas done   · 17 FP done / 17 total
// Sprint 8 (spr-8) — em curso     · 15 FP done / 23 total · 65%
//   - 4 done, 1 review, 1 in_progress
// Sprint 9 (spr-9) — todas backlog · 0 done / 21 total

export const TASKS_INITIAL: Task[] = [
  // ━━━ Sprint 7 (completed) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  // CRM-US-015 — logout all devices
  {
    reference: "TSK-088",
    userStoryRef: "CRM-US-015",
    sprintId: "spr-7",
    title: "Endpoint /auth/sessions/revoke-all",
    status: "done",
    doneAt: "2026-04-16T15:00:00Z",
    type: "feature",
    scope: "micro",
    complexity: "medium",
    tags: [],
    functionPoints: 3,
    billable: true,
    assigneeIds: ["mb-lucas"],
    acceptanceCriteria: [
      { id: "tac-088-1", text: "Revoga todos os refresh tokens do user",  checked: true, checkedBy: "Lucas" },
      { id: "tac-088-2", text: "Idempotente (rerun não falha)",             checked: true, checkedBy: "Lucas" },
    ],
    createdByAgent: true,
  },
  {
    reference: "TSK-089",
    userStoryRef: "CRM-US-015",
    sprintId: "spr-7",
    title: "Botão na tela Conta + confirmação",
    status: "done",
    doneAt: "2026-04-18T11:00:00Z",
    type: "component",
    scope: "micro",
    complexity: "low",
    tags: [],
    functionPoints: 2,
    billable: true,
    assigneeIds: ["mb-camila"],
    acceptanceCriteria: [
      { id: "tac-089-1", text: "Modal de confirmação obrigatório", checked: true, checkedBy: "Camila" },
    ],
    createdByAgent: true,
  },
  {
    reference: "TSK-090",
    userStoryRef: "CRM-US-015",
    sprintId: "spr-7",
    title: "Email transacional de notificação",
    status: "done",
    doneAt: "2026-04-17T17:30:00Z",
    type: "feature",
    scope: "micro",
    complexity: "low",
    tags: [],
    functionPoints: 2,
    billable: true,
    assigneeIds: ["mb-lucas"],
    acceptanceCriteria: [
      { id: "tac-090-1", text: "Subject claro: 'Suas sessões foram encerradas'", checked: true, checkedBy: "Lucas" },
    ],
    createdByAgent: true,
  },

  // CRM-US-021 — fatura mensal
  {
    reference: "TSK-094",
    userStoryRef: "CRM-US-021",
    sprintId: "spr-7",
    title: "Cron job + handler de geração",
    status: "done",
    doneAt: "2026-04-19T16:45:00Z",
    type: "feature",
    scope: "small",
    complexity: "medium",
    tags: [],
    functionPoints: 5,
    billable: true,
    assigneeIds: ["mb-lucas"],
    acceptanceCriteria: [
      { id: "tac-094-1", text: "Cron schedule registrado",          checked: true, checkedBy: "Lucas" },
      { id: "tac-094-2", text: "Handler processa em batches de 50", checked: true, checkedBy: "Lucas" },
    ],
    createdByAgent: true,
  },
  {
    reference: "TSK-095",
    userStoryRef: "CRM-US-021",
    sprintId: "spr-7",
    title: "Template de fatura PDF",
    status: "done",
    doneAt: "2026-04-20T18:00:00Z",
    type: "feature",
    scope: "micro",
    complexity: "medium",
    tags: [],
    functionPoints: 3,
    billable: true,
    assigneeIds: ["mb-camila"],
    acceptanceCriteria: [
      { id: "tac-095-1", text: "Layout aprovado pelo cliente", checked: true, checkedBy: "João (PM)" },
    ],
    createdByAgent: true,
  },
  {
    reference: "TSK-096",
    userStoryRef: "CRM-US-021",
    sprintId: "spr-7",
    title: "Alerta de falha via webhook",
    status: "done",
    doneAt: "2026-04-21T14:30:00Z",
    type: "feature",
    scope: "micro",
    complexity: "low",
    tags: [],
    functionPoints: 2,
    billable: false,
    assigneeIds: ["mb-rafael"],
    acceptanceCriteria: [
      { id: "tac-096-1", text: "Webhook posta em #ops", checked: true, checkedBy: "Rafael" },
    ],
    createdByAgent: true,
  },

  // ━━━ Sprint 8 (active, perto do fim) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  // CRM-US-014 — magic link
  {
    reference: "TSK-082",
    userStoryRef: "CRM-US-014",
    sprintId: "spr-8",
    title: "Endpoint /auth/magic-link com TTL",
    description: "POST que gera token + dispatch de email. TTL configurável via env.",
    status: "done",
    doneAt: "2026-04-26T16:30:00Z",
    type: "feature",
    scope: "small",
    complexity: "medium",
    tags: [],
    functionPoints: 5,
    billable: true,
    assigneeIds: ["mb-lucas"],
    acceptanceCriteria: [
      { id: "tac-082-1", text: "POST aceita email válido", checked: true, checkedBy: "Lucas" },
      { id: "tac-082-2", text: "Token assinado com HS256", checked: true, checkedBy: "Lucas" },
      { id: "tac-082-3", text: "TTL respeitado em test",   checked: true, checkedBy: "Lucas" },
    ],
    createdByAgent: true,
  },
  {
    reference: "TSK-083",
    userStoryRef: "CRM-US-014",
    sprintId: "spr-8",
    title: "Validação de expiração + erro 410",
    description: "Endpoint de consumo do link valida TTL e retorna 410 Gone se expirado.",
    status: "done",
    doneAt: "2026-04-29T18:45:00Z",
    type: "feature",
    scope: "micro",
    complexity: "medium",
    tags: [],
    functionPoints: 3,
    billable: true,
    assigneeIds: ["mb-lucas"],
    acceptanceCriteria: [
      { id: "tac-083-1", text: "Retorna 410 com message clara",     checked: true, checkedBy: "Lucas" },
      { id: "tac-083-2", text: "Logging inclui token-id + reason", checked: true, checkedBy: "Lucas" },
    ],
    createdByAgent: true,
  },
  {
    reference: "TSK-084",
    userStoryRef: "CRM-US-014",
    sprintId: "spr-8",
    title: "Tela de erro pra link inválido",
    status: "review",
    type: "feature",
    scope: "small",
    complexity: "medium",
    tags: [],
    functionPoints: 5,
    billable: true,
    assigneeIds: ["mb-camila"],
    acceptanceCriteria: [
      { id: "tac-084-1", text: "Mensagem distingue 'expirado' de 'inválido'", checked: true, checkedBy: "Camila" },
      { id: "tac-084-2", text: "CTA 'pedir novo link' visível",                  checked: true, checkedBy: "Camila" },
    ],
    createdByAgent: true,
  },

  // CRM-US-024 — cobrança seats
  {
    reference: "TSK-097",
    userStoryRef: "CRM-US-024",
    sprintId: "spr-8",
    title: "Endpoint de preview de cobrança",
    status: "done",
    doneAt: "2026-04-29T17:00:00Z",
    type: "feature",
    scope: "small",
    complexity: "high",
    tags: [],
    functionPoints: 5,
    billable: true,
    assigneeIds: ["mb-lucas"],
    acceptanceCriteria: [
      { id: "tac-097-1", text: "Calcula prorata corretamente em 5 cenários",    checked: true, checkedBy: "Lucas" },
      { id: "tac-097-2", text: "Retorna breakdown linha-a-linha do cálculo",    checked: true, checkedBy: "Lucas" },
    ],
    createdByAgent: true,
  },
  {
    reference: "TSK-098",
    userStoryRef: "CRM-US-024",
    sprintId: "spr-8",
    title: "Atualização ao vivo do preview no checkout",
    status: "done",
    doneAt: "2026-04-28T15:15:00Z",
    type: "feature",
    scope: "micro",
    complexity: "medium",
    tags: [],
    functionPoints: 2,
    billable: true,
    assigneeIds: ["mb-camila"],
    acceptanceCriteria: [
      { id: "tac-098-1", text: "Debounced (300ms) ao mudar quantidade", checked: true, checkedBy: "Camila" },
    ],
    createdByAgent: true,
  },
  {
    reference: "TSK-099",
    userStoryRef: "CRM-US-024",
    sprintId: "spr-8",
    title: "Tooltip de pro-rata explicativo",
    status: "in_progress",
    type: "component",
    scope: "micro",
    complexity: "low",
    tags: [],
    functionPoints: 3,
    billable: true,
    dueDate: "2026-05-01",
    assigneeIds: ["mb-rafael"],
    acceptanceCriteria: [
      { id: "tac-099-1", text: "Texto revisado pelo PM", checked: false },
      { id: "tac-099-2", text: "Mostra exemplo numérico", checked: false },
    ],
    createdByAgent: true,
  },

  // ━━━ Sprint 9 (planning) — backlog ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  // CRM-US-027 — filtro de período (refined, prepa pro próximo sprint)
  {
    reference: "TSK-100",
    userStoryRef: "CRM-US-027",
    sprintId: "spr-9",
    title: "Componente DateRangePicker com presets",
    status: "backlog",
    type: "component",
    scope: "small",
    complexity: "medium",
    tags: [],
    functionPoints: 5,
    billable: true,
    assigneeIds: ["mb-camila"],
    acceptanceCriteria: [],
    createdByAgent: true,
  },
  {
    reference: "TSK-101",
    userStoryRef: "CRM-US-027",
    sprintId: "spr-9",
    title: "Persistência do filtro na query string",
    status: "backlog",
    type: "feature",
    scope: "micro",
    complexity: "low",
    tags: [],
    functionPoints: 3,
    billable: true,
    assigneeIds: ["mb-camila"],
    acceptanceCriteria: [],
    createdByAgent: true,
  },

  // CRM-US-031 — 2FA
  {
    reference: "TSK-102",
    userStoryRef: "CRM-US-031",
    sprintId: "spr-9",
    title: "Setup TOTP: lib + storage de secret",
    status: "backlog",
    type: "feature",
    scope: "small",
    complexity: "high",
    tags: [],
    functionPoints: 5,
    billable: true,
    assigneeIds: ["mb-lucas"],
    acceptanceCriteria: [],
    createdByAgent: true,
  },
  {
    reference: "TSK-103",
    userStoryRef: "CRM-US-031",
    sprintId: "spr-9",
    title: "Tela de configuração 2FA com QR code",
    status: "backlog",
    type: "feature",
    scope: "small",
    complexity: "medium",
    tags: [],
    functionPoints: 5,
    billable: true,
    assigneeIds: ["mb-camila"],
    acceptanceCriteria: [],
    createdByAgent: true,
  },
  {
    reference: "TSK-104",
    userStoryRef: "CRM-US-031",
    sprintId: "spr-9",
    title: "Validação TOTP no fluxo de login",
    status: "backlog",
    type: "feature",
    scope: "micro",
    complexity: "medium",
    tags: [],
    functionPoints: 3,
    billable: true,
    assigneeIds: ["mb-lucas"],
    acceptanceCriteria: [],
    createdByAgent: true,
  },
];
