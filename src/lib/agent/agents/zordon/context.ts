import { db } from "@/lib/db";
import { ACTIVE_STATUSES, FP_MATRIX_DEFAULT, type FpMatrix } from "@/lib/function-points";
import {
  loadAgentConfig,
  loadAgentHeuristicsIndex,
  type HeuristicIndexEntry,
} from "../../config";

export const ZORDON_AGENT_ID = "agent-zordon";

export interface ZordonConfig {
  fp_matrix: FpMatrix;
  ideal_fp_per_sprint: number;
  sprint_length_days: number;
  fp_overflow_threshold: number;
  min_fp_per_member: number;
  auto_assign_priority: "urgency" | "capacity" | "skill_match";
  require_approval_for: string[];
}

const CONFIG_DEFAULTS: ZordonConfig = {
  fp_matrix: FP_MATRIX_DEFAULT,
  ideal_fp_per_sprint: 80,
  sprint_length_days: 15,
  fp_overflow_threshold: 1.1,
  min_fp_per_member: 5,
  auto_assign_priority: "urgency",
  require_approval_for: ["delete_task", "bulk_move_tasks", "split_task"],
};

function resolveConfig(raw: Record<string, unknown>): ZordonConfig {
  return {
    fp_matrix: (raw.fp_matrix as FpMatrix) ?? CONFIG_DEFAULTS.fp_matrix,
    ideal_fp_per_sprint:
      typeof raw.ideal_fp_per_sprint === "number"
        ? raw.ideal_fp_per_sprint
        : CONFIG_DEFAULTS.ideal_fp_per_sprint,
    sprint_length_days:
      typeof raw.sprint_length_days === "number"
        ? raw.sprint_length_days
        : CONFIG_DEFAULTS.sprint_length_days,
    fp_overflow_threshold:
      typeof raw.fp_overflow_threshold === "number"
        ? raw.fp_overflow_threshold
        : CONFIG_DEFAULTS.fp_overflow_threshold,
    min_fp_per_member:
      typeof raw.min_fp_per_member === "number"
        ? raw.min_fp_per_member
        : CONFIG_DEFAULTS.min_fp_per_member,
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
 * Builds sprint overview context for Zordon's prompt.
 * Loads active sprint, sprint list, backlog, members, tuning config and heuristic index.
 */
export async function buildOpsContext(): Promise<Record<string, unknown>> {
  const supabase = db();

  // Fire everything in parallel
  const [
    { data: activeSprint },
    { data: allSprints },
    { data: members },
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
    supabase.from("member_capacity_overview").select("*"),
    loadAgentConfig(ZORDON_AGENT_ID),
    loadAgentHeuristicsIndex(ZORDON_AGENT_ID),
  ]);

  const config = resolveConfig(rawConfig);

  // Load tasks for active sprint + backlog in parallel
  const [{ data: sprintTasks }, { data: backlogTasks }] = await Promise.all([
    activeSprint
      ? supabase
          .from("Task")
          .select("id, reference, title, status, type, functionPoints, complexity, scope, dueDate, priority, assignments:TaskAssignment(member:Member(id, name))")
          .eq("sprintId", activeSprint.id)
          .order("priority", { ascending: false })
          .order("createdAt", { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase
      .from("Task")
      .select("reference, title, type, scope, complexity, functionPoints, priority")
      .is("sprintId", null)
      .order("priority", { ascending: false })
      .order("createdAt", { ascending: false })
      .limit(30),
  ]);

  const memberList = members || [];
  const taskList = sprintTasks || [];
  const backlog = backlogTasks || [];
  const sprintList = allSprints || [];

  // Alerts
  const alerts: string[] = [];

  for (const m of memberList) {
    const allocated = Number(m.fp_allocated) || 0;
    const capacity = Number(m.fp_capacity) || 0;
    if (capacity > 0 && allocated > capacity * config.fp_overflow_threshold) {
      alerts.push(`⚠ ${m.name} sobrecarregado: ${allocated}/${capacity} FP (threshold ${Math.round(config.fp_overflow_threshold * 100)}%)`);
    }
    if (capacity > 0 && allocated < config.min_fp_per_member) {
      alerts.push(`⚠ ${m.name} subutilizado: ${allocated} FP (mínimo esperado: ${config.min_fp_per_member})`);
    }
  }

  const unassigned = taskList.filter(
    (t) => ACTIVE_STATUSES.includes(t.status as typeof ACTIVE_STATUSES[number]) &&
      (!t.assignments || t.assignments.length === 0)
  );
  if (unassigned.length > 0) {
    alerts.push(`⚠ ${unassigned.length} task(s) ativas sem atribuição: ${unassigned.map(t => t.reference).join(", ")}`);
  }

  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  const stuckTodo = taskList.filter(
    (t) => t.status === "todo" && t.dueDate && new Date(t.dueDate) < threeDaysAgo
  );
  if (stuckTodo.length > 0) {
    alerts.push(`⚠ ${stuckTodo.length} task(s) em "todo" com prazo vencido: ${stuckTodo.map(t => t.reference).join(", ")}`);
  }

  const totalFP = taskList
    .filter((t) => ACTIVE_STATUSES.includes(t.status as typeof ACTIVE_STATUSES[number]))
    .reduce((sum, t) => sum + (t.functionPoints || 0), 0);
  const totalCapacity = memberList.reduce((sum, m) => sum + (Number(m.fp_capacity) || 0), 0);
  if (totalCapacity > 0 && totalFP > totalCapacity * config.fp_overflow_threshold) {
    alerts.push(`⚠ Sprint acima da capacidade: ${totalFP}/${totalCapacity} FP`);
  }
  if (activeSprint && totalFP > config.ideal_fp_per_sprint * config.fp_overflow_threshold) {
    alerts.push(`⚠ Sprint acima do FP ideal: ${totalFP}/${config.ideal_fp_per_sprint} FP alvo`);
  }

  // ─── Prompt formatting ────────────────────────────────────
  const sprintBlock = activeSprint
    ? [
        `## Sprint Ativo: ${activeSprint.name}`,
        `- **Projeto:** ${(activeSprint.project as { name: string } | null)?.name || "N/A"}`,
        `- **Período:** ${activeSprint.startDate || "?"} a ${activeSprint.endDate || "?"}`,
        `- **Status:** ${activeSprint.status}`,
        `- **Tasks ativas:** ${taskList.filter(t => ACTIVE_STATUSES.includes(t.status as typeof ACTIVE_STATUSES[number])).length}`,
        `- **FP total ativo:** ${totalFP}/${totalCapacity} (capacidade do time) — alvo ${config.ideal_fp_per_sprint}`,
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

  const membersBlock = [
    "## Equipe",
    ...memberList.map((m) => {
      const allocated = Number(m.fp_allocated) || 0;
      const capacity = Number(m.fp_capacity) || 0;
      const remaining = capacity - allocated;
      const flag = remaining < 0 ? " 🔴" : remaining === 0 ? " 🟡" : "";
      return `- **${m.name}** (${m.role}): ${allocated}/${capacity} FP alocados (${remaining} restantes)${flag}`;
    }),
  ].join("\n");

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
    `- FP ideal por sprint: **${config.ideal_fp_per_sprint}**`,
    `- Duração padrão do sprint: ${config.sprint_length_days} dias`,
    `- Threshold de overflow: ${Math.round(config.fp_overflow_threshold * 100)}% (alerta acima disso)`,
    `- FP mínimo por membro: ${config.min_fp_per_member}`,
    `- Critério de atribuição automática: ${config.auto_assign_priority}`,
    `- Ferramentas que exigem confirmação: ${config.require_approval_for.join(", ") || "nenhuma"}`,
  ].join("\n");

  const matrixBlock = renderFpMatrix(config.fp_matrix);

  const heuristicsBlock = renderHeuristicsIndex(heuristics);

  const alertsBlock = alerts.length > 0
    ? ["## Alertas", ...alerts].join("\n")
    : "## Alertas\nNenhum alerta.";

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
    membersBlock,
    "",
    tasksBlock,
    "",
    backlogBlock,
    "",
    alertsBlock,
  ].join("\n");

  return {
    sprintContext,
    sprintId: activeSprint?.id,
    projectId: activeSprint?.projectId,
    members: memberList,
    tasks: taskList,
    alerts,
    config,
  };
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
