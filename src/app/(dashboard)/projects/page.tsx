import { createClient } from "@/lib/supabase/server";
import {
  ProjectsView,
  type Project,
  type Client,
  type Member,
  type ProjectMemberAlloc,
} from "@/components/projects/projects-view";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const supabase = await createClient();

  const [projectsRes, clientsRes, membersRes, taskCountsRes] = await Promise.all([
    supabase
      .from("Project")
      .select(
        "*, client:Client(id, name), projectMembers:ProjectMember(id, member:Member(id, name, role, position)), pm:Member!pmId(id, name)",
      )
      .order("createdAt", { ascending: false }),
    supabase.from("Client").select("id, name").order("name"),
    supabase
      .from("Member")
      .select("id, name, role, position")
      .eq("isGuest", false)
      .order("name"),
    supabase.from("Task").select("projectId").neq("status", "draft"),
  ]);

  const countMap = new Map<string, number>();
  for (const t of taskCountsRes.data ?? []) {
    countMap.set(t.projectId, (countMap.get(t.projectId) || 0) + 1);
  }

  const projects: Project[] = (projectsRes.data ?? []).map(
    (p: Record<string, unknown>) => ({
      ...(p as unknown as Project),
      client: (p.client as Project["client"]) ?? { name: "" },
      pm: (p.pm as Project["pm"]) ?? null,
      projectMembers: (p.projectMembers as ProjectMemberAlloc[]) ?? [],
      taskCount: countMap.get(p.id as string) || 0,
    }),
  );

  return (
    <ProjectsView
      initial={{
        projects,
        clients: (clientsRes.data ?? []) as Client[],
        members: (membersRes.data ?? []) as Member[],
      }}
    />
  );
}
