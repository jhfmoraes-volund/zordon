import "server-only";
import { db } from "@/lib/db";
import { getCurrentMember } from "@/lib/dal";
import { isGuestActor } from "@/lib/guest-payload";

/**
 * Self-access payload of /api/profile/capacity. Same shape as the route
 * handler returns; the route is now a thin wrapper over this.
 *
 * Returns null for unauthenticated and "guest" for guests (mirrors HTTP
 * 401/403); the route handler maps these.
 */
export async function loadCapacityPayload(): Promise<
  | null
  | "guest"
  | {
      payload: {
        member: {
          id: string;
          name: string;
          role: string;
          position: string | null;
          fpCapacity: number;
        };
        commitment: { capacity: number; committed: number; remaining: number; projectCount: number };
        projects: { projectId: string; projectName: string; fpAllocation: number; isPm: boolean }[];
        sprints: {
          sprintId: string;
          sprintName: string;
          startDate: string;
          endDate: string;
          status: string;
          projectId: string;
          projectName: string;
          fpAllocation: number;
          fpPlanned: number;
          fpDone: number;
          fpOpen: number;
          hasOverride: boolean;
        }[];
      };
    }
> {
  const member = await getCurrentMember();
  if (!member) return null;
  if (await isGuestActor()) return "guest";

  const supabase = db();

  const [
    { data: commitment },
    { data: projectAllocations },
    { data: pmProjects },
    { data: sprintCaps },
  ] = await Promise.all([
    supabase
      .from("member_commitment_overview")
      .select("*")
      .eq("id", member.id)
      .maybeSingle(),
    supabase
      .from("ProjectMember")
      .select("projectId, fpAllocation, project:Project(id, name)")
      .eq("memberId", member.id),
    supabase
      .from("Project")
      .select("id, name")
      .eq("pmId", member.id),
    supabase
      .from("sprint_member_capacity")
      .select("sprintId, projectId, fp_allocation, fp_planned, fp_done, fp_open, has_sprint_override")
      .eq("memberId", member.id),
  ]);

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

  // União de ProjectMember ∪ Project.pmId. PM ganha precedência em duplicatas.
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
    payload: {
      member: {
        id: member.id,
        name: member.name,
        role: member.role,
        position: member.position,
        fpCapacity: member.fpCapacity,
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
    },
  };
}
