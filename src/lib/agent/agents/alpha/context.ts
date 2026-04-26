import { db } from "@/lib/db";
import { ACTIVE_STATUSES, FP_MATRIX_DEFAULT, type FpMatrix } from "@/lib/function-points";
import {
  loadAgentConfig,
  loadAgentHeuristicsIndex,
  type HeuristicIndexEntry,
} from "../../config";

export const ALPHA_AGENT_ID = "agent-alpha";

export interface AlphaConfig {
  fp_matrix: FpMatrix;
  sprint_length_days: number;
  fp_overflow_threshold: number;
  min_utilization_percent: number;
  auto_assign_priority: "urgency" | "capacity" | "skill_match";
  require_approval_for: string[];
}

const CONFIG_DEFAULTS: AlphaConfig = {
  fp_matrix: FP_MATRIX_DEFAULT,
  sprint_length_days: 7,
  fp_overflow_threshold: 1.1,
  min_utilization_percent: 0.5,
  auto_assign_priority: "urgency",
  require_approval_for: ["delete_task", "bulk_move_tasks", "split_task"],
};

function resolveConfig(raw: Record<string, unknown>): AlphaConfig {
  return {
    fp_matrix: (raw.fp_matrix as FpMatrix) ?? CONFIG_DEFAULTS.fp_matrix,
    sprint_length_days:
      typeof raw.sprint_length_days === "number"
        ? raw.sprint_length_days
        : CONFIG_DEFAULTS.sprint_length_days,
    fp_overflow_threshold:
      typeof raw.fp_overflow_threshold === "number"
        ? raw.fp_overflow_threshold
        : CONFIG_DEFAULTS.fp_overflow_threshold,
    min_utilization_percent:
      typeof raw.min_utilization_percent === "number"
        ? raw.min_utilization_percent
        : CONFIG_DEFAULTS.min_utilization_percent,
    auto_assign_priority:
      raw.auto_assign_priority === "capacity" || raw.auto_assign_priority === "skill_match"
        ? raw.auto_assign_priority
        : CONFIG_DEFAULTS.auto_assign_priority,
    require_approval_for: Array.isArray(raw.require_approval_for)
      ? (raw.require_approval_for as string[])
      : CONFIG_DEFAULTS.require_approval_for,
  };
}

/**
 * Builds operational context for Alpha's prompt.
 * Loads active sprint, sprint list, backlog, member commitments (bateria),
 * real sprint capacity (respecting sprint/project allocations), tuning config
 * and heuristic index. If `meetingId` is supplied, also loads the meeting
 * with reviews grouped by PM so Alpha can fill them in.
 */
export async function buildOpsContext(
  opts: { meetingId?: string } = {},
): Promise<Record<string, unknown>> {
  const supabase = db();
  const { meetingId } = opts;

  const [
    { data: activeSprint },
    { data: allSprints },
    { data: commitments },
    rawConfig,
    heuristics,
  ] = await Promise.all([
    supabase
      .from("Sprint")
      .select("id, name, startDate, endDate, status, projectId, project:Project(name)")
      .neq("status", "done")
      .order("startDate", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("Sprint")
      .select("id, name, status, startDate, endDate, projectId, project:Project(name)")
      .neq("status", "done")
      .order("startDate", { ascending: true })
      .limit(20),
    supabase.from("member_commitment_overview").select("*"),
    loadAgentConfig(ALPHA_AGENT_ID),
    loadAgentHeuristicsIndex(ALPHA_AGENT_ID),
  ]);

  const config = resolveConfig(rawConfig);
  const commitList = commitments || [];

  // Sprint-level loads: tasks + capacity + per-member allocation
  const sprintId = activeSprint?.id ?? null;
  const [
    { data: sprintTasks },
    { data: backlogTasks },
    { data: sprintCapacity },
    { data: sprintMembers },
  ] = await Promise.all([
    sprintId
      ? supabase
          .from("Task")
          .select("id, reference, title, status, type, functionPoints, complexity, scope, dueDate, priority, assignments:TaskAssignment(member:Member(id, name))")
          .eq("sprintId", sprintId)
          .neq("status", "draft")
          .order("priority", { ascending: false })
          .order("createdAt", { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase
      .from("Task")
      .select("reference, title, type, scope, complexity, functionPoints, priority")
      .is("sprintId", null)
      .neq("status", "draft")
      .order("priority", { ascending: false })
      .order("createdAt", { ascending: false })
      .limit(30),
    sprintId
      ? supabase
          .from("sprint_capacity_overview")
          .select("*")
          .eq("sprintId", sprintId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    sprintId
      ? supabase
          .from("sprint_member_capacity")
          .select("*")
          .eq("sprintId", sprintId)
      : Promise.resolve({ data: [] }),
  ]);

  const taskList = sprintTasks || [];
  const backlog = backlogTasks || [];
  const sprintList = allSprints || [];
  const membersInSprint = sprintMembers || [];

  // ─── Alertas em 3 níveis ──────────────────────────────────
  const alerts: string[] = [];

  // Nível 1: BATERIA (membro geral) — committed > capacity
  for (const m of commitList) {
    const cap = Number(m.capacity) || 0;
    const committed = Number(m.committed) || 0;
    if (cap > 0 && committed > cap) {
      alerts.push(`⚠ Bateria: ${m.name} com overcommit (${committed}/${cap} FP comprometidos em ${m.project_count} projeto(s))`);
    }
  }

  // Nível 2: PROJETO/SPRINT — uso > alocação no projeto daquele sprint
  for (const m of membersInSprint) {
    const alloc = Number(m.fp_allocation) || 0;
    const used = Number(m.fp_used) || 0;
    if (alloc > 0 && used > alloc * config.fp_overflow_threshold) {
      const tag = m.has_sprint_override ? " (override)" : "";
      alerts.push(`⚠ Sprint: ${m.member_name} estourou alocação no projeto${tag} (${used}/${alloc} FP)`);
    }
    if (alloc > 0 && used < alloc * config.min_utilization_percent) {
      alerts.push(`⚠ Subutilização: ${m.member_name} usando ${used}/${alloc} FP (< ${Math.round(config.min_utilization_percent * 100)}%)`);
    }
    if (alloc === 0) {
      alerts.push(`⚠ Sem alocação: ${m.member_name} está no projeto mas sem fpAllocation definido`);
    }
  }

  // Nível 3: TIME — allocated total do sprint > capacity total
  if (sprintCapacity) {
    const cap = Number(sprintCapacity.capacity) || 0;
    const alloc = Number(sprintCapacity.allocated) || 0;
    if (cap > 0 && alloc > cap * config.fp_overflow_threshold) {
      alerts.push(`⚠ Sprint acima da capacidade do time: ${alloc}/${cap} FP (threshold ${Math.round(config.fp_overflow_threshold * 100)}%)`);
    }
  }

  const unassigned = taskList.filter(
    (t) => ACTIVE_STATUSES.includes(t.status as typeof ACTIVE_STATUSES[number]) &&
      (!t.assignments || t.assignments.length === 0)
  );
  if (unassigned.length > 0) {
    alerts.push(`⚠ ${unassigned.length} task(s) ativa(s) sem atribuição: ${unassigned.map(t => t.reference).join(", ")}`);
  }

  const now = new Date();
  const overdue = taskList.filter(
    (t) => ACTIVE_STATUSES.includes(t.status as typeof ACTIVE_STATUSES[number])
      && t.dueDate && new Date(t.dueDate) < now
  );
  if (overdue.length > 0) {
    alerts.push(`⚠ ${overdue.length} task(s) com prazo vencido: ${overdue.map(t => t.reference).join(", ")}`);
  }

  // ─── Prompt formatting ────────────────────────────────────
  const sprintBlock = activeSprint
    ? [
        `## Sprint Ativo: ${activeSprint.name}`,
        `- **Projeto:** ${(activeSprint.project as { name: string } | null)?.name || "N/A"}`,
        `- **Período:** ${activeSprint.startDate || "?"} a ${activeSprint.endDate || "?"}`,
        `- **Status:** ${activeSprint.status}`,
        `- **Capacidade do sprint:** ${sprintCapacity?.capacity ?? 0} FP (soma de alocações no projeto)`,
        `- **Alocado:** ${sprintCapacity?.allocated ?? 0} FP (tasks ativas)`,
        `- **Restante:** ${sprintCapacity?.remaining ?? 0} FP`,
      ].join("\n")
    : "## Sprint Ativo\nNenhum sprint ativo encontrado.";

  const sprintListBlock = sprintList.length > 0
    ? [
        "## Sprints do projeto (não concluídos)",
        ...sprintList.map((s) => {
          const proj = (s.project as { name: string } | null)?.name || "?";
          return `- **${s.name}** | ${s.status} | ${s.startDate || "?"} → ${s.endDate || "?"} | projeto: ${proj}`;
        }),
      ].join("\n")
    : "";

  // Tabela de bateria (visão por membro)
  const batteryBlock = [
    "## Bateria por membro",
    ...commitList.map((m) => {
      const cap = Number(m.capacity) || 0;
      const committed = Number(m.committed) || 0;
      const rem = Number(m.remaining) || 0;
      const pc = Number(m.project_count) || 0;
      const flag = rem < 0 ? " 🔴 overcommit" : rem === 0 ? " 🟡 cheia" : "";
      return `- **${m.name}** (${m.role}): ${committed}/${cap} FP comprometidos em ${pc} projeto(s), ${rem} livre${flag}`;
    }),
  ].join("\n");

  // Alocação dos membros no sprint ativo
  const sprintMembersBlock = membersInSprint.length > 0
    ? [
        "## Alocação do time no sprint ativo",
        ...membersInSprint.map((m) => {
          const alloc = Number(m.fp_allocation) || 0;
          const used = Number(m.fp_used) || 0;
          const pct = alloc > 0 ? Math.round((used / alloc) * 100) : 0;
          const tag = m.has_sprint_override ? " [override]" : "";
          return `- **${m.member_name}**${tag}: ${used}/${alloc} FP (${pct}%)`;
        }),
      ].join("\n")
    : "";

  const tasksBlock = [
    "## Tasks do Sprint Ativo",
    ...(taskList.length === 0
      ? ["Nenhuma."]
      : taskList.map((t) => {
          const assignee = t.assignments?.[0]?.member;
          return `- [${t.reference}] ${t.title} | ${t.status} | ${t.functionPoints || "?"}FP | ${assignee?.name || "sem atribuição"}`;
        })),
  ].join("\n");

  const backlogBlock = backlog.length > 0
    ? [
        `## Backlog (top ${backlog.length} por prioridade)`,
        ...backlog.slice(0, 20).map((t) =>
          `- [${t.reference}] ${t.title} | ${t.type} | ${t.functionPoints || "?"}FP`,
        ),
        ...(backlog.length > 20 ? [`... e mais ${backlog.length - 20} tasks no backlog`] : []),
      ].join("\n")
    : "## Backlog\nVazio.";

  const paramsBlock = [
    "## Parâmetros operacionais atuais",
    `- Duração do sprint: ${config.sprint_length_days} dias`,
    `- Threshold de overflow: ${Math.round(config.fp_overflow_threshold * 100)}%`,
    `- Utilização mínima esperada por membro: ${Math.round(config.min_utilization_percent * 100)}%`,
    `- Critério de atribuição automática: ${config.auto_assign_priority}`,
    `- Ferramentas que exigem confirmação: ${config.require_approval_for.join(", ") || "nenhuma"}`,
  ].join("\n");

  const matrixBlock = renderFpMatrix(config.fp_matrix);
  const heuristicsBlock = renderHeuristicsIndex(heuristics);
  const alertsBlock = alerts.length > 0
    ? ["## Alertas", ...alerts].join("\n")
    : "## Alertas\nNenhum alerta.";

  const meetingBlock = await buildMeetingBlock(meetingId);

  const sprintContext = [
    paramsBlock,
    "",
    matrixBlock,
    "",
    heuristicsBlock,
    "",
    sprintBlock,
    ...(sprintListBlock ? ["", sprintListBlock] : []),
    "",
    batteryBlock,
    ...(sprintMembersBlock ? ["", sprintMembersBlock] : []),
    "",
    tasksBlock,
    "",
    backlogBlock,
    "",
    alertsBlock,
    ...(meetingBlock ? ["", meetingBlock] : []),
  ].join("\n");

  return {
    sprintContext,
    sprintId: activeSprint?.id,
    projectId: activeSprint?.projectId,
    meetingId: meetingId ?? null,
    commitments: commitList,
    tasks: taskList,
    alerts,
    config,
  };
}

async function buildMeetingBlock(meetingId?: string): Promise<string | null> {
  if (!meetingId) return null;
  const supabase = db();

  const { data: meeting } = await supabase
    .from("Meeting")
    .select("id, date, status")
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting) return null;

  const { data: reviews } = await supabase
    .from("MeetingProjectReview")
    .select("id, nextSteps, sprintHealth, attentionPoints, additionalNotes, order, project:Project(id, name), member:Member(id, name)")
    .eq("meetingId", meetingId)
    .order("order", { ascending: true });

  const reviewList = reviews || [];

  // Group reviews by PM
  const byPm = new Map<string, { pmName: string; items: typeof reviewList }>();
  for (const r of reviewList) {
    const pm = (r.member as { id: string; name: string } | null);
    if (!pm) continue;
    const bucket = byPm.get(pm.id) || { pmName: pm.name, items: [] };
    bucket.items.push(r);
    byPm.set(pm.id, bucket);
  }

  const lines: string[] = [
    `## Reunião ativa: ${meeting.date} (${meeting.status})`,
    `- **ID:** ${meeting.id}`,
    `- Use \`get_meeting_reviews\` para detalhes e \`update_meeting_review\` para preencher os campos de cada projeto.`,
    "",
    `### Revisões por PM (${reviewList.length} projeto(s))`,
  ];

  if (byPm.size === 0) {
    lines.push("Nenhuma revisão cadastrada (nenhum projeto ativo com PM).");
    return lines.join("\n");
  }

  for (const { pmName, items } of byPm.values()) {
    lines.push(`**${pmName}** — ${items.length} projeto(s):`);
    for (const r of items) {
      const proj = (r.project as { name: string } | null)?.name || "?";
      const filled: string[] = [];
      if (r.nextSteps) filled.push("nextSteps");
      if (r.attentionPoints) filled.push("attentionPoints");
      if (r.additionalNotes) filled.push("additionalNotes");
      const status = filled.length === 0 ? "vazio" : filled.join(", ");
      lines.push(`  - ${proj} | health: ${r.sprintHealth} | preenchido: ${status}`);
    }
  }

  return lines.join("\n");
}

function renderFpMatrix(matrix: FpMatrix): string {
  const scopes = Object.keys(matrix);
  const complexities = scopes.length > 0 ? Object.keys(matrix[scopes[0]]) : [];
  if (scopes.length === 0 || complexities.length === 0) return "## Matriz FP (vazia)";

  const header = `| scope \\ complexity | ${complexities.join(" | ")} |`;
  const divider = `|${" --- |".repeat(complexities.length + 1)}`;
  const rows = scopes.map((s) => `| **${s}** | ${complexities.map((c) => matrix[s]?.[c] ?? "?").join(" | ")} |`);
  return ["## Matriz de Function Points (editável em AgentConfig.fp_matrix)", header, divider, ...rows].join("\n");
}

function renderHeuristicsIndex(items: HeuristicIndexEntry[]): string {
  if (items.length === 0) return "## Heurísticas disponíveis\nNenhuma cadastrada.";
  const grouped = new Map<string, HeuristicIndexEntry[]>();
  for (const h of items) {
    const cat = h.category || "geral";
    const bucket = grouped.get(cat) || [];
    bucket.push(h);
    grouped.set(cat, bucket);
  }
  const lines: string[] = [
    "## Heurísticas disponíveis",
    "_Carregue o corpo com `load_heuristic(name)` quando o contexto pedir._",
    "",
  ];
  for (const [cat, list] of grouped) {
    lines.push(`**${cat}:**`);
    for (const h of list) {
      lines.push(`- \`${h.name}\` — ${h.description}`);
    }
  }
  return lines.join("\n");
}
