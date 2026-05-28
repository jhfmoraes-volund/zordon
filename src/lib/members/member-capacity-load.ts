import "server-only";
import { db } from "@/lib/db";
import {
  addDays,
  startOfDay,
  startOfWeek,
  bucketTasksByWeek,
  type DoneTaskEvent,
} from "@/lib/weekBuckets";

/**
 * Lógica server-side do payload de capacity + insights de um membro.
 * Reused pelos route handlers `/api/members/[id]/capacity` e
 * `/api/members/[id]/insights`, e pela página server-component
 * `members/[id]/page.tsx` (que precisa do payload pré-fetched).
 *
 * NOTA: NÃO valida acesso. O caller é responsável (route handler chama
 * `requireMinLevelApi(MANAGER)`, page chama via layout `requireMinLevel(MANAGER)`).
 */

export async function loadMemberCapacity(id: string) {
  const supabase = db();

  const [
    { data: member, error: memberErr },
    { data: commitment },
    { data: projectAllocations },
    { data: pmProjects },
    { data: sprintCaps },
  ] = await Promise.all([
    supabase
      .from("Member")
      .select("id, name, role, position, fpCapacity, seniority, dedicationPercent, isExternal")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("member_commitment_overview")
      .select("*")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("ProjectMember")
      .select("projectId, fpAllocation, project:Project(id, name)")
      .eq("memberId", id),
    supabase
      .from("Project")
      .select("id, name")
      .eq("pmId", id),
    supabase
      .from("sprint_member_capacity")
      .select("sprintId, projectId, fp_allocation, fp_planned, fp_done, fp_open, has_sprint_override")
      .eq("memberId", id),
  ]);

  if (memberErr) throw new Error(memberErr.message);
  if (!member) return null;

  const sprintIds = Array.from(new Set((sprintCaps || []).map((s) => s.sprintId!)));

  type ProjectRef = { id: string; name: string } | null;
  type SprintMeta = {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    status: string;
    projectId: string;
    project: ProjectRef;
  };

  let sprintRows: SprintMeta[] = [];
  if (sprintIds.length > 0) {
    const { data } = await supabase
      .from("Sprint")
      .select("id, name, startDate, endDate, status, projectId, project:Project(id, name)")
      .in("id", sprintIds);
    sprintRows = (data as SprintMeta[] | null) ?? [];
  }

  const sprintMetaMap = new Map<string, SprintMeta>();
  for (const s of sprintRows) sprintMetaMap.set(s.id, s);

  const sprints = (sprintCaps || [])
    .map((sc) => {
      const meta = sprintMetaMap.get(sc.sprintId!);
      if (!meta) return null;
      return {
        sprintId: meta.id,
        sprintName: meta.name,
        startDate: meta.startDate,
        endDate: meta.endDate,
        status: meta.status,
        projectId: meta.projectId,
        projectName: meta.project?.name ?? "?",
        fpAllocation: Number(sc.fp_allocation) || 0,
        fpPlanned: Number(sc.fp_planned) || 0,
        fpDone: Number(sc.fp_done) || 0,
        fpOpen: Number(sc.fp_open) || 0,
        hasOverride: Boolean(sc.has_sprint_override),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

  const projectMap = new Map<
    string,
    { projectId: string; projectName: string; fpAllocation: number; isPm: boolean }
  >();
  for (const pa of projectAllocations || []) {
    const proj = pa.project as ProjectRef;
    projectMap.set(pa.projectId, {
      projectId: pa.projectId,
      projectName: proj?.name ?? "?",
      fpAllocation: Number(pa.fpAllocation) || 0,
      isPm: false,
    });
  }
  const fallbackAllocation = Number(member.fpCapacity) || 0;
  for (const p of pmProjects || []) {
    const existing = projectMap.get(p.id);
    if (existing) {
      existing.isPm = true;
    } else {
      projectMap.set(p.id, {
        projectId: p.id,
        projectName: p.name,
        fpAllocation: fallbackAllocation,
        isPm: true,
      });
    }
  }
  const projects = Array.from(projectMap.values());

  return {
    member: {
      id: member.id,
      name: member.name,
      role: member.role,
      position: member.position,
      fpCapacity: member.fpCapacity,
      seniority: member.seniority,
      dedicationPercent: member.dedicationPercent,
      isExternal: member.isExternal,
    },
    commitment: commitment
      ? {
          capacity: Number(commitment.capacity) || 0,
          committed: Number(commitment.committed) || 0,
          remaining: Number(commitment.remaining) || 0,
          projectCount: Number(commitment.project_count) || 0,
        }
      : { capacity: 0, committed: 0, remaining: 0, projectCount: 0 },
    projects,
    sprints,
  };
}

export async function loadMemberInsights(id: string, weeks = 12) {
  const clamped = Math.min(Math.max(weeks, 1), 52);
  const windowStart = addDays(startOfWeek(startOfDay(new Date())), -7 * (clamped - 1));

  const supabase = db();

  const { data, error } = await supabase
    .from("TaskAssignment")
    .select("task:Task!inner(doneAt, functionPoints, projectId, status, project:Project(id, name))")
    .eq("memberId", id)
    .eq("task.status", "done")
    .gte("task.doneAt", windowStart.toISOString());

  if (error) throw new Error(error.message);

  type Row = {
    task: {
      doneAt: string | null;
      functionPoints: number | null;
      projectId: string;
      status: string;
      project: { id: string; name: string } | null;
    } | null;
  };

  const events: DoneTaskEvent[] = [];
  for (const row of (data as Row[] | null) ?? []) {
    const t = row.task;
    if (!t || !t.doneAt) continue;
    events.push({
      doneAt: t.doneAt,
      fp: Number(t.functionPoints) || 0,
      projectId: t.projectId,
      projectName: t.project?.name ?? "?",
    });
  }

  const buckets = bucketTasksByWeek(events, clamped);

  return {
    weeks: buckets.map((b) => ({
      weekStart: b.weekStart.toISOString(),
      weekEnd: b.weekEnd.toISOString(),
      isCurrent: b.isCurrent,
      doneFp: b.doneFp,
      byProject: b.byProject,
    })),
  };
}
