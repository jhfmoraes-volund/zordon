import { db } from "@/lib/db";
import { OPEN_STATUSES, FP_MATRIX_DEFAULT, type FpMatrix } from "@/lib/function-points";
import {
  loadAgentConfig,
  loadAgentHeuristicsIndex,
  type HeuristicIndexEntry,
} from "../../config";
import type { RouteContext } from "./route-context";
import { routeLabel } from "./route-context";

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
 *
 * Composition:
 *   1. Always: params, matrix, heuristics index, member battery (cross-project),
 *      level-1 alerts (bateria overcommit).
 *   2. If route has a focus (project / sprint / meeting): renders the focus
 *      block rich and keeps global context compact (no global active sprint /
 *      no full backlog) to control prompt size.
 *   3. Otherwise: renders the historical "global" context — global active
 *      sprint, sprint list, sprint tasks, backlog top 30 — same as before.
 */
export async function buildOpsContext(
  opts: { meetingId?: string; route?: RouteContext } = {},
): Promise<Record<string, unknown>> {
  const { meetingId, route } = opts;
  const focusKind = route?.kind ?? "other";
  const hasFocus = focusKind === "project" || focusKind === "sprint" || focusKind === "meeting";

  const [config, heuristics, baseline] = await Promise.all([
    loadAgentConfig(ALPHA_AGENT_ID).then(resolveConfig),
    loadAgentHeuristicsIndex(ALPHA_AGENT_ID),
    buildBaseline(),
  ]);

  // Branch: focus block (rich) or full global block.
  let focusBlock = "";
  let focusedSprintId: string | null = null;
  let focusedProjectId: string | null = null;

  if (route?.kind === "project") {
    const focus = await buildProjectFocus(route.projectId, config);
    focusBlock = focus.block;
    focusedSprintId = focus.activeSprintId;
    focusedProjectId = route.projectId;
  } else if (route?.kind === "sprint") {
    const focus = await buildSprintFocus(route.sprintId, config);
    focusBlock = focus.block;
    focusedSprintId = route.sprintId;
    focusedProjectId = focus.projectId;
  }

  const globalBlock = await buildGlobalContext({ compact: hasFocus, config });
  const meetingBlock = await buildMeetingBlock(meetingId);
  const localBlock = route ? `## Local atual\nUsuário está em: ${routeLabel(route)}` : "";

  const sprintContext = [
    renderToday(),
    "",
    renderParams(config),
    "",
    renderFpMatrix(config.fp_matrix),
    "",
    renderHeuristicsIndex(heuristics),
    "",
    baseline.batteryBlock,
    ...(baseline.batteryAlertsBlock ? ["", baseline.batteryAlertsBlock] : []),
    ...(focusBlock ? ["", focusBlock] : []),
    ...(globalBlock ? ["", globalBlock] : []),
    ...(meetingBlock ? ["", meetingBlock] : []),
    ...(localBlock ? ["", localBlock] : []),
  ].join("\n");

  return {
    sprintContext,
    sprintId: focusedSprintId ?? baseline.globalSprintId ?? null,
    projectId: focusedProjectId ?? baseline.globalProjectId ?? null,
    meetingId: meetingId ?? null,
    commitments: baseline.commitments,
    alerts: baseline.batteryAlerts,
    config,
  };
}

// ─── Baseline (always loaded) ────────────────────────────────────

interface Baseline {
  batteryBlock: string;
  batteryAlertsBlock: string;
  batteryAlerts: string[];
  commitments: Record<string, unknown>[];
  globalSprintId: string | null;
  globalProjectId: string | null;
}

async function buildBaseline(): Promise<Baseline> {
  const supabase = db();
  const [{ data: commitments }, { data: globalSprint }] = await Promise.all([
    supabase.from("member_commitment_overview").select("*"),
    supabase
      .from("Sprint")
      .select("id, projectId")
      .neq("status", "done")
      .order("startDate", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const commitList = commitments || [];
  const batteryAlerts: string[] = [];
  for (const m of commitList) {
    const cap = Number(m.capacity) || 0;
    const committed = Number(m.committed) || 0;
    if (cap > 0 && committed > cap) {
      batteryAlerts.push(
        `⚠ Bateria: ${m.name} com overcommit (${committed}/${cap} FP comprometidos em ${m.project_count} projeto(s))`,
      );
    }
  }

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

  const batteryAlertsBlock = batteryAlerts.length > 0
    ? ["## Alertas de bateria", ...batteryAlerts].join("\n")
    : "";

  return {
    batteryBlock,
    batteryAlertsBlock,
    batteryAlerts,
    commitments: commitList,
    globalSprintId: globalSprint?.id ?? null,
    globalProjectId: globalSprint?.projectId ?? null,
  };
}

// ─── Global context (compact or rich) ────────────────────────────

async function buildGlobalContext(
  opts: { compact: boolean; config: AlphaConfig },
): Promise<string> {
  // When compact (focus active), skip the global active-sprint / sprint-list /
  // sprint-task / backlog / level-2 / level-3 alerts blocks. The focus already
  // covers the sprint-level data the agent needs for the page.
  if (opts.compact) return "";

  const supabase = db();
  const { config } = opts;

  const [
    { data: activeSprint },
    { data: allSprints },
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
  ]);

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
      : Promise.resolve({ data: [] as unknown[] }),
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
      : Promise.resolve({ data: null as unknown }),
    sprintId
      ? supabase
          .from("sprint_member_capacity")
          .select("*")
          .eq("sprintId", sprintId)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const taskList = (sprintTasks || []) as Array<Record<string, unknown>>;
  const backlog = (backlogTasks || []) as Array<Record<string, unknown>>;
  const sprintList = allSprints || [];
  const membersInSprint = (sprintMembers || []) as Array<Record<string, unknown>>;
  const capacity = sprintCapacity as Record<string, unknown> | null;

  // Sprint-level alerts (membro/projeto/time)
  const alerts: string[] = [];
  for (const m of membersInSprint) {
    const alloc = Number(m.fp_allocation) || 0;
    const used = Number(m.fp_open) || 0;
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

  if (capacity) {
    const cap = Number(capacity.capacity) || 0;
    const alloc = Number(capacity.open) || 0;
    if (cap > 0 && alloc > cap * config.fp_overflow_threshold) {
      alerts.push(`⚠ Sprint acima da capacidade do time: ${alloc}/${cap} FP (threshold ${Math.round(config.fp_overflow_threshold * 100)}%)`);
    }
  }

  const unassigned = taskList.filter(
    (t) => OPEN_STATUSES.includes(t.status as typeof OPEN_STATUSES[number]) &&
      !(t.assignments as Array<unknown> | null | undefined)?.length,
  );
  if (unassigned.length > 0) {
    alerts.push(`⚠ ${unassigned.length} task(s) ativa(s) sem atribuição: ${unassigned.map(t => t.reference).join(", ")}`);
  }

  const now = new Date();
  const overdue = taskList.filter(
    (t) => OPEN_STATUSES.includes(t.status as typeof OPEN_STATUSES[number])
      && t.dueDate && new Date(t.dueDate as string) < now,
  );
  if (overdue.length > 0) {
    alerts.push(`⚠ ${overdue.length} task(s) com prazo vencido: ${overdue.map(t => t.reference).join(", ")}`);
  }

  const sprintBlock = activeSprint
    ? [
        `## Sprint Ativo: ${activeSprint.name}`,
        `- **Projeto:** ${(activeSprint.project as { name: string } | null)?.name || "N/A"}`,
        `- **Período:** ${activeSprint.startDate || "?"} a ${activeSprint.endDate || "?"}`,
        `- **Status:** ${activeSprint.status}`,
        `- **Capacidade do sprint:** ${capacity?.capacity ?? 0} FP (soma de alocações no projeto)`,
        `- **Em aberto:** ${capacity?.open ?? 0} FP (tasks ativas)`,
        `- **Restante:** ${(Number(capacity?.capacity) || 0) - (Number(capacity?.open) || 0)} FP`,
      ].join("\n")
    : "## Sprint Ativo\nNenhum sprint ativo encontrado.";

  const sprintListBlock = sprintList.length > 0
    ? [
        "## Sprints (não concluídos)",
        ...sprintList.map((s) => {
          const proj = (s.project as { name: string } | null)?.name || "?";
          return `- **${s.name}** | ${s.status} | ${s.startDate || "?"} → ${s.endDate || "?"} | projeto: ${proj}`;
        }),
      ].join("\n")
    : "";

  const sprintMembersBlock = membersInSprint.length > 0
    ? [
        "## Alocação do time no sprint ativo",
        ...membersInSprint.map((m) => {
          const alloc = Number(m.fp_allocation) || 0;
          const used = Number(m.fp_open) || 0;
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
          const assignments = (t.assignments as Array<{ member: { name: string } | null }> | null | undefined) ?? [];
          const assignee = assignments[0]?.member;
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

  const alertsBlock = alerts.length > 0
    ? ["## Alertas operacionais", ...alerts].join("\n")
    : "## Alertas operacionais\nNenhum alerta.";

  return [
    sprintBlock,
    ...(sprintListBlock ? ["", sprintListBlock] : []),
    ...(sprintMembersBlock ? ["", sprintMembersBlock] : []),
    "",
    tasksBlock,
    "",
    backlogBlock,
    "",
    alertsBlock,
  ].join("\n");
}

// ─── Project focus ───────────────────────────────────────────────

async function buildProjectFocus(
  projectId: string,
  config: AlphaConfig,
): Promise<{ block: string; activeSprintId: string | null }> {
  const supabase = db();

  const [{ data: project }, { data: sprints }, { data: backlog }, { data: members }] = await Promise.all([
    supabase
      .from("Project")
      .select("id, name, status, startDate, endDate, pm:Member!Project_pmId_fkey(id, name)")
      .eq("id", projectId)
      .maybeSingle(),
    supabase
      .from("Sprint")
      .select("id, name, status, startDate, endDate")
      .eq("projectId", projectId)
      .neq("status", "done")
      .order("startDate", { ascending: true })
      .limit(20),
    supabase
      .from("Task")
      .select("reference, title, type, scope, complexity, functionPoints, priority")
      .eq("projectId", projectId)
      .is("sprintId", null)
      .neq("status", "draft")
      .order("priority", { ascending: false })
      .order("createdAt", { ascending: false })
      .limit(20),
    supabase
      .from("ProjectMember")
      .select("fpAllocation, member:Member(id, name, role, fpCapacity)")
      .eq("projectId", projectId),
  ]);

  if (!project) {
    return {
      block: `## Foco: Projeto ${projectId}\n_(projeto não encontrado)_`,
      activeSprintId: null,
    };
  }

  const sprintList = sprints || [];
  const memberList = members || [];

  // "Sprint atual do projeto" = sprint mais recente não-done
  const activeSprint = sprintList[sprintList.length - 1] ?? null;
  let activeSprintBlock = "";
  if (activeSprint) {
    const [{ data: cap }, { data: tasks }, { data: alloc }] = await Promise.all([
      supabase
        .from("sprint_capacity_overview")
        .select("*")
        .eq("sprintId", activeSprint.id)
        .maybeSingle(),
      supabase
        .from("Task")
        .select("reference, title, status, functionPoints, priority, dueDate, assignments:TaskAssignment(member:Member(name))")
        .eq("sprintId", activeSprint.id)
        .neq("status", "draft")
        .order("priority", { ascending: false })
        .limit(15),
      supabase
        .from("sprint_member_capacity")
        .select("member_name, fp_allocation, fp_open, has_sprint_override")
        .eq("sprintId", activeSprint.id),
    ]);

    const taskList = tasks || [];
    const allocList = alloc || [];

    activeSprintBlock = [
      `### Sprint atual do projeto: ${activeSprint.name}`,
      `- Período: ${activeSprint.startDate || "?"} → ${activeSprint.endDate || "?"} | status: ${activeSprint.status}`,
      cap
        ? `- Capacidade: ${cap.capacity ?? 0} FP | Em aberto: ${cap.open ?? 0} FP | Restante: ${(Number(cap.capacity) || 0) - (Number(cap.open) || 0)} FP`
        : "- Capacidade: sem dados",
      "",
      "**Alocação no sprint:**",
      ...(allocList.length === 0
        ? ["_Nenhum membro alocado._"]
        : allocList.map((a) => {
            const used = Number(a.fp_open) || 0;
            const ac = Number(a.fp_allocation) || 0;
            const pct = ac > 0 ? Math.round((used / ac) * 100) : 0;
            const tag = a.has_sprint_override ? " [override]" : "";
            return `- ${a.member_name}${tag}: ${used}/${ac} FP (${pct}%)`;
          })),
      "",
      "**Tasks do sprint (top 15 por prioridade):**",
      ...(taskList.length === 0
        ? ["_Nenhuma task ativa._"]
        : taskList.map((t) => {
            const assignments = (t.assignments as Array<{ member: { name: string } | null }> | null) ?? [];
            const who = assignments[0]?.member?.name ?? "sem atribuição";
            return `- [${t.reference}] ${t.title} | ${t.status} | ${t.functionPoints ?? "?"}FP | ${who}`;
          })),
    ].join("\n");
  }

  const sprintsListBlock = sprintList.length > 0
    ? [
        "**Sprints do projeto (planning/active):**",
        ...sprintList.map((s) => `- ${s.name} | ${s.status} | ${s.startDate || "?"} → ${s.endDate || "?"}`),
      ].join("\n")
    : "_Nenhum sprint ativo neste projeto._";

  const membersBlock = memberList.length > 0
    ? [
        "**Membros alocados:**",
        ...memberList.map((m) => {
          const member = m.member as { name: string; role: string; fpCapacity: number } | null;
          if (!member) return "- (membro removido)";
          return `- ${member.name} (${member.role}): ${m.fpAllocation} FP/sprint dedicado a este projeto (capacity total ${member.fpCapacity})`;
        }),
      ].join("\n")
    : "_Nenhum membro alocado ao projeto._";

  const backlogBlock = (backlog || []).length > 0
    ? [
        `**Backlog do projeto (top ${(backlog || []).length}):**`,
        ...(backlog || []).map((t) => `- [${t.reference}] ${t.title} | ${t.type} | ${t.functionPoints ?? "?"}FP`),
      ].join("\n")
    : "_Backlog vazio._";

  const pm = (project.pm as { name: string } | null)?.name ?? "(sem PM)";

  const block = [
    `## Foco: Projeto ${project.name}`,
    `- ID: ${project.id} | Status: ${project.status} | PM: ${pm}`,
    `- Período: ${project.startDate || "?"} → ${project.endDate || "?"}`,
    "",
    sprintsListBlock,
    ...(activeSprintBlock ? ["", activeSprintBlock] : []),
    "",
    membersBlock,
    "",
    backlogBlock,
    "",
    `_Tools de leitura sem ID explícito vão filtrar por este projeto. Use \`projectName\` numa tool pra escapar._`,
    `_Threshold de overflow ativo: ${Math.round(config.fp_overflow_threshold * 100)}%._`,
  ].join("\n");

  return { block, activeSprintId: activeSprint?.id ?? null };
}

// ─── Sprint focus ────────────────────────────────────────────────

async function buildSprintFocus(
  sprintId: string,
  config: AlphaConfig,
): Promise<{ block: string; projectId: string | null }> {
  const supabase = db();

  const [{ data: sprint }, { data: cap }, { data: alloc }, { data: tasks }] = await Promise.all([
    supabase
      .from("Sprint")
      .select("id, name, status, startDate, endDate, projectId, project:Project(id, name, status)")
      .eq("id", sprintId)
      .maybeSingle(),
    supabase
      .from("sprint_capacity_overview")
      .select("*")
      .eq("sprintId", sprintId)
      .maybeSingle(),
    supabase
      .from("sprint_member_capacity")
      .select("member_name, fp_allocation, fp_open, has_sprint_override")
      .eq("sprintId", sprintId),
    supabase
      .from("Task")
      .select("reference, title, status, functionPoints, priority, dueDate, assignments:TaskAssignment(member:Member(name))")
      .eq("sprintId", sprintId)
      .neq("status", "draft")
      .order("priority", { ascending: false })
      .order("createdAt", { ascending: false })
      .limit(30),
  ]);

  if (!sprint) {
    return {
      block: `## Foco: Sprint ${sprintId}\n_(sprint não encontrado)_`,
      projectId: null,
    };
  }

  const allocList = alloc || [];
  const taskList = tasks || [];
  const proj = (sprint.project as { name: string } | null)?.name ?? "(projeto desconhecido)";

  // Alertas específicos deste sprint
  const alerts: string[] = [];
  for (const a of allocList) {
    const used = Number(a.fp_open) || 0;
    const ac = Number(a.fp_allocation) || 0;
    if (ac > 0 && used > ac * config.fp_overflow_threshold) {
      const tag = a.has_sprint_override ? " (override)" : "";
      alerts.push(`⚠ ${a.member_name} estourou alocação${tag}: ${used}/${ac} FP`);
    }
  }
  if (cap) {
    const c = Number(cap.capacity) || 0;
    const al = Number(cap.open) || 0;
    if (c > 0 && al > c * config.fp_overflow_threshold) {
      alerts.push(`⚠ Sprint acima da capacidade do time: ${al}/${c} FP`);
    }
  }
  const unassigned = taskList.filter(
    (t) => OPEN_STATUSES.includes(t.status as typeof OPEN_STATUSES[number])
      && !((t.assignments as Array<unknown> | null) ?? []).length,
  );
  if (unassigned.length > 0) {
    alerts.push(`⚠ ${unassigned.length} task(s) sem atribuição: ${unassigned.map((t) => t.reference).join(", ")}`);
  }
  const now = new Date();
  const overdue = taskList.filter(
    (t) => OPEN_STATUSES.includes(t.status as typeof OPEN_STATUSES[number])
      && t.dueDate && new Date(t.dueDate as string) < now,
  );
  if (overdue.length > 0) {
    alerts.push(`⚠ ${overdue.length} task(s) com prazo vencido: ${overdue.map((t) => t.reference).join(", ")}`);
  }

  const block = [
    `## Foco: Sprint ${sprint.name} (Projeto ${proj})`,
    `- ID: ${sprint.id} | Status: ${sprint.status} | Período: ${sprint.startDate || "?"} → ${sprint.endDate || "?"}`,
    cap
      ? `- Capacidade: ${cap.capacity ?? 0} FP | Em aberto: ${cap.open ?? 0} FP | Restante: ${(Number(cap.capacity) || 0) - (Number(cap.open) || 0)} FP`
      : "- Capacidade: sem dados",
    "",
    "**Alocação por membro:**",
    ...(allocList.length === 0
      ? ["_Nenhum membro alocado._"]
      : allocList.map((a) => {
          const used = Number(a.fp_open) || 0;
          const ac = Number(a.fp_allocation) || 0;
          const pct = ac > 0 ? Math.round((used / ac) * 100) : 0;
          const tag = a.has_sprint_override ? " [override]" : "";
          return `- ${a.member_name}${tag}: ${used}/${ac} FP (${pct}%)`;
        })),
    "",
    `**Tasks (${taskList.length}):**`,
    ...(taskList.length === 0
      ? ["_Nenhuma task._"]
      : taskList.map((t) => {
          const assignments = (t.assignments as Array<{ member: { name: string } | null }> | null) ?? [];
          const who = assignments[0]?.member?.name ?? "sem atribuição";
          return `- [${t.reference}] ${t.title} | ${t.status} | ${t.functionPoints ?? "?"}FP | ${who}`;
        })),
    ...(alerts.length > 0 ? ["", "**Alertas:**", ...alerts] : []),
    "",
    `_Tools de leitura sem ID explícito vão filtrar por este sprint/projeto._`,
  ].join("\n");

  return { block, projectId: sprint.projectId ?? null };
}

// ─── Meeting block (dispatcher por tipo) ─────────────────────────

const MEETING_TYPE_LABELS: Record<string, string> = {
  pm_review: "Reunião com PMs (Weekly PM)",
  general: "Reunião geral",
  daily: "Daily",
  super_planning: "Super Planning",
};

type MeetingRow = {
  id: string;
  date: string;
  type: string | null;
  title: string | null;
  notes: string | null;
  sprintId: string | null;
  attendees: Array<{
    role: string | null;
    externalName: string | null;
    externalRole: string | null;
    member: { id: string; name: string } | null;
  }> | null;
  projectLinks: Array<{
    projectId: string;
    project: { id: string; name: string } | null;
  }> | null;
};

type PendingAction = {
  id: string;
  type: string;
  source: string;
  taskId: string | null;
  targetSprintId: string | null;
  payload: unknown;
  aiReasoning: string | null;
  aiConfidence: number | null;
  project: { name: string } | null;
  task: { reference: string | null; title: string } | null;
  targetSprint: { name: string } | null;
};

async function buildMeetingBlock(meetingId?: string): Promise<string | null> {
  if (!meetingId) return null;
  const supabase = db();

  const { data: meeting } = await supabase
    .from("Meeting")
    .select(`
      id, date, type, title, notes, sprintId,
      attendees:MeetingAttendee(role, externalName, externalRole, member:Member(id, name)),
      projectLinks:MeetingProjectLink(projectId, project:Project(id, name))
    `)
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting) return null;

  const m = meeting as unknown as MeetingRow;
  const meetingType = m.type ?? "pm_review";

  const { data: pendingRaw } = await supabase
    .from("MeetingTaskAction")
    .select(`
      id, type, source, taskId, targetSprintId, payload,
      aiReasoning, aiConfidence,
      project:Project(name),
      task:Task(reference, title),
      targetSprint:Sprint!MeetingTaskAction_targetSprintId_fkey(name)
    `)
    .eq("meetingId", meetingId)
    .eq("decision", "pending")
    .order("createdAt", { ascending: true });

  const pending = ((pendingRaw || []) as unknown) as PendingAction[];
  const pendingBlock = renderPendingActions(pending);

  switch (meetingType) {
    case "daily":
      return await renderDailyMeeting(m, pendingBlock);
    case "super_planning":
      return await renderSuperPlanningMeeting(m, pendingBlock);
    case "general":
      return renderGeneralMeeting(m, pendingBlock);
    case "pm_review":
    default:
      return await renderPmReviewMeeting(m, pendingBlock);
  }
}

function renderMeetingHeader(m: MeetingRow): string {
  const type = m.type ?? "pm_review";
  const label = MEETING_TYPE_LABELS[type] ?? type;
  return [
    `## Reunião ativa: ${label}${m.title ? ` — ${m.title}` : ""}`,
    `- **ID:** ${m.id}`,
    `- **Data:** ${m.date}`,
    `- **Tipo:** \`${type}\``,
  ].join("\n");
}

function renderAttendees(m: MeetingRow): string {
  const list = m.attendees || [];
  if (list.length === 0) return "_Sem participantes registrados._";
  const parts = list.map((a) => {
    if (a.member) return `${a.member.name}${a.role ? ` (${a.role})` : ""}`;
    return `${a.externalName ?? "?"}${a.externalRole ? ` (${a.externalRole}, externo)` : " (externo)"}`;
  });
  return `**Participantes:** ${parts.join(", ")}`;
}

function renderProjectLinks(m: MeetingRow): string {
  const list = m.projectLinks || [];
  if (list.length === 0) return "_Sem projetos vinculados._";
  const names = list.map((l) => l.project?.name).filter(Boolean);
  return `**Projetos vinculados:** ${names.join(", ")}`;
}

function renderNotes(m: MeetingRow): string {
  const notes = (m.notes ?? "").trim();
  if (!notes) return "_Sem notas/transcrição registradas no Zordon._";
  const trimmed = notes.length > 2500 ? `${notes.slice(0, 2500)}…[truncado, ${notes.length - 2500} chars]` : notes;
  return ["**Notas/transcrição (Meeting.notes):**", trimmed].join("\n");
}

function renderPendingActions(actions: PendingAction[]): string {
  if (actions.length === 0) return "_Nenhuma ação proposta pendente._";
  const lines: string[] = [`### Ações pendentes (${actions.length}) — já propostas, aguardando decisão do PM`];
  for (const a of actions) {
    const project = a.project?.name ?? "?";
    const task = a.task ? `[${a.task.reference ?? "?"}] ${a.task.title}` : "(nova task)";
    const target = a.targetSprint?.name ? ` → ${a.targetSprint.name}` : "";
    const src = a.source === "ai" ? "🤖" : "👤";
    const reason = a.aiReasoning ? ` — ${a.aiReasoning}` : "";
    lines.push(`- ${src} **${a.type}** · ${task}${target} · projeto: ${project}${reason}`);
  }
  return lines.join("\n");
}

async function renderPmReviewMeeting(m: MeetingRow, pendingBlock: string): Promise<string> {
  const supabase = db();
  const { data: reviews } = await supabase
    .from("MeetingProjectReview")
    .select("id, nextSteps, sprintHealth, attentionPoints, additionalNotes, order, project:Project(id, name, pmId), member:Member(id, name)")
    .eq("meetingId", m.id)
    .order("order", { ascending: true });

  const reviewList = reviews || [];
  const projectIds = Array.from(
    new Set(
      reviewList
        .map((r) => (r.project as { id: string } | null)?.id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  // Squad (PM + ProjectMembers) por projeto, em uma query batch
  const squadByProject = new Map<string, Array<{
    name: string;
    role: string;
    fpAllocation: number | null;
    isPM: boolean;
  }>>();
  if (projectIds.length > 0) {
    const { data: pmRows } = await supabase
      .from("ProjectMember")
      .select("projectId, fpAllocation, member:Member(id, name, role)")
      .in("projectId", projectIds);

    type Mb = { id: string; name: string; role: string };
    type SquadRow = { name: string; role: string; fpAllocation: number | null; isPM: boolean };

    const pmIdByProject = new Map<string, string | null>();
    for (const r of reviewList) {
      const proj = r.project as { id: string; pmId: string | null } | null;
      if (proj?.id) pmIdByProject.set(proj.id, proj.pmId);
    }

    for (const projectId of projectIds) {
      const byMemberId = new Map<string, SquadRow>();
      const ownerPmId = pmIdByProject.get(projectId) ?? null;

      for (const row of (pmRows || []) as Array<{
        projectId: string;
        fpAllocation: number;
        member: Mb | null;
      }>) {
        if (row.projectId !== projectId || !row.member) continue;
        byMemberId.set(row.member.id, {
          name: row.member.name,
          role: row.member.role,
          fpAllocation: row.fpAllocation,
          isPM: ownerPmId === row.member.id,
        });
      }

      // PM órfão (não está em ProjectMember): incluir mesmo assim com fpAllocation=null
      if (ownerPmId && !byMemberId.has(ownerPmId)) {
        const review = reviewList.find(
          (r) => (r.member as Mb | null)?.id === ownerPmId,
        );
        const pmMember = review?.member as Mb | null;
        if (pmMember) {
          byMemberId.set(pmMember.id, {
            name: pmMember.name,
            role: "(PM)",
            fpAllocation: null,
            isPM: true,
          });
        }
      }

      const sorted = Array.from(byMemberId.values()).sort((a, b) => {
        if (a.isPM !== b.isPM) return a.isPM ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      squadByProject.set(projectId, sorted);
    }
  }

  const byPm = new Map<string, { pmName: string; items: typeof reviewList }>();
  for (const r of reviewList) {
    const pm = r.member as { id: string; name: string } | null;
    if (!pm) continue;
    const bucket = byPm.get(pm.id) || { pmName: pm.name, items: [] };
    bucket.items.push(r);
    byPm.set(pm.id, bucket);
  }

  const reviewLines: string[] = [];
  if (byPm.size === 0) {
    reviewLines.push("_Nenhuma revisão cadastrada._");
  } else {
    for (const { pmName, items } of byPm.values()) {
      reviewLines.push(`**${pmName}** — ${items.length} projeto(s):`);
      for (const r of items) {
        const proj = r.project as { id: string; name: string } | null;
        const projName = proj?.name || "?";
        const filled: string[] = [];
        if (r.nextSteps) filled.push("nextSteps");
        if (r.attentionPoints) filled.push("attentionPoints");
        if (r.additionalNotes) filled.push("additionalNotes");
        const status = filled.length === 0 ? "vazio" : filled.join(", ");
        reviewLines.push(`  - ${projName} | health: ${r.sprintHealth} | preenchido: ${status}`);

        // Squad do projeto (info de contexto, NÃO attendees da reunião)
        const squad = proj?.id ? squadByProject.get(proj.id) : null;
        if (squad && squad.length > 0) {
          const tags = squad.map((s) => {
            const fp = s.fpAllocation === null ? "—" : `${s.fpAllocation}FP`;
            const pm = s.isPM ? " (PM)" : "";
            return `${s.name}${pm}: ${fp}`;
          });
          reviewLines.push(`    squad: ${tags.join(" · ")}`);
        }
      }
    }
  }

  return [
    renderMeetingHeader(m),
    "",
    renderAttendees(m),
    renderProjectLinks(m),
    "",
    "**Fluxo da reunião:** preencher revisões via `update_meeting_review`. Mudanças em Task → `propose_task_action` (NUNCA execução direta dentro de reunião). Ações operacionais → `create_todo`.",
    "",
    `### Revisões por PM (${reviewList.length} projeto(s))`,
    ...reviewLines,
    "",
    pendingBlock,
  ].join("\n");
}

async function renderDailyMeeting(m: MeetingRow, pendingBlock: string): Promise<string> {
  const supabase = db();
  const links = m.projectLinks || [];

  const projectBlocks: string[] = [];
  for (const link of links) {
    if (!link.projectId) continue;
    const projName = link.project?.name ?? "?";

    const { data: sprint } = await supabase
      .from("Sprint")
      .select("id, name, status, startDate, endDate")
      .eq("projectId", link.projectId)
      .neq("status", "done")
      .order("startDate", { ascending: false })
      .limit(1)
      .maybeSingle();

    projectBlocks.push(`### Projeto: ${projName}`);
    if (!sprint) {
      projectBlocks.push("_Sem sprint ativa/planning._");
      continue;
    }
    projectBlocks.push(`Sprint atual: **${sprint.name}** (${sprint.status}) | ${sprint.startDate} → ${sprint.endDate}`);

    const { data: tasks } = await supabase
      .from("Task")
      .select("reference, title, status, type, functionPoints, priority, assignments:TaskAssignment(member:Member(name))")
      .eq("sprintId", sprint.id)
      .neq("status", "draft")
      .order("priority", { ascending: false })
      .limit(30);

    const taskList = tasks || [];
    if (taskList.length === 0) {
      projectBlocks.push("_Sem tasks na sprint._");
    } else {
      for (const t of taskList) {
        const assignees = ((t.assignments as Array<{ member: { name: string } | null }> | null) || [])
          .map((x) => x.member?.name).filter(Boolean).join(", ") || "sem atribuição";
        projectBlocks.push(`- [${t.reference}] ${t.title} | ${t.status} | ${t.functionPoints ?? "?"}FP | ${assignees}`);
      }
    }
    projectBlocks.push("");
  }

  return [
    renderMeetingHeader(m),
    "",
    renderAttendees(m),
    renderProjectLinks(m),
    "",
    "**Fluxo da Daily:** ler estado da sprint atual de cada projeto vinculado. Propor mudanças em Task via `propose_task_action` (criar/mover/atualizar/marcar pra review). Ações operacionais → `create_todo`. **NUNCA** chame tools de execução direta de Task (create_task, move_task_to_sprint, update_task_*, assign_task) durante a reunião.",
    "",
    renderNotes(m),
    "",
    "### Estado por projeto",
    ...projectBlocks,
    pendingBlock,
  ].join("\n");
}

async function renderSuperPlanningMeeting(m: MeetingRow, pendingBlock: string): Promise<string> {
  const supabase = db();
  const sprintId = m.sprintId;
  let projectId: string | null = null;

  let sprintBlock = "_Sem sprint-objeto vinculada (Meeting.sprintId está nulo)._";
  if (sprintId) {
    const { data: sprint } = await supabase
      .from("Sprint")
      .select("id, name, status, startDate, endDate, projectId, project:Project(id, name)")
      .eq("id", sprintId)
      .maybeSingle();

    if (sprint) {
      projectId = sprint.projectId;
      const projName = (sprint.project as { name: string } | null)?.name ?? "?";

      const { data: tasks } = await supabase
        .from("Task")
        .select("reference, title, status, type, scope, complexity, functionPoints, priority, assignments:TaskAssignment(member:Member(name))")
        .eq("sprintId", sprint.id)
        .neq("status", "draft")
        .order("priority", { ascending: false });

      const taskList = tasks || [];
      const taskLines = taskList.length === 0
        ? ["_Sem tasks na sprint ainda — vai ser planejada agora._"]
        : taskList.map((t) => {
            const assignees = ((t.assignments as Array<{ member: { name: string } | null }> | null) || [])
              .map((x) => x.member?.name).filter(Boolean).join(", ") || "sem atribuição";
            return `- [${t.reference}] ${t.title} | ${t.status} | ${t.scope}/${t.complexity} | ${t.functionPoints ?? "?"}FP | ${assignees}`;
          });

      sprintBlock = [
        `### Sprint-objeto: ${sprint.name} (Projeto ${projName})`,
        `- ID: ${sprint.id} | Status: ${sprint.status} | Período: ${sprint.startDate} → ${sprint.endDate}`,
        "",
        `**Tasks atualmente na sprint (${taskList.length}):**`,
        ...taskLines,
      ].join("\n");
    }
  }

  let backlogBlock = "_Backlog não disponível (sem sprint-objeto vinculada)._";
  if (projectId) {
    const { data: backlog } = await supabase
      .from("Task")
      .select("reference, title, type, scope, complexity, functionPoints, priority")
      .eq("projectId", projectId)
      .is("sprintId", null)
      .neq("status", "draft")
      .order("priority", { ascending: false })
      .limit(40);

    const list = backlog || [];
    const lines = list.length === 0
      ? ["_Backlog vazio._"]
      : list.map((t) => `- [${t.reference}] ${t.title} | ${t.type} | ${t.scope}/${t.complexity} | ${t.functionPoints ?? "?"}FP | prio ${t.priority}`);
    backlogBlock = [`### Backlog do projeto (top ${list.length})`, ...lines].join("\n");
  }

  return [
    renderMeetingHeader(m),
    "",
    renderAttendees(m),
    renderProjectLinks(m),
    "",
    "**Fluxo da Super Planning:** ler transcrição/notas + estado da sprint-objeto + backlog do projeto. Propor reorganização (criar / mover / atualizar / marcar pra review) via `propose_task_action`. Ações operacionais → `create_todo`. **NUNCA** chame tools de execução direta de Task durante a reunião — toda mudança vira proposta pra o PM aprovar e o sistema aplicar em batch.",
    "",
    renderNotes(m),
    "",
    sprintBlock,
    "",
    backlogBlock,
    "",
    pendingBlock,
  ].join("\n");
}

function renderGeneralMeeting(m: MeetingRow, pendingBlock: string): string {
  return [
    renderMeetingHeader(m),
    "",
    renderAttendees(m),
    renderProjectLinks(m),
    "",
    "**Fluxo da reunião geral:** registro livre. Use `create_todo` pra ações operacionais. **Tasks NÃO são tratadas neste tipo de reunião** — não chame tools de Task (nem execução direta nem `propose_task_action`).",
    "",
    renderNotes(m),
    "",
    pendingBlock,
  ].join("\n");
}

// ─── Renderers ───────────────────────────────────────────────────

function renderToday(): string {
  const now = new Date();
  const iso = now.toISOString().split("T")[0];
  const weekday = now.toLocaleDateString("pt-BR", { weekday: "long", timeZone: "America/Sao_Paulo" });
  const dateBR = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric", timeZone: "America/Sao_Paulo" });
  return [
    "## Hoje",
    `Data atual: **${iso}** — ${weekday}, ${dateBR}.`,
    "Use sempre essa data como âncora ao interpretar referências relativas (\"hoje\", \"ontem\", \"essa segunda\", \"semana passada\", \"30/06\" sem ano, etc). Nunca chute o ano por inferência — use o ano corrente acima.",
  ].join("\n");
}

function renderParams(config: AlphaConfig): string {
  return [
    "## Parâmetros operacionais atuais",
    `- Duração do sprint: ${config.sprint_length_days} dias`,
    `- Threshold de overflow: ${Math.round(config.fp_overflow_threshold * 100)}%`,
    `- Utilização mínima esperada por membro: ${Math.round(config.min_utilization_percent * 100)}%`,
    `- Critério de atribuição automática: ${config.auto_assign_priority}`,
    `- Ferramentas que exigem confirmação: ${config.require_approval_for.join(", ") || "nenhuma"}`,
  ].join("\n");
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
