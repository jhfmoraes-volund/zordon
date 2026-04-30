import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentMember } from "@/lib/dal";

/**
 * GET /api/profile/capacity
 *
 * Self-access version of /api/members/[id]/capacity. Returns the same
 * shape so the WeeklyAllocation/MemberBattery components can share types.
 * Builders can read their OWN data here without manager rights.
 */
export async function GET() {
  const member = await getCurrentMember();
  if (!member) return new NextResponse("Unauthorized", { status: 401 });

  const supabase = db();

  const [
    { data: commitment },
    { data: projectAllocations },
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

  const projects = (projectAllocations || []).map((pa) => {
    const proj = pa.project as ProjectRef;
    return {
      projectId: pa.projectId,
      projectName: proj?.name ?? "?",
      fpAllocation: Number(pa.fpAllocation) || 0,
    };
  });

  return NextResponse.json({
    member: {
      id: member.id,
      name: member.name,
      role: member.role,
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
  });
}
