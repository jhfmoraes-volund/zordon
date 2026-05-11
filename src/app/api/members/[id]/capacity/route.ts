import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";

/**
 * GET /api/members/[id]/capacity
 *
 * Retorna tudo que a página /members/[id] precisa:
 *   - member (identidade + bateria total Member.fpCapacity)
 *   - commitment (bateria agregada: capacity / committed / remaining)
 *   - projects (ProjectMember.fpAllocation por projeto)
 *   - sprints (todos os sprints dos projetos do membro, com allocation efetiva,
 *              fp_planned/fp_done/fp_open, flag de override)
 *
 * O cliente aplica filtros (período, projeto, status). Escala até ~200 sprints/membro.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const { id } = await params;
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
    // Projetos onde este Member é PM. ProjectMember pode não existir pro PM —
    // o PM ainda precisa ver os projetos que está pilotando no resumo de capacity.
    supabase
      .from("Project")
      .select("id, name")
      .eq("pmId", id),
    supabase
      .from("sprint_member_capacity")
      .select("sprintId, projectId, fp_allocation, fp_planned, fp_done, fp_open, has_sprint_override")
      .eq("memberId", id),
  ]);

  if (memberErr) return NextResponse.json({ error: memberErr.message }, { status: 500 });
  if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });

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

  // União de ProjectMember (com fpAllocation explícita) ∪ Project.pmId
  // (alocação implícita do PM, fallback = Member.fpCapacity).
  // PM ganha precedência se for ambos (PM + builder) — quase nunca acontece
  // mas evita duplicação. Pra PM-only projects, fpAllocation = fpCapacity
  // como fallback (mesma cascata usada na página do projeto).
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

  return NextResponse.json({
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
  });
}
